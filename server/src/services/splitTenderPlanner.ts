/**
 * SplitTenderPlanner - PortfolioPay V1.5
 *
 * Plans multi-token payment strategies for invoices.
 * Selects optimal token combination (max 2 legs) to reach exact USDC output.
 */

import { v4 as uuidv4 } from 'uuid';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  DatabaseService,
  PolicyRecord,
  SplitTenderStrategy,
  InvoiceReservationRecord,
  PaymentLegRecord,
} from '../db/database';
import { jupiterService } from './jupiterService';
import { logger } from '../utils/logger';

// Constants
const MAX_LEGS = 2;
const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_PRICE_IMPACT_BPS = 300; // 3%
const RESERVATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES_PER_LEG = 3;

// Known stablecoins (prefer for splitting)
const STABLECOINS = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

export interface TokenBalance {
  mint: string;
  symbol?: string;
  balance: string; // lamports/smallest unit
  decimals: number;
  usdValue?: number;
}

export interface LegPlan {
  payMint: string;
  amountIn: string;
  expectedUsdcOut: string;
  priceImpactBps: number;
  slippageBps: number;
  routeSteps: number;
  risk: LegRisk;
}

export interface LegRisk {
  score: number; // 0-100, lower is better
  priceImpactBps: number;
  routeComplexity: 'simple' | 'medium' | 'complex';
  warnings: string[];
}

export interface SplitPlan {
  legs: LegPlan[];
  totalAmountIn: Record<string, string>; // mint -> amount
  totalExpectedUsdcOut: string;
  settlementAmount: string;
  refundPolicy: 'usdc-refund' | 'payer-refund';
  strategy: SplitTenderStrategy;
  aggregateRisk: {
    score: number;
    warnings: string[];
  };
  estimatedDurationMs: number;
}

export interface PlanRequest {
  invoiceId: string;
  payerPublicKey: string;
  payMints: string[];
  amountOut: string;
  settleMint: string;
  strategy: SplitTenderStrategy;
  policy?: PolicyRecord;
  balances: TokenBalance[];
}

export interface PlanResult {
  success: boolean;
  plan?: SplitPlan;
  error?: string;
  alternatives?: SplitPlan[];
}

export class SplitTenderPlanner {
  private readonly log = logger.child({ service: 'SplitTenderPlanner' });

  constructor(
    private connection: Connection,
    private db: DatabaseService
  ) {}

