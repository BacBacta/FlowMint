/**
 * Analytics Service
 *
 * Tracks and aggregates metrics for swaps, intents, and platform usage.
 * Provides insights into success rates, volumes, and user behavior.
 */

import { DatabaseService } from '../db/database.js';
import { logger } from '../utils/logger.js';

/**
 * Time range for analytics queries
 */
export type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

/**
 * Swap analytics data
 */
export interface SwapAnalytics {
  /** Total number of swaps */
  totalSwaps: number;
  /** Successful swaps */
  successfulSwaps: number;
  /** Failed swaps */
  failedSwaps: number;
  /** Pending swaps */
  pendingSwaps: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Total volume in USD (estimated) */
  totalVolumeUsd: number;
  /** Average slippage used */
  averageSlippageBps: number;
  /** Average price impact */
  averagePriceImpactPct: number;
  /** Protected mode usage rate */
  protectedModeRate: number;
  /** Top traded tokens */
  topTokens: { token: string; count: number; volume: string }[];
  /** Swaps over time */
  swapsOverTime: { timestamp: number; count: number; volume: number }[];
}

/**
 * Intent analytics data
 */
export interface IntentAnalytics {
  /** Total intents created */
  totalIntents: number;
  /** Active intents */
  activeIntents: number;
  /** Completed intents */
  completedIntents: number;
  /** Cancelled intents */
  cancelledIntents: number;
  /** Failed intents */
  failedIntents: number;
  /** DCA specific stats */
  dcaStats: {
    totalOrders: number;
    activeOrders: number;
    totalSlicesExecuted: number;
    averageOrderSize: number;
  };
  /** Stop-loss specific stats */
  stopLossStats: {
    totalOrders: number;
    activeOrders: number;
    triggeredOrders: number;
    averageTriggerDistance: number;
  };
}

/**
 * User analytics data
 */
export interface UserAnalytics {
  /** Total unique users */
  totalUsers: number;
  /** Active users (made transaction in period) */
  activeUsers: number;
  /** New users in period */
  newUsers: number;
  /** User retention rate */
  retentionRate: number;
  /** Average swaps per user */
  averageSwapsPerUser: number;
  /** Power users (>10 swaps) */
  powerUsers: number;
}

/**
 * Execution quality metrics
 */
export interface ExecutionQuality {
  /** Average execution time (ms) */
  averageExecutionTimeMs: number;
  /** RPC success rate */
  rpcSuccessRate: number;
  /** Average retry count */
  averageRetries: number;
  /** Price impact vs quoted difference */
  averageSlippageDifference: number;
  /** Quote vs actual difference */
  quoteAccuracy: number;
}

/**
 * Platform overview
 */
export interface PlatformOverview {
  swaps: SwapAnalytics;
  intents: IntentAnalytics;
  users: UserAnalytics;
  execution: ExecutionQuality;
  timeRange: TimeRange;
  generatedAt: number;
}

/**
 * Analytics Service
 *
 * Provides comprehensive analytics for the FlowMint platform.
 */
export class AnalyticsService {
  private readonly log = logger.child({ service: 'AnalyticsService' });

  constructor(private readonly db: DatabaseService) {
    this.log.info('AnalyticsService initialized');
  }

  /**
   * Get platform overview
   */
  async getPlatformOverview(timeRange: TimeRange = '24h'): Promise<PlatformOverview> {
    const [swaps, intents, users, execution] = await Promise.all([
      this.getSwapAnalytics(timeRange),
      this.getIntentAnalytics(timeRange),
      this.getUserAnalytics(timeRange),
      this.getExecutionQuality(timeRange),
    ]);

    return {
      swaps,
      intents,
      users,
      execution,
      timeRange,
      generatedAt: Date.now(),
    };
  }

