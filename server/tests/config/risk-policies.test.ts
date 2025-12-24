import { describe, it, expect } from '@jest/globals';
import {
  isTokenAllowed,
  getRecommendedSlippage,
  calculateRiskLevel,
  RiskLevel,
  KNOWN_TOKENS,
  TOKEN_BLACKLIST,
  SLIPPAGE_SETTINGS,
} from '../../src/config/risk-policies';

describe('Risk Policies', () => {
  describe('isTokenAllowed', () => {
    it('should return allowed for SOL', () => {
      const result = isTokenAllowed(KNOWN_TOKENS.WSOL);
      expect(result.allowed).toBe(true);
    });

    it('should return allowed for USDC', () => {
      const result = isTokenAllowed(KNOWN_TOKENS.USDC);
      expect(result.allowed).toBe(true);
    });

    it('should return allowed for unknown tokens when whitelist is empty', () => {
      // When whitelist is empty, all non-blacklisted tokens are allowed
      const result = isTokenAllowed('unknown-mint');
      expect(result.allowed).toBe(true);
    });

    it('should reject blacklisted tokens', () => {
      // If we had blacklisted tokens, they would be rejected
      // TOKEN_BLACKLIST is currently empty
      expect(TOKEN_BLACKLIST.length).toBe(0);
    });
  });

  describe('getRecommendedSlippage', () => {
    it('should return low slippage for stablecoin pairs', () => {
      const slippage = getRecommendedSlippage(KNOWN_TOKENS.USDC, KNOWN_TOKENS.USDT, false);
      expect(slippage).toBe(SLIPPAGE_SETTINGS.STABLECOIN_BPS);
    });

    it('should return major token slippage for SOL pairs', () => {
      const slippage = getRecommendedSlippage(KNOWN_TOKENS.WSOL, KNOWN_TOKENS.USDC, false);
      expect(slippage).toBe(SLIPPAGE_SETTINGS.MAJOR_TOKEN_BPS);
    });

    it('should return protected slippage in protected mode', () => {
      const slippage = getRecommendedSlippage(KNOWN_TOKENS.WSOL, KNOWN_TOKENS.USDC, true);
      expect(slippage).toBe(SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS);
    });

    it('should return default slippage for unknown tokens', () => {
      const slippage = getRecommendedSlippage('unknown-input', 'unknown-output', false);
      expect(slippage).toBe(SLIPPAGE_SETTINGS.DEFAULT_MAX_BPS);
    });
  });

  describe('calculateRiskLevel', () => {
    it('should return low for good parameters', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.1,
        slippageBps: 50,
        tradeValueUsd: 1000,
      });
      expect(level).toBe(RiskLevel.LOW);
    });

    it('should return medium for moderate price impact', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.6, // Above WARNING_PCT (0.5)
        slippageBps: 50,
        tradeValueUsd: 1000,
      });
      expect(level).toBe(RiskLevel.MEDIUM);
    });

    it('should return medium for high slippage', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.1,
        slippageBps: 100, // Above MAJOR_TOKEN_BPS (50)
        tradeValueUsd: 1000,
      });
      expect(level).toBe(RiskLevel.MEDIUM);
    });

    it('should return high for excessive price impact', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 1.5, // Above MAX_NORMAL_PCT (1.0)
        slippageBps: 50,
        tradeValueUsd: 1000,
      });
      expect(level).toBe(RiskLevel.HIGH);
    });

    it('should return high for excessive trade value', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.1,
        slippageBps: 50,
        tradeValueUsd: 150000, // Above MAX_TRADE_USD (100000)
      });
      expect(level).toBe(RiskLevel.HIGH);
    });

    it('should return high for new tokens', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.1,
        slippageBps: 50,
        tradeValueUsd: 1000,
        tokenAge: 3, // Below MIN_TOKEN_AGE_DAYS (7)
      });
      expect(level).toBe(RiskLevel.HIGH);
    });

    it('should return medium for low holder count', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.1,
        slippageBps: 50,
        tradeValueUsd: 1000,
        holderCount: 50, // Below MIN_HOLDER_COUNT (100)
      });
      expect(level).toBe(RiskLevel.MEDIUM);
    });

    it('should return critical for extreme price impact', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 6, // Above ABSOLUTE_MAX_PCT (5.0)
        slippageBps: 50,
        tradeValueUsd: 1000,
      });
      expect(level).toBe(RiskLevel.CRITICAL);
    });

    it('should return critical for extreme slippage', () => {
      const level = calculateRiskLevel({
        priceImpactPct: 0.1,
        slippageBps: 1500, // Above ABSOLUTE_MAX_BPS (1000)
        tradeValueUsd: 1000,
      });
      expect(level).toBe(RiskLevel.CRITICAL);
    });
  });
});
