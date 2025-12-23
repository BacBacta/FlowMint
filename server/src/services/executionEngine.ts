/**
 * Execution Engine
 *
 * Core module that validates policies, executes swaps, and manages receipts.
 * Acts as the orchestrator between Jupiter service and on-chain program.
 */

import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config/index.js';
import {
  isTokenAllowed,
  calculateRiskLevel,
  RiskLevel,
  SLIPPAGE_SETTINGS,
  PRICE_IMPACT_THRESHOLDS,
  SIZE_LIMITS,
} from '../config/risk-policies.js';
import { logger } from '../utils/logger.js';
import { jupiterService, QuoteResponse, JupiterError } from './jupiterService.js';
import { DatabaseService } from '../db/database.js';

/**
 * Swap request from client
 */
export interface SwapExecutionRequest {
  /** User's public key */
  userPublicKey: string;
  /** Input token mint address */
  inputMint: string;
  /** Output token mint address */
  outputMint: string;
  /** Amount of input tokens (in smallest unit) */
  amount: string;
  /** Slippage tolerance in basis points */
  slippageBps: number;
  /** Whether to use protected mode */
  protectedMode?: boolean;
  /** Optional: exact output mode */
  exactOut?: boolean;
  /** Optional: skip policy validation (for advanced users) */
  skipPolicyValidation?: boolean;
}

/**
 * Swap execution result
 */
export interface SwapExecutionResult {
  /** Unique receipt ID */
  receiptId: string;
  /** Status of the execution */
  status: 'pending' | 'success' | 'failed';
  /** Quote information */
  quote: {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
    routeSteps: number;
  };
  /** Serialized transaction (base64) - client must sign */
  transaction?: string;
  /** Last valid block height for transaction */
  lastValidBlockHeight?: number;
  /** Error message if failed */
  error?: string;
  /** Risk assessment */
  riskLevel: RiskLevel;
  /** Warnings for the user */
  warnings: string[];
  /** Timestamp */
  timestamp: number;
}

/**
 * Policy validation result
 */
export interface PolicyValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Risk level assessed */
  riskLevel: RiskLevel;
  /** Validation errors */
  errors: string[];
  /** Warnings (non-blocking) */
  warnings: string[];
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Alternative RPC endpoints for failover
 */
const FALLBACK_RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
];

/**
 * Execution Engine
 *
 * Orchestrates swap execution with policy validation, retry logic,
 * and receipt management.
 */
export class ExecutionEngine {
  private readonly connection: Connection;
  private readonly log = logger.child({ service: 'ExecutionEngine' });
  private currentRpcIndex = 0;

  constructor(private readonly db: DatabaseService) {
    this.connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
    this.log.info('ExecutionEngine initialized');
  }

