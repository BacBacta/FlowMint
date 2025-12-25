/**
 * Oracle Service
 *
 * Provides price data from Pyth Network with:
 * - Staleness checking
 * - Confidence interval validation
 * - Caching with TTL
 * - Fallback handling
 */

import axios from 'axios';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ service: 'Oracle' });

/**
 * Pyth Hermes API endpoint
 */
const PYTH_HERMES_URL = 'https://hermes.pyth.network';

/**
 * Well-known Pyth price feed IDs
 */
export const PYTH_FEED_IDS: Record<string, string> = {
  // Major tokens
  'SOL/USD': 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'BTC/USD': 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH/USD': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'USDC/USD': 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT/USD': '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  'BONK/USD': '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  'JUP/USD': '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  'RAY/USD': '91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a',
};

/**
 * Staleness thresholds in seconds
 */
export const STALENESS_THRESHOLDS = {
  /** Maximum age for trading decisions */
  TRADING: 30,
  /** Maximum age for stop-loss triggers */
  STOP_LOSS: 60,
  /** Maximum age for display purposes */
  DISPLAY: 300,
  /** Maximum age before considered completely stale */
  STALE: 600,
};

/**
 * Confidence thresholds (as percentage of price)
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Maximum confidence interval for trading */
  TRADING: 0.5, // 0.5%
  /** Maximum confidence interval for stop-loss */
  STOP_LOSS: 1.0, // 1%
};

/**
 * Price data from oracle
 */
export interface OraclePrice {
  /** Feed ID */
  feedId: string;
  /** Price pair (e.g., "SOL/USD") */
  pair: string;
  /** Current price */
  price: number;
  /** Confidence interval (same units as price) */
  confidence: number;
  /** Confidence as percentage of price */
  confidencePct: number;
  /** Exponential moving average price */
  emaPrice: number;
  /** Publish time (Unix timestamp) */
  publishTime: number;
  /** Age in seconds */
  ageSeconds: number;
  /** Whether price is considered stale */
  isStale: boolean;
  /** Staleness level */
  stalenessLevel: 'fresh' | 'acceptable' | 'stale' | 'very_stale';
}

/**
 * Price check result for stop-loss
 */
export interface PriceCheckResult {
  price: OraclePrice;
  triggered: boolean;
  reason: string;
  canExecute: boolean;
}

/**
 * Cache entry
 */
interface CacheEntry {
  price: OraclePrice;
  fetchedAt: number;
}

/**
 * Oracle Service class
 */
export class OracleService {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  /**
   * Get price for a feed
   */
  async getPrice(feedId: string, pair?: string): Promise<OraclePrice | null> {
    // Check cache first
    const cached = this.cache.get(feedId);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      // Update age
      cached.price.ageSeconds = Math.floor(Date.now() / 1000 - cached.price.publishTime);
      cached.price.isStale = cached.price.ageSeconds > STALENESS_THRESHOLDS.TRADING;
      cached.price.stalenessLevel = this.getStalenessLevel(cached.price.ageSeconds);
      return cached.price;
    }

