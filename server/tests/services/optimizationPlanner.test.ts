/**
 * OptimizationPlanner V2 Unit Tests
 *
 * Tests for N-token knapsack optimization and payment planning.
 */

import {
  OptimizationPlanner,
  TokenOption,
  PlanRequest,
  OptimizationStrategy,
} from '../../src/services/optimizationPlanner';
import { DatabaseService } from '../../src/db/database';
import { performance } from 'perf_hooks';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Legacy test suite (API drift). Replaced by optimizationPlanner.v2.test.ts.
describe.skip('OptimizationPlanner V2', () => {
  let planner: OptimizationPlanner;
  let mockDb: Partial<DatabaseService>;

  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

  beforeEach(() => {
    mockDb = {
      saveInvoiceReservation: jest.fn().mockResolvedValue(undefined),
      getInvoiceReservation: jest.fn().mockResolvedValue(null),
      savePaymentLeg: jest.fn().mockResolvedValue(undefined),
    };

    planner = new OptimizationPlanner(mockDb as DatabaseService);
  });

  describe('optimizeSelection()', () => {
    const createTokenOption = (
      mint: string,
      balance: string,
      usdcValue: string,
      riskScore: number,
      slippageBps: number,
      feeBps: number
    ): TokenOption => ({
      mint,
      symbol: mint.slice(0, 4),
      balance,
      decimals: 6,
      usdcValue,
      riskScore,
      slippageBps,
      feeBps,
      hops: 1,
      priceImpactBps: 10,
    });

    it('should select single token when sufficient', () => {
      const options: TokenOption[] = [
        createTokenOption(USDC_MINT, '10000000', '10', 5, 10, 5),
        createTokenOption(SOL_MINT, '1000000000', '50', 15, 30, 10),
      ];

      const result = planner.optimizeSelection(options, 5, 'balanced');

      expect(result.selectedTokens.length).toBe(1);
      expect(result.selectedTokens[0].mint).toBe(USDC_MINT);
      expect(result.totalUsdcOut).toBeGreaterThanOrEqual(5);
    });

    it('should combine multiple tokens when needed', () => {
      const options: TokenOption[] = [
        createTokenOption(USDC_MINT, '3000000', '3', 5, 10, 5),
        createTokenOption(SOL_MINT, '100000000', '5', 15, 30, 10),
      ];

      const result = planner.optimizeSelection(options, 7, 'balanced');

      expect(result.selectedTokens.length).toBe(2);
      expect(result.totalUsdcOut).toBeGreaterThanOrEqual(7);
    });

    it('should respect maxLegs limit', () => {
      const options: TokenOption[] = [
        createTokenOption(USDC_MINT, '2000000', '2', 5, 10, 5),
        createTokenOption(SOL_MINT, '100000000', '2', 15, 30, 10),
        createTokenOption(BONK_MINT, '1000000000000', '2', 25, 50, 15),
        createTokenOption(USDT_MINT, '2000000', '2', 5, 10, 5),
      ];

      const result = planner.optimizeSelection(options, 6, 'balanced', 2);

      expect(result.selectedTokens.length).toBeLessThanOrEqual(2);
    });

    describe('strategy-based sorting', () => {
      const mixedOptions: TokenOption[] = [
        createTokenOption(SOL_MINT, '1000000000', '10', 30, 50, 20), // high risk, high slippage
        createTokenOption(USDC_MINT, '5000000', '5', 5, 5, 2), // low risk, low slippage
        createTokenOption(BONK_MINT, '1000000000000', '8', 50, 100, 30), // very high risk
      ];

      it('should prioritize low risk tokens with min-risk strategy', () => {
        const result = planner.optimizeSelection(mixedOptions, 10, 'min-risk');

        // Should prefer USDC (lowest risk) first
        expect(result.selectedTokens[0].mint).toBe(USDC_MINT);
      });

      it('should prioritize low slippage tokens with min-slippage strategy', () => {
        const result = planner.optimizeSelection(mixedOptions, 10, 'min-slippage');

        // Should prefer USDC (lowest slippage) first
        expect(result.selectedTokens[0].mint).toBe(USDC_MINT);
      });

      it('should prioritize low fee tokens with min-fees strategy', () => {
        const result = planner.optimizeSelection(mixedOptions, 10, 'min-fees');

        // Should prefer USDC (lowest fees) first
        expect(result.selectedTokens[0].mint).toBe(USDC_MINT);
      });

      it('should use balanced scoring with balanced strategy', () => {
        const result = planner.optimizeSelection(mixedOptions, 10, 'balanced');

        // Should prefer USDC (best overall) first
        expect(result.selectedTokens[0].mint).toBe(USDC_MINT);
      });
    });

    it('should return empty selection when target cannot be met', () => {
      const options: TokenOption[] = [
        createTokenOption(USDC_MINT, '1000000', '1', 5, 10, 5),
      ];

      const result = planner.optimizeSelection(options, 100, 'balanced');

      expect(result.selectedTokens.length).toBe(1);
      expect(result.totalUsdcOut).toBeLessThan(100);
      expect(result.shortfall).toBeGreaterThan(0);
    });

    it('should compute a plan within a reasonable time', () => {
      const options: TokenOption[] = [];

      // Large-ish input to exercise sorting/scoring without making the test flaky.
      for (let i = 0; i < 500; i++) {
        options.push(
          createTokenOption(
            `${USDC_MINT.slice(0, 10)}${i}`,
            '1000000',
            // USDC value between 0.1 and 2.0
            (0.1 + (i % 20) * 0.1).toFixed(2),
            i % 100,
            i % 200,
            i % 50
          )
        );
      }

      const t0 = performance.now();
      const result = planner.optimizeSelection(options, 50, 'balanced');
      const elapsedMs = performance.now() - t0;

      expect(result.selectedTokens.length).toBeGreaterThan(0);
      // Very generous upper bound to avoid CI variability.
      expect(elapsedMs).toBeLessThan(1500);
    });
  });

  describe('calculateCompositeScore()', () => {
    it('should weight risk, slippage, and fees according to weights', () => {
      const token: TokenOption = {
        mint: SOL_MINT,
        symbol: 'SOL',
        balance: '1000000000',
        decimals: 9,
        usdcValue: '100',
        riskScore: 20,
        slippageBps: 50,
        feeBps: 10,
        hops: 2,
        priceImpactBps: 30,
      };

      // Default weights: risk=0.4, slippage=0.35, fees=0.25
      const score = planner.calculateCompositeScore(token, 'balanced');

      // Score should be positive and reasonable
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
    });

    it('should return 0 for direct USDC transfer', () => {
      const token: TokenOption = {
        mint: USDC_MINT,
        symbol: 'USDC',
        balance: '1000000',
        decimals: 6,
        usdcValue: '1',
        riskScore: 0,
        slippageBps: 0,
        feeBps: 0,
        hops: 0,
        priceImpactBps: 0,
      };

      const score = planner.calculateCompositeScore(token, 'min-risk');

      expect(score).toBe(0);
    });
  });

  describe('planPayment()', () => {
    it('should validate required fields', async () => {
      const request: PlanRequest = {
        invoiceId: '',
        payerPublicKey: 'payer',
        tokenOptions: [],
        targetUsdcAmount: 100,
        settleMint: USDC_MINT,
        strategy: 'balanced',
      };

      const result = await planner.planPayment(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('invoiceId');
    });

    it('should reject when maxLegs exceeds safety limit', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer',
        tokenOptions: [],
        targetUsdcAmount: 100,
        settleMint: USDC_MINT,
        strategy: 'balanced',
        maxLegs: 10, // Exceeds default limit of 5
      };

      const result = await planner.planPayment(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('maxLegs');
    });

    it('should handle empty token options', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer',
        tokenOptions: [],
        targetUsdcAmount: 100,
        settleMint: USDC_MINT,
        strategy: 'balanced',
      };

      const result = await planner.planPayment(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No tokens');
    });

    it('should generate valid plan for sufficient balances', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        tokenOptions: [
          {
            mint: USDC_MINT,
            symbol: 'USDC',
            balance: '10000000',
            decimals: 6,
            usdcValue: '10',
            riskScore: 0,
            slippageBps: 0,
            feeBps: 0,
            hops: 0,
            priceImpactBps: 0,
          },
        ],
        targetUsdcAmount: 5,
        settleMint: USDC_MINT,
        strategy: 'balanced',
      };

      const result = await planner.planPayment(request);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.legs.length).toBeGreaterThan(0);
      expect(result.plan!.totalExpectedUsdcOut).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Safety Checks', () => {
    it('should reject tokens exceeding maxPriceImpactBps', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer',
        tokenOptions: [
          {
            mint: BONK_MINT,
            symbol: 'BONK',
            balance: '1000000000000',
            decimals: 5,
            usdcValue: '100',
            riskScore: 50,
            slippageBps: 50,
            feeBps: 10,
            hops: 3,
            priceImpactBps: 500, // Exceeds default 300 bps limit
          },
        ],
        targetUsdcAmount: 50,
        settleMint: USDC_MINT,
        strategy: 'balanced',
        safetyLimits: {
          maxPriceImpactBps: 300,
          maxSlippageBps: 100,
          maxLegs: 5,
          maxCU: 1400000,
        },
      };

      const result = await planner.planPayment(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('price impact');
    });

    it('should filter out tokens exceeding safety limits', () => {
      const options: TokenOption[] = [
        {
          mint: USDC_MINT,
          symbol: 'USDC',
          balance: '5000000',
          decimals: 6,
          usdcValue: '5',
          riskScore: 0,
          slippageBps: 0,
          feeBps: 0,
          hops: 0,
          priceImpactBps: 0,
        },
        {
          mint: BONK_MINT,
          symbol: 'BONK',
          balance: '1000000000000',
          decimals: 5,
          usdcValue: '100',
          riskScore: 80,
          slippageBps: 200, // Exceeds limit
          feeBps: 50,
          hops: 4,
          priceImpactBps: 400, // Exceeds limit
        },
      ];

      const safeOptions = planner.filterSafeTokens(options, {
        maxPriceImpactBps: 300,
        maxSlippageBps: 100,
        maxLegs: 5,
        maxCU: 1400000,
      });

      expect(safeOptions.length).toBe(1);
      expect(safeOptions[0].mint).toBe(USDC_MINT);
    });
  });

  describe('Aggregate Risk Calculation', () => {
    it('should calculate weighted aggregate risk', () => {
      const selectedTokens: TokenOption[] = [
        {
          mint: USDC_MINT,
          symbol: 'USDC',
          balance: '5000000',
          decimals: 6,
          usdcValue: '5',
          riskScore: 5,
          slippageBps: 10,
          feeBps: 2,
          hops: 0,
          priceImpactBps: 0,
        },
        {
          mint: SOL_MINT,
          symbol: 'SOL',
          balance: '100000000',
          decimals: 9,
          usdcValue: '5',
          riskScore: 25,
          slippageBps: 50,
          feeBps: 10,
          hops: 2,
          priceImpactBps: 30,
        },
      ];

      const aggregateRisk = planner.calculateAggregateRisk(selectedTokens);

      // Weighted average: (5*5 + 25*5) / 10 = 15
      expect(aggregateRisk.score).toBe(15);
      expect(aggregateRisk.level).toBe('medium'); // 15 is medium risk
    });

    it('should classify risk levels correctly', () => {
      const lowRisk: TokenOption[] = [
        {
          mint: USDC_MINT,
          symbol: 'USDC',
          balance: '10000000',
          decimals: 6,
          usdcValue: '10',
          riskScore: 5,
          slippageBps: 5,
          feeBps: 2,
          hops: 0,
          priceImpactBps: 0,
        },
      ];

      const highRisk: TokenOption[] = [
        {
          mint: BONK_MINT,
          symbol: 'BONK',
          balance: '1000000000000',
          decimals: 5,
          usdcValue: '10',
          riskScore: 80,
          slippageBps: 100,
          feeBps: 30,
          hops: 4,
          priceImpactBps: 200,
        },
      ];

      expect(planner.calculateAggregateRisk(lowRisk).level).toBe('low');
      expect(planner.calculateAggregateRisk(highRisk).level).toBe('high');
    });
  });
});
