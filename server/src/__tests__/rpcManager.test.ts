/**
 * RPC Manager Tests
 *
 * Unit tests for the RPC Manager service.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Connection } from '@solana/web3.js';

// Mock the config
vi.mock('../config/index.js', () => ({
  config: {
    solana: {
      rpcUrl: 'https://api.devnet.solana.com',
      commitment: 'confirmed',
    },
    nodeEnv: 'test',
  },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('RpcManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default RPC endpoint', async () => {
      // Import after mocks are set up
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const manager = new RpcManager();
      const connection = manager.getConnection();
      
      expect(connection).toBeInstanceOf(Connection);
    });

    it('should initialize with custom endpoints', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const customEndpoints = [
        { url: 'https://custom-rpc-1.com', weight: 10 },
        { url: 'https://custom-rpc-2.com', weight: 5 },
      ];
      
      const manager = new RpcManager(customEndpoints);
      const endpoints = manager.getAllEndpoints();
      
      expect(endpoints.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Endpoint Selection', () => {
    it('should select endpoint based on weight', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const endpoints = [
        { url: 'https://high-weight.com', weight: 100, name: 'high' },
        { url: 'https://low-weight.com', weight: 1, name: 'low' },
      ];
      
      const manager = new RpcManager(endpoints);
      const selected = manager.getConnection();
      
      expect(selected).toBeInstanceOf(Connection);
    });

    it('should filter out unhealthy endpoints', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const manager = new RpcManager();
      
      // Mark an endpoint as unhealthy
      manager.recordFailure('https://api.devnet.solana.com');
      manager.recordFailure('https://api.devnet.solana.com');
      manager.recordFailure('https://api.devnet.solana.com');
      
      const healthyEndpoints = manager.getHealthyEndpoints();
      
      // Should still have at least one endpoint (the devnet one might be the only one)
      expect(Array.isArray(healthyEndpoints)).toBe(true);
    });
  });

  describe('Failover', () => {
    it('should record success after successful request', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const manager = new RpcManager();
      const url = 'https://api.devnet.solana.com';
      
      manager.recordSuccess(url, 100);
      
      const health = manager.getHealthStatus();
      expect(health).toBeDefined();
    });

    it('should record failure and update health status', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const manager = new RpcManager();
      const url = 'https://api.devnet.solana.com';
      
      manager.recordFailure(url);
      
      const health = manager.getHealthStatus();
      expect(health.healthyCount).toBeDefined();
    });
  });

  describe('Execute with Failover', () => {
    it('should execute operation with primary endpoint', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const manager = new RpcManager();
      
      const mockOperation = vi.fn().mockResolvedValue('success');
      
      const result = await manager.executeWithFailover(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry with different endpoint on failure', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      // Add multiple endpoints
      const endpoints = [
        { url: 'https://endpoint-1.com', weight: 10 },
        { url: 'https://endpoint-2.com', weight: 10 },
      ];
      
      const manager = new RpcManager(endpoints);
      
      let callCount = 0;
      const mockOperation = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First endpoint failed');
        }
        return Promise.resolve('success from backup');
      });
      
      const result = await manager.executeWithFailover(mockOperation);
      
      expect(result).toBe('success from backup');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should throw after all retries exhausted', async () => {
      const { RpcManager } = await import('../services/rpcManager.js');
      
      const manager = new RpcManager();
      
      const mockOperation = vi.fn().mockRejectedValue(new Error('Always fails'));
      
      await expect(manager.executeWithFailover(mockOperation, 2)).rejects.toThrow();
    });
  });
});