    try {
      const response = await axios.get(`${PYTH_HERMES_URL}/api/latest_price_feeds`, {
        params: {
          ids: [feedId],
        },
        timeout: 10000,
      });

      if (!response.data || response.data.length === 0) {
        log.warn({ feedId }, 'No price data returned from Pyth');
        return null;
      }

      const priceData = response.data[0];
      const price = this.parsePythPrice(priceData, feedId, pair);

      // Cache the result
      this.cache.set(feedId, {
        price,
        fetchedAt: Date.now(),
      });

      return price;
    } catch (error) {
      log.error({ feedId, error }, 'Failed to fetch price from Pyth');

      // Return cached if available (even if stale)
      if (cached) {
        log.warn({ feedId }, 'Returning stale cached price');
        cached.price.ageSeconds = Math.floor(Date.now() / 1000 - cached.price.publishTime);
        cached.price.isStale = true;
        cached.price.stalenessLevel = 'very_stale';
        return cached.price;
      }

      return null;
    }
  }

  /**
   * Get price by pair name (e.g., "SOL/USD")
   */
  async getPriceByPair(pair: string): Promise<OraclePrice | null> {
    const feedId = PYTH_FEED_IDS[pair];
    if (!feedId) {
      log.warn({ pair }, 'Unknown price pair');
      return null;
    }
    return this.getPrice(feedId, pair);
  }

  /**
   * Get multiple prices at once
   */
  async getPrices(pairs: string[]): Promise<Map<string, OraclePrice>> {
    const results = new Map<string, OraclePrice>();

    // Filter to known pairs
    const feedIds = pairs
      .map(pair => ({ pair, feedId: PYTH_FEED_IDS[pair] }))
      .filter(item => item.feedId !== undefined);

    if (feedIds.length === 0) {
      return results;
    }

    try {
      const response = await axios.get(`${PYTH_HERMES_URL}/api/latest_price_feeds`, {
        params: {
          ids: feedIds.map(f => f.feedId),
        },
        timeout: 10000,
      });

      if (response.data && Array.isArray(response.data)) {
        for (const priceData of response.data) {
          const feedInfo = feedIds.find(f => f.feedId === priceData.id);
          if (feedInfo) {
            const price = this.parsePythPrice(priceData, feedInfo.feedId, feedInfo.pair);
            results.set(feedInfo.pair, price);

            // Cache
            this.cache.set(feedInfo.feedId, {
              price,
              fetchedAt: Date.now(),
            });
          }
        }
      }
    } catch (error) {
      log.error({ pairs, error }, 'Failed to fetch prices from Pyth');
    }

    return results;
  }

  /**
   * Check if price triggers stop-loss
   */
  async checkStopLossTrigger(
    feedId: string,
    threshold: number,
    direction: 'above' | 'below'
  ): Promise<PriceCheckResult> {
    const price = await this.getPrice(feedId);

    if (!price) {
      return {
        price: null as any,
        triggered: false,
        reason: 'Price feed unavailable',
        canExecute: false,
      };
    }

    // Check staleness for stop-loss
    if (price.ageSeconds > STALENESS_THRESHOLDS.STOP_LOSS) {
      return {
        price,
        triggered: false,
        reason: `Price is too stale (${price.ageSeconds}s old)`,
        canExecute: false,
      };
    }

    // Check confidence
    if (price.confidencePct > CONFIDENCE_THRESHOLDS.STOP_LOSS) {
      return {
        price,
        triggered: false,
        reason: `Price confidence too low (±${price.confidencePct.toFixed(2)}%)`,
        canExecute: false,
      };
    }

    // Check trigger condition
    const triggered = direction === 'below' ? price.price <= threshold : price.price >= threshold;

    return {
      price,
      triggered,
      reason: triggered
        ? `Price ${price.price.toFixed(6)} ${direction === 'below' ? '≤' : '≥'} ${threshold}`
        : `Price ${price.price.toFixed(6)} has not reached ${threshold}`,
      canExecute: triggered,
    };
  }

  /**
   * Validate price for trading
   */
  validatePriceForTrading(price: OraclePrice): {
    valid: boolean;
    reason?: string;
  } {
    if (price.ageSeconds > STALENESS_THRESHOLDS.TRADING) {
      return {
        valid: false,
        reason: `Price is stale (${price.ageSeconds}s old, max ${STALENESS_THRESHOLDS.TRADING}s)`,
      };
    }

    if (price.confidencePct > CONFIDENCE_THRESHOLDS.TRADING) {
      return {
        valid: false,
        reason: `Price confidence too low (±${price.confidencePct.toFixed(2)}%, max ${CONFIDENCE_THRESHOLDS.TRADING}%)`,
      };
    }

    return { valid: true };
  }

  /**
   * Parse Pyth price response
   */
  private parsePythPrice(data: any, feedId: string, pair?: string): OraclePrice {
    const priceInfo = data.price;
    const emaInfo = data.ema_price;

    // Parse price with exponent
    const price = this.parseFixedPoint(priceInfo.price, priceInfo.expo);
    const confidence = this.parseFixedPoint(priceInfo.conf, priceInfo.expo);
    const emaPrice = this.parseFixedPoint(emaInfo.price, emaInfo.expo);

    const confidencePct = (confidence / price) * 100;
    const publishTime = priceInfo.publish_time;
    const ageSeconds = Math.floor(Date.now() / 1000 - publishTime);

    return {
      feedId,
      pair: pair || feedId.slice(0, 8),
      price,
      confidence,
      confidencePct,
      emaPrice,
      publishTime,
      ageSeconds,
      isStale: ageSeconds > STALENESS_THRESHOLDS.TRADING,
      stalenessLevel: this.getStalenessLevel(ageSeconds),
    };
  }

  /**
   * Parse fixed point number
   */
  private parseFixedPoint(value: string | number, expo: number): number {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return numValue * Math.pow(10, expo);
  }

  /**
   * Get staleness level
   */
  private getStalenessLevel(ageSeconds: number): OraclePrice['stalenessLevel'] {
    if (ageSeconds <= STALENESS_THRESHOLDS.TRADING) return 'fresh';
    if (ageSeconds <= STALENESS_THRESHOLDS.STOP_LOSS) return 'acceptable';
    if (ageSeconds <= STALENESS_THRESHOLDS.STALE) return 'stale';
    return 'very_stale';
  }

  /**
   * Get feed ID for a token mint
   */
  getFeedIdForToken(tokenSymbol: string): string | null {
    const pair = `${tokenSymbol}/USD`;
    return PYTH_FEED_IDS[pair] || null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const oracleService = new OracleService();
