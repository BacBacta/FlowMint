/**
 * Risk Scoring Service
 *
 * Provides comprehensive risk assessment for swaps with:
 * - Quote-based risk (price impact, slippage, route quality)
 * - Token hygiene checks (freeze authority, mint authority, extensions)
 * - Size vs liquidity analysis
 * - Traffic light scoring (GREEN, AMBER, RED)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import {
  SLIPPAGE_SETTINGS,
  PRICE_IMPACT_THRESHOLDS,
  SIZE_LIMITS,
  TOKEN_SAFETY_CHECKS,
  TOKEN_BLACKLIST,
  TOKEN_WHITELIST,
  KNOWN_TOKENS,
} from '../config/risk-policies.js';
import { QuoteResponse } from './jupiterService.js';

const log = logger.child({ service: 'RiskScoring' });

/**
 * Risk level (traffic light)
 */
export enum RiskSignal {
  GREEN = 'GREEN',
  AMBER = 'AMBER',
  RED = 'RED',
}

/**
 * Individual risk reason
 */
export interface RiskReason {
  code: string;
  severity: RiskSignal;
  message: string;
  detail?: string;
  threshold?: { used: number; limit: number };
}

/**
 * Token safety info
 */
export interface TokenSafetyInfo {
  mint: string;
  symbol?: string;
  hasFreezeAuthority: boolean;
  hasMintAuthority: boolean;
  isToken2022: boolean;
  hasTransferFee: boolean;
  decimals: number;
  isKnownToken: boolean;
  isBlacklisted: boolean;
  isWhitelisted: boolean;
}

/**
 * Full risk assessment result
 */
export interface RiskAssessment {
  /** Overall risk level */
  level: RiskSignal;
  /** Individual risk reasons */
  reasons: RiskReason[];
  /** Token safety info for input */
  inputTokenSafety: TokenSafetyInfo | null;
  /** Token safety info for output */
  outputTokenSafety: TokenSafetyInfo | null;
  /** Whether execution should be blocked in protected mode */
  blockedInProtectedMode: boolean;
  /** Whether user acknowledgement required */
  requiresAcknowledgement: boolean;
  /** Quote age in seconds */
  quoteAgeSeconds: number;
  /** Thresholds used for assessment */
  thresholdsUsed: Record<string, number>;
  /** Timestamp of assessment */
  timestamp: number;
}

/**
 * Swap request for scoring
 */
export interface ScoreSwapRequest {
  inputMint: string;
  outputMint: string;
  amountIn: string;
  slippageBps: number;
  protectedMode: boolean;
  quoteTimestamp?: number;
}

/**
 * Risk Scoring Service
 */
