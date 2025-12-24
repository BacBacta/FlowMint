/**
 * Receipt Service
 *
 * Manages execution receipts with detailed tracking of:
 * - Request parameters
 * - Quote information
 * - Execution attempts
 * - Final outcome (expected vs actual)
 */

import { v4 as uuidv4 } from 'uuid';

import { logger } from '../utils/logger.js';
import { DatabaseService, ReceiptRecord, ExecutionEventType } from '../db/database.js';
import { RiskSignal, RiskReason } from './riskScoring.js';
import { RetryMetrics } from './retryPolicy.js';

const log = logger.child({ service: 'ReceiptService' });

/**
 * Execution profile used
 */
export type ExecutionProfile = 'AUTO' | 'FAST' | 'CHEAP';

/**
 * Execution attempt record
 */
export interface ExecutionAttempt {
  attemptNumber: number;
  timestamp: number;
  rpcUsed: string;
  signature?: string;
  status: 'pending' | 'sent' | 'confirmed' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  latencyMs: number;
}

/**
 * Receipt request info
 */
export interface ReceiptRequest {
  inputMint: string;
  outputMint: string;
  amountIn: string;
  slippageBps: number;
  mode: 'standard' | 'protected';
  profile: ExecutionProfile;
  userPublicKey: string;
}

/**
 * Receipt quote info
 */
export interface ReceiptQuote {
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: string;
  routeSteps: number;
  routeDescription?: string;
  quoteTimestamp: number;
  expiresAt?: number;
}

/**
 * Receipt execution info
 */
export interface ReceiptExecution {
  signature?: string;
  slot?: number;
  status: 'pending' | 'building' | 'sending' | 'confirming' | 'confirmed' | 'failed';
  attempts: ExecutionAttempt[];
  rpcUsed: string[];
  computeUnits?: number;
  priorityFee?: number;
  startedAt: number;
  confirmedAt?: number;
  totalTimeMs?: number;
}

/**
 * Receipt result info
 */
export interface ReceiptResult {
  outAmountActual?: string;
  balanceChanges?: {
    input: { before: string; after: string; change: string };
    output: { before: string; after: string; change: string };
  };
}

/**
 * Receipt diff analysis
 */
export interface ReceiptDiff {
  quotedOutAmount: string;
  actualOutAmount?: string;
  deltaAmount?: string;
  deltaPct?: string;
  slippageUsed?: string;
  reason?: string;
}

/**
 * Risk assessment summary
 */
export interface ReceiptRisk {
  level: RiskSignal;
  reasons: RiskReason[];
  blockedInProtectedMode: boolean;
}

/**
 * Full receipt record (in-memory representation)
 */
export interface Receipt {
  receiptId: string;
  request: ReceiptRequest;
  quote: ReceiptQuote;
  execution: ReceiptExecution;
  result: ReceiptResult;
  diff: ReceiptDiff;
  risk: ReceiptRisk;
  createdAt: number;
  updatedAt: number;
}

/**
 * Pending receipt (before full execution)
 */
export interface PendingReceipt {
  receiptId: string;
  request: ReceiptRequest;
  quote: ReceiptQuote;
  risk: ReceiptRisk;
  createdAt: number;
}

/**
 * In-memory execution state storage
 * (Extended data that doesn't fit in the simple ReceiptRecord)
 */
const executionState = new Map<
  string,
  {
    execution: Partial<ReceiptExecution>;
    result: ReceiptResult;
    diff: ReceiptDiff;
    risk: ReceiptRisk;
    request: ReceiptRequest;
    quote: ReceiptQuote;
  }
>();

/**
 * Receipt Service class
 */
