/**
 * RPC Manager
 *
 * Manages multiple RPC endpoints with automatic failover, health monitoring,
 * and intelligent load balancing for improved reliability.
 */

import { Connection, ConnectionConfig } from '@solana/web3.js';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * RPC endpoint configuration
 */
export interface RpcEndpoint {
  /** Endpoint URL */
  url: string;
  /** Weight for load balancing (higher = more traffic) */
  weight: number;
  /** Maximum requests per second */
  rateLimit?: number;
  /** Whether this is a premium/paid endpoint */
  isPremium?: boolean;
  /** Custom name for logging */
  name?: string;
}

/**
 * RPC endpoint health status
 */
interface EndpointHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  lastError?: string;
  latencyMs: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
}

/**
 * RPC Manager configuration
 */
export interface RpcManagerConfig {
  /** List of RPC endpoints */
  endpoints: RpcEndpoint[];
  /** Health check interval in milliseconds */
  healthCheckIntervalMs?: number;
  /** Number of consecutive failures before marking unhealthy */
  failureThreshold?: number;
  /** Time to wait before retrying an unhealthy endpoint */
  recoveryDelayMs?: number;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Solana commitment level */
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

/**
 * Default RPC endpoints
 *
 * On devnet, we only use the configured RPC URL.
 * On mainnet, additional fallback endpoints can be enabled with proper API keys.
 */
const DEFAULT_ENDPOINTS: RpcEndpoint[] =
  config.solana.network === 'mainnet-beta'
    ? [
        {
          url: config.solana.rpcUrl,
          weight: 10,
          isPremium: true,
          name: 'primary',
        },
        {
          url: 'https://api.mainnet-beta.solana.com',
          weight: 3,
          rateLimit: 10, // Public endpoints have rate limits
          name: 'solana-public',
        },
        // NOTE: These endpoints require API tokens. Uncomment if tokens are set.
        // {
        //   url: 'https://rpc.ankr.com/solana',
        //   weight: 5,
        //   name: 'ankr',
        // },
        // {
        //   url: 'https://solana-mainnet.rpc.extrnode.com',
        //   weight: 3,
        //   name: 'extrnode',
        // },
      ]
    : [
        // Devnet: only use the configured devnet RPC
        {
          url: config.solana.rpcUrl,
          weight: 10,
          isPremium: true,
          name: 'primary',
        },
        {
          url: 'https://api.devnet.solana.com',
          weight: 3,
          rateLimit: 10,
          name: 'solana-devnet-public',
        },
      ];

/**
 * RPC Manager
 *
 * Provides automatic failover between multiple RPC endpoints with
 * health monitoring and intelligent routing.
 */
export class RpcManager {
  private readonly log = logger.child({ service: 'RpcManager' });
  private readonly endpoints: RpcEndpoint[];
  private readonly healthStatus: Map<string, EndpointHealth> = new Map();
  private readonly connections: Map<string, Connection> = new Map();
  private readonly config: Required<Omit<RpcManagerConfig, 'endpoints'>>;
  private healthCheckInterval?: NodeJS.Timeout;
  private currentPrimaryIndex = 0;

  constructor(rpcConfig?: RpcManagerConfig) {
    this.endpoints = rpcConfig?.endpoints || DEFAULT_ENDPOINTS;
    this.config = {
      healthCheckIntervalMs: rpcConfig?.healthCheckIntervalMs || 30000,
      failureThreshold: rpcConfig?.failureThreshold || 3,
      recoveryDelayMs: rpcConfig?.recoveryDelayMs || 60000,
      timeoutMs: rpcConfig?.timeoutMs || 30000,
      commitment: rpcConfig?.commitment || config.solana.commitment,
    };

    this.initializeEndpoints();
    this.log.info({ endpointCount: this.endpoints.length }, 'RPC Manager initialized');
  }

  /**
   * Initialize all endpoints
   */
  private initializeEndpoints(): void {
    for (const endpoint of this.endpoints) {
      const connectionConfig: ConnectionConfig = {
        commitment: this.config.commitment,
        confirmTransactionInitialTimeout: this.config.timeoutMs,
      };

      const connection = new Connection(endpoint.url, connectionConfig);
      this.connections.set(endpoint.url, connection);

      this.healthStatus.set(endpoint.url, {
        url: endpoint.url,
        isHealthy: true, // Assume healthy until proven otherwise
        lastCheck: 0,
        latencyMs: 0,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Start health monitoring
   */
  start(): void {
    this.log.info('Starting RPC health monitoring');

    // Run initial health check
    this.runHealthChecks();

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs
    );
    // Don't keep the Node event loop alive solely due to health checks.
    this.healthCheckInterval.unref?.();
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      this.log.info('RPC health monitoring stopped');
    }
  }

  /**
   * Get the best available connection
   */
  getConnection(): Connection {
    const healthyEndpoints = this.getHealthyEndpoints();

    if (healthyEndpoints.length === 0) {
      this.log.warn('No healthy endpoints available, using primary');
      return this.connections.get(this.endpoints[0].url)!;
    }

    // Weighted random selection among healthy endpoints
    const endpoint = this.selectWeightedEndpoint(healthyEndpoints);
    return this.connections.get(endpoint.url)!;
  }

  /**
   * Get a connection with automatic failover
   */
  async getConnectionWithFailover<T>(
    operation: (connection: Connection) => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    const triedEndpoints = new Set<string>();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const healthyEndpoints = this.getHealthyEndpoints().filter(e => !triedEndpoints.has(e.url));

      if (healthyEndpoints.length === 0) {
        // All healthy endpoints tried, reset and try again
        triedEndpoints.clear();
        continue;
      }

      const endpoint = this.selectWeightedEndpoint(healthyEndpoints);
      const connection = this.connections.get(endpoint.url)!;
      triedEndpoints.add(endpoint.url);

      try {
        const startTime = Date.now();
        const result = await operation(connection);

        // Record success
        this.recordSuccess(endpoint.url, Date.now() - startTime);

        return result;
      } catch (error) {
        lastError = error as Error;
        this.log.warn(
          {
            endpoint: endpoint.name || endpoint.url,
            attempt,
            error: lastError.message,
          },
          'RPC request failed, trying next endpoint'
        );

        // Record failure
        this.recordFailure(endpoint.url, lastError.message);
      }
    }

    throw lastError || new Error('All RPC endpoints failed');
  }

  /**
   * Execute operation with automatic retry on specific endpoint
   */
  async executeWithRetry<T>(
    operation: (connection: Connection) => Promise<T>,
    endpointUrl?: string,
    maxRetries = 3
  ): Promise<T> {
    const url = endpointUrl || this.endpoints[0].url;
    const connection = this.connections.get(url)!;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation(connection);
        this.recordSuccess(url, Date.now() - startTime);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure(url, lastError.message);

        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
        }
      }
    }

