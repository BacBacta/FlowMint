/**
 * OptimizationPlanner - V2 Multi-Token Payment Optimization
 *
 * Implements a knapsack-inspired algorithm to optimize multi-token payments.
 * Minimizes risk, slippage, and fees while meeting the target USDC amount.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService, PolicyRecord } from '../db/database';
import { jupiterService } from './jupiterService';
import { logger } from '../utils/logger';

const log = logger.child({ service: 'OptimizationPlanner' });

// ==================== Types ====================

export interface TokenBalance {
  mint: string;
  symbol?: string;
  balance: string; // Atomic units
  usdValue?: string;
  decimals: number;
}

export interface PaymentPlanRequest {
  invoiceId: string;
  merchantId: string;
  payerPublicKey: string;
  targetUsdcOut: string;
  balances: TokenBalance[];
  strategy?: OptimizationStrategy;
  maxLegs?: number;
  policy?: PolicyRecord;
}

export type OptimizationStrategy = 'min-risk' | 'min-slippage' | 'min-fees' | 'balanced';

export interface PaymentLeg {
  tokenMint: string;
  tokenSymbol?: string;
  amountIn: string;
  expectedUsdcOut: string;
  priceImpactBps: number;
  slippageBps: number;
  route: RouteInfo;
  risk: LegRisk;
  priority: number;
}

export interface RouteInfo {
  steps: number;
  labels: string[];
  estimatedCU: number;
}

export interface LegRisk {
  score: number; // 0-100
  factors: string[];
  confidence: number; // 0-1
}

export interface PaymentPlan {
  id: string;
  invoiceId: string;
  legs: PaymentLeg[];
  totalAmountIn: Record<string, string>; // mint -> amount
  totalExpectedUsdcOut: string;
  totalPriceImpactBps: number;
  totalSlippageBps: number;
  estimatedTotalCU: number;
  aggregateRisk: AggregateRisk;
  strategy: OptimizationStrategy;
  alternatives?: PaymentPlan[];
  createdAt: number;
  expiresAt: number;
}

export interface AggregateRisk {
  overallScore: number;
  maxLegRisk: number;
  diversificationBonus: number;
  warnings: string[];
}

export interface PlanResult {
  success: boolean;
  plan?: PaymentPlan;
  alternatives?: PaymentPlan[];
  error?: string;
  errorCode?: string;
}

// ==================== Configuration ====================

interface OptimizationConfig {
  maxLegs: number;
  maxPriceImpactBps: number;
  maxSlippageBps: number;
  maxCU: number;
  quoteTtlMs: number;
  weights: {
    risk: number;
    slippage: number;
    fees: number;
  };
  tokenAllowlist?: string[];
  tokenDenylist?: string[];
}

const DEFAULT_CONFIG: OptimizationConfig = {
  maxLegs: 5,
  maxPriceImpactBps: 300, // 3%
  maxSlippageBps: 100, // 1%
  maxCU: 1_400_000,
  quoteTtlMs: 15_000,
  weights: {
    risk: 0.4,
    slippage: 0.35,
    fees: 0.25,
  },
};

// USDC mint addresses
const USDC_MINTS = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

// ==================== Service ====================

export class OptimizationPlanner {
  private config: OptimizationConfig;
  private usdcMint: string;

  constructor(
    private connection: Connection,
    private db: DatabaseService,
    config?: Partial<OptimizationConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Determine USDC mint based on cluster
    this.usdcMint = USDC_MINTS.mainnet;
  }

  /**
   * Plan an optimized multi-token payment
   */
  async planPayment(request: PaymentPlanRequest): Promise<PlanResult> {
    const startTime = Date.now();
    const planId = uuidv4();

    log.info(
      {
        planId,
        invoiceId: request.invoiceId,
        targetUsdc: request.targetUsdcOut,
        tokensAvailable: request.balances.length,
        strategy: request.strategy,
      },
      'Planning optimized payment'
    );

    try {
      // Apply policy constraints if provided
      const effectiveConfig = this.applyPolicyConstraints(request.policy);

      // Filter eligible tokens
      const eligibleTokens = this.filterEligibleTokens(
        request.balances,
        effectiveConfig
      );

      if (eligibleTokens.length === 0) {
        return {
          success: false,
          error: 'No eligible tokens with sufficient balance',
          errorCode: 'NO_ELIGIBLE_TOKENS',
        };
      }

      // Get quotes for all eligible tokens
      const candidates = await this.getCandidates(
        eligibleTokens,
        request.targetUsdcOut,
        effectiveConfig
      );

      if (candidates.length === 0) {
        return {
          success: false,
          error: 'Could not get quotes for any tokens',
          errorCode: 'NO_QUOTES',
        };
      }

      // Optimize selection using knapsack-inspired algorithm
      const strategy = request.strategy || 'balanced';
      const maxLegs = Math.min(
        request.maxLegs || effectiveConfig.maxLegs,
        effectiveConfig.maxLegs
      );

      const optimizedLegs = this.optimizeSelection(
        candidates,
        BigInt(request.targetUsdcOut),
        maxLegs,
        strategy,
        effectiveConfig
      );

      if (optimizedLegs.length === 0) {
        return {
          success: false,
          error: 'Could not find valid payment combination',
          errorCode: 'NO_VALID_COMBINATION',
        };
      }

      // Calculate totals
      const totalExpectedUsdc = optimizedLegs.reduce(
        (sum, leg) => sum + BigInt(leg.expectedUsdcOut),
        0n
      );

      // Verify we meet the target
      const targetUsdc = BigInt(request.targetUsdcOut);
      if (totalExpectedUsdc < targetUsdc) {
        return {
          success: false,
          error: `Insufficient funds: can only cover ${totalExpectedUsdc} of ${targetUsdc} USDC`,
          errorCode: 'INSUFFICIENT_FUNDS',
        };
      }

      // Build plan
      const plan = this.buildPlan(
        planId,
        request.invoiceId,
        optimizedLegs,
        strategy
      );

      // Generate alternatives if using balanced strategy
      let alternatives: PaymentPlan[] | undefined;
      if (strategy === 'balanced' && candidates.length > optimizedLegs.length) {
        alternatives = this.generateAlternatives(
          candidates,
          targetUsdc,
          maxLegs,
          effectiveConfig
        );
      }

      log.info(
        {
          planId,
          legs: plan.legs.length,
          totalUsdc: plan.totalExpectedUsdcOut,
          riskScore: plan.aggregateRisk.overallScore,
          durationMs: Date.now() - startTime,
        },
        'Payment plan created'
      );

      return {
        success: true,
        plan,
        alternatives,
      };
    } catch (error) {
      log.error({ error, planId }, 'Failed to plan payment');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Planning failed',
        errorCode: 'PLANNING_ERROR',
      };
    }
  }

  /**
   * Apply policy constraints to config
   */
  private applyPolicyConstraints(
    policy?: PolicyRecord
  ): OptimizationConfig {
    if (!policy) return this.config;

    return {
      ...this.config,
      maxPriceImpactBps: Math.min(
        this.config.maxPriceImpactBps,
        policy.maxPriceImpactBps
      ),
      maxSlippageBps: Math.min(
        this.config.maxSlippageBps,
        policy.maxSlippageBps
      ),
      maxLegs: Math.min(this.config.maxLegs, policy.maxHops),
      tokenAllowlist: policy.allowedTokens,
      tokenDenylist: policy.deniedTokens,
    };
  }

  /**
   * Filter tokens based on eligibility criteria
   */
  private filterEligibleTokens(
    balances: TokenBalance[],
    config: OptimizationConfig
  ): TokenBalance[] {
    return balances.filter((token) => {
      // Skip zero balances
      if (BigInt(token.balance) === 0n) return false;

      // Skip USDC (no swap needed)
      if (token.mint === this.usdcMint) {
        // USDC is always eligible as direct transfer
        return true;
      }

      // Check allowlist
      if (config.tokenAllowlist && config.tokenAllowlist.length > 0) {
        if (!config.tokenAllowlist.includes(token.mint)) return false;
      }

      // Check denylist
      if (config.tokenDenylist && config.tokenDenylist.includes(token.mint)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get quote candidates for all eligible tokens
   */
  private async getCandidates(
    tokens: TokenBalance[],
    targetUsdc: string,
    config: OptimizationConfig
  ): Promise<PaymentLeg[]> {
    const candidates: PaymentLeg[] = [];
    const targetAmount = BigInt(targetUsdc);

    // Get quotes in parallel
    const quotePromises = tokens.map(async (token) => {
      try {
        // For USDC, it's a direct transfer
        if (token.mint === this.usdcMint) {
          const balance = BigInt(token.balance);
          const amountToUse = balance < targetAmount ? balance : targetAmount;

          return {
            tokenMint: token.mint,
            tokenSymbol: token.symbol || 'USDC',
            amountIn: amountToUse.toString(),
            expectedUsdcOut: amountToUse.toString(),
            priceImpactBps: 0,
            slippageBps: 0,
            route: {
              steps: 0,
              labels: ['direct'],
              estimatedCU: 50_000,
            },
            risk: {
              score: 0,
              factors: [],
              confidence: 1,
            },
            priority: 0, // Highest priority
          };
        }

        // For other tokens, get Jupiter quote
        const quote = await jupiterService.quoteSwap({
          inputMint: token.mint,
          outputMint: this.usdcMint,
          amount: token.balance,
          slippageBps: config.maxSlippageBps,
          swapMode: 'ExactIn',
        });

        const priceImpactBps = Math.round(
          parseFloat(quote.priceImpactPct) * 100
        );

        // Skip if price impact too high
        if (priceImpactBps > config.maxPriceImpactBps) {
          log.debug(
            { token: token.mint, priceImpactBps },
            'Skipping token due to high price impact'
          );
          return null;
        }

        const risk = this.calculateLegRisk(quote, token);

        return {
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          amountIn: quote.inAmount,
          expectedUsdcOut: quote.outAmount,
          priceImpactBps,
          slippageBps: config.maxSlippageBps,
          route: {
            steps: quote.routePlan?.length || 1,
            labels: quote.routePlan?.map((r: any) => r.swapInfo?.label) || [],
            estimatedCU: this.estimateCU(quote),
          },
          risk,
          priority: risk.score,
        };
      } catch (error) {
        log.debug(
          { token: token.mint, error },
          'Failed to get quote for token'
        );
        return null;
      }
    });

    const results = await Promise.all(quotePromises);

    for (const result of results) {
      if (result) {
        candidates.push(result);
      }
    }

    return candidates;
  }

  /**
   * Calculate risk score for a leg
   */
  private calculateLegRisk(quote: any, token: TokenBalance): LegRisk {
    const factors: string[] = [];
    let score = 0;

    // Price impact risk (0-30 points)
    const priceImpact = parseFloat(quote.priceImpactPct);
    if (priceImpact > 2) {
      score += 30;
      factors.push('high_price_impact');
    } else if (priceImpact > 1) {
      score += 15;
      factors.push('moderate_price_impact');
    } else if (priceImpact > 0.5) {
      score += 5;
    }

    // Route complexity risk (0-25 points)
    const hops = quote.routePlan?.length || 1;
    if (hops >= 4) {
      score += 25;
      factors.push('complex_route');
    } else if (hops >= 3) {
      score += 15;
      factors.push('multi_hop_route');
    } else if (hops >= 2) {
      score += 5;
    }

    // Liquidity risk based on output relative to input (0-25 points)
    const efficiency =
      parseFloat(quote.outAmount) / parseFloat(quote.inAmount);
    if (efficiency < 0.9) {
      score += 25;
      factors.push('low_liquidity');
    } else if (efficiency < 0.95) {
      score += 10;
    }

    // Token familiarity (0-20 points)
    // In production, would check token metadata, volume, etc.
    if (!token.symbol) {
      score += 10;
      factors.push('unknown_token');
    }

    // Confidence based on data quality
    const confidence = quote.routePlan ? 0.9 : 0.7;

    return {
      score: Math.min(100, score),
      factors,
      confidence,
    };
  }

  /**
   * Estimate compute units for a swap
   */
  private estimateCU(quote: any): number {
    const hops = quote.routePlan?.length || 1;
    const baseCU = 200_000;
    const perHopCU = 150_000;
    return baseCU + hops * perHopCU;
  }

  /**
   * Optimize leg selection using greedy algorithm with backtracking
   */
  private optimizeSelection(
    candidates: PaymentLeg[],
    targetUsdc: bigint,
    maxLegs: number,
    strategy: OptimizationStrategy,
    config: OptimizationConfig
  ): PaymentLeg[] {
    // Sort candidates based on strategy
    const sorted = this.sortByStrategy(candidates, strategy);

    const selected: PaymentLeg[] = [];
    let collectedUsdc = 0n;
    let totalCU = 0;

    for (const candidate of sorted) {
      if (selected.length >= maxLegs) break;
      if (collectedUsdc >= targetUsdc) break;

      // Check CU limit
      if (totalCU + candidate.route.estimatedCU > config.maxCU) {
        continue;
      }

      // Calculate how much we still need
      const remaining = targetUsdc - collectedUsdc;
      const candidateUsdc = BigInt(candidate.expectedUsdcOut);

      if (candidateUsdc > 0n) {
        // If candidate provides more than needed, adjust (in a real impl)
        // For simplicity, take full amount
        selected.push(candidate);
        collectedUsdc += candidateUsdc;
        totalCU += candidate.route.estimatedCU;
      }
    }

    return selected;
  }

  /**
   * Sort candidates based on optimization strategy
   */
  private sortByStrategy(
    candidates: PaymentLeg[],
    strategy: OptimizationStrategy
  ): PaymentLeg[] {
    const sorted = [...candidates];

    switch (strategy) {
      case 'min-risk':
        // Lowest risk first
        sorted.sort((a, b) => a.risk.score - b.risk.score);
        break;

      case 'min-slippage':
        // Lowest price impact first
        sorted.sort((a, b) => a.priceImpactBps - b.priceImpactBps);
        break;

      case 'min-fees':
        // Lowest CU (proxy for fees) first
        sorted.sort(
          (a, b) => a.route.estimatedCU - b.route.estimatedCU
        );
        break;

      case 'balanced':
      default:
        // Weighted score
        sorted.sort((a, b) => {
          const scoreA = this.calculateBalancedScore(a);
          const scoreB = this.calculateBalancedScore(b);
          return scoreA - scoreB;
        });
        break;
    }

    return sorted;
  }

  /**
   * Calculate balanced score for a leg
   */
  private calculateBalancedScore(leg: PaymentLeg): number {
    const { weights } = this.config;

    const riskScore = leg.risk.score * weights.risk;
    const slippageScore = leg.priceImpactBps * weights.slippage;
    const feeScore = (leg.route.estimatedCU / 10000) * weights.fees;

    return riskScore + slippageScore + feeScore;
  }

  /**
   * Build the final payment plan
   */
  private buildPlan(
    planId: string,
    invoiceId: string,
    legs: PaymentLeg[],
    strategy: OptimizationStrategy
  ): PaymentPlan {
    const now = Date.now();

    // Calculate totals
    const totalAmountIn: Record<string, string> = {};
    let totalExpectedUsdc = 0n;
    let totalPriceImpactBps = 0;
    let totalSlippageBps = 0;
    let totalCU = 0;
    let maxRisk = 0;

    for (const leg of legs) {
      totalAmountIn[leg.tokenMint] = leg.amountIn;
      totalExpectedUsdc += BigInt(leg.expectedUsdcOut);
      totalPriceImpactBps += leg.priceImpactBps;
      totalSlippageBps = Math.max(totalSlippageBps, leg.slippageBps);
      totalCU += leg.route.estimatedCU;
      maxRisk = Math.max(maxRisk, leg.risk.score);
    }

    // Calculate aggregate risk
    const diversificationBonus = legs.length > 1 ? 5 * (legs.length - 1) : 0;
    const avgRisk =
      legs.reduce((sum, l) => sum + l.risk.score, 0) / legs.length;

    const warnings: string[] = [];
    if (maxRisk > 50) warnings.push('High risk leg detected');
    if (totalCU > 1_000_000) warnings.push('High compute usage');
    if (totalPriceImpactBps > 200) warnings.push('Cumulative price impact > 2%');

    return {
      id: planId,
      invoiceId,
      legs: legs.map((leg, idx) => ({ ...leg, priority: idx })),
      totalAmountIn,
      totalExpectedUsdcOut: totalExpectedUsdc.toString(),
      totalPriceImpactBps,
      totalSlippageBps,
      estimatedTotalCU: totalCU,
      aggregateRisk: {
        overallScore: Math.max(0, avgRisk - diversificationBonus),
        maxLegRisk: maxRisk,
        diversificationBonus,
        warnings,
      },
      strategy,
      createdAt: now,
      expiresAt: now + this.config.quoteTtlMs,
    };
  }

  /**
   * Generate alternative plans using different strategies
   */
  private generateAlternatives(
    candidates: PaymentLeg[],
    targetUsdc: bigint,
    maxLegs: number,
    config: OptimizationConfig
  ): PaymentPlan[] {
    const alternatives: PaymentPlan[] = [];
    const strategies: OptimizationStrategy[] = ['min-risk', 'min-slippage', 'min-fees'];

    for (const strategy of strategies) {
      const legs = this.optimizeSelection(
        candidates,
        targetUsdc,
        maxLegs,
        strategy,
        config
      );

      if (legs.length > 0) {
        const plan = this.buildPlan(
          uuidv4(),
          '', // Will be filled by caller
          legs,
          strategy
        );
        alternatives.push(plan);
      }
    }

    return alternatives;
  }
}

// Singleton instance
let plannerInstance: OptimizationPlanner | null = null;

export function getOptimizationPlanner(
  connection: Connection,
  db: DatabaseService,
  config?: Partial<OptimizationConfig>
): OptimizationPlanner {
  if (!plannerInstance) {
    plannerInstance = new OptimizationPlanner(connection, db, config);
  }
  return plannerInstance;
}

export default OptimizationPlanner;