  /**
   * Plan a split-tender payment
   */
  async plan(request: PlanRequest): Promise<PlanResult> {
    const { payMints, amountOut, settleMint, strategy, balances, policy } = request;

    this.log.info({
      invoiceId: request.invoiceId,
      payMints,
      amountOut,
      strategy,
    }, 'Planning split-tender payment');

    // Validate inputs
    if (payMints.length === 0) {
      return { success: false, error: 'No payment tokens specified' };
    }

    if (payMints.length > MAX_LEGS) {
      return { success: false, error: `Maximum ${MAX_LEGS} tokens allowed` };
    }

    // Filter to tokens with balance
    const availableTokens = payMints.filter((mint) => {
      const balance = balances.find((b) => b.mint === mint);
      return balance && BigInt(balance.balance) > 0n;
    });

    if (availableTokens.length === 0) {
      return { success: false, error: 'No tokens with available balance' };
    }

    // If paying directly in settlement token
    if (availableTokens.length === 1 && availableTokens[0] === settleMint) {
      const balance = balances.find((b) => b.mint === settleMint);
      if (balance && BigInt(balance.balance) >= BigInt(amountOut)) {
        return {
          success: true,
          plan: this.createDirectTransferPlan(settleMint, amountOut, strategy),
        };
      }
    }

    try {
      // Get quotes for each token
      const legQuotes = await this.getQuotesForTokens(
        availableTokens,
        settleMint,
        amountOut,
        balances,
        policy
      );

      // Filter valid quotes
      const validQuotes = legQuotes.filter((q) => q.valid);

      if (validQuotes.length === 0) {
        return { success: false, error: 'No valid swap routes found' };
      }

      // Generate plan based on strategy
      const plan = this.selectOptimalPlan(validQuotes, amountOut, strategy, policy);

      if (!plan) {
        return { success: false, error: 'Could not generate valid payment plan' };
      }

      // Validate aggregate risk
      const riskValidation = this.validateAggregateRisk(plan, policy);
      if (!riskValidation.valid) {
        return { success: false, error: riskValidation.error };
      }

      return { success: true, plan };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error }, 'Failed to plan split-tender');
      return { success: false, error: message };
    }
  }

  /**
   * Get quotes for all candidate tokens
   */
  private async getQuotesForTokens(
    mints: string[],
    settleMint: string,
    totalAmountOut: string,
    balances: TokenBalance[],
    policy?: PolicyRecord
  ): Promise<Array<{ mint: string; valid: boolean; quote?: any; leg?: LegPlan; balance: string }>> {
    const slippageBps = policy?.maxSlippageBps || DEFAULT_SLIPPAGE_BPS;

    const quotePromises = mints.map(async (mint) => {
      const balance = balances.find((b) => b.mint === mint);
      if (!balance) {
        return { mint, valid: false, balance: '0' };
      }

      // Direct transfer for same mint
      if (mint === settleMint) {
        return {
          mint,
          valid: true,
          balance: balance.balance,
          leg: {
            payMint: mint,
            amountIn: balance.balance,
            expectedUsdcOut: balance.balance,
            priceImpactBps: 0,
            slippageBps: 0,
            routeSteps: 0,
            risk: { score: 0, priceImpactBps: 0, routeComplexity: 'simple' as const, warnings: [] },
          },
        };
      }

      try {
        // Get quote for full balance
        const quote = await jupiterService.quoteSwap({
          inputMint: mint,
          outputMint: settleMint,
          amount: balance.balance,
          slippageBps,
          swapMode: 'ExactIn',
        });

        const priceImpactBps = Math.round(parseFloat(quote.priceImpactPct) * 100);
        const routeSteps = quote.routePlan.length;

        // Check against policy limits
        const maxPriceImpact = policy?.maxPriceImpactBps || MAX_PRICE_IMPACT_BPS;
        const maxHops = policy?.maxHops || 4;

        if (priceImpactBps > maxPriceImpact || routeSteps > maxHops) {
          return { mint, valid: false, balance: balance.balance };
        }

        const risk = this.assessLegRisk(priceImpactBps, routeSteps, mint);

        return {
          mint,
          valid: true,
          quote,
          balance: balance.balance,
          leg: {
            payMint: mint,
            amountIn: quote.inAmount,
            expectedUsdcOut: quote.outAmount,
            priceImpactBps,
            slippageBps,
            routeSteps,
            risk,
          },
        };
      } catch (error) {
        this.log.warn({ mint, error }, 'Failed to get quote for token');
        return { mint, valid: false, balance: balance.balance };
      }
    });

    return Promise.all(quotePromises);
  }

  /**
   * Select optimal plan based on strategy
   */
  private selectOptimalPlan(
    quotes: Array<{ mint: string; valid: boolean; leg?: LegPlan; balance: string }>,
    targetAmount: string,
    strategy: SplitTenderStrategy,
    policy?: PolicyRecord
  ): SplitPlan | null {
    const targetBigInt = BigInt(targetAmount);
    const validQuotes = quotes.filter((q) => q.valid && q.leg);

    // Sort by strategy
    const sorted = this.sortByStrategy(validQuotes, strategy);

    // Try single leg first (simplest)
    for (const q of sorted) {
      if (q.leg && BigInt(q.leg.expectedUsdcOut) >= targetBigInt) {
        // Single leg can cover the full amount
        // Recalculate with exact amount needed
        const ratio = Number(targetBigInt) / Number(BigInt(q.leg.expectedUsdcOut));
        const adjustedAmountIn = Math.ceil(Number(BigInt(q.leg.amountIn)) * ratio * 1.01); // 1% buffer

        return {
          legs: [{
            ...q.leg,
            amountIn: adjustedAmountIn.toString(),
            expectedUsdcOut: targetAmount,
          }],
          totalAmountIn: { [q.leg.payMint]: adjustedAmountIn.toString() },
          totalExpectedUsdcOut: targetAmount,
          settlementAmount: targetAmount,
          refundPolicy: 'usdc-refund',
          strategy,
          aggregateRisk: {
            score: q.leg.risk.score,
            warnings: q.leg.risk.warnings,
          },
          estimatedDurationMs: 30000, // ~30s for single leg
        };
      }
    }

    // Need to combine 2 legs
    if (sorted.length >= 2) {
      // Try combinations
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const leg1 = sorted[i].leg!;
          const leg2 = sorted[j].leg!;

          const combined = BigInt(leg1.expectedUsdcOut) + BigInt(leg2.expectedUsdcOut);

          if (combined >= targetBigInt) {
            // Calculate how much to take from each
            const plan = this.calculateSplitAmounts(leg1, leg2, targetAmount);
            if (plan) {
              return plan;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate split amounts for two-leg payment
   */
  private calculateSplitAmounts(
    leg1: LegPlan,
    leg2: LegPlan,
    targetAmount: string
  ): SplitPlan | null {
    const target = BigInt(targetAmount);
    const out1 = BigInt(leg1.expectedUsdcOut);
    const out2 = BigInt(leg2.expectedUsdcOut);
    const total = out1 + out2;

    if (total < target) return null;

    // Proportional split
    const ratio1 = Number(out1) / Number(total);
    const amount1 = Math.floor(Number(target) * ratio1);
    const amount2 = Number(target) - amount1;

    // Calculate input amounts needed
    const inRatio1 = Number(BigInt(leg1.amountIn)) / Number(out1);
    const inRatio2 = Number(BigInt(leg2.amountIn)) / Number(out2);

    const in1 = Math.ceil(amount1 * inRatio1 * 1.01); // 1% buffer
    const in2 = Math.ceil(amount2 * inRatio2 * 1.01);

    const adjustedLeg1: LegPlan = {
      ...leg1,
      amountIn: in1.toString(),
      expectedUsdcOut: amount1.toString(),
    };

    const adjustedLeg2: LegPlan = {
      ...leg2,
      amountIn: in2.toString(),
      expectedUsdcOut: amount2.toString(),
    };

    const combinedRiskScore = Math.round((leg1.risk.score + leg2.risk.score) / 2 * 1.2); // 20% penalty for split
    const combinedWarnings = [...leg1.risk.warnings, ...leg2.risk.warnings];
    combinedWarnings.push('Split payment: 2 transactions required');

    return {
      legs: [adjustedLeg1, adjustedLeg2],
      totalAmountIn: {
        [leg1.payMint]: in1.toString(),
        [leg2.payMint]: in2.toString(),
      },
      totalExpectedUsdcOut: targetAmount,
      settlementAmount: targetAmount,
      refundPolicy: 'usdc-refund',
      strategy: 'min-risk',
      aggregateRisk: {
        score: Math.min(combinedRiskScore, 100),
        warnings: combinedWarnings,
      },
      estimatedDurationMs: 60000, // ~60s for two legs
    };
  }

  /**
   * Sort quotes by strategy
   */
  private sortByStrategy(
    quotes: Array<{ mint: string; valid: boolean; leg?: LegPlan; balance: string }>,
    strategy: SplitTenderStrategy
  ): typeof quotes {
    return [...quotes].sort((a, b) => {
      if (!a.leg || !b.leg) return 0;

      switch (strategy) {
        case 'min-risk':
          return a.leg.risk.score - b.leg.risk.score;
        case 'min-slippage':
          return a.leg.priceImpactBps - b.leg.priceImpactBps;
        case 'min-failure':
          return a.leg.routeSteps - b.leg.routeSteps;
        default:
          return 0;
      }
    });
  }

  /**
   * Assess risk for a single leg
   */
  private assessLegRisk(priceImpactBps: number, routeSteps: number, mint: string): LegRisk {
    const warnings: string[] = [];
    let score = 0;

    // Price impact contribution (0-40 points)
    if (priceImpactBps > 200) {
      score += 40;
      warnings.push(`High price impact: ${priceImpactBps / 100}%`);
    } else if (priceImpactBps > 100) {
      score += 20;
    } else {
      score += Math.floor(priceImpactBps / 10);
    }

    // Route complexity (0-30 points)
    let routeComplexity: 'simple' | 'medium' | 'complex' = 'simple';
    if (routeSteps >= 4) {
      routeComplexity = 'complex';
      score += 30;
      warnings.push(`Complex route: ${routeSteps} hops`);
    } else if (routeSteps >= 2) {
      routeComplexity = 'medium';
      score += 15;
    } else {
      score += routeSteps * 5;
    }

    // Token type (0-30 points)
    if (STABLECOINS.includes(mint)) {
      score += 0; // Stablecoins are safest
    } else {
      score += 20; // Non-stables have more risk
    }

    return {
      score: Math.min(score, 100),
      priceImpactBps,
      routeComplexity,
      warnings,
    };
  }

  /**
   * Validate aggregate risk of plan
   */
  private validateAggregateRisk(
    plan: SplitPlan,
    policy?: PolicyRecord
  ): { valid: boolean; error?: string } {
    const maxRiskScore = 80; // Configurable threshold

    if (plan.aggregateRisk.score > maxRiskScore) {
      return {
        valid: false,
        error: `Aggregate risk too high: ${plan.aggregateRisk.score}/100`,
      };
    }

    // Check total price impact
    const totalImpact = plan.legs.reduce((sum, leg) => sum + leg.priceImpactBps, 0);
    const maxImpact = policy?.maxPriceImpactBps || MAX_PRICE_IMPACT_BPS;

    if (totalImpact > maxImpact * 1.5) {
      return {
        valid: false,
        error: `Combined price impact too high: ${totalImpact / 100}%`,
      };
    }

    return { valid: true };
  }

  /**
   * Create plan for direct transfer (no swap needed)
   */
  private createDirectTransferPlan(mint: string, amount: string, strategy: SplitTenderStrategy): SplitPlan {
    return {
      legs: [{
        payMint: mint,
        amountIn: amount,
        expectedUsdcOut: amount,
        priceImpactBps: 0,
        slippageBps: 0,
        routeSteps: 0,
        risk: { score: 0, priceImpactBps: 0, routeComplexity: 'simple', warnings: [] },
      }],
      totalAmountIn: { [mint]: amount },
      totalExpectedUsdcOut: amount,
      settlementAmount: amount,
      refundPolicy: 'usdc-refund',
      strategy,
      aggregateRisk: { score: 0, warnings: [] },
      estimatedDurationMs: 15000,
    };
  }

  /**
   * Create reservation and legs in database
   */
  async createReservation(
    invoiceId: string,
    payer: string,
    plan: SplitPlan
  ): Promise<{ reservation: InvoiceReservationRecord; legs: PaymentLegRecord[] }> {
    const now = Date.now();
    const reservationId = uuidv4();

    const reservation: InvoiceReservationRecord = {
      id: reservationId,
      invoiceId,
      payer,
      strategy: plan.strategy,
      planJson: JSON.stringify(plan),
      totalLegs: plan.legs.length,
      completedLegs: 0,
      usdcCollected: '0',
      status: 'active',
      expiresAt: now + RESERVATION_TTL_MS,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.saveInvoiceReservation(reservation);

    const legs: PaymentLegRecord[] = [];

    for (let i = 0; i < plan.legs.length; i++) {
      const legPlan = plan.legs[i];
      const leg: PaymentLegRecord = {
        id: uuidv4(),
        reservationId,
        invoiceId,
        legIndex: i,
        payMint: legPlan.payMint,
        amountIn: legPlan.amountIn,
        expectedUsdcOut: legPlan.expectedUsdcOut,
        routeJson: JSON.stringify({ steps: legPlan.routeSteps }),
        riskJson: JSON.stringify(legPlan.risk),
        status: 'pending',
        retryCount: 0,
        maxRetries: MAX_RETRIES_PER_LEG,
        createdAt: now,
      };

      await this.db.savePaymentLeg(leg);
      legs.push(leg);
    }

    this.log.info({
      reservationId,
      invoiceId,
      payer,
      legsCount: legs.length,
      expiresAt: reservation.expiresAt,
    }, 'Split-tender reservation created');

    return { reservation, legs };
  }

  /**
   * Get user token balances
   */
  async getUserBalances(userPublicKey: string, mints: string[]): Promise<TokenBalance[]> {
    const pubkey = new PublicKey(userPublicKey);
    const balances: TokenBalance[] = [];

    // Get SOL balance
    try {
      const solBalance = await this.connection.getBalance(pubkey);
      if (mints.includes('So11111111111111111111111111111111111111112')) {
        balances.push({
          mint: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          balance: solBalance.toString(),
          decimals: 9,
        });
      }
    } catch (error) {
      this.log.warn({ error }, 'Failed to get SOL balance');
    }

    // Get SPL token balances
    for (const mint of mints) {
      if (mint === 'So11111111111111111111111111111111111111112') continue;

      try {
        const mintPubkey = new PublicKey(mint);
        const accounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
          mint: mintPubkey,
        });

        if (accounts.value.length > 0) {
          const tokenAccount = accounts.value[0];
          const info = tokenAccount.account.data.parsed.info;
          balances.push({
            mint,
            balance: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
          });
        } else {
          balances.push({ mint, balance: '0', decimals: 6 });
        }
      } catch (error) {
        this.log.warn({ mint, error }, 'Failed to get token balance');
        balances.push({ mint, balance: '0', decimals: 6 });
      }
    }

    return balances;
  }
}

export const createSplitTenderPlanner = (
  connection: Connection,
  db: DatabaseService
): SplitTenderPlanner => {
  return new SplitTenderPlanner(connection, db);
};
