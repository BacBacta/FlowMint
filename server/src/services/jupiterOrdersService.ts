/**
 * Jupiter Recurring & Trigger Order Service
 *
 * Integrates with Jupiter's Recurring API (DCA) and Trigger API (Limit Orders).
 * https://dev.jup.ag/docs/recurring/index
 * https://dev.jup.ag/docs/trigger/index
 */

import axios, { AxiosInstance } from 'axios';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'JupiterOrders' });

// ============================================================================
// Types
// ============================================================================

/**
 * Time-based recurring order parameters
 */
export interface TimeBasedOrderParams {
  /** Raw amount of input token (before decimals) */
  inAmount: string;
  /** Total number of orders to execute */
  numberOfOrders: number;
  /** Time between each order in seconds */
  interval: number;
  /** Minimum price or null */
  minPrice?: string | null;
  /** Maximum price or null */
  maxPrice?: string | null;
  /** Unix timestamp of start time or null (null starts immediately) */
  startAt?: number | null;
}

/**
 * Request to create a recurring order
 */
export interface CreateRecurringOrderRequest {
  /** User's wallet public key */
  user: string;
  /** Input token mint address */
  inputMint: string;
  /** Output token mint address */
  outputMint: string;
  /** Time-based order parameters */
  params: {
    time: TimeBasedOrderParams;
  };
}

/**
 * Response from creating a recurring order
 */
export interface CreateRecurringOrderResponse {
  /** Request ID for execution */
  requestId: string;
  /** Serialized transaction (base64) */
  transaction: string;
  /** Order public key (if available) */
  order?: string;
}

/**
 * Request to create a trigger (limit) order
 */
export interface CreateTriggerOrderRequest {
  /** Input token mint address */
  inputMint: string;
  /** Output token mint address */
  outputMint: string;
  /** Order maker (user's wallet) */
  maker: string;
  /** Transaction payer (usually same as maker) */
  payer: string;
  /** Order parameters */
  params: {
    /** Amount of input token to swap */
    makingAmount: string;
    /** Expected amount of output token */
    takingAmount: string;
    /** Optional slippage in basis points */
    slippageBps?: number;
    /** Optional expiry in unix seconds */
    expiredAt?: number;
    /** Optional integrator fee in basis points */
    feeBps?: number;
  };
  /** Compute unit price: 'auto' or number */
  computeUnitPrice?: string | number;
  /** Whether to wrap/unwrap SOL automatically */
  wrapAndUnwrapSol?: boolean;
  /** Optional referral fee account */
  feeAccount?: string;
}

/**
 * Response from creating a trigger order
 */
export interface CreateTriggerOrderResponse {
  /** Order public key */
  order: string;
  /** Serialized transaction (base64) */
  transaction: string;
  /** Request ID for execution */
  requestId: string;
}

/**
 * Execute order request
 */
export interface ExecuteOrderRequest {
  /** Request ID from create order */
  requestId: string;
  /** Signed transaction (base64) */
  signedTransaction: string;
}

/**
 * Execute order response
 */
export interface ExecuteOrderResponse {
  /** Transaction signature */
  signature: string;
  /** Order status */
  status: string;
}

/**
 * Cancel order request
 */
export interface CancelOrderRequest {
  /** Order public key to cancel */
  order: string;
  /** User's wallet (signer) */
  signer: string;
}

/**
 * Cancel order response
 */
export interface CancelOrderResponse {
  /** Serialized transaction (base64) */
  transaction: string;
  /** Request ID */
  requestId: string;
}

/**
 * Recurring order from API
 */
