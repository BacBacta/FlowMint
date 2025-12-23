/**
 * Fee Estimator Service
 *
 * Estimates priority fees and compute units based on network congestion
 * and execution profile requirements.
 */

import { Connection } from '@solana/web3.js';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'FeeEstimator' });

/**
 * Execution profile for fee calculation
 */
export type ExecutionProfile = 'AUTO' | 'FAST' | 'CHEAP';

/**
 * Fee estimation result
 */
export interface FeeEstimate {
  /** Priority fee in micro-lamports per compute unit */
  priorityFee: number;
  /** Total compute units to request */
  computeUnits: number;
  /** Estimated total fee in lamports */
  estimatedFeeLamports: number;
  /** Network congestion level */
  congestionLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Confidence in estimate (0-1) */
  confidence: number;
  /** Timestamp of estimate */
  timestamp: number;
}

/**
 * Network stats cache
 */
interface NetworkStats {
  recentPriorityFees: number[];
  avgSlotTime: number;
  timestamp: number;
}

/**
 * Profile-specific fee settings
 */
const PROFILE_SETTINGS: Record<
  ExecutionProfile,
  {
    priorityMultiplier: number;
    minPriorityFee: number;
    maxPriorityFee: number;
    computeBuffer: number;
    targetPercentile: number;
  }
> = {
  FAST: {
    priorityMultiplier: 2.0,
    minPriorityFee: 50000, // 50k micro-lamports
    maxPriorityFee: 2000000, // 2M micro-lamports (0.002 SOL for 1M CU)
    computeBuffer: 1.5, // 50% buffer
    targetPercentile: 90, // Aim for 90th percentile
  },
  AUTO: {
    priorityMultiplier: 1.2,
    minPriorityFee: 10000,
    maxPriorityFee: 500000,
    computeBuffer: 1.3,
    targetPercentile: 75,
  },
  CHEAP: {
    priorityMultiplier: 1.0,
    minPriorityFee: 1000,
    maxPriorityFee: 100000,
    computeBuffer: 1.1,
    targetPercentile: 50,
  },
};

/**
 * Congestion thresholds (priority fee in micro-lamports)
 */
const CONGESTION_THRESHOLDS = {
  low: 10000,
  medium: 50000,
  high: 200000,
  critical: 1000000,
};

/**
 * Default compute units for Jupiter swaps
 */
const DEFAULT_SWAP_COMPUTE = 300000;

/**
 * Cache TTL in milliseconds
 */
const CACHE_TTL = 10000; // 10 seconds

/**
 * Fee Estimator class
 */