  /**
   * Execute a token swap
   *
   * This method:
   * 1. Validates the request against policies
   * 2. Gets a quote from Jupiter
   * 3. Builds the swap transaction
   * 4. Returns the transaction for client signing
   *
   * @param request - Swap execution request
   * @returns Swap execution result with transaction to sign
   */
  async executeSwap(request: SwapExecutionRequest): Promise<SwapExecutionResult> {
    const receiptId = uuidv4();
    const timestamp = Date.now();

    this.log.info(
      {
        receiptId,
        userPublicKey: request.userPublicKey,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        slippageBps: request.slippageBps,
        protectedMode: request.protectedMode,
      },
      'Starting swap execution'
    );

    try {
      // Step 1: Validate policies
      const validation = await this.validatePolicies(request);

      if (!validation.valid) {
        return this.createFailedResult(
          receiptId,
          validation.errors.join('; '),
          validation.riskLevel,
          validation.warnings,
          timestamp
        );
      }

      // Step 2: Get quote with retry
      const quote = await this.getQuoteWithRetry(request);

      // Step 3: Validate quote against policies
      const quoteValidation = this.validateQuote(quote, request);
      if (!quoteValidation.valid) {
        return this.createFailedResult(
          receiptId,
          quoteValidation.errors.join('; '),
          quoteValidation.riskLevel,
          [...validation.warnings, ...quoteValidation.warnings],
          timestamp
        );
      }

      // Step 4: Get swap transaction
      const swap = await jupiterService.getSwapTransaction({
        quoteResponse: quote,
        userPublicKey: request.userPublicKey,
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: 'auto',
      });

      // Step 5: Save receipt (pending)
      await this.saveReceipt({
        receiptId,
        userPublicKey: request.userPublicKey,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        slippageBps: request.slippageBps,
        protectedMode: request.protectedMode || false,
        priceImpactPct: quote.priceImpactPct,
        status: 'pending',
        timestamp,
      });

      // Calculate combined risk level
      const riskLevel = calculateRiskLevel({
        priceImpactPct: parseFloat(quote.priceImpactPct),
        slippageBps: request.slippageBps,
        tradeValueUsd: 0, // Would need price oracle for USD value
      });

      const allWarnings = [...validation.warnings, ...quoteValidation.warnings];

      this.log.info(
        {
          receiptId,
          outAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          riskLevel,
        },
        'Swap prepared successfully'
      );

      return {
        receiptId,
        status: 'pending',
        quote: {
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          routeSteps: quote.routePlan.length,
        },
        transaction: swap.swapTransaction,
        lastValidBlockHeight: swap.lastValidBlockHeight,
        riskLevel,
        warnings: allWarnings,
        timestamp,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ receiptId, error }, 'Swap execution failed');

      return this.createFailedResult(receiptId, message, RiskLevel.HIGH, [], timestamp);
    }
  }

  /**
   * Validate swap request against policies
   */
  async validatePolicies(request: SwapExecutionRequest): Promise<PolicyValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Skip validation if requested (for advanced users)
    if (request.skipPolicyValidation) {
      warnings.push('Policy validation skipped - proceed with caution');
      return { valid: true, riskLevel: RiskLevel.HIGH, errors, warnings };
    }

    // Validate tokens
    const inputCheck = isTokenAllowed(request.inputMint);
    if (!inputCheck.allowed) {
      errors.push(`Input token: ${inputCheck.reason}`);
    }

    const outputCheck = isTokenAllowed(request.outputMint);
    if (!outputCheck.allowed) {
      errors.push(`Output token: ${outputCheck.reason}`);
    }

    // Validate slippage
    const maxSlippage = request.protectedMode
      ? SLIPPAGE_SETTINGS.PROTECTED_MAX_BPS
      : SLIPPAGE_SETTINGS.DEFAULT_MAX_BPS;

    if (request.slippageBps > maxSlippage) {
      errors.push(
        `Slippage ${request.slippageBps} bps exceeds maximum ${maxSlippage} bps for ${request.protectedMode ? 'protected' : 'normal'} mode`
      );
    }

    if (request.slippageBps > SLIPPAGE_SETTINGS.MAJOR_TOKEN_BPS) {
      warnings.push(`High slippage tolerance: ${request.slippageBps / 100}%`);
    }

    // Validate amount
    const amount = BigInt(request.amount);
    if (amount <= 0n) {
      errors.push('Amount must be greater than 0');
    }

    // Validate user public key
    try {
      new PublicKey(request.userPublicKey);
    } catch {
      errors.push('Invalid user public key');
    }

    // Validate token addresses
    try {
      new PublicKey(request.inputMint);
      new PublicKey(request.outputMint);
    } catch {
      errors.push('Invalid token mint address');
    }

    // Same token check
    if (request.inputMint === request.outputMint) {
      errors.push('Input and output tokens must be different');
    }

    const riskLevel =
      errors.length > 0
        ? RiskLevel.CRITICAL
        : warnings.length > 0
          ? RiskLevel.MEDIUM
          : RiskLevel.LOW;

    return {
      valid: errors.length === 0,
      riskLevel,
      errors,
      warnings,
    };
  }

  /**
   * Validate quote against policies
   */
  private validateQuote(
    quote: QuoteResponse,
    request: SwapExecutionRequest
  ): PolicyValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const priceImpact = parseFloat(quote.priceImpactPct);
    const maxImpact = request.protectedMode
      ? PRICE_IMPACT_THRESHOLDS.MAX_PROTECTED_PCT
      : PRICE_IMPACT_THRESHOLDS.MAX_NORMAL_PCT;

    // Check price impact
    if (priceImpact > PRICE_IMPACT_THRESHOLDS.ABSOLUTE_MAX_PCT) {
      errors.push(
        `Price impact ${priceImpact.toFixed(2)}% exceeds absolute maximum ${PRICE_IMPACT_THRESHOLDS.ABSOLUTE_MAX_PCT}%`
      );
    } else if (priceImpact > maxImpact) {
      if (request.protectedMode) {
        errors.push(
          `Price impact ${priceImpact.toFixed(2)}% exceeds protected mode limit ${maxImpact}%`
        );
      } else {
        warnings.push(`High price impact: ${priceImpact.toFixed(2)}%`);
      }
    } else if (priceImpact > PRICE_IMPACT_THRESHOLDS.WARNING_PCT) {
      warnings.push(`Notable price impact: ${priceImpact.toFixed(2)}%`);
    }

    // Check route complexity
    if (quote.routePlan.length > 4) {
      warnings.push(`Complex route with ${quote.routePlan.length} steps may have higher fees`);
    }

    const riskLevel = calculateRiskLevel({
      priceImpactPct: priceImpact,
      slippageBps: request.slippageBps,
      tradeValueUsd: 0,
    });

    return {
      valid: errors.length === 0,
      riskLevel,
      errors,
      warnings,
    };
  }

  /**
   * Get quote with retry logic
   */
  private async getQuoteWithRetry(
    request: SwapExecutionRequest,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<QuoteResponse> {
    let lastError: Error | undefined;
    let delay = retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await jupiterService.quoteSwap({
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amount: request.amount,
          slippageBps: request.slippageBps,
          swapMode: request.exactOut ? 'ExactOut' : 'ExactIn',
        });
      } catch (error) {
        lastError = error as Error;

        // Don't retry on validation errors
        if (error instanceof JupiterError) {
          if (error.code === 'INVALID_REQUEST' || error.code === 'ROUTE_NOT_FOUND') {
            throw error;
          }
        }

        if (attempt < retryConfig.maxRetries) {
          this.log.warn(
            { attempt, delay, error: lastError.message },
            'Quote failed, retrying...'
          );

          // Try with increased slippage on retry
          if (attempt > 0 && !request.protectedMode) {
            request.slippageBps = Math.min(
              request.slippageBps * 1.5,
              SLIPPAGE_SETTINGS.ABSOLUTE_MAX_BPS
            );
          }

          await this.sleep(delay);
          delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
        }
      }
    }

    throw lastError || new Error('Failed to get quote after retries');
  }

  /**
   * Save a receipt to the database
   */
  private async saveReceipt(receipt: {
    receiptId: string;
    userPublicKey: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    slippageBps: number;
    protectedMode: boolean;
    priceImpactPct: string;
    status: 'pending' | 'success' | 'failed';
    timestamp: number;
    txSignature?: string;
    error?: string;
  }): Promise<void> {
    await this.db.saveReceipt(receipt);
  }

  /**
   * Update receipt after transaction confirmation
   */
  async updateReceiptStatus(
    receiptId: string,
    status: 'success' | 'failed',
    txSignature?: string,
    error?: string
  ): Promise<void> {
    await this.db.updateReceiptStatus(receiptId, status, txSignature, error);
  }

  /**
   * Get receipt by ID
   */
  async getReceipt(receiptId: string) {
    return this.db.getReceipt(receiptId);
  }

  /**
   * Get receipts for a user
   */
  async getUserReceipts(userPublicKey: string, limit = 50) {
    return this.db.getUserReceipts(userPublicKey, limit);
  }

  /**
   * Create a failed result object
   */
  private createFailedResult(
    receiptId: string,
    error: string,
    riskLevel: RiskLevel,
    warnings: string[],
    timestamp: number
  ): SwapExecutionResult {
    return {
      receiptId,
      status: 'failed',
      quote: {
        inputMint: '',
        outputMint: '',
        inAmount: '0',
        outAmount: '0',
        priceImpactPct: '0',
        routeSteps: 0,
      },
      error,
      riskLevel,
      warnings,
      timestamp,
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
