/**
 * Risk Policies Configuration
 *
 * Defines token whitelists, blacklists, and protection thresholds.
 */

/**
 * Well-known token addresses on Solana mainnet
 */
export const KNOWN_TOKENS = {
  // Native SOL wrapped
  WSOL: 'So11111111111111111111111111111111111111112',
  // USDC
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // USDT
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  // Wrapped BTC
  WBTC: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
  // Wrapped ETH
  WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  // Bonk
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  // JUP
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  // RAY
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  // ORCA
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
} as const;

/**
 * Devnet token addresses (for testing)
 */
export const DEVNET_TOKENS = {
  WSOL: 'So11111111111111111111111111111111111111112',
  USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const;

/**
 * Token whitelist - tokens allowed for trading
 *
 * Empty array means all tokens are allowed (except blacklisted)
 */
export const TOKEN_WHITELIST: string[] = [
  // For production, you might want to restrict to known tokens
  // KNOWN_TOKENS.WSOL,
  // KNOWN_TOKENS.USDC,
  // etc.
];

/**
 * Token blacklist - tokens that are never allowed
 *
 * Include known scam tokens, tokens with transfer taxes, etc.
 */
export const TOKEN_BLACKLIST: string[] = [
  // Add known scam token addresses here
  // 'ScamToken11111111111111111111111111111111111',
];

/**
 * Slippage settings in basis points
 */
export const SLIPPAGE_SETTINGS = {
  /** Default maximum slippage for normal mode (3%) */
  DEFAULT_MAX_BPS: 300,

  /** Maximum slippage for protected mode (1%) */
  PROTECTED_MAX_BPS: 100,

  /** Minimum slippage that makes sense (0.1%) */
  MIN_BPS: 10,

  /** Absolute maximum allowed (10%) */
  ABSOLUTE_MAX_BPS: 1000,

  /** Recommended slippage for stablecoins (0.1%) */
  STABLECOIN_BPS: 10,

  /** Recommended slippage for major tokens (0.5%) */
  MAJOR_TOKEN_BPS: 50,

  /** Recommended slippage for low liquidity tokens (3%) */
  LOW_LIQUIDITY_BPS: 300,
} as const;

/**
 * Price impact thresholds
 */
export const PRICE_IMPACT_THRESHOLDS = {
  /** Warning threshold (0.5%) */
  WARNING_PCT: 0.5,

  /** Maximum for normal mode (1%) */
  MAX_NORMAL_PCT: 1.0,

  /** Maximum for protected mode (0.3%) */
  MAX_PROTECTED_PCT: 0.3,

  /** Absolute maximum allowed (5%) */
  ABSOLUTE_MAX_PCT: 5.0,
} as const;

/**
 * Size limits relative to liquidity
 */
export const SIZE_LIMITS = {
  /** Maximum percentage of pool liquidity for single trade */
  MAX_LIQUIDITY_PERCENTAGE: 0.1, // 10% of pool

  /** Minimum trade size in USD */
  MIN_TRADE_USD: 0.01,

  /** Maximum trade size in USD (without special approval) */
  MAX_TRADE_USD: 100000,

  /** Minimum for DCA slice */
  MIN_DCA_SLICE_USD: 1,
} as const;

/**
 * Token metadata flags to check
 */
export const TOKEN_SAFETY_CHECKS = {
  /** Reject tokens with freeze authority */
  REJECT_FREEZE_AUTHORITY: true,

  /** Reject tokens with transfer fees/taxes */
  REJECT_TRANSFER_FEES: true,

  /** Warn about tokens with mint authority */
  WARN_MINT_AUTHORITY: true,

  /** Minimum token age in days */
  MIN_TOKEN_AGE_DAYS: 7,

  /** Minimum holder count */
  MIN_HOLDER_COUNT: 100,
} as const;

/**
 * Risk level enumeration
 */
export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Calculate risk level based on trade parameters
 */
export function calculateRiskLevel(params: {
  priceImpactPct: number;
  slippageBps: number;
  tradeValueUsd: number;
  tokenAge?: number;
  holderCount?: number;
}): RiskLevel {
  const { priceImpactPct, slippageBps, tradeValueUsd, tokenAge, holderCount } = params;

  // Critical risk conditions
  if (priceImpactPct > PRICE_IMPACT_THRESHOLDS.ABSOLUTE_MAX_PCT) {
    return RiskLevel.CRITICAL;
  }
  if (slippageBps > SLIPPAGE_SETTINGS.ABSOLUTE_MAX_BPS) {
    return RiskLevel.CRITICAL;
  }

  // High risk conditions
  if (priceImpactPct > PRICE_IMPACT_THRESHOLDS.MAX_NORMAL_PCT) {
    return RiskLevel.HIGH;
  }
  if (tradeValueUsd > SIZE_LIMITS.MAX_TRADE_USD) {
    return RiskLevel.HIGH;
  }
  if (tokenAge !== undefined && tokenAge < TOKEN_SAFETY_CHECKS.MIN_TOKEN_AGE_DAYS) {
    return RiskLevel.HIGH;
  }

  // Medium risk conditions
  if (priceImpactPct > PRICE_IMPACT_THRESHOLDS.WARNING_PCT) {
    return RiskLevel.MEDIUM;
  }
  if (slippageBps > SLIPPAGE_SETTINGS.MAJOR_TOKEN_BPS) {
    return RiskLevel.MEDIUM;
  }
  if (holderCount !== undefined && holderCount < TOKEN_SAFETY_CHECKS.MIN_HOLDER_COUNT) {
    return RiskLevel.MEDIUM;
  }

  return RiskLevel.LOW;
}

/**
 * Check if a token is allowed for trading
 */
export function isTokenAllowed(tokenAddress: string): { allowed: boolean; reason?: string } {
  // Check blacklist first
  if (TOKEN_BLACKLIST.includes(tokenAddress)) {
    return { allowed: false, reason: 'Token is blacklisted' };
  }

  // If whitelist is empty, all non-blacklisted tokens are allowed
  if (TOKEN_WHITELIST.length === 0) {
    return { allowed: true };
  }

  // Check whitelist
  if (TOKEN_WHITELIST.includes(tokenAddress)) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Token is not in whitelist' };
}

/**
 * Get recommended slippage for a token pair
 */
export function getRecommendedSlippage(
  inputMint: string,
  outputMint: string,
  isProtectedMode: boolean
): number {
  // Stablecoin to stablecoin
  const stablecoins = [KNOWN_TOKENS.USDC, KNOWN_TOKENS.USDT];
  if (stablecoins.includes(inputMint as any) && stablecoins.includes(outputMint as any)) {
    return SLIPPAGE_SETTINGS.STABLECOIN_BPS;
  }

  // Major tokens
  const majorTokens = [KNOWN_TOKENS.WSOL, KNOWN_TOKENS.WBTC, KNOWN_TOKENS.WETH];
  if (majorTokens.includes(inputMint as any) || majorTokens.includes(outputMint as any)) {
    return isProtectedMode
      ? SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS
      : SLIPPAGE_SETTINGS.MAJOR_TOKEN_BPS;
  }

  // Default
  return isProtectedMode ? SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS : SLIPPAGE_SETTINGS.DEFAULT_MAX_BPS;
}
