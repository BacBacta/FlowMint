/**
 * SplitTenderPlanner Unit Tests
 * 
 * Tests for V1.5 split-tender multi-token payment planning.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { SplitTenderPlanner, TokenBalance, PlanRequest } from '../../src/services/splitTenderPlanner';
import { DatabaseService, PolicyRecord } from '../../src/db/database';

// Mock modules
jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn().mockImplementation(() => ({
    getBalance: jest.fn().mockResolvedValue(1000000000),
    getParsedTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 12345,
    }),
  })),
  PublicKey: jest.fn().mockImplementation((key: string) => ({
    toBase58: () => key,
    toString: () => key,
  })),
}));

jest.mock('../../src/services/jupiterService', () => ({
  jupiterService: {
    quoteSwap: jest.fn(),
  },
}));

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

// Import mocked jupiter service
import { jupiterService } from '../../src/services/jupiterService';

describe('SplitTenderPlanner', () => {
  let planner: SplitTenderPlanner;
  let mockDb: Partial<DatabaseService>;
  let mockConnection: Connection;

  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      saveInvoiceReservation: jest.fn().mockResolvedValue(undefined),
      getInvoiceReservation: jest.fn().mockResolvedValue(null),
      savePaymentLeg: jest.fn().mockResolvedValue(undefined),
    };

    mockConnection = new Connection('https://api.mainnet-beta.solana.com');
    planner = new SplitTenderPlanner(mockConnection, mockDb as DatabaseService);
  });

  describe('plan()', () => {
    it('should return error when no payment tokens specified', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No payment tokens specified');
    });

    it('should return error when more than 2 tokens specified', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT, BONK_MINT, USDC_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
          { mint: BONK_MINT, balance: '1000000000000', decimals: 5 },
          { mint: USDC_MINT, balance: '1000000', decimals: 6 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum 2 tokens allowed');
    });

    it('should return error when no tokens have balance', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT, BONK_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '0', decimals: 9 },
          { mint: BONK_MINT, balance: '0', decimals: 5 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No tokens with available balance');
    });

    it('should create direct transfer plan when paying with settlement token', async () => {
      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [USDC_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: USDC_MINT, balance: '5000000', decimals: 6 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.legs).toHaveLength(1);
      expect(result.plan!.legs[0].payMint).toBe(USDC_MINT);
      expect(result.plan!.legs[0].priceImpactBps).toBe(0);
      expect(result.plan!.aggregateRisk.score).toBe(0);
    });

    it('should plan single-leg swap when one token covers amount', async () => {
      (jupiterService.quoteSwap as jest.Mock).mockResolvedValueOnce({
        inAmount: '100000000',
        outAmount: '2000000',
        priceImpactPct: '0.5',
        routePlan: [{ swapInfo: {} }],
      });

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.legs).toHaveLength(1);
      expect(result.plan!.legs[0].payMint).toBe(SOL_MINT);
    });

    it('should plan two-leg split when needed', async () => {
      (jupiterService.quoteSwap as jest.Mock)
        .mockResolvedValueOnce({
          inAmount: '50000000',
          outAmount: '600000',
          priceImpactPct: '0.3',
          routePlan: [{ swapInfo: {} }],
        })
        .mockResolvedValueOnce({
          inAmount: '500000000000',
          outAmount: '500000',
          priceImpactPct: '0.2',
          routePlan: [{ swapInfo: {} }],
        });

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT, BONK_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '50000000', decimals: 9 },
          { mint: BONK_MINT, balance: '500000000000', decimals: 5 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.legs).toHaveLength(2);
      expect(result.plan!.aggregateRisk.warnings).toContain('Split payment: 2 transactions required');
    });

    it('should respect min-slippage strategy', async () => {
      (jupiterService.quoteSwap as jest.Mock)
        .mockResolvedValueOnce({
          inAmount: '100000000',
          outAmount: '2000000',
          priceImpactPct: '1.5',
          routePlan: [{ swapInfo: {} }],
        })
        .mockResolvedValueOnce({
          inAmount: '1000000000000',
          outAmount: '2000000',
          priceImpactPct: '0.2',
          routePlan: [{ swapInfo: {} }],
        });

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT, BONK_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-slippage',
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
          { mint: BONK_MINT, balance: '1000000000000', decimals: 5 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      // With min-slippage strategy, should prefer BONK (lower impact)
      expect(result.plan!.legs[0].payMint).toBe(BONK_MINT);
    });

    it('should reject when price impact exceeds policy limit', async () => {
      (jupiterService.quoteSwap as jest.Mock).mockResolvedValueOnce({
        inAmount: '100000000',
        outAmount: '1000000',
        priceImpactPct: '5.0',
        routePlan: [{ swapInfo: {} }],
      });

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No valid swap routes found');
    });

    it('should apply custom policy limits', async () => {
      (jupiterService.quoteSwap as jest.Mock).mockResolvedValueOnce({
        inAmount: '100000000',
        outAmount: '1000000',
        priceImpactPct: '4.0',
        routePlan: [{ swapInfo: {} }],
      });

      const policy: PolicyRecord = {
        id: 'policy-1',
        merchantId: 'merchant-1',
        maxSlippageBps: 100,
        maxPriceImpactBps: 500,
        maxHops: 4,
        minOutputAmount: '0',
        allowedPayMints: [],
        blockedPayMints: [],
        requireKyc: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        policy,
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(true);
    });
  });

  describe('createReservation()', () => {
    it('should create reservation with correct TTL', async () => {
      const plan = {
        legs: [
          {
            payMint: SOL_MINT,
            amountIn: '100000000',
            expectedUsdcOut: '1000000',
            priceImpactBps: 50,
            slippageBps: 50,
            routeSteps: 1,
            risk: { score: 20, priceImpactBps: 50, routeComplexity: 'simple' as const, warnings: [] },
          },
        ],
        totalAmountIn: { [SOL_MINT]: '100000000' },
        totalExpectedUsdcOut: '1000000',
        settlementAmount: '1000000',
        refundPolicy: 'usdc-refund' as const,
        strategy: 'min-risk' as const,
        aggregateRisk: { score: 20, warnings: [] },
        estimatedDurationMs: 30000,
      };

      const { reservation, legs } = await planner.createReservation(
        'inv-123',
        'payer-pubkey',
        plan
      );

      expect(mockDb.saveInvoiceReservation).toHaveBeenCalled();
      expect(mockDb.savePaymentLeg).toHaveBeenCalledTimes(1);

      expect(reservation.invoiceId).toBe('inv-123');
      expect(reservation.payer).toBe('payer-pubkey');
      expect(reservation.status).toBe('active');
      expect(reservation.totalLegs).toBe(1);
      expect(reservation.completedLegs).toBe(0);
      expect(reservation.expiresAt).toBeGreaterThan(Date.now());

      expect(legs).toHaveLength(1);
      expect(legs[0].payMint).toBe(SOL_MINT);
      expect(legs[0].status).toBe('pending');
    });

    it('should create multiple legs for split payment', async () => {
      const plan = {
        legs: [
          {
            payMint: SOL_MINT,
            amountIn: '50000000',
            expectedUsdcOut: '500000',
            priceImpactBps: 30,
            slippageBps: 50,
            routeSteps: 1,
            risk: { score: 15, priceImpactBps: 30, routeComplexity: 'simple' as const, warnings: [] },
          },
          {
            payMint: BONK_MINT,
            amountIn: '500000000000',
            expectedUsdcOut: '500000',
            priceImpactBps: 20,
            slippageBps: 50,
            routeSteps: 2,
            risk: { score: 25, priceImpactBps: 20, routeComplexity: 'medium' as const, warnings: [] },
          },
        ],
        totalAmountIn: { [SOL_MINT]: '50000000', [BONK_MINT]: '500000000000' },
        totalExpectedUsdcOut: '1000000',
        settlementAmount: '1000000',
        refundPolicy: 'usdc-refund' as const,
        strategy: 'min-risk' as const,
        aggregateRisk: { score: 24, warnings: ['Split payment: 2 transactions required'] },
        estimatedDurationMs: 60000,
      };

      const { reservation, legs } = await planner.createReservation(
        'inv-456',
        'payer-pubkey-2',
        plan
      );

      expect(mockDb.savePaymentLeg).toHaveBeenCalledTimes(2);
      expect(reservation.totalLegs).toBe(2);
      expect(legs).toHaveLength(2);
      expect(legs[0].legIndex).toBe(0);
      expect(legs[1].legIndex).toBe(1);
    });
  });

  describe('Risk Assessment', () => {
    it('should assign higher risk to complex routes', async () => {
      (jupiterService.quoteSwap as jest.Mock).mockResolvedValueOnce({
        inAmount: '100000000',
        outAmount: '1000000',
        priceImpactPct: '0.2',
        routePlan: [
          { swapInfo: {} },
          { swapInfo: {} },
          { swapInfo: {} },
          { swapInfo: {} },
          { swapInfo: {} },
        ],
      });

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(false);
    });

    it('should prefer stablecoins for lower risk', async () => {
      const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
      
      (jupiterService.quoteSwap as jest.Mock).mockResolvedValueOnce({
        inAmount: '1000000',
        outAmount: '1000000',
        priceImpactPct: '0.1',
        routePlan: [{ swapInfo: {} }],
      });

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [USDT_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: USDT_MINT, balance: '5000000', decimals: 6 },
        ],
      };

      const result = await planner.plan(request);

      expect(result.success).toBe(true);
      expect(result.plan!.aggregateRisk.score).toBeLessThan(30);
    });
  });

  describe('Determinism', () => {
    it('should produce same plan for same inputs', async () => {
      const mockQuoteResponse = {
        inAmount: '100000000',
        outAmount: '2000000',
        priceImpactPct: '0.5',
        routePlan: [{ swapInfo: {} }],
      };

      (jupiterService.quoteSwap as jest.Mock)
        .mockResolvedValueOnce(mockQuoteResponse)
        .mockResolvedValueOnce(mockQuoteResponse);

      const request: PlanRequest = {
        invoiceId: 'inv-123',
        payerPublicKey: 'payer-pubkey',
        payMints: [SOL_MINT],
        amountOut: '1000000',
        settleMint: USDC_MINT,
        strategy: 'min-risk',
        balances: [
          { mint: SOL_MINT, balance: '1000000000', decimals: 9 },
        ],
      };

      const result1 = await planner.plan(request);
      const result2 = await planner.plan(request);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.plan!.strategy).toBe(result2.plan!.strategy);
      expect(result1.plan!.legs.length).toBe(result2.plan!.legs.length);
    });
  });
});
