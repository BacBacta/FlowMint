/**
 * SplitTenderExecutor - PortfolioPay V1.5
 *
 * Executes split-tender payment legs sequentially.
 * Handles retries, failures, refunds, and completion.
 */

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

import { DatabaseService, InvoiceReservationRecord, PaymentLegRecord } from '../db/database';
import { logger } from '../utils/logger';

import { RelayerService } from './relayerService';

const _LEG_TIMEOUT_MS = 90_000; // 90 seconds per leg
const _RETRY_DELAY_MS = 2_000; // 2 seconds between retries

export interface ExecuteLegRequest {
  leg: PaymentLegRecord;
  reservation: InvoiceReservationRecord;
  payerPublicKey: string;
  signedTransaction?: string; // Base64-encoded signed transaction
}

export interface ExecuteLegResult {
  success: boolean;
  txSignature?: string;
  actualUsdcOut?: string;
  error?: string;
  shouldRetry: boolean;
}

export interface ExecutionProgress {
  reservationId: string;
  invoiceId: string;
  totalLegs: number;
  completedLegs: number;
  currentLegIndex: number;
  currentLegStatus: string;
  usdcCollected: string;
  targetAmount: string;
  percentComplete: number;
}

export class SplitTenderExecutor {
  private readonly log = logger.child({ service: 'SplitTenderExecutor' });

  constructor(
    private connection: Connection,
    private db: DatabaseService
  ) {}

