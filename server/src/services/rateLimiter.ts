/**
 * RateLimiter - V2 Rate Limiting and Spam Protection
 *
 * Provides configurable rate limiting per IP, merchant, and wallet.
 * Supports sliding window and token bucket algorithms.
 */

import { logger } from '../utils/logger';

const log = logger.child({ service: 'RateLimiter' });

// ==================== Types ====================

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  blockDurationMs?: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
  blocked?: boolean;
}

export interface RateLimitEntry {
  count: number;
  windowStart: number;
  blocked?: boolean;
  blockedUntil?: number;
}

export interface DynamicPricingConfig {
  baseFee: number; // 0.5% = 50 bps
  congestionThreshold: number; // requests per minute
  maxFee: number; // max fee in bps
  feeIncrementPerThreshold: number; // bps per threshold exceeded
}

export type RateLimitType =
  | 'ip'
  | 'merchant'
  | 'wallet'
  | 'endpoint'
  | 'global';

// ==================== Default Configs ====================

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  // IP-based limits
  'ip:default': {
    maxRequests: 60,
    windowMs: 60_000, // 60 req/min
    blockDurationMs: 5 * 60_000, // 5 min block
    keyPrefix: 'ip',
  },
  'ip:createInvoice': {
    maxRequests: 10,
    windowMs: 60_000, // 10 invoices/min
    blockDurationMs: 10 * 60_000,
    keyPrefix: 'ip:inv',
  },

  // Merchant-based limits
  'merchant:daily': {
    maxRequests: 10_000,
    windowMs: 24 * 60 * 60_000, // 10k/day
    keyPrefix: 'merch:day',
  },
  'merchant:perMinute': {
    maxRequests: 100,
    windowMs: 60_000, // 100/min
    keyPrefix: 'merch:min',
  },

  // Wallet-based limits
  'wallet:payments': {
    maxRequests: 20,
    windowMs: 60_000, // 20 payments/min per wallet
    blockDurationMs: 2 * 60_000,
    keyPrefix: 'wallet',
  },

  // Endpoint-specific
  'endpoint:quote': {
    maxRequests: 30,
    windowMs: 60_000, // 30 quotes/min
    keyPrefix: 'quote',
  },

  // Global limits
  'global:default': {
    maxRequests: 1000,
    windowMs: 1_000, // 1000 req/sec global
    keyPrefix: 'global',
  },
};

// ==================== Service ====================

export class RateLimiter {
  private entries: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private requestCounts: Map<string, number[]> = new Map(); // For congestion tracking

