/**
 * MEV Protection Service
 *
 * Provides MEV-protected transaction submission via various relays:
 * - Jito: Bundle transactions with tips for MEV protection
 * - Direct RPC with priority fees: Fast lane for validators
 *
 * MEV (Maximal Extractable Value) attacks include:
 * - Frontrunning: Attacker sees pending tx, submits before to profit
 * - Sandwich attacks: Buy before user, sell after for guaranteed profit
 * - Backrunning: Profit from price impact after large trades
 */

import axios, { AxiosInstance } from 'axios';
import { Connection, VersionedTransaction, TransactionSignature } from '@solana/web3.js';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'MEVProtection' });

// ============================================================================
// Types
// ============================================================================

/**
 * MEV protection mode
 */
export type MEVProtectionMode = 'jito' | 'priority' | 'none';

/**
 * Jito bundle status
 */
export type JitoBundleStatus =
  | 'pending'
  | 'landed'
  | 'failed'
  | 'dropped'
  | 'invalid';

/**
 * Jito bundle response
 */
export interface JitoBundleResponse {
  /** Bundle ID */
  bundleId: string;
  /** Bundle status */
  status: JitoBundleStatus;
  /** Transaction signatures in the bundle */
  signatures?: string[];
  /** Slot where bundle landed (if landed) */
  slot?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Transaction submission options
 */
export interface MEVSubmitOptions {
  /** Protection mode */
  mode: MEVProtectionMode;
  /** Signed transaction (base64 or buffer) */
  signedTransaction: string | Uint8Array;
  /** Tip amount for Jito (in lamports) */
  tipLamports?: number;
  /** Max retries for submission */
  maxRetries?: number;
  /** Skip preflight checks */
  skipPreflight?: boolean;
  /** Commitment level for confirmation */
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

/**
 * Submission result
 */
export interface MEVSubmitResult {
  /** Transaction signature */
  signature: TransactionSignature;
  /** Whether MEV protection was used */
  protected: boolean;
  /** Protection mode used */
  mode: MEVProtectionMode;
  /** Bundle ID if Jito was used */
  bundleId?: string;
  /** Slot where transaction landed */
  slot?: number;
  /** Confirmation status */
  confirmed: boolean;
  /** Latency in ms */
  latencyMs: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Jito endpoints for different regions */
const JITO_ENDPOINTS = {
  mainnet: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
};

/** Default tip amount (0.001 SOL = 1M lamports) */
const DEFAULT_TIP_LAMPORTS = 1_000_000;

/** Minimum tip for Jito */
const MIN_TIP_LAMPORTS = 10_000;

/** Maximum tip (0.01 SOL) */
const MAX_TIP_LAMPORTS = 10_000_000;

// ============================================================================
// Service
// ============================================================================

/**
 * MEV Protection Service
 *
 * Provides MEV-protected transaction submission to prevent frontrunning
 * and sandwich attacks.
 */
export class MEVProtectionService {
  private readonly connection: Connection;
  private readonly jitoClient: AxiosInstance;
  private readonly jitoEndpoint: string;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

    // Use configured Jito endpoint or default
    this.jitoEndpoint =
      process.env.JITO_ENDPOINT || JITO_ENDPOINTS.mainnet;

    this.jitoClient = axios.create({
      baseURL: this.jitoEndpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    log.info({ jitoEndpoint: this.jitoEndpoint }, 'MEVProtectionService initialized');
  }

  /**
   * Submit a transaction with MEV protection
   */
  async submitTransaction(options: MEVSubmitOptions): Promise<MEVSubmitResult> {
    const startTime = Date.now();

    try {
      switch (options.mode) {
        case 'jito':
          return await this.submitViaJito(options, startTime);
        case 'priority':
          return await this.submitWithPriority(options, startTime);
        case 'none':
        default:
          return await this.submitDirect(options, startTime);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message, mode: options.mode }, 'MEV submission failed');
      throw error;
    }
  }