  /**
   * Get swap analytics
   */
  async getSwapAnalytics(timeRange: TimeRange = '24h'): Promise<SwapAnalytics> {
    const since = this.getTimestamp(timeRange);
    const receipts = await this.db.getReceiptsSince(since);

    const totalSwaps = receipts.length;
    const successfulSwaps = receipts.filter(r => r.status === 'success').length;
    const failedSwaps = receipts.filter(r => r.status === 'failed').length;
    const pendingSwaps = receipts.filter(r => r.status === 'pending').length;

    const successRate = totalSwaps > 0 ? successfulSwaps / totalSwaps : 0;

    // Calculate averages
    let totalSlippage = 0;
    let totalPriceImpact = 0;
    let protectedModeCount = 0;
    const tokenCounts = new Map<string, { count: number; volume: bigint }>();

    for (const receipt of receipts) {
      totalSlippage += receipt.slippageBps;
      totalPriceImpact += parseFloat(receipt.priceImpactPct);
      if (receipt.protectedMode) protectedModeCount++;

      // Track tokens
      const inputData = tokenCounts.get(receipt.inputMint) || { count: 0, volume: 0n };
      inputData.count++;
      inputData.volume += BigInt(receipt.inAmount);
      tokenCounts.set(receipt.inputMint, inputData);
    }

    // Top tokens
    const topTokens = Array.from(tokenCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([token, data]) => ({
        token,
        count: data.count,
        volume: data.volume.toString(),
      }));

    // Swaps over time (hourly buckets for 24h, daily for longer)
    const bucketSize = timeRange === '1h' ? 60000 : timeRange === '24h' ? 3600000 : 86400000;
    const swapsOverTime = this.bucketByTime(receipts, bucketSize);

    return {
      totalSwaps,
      successfulSwaps,
      failedSwaps,
      pendingSwaps,
      successRate,
      totalVolumeUsd: 0, // Would need price oracle
      averageSlippageBps: totalSwaps > 0 ? totalSlippage / totalSwaps : 0,
      averagePriceImpactPct: totalSwaps > 0 ? totalPriceImpact / totalSwaps : 0,
      protectedModeRate: totalSwaps > 0 ? protectedModeCount / totalSwaps : 0,
      topTokens,
      swapsOverTime,
    };
  }