export class FeeEstimator {
  private connection: Connection;
  private statsCache: NetworkStats | null = null;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
    });
  }

  /**
   * Get fee estimate for a swap transaction
   */
  async estimateSwapFees(
    profile: ExecutionProfile = 'AUTO',
    estimatedComputeUnits?: number
  ): Promise<FeeEstimate> {
    const settings = PROFILE_SETTINGS[profile];
    const timestamp = Date.now();

    try {
      // Fetch or use cached network stats
      const stats = await this.getNetworkStats();

      // Calculate percentile priority fee
      const sortedFees = [...stats.recentPriorityFees].sort((a, b) => a - b);
      const percentileIndex = Math.floor(
        (settings.targetPercentile / 100) * sortedFees.length
      );
      const basePriorityFee = sortedFees[percentileIndex] || settings.minPriorityFee;

      // Apply profile multiplier
      let priorityFee = Math.round(basePriorityFee * settings.priorityMultiplier);

      // Clamp to min/max
      priorityFee = Math.max(settings.minPriorityFee, priorityFee);
      priorityFee = Math.min(settings.maxPriorityFee, priorityFee);

      // Calculate compute units with buffer
      const baseCompute = estimatedComputeUnits || DEFAULT_SWAP_COMPUTE;
      const computeUnits = Math.round(baseCompute * settings.computeBuffer);

      // Estimate total fee
      const estimatedFeeLamports = Math.round((priorityFee * computeUnits) / 1_000_000);

      // Determine congestion level
      const avgFee =
        stats.recentPriorityFees.reduce((a, b) => a + b, 0) /
        stats.recentPriorityFees.length;
      const congestionLevel = this.determineCongestion(avgFee);

      // Confidence based on sample size and freshness
      const ageFactor = Math.max(0, 1 - (timestamp - stats.timestamp) / CACHE_TTL);
      const sampleFactor = Math.min(1, stats.recentPriorityFees.length / 50);
      const confidence = (ageFactor + sampleFactor) / 2;

      log.debug(
        {
          profile,
          priorityFee,
          computeUnits,
          congestionLevel,
          confidence,
        },
        'Fee estimate calculated'
      );

      return {
        priorityFee,
        computeUnits,
        estimatedFeeLamports,
        congestionLevel,
        confidence,
        timestamp,
      };
    } catch (error) {
      log.warn({ error }, 'Failed to estimate fees, using defaults');

      // Return conservative defaults on error
      return {
        priorityFee: settings.minPriorityFee * settings.priorityMultiplier,
        computeUnits: Math.round(DEFAULT_SWAP_COMPUTE * settings.computeBuffer),
        estimatedFeeLamports: 10000, // ~0.00001 SOL
        congestionLevel: 'medium',
        confidence: 0.3,
        timestamp,
      };
    }
  }

  /**
   * Get network statistics (with caching)
   */
  private async getNetworkStats(): Promise<NetworkStats> {
    const now = Date.now();

    // Return cached if fresh
    if (this.statsCache && now - this.statsCache.timestamp < CACHE_TTL) {
      return this.statsCache;
    }

    // Fetch recent priority fees
    const recentPriorityFees = await this.fetchRecentPriorityFees();

    // Estimate slot time (default 400ms)
    const avgSlotTime = 400;

    this.statsCache = {
      recentPriorityFees,
      avgSlotTime,
      timestamp: now,
    };

    return this.statsCache;
  }

  /**
   * Fetch recent priority fees from the network
   */
  private async fetchRecentPriorityFees(): Promise<number[]> {
    try {
      // Get recent prioritization fees
      const response = await this.connection.getRecentPrioritizationFees();

      if (!response || response.length === 0) {
        return [CONGESTION_THRESHOLDS.low];
      }

      // Extract fees and filter outliers
      const fees = response
        .map((f) => f.prioritizationFee)
        .filter((f) => f > 0 && f < 10_000_000); // Filter extreme outliers

      if (fees.length === 0) {
        return [CONGESTION_THRESHOLDS.low];
      }

      return fees;
    } catch (error) {
      log.warn({ error }, 'Failed to fetch priority fees');
      return [CONGESTION_THRESHOLDS.low];
    }
  }

  /**
   * Determine network congestion level from average fee
   */
  private determineCongestion(avgFee: number): FeeEstimate['congestionLevel'] {
    if (avgFee >= CONGESTION_THRESHOLDS.critical) return 'critical';
    if (avgFee >= CONGESTION_THRESHOLDS.high) return 'high';
    if (avgFee >= CONGESTION_THRESHOLDS.medium) return 'medium';
    return 'low';
  }

  /**
   * Get recommended settings based on congestion
   */
  async getRecommendedProfile(): Promise<{
    profile: ExecutionProfile;
    reason: string;
    congestion: FeeEstimate['congestionLevel'];
  }> {
    const estimate = await this.estimateSwapFees('AUTO');

    if (estimate.congestionLevel === 'critical') {
      return {
        profile: 'FAST',
        reason: 'Network is critically congested, using FAST profile for reliability',
        congestion: estimate.congestionLevel,
      };
    }

    if (estimate.congestionLevel === 'high') {
      return {
        profile: 'AUTO',
        reason: 'Network is congested, using AUTO profile with adaptive fees',
        congestion: estimate.congestionLevel,
      };
    }

    if (estimate.congestionLevel === 'low') {
      return {
        profile: 'CHEAP',
        reason: 'Network is quiet, CHEAP profile recommended to save fees',
        congestion: estimate.congestionLevel,
      };
    }

    return {
      profile: 'AUTO',
      reason: 'Normal network conditions, using AUTO profile',
      congestion: estimate.congestionLevel,
    };
  }

  /**
   * Update connection (e.g., after RPC failover)
   */
  updateConnection(connection: Connection): void {
    this.connection = connection;
    this.statsCache = null;
  }
}

// Singleton instance
export const feeEstimator = new FeeEstimator();
