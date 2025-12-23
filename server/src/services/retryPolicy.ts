/**
 * Retry Policy Service
 *
 * Classifies errors and determines retry strategy for swap execution.
 * Handles transient, requote, and fatal errors differently.
 */

import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'RetryPolicy' });

/**
 * Error classification for retry decisions
 */
export enum ErrorCategory {
  /** Transient errors - retry with same transaction */
  TRANSIENT = 'TRANSIENT',
  /** Requote needed - get new quote and retry */
  REQUOTE = 'REQUOTE',
  /** Fatal errors - do not retry */
  FATAL = 'FATAL',
}

/**
 * Classified error with category and metadata
 */
export interface ClassifiedError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  requiresRequote: boolean;
  suggestedDelayMs: number;
  originalError: Error;
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  maxRetries: number;
  maxRequotes: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
}

/**
 * Execution profile strategies
 */
export const EXECUTION_PROFILES: Record<string, RetryStrategy> = {
  AUTO: {
    maxRetries: 5,
    maxRequotes: 2,
    initialDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitterMs: 200,
  },
  FAST: {
    maxRetries: 2,
    maxRequotes: 1,
    initialDelayMs: 100,
    maxDelayMs: 2000,
    backoffMultiplier: 1.5,
    jitterMs: 50,
  },
  CHEAP: {
    maxRetries: 3,
    maxRequotes: 1,
    initialDelayMs: 1000,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    jitterMs: 500,
  },
};

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS = {
  // Transient errors - retry same tx
  TRANSIENT: [
    { pattern: /blockhash not found/i, code: 'BLOCKHASH_NOT_FOUND', delay: 500 },
    { pattern: /blockhash.*expired/i, code: 'BLOCKHASH_EXPIRED', delay: 0 }, // Requires rebuild
    { pattern: /node is behind/i, code: 'NODE_BEHIND', delay: 1000 },
    { pattern: /connection refused/i, code: 'CONNECTION_REFUSED', delay: 2000 },
    { pattern: /timeout/i, code: 'TIMEOUT', delay: 1000 },
    { pattern: /ECONNRESET/i, code: 'ECONNRESET', delay: 1000 },
    { pattern: /ETIMEDOUT/i, code: 'ETIMEDOUT', delay: 2000 },
    { pattern: /429|rate limit/i, code: 'RATE_LIMITED', delay: 5000 },
    { pattern: /503|service unavailable/i, code: 'SERVICE_UNAVAILABLE', delay: 3000 },
    { pattern: /504|gateway timeout/i, code: 'GATEWAY_TIMEOUT', delay: 2000 },
    { pattern: /transaction.*dropped/i, code: 'TX_DROPPED', delay: 500 },
    { pattern: /preflight.*failed.*retry/i, code: 'PREFLIGHT_RETRY', delay: 500 },
    { pattern: /slot.*behind/i, code: 'SLOT_BEHIND', delay: 1000 },
  ],

  // Requote errors - need fresh quote
  REQUOTE: [
    { pattern: /slippage.*exceeded/i, code: 'SLIPPAGE_EXCEEDED', delay: 0 },
    { pattern: /price.*moved/i, code: 'PRICE_MOVED', delay: 0 },
    { pattern: /insufficient.*output/i, code: 'INSUFFICIENT_OUTPUT', delay: 0 },
    { pattern: /route.*expired/i, code: 'ROUTE_EXPIRED', delay: 0 },
    { pattern: /quote.*stale/i, code: 'QUOTE_STALE', delay: 0 },
    { pattern: /amount.*exceeds/i, code: 'AMOUNT_EXCEEDS', delay: 0 },
    { pattern: /liquidity.*insufficient/i, code: 'LIQUIDITY_INSUFFICIENT', delay: 500 },
  ],

  // Fatal errors - do not retry
  FATAL: [
    { pattern: /insufficient.*funds/i, code: 'INSUFFICIENT_FUNDS' },
    { pattern: /insufficient.*balance/i, code: 'INSUFFICIENT_BALANCE' },
    { pattern: /invalid.*account/i, code: 'INVALID_ACCOUNT' },
    { pattern: /account.*not.*found/i, code: 'ACCOUNT_NOT_FOUND' },
    { pattern: /invalid.*mint/i, code: 'INVALID_MINT' },
    { pattern: /token.*account.*not.*initialized/i, code: 'TOKEN_ACCOUNT_NOT_INITIALIZED' },
    { pattern: /owner.*mismatch/i, code: 'OWNER_MISMATCH' },
    { pattern: /program.*failed/i, code: 'PROGRAM_FAILED' },
    { pattern: /instruction.*error/i, code: 'INSTRUCTION_ERROR' },
    { pattern: /signature.*verification.*failed/i, code: 'SIGNATURE_FAILED' },
    { pattern: /already.*processed/i, code: 'ALREADY_PROCESSED' },
    { pattern: /account.*already.*in.*use/i, code: 'ACCOUNT_IN_USE' },
    { pattern: /unauthorized/i, code: 'UNAUTHORIZED' },
    { pattern: /forbidden/i, code: 'FORBIDDEN' },
    { pattern: /blacklisted/i, code: 'BLACKLISTED' },
  ],
};

