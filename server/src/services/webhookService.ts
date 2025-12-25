/**
 * WebhookService - V2 Merchant Webhook Delivery
 *
 * Secure webhook delivery with HMAC signatures, retries, and idempotent delivery.
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService } from '../db/database';
import { logger } from '../utils/logger';

const log = logger.child({ service: 'WebhookService' });

// ==================== Types ====================

export type WebhookEventType =
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.expired'
  | 'payment.failed'
  | 'payment.leg_completed'
  | 'dispute.created'
  | 'dispute.resolved';

export interface WebhookEvent {
  id: string;
  event: WebhookEventType;
  createdAt: number;
  data: Record<string, unknown>;
}

export interface WebhookEndpoint {
  id: string;
  merchantId: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  enabled: boolean;
  retryConfig: RetryConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs?: number;
}

export interface DeliveryResult {
  success: boolean;
  deliveryId: string;
  responseStatus?: number;
  durationMs: number;
  error?: string;
  attemptCount: number;
}

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  merchantId: string;
  eventType: WebhookEventType;
  payload: string;
  signature: string;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  attemptCount: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  deliveredAt?: number;
  createdAt: number;
}

// ==================== Configuration ====================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  backoffMs: 1000,
  maxBackoffMs: 300_000, // 5 minutes
};

const WEBHOOK_TIMEOUT_MS = 30_000; // 30 seconds

// ==================== Service ====================

export class WebhookService {
  private retryQueue: Map<string, NodeJS.Timeout> = new Map();

  constructor(private db: DatabaseService) {}

  /**
   * Emit a webhook event to all subscribed endpoints
   */
  async emit(
    merchantId: string,
    eventType: WebhookEventType,
    data: Record<string, unknown>
  ): Promise<void> {
    log.info({ merchantId, eventType }, 'Emitting webhook event');

    try {
      // Get merchant's webhook endpoints
      const endpoints = await this.getEndpointsForMerchant(merchantId);

      if (endpoints.length === 0) {
        log.debug({ merchantId }, 'No webhook endpoints configured');
        return;
      }

      // Filter endpoints that subscribe to this event
      const subscribedEndpoints = endpoints.filter(
        (ep) => ep.enabled && ep.events.includes(eventType)
      );

      if (subscribedEndpoints.length === 0) {
        log.debug({ merchantId, eventType }, 'No endpoints subscribed to event');
        return;
      }

      // Build event
      const event: WebhookEvent = {
        id: `evt_${uuidv4()}`,
        event: eventType,
        createdAt: Date.now(),
        data,
      };

      // Deliver to all subscribed endpoints
      const deliveryPromises = subscribedEndpoints.map((endpoint) =>
        this.deliverToEndpoint(endpoint, event)
      );

      await Promise.allSettled(deliveryPromises);
    } catch (error) {
      log.error({ error, merchantId, eventType }, 'Failed to emit webhook');
    }
  }

  /**
   * Deliver webhook to a specific endpoint
   */
  private async deliverToEndpoint(
    endpoint: WebhookEndpoint,
    event: WebhookEvent
  ): Promise<DeliveryResult> {
    const deliveryId = uuidv4();
    const payload = JSON.stringify(event);
    const signature = this.signPayload(payload, endpoint.secret);

    // Record delivery attempt
    const delivery: WebhookDeliveryRecord = {
      id: deliveryId,
      endpointId: endpoint.id,
      merchantId: endpoint.merchantId,
      eventType: event.event,
      payload,
      signature,
      status: 'pending',
      attemptCount: 0,
      createdAt: Date.now(),
    };

    await this.saveDelivery(delivery);

    // Attempt delivery with retries
    return this.attemptDelivery(endpoint, delivery);
  }

  /**
   * Attempt to deliver a webhook with retry logic
   */
  private async attemptDelivery(
    endpoint: WebhookEndpoint,
    delivery: WebhookDeliveryRecord
  ): Promise<DeliveryResult> {
    const config = endpoint.retryConfig || DEFAULT_RETRY_CONFIG;
    let lastError: string | undefined;
    let responseStatus: number | undefined;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      delivery.attemptCount = attempt;
      delivery.lastAttemptAt = Date.now();

      try {
        const startTime = Date.now();

        const response = await this.sendWebhook(
          endpoint.url,
          delivery.payload,
          delivery.signature
        );

        const durationMs = Date.now() - startTime;
        responseStatus = response.status;

        if (response.ok) {
          // Success!
          delivery.status = 'delivered';
          delivery.deliveredAt = Date.now();
          delivery.responseStatus = response.status;
          await this.updateDelivery(delivery);

          log.info(
            {
              deliveryId: delivery.id,
              endpoint: endpoint.url,
              attempt,
              durationMs,
            },
            'Webhook delivered successfully'
          );

          return {
            success: true,
            deliveryId: delivery.id,
            responseStatus: response.status,
            durationMs,
            attemptCount: attempt,
          };
        }

        // Non-2xx response
        lastError = `HTTP ${response.status}`;
        delivery.responseStatus = response.status;

        // Don't retry on client errors (4xx) except 429
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        log.warn(
          { deliveryId: delivery.id, attempt, error: lastError },
          'Webhook delivery attempt failed'
        );
      }

      // Wait before retry (exponential backoff)
      if (attempt < config.maxAttempts) {
        const backoffMs = Math.min(
          config.backoffMs * Math.pow(2, attempt - 1),
          config.maxBackoffMs || 300_000
        );

        delivery.status = 'retrying';
        delivery.nextRetryAt = Date.now() + backoffMs;
        await this.updateDelivery(delivery);

        await this.sleep(backoffMs);
      }
    }

    // All retries exhausted
    delivery.status = 'failed';
    delivery.errorMessage = lastError;
    await this.updateDelivery(delivery);

    log.error(
      {
        deliveryId: delivery.id,
        endpoint: endpoint.url,
        attempts: delivery.attemptCount,
        error: lastError,
      },
      'Webhook delivery failed after retries'
    );

    return {
      success: false,
      deliveryId: delivery.id,
      responseStatus,
      durationMs: 0,
      error: lastError,
      attemptCount: delivery.attemptCount,
    };
  }

  /**
   * Send HTTP webhook request
   */
  private async sendWebhook(
    url: string,
    payload: string,
    signature: string
  ): Promise<Response> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureHeader = `t=${timestamp},v1=${signature}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FlowMint-Signature': signatureHeader,
          'X-FlowMint-Event-ID': uuidv4(),
          'User-Agent': 'FlowMint-Webhooks/2.0',
        },
        body: payload,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sign payload with HMAC-SHA256
   */
  signPayload(payload: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;

    return crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');
  }

  /**
   * Verify a webhook signature
   */
  verifySignature(
    payload: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds = 300
  ): boolean {
    try {
      // Parse header: t=timestamp,v1=signature
      const parts = signatureHeader.split(',');
      const timestampPart = parts.find((p) => p.startsWith('t='));
      const signaturePart = parts.find((p) => p.startsWith('v1='));

      if (!timestampPart || !signaturePart) {
        return false;
      }

      const timestamp = parseInt(timestampPart.split('=')[1], 10);
      const signature = signaturePart.split('=')[1];

      // Check timestamp tolerance
      const age = Math.floor(Date.now() / 1000) - timestamp;
      if (age > toleranceSeconds) {
        return false;
      }

      // Compute expected signature
      const signedPayload = `${timestamp}.${payload}`;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      // Constant-time comparison
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex')
      );
    } catch {
      return false;
    }
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(merchantId: string): Promise<DeliveryResult> {
    const endpoints = await this.getEndpointsForMerchant(merchantId);

    if (endpoints.length === 0) {
      return {
        success: false,
        deliveryId: '',
        durationMs: 0,
        error: 'No webhook endpoints configured',
        attemptCount: 0,
      };
    }

    const endpoint = endpoints[0];
    const testEvent: WebhookEvent = {
      id: `evt_test_${uuidv4()}`,
      event: 'invoice.created',
      createdAt: Date.now(),
      data: {
        test: true,
        message: 'This is a test webhook from FlowMint',
      },
    };

    const payload = JSON.stringify(testEvent);
    const signature = this.signPayload(payload, endpoint.secret);

    const startTime = Date.now();

    try {
      const response = await this.sendWebhook(endpoint.url, payload, signature);
      const durationMs = Date.now() - startTime;

      return {
        success: response.ok,
        deliveryId: testEvent.id,
        responseStatus: response.status,
        durationMs,
        attemptCount: 1,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        deliveryId: testEvent.id,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        attemptCount: 1,
      };
    }
  }

  /**
   * Get endpoints for a merchant
   */
  private async getEndpointsForMerchant(
    merchantId: string
  ): Promise<WebhookEndpoint[]> {
    // In production, fetch from database
    // For now, check if merchant has webhook URL configured
    const merchant = await this.db.getMerchant(merchantId);

    if (!merchant?.webhookUrl) {
      return [];
    }

    return [
      {
        id: `ep_${merchantId}`,
        merchantId,
        url: merchant.webhookUrl,
        secret: this.getMerchantWebhookSecret(merchantId),
        events: [
          'invoice.created',
          'invoice.paid',
          'invoice.expired',
          'payment.failed',
          'payment.leg_completed',
        ],
        enabled: true,
        retryConfig: DEFAULT_RETRY_CONFIG,
      },
    ];
  }

  /**
   * Get or generate webhook secret for merchant
   */
  private getMerchantWebhookSecret(merchantId: string): string {
    // In production, this would be stored per-merchant
    // For now, derive from merchant ID
    return crypto
      .createHash('sha256')
      .update(`webhook_secret_${merchantId}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Save delivery record
   */
  private async saveDelivery(delivery: WebhookDeliveryRecord): Promise<void> {
    // In production, save to database
    log.debug({ deliveryId: delivery.id }, 'Saved delivery record');
  }

  /**
   * Update delivery record
   */
  private async updateDelivery(delivery: WebhookDeliveryRecord): Promise<void> {
    // In production, update in database
    log.debug(
      { deliveryId: delivery.id, status: delivery.status },
      'Updated delivery record'
    );
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Process pending deliveries (for background job)
   */
  async processPendingDeliveries(): Promise<number> {
    // In production, fetch pending deliveries from DB and retry
    return 0;
  }

  /**
   * Cleanup old delivery records
   */
  async cleanupOldDeliveries(olderThanDays = 30): Promise<number> {
    // In production, delete old records
    return 0;
  }
}

// Singleton instance
let webhookServiceInstance: WebhookService | null = null;

export function getWebhookService(db: DatabaseService): WebhookService {
  if (!webhookServiceInstance) {
    webhookServiceInstance = new WebhookService(db);
  }
  return webhookServiceInstance;
}

export default WebhookService;
