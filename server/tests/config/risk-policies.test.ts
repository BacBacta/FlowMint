import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  isTokenWhitelisted,
  isTokenBlacklisted,
  getSlippageSettings,
  validateSwapPolicy,
  calculateRiskLevel,
} from '../../src/config/risk-policies';

describe('Risk Policies', () => {
  describe('isTokenWhitelisted', () => {
    it('should return true for SOL', () => {
      expect(isTokenWhitelisted('So11111111111111111111111111111111111111112')).toBe(true);
    });

    it('should return true for USDC', () => {
      expect(isTokenWhitelisted('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should return false for unknown tokens', () => {
      expect(isTokenWhitelisted('unknown-mint')).toBe(false);
    });
  });

  describe('isTokenBlacklisted', () => {
    it('should return false for SOL', () => {
      expect(isTokenBlacklisted('So11111111111111111111111111111111111111112')).toBe(false);
    });

    it('should return false for unknown tokens', () => {
      expect(isTokenBlacklisted('unknown-mint')).toBe(false);
    });
  });

  describe('getSlippageSettings', () => {
    it('should return default settings for whitelisted tokens', () => {
      const settings = getSlippageSettings('So11111111111111111111111111111111111111112');
      expect(settings.default).toBe(50);
      expect(settings.max).toBe(500);
    });

    it('should return settings for unknown tokens', () => {
      const settings = getSlippageSettings('unknown-mint');
      expect(settings.default).toBeGreaterThan(0);
      expect(settings.max).toBeGreaterThan(0);
    });
  });

  describe('validateSwapPolicy', () => {
    it('should approve low risk swaps', () => {
      const result = validateSwapPolicy({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000_000,
        slippageBps: 50,
        priceImpact: 0.001,
      });

      expect(result.approved).toBe(true);
      expect(result.riskLevel).toBe('low');
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn for high slippage', () => {
      const result = validateSwapPolicy({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000_000,
        slippageBps: 300,
        priceImpact: 0.001,
      });

      expect(result.approved).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should reject excessive slippage', () => {
      const result = validateSwapPolicy({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000_000,
        slippageBps: 1000, // 10%
        priceImpact: 0.001,
      });

      expect(result.approved).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject high price impact', () => {
      const result = validateSwapPolicy({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000_000,
        slippageBps: 50,
        priceImpact: 0.05, // 5%
      });

      expect(result.approved).toBe(false);
      expect(result.errors.some(e => e.includes('impact'))).toBe(true);
    });
  });

  describe('calculateRiskLevel', () => {
    it('should return low for whitelisted tokens with low slippage', () => {
      const level = calculateRiskLevel({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        slippageBps: 50,
        priceImpact: 0.001,
      });

      expect(level).toBe('low');
    });

    it('should return medium for unknown tokens', () => {
      const level = calculateRiskLevel({
        inputMint: 'unknown-mint',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        slippageBps: 50,
        priceImpact: 0.001,
      });

      expect(level).toBe('medium');
    });

    it('should return high for high slippage with unknown tokens', () => {
      const level = calculateRiskLevel({
        inputMint: 'unknown-mint',
        outputMint: 'unknown-mint-2',
        slippageBps: 300,
        priceImpact: 0.02,
      });

      expect(level).toBe('high');
    });
  });
});