/**
 * Classify an error for retry decisions
 */
export function classifyError(error: Error): ClassifiedError {
  const errorMessage = error.message || String(error);
  const errorString = errorMessage.toLowerCase();

  // Check transient patterns
  for (const { pattern, code, delay } of ERROR_PATTERNS.TRANSIENT) {
    if (pattern.test(errorMessage)) {
      log.debug({ code, message: errorMessage }, 'Classified as TRANSIENT');
      return {
        category: ErrorCategory.TRANSIENT,
        code,
        message: errorMessage,
        retryable: true,
        requiresRequote: code === 'BLOCKHASH_EXPIRED', // Blockhash expired needs rebuild
        suggestedDelayMs: delay,
        originalError: error,
      };
    }
  }

  // Check requote patterns
  for (const { pattern, code, delay } of ERROR_PATTERNS.REQUOTE) {
    if (pattern.test(errorMessage)) {
      log.debug({ code, message: errorMessage }, 'Classified as REQUOTE');
      return {
        category: ErrorCategory.REQUOTE,
        code,
        message: errorMessage,
        retryable: true,
        requiresRequote: true,
        suggestedDelayMs: delay,
        originalError: error,
      };
    }
  }

  // Check fatal patterns
  for (const { pattern, code } of ERROR_PATTERNS.FATAL) {
    if (pattern.test(errorMessage)) {
      log.debug({ code, message: errorMessage }, 'Classified as FATAL');
      return {
        category: ErrorCategory.FATAL,
        code,
        message: errorMessage,
        retryable: false,
        requiresRequote: false,
        suggestedDelayMs: 0,
        originalError: error,
      };
    }
  }

  // Default: treat unknown errors as potentially transient (retry once)
  log.warn({ message: errorMessage }, 'Unknown error, treating as TRANSIENT');
  return {
    category: ErrorCategory.TRANSIENT,
    code: 'UNKNOWN',
    message: errorMessage,
    retryable: true,
    requiresRequote: false,
    suggestedDelayMs: 1000,
    originalError: error,
  };
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  strategy: RetryStrategy,
  suggestedDelay?: number
): number {
  if (suggestedDelay && suggestedDelay > 0) {
    // Use suggested delay if provided (from error classification)
    return Math.min(suggestedDelay, strategy.maxDelayMs);
  }

  // Exponential backoff with jitter
  const exponentialDelay =
    strategy.initialDelayMs * Math.pow(strategy.backoffMultiplier, attempt);
  const jitter = Math.random() * strategy.jitterMs;
  const totalDelay = Math.min(exponentialDelay + jitter, strategy.maxDelayMs);

  return Math.round(totalDelay);
}

/**
 * Retry state tracker
 */
export interface RetryState {
  attempts: number;
  requotes: number;
  errors: ClassifiedError[];
  startTime: number;
  lastAttemptTime?: number;
}

/**
 * Create initial retry state
 */
export function createRetryState(): RetryState {
  return {
    attempts: 0,
    requotes: 0,
    errors: [],
    startTime: Date.now(),
  };
}

/**
 * Determine if should retry based on error and state
 */
export function shouldRetry(
  error: ClassifiedError,
  state: RetryState,
  strategy: RetryStrategy
): { shouldRetry: boolean; reason: string; delayMs: number } {
  // Fatal errors never retry
  if (error.category === ErrorCategory.FATAL) {
    return {
      shouldRetry: false,
      reason: `Fatal error: ${error.code}`,
      delayMs: 0,
    };
  }

  // Check requote limits
  if (error.requiresRequote) {
    if (state.requotes >= strategy.maxRequotes) {
      return {
        shouldRetry: false,
        reason: `Max requotes exceeded (${strategy.maxRequotes})`,
        delayMs: 0,
      };
    }
  }

  // Check retry limits
  if (state.attempts >= strategy.maxRetries) {
    return {
      shouldRetry: false,
      reason: `Max retries exceeded (${strategy.maxRetries})`,
      delayMs: 0,
    };
  }

  // Can retry
  const delayMs = calculateBackoffDelay(state.attempts, strategy, error.suggestedDelayMs);

  return {
    shouldRetry: true,
    reason: error.requiresRequote ? 'Will requote and retry' : 'Will retry',
    delayMs,
  };
}

/**
 * Utility to sleep with abort signal support
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
 * Retry execution metrics
 */
export interface RetryMetrics {
  totalAttempts: number;
  totalRequotes: number;
  totalTimeMs: number;
  finalStatus: 'success' | 'failed';
  errorCodes: string[];
}

/**
 * Build retry metrics from state
 */
export function buildRetryMetrics(
  state: RetryState,
  success: boolean
): RetryMetrics {
  return {
    totalAttempts: state.attempts,
    totalRequotes: state.requotes,
    totalTimeMs: Date.now() - state.startTime,
    finalStatus: success ? 'success' : 'failed',
    errorCodes: state.errors.map((e) => e.code),
  };
}
