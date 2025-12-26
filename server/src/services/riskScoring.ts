/**
 * Risk Scoring Service
 *
 * Provides comprehensive risk assessment for swaps with:
 * - Quote-based risk (price impact, slippage, route quality)
 * - Token hygiene checks (freeze authority, mint authority, extensions)
 * - Size vs liquidity analysis
 * - Traffic light scoring (GREEN, AMBER, RED)
 */

import { getMint, getTransferFeeConfig, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

import { config } from '../config/index.js';
import {
  SLIPPAGE_SETTINGS,
  PRICE_IMPACT_THRESHOLDS,
  TRADE_RISK_THRESHOLDS,
  SIZE_LIMITS,
  TOKEN_SAFETY_CHECKS,
  TOKEN_BLACKLIST,
  TOKEN_WHITELIST,
  KNOWN_TOKENS,
  DEVNET_TOKENS,
} from '../config/risk-policies.js';
import { logger } from '../utils/logger.js';

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
 * Stable reason codes (UI should map these to labels).
 */
export enum RiskReasonCode {
  // Trade risk
  PRICE_IMPACT_CAUTION = 'PRICE_IMPACT_CAUTION',
  PRICE_IMPACT_UNSAFE = 'PRICE_IMPACT_UNSAFE',
  SLIPPAGE_CAUTION = 'SLIPPAGE_CAUTION',
  SLIPPAGE_UNSAFE = 'SLIPPAGE_UNSAFE',
  QUOTE_STALE = 'QUOTE_STALE',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  ROUTE_COMPLEX = 'ROUTE_COMPLEX',

  // Token safety
  TOKEN_BLACKLISTED = 'TOKEN_BLACKLISTED',
  TOKEN_NOT_ALLOWLISTED = 'TOKEN_NOT_ALLOWLISTED',
  TOKEN_HAS_FREEZE_AUTHORITY = 'TOKEN_HAS_FREEZE_AUTHORITY',
  TOKEN_HAS_MINT_AUTHORITY = 'TOKEN_HAS_MINT_AUTHORITY',
  TOKEN_TOKEN2022_WITH_TRANSFER_FEE = 'TOKEN_TOKEN2022_WITH_TRANSFER_FEE',
  TOKEN_TOKEN2022_UNSUPPORTED = 'TOKEN_TOKEN2022_UNSUPPORTED',
  TOKEN_UNKNOWN = 'TOKEN_UNKNOWN',
  TOKEN_SPOOFED_SYMBOL = 'TOKEN_SPOOFED_SYMBOL',

  // Composition
  TOKEN_UNKNOWN_AND_TRADE_RISKY = 'TOKEN_UNKNOWN_AND_TRADE_RISKY',
}

/**
 * Individual risk reason
 */
export interface RiskReason {
  code: RiskReasonCode | string;
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
  name?: string;
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
  /** Intrinsic token safety level */
  tokenSafetyLevel: RiskSignal;
  /** Transaction-specific trade risk level */
  tradeRiskLevel: RiskSignal;
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
  private tokenInfoCache: Map<string, { info: TokenSafetyInfo; expiresAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: config.solana.commitment,
    });
  }

  /**
   * Score a swap request with quote
   */
  async scoreSwap(request: ScoreSwapRequest, quote: QuoteResponse): Promise<RiskAssessment> {
    const timestamp = Date.now();
    const reasons: RiskReason[] = [];
    const thresholdsUsed: Record<string, number> = {};

    log.debug({ inputMint: request.inputMint, outputMint: request.outputMint }, 'Scoring swap');

    // 1) Trade risk (transactional)
    const tradeRiskReasons: RiskReason[] = [];
    this.scoreTradeRisk(quote, request, tradeRiskReasons, thresholdsUsed);

    // 2) Quote freshness
    const quoteAgeSeconds = this.scoreQuoteFreshness(request.quoteTimestamp, tradeRiskReasons);

    // 3) Token safety (intrinsic)
    const [inputTokenSafety, outputTokenSafety] = await Promise.all([
      this.getTokenSafetyInfo(request.inputMint),
      this.getTokenSafetyInfo(request.outputMint),
    ]);

    const tokenSafetyReasons: RiskReason[] = [];
    const inputTokenSafetyLevel = this.scoreTokenSafety(
      inputTokenSafety,
      'input',
      tokenSafetyReasons,
      request.protectedMode
    );
    const outputTokenSafetyLevel = this.scoreTokenSafety(
      outputTokenSafety,
      'output',
      tokenSafetyReasons,
      request.protectedMode
    );
    const tokenSafetyLevel = this.maxLevel(inputTokenSafetyLevel, outputTokenSafetyLevel);

    // Composition rule: unknown token + already risky trade => UNSAFE
    const hasUnknownToken =
      tokenSafetyReasons.some(r => r.code === RiskReasonCode.TOKEN_UNKNOWN) ||
      tokenSafetyReasons.some(r => r.code === RiskReasonCode.TOKEN_NOT_ALLOWLISTED);
    const tradeRiskLevel = this.calculateOverallLevel(tradeRiskReasons);
    if (hasUnknownToken && tradeRiskLevel !== RiskSignal.GREEN) {
      tokenSafetyReasons.push({
        code: RiskReasonCode.TOKEN_UNKNOWN_AND_TRADE_RISKY,
        severity: RiskSignal.RED,
        message: 'Unknown token combined with elevated trade risk',
        detail: 'FlowMint blocks unknown tokens when the trade is already risky',
      });
    }

    // 4) Size vs liquidity (transactional)
    this.scoreSizeVsLiquidity(request, quote, tradeRiskReasons, thresholdsUsed);

    // Merge reasons (token first, then trade)
    reasons.push(...tokenSafetyReasons, ...tradeRiskReasons);

    // Recompute levels after composition
    const finalTokenSafetyLevel = this.calculateOverallLevel(tokenSafetyReasons);
    const finalTradeRiskLevel = this.calculateOverallLevel(tradeRiskReasons);
    const level = this.maxLevel(finalTokenSafetyLevel, finalTradeRiskLevel);

    // Protected policy: block UNSAFE always. Allow CAUTION only if within protected ceilings.
    const blockedInProtectedMode = this.computeProtectedBlocking({
      protectedMode: request.protectedMode,
      overallLevel: level,
      tokenSafetyLevel: finalTokenSafetyLevel,
      tradeRiskLevel: finalTradeRiskLevel,
      slippageBps: request.slippageBps,
      priceImpactPct: this.getQuotePriceImpactPct(quote),
      quoteAgeSeconds,
      reasons,
    });

    const requiresAcknowledgement = level === RiskSignal.AMBER && !request.protectedMode;

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
      tokenSafetyLevel: finalTokenSafetyLevel,
      tradeRiskLevel: finalTradeRiskLevel,
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
  private scoreTradeRisk(
    quote: QuoteResponse,
    request: ScoreSwapRequest,
    reasons: RiskReason[],
    thresholds: Record<string, number>
  ): void {
    const priceImpactPct = this.getQuotePriceImpactPct(quote);

    thresholds['priceImpactCautionPct'] = TRADE_RISK_THRESHOLDS.PRICE_IMPACT_CAUTION_PCT;
    thresholds['priceImpactUnsafePct'] = TRADE_RISK_THRESHOLDS.PRICE_IMPACT_UNSAFE_PCT;

    if (priceImpactPct >= TRADE_RISK_THRESHOLDS.PRICE_IMPACT_UNSAFE_PCT) {
      reasons.push({
        code: RiskReasonCode.PRICE_IMPACT_UNSAFE,
        severity: RiskSignal.RED,
        message: 'High price impact',
        detail: `Price impact of ${priceImpactPct.toFixed(2)}%`,
        threshold: {
          used: priceImpactPct,
          limit: TRADE_RISK_THRESHOLDS.PRICE_IMPACT_UNSAFE_PCT,
        },
      });
    } else if (priceImpactPct >= TRADE_RISK_THRESHOLDS.PRICE_IMPACT_CAUTION_PCT) {
      reasons.push({
        code: RiskReasonCode.PRICE_IMPACT_CAUTION,
        severity: RiskSignal.AMBER,
        message: 'Moderate price impact',
        detail: `Price impact of ${priceImpactPct.toFixed(2)}%`,
        threshold: {
          used: priceImpactPct,
          limit: TRADE_RISK_THRESHOLDS.PRICE_IMPACT_CAUTION_PCT,
        },
      });
    }

    thresholds['slippageCautionBps'] = TRADE_RISK_THRESHOLDS.SLIPPAGE_CAUTION_BPS;
    thresholds['slippageUnsafeBps'] = TRADE_RISK_THRESHOLDS.SLIPPAGE_UNSAFE_BPS;

    if (request.slippageBps >= TRADE_RISK_THRESHOLDS.SLIPPAGE_UNSAFE_BPS) {
      reasons.push({
        code: RiskReasonCode.SLIPPAGE_UNSAFE,
        severity: RiskSignal.RED,
        message: 'High slippage tolerance',
        detail: `Slippage tolerance of ${(request.slippageBps / 100).toFixed(2)}%`,
        threshold: {
          used: request.slippageBps,
          limit: TRADE_RISK_THRESHOLDS.SLIPPAGE_UNSAFE_BPS,
        },
      });
    } else if (request.slippageBps >= TRADE_RISK_THRESHOLDS.SLIPPAGE_CAUTION_BPS) {
      reasons.push({
        code: RiskReasonCode.SLIPPAGE_CAUTION,
        severity: RiskSignal.AMBER,
        message: 'Moderate slippage tolerance',
        detail: `Slippage tolerance of ${(request.slippageBps / 100).toFixed(2)}%`,
        threshold: {
          used: request.slippageBps,
          limit: TRADE_RISK_THRESHOLDS.SLIPPAGE_CAUTION_BPS,
        },
      });
    }

    // Route complexity
    const routeSteps = quote.routePlan?.length || 0;
    if (routeSteps > TRADE_RISK_THRESHOLDS.ROUTE_HOPS_CAUTION) {
      reasons.push({
        code: RiskReasonCode.ROUTE_COMPLEX,
        severity: RiskSignal.AMBER,
        message: 'Complex multi-hop route',
        detail: `Route has ${routeSteps} hops`,
      });
    }
  }

  /**
   * Score quote freshness
   */
  private scoreQuoteFreshness(quoteTimestamp: number | undefined, reasons: RiskReason[]): number {
    if (!quoteTimestamp) return 0;

    const ageSeconds = (Date.now() - quoteTimestamp) / 1000;

    if (ageSeconds >= TRADE_RISK_THRESHOLDS.QUOTE_EXPIRED_SECONDS) {
      reasons.push({
        code: RiskReasonCode.QUOTE_EXPIRED,
        severity: RiskSignal.RED,
        message: 'Quote expired',
        detail: `Quote is ${Math.round(ageSeconds)}s old`,
        threshold: { used: ageSeconds, limit: TRADE_RISK_THRESHOLDS.QUOTE_EXPIRED_SECONDS },
      });
    } else if (ageSeconds >= TRADE_RISK_THRESHOLDS.QUOTE_STALE_SECONDS) {
      reasons.push({
        code: RiskReasonCode.QUOTE_STALE,
        severity: RiskSignal.AMBER,
        message: 'Quote is stale',
        detail: `Quote is ${Math.round(ageSeconds)}s old`,
        threshold: { used: ageSeconds, limit: TRADE_RISK_THRESHOLDS.QUOTE_STALE_SECONDS },
      });
    }

    return ageSeconds;
  }

  /**
   * Score token hygiene
   */
  private scoreTokenSafety(
    tokenInfo: TokenSafetyInfo | null,
    side: 'input' | 'output',
    reasons: RiskReason[],
    protectedMode: boolean
  ): RiskSignal {
    const sideLabel = side.charAt(0).toUpperCase() + side.slice(1);

    if (!tokenInfo) {
      reasons.push({
        code: RiskReasonCode.TOKEN_UNKNOWN,
        severity: RiskSignal.AMBER,
        message: `Could not verify ${side} token`,
        detail: 'Token metadata could not be fetched',
      });
      return RiskSignal.AMBER;
    }

    // Denylist
    if (tokenInfo.isBlacklisted) {
      reasons.push({
        code: RiskReasonCode.TOKEN_BLACKLISTED,
        severity: RiskSignal.RED,
        message: `${sideLabel} token is denylisted`,
        detail: 'This token is on the deny list',
      });
      return RiskSignal.RED;
    }

    // Allowlist mode
    if (!tokenInfo.isWhitelisted) {
      reasons.push({
        code: RiskReasonCode.TOKEN_NOT_ALLOWLISTED,
        severity: RiskSignal.AMBER,
        message: `${sideLabel} token is not allowlisted`,
        detail: 'Token is not in the allow list',
      });
    }

    // Freeze authority is UNSAFE
    if (tokenInfo.hasFreezeAuthority && TOKEN_SAFETY_CHECKS.REJECT_FREEZE_AUTHORITY) {
      reasons.push({
        code: RiskReasonCode.TOKEN_HAS_FREEZE_AUTHORITY,
        severity: RiskSignal.RED,
        message: `${sideLabel} token has freeze authority`,
        detail: 'An authority can freeze transfers',
      });
    }

    // Mint authority is CAUTION
    if (tokenInfo.hasMintAuthority && TOKEN_SAFETY_CHECKS.WARN_MINT_AUTHORITY) {
      reasons.push({
        code: RiskReasonCode.TOKEN_HAS_MINT_AUTHORITY,
        severity: RiskSignal.AMBER,
        message: `${sideLabel} token has mint authority`,
        detail: 'Supply can be increased by an authority',
      });
    }

    // Token-2022 handling
    if (tokenInfo.isToken2022 && tokenInfo.hasTransferFee) {
      reasons.push({
        code: RiskReasonCode.TOKEN_TOKEN2022_WITH_TRANSFER_FEE,
        severity: RiskSignal.RED,
        message: `${sideLabel} token has transfer fees (Token-2022)`,
        detail: 'Transfer fee extension makes output unpredictable',
      });
    } else if (tokenInfo.isToken2022) {
      reasons.push({
        code: RiskReasonCode.TOKEN_TOKEN2022_UNSUPPORTED,
        severity: protectedMode ? RiskSignal.RED : RiskSignal.AMBER,
        message: `${sideLabel} token uses Token-2022`,
        detail: 'Token-2022 extensions may introduce non-standard behavior',
      });
    }

    // Anti-spoof for major symbols
    if (tokenInfo.symbol) {
      const canonical = this.getCanonicalMintForSymbol(tokenInfo.symbol);
      if (canonical && canonical !== tokenInfo.mint) {
        reasons.push({
          code: RiskReasonCode.TOKEN_SPOOFED_SYMBOL,
          severity: RiskSignal.RED,
          message: `${sideLabel} token appears spoofed`,
          detail: `Symbol ${tokenInfo.symbol} does not match canonical mint`,
        });
      }
    }

    return this.calculateOverallLevel(reasons);
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
    if (cached && cached.expiresAt > Date.now()) return cached.info;

    try {
      const mintPubkey = new PublicKey(mint);

      const accountInfo = await this.connection.getAccountInfo(mintPubkey);
      const owner = accountInfo?.owner;
      const isToken2022 = owner ? owner.equals(TOKEN_2022_PROGRAM_ID) : false;
      const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

      // Fetch mint info from the correct program
      const mintInfo = await getMint(this.connection, mintPubkey, undefined, programId);

      // Best-effort symbol/name enrichment (cached with the same TTL)
      const meta = await this.fetchTokenMetadata(mint);
      const transferFeeConfig = isToken2022 ? getTransferFeeConfig(mintInfo as any) : null;
      const hasTransferFee =
        !!transferFeeConfig &&
        (transferFeeConfig.olderTransferFee.transferFeeBasisPoints > 0 ||
          transferFeeConfig.newerTransferFee.transferFeeBasisPoints > 0);

      const info: TokenSafetyInfo = {
        mint,
        symbol: meta?.symbol,
        name: meta?.name,
        hasFreezeAuthority: mintInfo.freezeAuthority !== null,
        hasMintAuthority: mintInfo.mintAuthority !== null,
        isToken2022,
        hasTransferFee,
        decimals: mintInfo.decimals,
        isKnownToken: this.isKnownToken(mint),
        isBlacklisted: TOKEN_BLACKLIST.includes(mint),
        isWhitelisted: TOKEN_WHITELIST.length === 0 || TOKEN_WHITELIST.includes(mint),
      };

      // Cache the result
      this.tokenInfoCache.set(mint, { info, expiresAt: Date.now() + this.CACHE_TTL_MS });

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
    const network = config.solana.network;
    const known = network === 'devnet' ? DEVNET_TOKENS : KNOWN_TOKENS;
    return Object.values(known).includes(mint as any);
  }

  private getCanonicalMintForSymbol(symbol: string): string | null {
    const sym = symbol.trim().toUpperCase();
    const network = config.solana.network;
    const known = network === 'devnet' ? DEVNET_TOKENS : KNOWN_TOKENS;

    if (sym === 'SOL' || sym === 'WSOL') return known.WSOL;
    if (sym === 'USDC') return (known as any).USDC ?? null;
    if (sym === 'USDT') return (known as any).USDT ?? null;
    if (sym === 'JUP') return (known as any).JUP ?? null;
    if (sym === 'BONK') return (known as any).BONK ?? null;
    return null;
  }

  private async fetchTokenMetadata(
    mint: string
  ): Promise<{ symbol?: string; name?: string } | null> {
    // Quick path for canonical tokens
    const network = config.solana.network;
    const known = network === 'devnet' ? DEVNET_TOKENS : KNOWN_TOKENS;
    const entries = Object.entries(known) as Array<[string, string]>;
    const knownMatch = entries.find(([_sym, addr]) => addr === mint);
    if (knownMatch) {
      const [sym] = knownMatch;
      return { symbol: sym, name: sym };
    }

    // Best-effort DexScreener lookup (fast timeout, non-blocking failure)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) return null;
      const data: any = await resp.json();
      const pair = Array.isArray(data?.pairs) ? data.pairs[0] : null;
      const baseToken = pair?.baseToken;
      if (!baseToken) return null;
      return { symbol: baseToken.symbol, name: baseToken.name };
    } catch {
      return null;
    }
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
    const hasRed = reasons.some(r => r.severity === RiskSignal.RED);
    const hasAmber = reasons.some(r => r.severity === RiskSignal.AMBER);

    if (hasRed) return RiskSignal.RED;
    if (hasAmber) return RiskSignal.AMBER;
    return RiskSignal.GREEN;
  }

  private maxLevel(a: RiskSignal, b: RiskSignal): RiskSignal {
    if (a === RiskSignal.RED || b === RiskSignal.RED) return RiskSignal.RED;
    if (a === RiskSignal.AMBER || b === RiskSignal.AMBER) return RiskSignal.AMBER;
    return RiskSignal.GREEN;
  }

  private getQuotePriceImpactPct(quote: QuoteResponse): number {
    // Jupiter returns priceImpactPct as a fraction (e.g. "0.0123" == 1.23%)
    const raw = Number(quote.priceImpactPct);
    if (!Number.isFinite(raw)) return 0;
    return raw * 100;
  }

  private computeProtectedBlocking(params: {
    protectedMode: boolean;
    overallLevel: RiskSignal;
    tokenSafetyLevel: RiskSignal;
    tradeRiskLevel: RiskSignal;
    slippageBps: number;
    priceImpactPct: number;
    quoteAgeSeconds: number;
    reasons: RiskReason[];
  }): boolean {
    if (!params.protectedMode) return false;
    if (params.overallLevel === RiskSignal.RED) return true;

    // For CAUTION in protected mode, enforce strict ceilings.
    if (params.overallLevel === RiskSignal.AMBER) {
      if (params.slippageBps > SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS) return true;
      if (params.priceImpactPct > PRICE_IMPACT_THRESHOLDS.MAX_PROTECTED_PCT) return true;
      if (params.quoteAgeSeconds > TRADE_RISK_THRESHOLDS.QUOTE_STALE_SECONDS) return true;

      // Block specific token-related cautions in protected mode.
      const blockedCodes = new Set<RiskReasonCode>([
        RiskReasonCode.TOKEN_UNKNOWN,
        RiskReasonCode.TOKEN_NOT_ALLOWLISTED,
        RiskReasonCode.TOKEN_TOKEN2022_UNSUPPORTED,
      ]);
      if (params.reasons.some(r => blockedCodes.has(r.code as RiskReasonCode))) return true;
    }

    return false;
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
