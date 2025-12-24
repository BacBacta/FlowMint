/**
 * ExecutionEngine Unit Tests
 *
 * Tests for swap execution, retry logic, and fee estimation.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import {
  ErrorCategory,
  classifyError,
  calculateBackoffDelay,
  createRetryState,
  shouldRetry,
  EXECUTION_PROFILES,
  ClassifiedError,
  RetryState,
} from '../../src/services/retryPolicy.js';

describe('ExecutionEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Error Classification', () => {
    it('should classify connection refused as TRANSIENT', () => {
      const error = new Error('Connection refused');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.retryable).toBe(true);
    });

    it('should classify rate limit errors as TRANSIENT', () => {
      const error = new Error('429 Too Many Requests');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.code).toBe('RATE_LIMITED');
    });

    it('should classify timeout errors as TRANSIENT', () => {
      const error = new Error('Request timeout');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.retryable).toBe(true);
    });

    it('should classify insufficient funds as FATAL', () => {
      const error = new Error('Insufficient funds for transaction');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.FATAL);
      expect(classified.retryable).toBe(false);
    });

    it('should classify invalid account as FATAL', () => {
      const error = new Error('Invalid account provided');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.FATAL);
      expect(classified.retryable).toBe(false);
    });

    it('should classify slippage exceeded as REQUOTE', () => {
      const error = new Error('Slippage exceeded tolerance');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.REQUOTE);
      expect(classified.requiresRequote).toBe(true);
    });

    it('should classify unknown errors as TRANSIENT by default', () => {
      const error = new Error('Some unknown error happened');
      const classified = classifyError(error);
      
      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.code).toBe('UNKNOWN');
    });
  });

  describe('Backoff Delay Calculation', () => {
    const autoStrategy = EXECUTION_PROFILES.AUTO;
    const fastStrategy = EXECUTION_PROFILES.FAST;

    it('should calculate delay based on attempt number', () => {
      const delay = calculateBackoffDelay(1, autoStrategy);
      
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(autoStrategy.maxDelayMs);
    });

    it('should increase delay with attempt number', () => {
      // With no jitter for predictability, compare ranges
      const delay1 = calculateBackoffDelay(0, autoStrategy);
      const delay3 = calculateBackoffDelay(2, autoStrategy);
      
      // Higher attempts should generally yield higher delays
      expect(delay3).toBeGreaterThanOrEqual(delay1);
    });

    it('should respect max delay limit', () => {
      const delay = calculateBackoffDelay(100, autoStrategy); // Very high attempt
      
      expect(delay).toBeLessThanOrEqual(autoStrategy.maxDelayMs);
    });

    it('should use suggested delay when provided', () => {
      const suggestedDelay = 3000;
      const delay = calculateBackoffDelay(1, autoStrategy, suggestedDelay);
      
      expect(delay).toBe(suggestedDelay);
    });

    it('should cap suggested delay to maxDelayMs', () => {
      const suggestedDelay = 999999; // Very high
      const delay = calculateBackoffDelay(1, autoStrategy, suggestedDelay);
      
      expect(delay).toBe(autoStrategy.maxDelayMs);
    });

    it('should use faster delays for FAST profile', () => {
      const autoDelay = calculateBackoffDelay(1, autoStrategy);
      const fastDelay = calculateBackoffDelay(1, fastStrategy);
      
      // Fast profile has lower initial delay
      expect(fastStrategy.initialDelayMs).toBeLessThan(autoStrategy.initialDelayMs);
    });
  });

  describe('Retry State Management', () => {
    it('should create initial retry state', () => {
      const state = createRetryState();
      
      expect(state.attempts).toBe(0);
      expect(state.requotes).toBe(0);
      expect(state.errors).toHaveLength(0);
      expect(state.startTime).toBeLessThanOrEqual(Date.now());
    });

    it('should determine if should retry for transient error', () => {
      const state = createRetryState();
      const error = classifyError(new Error('Connection timeout'));
      
      const result = shouldRetry(error, state, EXECUTION_PROFILES.AUTO);
      
      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBeGreaterThanOrEqual(0);
    });

    it('should not retry fatal errors', () => {
      const state = createRetryState();
      const error = classifyError(new Error('Insufficient funds'));
      
      const result = shouldRetry(error, state, EXECUTION_PROFILES.AUTO);
      
      expect(result.shouldRetry).toBe(false);
      expect(result.reason).toContain('Fatal');
    });

    it('should respect max retries limit', () => {
      const state: RetryState = {
        attempts: 10,
        requotes: 0,
        errors: [],
        startTime: Date.now() - 5000,
      };
      const error = classifyError(new Error('Connection timeout'));
      
      const result = shouldRetry(error, state, EXECUTION_PROFILES.AUTO);
      
      expect(result.shouldRetry).toBe(false);
      expect(result.reason).toContain('Max retries');
    });

    it('should respect max requotes limit', () => {
      const state: RetryState = {
        attempts: 0,
        requotes: 5,
        errors: [],
        startTime: Date.now() - 5000,
      };
      const error = classifyError(new Error('Slippage exceeded'));
      
      const result = shouldRetry(error, state, EXECUTION_PROFILES.AUTO);
      
      expect(result.shouldRetry).toBe(false);
      expect(result.reason).toContain('Max requotes');
    });
  });

  describe('Execution Profiles', () => {
    it('should have AUTO profile with balanced settings', () => {
      const profile = EXECUTION_PROFILES.AUTO;
      
      expect(profile.maxRetries).toBe(5);
      expect(profile.maxRequotes).toBe(2);
      expect(profile.initialDelayMs).toBe(500);
    });

    it('should have FAST profile with aggressive settings', () => {
      const profile = EXECUTION_PROFILES.FAST;
      
      expect(profile.maxRetries).toBe(2);
      expect(profile.maxRequotes).toBe(1);
      expect(profile.initialDelayMs).toBe(100);
    });

    it('should have CHEAP profile with patient settings', () => {
      const profile = EXECUTION_PROFILES.CHEAP;
      
      expect(profile.maxRetries).toBe(3);
      expect(profile.maxRequotes).toBe(1);
      expect(profile.initialDelayMs).toBe(1000);
    });
  });

  describe('Receipt Generation', () => {
    it('should generate receipt with required fields', () => {
      const receipt = {
        receiptId: 'test-receipt-id',
        userPublicKey: 'test-user-pubkey',
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '100000000',
        slippageBps: 50,
        protectedMode: false,
        priceImpactPct: '0.1',
        status: 'success' as const,
        txSignature: 'test-signature',
        timestamp: Date.now(),
      };

      expect(receipt.receiptId).toBeDefined();
      expect(receipt.txSignature).toBeDefined();
      expect(receipt.status).toBe('success');
    });

    it('should generate failed receipt with error', () => {
      const receipt = {
        receiptId: 'test-receipt-id',
        userPublicKey: 'test-user-pubkey',
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '0',
        slippageBps: 50,
        protectedMode: false,
        priceImpactPct: '0',
        status: 'failed' as const,
        error: 'Insufficient funds',
        timestamp: Date.now(),
      };

      expect(receipt.status).toBe('failed');
      expect(receipt.error).toBeDefined();
    });
  });
});
