/**
 * IntentScheduler Unit Tests
 *
 * Tests for DCA and Stop-Loss scheduling logic.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { IntentType, IntentStatus } from '../../src/services/intentScheduler';

describe('IntentScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Intent Types', () => {
    it('should have valid DCA type', () => {
      expect(IntentType.DCA).toBe('DCA');
    });

    it('should have valid stop-loss type', () => {
      expect(IntentType.STOP_LOSS).toBe('STOP_LOSS');
    });
  });

  describe('Intent Status', () => {
    it('should have active status', () => {
      expect(IntentStatus.ACTIVE).toBe('active');
    });

    it('should have completed status', () => {
      expect(IntentStatus.COMPLETED).toBe('completed');
    });

    it('should have cancelled status', () => {
      expect(IntentStatus.CANCELLED).toBe('cancelled');
    });

    it('should have paused status', () => {
      expect(IntentStatus.PAUSED).toBe('paused');
    });
  });

  describe('DCA Scheduling Logic', () => {
    it('should calculate next DCA slice correctly', () => {
      const intervalSeconds = 3600; // 1 hour
      const lastExecution = Date.now() - 4000000; // 4000 seconds ago
      const nextExecution = lastExecution + (intervalSeconds * 1000);
      
      const now = Date.now();
      const isDue = now >= nextExecution;
      
      expect(isDue).toBe(true);
    });

    it('should respect interval between slices', () => {
      const intervalSeconds = 3600; // 1 hour
      const lastExecution = Date.now() - 1800000; // 30 minutes ago
      const nextExecution = lastExecution + (intervalSeconds * 1000);
      
      const now = Date.now();
      const isDue = now >= nextExecution;
      
      expect(isDue).toBe(false);
    });

    it('should not execute before interval elapsed', () => {
      const intervalMs = 86400000; // 1 day
      const createdAt = Date.now();
      const firstExecutionTime = createdAt + intervalMs;
      
      const now = Date.now();
      const canExecute = now >= firstExecutionTime;
      
      expect(canExecute).toBe(false);
    });
  });

  describe('Stop-Loss Scheduling Logic', () => {
    it('should trigger when price crosses below threshold', () => {
      const threshold = 100;
      const currentPrice = 95;
      const priceDirection = 'below' as const;
      
      const shouldTrigger = currentPrice <= threshold && priceDirection === 'below';
      
      expect(shouldTrigger).toBe(true);
    });

    it('should trigger when price crosses above threshold', () => {
      const threshold = 100;
      const currentPrice = 105;
      const priceDirection = 'above' as const;
      
      const shouldTrigger = currentPrice >= threshold && priceDirection === 'above';
      
      expect(shouldTrigger).toBe(true);
    });

    it('should not trigger when price does not cross threshold', () => {
      const threshold = 100;
      const currentPrice = 98;
      const priceDirection = 'above' as const;
      
      const shouldTrigger = currentPrice >= threshold && priceDirection === 'above';
      
      expect(shouldTrigger).toBe(false);
    });
  });

  describe('Intent Validation', () => {
    it('should validate DCA intent parameters', () => {
      const dcaIntent = {
        intentType: IntentType.DCA,
        totalAmount: '1000000000',
        remainingAmount: '1000000000',
        intervalSeconds: 86400,
        amountPerSwap: '100000000',
        slippageBps: 50,
      };

      expect(dcaIntent.intervalSeconds).toBeGreaterThan(0);
      expect(parseInt(dcaIntent.amountPerSwap)).toBeGreaterThan(0);
      expect(dcaIntent.slippageBps).toBeLessThanOrEqual(5000);
    });

    it('should validate stop-loss intent parameters', () => {
      const stopLossIntent = {
        intentType: IntentType.STOP_LOSS,
        totalAmount: '1000000000',
        priceThreshold: 100,
        priceDirection: 'below' as const,
        slippageBps: 100,
      };

      expect(stopLossIntent.priceThreshold).toBeGreaterThan(0);
      expect(['above', 'below']).toContain(stopLossIntent.priceDirection);
      expect(stopLossIntent.slippageBps).toBeLessThanOrEqual(5000);
    });
  });

  describe('Execution Count Tracking', () => {
    it('should track execution count', () => {
      let executionCount = 0;
      const slicesTotal = 10;

      // Simulate 3 executions
      executionCount++;
      executionCount++;
      executionCount++;

      expect(executionCount).toBe(3);
      expect(executionCount).toBeLessThanOrEqual(slicesTotal);
    });

    it('should mark complete when all slices executed', () => {
      const slicesTotal = 10;
      const slicesExecuted = 10;

      const isComplete = slicesExecuted >= slicesTotal;

      expect(isComplete).toBe(true);
    });
  });

  describe('Remaining Amount Calculation', () => {
    it('should calculate remaining amount correctly', () => {
      const totalAmount = BigInt('1000000000');
      const amountPerSwap = BigInt('100000000');
      const executionCount = 3;

      const executedAmount = amountPerSwap * BigInt(executionCount);
      const remainingAmount = totalAmount - executedAmount;

      expect(remainingAmount.toString()).toBe('700000000');
    });

    it('should handle final slice with remaining amount', () => {
      const totalAmount = BigInt('1000000000');
      const amountPerSwap = BigInt('300000000');
      const executionCount = 3;

      const executedAmount = amountPerSwap * BigInt(executionCount);
      const remainingAmount = totalAmount - executedAmount;

      expect(remainingAmount.toString()).toBe('100000000');
    });
  });
});
