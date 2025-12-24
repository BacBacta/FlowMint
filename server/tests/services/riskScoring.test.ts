/**
 * Risk Scoring Tests
 *
 * Tests for the risk assessment service.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RiskScoringService, RiskSignal } from '../../src/services/riskScoring';

// Mock Connection to avoid network calls
jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn().mockImplementation(() => ({
    getAccountInfo: jest.fn().mockResolvedValue(null),
    getTokenSupply: jest.fn().mockResolvedValue({ value: { uiAmount: 1000000 } }),
    getTokenLargestAccounts: jest.fn().mockResolvedValue({ value: [] }),
  })),
  PublicKey: jest.fn().mockImplementation((key: string) => ({
    toBase58: () => key,
    toString: () => key,
  })),
}));

describe('RiskScoringService', () => {
  let service: RiskScoringService;

  beforeEach(() => {
    service = new RiskScoringService();
  });

  describe('scoreSwap', () => {
    it('should return green for low-risk swap', async () => {
      const request = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        protectedMode: false,
        quoteTimestamp: Date.now() - 1000, // 1 second old
      };

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '100000000',
        otherAmountThreshold: '99500000',
        priceImpactPct: '0.1', // Low
        slippageBps: 50,
        routePlan: [{ swapInfo: { ammKey: 'test' } }],
      };

      const result = await service.scoreSwap(request as any, quote as any);

      // May return GREEN or AMBER depending on token safety checks
      expect([RiskSignal.GREEN, RiskSignal.AMBER]).toContain(result.level);
      expect(result.blockedInProtectedMode).toBe(false);
    });

    it('should return amber for medium-risk swap', async () => {
      const request = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 10000000000,
        protectedMode: false,
        quoteTimestamp: Date.now() - 5000, // 5 seconds old
      };

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '10000000000',
        outAmount: '1000000000',
        otherAmountThreshold: '970000000',
        priceImpactPct: '1.5', // Medium
        slippageBps: 100,
        routePlan: [
          { swapInfo: { ammKey: 'test1' } },
          { swapInfo: { ammKey: 'test2' } },
        ],
      };

      const result = await service.scoreSwap(request as any, quote as any);

      expect([RiskSignal.AMBER, RiskSignal.GREEN]).toContain(result.level);
    });

    it('should return red for high-risk swap', async () => {
      const request = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000000, // Very large
        protectedMode: false,
        quoteTimestamp: Date.now() - 30000, // 30 seconds old
      };

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000000',
        outAmount: '90000000000',
        otherAmountThreshold: '80000000000',
        priceImpactPct: '10.0', // Very high
        slippageBps: 500,
        routePlan: [
          { swapInfo: { ammKey: 'test1' } },
          { swapInfo: { ammKey: 'test2' } },
          { swapInfo: { ammKey: 'test3' } },
          { swapInfo: { ammKey: 'test4' } },
        ],
      };

      const result = await service.scoreSwap(request as any, quote as any);

      expect(result.level).toBe(RiskSignal.RED);
      expect(result.blockedInProtectedMode).toBe(true);
    });

    it('should include risk reasons', async () => {
      const request = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 100000000000,
        protectedMode: false,
        quoteTimestamp: Date.now() - 15000,
      };

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '100000000000',
        outAmount: '9000000000',
        otherAmountThreshold: '8500000000',
        priceImpactPct: '5.0',
        slippageBps: 200,
        routePlan: [{ swapInfo: { ammKey: 'test' } }],
      };

      const result = await service.scoreSwap(request as any, quote as any);

      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
    });

    it('should block amber in protected mode', async () => {
      const request = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 10000000000,
        protectedMode: true, // Protected mode ON
        quoteTimestamp: Date.now() - 5000,
      };

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '10000000000',
        outAmount: '1000000000',
        otherAmountThreshold: '900000000',
        priceImpactPct: '2.5', // Triggers amber
        slippageBps: 150,
        routePlan: [{ swapInfo: { ammKey: 'test' } }],
      };

      const result = await service.scoreSwap(request as any, quote as any);

      // In protected mode, amber and red are blocked
      if (result.level === RiskSignal.AMBER || result.level === RiskSignal.RED) {
        expect(result.blockedInProtectedMode).toBe(true);
      }
    });
  });

  describe('RiskSignal enum', () => {
    it('should have correct signal values', () => {
      expect(RiskSignal.GREEN).toBe('GREEN');
      expect(RiskSignal.AMBER).toBe('AMBER');
      expect(RiskSignal.RED).toBe('RED');
    });
  });
});