  /**
   * Submit transaction via Jito bundle
   */
  private async submitViaJito(
    options: MEVSubmitOptions,
    startTime: number
  ): Promise<MEVSubmitResult> {
    const tipLamports = Math.min(
      Math.max(options.tipLamports || DEFAULT_TIP_LAMPORTS, MIN_TIP_LAMPORTS),
      MAX_TIP_LAMPORTS
    );

    log.info({ tipLamports }, 'Submitting via Jito bundle');

    // Deserialize transaction
    const txBuffer =
      typeof options.signedTransaction === 'string'
        ? Buffer.from(options.signedTransaction, 'base64')
        : options.signedTransaction;

    const transaction = VersionedTransaction.deserialize(txBuffer);

    // Get the first signature as our tx signature
    const signature = Buffer.from(transaction.signatures[0]).toString('base64');

    try {
      // Submit bundle to Jito
      const bundleResponse = await this.jitoClient.post('/api/v1/bundles', {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [
          [Buffer.from(txBuffer).toString('base64')],
          {
            encoding: 'base64',
            tipLamports,
          },
        ],
      });

      const bundleId = bundleResponse.data.result;

      if (!bundleId) {
        throw new Error(
          bundleResponse.data.error?.message || 'Failed to submit bundle'
        );
      }

      log.info({ bundleId, signature }, 'Jito bundle submitted');

      // Poll for bundle status
      const bundleStatus = await this.waitForBundleConfirmation(bundleId);

      const latencyMs = Date.now() - startTime;

      if (bundleStatus.status === 'landed') {
        log.info(
          { bundleId, slot: bundleStatus.slot, latencyMs },
          'Jito bundle landed'
        );

        return {
          signature,
          protected: true,
          mode: 'jito',
          bundleId,
          slot: bundleStatus.slot,
          confirmed: true,
          latencyMs,
        };
      }

      // Bundle failed - throw error
      throw new Error(
        `Jito bundle ${bundleStatus.status}: ${bundleStatus.error || 'unknown error'}`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn({ error: message }, 'Jito submission failed, falling back to direct');

      // Fallback to direct submission
      return this.submitDirect(options, startTime);
    }
  }

  /**
   * Wait for Jito bundle confirmation
   */
  private async waitForBundleConfirmation(
    bundleId: string,
    maxWaitMs = 30000,
    pollIntervalMs = 1000
  ): Promise<JitoBundleResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await this.jitoClient.post('/api/v1/bundles', {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        });

        const statuses = response.data.result?.value;

        if (statuses && statuses.length > 0) {
          const status = statuses[0];

          if (status.confirmation_status === 'confirmed') {
            return {
              bundleId,
              status: 'landed',
              slot: status.slot,
            };
          }

          if (status.err) {
            return {
              bundleId,
              status: 'failed',
              error: JSON.stringify(status.err),
            };
          }
        }
      } catch (error: unknown) {
        // Ignore poll errors
      }

      await this.sleep(pollIntervalMs);
    }

    return {
      bundleId,
      status: 'dropped',
      error: 'Bundle status unknown after timeout',
    };
  }

  /**
   * Submit transaction with high priority fee (fast lane)
   */
  private async submitWithPriority(
    options: MEVSubmitOptions,
    startTime: number
  ): Promise<MEVSubmitResult> {
    log.info('Submitting with priority fee');

    const txBuffer =
      typeof options.signedTransaction === 'string'
        ? Buffer.from(options.signedTransaction, 'base64')
        : options.signedTransaction;

    // Send transaction with maxRetries
    const signature = await this.connection.sendRawTransaction(txBuffer, {
      skipPreflight: options.skipPreflight ?? false,
      maxRetries: options.maxRetries ?? 3,
      preflightCommitment: 'confirmed',
    });

    log.info({ signature }, 'Transaction submitted with priority');

    // Confirm transaction
    const confirmation = await this.connection.confirmTransaction(
      {
        signature,
        blockhash: (await this.connection.getLatestBlockhash()).blockhash,
        lastValidBlockHeight: (await this.connection.getLatestBlockhash())
          .lastValidBlockHeight,
      },
      options.commitment || 'confirmed'
    );

    const latencyMs = Date.now() - startTime;

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return {
      signature,
      protected: false,
      mode: 'priority',
      confirmed: true,
      latencyMs,
    };
  }

  /**
   * Submit transaction directly without MEV protection
   */
  private async submitDirect(
    options: MEVSubmitOptions,
    startTime: number
  ): Promise<MEVSubmitResult> {
    log.info('Submitting directly (no MEV protection)');

    const txBuffer =
      typeof options.signedTransaction === 'string'
        ? Buffer.from(options.signedTransaction, 'base64')
        : options.signedTransaction;

    const signature = await this.connection.sendRawTransaction(txBuffer, {
      skipPreflight: options.skipPreflight ?? false,
      maxRetries: options.maxRetries ?? 5,
    });

    log.info({ signature }, 'Transaction submitted directly');

    // Confirm transaction
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const confirmation = await this.connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      options.commitment || 'confirmed'
    );

    const latencyMs = Date.now() - startTime;

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return {
      signature,
      protected: false,
      mode: 'none',
      confirmed: true,
      latencyMs,
    };
  }

  /**
   * Get recommended tip based on network conditions
   */
  async getRecommendedTip(): Promise<{
    low: number;
    medium: number;
    high: number;
  }> {
    try {
      // Query Jito for tip floor
      const response = await this.jitoClient.get('/api/v1/bundles/tip_floor');

      const tipFloor = response.data.lamports || MIN_TIP_LAMPORTS;

      return {
        low: tipFloor,
        medium: tipFloor * 2,
        high: tipFloor * 5,
      };
    } catch (error: unknown) {
      // Return defaults if Jito unavailable
      return {
        low: MIN_TIP_LAMPORTS,
        medium: DEFAULT_TIP_LAMPORTS,
        high: MAX_TIP_LAMPORTS,
      };
    }
  }

  /**
   * Check if MEV protection is available
   */
  async isJitoAvailable(): Promise<boolean> {
    try {
      await this.jitoClient.get('/api/v1/bundles/tip_floor');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Jito endpoints for different regions
   */
  getAvailableEndpoints(): Record<string, string> {
    return { ...JITO_ENDPOINTS };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let mevProtectionService: MEVProtectionService | null = null;

export function getMEVProtectionService(): MEVProtectionService {
  if (!mevProtectionService) {
    mevProtectionService = new MEVProtectionService();
  }
  return mevProtectionService;
}

export function resetMEVProtectionService(): void {
  mevProtectionService = null;
}