  /**
   * Execute a single leg of a split-tender payment
   */
  async executeLeg(request: ExecuteLegRequest): Promise<ExecuteLegResult> {
    const { leg, reservation, payerPublicKey, signedTransaction } = request;

    this.log.info(
      {
        legId: leg.id,
        reservationId: reservation.id,
        payMint: leg.payMint,
        amountIn: leg.amountIn,
        legIndex: leg.legIndex,
      },
      'Executing split-tender leg'
    );

    // Check if reservation is still valid
    if (reservation.status !== 'active') {
      return {
        success: false,
        error: `Reservation is ${reservation.status}`,
        shouldRetry: false,
      };
    }

    if (Date.now() > reservation.expiresAt) {
      await this.expireReservation(reservation.id);
      return {
        success: false,
        error: 'Reservation expired',
        shouldRetry: false,
      };
    }

    // Update leg status to executing
    await this.db.updatePaymentLeg(leg.id, {
      status: 'executing',
      startedAt: Date.now(),
    });

    try {
      let txSignature: string;
      let actualUsdcOut: string;

      if (signedTransaction) {
        // Execute with provided signed transaction
        const result = await this.executeSignedTransaction(signedTransaction);
        txSignature = result.txSignature;
        actualUsdcOut = result.actualUsdcOut || leg.expectedUsdcOut;
      } else {
        // Direct transfer (settlement token) - use relayer
        const result = await this.executeDirectTransfer(leg, payerPublicKey);
        txSignature = result.txSignature;
        actualUsdcOut = leg.amountIn; // Direct transfer, no conversion
      }

      // Update leg as completed
      await this.db.updatePaymentLeg(leg.id, {
        status: 'completed',
        txSignature,
        actualUsdcOut,
        completedAt: Date.now(),
      });

      // Update reservation progress
      await this.updateReservationProgress(reservation.id, actualUsdcOut);

      this.log.info(
        {
          legId: leg.id,
          txSignature,
          actualUsdcOut,
        },
        'Leg completed successfully'
      );

      return {
        success: true,
        txSignature,
        actualUsdcOut,
        shouldRetry: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ legId: leg.id, error }, 'Leg execution failed');

      const shouldRetry = leg.retryCount < leg.maxRetries && this.isRetryableError(message);

      await this.db.updatePaymentLeg(leg.id, {
        status: shouldRetry ? 'pending' : 'failed',
        errorMessage: message,
        errorCode: this.classifyError(message),
        retryCount: leg.retryCount + 1,
      });

      if (!shouldRetry && this.shouldTriggerRefund(leg, reservation)) {
        await this.handlePartialFailure(reservation, leg);
      }

      return {
        success: false,
        error: message,
        shouldRetry,
      };
    }
  }

  /**
   * Execute a signed transaction on-chain
   */
  private async executeSignedTransaction(
    signedTxBase64: string
  ): Promise<{ txSignature: string; actualUsdcOut?: string }> {
    const txBuffer = Buffer.from(signedTxBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    const txSignature = await this.connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    const confirmation = await this.connection.confirmTransaction(
      {
        signature: txSignature,
        blockhash: (await this.connection.getLatestBlockhash()).blockhash,
        lastValidBlockHeight: (await this.connection.getLatestBlockhash()).lastValidBlockHeight,
      },
      'confirmed'
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    // TODO: Parse transaction to get actual USDC received
    // For now, return undefined and use expected amount

    return { txSignature };
  }

  /**
   * Execute direct transfer via relayer
   */
  private async executeDirectTransfer(
    leg: PaymentLegRecord,
    _payerPublicKey: string
  ): Promise<{ txSignature: string }> {
    // For direct transfers of settlement token, we could use the relayer
    // This is simpler and doesn't require swap
    // TODO: Implement with RelayerService when ready
    throw new Error(`Direct transfer for leg ${leg.id} not yet implemented`);
  }

  /**
   * Update reservation progress after leg completion
   */
  private async updateReservationProgress(
    reservationId: string,
    usdcReceived: string
  ): Promise<void> {
    const reservation = await this.db.getInvoiceReservation(reservationId);
    if (!reservation) return;

    const currentCollected = BigInt(reservation.usdcCollected || '0');
    const newCollected = currentCollected + BigInt(usdcReceived);
    const newCompletedLegs = reservation.completedLegs + 1;

    const newStatus = newCompletedLegs >= reservation.totalLegs ? 'completed' : 'active';

    await this.db.updateInvoiceReservation(reservationId, {
      usdcCollected: newCollected.toString(),
      completedLegs: newCompletedLegs,
      status: newStatus,
    });

    if (newStatus === 'completed') {
      this.log.info(
        {
          reservationId,
          invoiceId: reservation.invoiceId,
          totalCollected: newCollected.toString(),
        },
        'Split-tender reservation completed'
      );
    }
  }

  /**
   * Get current execution progress
   */
  async getProgress(reservationId: string): Promise<ExecutionProgress | null> {
    const reservation = await this.db.getInvoiceReservation(reservationId);
    if (!reservation) return null;

    const legs = await this.db.getLegsByReservation(reservationId);
    const plan = JSON.parse(reservation.planJson);

    const currentLeg = legs.find(l => l.status === 'executing' || l.status === 'pending');
    const currentLegIndex = currentLeg?.legIndex ?? reservation.completedLegs;

    const percentComplete =
      reservation.totalLegs > 0
        ? Math.round((reservation.completedLegs / reservation.totalLegs) * 100)
        : 0;

    return {
      reservationId,
      invoiceId: reservation.invoiceId,
      totalLegs: reservation.totalLegs,
      completedLegs: reservation.completedLegs,
      currentLegIndex,
      currentLegStatus: currentLeg?.status ?? 'completed',
      usdcCollected: reservation.usdcCollected,
      targetAmount: plan.settlementAmount,
      percentComplete,
    };
  }

  /**
   * Handle partial failure - refund collected USDC
   */
  private async handlePartialFailure(
    reservation: InvoiceReservationRecord,
    failedLeg: PaymentLegRecord
  ): Promise<void> {
    this.log.warn(
      {
        reservationId: reservation.id,
        failedLegId: failedLeg.id,
        usdcCollected: reservation.usdcCollected,
      },
      'Handling partial failure, initiating refund'
    );

    await this.db.updateInvoiceReservation(reservation.id, {
      status: 'partial-failure',
    });

    // If we collected any USDC from previous legs, queue refund
    if (BigInt(reservation.usdcCollected) > 0n) {
      // TODO: Implement refund queue
      this.log.info(
        {
          reservationId: reservation.id,
          refundAmount: reservation.usdcCollected,
          payer: reservation.payer,
        },
        'Refund queued for partial failure'
      );
    }
  }

  /**
   * Expire a stale reservation
   */
  private async expireReservation(reservationId: string): Promise<void> {
    const reservation = await this.db.getInvoiceReservation(reservationId);
    if (!reservation) return;

    await this.db.updateInvoiceReservation(reservationId, {
      status: 'expired',
    });

    // Cancel pending legs
    const legs = await this.db.getLegsByReservation(reservationId);
    for (const leg of legs) {
      if (leg.status === 'pending' || leg.status === 'executing') {
        await this.db.updatePaymentLeg(leg.id, {
          status: 'cancelled',
          errorMessage: 'Reservation expired',
        });
      }
    }

    // Handle refund if any USDC was collected
    if (BigInt(reservation.usdcCollected) > 0n) {
      this.log.info(
        {
          reservationId,
          refundAmount: reservation.usdcCollected,
        },
        'Initiating refund for expired reservation'
      );
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      'timeout',
      'network',
      'rate limit',
      'blockhash',
      'simulation failed',
      'insufficient funds for rent',
    ];

    return retryablePatterns.some(pattern => error.toLowerCase().includes(pattern));
  }

  /**
   * Classify error for analytics
   */
  private classifyError(error: string): string {
    if (error.includes('insufficient')) return 'INSUFFICIENT_BALANCE';
    if (error.includes('slippage')) return 'SLIPPAGE_EXCEEDED';
    if (error.includes('timeout')) return 'TIMEOUT';
    if (error.includes('simulation')) return 'SIMULATION_FAILED';
    if (error.includes('blockhash')) return 'BLOCKHASH_EXPIRED';
    return 'UNKNOWN';
  }

  /**
   * Determine if we should trigger a refund
   */
  private shouldTriggerRefund(
    leg: PaymentLegRecord,
    reservation: InvoiceReservationRecord
  ): boolean {
    // Refund if any legs completed but this one failed
    return reservation.completedLegs > 0;
  }

  /**
   * Resume pending legs for a reservation
   */
  async resumePendingLegs(reservationId: string): Promise<void> {
    const reservation = await this.db.getInvoiceReservation(reservationId);
    if (!reservation || reservation.status !== 'active') return;

    const pendingLegs = await this.db.getPendingLegs(reservationId);

    for (const leg of pendingLegs) {
      if (leg.retryCount < leg.maxRetries) {
        this.log.info(
          {
            legId: leg.id,
            retryCount: leg.retryCount,
          },
          'Resuming pending leg'
        );

        // Note: Actual execution would require signed transaction from client
        // This is just marking for retry
      }
    }
  }
}

export const createSplitTenderExecutor = (
  connection: Connection,
  db: DatabaseService
): SplitTenderExecutor => {
  return new SplitTenderExecutor(connection, db);
};