  /**
   * Get intent analytics
   */
  async getIntentAnalytics(timeRange: TimeRange = '24h'): Promise<IntentAnalytics> {
    const since = this.getTimestamp(timeRange);
    const intents = await this.db.getIntentsSince(since);
    const allActive = await this.db.getAllActiveIntents();

    const totalIntents = intents.length;
    const activeIntents = allActive.length;
    const completedIntents = intents.filter(i => i.status === 'completed').length;
    const cancelledIntents = intents.filter(i => i.status === 'cancelled').length;
    const failedIntents = intents.filter(i => i.status === 'failed').length;

    // DCA stats
    const dcaIntents = intents.filter(i => i.intentType === 'DCA');
    const activeDca = allActive.filter(i => i.intentType === 'DCA');
    const totalSlices = dcaIntents.reduce((sum, i) => sum + i.executionCount, 0);

    // Stop-loss stats
    const stopLossIntents = intents.filter(i => i.intentType === 'STOP_LOSS');
    const activeStopLoss = allActive.filter(i => i.intentType === 'STOP_LOSS');
    const triggeredStopLoss = stopLossIntents.filter(i => i.status === 'completed').length;

    return {
      totalIntents,
      activeIntents,
      completedIntents,
      cancelledIntents,
      failedIntents,
      dcaStats: {
        totalOrders: dcaIntents.length,
        activeOrders: activeDca.length,
        totalSlicesExecuted: totalSlices,
        averageOrderSize:
          dcaIntents.length > 0
            ? dcaIntents.reduce((sum, i) => sum + parseInt(i.totalAmount), 0) / dcaIntents.length
            : 0,
      },
      stopLossStats: {
        totalOrders: stopLossIntents.length,
        activeOrders: activeStopLoss.length,
        triggeredOrders: triggeredStopLoss,
        averageTriggerDistance: 0, // Would need price data
      },
    };
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(timeRange: TimeRange = '24h'): Promise<UserAnalytics> {
    const since = this.getTimestamp(timeRange);
    const userStats = await this.db.getUserStats(since);

    return {
      totalUsers: userStats.totalUsers,
      activeUsers: userStats.activeUsers,
      newUsers: userStats.newUsers,
      retentionRate: userStats.totalUsers > 0 ? userStats.returningUsers / userStats.totalUsers : 0,
      averageSwapsPerUser:
        userStats.activeUsers > 0 ? userStats.totalSwaps / userStats.activeUsers : 0,
      powerUsers: userStats.powerUsers,
    };
  }

  /**
   * Get execution quality metrics
   */
  async getExecutionQuality(timeRange: TimeRange = '24h'): Promise<ExecutionQuality> {
    const since = this.getTimestamp(timeRange);
    const executionStats = await this.db.getExecutionStats(since);

    return {
      averageExecutionTimeMs: executionStats.averageExecutionTimeMs,
      rpcSuccessRate: executionStats.rpcSuccessRate,
      averageRetries: executionStats.averageRetries,
      averageSlippageDifference: executionStats.averageSlippageDifference,
      quoteAccuracy: executionStats.quoteAccuracy,
    };
  }

  /**
   * Get user-specific analytics
   */
  async getUserSwapAnalytics(userPublicKey: string): Promise<{
    totalSwaps: number;
    successRate: number;
    totalVolume: string;
    averagePriceImpact: number;
    favoriteTokens: string[];
    recentSwaps: any[];
  }> {
    const receipts = await this.db.getUserReceipts(userPublicKey, 100);

    const totalSwaps = receipts.length;
    const successfulSwaps = receipts.filter(r => r.status === 'success').length;
    const successRate = totalSwaps > 0 ? successfulSwaps / totalSwaps : 0;

    let totalPriceImpact = 0;
    const tokenCounts = new Map<string, number>();

    for (const receipt of receipts) {
      totalPriceImpact += parseFloat(receipt.priceImpactPct);
      tokenCounts.set(receipt.inputMint, (tokenCounts.get(receipt.inputMint) || 0) + 1);
      tokenCounts.set(receipt.outputMint, (tokenCounts.get(receipt.outputMint) || 0) + 1);
    }

    const favoriteTokens = Array.from(tokenCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([token]) => token);

    return {
      totalSwaps,
      successRate,
      totalVolume: '0', // Would need price oracle
      averagePriceImpact: totalSwaps > 0 ? totalPriceImpact / totalSwaps : 0,
      favoriteTokens,
      recentSwaps: receipts.slice(0, 10),
    };
  }

  /**
   * Get comparison metrics (actual vs estimated)
   */
  async getComparisonMetrics(receiptId: string): Promise<{
    estimatedOutput: string;
    actualOutput: string;
    difference: string;
    differencePercent: number;
    slippageUsed: number;
    actualSlippage: number;
  } | null> {
    const receipt = await this.db.getReceipt(receiptId);
    if (!receipt) return null;

    const comparison = await this.db.getReceiptComparison(receiptId);
    if (!comparison) {
      return {
        estimatedOutput: receipt.outAmount,
        actualOutput: receipt.outAmount,
        difference: '0',
        differencePercent: 0,
        slippageUsed: receipt.slippageBps,
        actualSlippage: 0,
      };
    }

    return comparison;
  }

  /**
   * Convert time range to timestamp
   */
  private getTimestamp(timeRange: TimeRange): number {
    const now = Date.now();
    switch (timeRange) {
      case '1h':
        return now - 3600000;
      case '24h':
        return now - 86400000;
      case '7d':
        return now - 604800000;
      case '30d':
        return now - 2592000000;
      case 'all':
        return 0;
    }
  }

  /**
   * Bucket data by time
   */
  private bucketByTime(
    receipts: any[],
    bucketSize: number
  ): { timestamp: number; count: number; volume: number }[] {
    const buckets = new Map<number, { count: number; volume: number }>();

    for (const receipt of receipts) {
      const bucket = Math.floor(receipt.timestamp / bucketSize) * bucketSize;
      const existing = buckets.get(bucket) || { count: 0, volume: 0 };
      existing.count++;
      existing.volume += parseInt(receipt.inAmount) || 0;
      buckets.set(bucket, existing);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([timestamp, data]) => ({
        timestamp,
        count: data.count,
        volume: data.volume,
      }));
  }
}
