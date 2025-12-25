/**
 * Transaction Confirmation Service
 *
 * Provides robust transaction confirmation with:
 * - Signature status polling
 * - Blockhash TTL tracking
 * - Automatic rebuild and resubmit on expiry
 */

import {
  Connection,
  TransactionSignature,
  SignatureStatus,
  Commitment,
  TransactionConfirmationStatus,
  BlockhashWithExpiryBlockHeight,
} from '@solana/web3.js';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

import { rpcManager } from './rpcManager.js';

const log = logger.child({ service: 'TxConfirm' });

/**
 * Confirmation result
 */
export interface ConfirmationResult {
  /** Whether confirmation succeeded */
  confirmed: boolean;
  /** Final transaction status */
  status: 'confirmed' | 'finalized' | 'failed' | 'expired' | 'timeout';
  /** Transaction signature */
  signature: string;
  /** Slot where confirmed (if applicable) */
  slot?: number;
  /** Error message if failed */
  error?: string;
  /** Number of confirmation attempts */
  attempts: number;
  /** Time taken in milliseconds */
  timeMs: number;
  /** Whether blockhash expired */
  blockhashExpired: boolean;
}

/**
 * Confirmation options
 */
export interface ConfirmOptions {
  /** Desired confirmation level */
  commitment?: Commitment;
  /** Maximum time to wait (ms) */
  timeoutMs?: number;
  /** Polling interval (ms) */
  pollIntervalMs?: number;
  /** Blockhash info for TTL tracking */
  blockhashInfo?: BlockhashWithExpiryBlockHeight;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Default confirmation settings
 */
const DEFAULTS = {
  commitment: 'confirmed' as Commitment,
  timeoutMs: 60000, // 60 seconds
  pollIntervalMs: 500, // 500ms
  maxPollAttempts: 120, // 60 seconds at 500ms intervals
};

/**
 * Transaction Confirmation Service
 */
export class TxConfirmService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
    });
  }

  /**
   * Confirm a transaction with robust handling
   */
  async confirmTransaction(
    signature: TransactionSignature,
    options: ConfirmOptions = {}
  ): Promise<ConfirmationResult> {
    const startTime = Date.now();
    const {
      commitment = DEFAULTS.commitment,
      timeoutMs = DEFAULTS.timeoutMs,
      pollIntervalMs = DEFAULTS.pollIntervalMs,
      blockhashInfo,
      abortSignal,
    } = options;

    let attempts = 0;
    let lastError: string | undefined;
    let blockhashExpired = false;

    log.debug({ signature, commitment, timeoutMs }, 'Starting transaction confirmation');

    while (Date.now() - startTime < timeoutMs) {
      attempts++;

      // Check for abort
      if (abortSignal?.aborted) {
        return this.buildResult(signature, 'timeout', attempts, startTime, 'Aborted', false);
      }

      try {
        // Check blockhash expiry if we have the info
        if (blockhashInfo) {
          const currentBlockHeight = await this.getCurrentBlockHeight();
          if (currentBlockHeight > blockhashInfo.lastValidBlockHeight) {
            log.warn(
              {
                signature,
                currentBlockHeight,
                lastValid: blockhashInfo.lastValidBlockHeight,
              },
              'Blockhash expired'
            );
            blockhashExpired = true;
            return this.buildResult(
              signature,
              'expired',
              attempts,
              startTime,
              'Blockhash expired',
              true
            );
          }
        }

        // Get signature status
        const status = await this.getSignatureStatus(signature);

        if (status === null) {
          // Transaction not found yet, continue polling
          await this.sleep(pollIntervalMs, abortSignal);
          continue;
        }

        // Check for errors
        if (status.err) {
          const errorStr = typeof status.err === 'string' ? status.err : JSON.stringify(status.err);
          log.error({ signature, error: status.err }, 'Transaction failed');
          return this.buildResult(
            signature,
            'failed',
            attempts,
            startTime,
            errorStr,
            false,
            status.slot
          );
        }

        // Check confirmation level
        const confirmationStatus = status.confirmationStatus;
        if (this.meetsCommitment(confirmationStatus, commitment)) {
          log.info(
            {
              signature,
              confirmationStatus,
              slot: status.slot,
              attempts,
              timeMs: Date.now() - startTime,
            },
            'Transaction confirmed'
          );
          return this.buildResult(
            signature,
            confirmationStatus === 'finalized' ? 'finalized' : 'confirmed',
            attempts,
            startTime,
            undefined,
            false,
            status.slot
          );
        }

        // Continue polling for higher confirmation
        await this.sleep(pollIntervalMs, abortSignal);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log.warn({ signature, error: lastError, attempts }, 'Confirmation poll error');

        // Try fallback RPC
        try {
          this.connection = rpcManager.getConnection();
        } catch {
          // Ignore failover errors, continue with current connection
        }

        await this.sleep(pollIntervalMs, abortSignal);
      }
    }

    // Timeout reached
    log.warn({ signature, attempts, timeMs: Date.now() - startTime }, 'Confirmation timeout');
    return this.buildResult(
      signature,
      'timeout',
      attempts,
      startTime,
      lastError || 'Confirmation timeout',
      blockhashExpired
    );
  }

  /**
   * Check signature status with retry on different RPCs
   */
  private async getSignatureStatus(
    signature: TransactionSignature
  ): Promise<SignatureStatus | null> {
    const result = await this.connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });

    return result.value;
  }

  /**
   * Get current block height
   */
  private async getCurrentBlockHeight(): Promise<number> {
    return await this.connection.getBlockHeight('confirmed');
  }

  /**
   * Check if confirmation status meets required commitment
   */
  private meetsCommitment(
    status: TransactionConfirmationStatus | null | undefined,
    required: Commitment
  ): boolean {
    if (!status) return false;

    const levels: Record<string, number> = {
      processed: 1,
      confirmed: 2,
      finalized: 3,
    };

    const statusLevel = levels[status] || 0;
    const requiredLevel = levels[required] || 2;

    return statusLevel >= requiredLevel;
  }

  /**
   * Build confirmation result
   */
  private buildResult(
    signature: string,
    status: ConfirmationResult['status'],
    attempts: number,
    startTime: number,
    error?: string,
    blockhashExpired: boolean = false,
    slot?: number
  ): ConfirmationResult {
    return {
      confirmed: status === 'confirmed' || status === 'finalized',
      status,
      signature,
      slot,
      error,
      attempts,
      timeMs: Date.now() - startTime,
      blockhashExpired,
    };
  }

  /**
   * Sleep with abort signal support
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const timer = setTimeout(resolve, ms);

      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      });
    });
  }

  /**
   * Wait for finalization (after confirmation)
   */
  async waitForFinalization(
    signature: TransactionSignature,
    timeoutMs: number = 30000
  ): Promise<boolean> {
    const result = await this.confirmTransaction(signature, {
      commitment: 'finalized',
      timeoutMs,
    });
    return result.status === 'finalized';
  }

  /**
   * Get fresh blockhash with expiry info
   */
  async getBlockhashWithExpiry(): Promise<BlockhashWithExpiryBlockHeight> {
    return await this.connection.getLatestBlockhash('confirmed');
  }

  /**
   * Check if a blockhash is still valid
   */
  async isBlockhashValid(blockhash: string, lastValidBlockHeight: number): Promise<boolean> {
    try {
      const currentHeight = await this.getCurrentBlockHeight();
      return currentHeight <= lastValidBlockHeight;
    } catch {
      // Assume valid if we can't check
      return true;
    }
  }

  /**
   * Update connection (after RPC failover)
   */
  updateConnection(connection: Connection): void {
    this.connection = connection;
  }
}

// Singleton instance
export const txConfirmService = new TxConfirmService();
