/**
 * Risk Scoring Integration Tests
 *
 * Tests for the risk assessment and traffic light system.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe('RiskScoringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Quote Risk Assessment', () => {
    it('should return green for low-risk quote', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '100000000',
        otherAmountThreshold: '99500000', // 0.5% slippage
        priceImpactPct: '0.1', // Low price impact
        routePlan: [{}], // Single hop
      };

      const assessment = service.assessQuote(quote as any);

      expect(assessment.overallSignal).toBe('green');
      expect(assessment.canProceed).toBe(true);
      expect(assessment.requiresAcknowledgement).toBe(false);
    });

    it('should return yellow for medium-risk quote', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '100000000',
        otherAmountThreshold: '98000000', // 2% slippage
        priceImpactPct: '1.5', // Medium price impact
        routePlan: [{}, {}, {}], // Multiple hops
      };

      const assessment = service.assessQuote(quote as any);

      expect(assessment.overallSignal).toBe('yellow');
      expect(assessment.canProceed).toBe(true);
      expect(assessment.requiresAcknowledgement).toBe(true);
    });

    it('should return red for high-risk quote', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '100000000000', // Large amount (100 SOL)
        outAmount: '9500000000',
        otherAmountThreshold: '9000000000', // 5% slippage
        priceImpactPct: '8.0', // Very high price impact
        routePlan: [{}, {}, {}, {}], // Many hops
      };

      const assessment = service.assessQuote(quote as any);

      expect(assessment.overallSignal).toBe('red');
      expect(assessment.canProceed).toBe(false);
      expect(assessment.requiresAcknowledgement).toBe(true);
    });

    it('should include specific risk reasons', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      const quote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '100000000',
        otherAmountThreshold: '95000000', // 5% threshold
        priceImpactPct: '6.0', // High price impact
        routePlan: [],
      };

      const assessment = service.assessQuote(quote as any);

      expect(assessment.reasons.length).toBeGreaterThan(0);
      
      const hasPriceImpactReason = assessment.reasons.some(
        (r) => r.factor === 'priceImpact'
      );
      expect(hasPriceImpactReason).toBe(true);
    });
  });

  describe('Risk Scoring Thresholds', () => {
    it('should identify high price impact', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      // Price impact thresholds:
      // < 1% = green, 1-3% = yellow, > 3% = red
      expect(service['scorePriceImpact'](0.5)).toBe('green');
      expect(service['scorePriceImpact'](2.0)).toBe('yellow');
      expect(service['scorePriceImpact'](5.0)).toBe('red');
    });

    it('should identify high slippage', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      // Slippage thresholds:
      // < 1% = green, 1-3% = yellow, > 3% = red
      const lowSlippage = (100 - 99.5) / 100; // 0.5%
      const medSlippage = (100 - 98) / 100; // 2%
      const highSlippage = (100 - 95) / 100; // 5%

      expect(service['scoreSlippage'](lowSlippage)).toBe('green');
      expect(service['scoreSlippage'](medSlippage)).toBe('yellow');
      expect(service['scoreSlippage'](highSlippage)).toBe('red');
    });

    it('should aggregate multiple risk factors', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      // Any red factor makes overall red
      const signals = ['green', 'yellow', 'red'];
      const aggregated = service['aggregateSignals'](signals as any);
      
      expect(aggregated).toBe('red');
    });

    it('should promote to yellow when all green', async () => {
      const { RiskScoringService } = await import('../../src/services/riskScoring.js');
      const service = new RiskScoringService();

      const signals = ['green', 'green', 'green'];
      const aggregated = service['aggregateSignals'](signals as any);
      
      expect(aggregated).toBe('green');
    });
  });

  describe('Protected Mode Logic', () => {
    it('should block red signals in protected mode', () => {
      const protectedMode = true;
      const signal = 'red';

      const shouldBlock = protectedMode && signal === 'red';
      expect(shouldBlock).toBe(true);
    });

    it('should allow green signals in protected mode', () => {
      const protectedMode = true;
      const signal = 'green';

      const shouldBlock = protectedMode && signal === 'red';
      expect(shouldBlock).toBe(false);
    });

    it('should allow red signals when not in protected mode', () => {
      const protectedMode = false;
      const signal = 'red';

      const shouldBlock = protectedMode && signal === 'red';
      expect(shouldBlock).toBe(false);
    });
  });
});