  constructor(private customLimits: Record<string, RateLimitConfig> = {}) {
    // Start cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      60_000 // Every minute
    );
  }

  /**
   * Check and consume rate limit
   */
  check(
    type: RateLimitType,
    key: string,
    endpoint?: string
  ): RateLimitResult {
    const limitKey = this.getLimitKey(type, endpoint);
    const config = this.getConfig(limitKey);
    const entryKey = `${config.keyPrefix}:${key}`;

    const now = Date.now();
    let entry = this.entries.get(entryKey);

    // Check if blocked
    if (entry?.blocked && entry.blockedUntil) {
      if (now < entry.blockedUntil) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: entry.blockedUntil,
          retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
          blocked: true,
        };
      }
      // Block expired, reset entry
      entry = undefined;
    }

    // Initialize or reset window
    if (!entry || now - entry.windowStart >= config.windowMs) {
      entry = {
        count: 0,
        windowStart: now,
      };
    }

    // Check limit
    if (entry.count >= config.maxRequests) {
      // Block if configured
      if (config.blockDurationMs) {
        entry.blocked = true;
        entry.blockedUntil = now + config.blockDurationMs;
        this.entries.set(entryKey, entry);

        log.warn(
          { type, key, blockedUntil: entry.blockedUntil },
          'Rate limit exceeded, blocking'
        );
      }

      const resetAt = entry.windowStart + config.windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: Math.ceil((resetAt - now) / 1000),
      };
    }

    // Consume and update
    entry.count++;
    this.entries.set(entryKey, entry);

    // Track for congestion pricing
    this.trackRequest(type);

    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      resetAt: entry.windowStart + config.windowMs,
    };
  }

  /**
   * Check without consuming
   */
  peek(
    type: RateLimitType,
    key: string,
    endpoint?: string
  ): RateLimitResult {
    const limitKey = this.getLimitKey(type, endpoint);
    const config = this.getConfig(limitKey);
    const entryKey = `${config.keyPrefix}:${key}`;

    const now = Date.now();
    const entry = this.entries.get(entryKey);

    if (!entry || now - entry.windowStart >= config.windowMs) {
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt: now + config.windowMs,
      };
    }

    if (entry.blocked && entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.blockedUntil,
        blocked: true,
      };
    }

    return {
      allowed: entry.count < config.maxRequests,
      remaining: Math.max(0, config.maxRequests - entry.count),
      resetAt: entry.windowStart + config.windowMs,
    };
  }

  /**
   * Get current congestion level (0-1)
   */
  getCongestionLevel(): number {
    const now = Date.now();
    const windowMs = 60_000;
    const threshold = 500; // requests per minute for max congestion

    let totalRequests = 0;
    for (const [, timestamps] of this.requestCounts) {
      const recent = timestamps.filter((t) => now - t < windowMs);
      totalRequests += recent.length;
    }

    return Math.min(1, totalRequests / threshold);
  }

  /**
   * Calculate dynamic fee based on congestion
   */
  getDynamicFee(config: DynamicPricingConfig = {
    baseFee: 50, // 0.5%
    congestionThreshold: 100,
    maxFee: 150, // 1.5%
    feeIncrementPerThreshold: 10, // 0.1% per threshold
  }): number {
    const congestion = this.getCongestionLevel();
    const additionalFee = Math.floor(
      congestion * (config.maxFee - config.baseFee)
    );
    return Math.min(config.maxFee, config.baseFee + additionalFee);
  }

  /**
   * Reset rate limit for a key
   */
  reset(type: RateLimitType, key: string, endpoint?: string): void {
    const limitKey = this.getLimitKey(type, endpoint);
    const config = this.getConfig(limitKey);
    const entryKey = `${config.keyPrefix}:${key}`;
    this.entries.delete(entryKey);
    log.debug({ type, key }, 'Rate limit reset');
  }

  /**
   * Unblock a key
   */
  unblock(type: RateLimitType, key: string, endpoint?: string): void {
    const limitKey = this.getLimitKey(type, endpoint);
    const config = this.getConfig(limitKey);
    const entryKey = `${config.keyPrefix}:${key}`;

    const entry = this.entries.get(entryKey);
    if (entry) {
      entry.blocked = false;
      entry.blockedUntil = undefined;
      this.entries.set(entryKey, entry);
      log.info({ type, key }, 'Key unblocked');
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    totalEntries: number;
    blockedEntries: number;
    congestionLevel: number;
  } {
    let blockedCount = 0;
    const now = Date.now();

    for (const entry of this.entries.values()) {
      if (entry.blocked && entry.blockedUntil && now < entry.blockedUntil) {
        blockedCount++;
      }
    }

    return {
      totalEntries: this.entries.size,
      blockedEntries: blockedCount,
      congestionLevel: this.getCongestionLevel(),
    };
  }

  /**
   * Express middleware factory
   */
  middleware(
    type: RateLimitType = 'ip',
    keyExtractor?: (req: any) => string,
    endpoint?: string
  ) {
    return (req: any, res: any, next: any) => {
      const key = keyExtractor
        ? keyExtractor(req)
        : req.ip || req.connection?.remoteAddress || 'unknown';

      const result = this.check(type, key, endpoint);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', this.getConfig(this.getLimitKey(type, endpoint)).maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));

      if (!result.allowed) {
        if (result.retryAfter) {
          res.setHeader('Retry-After', result.retryAfter);
        }

        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
          blocked: result.blocked,
        });
      }

      next();
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.entries) {
      // Find the matching config by prefix
      const prefix = key.split(':')[0];
      let maxWindow = 24 * 60 * 60_000; // Default 24h

      for (const config of Object.values({
        ...DEFAULT_LIMITS,
        ...this.customLimits,
      })) {
        if (config.keyPrefix === prefix && config.windowMs > maxWindow) {
          maxWindow = config.windowMs;
        }
      }

      // Clean if entry is stale and not blocked
      const isStale = now - entry.windowStart > maxWindow * 2;
      const isBlockExpired =
        entry.blocked && entry.blockedUntil && now > entry.blockedUntil;

      if (isStale || isBlockExpired) {
        this.entries.delete(key);
        cleaned++;
      }
    }

    // Cleanup request counts
    for (const [type, timestamps] of this.requestCounts) {
      const recent = timestamps.filter((t) => now - t < 60_000);
      if (recent.length === 0) {
        this.requestCounts.delete(type);
      } else {
        this.requestCounts.set(type, recent);
      }
    }

    if (cleaned > 0) {
      log.debug({ cleaned }, 'Rate limit entries cleaned');
    }
  }

  /**
   * Track request for congestion monitoring
   */
  private trackRequest(type: RateLimitType): void {
    const timestamps = this.requestCounts.get(type) || [];
    timestamps.push(Date.now());
    this.requestCounts.set(type, timestamps);
  }

  private getLimitKey(type: RateLimitType, endpoint?: string): string {
    if (endpoint) {
      return `${type}:${endpoint}`;
    }
    return `${type}:default`;
  }

  private getConfig(limitKey: string): RateLimitConfig {
    return (
      this.customLimits[limitKey] ||
      DEFAULT_LIMITS[limitKey] ||
      DEFAULT_LIMITS[`${limitKey.split(':')[0]}:default`] ||
      DEFAULT_LIMITS['global:default']
    );
  }

  /**
   * Shutdown cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.entries.clear();
    this.requestCounts.clear();
    log.info('RateLimiter shutdown');
  }
}

// ==================== Spam Detection ====================

export class SpamDetector {
  private suspiciousPatterns: Map<string, number> = new Map();
  private readonly maxScore = 100;
  private readonly blockThreshold = 80;

  /**
   * Check if request is suspicious
   */
  checkRequest(
    ip: string,
    userAgent?: string,
    path?: string
  ): { suspicious: boolean; score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = this.suspiciousPatterns.get(ip) || 0;

    // Check user agent
    if (!userAgent || userAgent.length < 10) {
      score += 20;
      reasons.push('Missing or short user-agent');
    }

    // Bot patterns
    const botPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /curl/i,
      /wget/i,
      /python-requests/i,
    ];
    if (userAgent && botPatterns.some((p) => p.test(userAgent))) {
      score += 15;
      reasons.push('Bot user-agent detected');
    }

    // Rapid path changes (would need request history)

    // Update score
    this.suspiciousPatterns.set(ip, Math.min(this.maxScore, score));

    return {
      suspicious: score >= this.blockThreshold,
      score,
      reasons,
    };
  }

  /**
   * Decay scores over time
   */
  decayScores(): void {
    for (const [ip, score] of this.suspiciousPatterns) {
      const newScore = Math.max(0, score - 5);
      if (newScore === 0) {
        this.suspiciousPatterns.delete(ip);
      } else {
        this.suspiciousPatterns.set(ip, newScore);
      }
    }
  }

  /**
   * Increase score for IP
   */
  reportSuspicious(ip: string, amount: number = 20): void {
    const current = this.suspiciousPatterns.get(ip) || 0;
    this.suspiciousPatterns.set(
      ip,
      Math.min(this.maxScore, current + amount)
    );
  }

  /**
   * Clear IP score
   */
  clearIp(ip: string): void {
    this.suspiciousPatterns.delete(ip);
  }
}

// ==================== Singleton ====================

let rateLimiterInstance: RateLimiter | null = null;
let spamDetectorInstance: SpamDetector | null = null;

export function getRateLimiter(
  customLimits?: Record<string, RateLimitConfig>
): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(customLimits);
  }
  return rateLimiterInstance;
}

export function getSpamDetector(): SpamDetector {
  if (!spamDetectorInstance) {
    spamDetectorInstance = new SpamDetector();
  }
  return spamDetectorInstance;
}

export default RateLimiter;