export class ReceiptService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Log an execution event to the persistent timeline
   */
  async logEvent(
    receiptId: string,
    eventType: ExecutionEventType,
    details: {
      rpcEndpoint?: string;
      priorityFee?: number;
      slippageBps?: number;
      signature?: string;
      status?: string;
      errorCode?: string;
      errorMessage?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    try {
      await this.db.saveExecutionEvent({
        receiptId,
        eventType,
        timestamp: Date.now(),
        ...details,
      });
    } catch (err) {
      log.warn({ receiptId, eventType, err }, 'Failed to log execution event');
    }
  }

  /**
   * Get the timeline of execution events for a receipt
   */
  async getTimeline(receiptId: string) {
    return this.db.getExecutionEvents(receiptId);
  }

  /**
   * Create a pending receipt
   */
  async createPendingReceipt(
    request: ReceiptRequest,
    quote: ReceiptQuote,
    risk: ReceiptRisk
  ): Promise<PendingReceipt> {
    const receiptId = uuidv4();
    const createdAt = Date.now();

    const pending: PendingReceipt = {
      receiptId,
      request,
      quote,
      risk,
      createdAt,
    };

    // Store in database (basic fields)
    await this.db.saveReceipt({
      receiptId,
      userPublicKey: request.userPublicKey,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inAmount: request.amountIn,
      outAmount: quote.outAmount,
      slippageBps: request.slippageBps,
      protectedMode: request.mode === 'protected',
      priceImpactPct: quote.priceImpactPct,
      status: 'pending',
      timestamp: createdAt,
    });

    // Store extended state in memory
    executionState.set(receiptId, {
      execution: {
        status: 'pending',
        attempts: [],
        rpcUsed: [],
        startedAt: createdAt,
      },
      result: {},
      diff: { quotedOutAmount: quote.outAmount },
      risk,
      request,
      quote,
    });

    log.info({ receiptId, userPublicKey: request.userPublicKey }, 'Pending receipt created');

    return pending;
  }

  /**
   * Update receipt with execution progress
   */
  async updateExecutionStatus(
    receiptId: string,
    status: ReceiptExecution['status'],
    attempt?: ExecutionAttempt
  ): Promise<void> {
    // Get or create execution state
    let state = executionState.get(receiptId);
    if (!state) {
      // Try to load from DB and create state
      const dbRecord = await this.db.getReceipt(receiptId);
      if (!dbRecord) {
        log.warn({ receiptId }, 'Receipt not found for update');
        return;
      }
      state = {
        execution: { status: 'pending', attempts: [], rpcUsed: [], startedAt: dbRecord.timestamp },
        result: {},
        diff: { quotedOutAmount: dbRecord.outAmount },
        risk: { level: RiskSignal.GREEN, reasons: [], blockedInProtectedMode: false },
        request: {
          inputMint: dbRecord.inputMint,
          outputMint: dbRecord.outputMint,
          amountIn: dbRecord.inAmount,
          slippageBps: dbRecord.slippageBps,
          mode: dbRecord.protectedMode ? 'protected' : 'standard',
          profile: 'AUTO',
          userPublicKey: dbRecord.userPublicKey,
        },
        quote: {
          outAmount: dbRecord.outAmount,
          minOutAmount: dbRecord.outAmount,
          priceImpactPct: dbRecord.priceImpactPct,
          routeSteps: 1,
          quoteTimestamp: dbRecord.timestamp,
        },
      };
      executionState.set(receiptId, state);
    }

    // Update execution data
    state.execution.status = status;
    if (attempt) {
      if (!state.execution.attempts) {
        state.execution.attempts = [];
      }
      state.execution.attempts.push(attempt);
      if (!state.execution.rpcUsed) {
        state.execution.rpcUsed = [];
      }
      if (!state.execution.rpcUsed.includes(attempt.rpcUsed)) {
        state.execution.rpcUsed.push(attempt.rpcUsed);
      }
    }

    log.debug({ receiptId, status }, 'Receipt execution updated');
  }

  /**
   * Finalize receipt with outcome
   */
  async finalizeReceipt(
    receiptId: string,
    signature: string,
    outcome: {
      slot?: number;
      outAmountActual?: string;
      computeUnits?: number;
      priorityFee?: number;
    },
    _retryMetrics?: RetryMetrics
  ): Promise<Receipt | null> {
    const existing = await this.db.getReceipt(receiptId);
    if (!existing) {
      log.warn({ receiptId }, 'Receipt not found for finalization');
      return null;
    }

    // Get execution state
    const state = executionState.get(receiptId);

    // Calculate diff
    const quotedOut = existing.outAmount;
    const actualOut = outcome.outAmountActual;
    let deltaAmount: string | undefined;
    let deltaPct: string | undefined;

    if (actualOut && quotedOut) {
      const quoted = BigInt(quotedOut);
      const actual = BigInt(actualOut);
      const delta = actual - quoted;
      deltaAmount = delta.toString();
      deltaPct = ((Number(delta) / Number(quoted)) * 100).toFixed(4);
    }

    // Update in database
    await this.db.updateReceiptStatus(receiptId, 'success', signature);

    // Update state
    if (state) {
      state.execution = {
        ...state.execution,
        signature,
        slot: outcome.slot,
        status: 'confirmed',
        computeUnits: outcome.computeUnits,
        priorityFee: outcome.priorityFee,
        confirmedAt: Date.now(),
        totalTimeMs: Date.now() - (state.execution.startedAt || Date.now()),
      };
      state.result = { outAmountActual: outcome.outAmountActual };
      state.diff = {
        quotedOutAmount: quotedOut,
        actualOutAmount: outcome.outAmountActual,
        deltaAmount,
        deltaPct,
      };
    }

    log.info(
      {
        receiptId,
        signature,
        deltaPct,
        totalTimeMs: state?.execution.totalTimeMs,
      },
      'Receipt finalized'
    );

    return this.getReceipt(receiptId);
  }

  /**
   * Mark receipt as failed
   */
  async failReceipt(
    receiptId: string,
    error: string,
    _retryMetrics?: RetryMetrics
  ): Promise<void> {
    const existing = await this.db.getReceipt(receiptId);
    if (!existing) {
      log.warn({ receiptId }, 'Receipt not found for failure');
      return;
    }

    await this.db.updateReceiptStatus(receiptId, 'failed', undefined, error);

    // Update state
    const state = executionState.get(receiptId);
    if (state) {
      state.execution.status = 'failed';
      state.diff.reason = error;
    }

    log.info({ receiptId, error }, 'Receipt marked as failed');
  }

  /**
   * Get a receipt by ID
   */
  async getReceipt(receiptId: string): Promise<Receipt | null> {
    const row = await this.db.getReceipt(receiptId);
    if (!row) return null;

    return this.rowToReceipt(row);
  }

  /**
   * Get receipts for a user
   */
  async getUserReceipts(userPublicKey: string, limit: number = 50): Promise<Receipt[]> {
    const rows = await this.db.getUserReceipts(userPublicKey, limit);
    return rows.map((row) => this.rowToReceipt(row));
  }

  /**
   * Convert database row to Receipt object
   */
  private rowToReceipt(row: ReceiptRecord): Receipt {
    // Get in-memory state if available
    const state = executionState.get(row.receiptId);

    const execution: ReceiptExecution = state?.execution
      ? {
          signature: row.txSignature,
          slot: state.execution.slot,
          status: state.execution.status || this.dbStatusToExecutionStatus(row.status),
          attempts: state.execution.attempts || [],
          rpcUsed: state.execution.rpcUsed || [],
          computeUnits: state.execution.computeUnits,
          priorityFee: state.execution.priorityFee,
          startedAt: state.execution.startedAt || row.timestamp,
          confirmedAt: state.execution.confirmedAt,
          totalTimeMs: state.execution.totalTimeMs,
        }
      : {
          signature: row.txSignature,
          status: this.dbStatusToExecutionStatus(row.status),
          attempts: [],
          rpcUsed: [],
          startedAt: row.timestamp,
        };

    const request: ReceiptRequest = state?.request || {
      inputMint: row.inputMint,
      outputMint: row.outputMint,
      amountIn: row.inAmount,
      slippageBps: row.slippageBps,
      mode: row.protectedMode ? 'protected' : 'standard',
      profile: 'AUTO',
      userPublicKey: row.userPublicKey,
    };

    const quote: ReceiptQuote = state?.quote || {
      outAmount: row.outAmount,
      minOutAmount: row.outAmount,
      priceImpactPct: row.priceImpactPct,
      routeSteps: 1,
      quoteTimestamp: row.timestamp,
    };

    return {
      receiptId: row.receiptId,
      request,
      quote,
      execution,
      result: state?.result || {},
      diff: state?.diff || { quotedOutAmount: row.outAmount },
      risk: state?.risk || {
        level: RiskSignal.GREEN,
        reasons: [],
        blockedInProtectedMode: false,
      },
      createdAt: row.timestamp,
      updatedAt: row.timestamp,
    };
  }

  /**
   * Map DB status to execution status
   */
  private dbStatusToExecutionStatus(dbStatus: string): ReceiptExecution['status'] {
    switch (dbStatus) {
      case 'success':
        return 'confirmed';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  }

  /**
   * Clear in-memory state for a receipt (cleanup)
   */
  clearState(receiptId: string): void {
    executionState.delete(receiptId);
  }

  /**
   * Clear all in-memory state (e.g., on shutdown)
   */
  clearAllState(): void {
    executionState.clear();
  }

  /**
   * Create a receipt (convenience method for ExecutionEngine integration)
   * Returns an EnhancedReceipt with full tracking capabilities
   */
  async createReceipt(
    request: ReceiptRequest,
    quote: ReceiptQuote,
    riskAssessment: { level: RiskSignal; reasons: RiskReason[]; blockedInProtectedMode: boolean }
  ): Promise<EnhancedReceipt> {
    const pending = await this.createPendingReceipt(request, quote, riskAssessment);

    return {
      id: pending.receiptId,
      receiptId: pending.receiptId,
      request: pending.request,
      quote: pending.quote,
      risk: pending.risk,
      status: 'pending',
      createdAt: pending.createdAt,
    };
  }
}

/**
 * Enhanced receipt for production tracking
 */
export interface EnhancedReceipt {
  id: string;
  receiptId: string;
  request: ReceiptRequest;
  quote: ReceiptQuote;
  risk: ReceiptRisk;
  status: 'pending' | 'building' | 'sending' | 'confirming' | 'confirmed' | 'failed';
  createdAt: number;
  confirmedAt?: number;
  signature?: string;
  actualOutput?: string;
  comparison?: {
    quotedAmount: string;
    actualAmount: string;
    deltaAmount: string;
    deltaPct: string;
  };
}