    // If primary fails, try failover
    return this.getConnectionWithFailover(operation, maxRetries);
  }

  /**
   * Get all healthy endpoints
   */
  private getHealthyEndpoints(): RpcEndpoint[] {
    return this.endpoints.filter(endpoint => {
      const health = this.healthStatus.get(endpoint.url);
      return health?.isHealthy ?? false;
    });
  }

  /**
   * Select endpoint using weighted random selection
   */
  private selectWeightedEndpoint(endpoints: RpcEndpoint[]): RpcEndpoint {
    const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;

    for (const endpoint of endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        return endpoint;
      }
    }

    return endpoints[0];
  }

  /**
   * Record a successful request
   */
  private recordSuccess(url: string, latencyMs: number): void {
    const health = this.healthStatus.get(url);
    if (!health) return;

    health.successCount++;
    health.consecutiveFailures = 0;
    health.latencyMs = (health.latencyMs + latencyMs) / 2; // Rolling average
    health.isHealthy = true;
    health.lastCheck = Date.now();
  }

  /**
   * Record a failed request
   */
  private recordFailure(url: string, error: string): void {
    const health = this.healthStatus.get(url);
    if (!health) return;

    health.failureCount++;
    health.consecutiveFailures++;
    health.lastError = error;
    health.lastCheck = Date.now();

    if (health.consecutiveFailures >= this.config.failureThreshold) {
      health.isHealthy = false;
      this.log.warn(
        { url, consecutiveFailures: health.consecutiveFailures },
        'RPC endpoint marked as unhealthy'
      );
    }
  }

  /**
   * Run health checks on all endpoints
   */
  private async runHealthChecks(): Promise<void> {
    const checks = this.endpoints.map(endpoint => this.checkEndpointHealth(endpoint));
    await Promise.allSettled(checks);

    const healthyCount = this.getHealthyEndpoints().length;
    this.log.debug({ healthyCount, totalCount: this.endpoints.length }, 'Health check completed');
  }

  /**
   * Check health of a single endpoint
   */
  private async checkEndpointHealth(endpoint: RpcEndpoint): Promise<void> {
    const connection = this.connections.get(endpoint.url)!;
    const health = this.healthStatus.get(endpoint.url)!;

    try {
      const startTime = Date.now();
      await connection.getSlot();
      const latencyMs = Date.now() - startTime;

      health.isHealthy = true;
      health.latencyMs = latencyMs;
      health.lastCheck = Date.now();
      health.consecutiveFailures = 0;

      this.log.debug({ endpoint: endpoint.name || endpoint.url, latencyMs }, 'Endpoint healthy');
    } catch (error) {
      health.lastError = (error as Error).message;
      health.lastCheck = Date.now();
      health.consecutiveFailures++;

      if (health.consecutiveFailures >= this.config.failureThreshold) {
        health.isHealthy = false;
      }

      this.log.warn(
        { endpoint: endpoint.name || endpoint.url, error: health.lastError },
        'Endpoint health check failed'
      );
    }
  }

  /**
   * Get health status for all endpoints
   */
  getHealthStatus(): EndpointHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEndpoints: number;
    healthyEndpoints: number;
    totalRequests: number;
    successRate: number;
    averageLatencyMs: number;
  } {
    const statuses = Array.from(this.healthStatus.values());
    const healthyCount = statuses.filter(s => s.isHealthy).length;
    const totalSuccess = statuses.reduce((sum, s) => sum + s.successCount, 0);
    const totalFailure = statuses.reduce((sum, s) => sum + s.failureCount, 0);
    const totalRequests = totalSuccess + totalFailure;
    const avgLatency = statuses.reduce((sum, s) => sum + s.latencyMs, 0) / statuses.length;

    return {
      totalEndpoints: this.endpoints.length,
      healthyEndpoints: healthyCount,
      totalRequests,
      successRate: totalRequests > 0 ? totalSuccess / totalRequests : 1,
      averageLatencyMs: avgLatency,
    };
  }

  /**
   * Force refresh an endpoint's health
   */
  async refreshEndpoint(url: string): Promise<boolean> {
    const endpoint = this.endpoints.find(e => e.url === url);
    if (!endpoint) return false;

    await this.checkEndpointHealth(endpoint);
    return this.healthStatus.get(url)?.isHealthy ?? false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const rpcManager = new RpcManager();