export interface RecurringOrder {
  /** Order public key */
  orderKey: string;
  /** User's wallet */
  user: string;
  /** Input mint */
  inputMint: string;
  /** Output mint */
  outputMint: string;
  /** Order type: time or price */
  orderType: 'time' | 'price';
  /** Status */
  status: 'active' | 'completed' | 'cancelled';
  /** Total input amount */
  inAmount: string;
  /** Amount filled */
  filledAmount: string;
  /** Number of orders total */
  numberOfOrders: number;
  /** Number executed */
  ordersExecuted: number;
  /** Interval in seconds */
  interval: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Trigger order from API
 */
export interface TriggerOrder {
  /** Order public key */
  orderKey: string;
  /** Maker wallet */
  maker: string;
  /** Input mint */
  inputMint: string;
  /** Output mint */
  outputMint: string;
  /** Making amount */
  makingAmount: string;
  /** Taking amount */
  takingAmount: string;
  /** Status */
  status: 'open' | 'completed' | 'cancelled' | 'expired';
  /** Expiry timestamp */
  expiredAt?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Filled amount */
  filledMakingAmount?: string;
  /** Received amount */
  filledTakingAmount?: string;
}

// ============================================================================
// Service
// ============================================================================

/**
 * Jupiter Orders Service
 *
 * Provides integration with Jupiter's Recurring and Trigger APIs.
 */
export class JupiterOrdersService {
  private readonly recurringClient: AxiosInstance;
  private readonly triggerClient: AxiosInstance;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = config.jupiter.apiKey || '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    // Recurring API client
    this.recurringClient = axios.create({
      baseURL: 'https://api.jup.ag/recurring/v1',
      headers,
      timeout: 30000,
    });

    // Trigger API client
    this.triggerClient = axios.create({
      baseURL: 'https://api.jup.ag/trigger/v1',
      headers,
      timeout: 30000,
    });

    log.info('JupiterOrdersService initialized');
  }

  // ==========================================================================
  // Recurring Orders (DCA)
  // ==========================================================================

  /**
   * Create a time-based recurring order (DCA)
   */
  async createRecurringOrder(request: CreateRecurringOrderRequest): Promise<CreateRecurringOrderResponse> {
    try {
      log.info(
        {
          user: request.user,
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          numberOfOrders: request.params.time.numberOfOrders,
          interval: request.params.time.interval,
        },
        'Creating recurring order'
      );

      const response = await this.recurringClient.post<CreateRecurringOrderResponse>('/createOrder', request);

      log.info(
        { requestId: response.data.requestId },
        'Recurring order created'
      );

      return response.data;
    } catch (error: unknown) {
      this.handleError(error, 'createRecurringOrder');
      throw error;
    }
  }

  /**
   * Execute a recurring order after signing
   */
  async executeRecurringOrder(request: ExecuteOrderRequest): Promise<ExecuteOrderResponse> {
    try {
      log.info({ requestId: request.requestId }, 'Executing recurring order');

      const response = await this.recurringClient.post<ExecuteOrderResponse>('/execute', request);

      log.info(
        { requestId: request.requestId, signature: response.data.signature },
        'Recurring order executed'
      );

      return response.data;
    } catch (error: unknown) {
      this.handleError(error, 'executeRecurringOrder');
      throw error;
    }
  }

  /**
   * Cancel a recurring order
   */
  async cancelRecurringOrder(request: CancelOrderRequest): Promise<CancelOrderResponse> {
    try {
      log.info({ order: request.order }, 'Cancelling recurring order');

      const response = await this.recurringClient.post<CancelOrderResponse>('/cancelOrder', {
        order: request.order,
        user: request.signer,
      });

      log.info({ order: request.order }, 'Recurring order cancel transaction created');

      return response.data;
    } catch (error: unknown) {
      this.handleError(error, 'cancelRecurringOrder');
      throw error;
    }
  }

  /**
   * Get recurring orders for a user
   */
  async getRecurringOrders(
    user: string,
    status?: 'active' | 'historical'
  ): Promise<RecurringOrder[]> {
    try {
      const params: Record<string, string> = { user };
      if (status) {
        params.status = status;
      }

      const response = await this.recurringClient.get<{ orders: RecurringOrder[] }>(
        '/getRecurringOrders',
        { params }
      );

      return response.data.orders || [];
    } catch (error: unknown) {
      this.handleError(error, 'getRecurringOrders');
      throw error;
    }
  }

  // ==========================================================================
  // Trigger Orders (Limit Orders)
  // ==========================================================================

