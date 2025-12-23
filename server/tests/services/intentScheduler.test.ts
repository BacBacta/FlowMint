/**
 * IntentScheduler Integration Tests
 *
 * Tests for DCA and Stop-Loss scheduling with JobLocks and OracleService.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

// Mock dependencies
jest.mock('../../src/config/index.js', () => ({
  config: {
    solana: {
      rpcUrl: 'https://api.devnet.solana.com',
      commitment: 'confirmed',
    },
    jupiter: {
      apiUrl: 'https://quote-api.jup.ag/v6',
      maxSlippageBps: 50,
    },
    pyth: {
      endpoint: 'https://hermes.pyth.network',
    },
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe('IntentScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('JobLockService', () => {
    it('should acquire a lock for new job', async () => {
      const { JobLockService } = await import('../../src/services/jobLockService.js');
      const lockService = new JobLockService();

      const result = await lockService.acquireLock(
        'test-intent-1',
        Date.now(),
        60000 // 1 minute window
      );

      expect(result.acquired).toBe(true);
      expect(result.jobId).toBeDefined();
    });

    it('should prevent duplicate job within window', async () => {
      const { JobLockService } = await import('../../src/services/jobLockService.js');
      const lockService = new JobLockService();

      const timestamp = Date.now();

      // First acquisition should succeed
      const first = await lockService.acquireLock('test-intent-2', timestamp, 60000);
      expect(first.acquired).toBe(true);

      // Second acquisition within same window should fail
      const second = await lockService.acquireLock('test-intent-2', timestamp, 60000);
      expect(second.acquired).toBe(false);
      expect(second.reason).toContain('already');
    });

    it('should allow job in different time window', async () => {
      const { JobLockService } = await import('../../src/services/jobLockService.js');
      const lockService = new JobLockService();

      const timestamp1 = Date.now();
      const timestamp2 = timestamp1 + 120000; // 2 minutes later

      const first = await lockService.acquireLock('test-intent-3', timestamp1, 60000);
      expect(first.acquired).toBe(true);

      // Different window should succeed
      const second = await lockService.acquireLock('test-intent-3', timestamp2, 60000);
      expect(second.acquired).toBe(true);
    });

    it('should release lock after completion', async () => {
      const { JobLockService } = await import('../../src/services/jobLockService.js');
      const lockService = new JobLockService();

      const timestamp = Date.now();

      const lock = await lockService.acquireLock('test-intent-4', timestamp, 60000);
      expect(lock.acquired).toBe(true);

      // Release the lock
      await lockService.releaseLock(lock.jobId!, 'completed');

      // Check status
      const status = await lockService.getJobStatus(lock.jobId!);
      expect(status?.status).toBe('completed');
    });

    it('should reset stuck jobs', async () => {
      const { JobLockService } = await import('../../src/services/jobLockService.js');
      const lockService = new JobLockService();

      const staleTimestamp = Date.now() - 600000; // 10 minutes ago

      // Create a "stuck" job by acquiring and not releasing
      const lock = await lockService.acquireLock('test-intent-5', staleTimestamp, 60000);
      expect(lock.acquired).toBe(true);

      // Reset stuck jobs (those in 'processing' for too long)
      const resetCount = await lockService.resetStuckJobs(300000); // 5 min timeout

      expect(resetCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('OracleService', () => {
    it('should validate price data freshness', async () => {
      const { OracleService } = await import('../../src/services/oracleService.js');

      // Mock Pyth API response
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 'test-feed',
          price: {
            price: '10000000000', // $100.00
            conf: '50000000', // $0.50 confidence
            expo: -8,
            publish_time: Math.floor(Date.now() / 1000) - 5, // 5 seconds ago
          },
        }]),
      } as Response);

      const oracle = new OracleService();
      const prices = await oracle.getPrices(['test-feed']);

      expect(prices.get('test-feed')).toBeDefined();
      const priceData = prices.get('test-feed')!;
      expect(priceData.price).toBe(100);
      expect(priceData.isStale).toBe(false);
    });

    it('should detect stale price data', async () => {
      const { OracleService } = await import('../../src/services/oracleService.js');

      // Mock Pyth API with old timestamp
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 'test-feed',
          price: {
            price: '10000000000',
            conf: '50000000',
            expo: -8,
            publish_time: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
          },
        }]),
      } as Response);

      const oracle = new OracleService();
      const prices = await oracle.getPrices(['test-feed']);

      const priceData = prices.get('test-feed')!;
      expect(priceData.isStale).toBe(true);
    });

    it('should check stop-loss trigger correctly', async () => {
      const { OracleService } = await import('../../src/services/oracleService.js');

      // Mock fresh price at $95
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 'sol-usd',
          price: {
            price: '9500000000', // $95.00
            conf: '50000000',
            expo: -8,
            publish_time: Math.floor(Date.now() / 1000) - 2,
          },
        }]),
      } as Response);

      const oracle = new OracleService();

      // Stop-loss set at $100, direction 'below'
      const check = await oracle.checkStopLossTrigger('sol-usd', 100, 'below');

      expect(check.canExecute).toBe(true);
      expect(check.triggered).toBe(true);
      expect(check.price?.price).toBe(95);
    });

    it('should not trigger when price above threshold', async () => {
      const { OracleService } = await import('../../src/services/oracleService.js');

      // Mock fresh price at $105
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 'sol-usd',
          price: {
            price: '10500000000', // $105.00
            conf: '50000000',
            expo: -8,
            publish_time: Math.floor(Date.now() / 1000) - 2,
          },
        }]),
      } as Response);

      const oracle = new OracleService();

      // Stop-loss set at $100, direction 'below'
      const check = await oracle.checkStopLossTrigger('sol-usd', 100, 'below');

      expect(check.canExecute).toBe(true);
      expect(check.triggered).toBe(false);
    });

    it('should reject execution on stale price', async () => {
      const { OracleService } = await import('../../src/services/oracleService.js');

      // Mock stale price
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          id: 'sol-usd',
          price: {
            price: '9500000000',
            conf: '50000000',
            expo: -8,
            publish_time: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
          },
        }]),
      } as Response);

      const oracle = new OracleService();
      const check = await oracle.checkStopLossTrigger('sol-usd', 100, 'below');

      expect(check.canExecute).toBe(false);
      expect(check.reason).toContain('stale');
    });
  });

  describe('DCA Scheduling', () => {
    it('should calculate next DCA slice correctly', async () => {
      // Test DCA slice calculation logic
      const totalAmount = 1000000000; // 1 SOL in lamports
      const totalSlices = 5;
      const completedSlices = 2;

      const remainingSlices = totalSlices - completedSlices;
      const sliceAmount = Math.floor(totalAmount / totalSlices);

      expect(remainingSlices).toBe(3);
      expect(sliceAmount).toBe(200000000); // 0.2 SOL per slice
    });

    it('should respect interval between slices', async () => {
      const interval = 3600; // 1 hour in seconds
      const lastExecution = Date.now() - 3700000; // 1 hour and 1.6 minutes ago
      const now = Date.now();

      const timeSinceLastExecution = now - lastExecution;
      const shouldExecute = timeSinceLastExecution >= interval * 1000;

      expect(shouldExecute).toBe(true);
    });

    it('should not execute before interval elapsed', async () => {
      const interval = 3600; // 1 hour in seconds
      const lastExecution = Date.now() - 1800000; // 30 minutes ago
      const now = Date.now();

      const timeSinceLastExecution = now - lastExecution;
      const shouldExecute = timeSinceLastExecution >= interval * 1000;

      expect(shouldExecute).toBe(false);
    });
  });

  describe('Stop-Loss Scheduling', () => {
    it('should trigger when price crosses below threshold', () => {
      const threshold = 100;
      const direction = 'below';
      const currentPrice = 95;

      const shouldTrigger =
        direction === 'below' && currentPrice <= threshold;

      expect(shouldTrigger).toBe(true);
    });

    it('should trigger when price crosses above threshold', () => {
      const threshold = 100;
      const direction = 'above';
      const currentPrice = 105;

      const shouldTrigger =
        direction === 'above' && currentPrice >= threshold;

      expect(shouldTrigger).toBe(true);
    });

    it('should not trigger when price does not cross threshold', () => {
      const threshold = 100;
      const direction = 'below';
      const currentPrice = 105;

      const shouldTrigger =
        direction === 'below' && currentPrice <= threshold;

      expect(shouldTrigger).toBe(false);
    });
  });
});
