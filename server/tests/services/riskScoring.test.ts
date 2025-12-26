/**
 * Risk Scoring Tests
 *
 * Tests for the risk assessment service.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { RiskScoringService, RiskSignal } from '../../src/services/riskScoring';

const makeTokenSafety = (overrides = {}) => ({
  mint: overrides.mint ?? 'So11111111111111111111111111111111111111112',
  symbol: overrides.symbol,
  name: overrides.name,
  hasFreezeAuthority: overrides.hasFreezeAuthority ?? false,
  hasMintAuthority: overrides.hasMintAuthority ?? false,
  isToken2022: overrides.isToken2022 ?? false,
  hasTransferFee: overrides.hasTransferFee ?? false,
  decimals: overrides.decimals ?? 6,
  isKnownToken: overrides.isKnownToken ?? true,
  isBlacklisted: overrides.isBlacklisted ?? false,
  isWhitelisted: overrides.isWhitelisted ?? true,
});

const makeQuote = (overrides = {}) => ({
  inputMint: overrides.inputMint ?? 'So11111111111111111111111111111111111111112',
  outputMint: overrides.outputMint ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inAmount: overrides.inAmount ?? '1000000000',
  outAmount: overrides.outAmount ?? '1000000',
  otherAmountThreshold: overrides.otherAmountThreshold ?? '990000',
  // Jupiter returns a fraction: "0.02" => 2%
  priceImpactPct: overrides.priceImpactPct ?? '0.0001',
  routePlan: overrides.routePlan ?? [{ swapInfo: { ammKey: 'test', label: 'test' } }],
  swapMode: overrides.swapMode ?? 'ExactIn',
  slippageBps: overrides.slippageBps ?? 50,
});

const makeRequest = (overrides = {}) => ({
  inputMint: overrides.inputMint ?? 'So11111111111111111111111111111111111111112',
  outputMint: overrides.outputMint ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amountIn: overrides.amountIn ?? '1000000000',
  slippageBps: overrides.slippageBps ?? 50,
  protectedMode: overrides.protectedMode ?? false,
  quoteTimestamp: overrides.quoteTimestamp,
});

describe('RiskScoringService', () => {
  let service;

  beforeEach(() => {
    service = new RiskScoringService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('scoreSwap', () => {
    it('flags freeze authority as UNSAFE (RED)', async () => {
      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ hasFreezeAuthority: true, mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const now = Date.now();
      const request = makeRequest({ quoteTimestamp: now });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);

      expect(result.level).toBe(RiskSignal.RED);
      expect(result.reasons.some(r => r.code === 'TOKEN_HAS_FREEZE_AUTHORITY' && r.severity === 'RED')).toBe(true);
    });

    it('flags mint authority as CAUTION (AMBER)', async () => {
      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ hasMintAuthority: true, mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const request = makeRequest({ quoteTimestamp: Date.now() });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);

      expect(result.level).toBe(RiskSignal.AMBER);
      expect(result.reasons.some(r => r.code === 'TOKEN_HAS_MINT_AUTHORITY' && r.severity === 'AMBER')).toBe(true);
      expect(result.blockedInProtectedMode).toBe(false);
    });

    it('flags Token-2022 transfer fee as UNSAFE (RED)', async () => {
      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ isToken2022: true, hasTransferFee: true, mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const request = makeRequest({ quoteTimestamp: Date.now(), protectedMode: false });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);
      expect(result.level).toBe(RiskSignal.RED);
      expect(result.reasons.some(r => r.code === 'TOKEN_TOKEN2022_WITH_TRANSFER_FEE' && r.severity === 'RED')).toBe(true);
    });

    it('flags Token-2022 without transfer fee as CAUTION (AMBER) in normal mode', async () => {
      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ isToken2022: true, hasTransferFee: false, mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const request = makeRequest({ quoteTimestamp: Date.now(), protectedMode: false });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);

      expect(result.level).toBe(RiskSignal.AMBER);
      expect(
        result.reasons.some(r => r.code === 'TOKEN_TOKEN2022_UNSUPPORTED' && r.severity === 'AMBER')
      ).toBe(true);
      expect(result.blockedInProtectedMode).toBe(false);
    });

    it('flags Token-2022 without transfer fee as UNSAFE (RED) in protected mode', async () => {
      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ isToken2022: true, hasTransferFee: false, mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const request = makeRequest({ quoteTimestamp: Date.now(), protectedMode: true });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);

      expect(result.level).toBe(RiskSignal.RED);
      expect(
        result.reasons.some(r => r.code === 'TOKEN_TOKEN2022_UNSUPPORTED' && r.severity === 'RED')
      ).toBe(true);
      expect(result.blockedInProtectedMode).toBe(true);
    });

    it('adds QUOTE_STALE at >= 15s and blocks in protected mode', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:20.000Z'));

      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const now = Date.now();
      const request = makeRequest({ quoteTimestamp: now - 16_000, protectedMode: true });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);

      expect(result.reasons.some(r => r.code === 'QUOTE_STALE' && r.severity === 'AMBER')).toBe(true);
      expect(result.level).toBe(RiskSignal.AMBER);
      expect(result.blockedInProtectedMode).toBe(true);
    });

    it('adds QUOTE_EXPIRED at >= 30s (RED)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T00:00:40.000Z'));

      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const now = Date.now();
      const request = makeRequest({ quoteTimestamp: now - 31_000, protectedMode: false });
      const quote = makeQuote({ priceImpactPct: '0.0001' });

      const result = await service.scoreSwap(request, quote);

      expect(result.level).toBe(RiskSignal.RED);
      expect(result.reasons.some(r => r.code === 'QUOTE_EXPIRED' && r.severity === 'RED')).toBe(true);
    });

    it('applies composition rule: not allowlisted token + non-green trade risk => RED', async () => {
      // Make token "unknown" by marking it as not allowlisted
      jest.spyOn(service, 'getTokenSafetyInfo')
        .mockResolvedValueOnce(makeTokenSafety({ isWhitelisted: false, isKnownToken: false, mint: 'mintA' }))
        .mockResolvedValueOnce(makeTokenSafety({ mint: 'mintB' }));

      const request = makeRequest({ quoteTimestamp: Date.now(), protectedMode: false, slippageBps: 50 });
      // 3% price impact => CAUTION (AMBER)
      const quote = makeQuote({ priceImpactPct: '0.03' });

      const result = await service.scoreSwap(request, quote);

      expect(result.level).toBe(RiskSignal.RED);
      expect(result.reasons.some(r => r.code === 'TOKEN_NOT_ALLOWLISTED')).toBe(true);
      expect(result.reasons.some(r => r.code === 'PRICE_IMPACT_CAUTION')).toBe(true);
      expect(result.reasons.some(r => r.code === 'TOKEN_UNKNOWN_AND_TRADE_RISKY' && r.severity === 'RED')).toBe(true);
      // Not protected => blocked flag should remain false
      expect(result.blockedInProtectedMode).toBe(false);
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
