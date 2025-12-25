import { describe, expect, it, beforeEach } from '@jest/globals';
import { performance } from 'perf_hooks';

import type { Connection } from '@solana/web3.js';

import {
  OptimizationPlanner,
  type OptimizationStrategy,
  type PaymentLeg,
} from '../../src/services/optimizationPlanner';
import type { DatabaseService } from '../../src/db/database';

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

describe('OptimizationPlanner (current API)', () => {
  let planner: OptimizationPlanner;

  beforeEach(() => {
    const mockConnection = {} as unknown as Connection;
    const mockDb = {} as unknown as DatabaseService;
    planner = new OptimizationPlanner(mockConnection, mockDb);
  });

  function leg(overrides: Partial<PaymentLeg>): PaymentLeg {
    return {
      tokenMint: 'So11111111111111111111111111111111111111112',
      tokenSymbol: 'SOL',
      amountIn: '100',
      expectedUsdcOut: '100',
      priceImpactBps: 10,
      slippageBps: 50,
      route: {
        steps: 1,
        labels: ['Orca'],
        estimatedCU: 200_000,
      },
      risk: {
        score: 10,
        factors: [],
        confidence: 0.9,
      },
      priority: 0,
      ...overrides,
    };
  }

  it('sorts by min-risk (lowest risk first)', () => {
    const candidates = [
      leg({ tokenSymbol: 'A', risk: { score: 40, factors: [], confidence: 0.9 } }),
      leg({ tokenSymbol: 'B', risk: { score: 5, factors: [], confidence: 0.9 } }),
      leg({ tokenSymbol: 'C', risk: { score: 15, factors: [], confidence: 0.9 } }),
    ];

    const sorted = (planner as any).sortByStrategy(candidates, 'min-risk' as OptimizationStrategy);
    expect(sorted.map((l: PaymentLeg) => l.risk.score)).toEqual([5, 15, 40]);
  });

  it('sorts by min-slippage (lowest price impact first)', () => {
    const candidates = [
      leg({ tokenSymbol: 'A', priceImpactBps: 80 }),
      leg({ tokenSymbol: 'B', priceImpactBps: 5 }),
      leg({ tokenSymbol: 'C', priceImpactBps: 20 }),
    ];

    const sorted = (planner as any).sortByStrategy(candidates, 'min-slippage' as OptimizationStrategy);
    expect(sorted.map((l: PaymentLeg) => l.priceImpactBps)).toEqual([5, 20, 80]);
  });

  it('sorts by min-fees (lowest estimatedCU first)', () => {
    const candidates = [
      leg({ tokenSymbol: 'A', route: { steps: 1, labels: ['X'], estimatedCU: 600_000 } }),
      leg({ tokenSymbol: 'B', route: { steps: 1, labels: ['X'], estimatedCU: 200_000 } }),
      leg({ tokenSymbol: 'C', route: { steps: 1, labels: ['X'], estimatedCU: 300_000 } }),
    ];

    const sorted = (planner as any).sortByStrategy(candidates, 'min-fees' as OptimizationStrategy);
    expect(sorted.map((l: PaymentLeg) => l.route.estimatedCU)).toEqual([200_000, 300_000, 600_000]);
  });

  it('optimizeSelection respects maxLegs and reaches target when possible', () => {
    const candidates = [
      leg({ tokenSymbol: 'A', expectedUsdcOut: '30', risk: { score: 10, factors: [], confidence: 0.9 } }),
      leg({ tokenSymbol: 'B', expectedUsdcOut: '30', risk: { score: 20, factors: [], confidence: 0.9 } }),
      leg({ tokenSymbol: 'C', expectedUsdcOut: '30', risk: { score: 30, factors: [], confidence: 0.9 } }),
    ];

    const config = (planner as any).config;
    const selected = (planner as any).optimizeSelection(
      candidates,
      50n,
      2,
      'min-risk' as OptimizationStrategy,
      config
    ) as PaymentLeg[];

    expect(selected.length).toBeLessThanOrEqual(2);
    const total = selected.reduce((sum, l) => sum + BigInt(l.expectedUsdcOut), 0n);
    expect(total).toBeGreaterThanOrEqual(50n);
  });

  it('optimizeSelection skips legs that exceed maxCU', () => {
    const candidates = [
      leg({ tokenSymbol: 'A', expectedUsdcOut: '50', route: { steps: 1, labels: ['X'], estimatedCU: 2_000_000 } }),
      leg({ tokenSymbol: 'B', expectedUsdcOut: '50', route: { steps: 1, labels: ['X'], estimatedCU: 200_000 } }),
    ];

    const config = { ...(planner as any).config, maxCU: 500_000 };
    const selected = (planner as any).optimizeSelection(
      candidates,
      50n,
      5,
      'min-fees' as OptimizationStrategy,
      config
    ) as PaymentLeg[];

    expect(selected.length).toBe(1);
    expect(selected[0].tokenSymbol).toBe('B');
  });

  it('F7: computes selection within a reasonable time', () => {
    const candidates: PaymentLeg[] = [];

    for (let i = 0; i < 1000; i++) {
      candidates.push(
        leg({
          tokenMint: `mint-${i}`,
          tokenSymbol: `T${i}`,
          expectedUsdcOut: String(1 + (i % 5)),
          priceImpactBps: i % 200,
          route: { steps: 1 + (i % 3), labels: ['X'], estimatedCU: 200_000 + (i % 5) * 50_000 },
          risk: { score: i % 100, factors: [], confidence: 0.9 },
        })
      );
    }

    const config = (planner as any).config;

    const t0 = performance.now();
    const selected = (planner as any).optimizeSelection(
      candidates,
      200n,
      5,
      'balanced' as OptimizationStrategy,
      config
    ) as PaymentLeg[];
    const elapsedMs = performance.now() - t0;

    expect(selected.length).toBeGreaterThan(0);
    // Seuil très large pour éviter les flakes CI.
    expect(elapsedMs).toBeLessThan(1500);
  });
});