  /**
   * Create a trigger (limit) order
   */
  async createTriggerOrder(request: CreateTriggerOrderRequest): Promise<CreateTriggerOrderResponse> {
    try {
      log.info(
        {
          maker: request.maker,
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          makingAmount: request.params.makingAmount,
          takingAmount: request.params.takingAmount,
        },
        'Creating trigger order'
      );

      const response = await this.triggerClient.post<CreateTriggerOrderResponse>('/createOrder', {
        ...request,
        computeUnitPrice: request.computeUnitPrice || 'auto',
        wrapAndUnwrapSol: request.wrapAndUnwrapSol ?? true,
      });

      log.info(
        { order: response.data.order, requestId: response.data.requestId },
        'Trigger order created'
      );

      return response.data;
    } catch (error: unknown) {
      this.handleError(error, 'createTriggerOrder');
      throw error;
    }
  }

  /**
   * Execute a trigger order after signing
   */
  async executeTriggerOrder(request: ExecuteOrderRequest): Promise<ExecuteOrderResponse> {
    try {
      log.info({ requestId: request.requestId }, 'Executing trigger order');

      const response = await this.triggerClient.post<ExecuteOrderResponse>('/execute', request);

      log.info(
        { requestId: request.requestId, signature: response.data.signature },
        'Trigger order executed'
      );

      return response.data;
    } catch (error: unknown) {
      this.handleError(error, 'executeTriggerOrder');
      throw error;
    }
  }

  /**
   * Cancel a trigger order
   */
  async cancelTriggerOrder(request: CancelOrderRequest): Promise<CancelOrderResponse> {
    try {
      log.info({ order: request.order }, 'Cancelling trigger order');

      const response = await this.triggerClient.post<CancelOrderResponse>('/cancelOrder', {
        order: request.order,
        maker: request.signer,
      });

      log.info({ order: request.order }, 'Trigger order cancel transaction created');

      return response.data;
    } catch (error: unknown) {
      this.handleError(error, 'cancelTriggerOrder');
      throw error;
    }
  }

  /**
   * Get trigger orders for a user
   */
  async getTriggerOrders(
    maker: string,
    status?: 'open' | 'historical'
  ): Promise<TriggerOrder[]> {
    try {
      const params: Record<string, string> = { maker };
      if (status) {
        params.status = status;
      }

      const response = await this.triggerClient.get<{ orders: TriggerOrder[] }>(
        '/getTriggerOrders',
        { params }
      );

      return response.data.orders || [];
    } catch (error: unknown) {
      this.handleError(error, 'getTriggerOrders');
      throw error;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Calculate the amount per order for DCA
   */
  calculateAmountPerOrder(totalAmount: string, numberOfOrders: number): string {
    const total = BigInt(totalAmount);
    const perOrder = total / BigInt(numberOfOrders);
    return perOrder.toString();
  }

  /**
   * Calculate total duration for DCA
   */
  calculateTotalDuration(numberOfOrders: number, intervalSeconds: number): number {
    return numberOfOrders * intervalSeconds;
  }

  /**
   * Calculate target price for trigger order
   * @param makingAmount - Amount of input token
   * @param takingAmount - Expected amount of output token
   * @param inputDecimals - Decimals of input token
   * @param outputDecimals - Decimals of output token
   * @returns Price as output per input
   */
  calculateTriggerPrice(
    makingAmount: string,
    takingAmount: string,
    inputDecimals: number,
    outputDecimals: number
  ): number {
    const making = Number(makingAmount) / Math.pow(10, inputDecimals);
    const taking = Number(takingAmount) / Math.pow(10, outputDecimals);
    return taking / making;
  }

  /**
   * Handle API errors
   */
  private handleError(error: unknown, operation: string): void {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error || error.response?.data?.cause || error.message;
      const code = error.response?.status || 500;

      log.error(
        {
          operation,
          code,
          message,
          data: error.response?.data,
        },
        `Jupiter API error: ${operation}`
      );

      throw new Error(`Jupiter API error (${code}): ${message}`);
    }

    log.error({ error, operation }, `Unexpected error in ${operation}`);
    throw error;
  }
}

// Singleton instance
let jupiterOrdersService: JupiterOrdersService | null = null;

export function getJupiterOrdersService(): JupiterOrdersService {
  if (!jupiterOrdersService) {
    jupiterOrdersService = new JupiterOrdersService();
  }
  return jupiterOrdersService;
}

export function resetJupiterOrdersService(): void {
  jupiterOrdersService = null;
}