export class RiskScoringService {
  private connection: Connection;
  private tokenInfoCache: Map<string, TokenSafetyInfo> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
    });
  }

  /**
   * Score a swap request with quote
   */
  async scoreSwap(
    request: ScoreSwapRequest,
    quote: QuoteResponse
  ): Promise<RiskAssessment> {
    const timestamp = Date.now();
    const reasons: RiskReason[] = [];
    const thresholdsUsed: Record<string, number> = {};

    log.debug(
      { inputMint: request.inputMint, outputMint: request.outputMint },
      'Scoring swap'
    );

    // 1. Score quote mechanics
    this.scoreQuoteMechanics(quote, request, reasons, thresholdsUsed);

    // 2. Score quote freshness
    const quoteAgeSeconds = this.scoreQuoteFreshness(
      request.quoteTimestamp,
      reasons,
      thresholdsUsed
    );

    // 3. Check token safety (async)
    const [inputTokenSafety, outputTokenSafety] = await Promise.all([
      this.getTokenSafetyInfo(request.inputMint),
      this.getTokenSafetyInfo(request.outputMint),
    ]);

    // Score token hygiene
    this.scoreTokenHygiene(inputTokenSafety, 'input', reasons);
    this.scoreTokenHygiene(outputTokenSafety, 'output', reasons);

    // 4. Score size vs liquidity
    this.scoreSizeVsLiquidity(request, quote, reasons, thresholdsUsed);

    // Calculate overall level
    const level = this.calculateOverallLevel(reasons);

    // Determine blocking rules
    const blockedInProtectedMode =
      level === RiskSignal.RED ||
      (request.protectedMode && level === RiskSignal.AMBER);

    const requiresAcknowledgement =
      level === RiskSignal.AMBER && !request.protectedMode;

    log.info(
      {
        level,
        reasonCount: reasons.length,
        blockedInProtectedMode,
        quoteAgeSeconds,
      },
      'Risk assessment complete'
    );

    return {
      level,
      reasons,
      inputTokenSafety,
      outputTokenSafety,
      blockedInProtectedMode,
      requiresAcknowledgement,
      quoteAgeSeconds,
      thresholdsUsed,
      timestamp,
    };
  }

  /**
   * Score quote mechanical risks
   */
  private scoreQuoteMechanics(
    quote: QuoteResponse,
    request: ScoreSwapRequest,
    reasons: RiskReason[],
    thresholds: Record<string, number>
  ): void {
    const priceImpact = parseFloat(quote.priceImpactPct);

    // Price impact thresholds depend on mode
    const maxImpact = request.protectedMode
      ? PRICE_IMPACT_THRESHOLDS.MAX_PROTECTED_PCT
      : PRICE_IMPACT_THRESHOLDS.MAX_NORMAL_PCT;

    thresholds['priceImpactLimit'] = maxImpact;

    if (priceImpact > PRICE_IMPACT_THRESHOLDS.ABSOLUTE_MAX_PCT) {
      reasons.push({
        code: 'PRICE_IMPACT_CRITICAL',
        severity: RiskSignal.RED,
        message: 'Extremely high price impact',
        detail: `Price impact of ${priceImpact.toFixed(2)}% exceeds absolute maximum`,
        threshold: { used: priceImpact, limit: PRICE_IMPACT_THRESHOLDS.ABSOLUTE_MAX_PCT },
      });
    } else if (priceImpact > maxImpact) {
      reasons.push({
        code: 'PRICE_IMPACT_HIGH',
        severity: RiskSignal.AMBER,
        message: 'High price impact',
        detail: `Price impact of ${priceImpact.toFixed(2)}% exceeds limit for ${request.protectedMode ? 'protected' : 'standard'} mode`,
        threshold: { used: priceImpact, limit: maxImpact },
      });
    } else if (priceImpact > PRICE_IMPACT_THRESHOLDS.WARNING_PCT) {
      reasons.push({
        code: 'PRICE_IMPACT_WARNING',
        severity: RiskSignal.GREEN,
        message: 'Notable price impact',
        detail: `Price impact of ${priceImpact.toFixed(2)}%`,
        threshold: { used: priceImpact, limit: PRICE_IMPACT_THRESHOLDS.WARNING_PCT },
      });
    }

    // Slippage check
    const maxSlippage = request.protectedMode
      ? SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS
      : SLIPPAGE_SETTINGS.DEFAULT_MAX_BPS;

    thresholds['slippageLimit'] = maxSlippage;

    if (request.slippageBps > SLIPPAGE_SETTINGS.ABSOLUTE_MAX_BPS) {
      reasons.push({
        code: 'SLIPPAGE_CRITICAL',
        severity: RiskSignal.RED,
        message: 'Extremely high slippage tolerance',
        detail: `Slippage of ${request.slippageBps} bps exceeds absolute maximum`,
        threshold: { used: request.slippageBps, limit: SLIPPAGE_SETTINGS.ABSOLUTE_MAX_BPS },
      });
    } else if (request.slippageBps > maxSlippage) {
      reasons.push({
        code: 'SLIPPAGE_HIGH',
        severity: RiskSignal.AMBER,
        message: 'High slippage tolerance',
        detail: `Slippage of ${request.slippageBps} bps is above recommended`,
        threshold: { used: request.slippageBps, limit: maxSlippage },
      });
    }

    // Route complexity
    const routeSteps = quote.routePlan?.length || 0;
    if (routeSteps > 4) {
      reasons.push({
        code: 'COMPLEX_ROUTE',
        severity: RiskSignal.AMBER,
        message: 'Complex multi-hop route',
        detail: `Route has ${routeSteps} hops, which increases execution risk`,
      });
    }
  }

  /**
   * Score quote freshness
   */
  private scoreQuoteFreshness(
    quoteTimestamp: number | undefined,
    reasons: RiskReason[],
    thresholds: Record<string, number>
  ): number {
    if (!quoteTimestamp) return 0;

    const ageSeconds = (Date.now() - quoteTimestamp) / 1000;
    const maxAge = 30; // 30 seconds
    const warningAge = 15;

    thresholds['quoteMaxAge'] = maxAge;

    if (ageSeconds > maxAge) {
      reasons.push({
        code: 'QUOTE_EXPIRED',
        severity: RiskSignal.RED,
        message: 'Quote has expired',
        detail: `Quote is ${Math.round(ageSeconds)} seconds old, refresh required`,
        threshold: { used: ageSeconds, limit: maxAge },
      });
    } else if (ageSeconds > warningAge) {
      reasons.push({
        code: 'QUOTE_STALE',
        severity: RiskSignal.AMBER,
        message: 'Quote is getting stale',
        detail: `Quote is ${Math.round(ageSeconds)} seconds old`,
        threshold: { used: ageSeconds, limit: warningAge },
      });
    }

    return ageSeconds;
  }

  /**
   * Score token hygiene
   */
  private scoreTokenHygiene(
    tokenInfo: TokenSafetyInfo | null,
    side: 'input' | 'output',
    reasons: RiskReason[]
  ): void {
    if (!tokenInfo) {
      reasons.push({
        code: `${side.toUpperCase()}_TOKEN_UNKNOWN`,
        severity: RiskSignal.AMBER,
        message: `Could not verify ${side} token`,
        detail: 'Token metadata could not be fetched',
      });
      return;
    }

    // Blacklist check (RED)
    if (tokenInfo.isBlacklisted) {
      reasons.push({
        code: `${side.toUpperCase()}_TOKEN_BLACKLISTED`,
        severity: RiskSignal.RED,
        message: `${side.charAt(0).toUpperCase() + side.slice(1)} token is blacklisted`,
        detail: 'This token is on the deny list',
      });
      return;
    }

    // Freeze authority (RED in protected, AMBER otherwise)
    if (tokenInfo.hasFreezeAuthority && TOKEN_SAFETY_CHECKS.REJECT_FREEZE_AUTHORITY) {
      reasons.push({
        code: `${side.toUpperCase()}_HAS_FREEZE_AUTHORITY`,
        severity: RiskSignal.AMBER,
        message: `${side.charAt(0).toUpperCase() + side.slice(1)} token has freeze authority`,
        detail: 'Token can be frozen by authority, use with caution',
      });
    }

    // Mint authority (warning)
    if (tokenInfo.hasMintAuthority && TOKEN_SAFETY_CHECKS.WARN_MINT_AUTHORITY) {
      reasons.push({
        code: `${side.toUpperCase()}_HAS_MINT_AUTHORITY`,
        severity: RiskSignal.GREEN,
        message: `${side.charAt(0).toUpperCase() + side.slice(1)} token has mint authority`,
        detail: 'Token supply can be increased by authority',
      });
    }

    // Token-2022 with transfer fees (RED)
    if (tokenInfo.isToken2022 && tokenInfo.hasTransferFee) {
      reasons.push({
        code: `${side.toUpperCase()}_HAS_TRANSFER_FEE`,
        severity: RiskSignal.RED,
        message: `${side.charAt(0).toUpperCase() + side.slice(1)} token has transfer fees`,
        detail: 'Token-2022 with transfer fee extension may cause unexpected costs',
      });
    } else if (tokenInfo.isToken2022) {
      reasons.push({
        code: `${side.toUpperCase()}_IS_TOKEN_2022`,
        severity: RiskSignal.GREEN,
        message: `${side.charAt(0).toUpperCase() + side.slice(1)} token uses Token-2022`,
        detail: 'Token-2022 program detected',
      });
    }
  }

  /**
   * Score size vs liquidity
   */
  private scoreSizeVsLiquidity(
    request: ScoreSwapRequest,
    quote: QuoteResponse,
    reasons: RiskReason[],
    thresholds: Record<string, number>
  ): void {
    // Estimate trade value in USD (simplified)
    // In production, use oracle prices
    const estimatedValueUsd = this.estimateValueUsd(request.amountIn, request.inputMint);

    thresholds['maxTradeUsd'] = SIZE_LIMITS.MAX_TRADE_USD;

    if (estimatedValueUsd > SIZE_LIMITS.MAX_TRADE_USD) {
      reasons.push({
        code: 'TRADE_SIZE_LARGE',
        severity: RiskSignal.AMBER,
        message: 'Large trade size',
        detail: `Estimated value of $${estimatedValueUsd.toLocaleString()} exceeds normal limits`,
        threshold: { used: estimatedValueUsd, limit: SIZE_LIMITS.MAX_TRADE_USD },
      });
    }

    if (estimatedValueUsd < SIZE_LIMITS.MIN_TRADE_USD) {
      reasons.push({
        code: 'TRADE_SIZE_TINY',
        severity: RiskSignal.GREEN,
        message: 'Very small trade',
        detail: `Trade may have high relative fees`,
      });
    }
  }

  /**
   * Get token safety information
   */
  async getTokenSafetyInfo(mint: string): Promise<TokenSafetyInfo | null> {
    // Check cache
    const cached = this.tokenInfoCache.get(mint);
    if (cached) return cached;

    try {
      const mintPubkey = new PublicKey(mint);

      // Try to fetch mint info
      const mintInfo = await getMint(this.connection, mintPubkey);

      const info: TokenSafetyInfo = {
        mint,
        hasFreezeAuthority: mintInfo.freezeAuthority !== null,
        hasMintAuthority: mintInfo.mintAuthority !== null,
        isToken2022: false, // Would need to check program ID
        hasTransferFee: false, // Would need to check extensions
        decimals: mintInfo.decimals,
        isKnownToken: this.isKnownToken(mint),
        isBlacklisted: TOKEN_BLACKLIST.includes(mint),
        isWhitelisted:
          TOKEN_WHITELIST.length === 0 || TOKEN_WHITELIST.includes(mint),
      };

      // Cache the result
      this.tokenInfoCache.set(mint, info);
      setTimeout(() => this.tokenInfoCache.delete(mint), this.CACHE_TTL);

      return info;
    } catch (error) {
      log.warn({ mint, error }, 'Failed to fetch token info');
      return null;
    }
  }

  /**
   * Check if token is in known tokens list
   */
  private isKnownToken(mint: string): boolean {
    return Object.values(KNOWN_TOKENS).includes(mint as any);
  }

  /**
   * Estimate trade value in USD (simplified)
   */
  private estimateValueUsd(amount: string, mint: string): number {
    // In production, fetch real prices from oracle
    // For now, use rough estimates for known tokens
    const amountNum = parseFloat(amount);

    // SOL price estimate (~$100)
    if (mint === KNOWN_TOKENS.WSOL) {
      return (amountNum / 1e9) * 100;
    }

    // USDC/USDT (1:1)
    if (mint === KNOWN_TOKENS.USDC || mint === KNOWN_TOKENS.USDT) {
      return amountNum / 1e6;
    }

    // Default: assume 6 decimals and $1 per token
    return amountNum / 1e6;
  }

  /**
   * Calculate overall risk level from reasons
   */
  private calculateOverallLevel(reasons: RiskReason[]): RiskSignal {
    const hasRed = reasons.some((r) => r.severity === RiskSignal.RED);
    const hasAmber = reasons.some((r) => r.severity === RiskSignal.AMBER);

    if (hasRed) return RiskSignal.RED;
    if (hasAmber) return RiskSignal.AMBER;
    return RiskSignal.GREEN;
  }

  /**
   * Quick check for blocking conditions (no async)
   */
  quickCheck(
    inputMint: string,
    outputMint: string,
    slippageBps: number,
    protectedMode: boolean
  ): { blocked: boolean; reason?: string } {
    // Blacklist check
    if (TOKEN_BLACKLIST.includes(inputMint)) {
      return { blocked: true, reason: 'Input token is blacklisted' };
    }
    if (TOKEN_BLACKLIST.includes(outputMint)) {
      return { blocked: true, reason: 'Output token is blacklisted' };
    }

    // Extreme slippage
    if (slippageBps > SLIPPAGE_SETTINGS.ABSOLUTE_MAX_BPS) {
      return { blocked: true, reason: 'Slippage exceeds absolute maximum' };
    }

    // Protected mode slippage
    if (protectedMode && slippageBps > SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS) {
      return {
        blocked: true,
        reason: 'Slippage exceeds protected mode limit',
      };
    }

    return { blocked: false };
  }

  /**
   * Update connection (after RPC failover)
   */
  updateConnection(connection: Connection): void {
    this.connection = connection;
  }
}

// Singleton instance
export const riskScoringService = new RiskScoringService();
