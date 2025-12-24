import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  MetricsService,
  getMetricsService,
  resetMetrics,
} from '../../src/services/metricsService';

describe('MetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    resetMetrics();
    metricsService = getMetricsService();
  });

  describe('initialization', () => {
    it('should create a singleton instance', () => {
      const instance1 = getMetricsService();
      const instance2 = getMetricsService();
      expect(instance1).toBe(instance2);
    });

    it('should have a registry', () => {
      expect(metricsService.getRegistry()).toBeDefined();
    });

    it('should return valid content type', () => {
      const contentType = metricsService.getContentType();
      expect(contentType).toContain('text/plain');
    });
  });

  describe('getMetrics', () => {
    it('should return prometheus format metrics', async () => {
      const metrics = await metricsService.getMetrics();
      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('flowmint_operations_total');
    });
  });

  describe('operation tracking', () => {
    it('should record operation success', () => {
      metricsService.recordOperationSuccess('swap', 'AUTO', 1.5);
      // No error means success
    });

    it('should record operation failure', () => {
      metricsService.recordOperationFailure('swap', 'FAST', 2.0, 'TIMEOUT');
      // No error means success
    });

    it('should start timer and return end function', () => {
      const timer = metricsService.startTimer('payment', 'CHEAP');
      expect(timer.end).toBeDefined();
      expect(typeof timer.end).toBe('function');
      timer.end('success');
    });
  });

  describe('quote tracking', () => {
    it('should record requote', () => {
      metricsService.recordRequote('swap');
      // No error means success
    });

    it('should record retry', () => {
      metricsService.recordRetry('swap', 'NETWORK_ERROR');
      // No error means success
    });

    it('should record quote latency', () => {
      metricsService.recordQuoteLatency('ExactIn', 0.25);
      // No error means success
    });

    it('should record confirmation duration', () => {
      metricsService.recordConfirmationDuration('swap', 5.0);
      // No error means success
    });
  });

  describe('risk tracking', () => {
    it('should record risk blocked operations', () => {
      metricsService.recordRiskBlocked('swap', 'RED', 'high_price_impact');
      // No error means success
    });
  });

  describe('intent tracking', () => {
    it('should set active intents count', () => {
      metricsService.setActiveIntents('dca', 5);
      // No error means success
    });

    it('should set pending jobs count', () => {
      metricsService.setPendingJobs('stop_loss', 3);
      // No error means success
    });
  });

  describe('timeAsync', () => {
    it('should time successful async function', async () => {
      const result = await metricsService.timeAsync('swap', 'AUTO', async () => {
        return 'success';
      });
      expect(result).toBe('success');
    });

    it('should time and rethrow failed async function', async () => {
      await expect(
        metricsService.timeAsync('swap', 'AUTO', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });
});
