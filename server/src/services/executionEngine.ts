/**
 * Execution Engine
 *
 * Core module that validates policies, executes swaps, and manages receipts.
 * Acts as the orchestrator between Jupiter service and on-chain program.
 *
 * Integrates:
 * - RetryPolicy for intelligent error handling and retry decisions
 * - RiskScoring for comprehensive risk assessment
 * - FeeEstimator for dynamic priority fee calculation
 * - TxConfirm for robust transaction confirmation
 * - ReceiptService for detailed execution tracking
 */

import { PublicKey } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config/index.js';
import { DatabaseService } from '../db/database.js';
import {
  isTokenAllowed,
  calculateRiskLevel,
  RiskLevel,
  SLIPPAGE_SETTINGS,
  PRICE_IMPACT_THRESHOLDS,
} from '../config/risk-policies.js';
import { logger } from '../utils/logger.js';

import { flowMintOnChainService } from './flowMintOnChain.js';
import { jupiterService, QuoteResponse, JupiterError } from './jupiterService.js';
import { rpcManager } from './rpcManager.js';

// Import new production services
import {
  classifyError,
  shouldRetry,
  createRetryState,
  buildRetryMetrics,
  EXECUTION_PROFILES,
  ErrorCategory,
  RetryState,
  RetryStrategy,
  RetryMetrics,
  sleep as retrySleep,
} from './retryPolicy.js';
import {
  RiskScoringService,
  RiskSignal,
  RiskAssessment,
} from './riskScoring.js';
import {
  feeEstimator,
  ExecutionProfile as FeeProfile,
  FeeEstimate,
} from './feeEstimator.js';
import {
  txConfirmService,
  ConfirmationResult,
} from './txConfirm.js';
import {
  ReceiptService,
  EnhancedReceipt,
} from './receiptService.js';
import {
  getMetricsService,
  MetricsService,
} from './metricsService.js';

/**
 * Execution mode for speed/reliability tradeoff
 */
export type ExecutionMode = 'fast' | 'standard' | 'protected';


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
  /** Execution mode: fast (higher fees), standard, protected (stricter limits) */
  executionMode?: ExecutionMode;
  /** Optional: exact output mode */
  exactOut?: boolean;
  /** Optional: skip policy validation (for advanced users) */
  skipPolicyValidation?: boolean;
  /** Optional: use FlowMint on-chain program for validation */
  useFlowMintProgram?: boolean;
  /** Optional: user's input token account */
  userInputAccount?: string;
  /** Optional: user's output token account */
  userOutputAccount?: string;
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
  /** FlowMint receipt PDA (if using on-chain program) */
  receiptPda?: string;
  /** Route data for on-chain validation */
  routeData?: string;
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
 * Priority fee settings by execution mode
 */
const PRIORITY_FEE_SETTINGS = {
  fast: {
    prioritizationFeeLamports: 100000, // 0.0001 SOL
    computeUnitPrice: 50000, // micro-lamports
  },
  standard: {
    prioritizationFeeLamports: 'auto' as const,
    computeUnitPrice: undefined,
  },
  protected: {
    prioritizationFeeLamports: 'auto' as const,
    computeUnitPrice: undefined,
  },
};

/**
 * Map execution mode to fee profile
 */
const EXECUTION_MODE_TO_FEE_PROFILE: Record<ExecutionMode, FeeProfile> = {
  fast: 'FAST',
  standard: 'AUTO',
  protected: 'CHEAP',
};

/**
 * Extended swap execution result with production metrics
 */
export interface SwapExecutionResultExtended extends SwapExecutionResult {
  /** Risk assessment details */
  riskAssessment?: RiskAssessment;
  /** Fee estimate used */
  feeEstimate?: FeeEstimate;
  /** Retry metrics if applicable */
  retryMetrics?: RetryMetrics;
  /** Enhanced receipt ID */
  enhancedReceiptId?: string;
}

/**
 * Execution Engine
 *
 * Orchestrates swap execution with policy validation, retry logic,
 * and receipt management.
 */
export class ExecutionEngine {
  private readonly log = logger.child({ service: 'ExecutionEngine' });
  private executionStartTime: number = 0;
  private retryCount: number = 0;

  // Production services
  private readonly riskScoring: RiskScoringService;
  private readonly receiptService: ReceiptService;
  private readonly metrics: MetricsService;

  constructor(private readonly db: DatabaseService) {
    // Start RPC manager health monitoring
    rpcManager.start();

    // Initialize production services
    this.riskScoring = new RiskScoringService();
    this.receiptService = new ReceiptService(db);
    this.metrics = getMetricsService();

    this.log.info('ExecutionEngine initialized with production services');
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
    this.executionStartTime = timestamp;
    this.retryCount = 0;

    // Determine execution mode and profile
    const executionMode = request.executionMode || (request.protectedMode ? 'protected' : 'standard');
    const feeProfile = EXECUTION_MODE_TO_FEE_PROFILE[executionMode];
    const retryStrategy = EXECUTION_PROFILES[feeProfile === 'FAST' ? 'FAST' : 'AUTO'];

    // Start metrics timer
    const metricsTimer = this.metrics.startTimer('swap', feeProfile);

    this.log.info(
      {
        receiptId,
        userPublicKey: request.userPublicKey,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        slippageBps: request.slippageBps,
        executionMode,
        feeProfile,
      },
      'Starting swap execution with production services'
    );

    // Initialize retry state for intelligent retry handling
    const retryState = createRetryState();

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

      // Step 2: Get quote with intelligent retry
      const quote = await this.getQuoteWithIntelligentRetry(request, retryStrategy, retryState);

      // Log quote obtained
      await this.receiptService.logEvent(receiptId, 'quote', {
        slippageBps: request.slippageBps,
        metadata: {
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          routeSteps: quote.routePlan.length,
        },
      });

      // Step 3: Comprehensive risk assessment using RiskScoringService
      const riskAssessment = await this.riskScoring.scoreSwap(
        {
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amountIn: request.amount,
          slippageBps: request.slippageBps,
          protectedMode: request.protectedMode || false,
          quoteTimestamp: timestamp,
        },
        quote
      );

      // Block execution if risk is RED in protected mode
      if (riskAssessment.blockedInProtectedMode) {
        const reasons = riskAssessment.reasons.map(r => r.message).join('; ');

        // Record risk blocked metric
        this.metrics.recordRiskBlocked('swap', 'RED', 'protected_mode');
        metricsTimer.end('failed', 'RISK_BLOCKED');

        await this.receiptService.logEvent(receiptId, 'failure', {
          errorCode: 'RISK_BLOCKED',
          errorMessage: `Blocked by risk policy: ${reasons}`,
        });

        return this.createFailedResult(
          receiptId,
          `Blocked by risk policy: ${reasons}`,
          RiskLevel.CRITICAL,
          [],
          timestamp
        );
      }

      // Step 4: Get dynamic fee estimate
      const feeEstimate = await feeEstimator.estimateSwapFees(feeProfile);

      this.log.debug(
        {
          receiptId,
          priorityFee: feeEstimate.priorityFee,
          congestion: feeEstimate.congestionLevel,
          riskLevel: riskAssessment.level,
        },
        'Fee and risk assessment complete'
      );

      // Step 5: Get swap transaction with dynamic priority fees
      const swap = await jupiterService.getSwapTransaction({
        quoteResponse: quote,
        userPublicKey: request.userPublicKey,
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: feeEstimate.priorityFee,
        computeUnitPriceMicroLamports: feeEstimate.priorityFee,
      });

      // Log transaction build
      await this.receiptService.logEvent(receiptId, 'tx_build', {
        priorityFee: feeEstimate.priorityFee,
        metadata: { lastValidBlockHeight: swap.lastValidBlockHeight },
      });

      let finalTransaction = swap.swapTransaction;
      let receiptPda: string | undefined;
      let routeData: string | undefined;

      // Step 5b: Inject FlowMint instruction if using on-chain program
      if (request.useFlowMintProgram && request.userInputAccount && request.userOutputAccount) {
        const userPubkey = new PublicKey(request.userPublicKey);
        const routeBuffer = flowMintOnChainService.serializeRoute(quote);
        routeData = routeBuffer.toString('base64');

        // Get receipt PDA for reference
        const txTimestamp = Math.floor(timestamp / 1000);
        const [receiptPDA] = flowMintOnChainService.getReceiptPDA(userPubkey, txTimestamp);
        receiptPda = receiptPDA.toString();

        // Build FlowMint execute_swap instruction
        const flowMintInstruction = flowMintOnChainService.buildExecuteSwapInstruction({
          user: userPubkey,
          userInputAccount: new PublicKey(request.userInputAccount),
          userOutputAccount: new PublicKey(request.userOutputAccount),
          inputMint: new PublicKey(request.inputMint),
          outputMint: new PublicKey(request.outputMint),
          jupiterProgram: new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
          amountIn: BigInt(request.amount),
          minimumAmountOut: BigInt(quote.outAmount),
          slippageBps: request.slippageBps,
          protectedMode: request.protectedMode || false,
          routeData: routeBuffer,
          jupiterAccounts: [], // Will be populated from Jupiter transaction
        });

        // Deserialize Jupiter transaction and inject FlowMint instruction
        const jupiterTx = jupiterService.deserializeTransaction(swap.swapTransaction);
        const wrappedTx = await flowMintOnChainService.injectFlowMintInstruction(
          jupiterTx,
          flowMintInstruction,
          userPubkey
        );

        // Serialize the wrapped transaction
        finalTransaction = Buffer.from(wrappedTx.serialize()).toString('base64');

        this.log.info(
          { receiptPda, routeDataLen: routeBuffer.length },
          'FlowMint instruction injected'
        );

        // Log FlowMint injection
        await this.receiptService.logEvent(receiptId, 'flowmint_inject', {
          metadata: { receiptPda, routeDataLen: routeBuffer.length },
        });
      }

      // Step 6: Create enhanced receipt with production service
      const enhancedReceipt = await this.receiptService.createReceipt(
        {
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amountIn: request.amount,
          slippageBps: request.slippageBps,
          mode: request.protectedMode ? 'protected' : 'standard',
          profile: feeProfile,
          userPublicKey: request.userPublicKey,
        },
        {
          outAmount: quote.outAmount,
          minOutAmount: quote.outAmount, // Could be calculated with slippage
          priceImpactPct: quote.priceImpactPct,
          routeSteps: quote.routePlan.length,
          quoteTimestamp: timestamp,
        },
        riskAssessment
      );

      // Also save to legacy receipt table for compatibility
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

      // Convert risk signal to risk level
      const riskLevel = this.convertRiskSignalToLevel(riskAssessment.level);

      // Build warnings from risk assessment reasons
      const allWarnings = riskAssessment.reasons
        .filter(r => r.severity === RiskSignal.AMBER)
        .map(r => r.message);

      // Build retry metrics
      const retryMetrics = buildRetryMetrics(retryState, true);

      // Record success metrics
      metricsTimer.end('success');

      this.log.info(
        {
          receiptId,
          enhancedReceiptId: enhancedReceipt.id,
          outAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          riskLevel: riskAssessment.level,
          retryAttempts: retryMetrics.totalAttempts,
          feeProfile,
          priorityFee: feeEstimate.priorityFee,
        },
        'Swap prepared successfully with production services'
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
        transaction: finalTransaction,
        lastValidBlockHeight: swap.lastValidBlockHeight,
        riskLevel,
        warnings: allWarnings,
        timestamp,
        receiptPda,
        routeData,
      } as SwapExecutionResultExtended;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Classify the error for metrics
      const classifiedError = classifyError(error instanceof Error ? error : new Error(message));
      const retryMetrics = buildRetryMetrics(retryState, false);

      // Record failure metrics
      metricsTimer.end('failed', classifiedError.code);

      // Log failure event
      await this.receiptService.logEvent(receiptId, 'failure', {
        errorCode: classifiedError.code,
        errorMessage: message,
        metadata: { attempts: retryMetrics.totalAttempts },
      });

      this.log.error(
        {
          receiptId,
          errorCategory: classifiedError.category,
          errorCode: classifiedError.code,
          retryAttempts: retryMetrics.totalAttempts,
        },
        'Swap execution failed'
      );

      return this.createFailedResult(receiptId, message, RiskLevel.HIGH, [], timestamp);
    }
  }

  /**
   * Convert RiskSignal to RiskLevel
   */
  private convertRiskSignalToLevel(signal: RiskSignal): RiskLevel {
    switch (signal) {
      case RiskSignal.GREEN:
        return RiskLevel.LOW;
      case RiskSignal.AMBER:
        return RiskLevel.MEDIUM;
      case RiskSignal.RED:
        return RiskLevel.HIGH;
      default:
        return RiskLevel.MEDIUM;
    }
  }

  /**
   * Get quote with intelligent retry using RetryPolicy
   */
  private async getQuoteWithIntelligentRetry(
    request: SwapExecutionRequest,
    strategy: RetryStrategy,
    state: RetryState
  ): Promise<QuoteResponse> {
    while (true) {
      try {
        state.attempts++;
        state.lastAttemptTime = Date.now();

        const quote = await jupiterService.quoteSwap({
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amount: request.amount,
          slippageBps: request.slippageBps,
          swapMode: request.exactOut ? 'ExactOut' : 'ExactIn',
        });

        return quote;
      } catch (error) {
        const classifiedError = classifyError(error instanceof Error ? error : new Error(String(error)));
        state.errors.push(classifiedError);

        const retryDecision = shouldRetry(classifiedError, state, strategy);

        if (!retryDecision.shouldRetry) {
          this.log.error(
            {
              errorCode: classifiedError.code,
              reason: retryDecision.reason,
              attempts: state.attempts,
            },
            'Quote failed, not retrying'
          );
          throw classifiedError.originalError;
        }

        // If requote needed, increment counter
        if (classifiedError.requiresRequote) {
          state.requotes++;
          this.metrics.recordRequote('swap');

          // Log requote event
          await this.receiptService.logEvent('', 'requote', {
            slippageBps: request.slippageBps,
            errorCode: classifiedError.code,
            errorMessage: classifiedError.message,
          });

          // Increase slippage for requote if not in protected mode
          if (!request.protectedMode) {
            request.slippageBps = Math.min(
              Math.round(request.slippageBps * 1.5),
              SLIPPAGE_SETTINGS.ABSOLUTE_MAX_BPS
            );
          }
        }

        // Record retry metric
        this.metrics.recordRetry('swap', classifiedError.code);

        // Log retry event
        await this.receiptService.logEvent('', 'retry', {
          errorCode: classifiedError.code,
          errorMessage: classifiedError.message,
          metadata: { attempt: state.attempts, delayMs: retryDecision.delayMs },
        });

        this.log.warn(
          {
            errorCode: classifiedError.code,
            delayMs: retryDecision.delayMs,
            attempt: state.attempts,
            slippageBps: request.slippageBps,
          },
          'Quote failed, retrying'
        );

        this.retryCount++;
        await retrySleep(retryDecision.delayMs);
      }
    }
  }

  /**
   * Confirm transaction with robust handling and receipt update
   */
  async confirmTransactionWithReceipt(
    receiptId: string,
    signature: string,
    userOutputAccount: string,
    blockhashInfo?: { blockhash: string; lastValidBlockHeight: number }
  ): Promise<{
    confirmed: boolean;
    result?: ConfirmationResult;
    comparison?: any;
  }> {
    try {
      // Use TxConfirmService for robust confirmation
      const result = await txConfirmService.confirmTransaction(signature, {
        commitment: 'confirmed',
        timeoutMs: 60000,
        blockhashInfo: blockhashInfo as any,
      });

      if (result.confirmed) {
        // Log tx_confirm event
        await this.receiptService.logEvent(receiptId, 'tx_confirm', {
          signature,
          status: 'confirmed',
          metadata: { slot: result.slot },
        });

        // Transaction confirmed, update receipt with actual output
        const { comparison } = await this.confirmAndCompare(
          receiptId,
          signature,
          userOutputAccount
        );

        // Log success
        await this.receiptService.logEvent(receiptId, 'success', {
          signature,
          metadata: comparison,
        });

        return { confirmed: true, result, comparison };
      } else {
        // Log failure
        await this.receiptService.logEvent(receiptId, 'failure', {
          signature,
          status: 'failed',
          errorMessage: result.error || 'Transaction not confirmed',
        });

        // Transaction failed
        await this.updateReceiptStatus(
          receiptId,
          'failed',
          signature,
          result.error || 'Transaction not confirmed'
        );

        return { confirmed: false, result };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateReceiptStatus(receiptId, 'failed', signature, message);
      return { confirmed: false };
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
   * Update receipt after transaction confirmation with comparison metrics
   */
  async updateReceiptStatus(
    receiptId: string,
    status: 'success' | 'failed',
    txSignature?: string,
    error?: string,
    actualOutput?: string
  ): Promise<void> {
    await this.db.updateReceiptStatus(receiptId, status, txSignature, error);

    // If we have actual output, calculate and store comparison
    if (status === 'success' && actualOutput) {
      const receipt = await this.db.getReceipt(receiptId);
      if (receipt) {
        const estimatedOutput = BigInt(receipt.outAmount);
        const actual = BigInt(actualOutput);
        const difference = actual - estimatedOutput;
        const differencePercent = estimatedOutput > 0n
          ? Number(difference * 10000n / estimatedOutput) / 100
          : 0;

        // Calculate actual slippage
        const actualSlippage = estimatedOutput > 0n
          ? Number((estimatedOutput - actual) * 10000n / estimatedOutput) / 100
          : 0;

        const executionTimeMs = Date.now() - receipt.timestamp;

        await this.db.saveReceiptComparison({
          receiptId,
          estimatedOutput: receipt.outAmount,
          actualOutput,
          difference: difference.toString(),
          differencePercent,
          slippageUsed: receipt.slippageBps,
          actualSlippage,
          executionTimeMs,
          retryCount: this.retryCount,
        });

        // Save execution metric
        await this.db.saveExecutionMetric({
          receiptId,
          rpcEndpoint: config.solana.rpcUrl,
          success: true,
          latencyMs: executionTimeMs,
          retryCount: this.retryCount,
        });

        this.log.info(
          {
            receiptId,
            estimated: receipt.outAmount,
            actual: actualOutput,
            differencePercent: differencePercent.toFixed(2) + '%',
          },
          'Receipt comparison saved'
        );
      }
    } else if (status === 'failed') {
      // Save failed execution metric
      await this.db.saveExecutionMetric({
        receiptId,
        rpcEndpoint: config.solana.rpcUrl,
        success: false,
        latencyMs: Date.now() - this.executionStartTime,
        retryCount: this.retryCount,
        errorType: error,
      });
    }
  }

  /**
   * Confirm transaction and fetch actual output
   */
  async confirmAndCompare(
    receiptId: string,
    txSignature: string,
    userOutputAccount: string
  ): Promise<{ success: boolean; actualOutput?: string; comparison?: any }> {
    try {
      const connection = rpcManager.getConnection();

      // Confirm transaction
      const confirmation = await connection.confirmTransaction(txSignature, 'confirmed');

      if (confirmation.value.err) {
        await this.updateReceiptStatus(receiptId, 'failed', txSignature, 'Transaction failed on-chain');
        return { success: false };
      }

      // Fetch actual output balance
      const accountInfo = await connection.getTokenAccountBalance(new PublicKey(userOutputAccount));
      const actualOutput = accountInfo.value.amount;

      await this.updateReceiptStatus(receiptId, 'success', txSignature, undefined, actualOutput);

      const comparison = await this.db.getReceiptComparison(receiptId);

      return { success: true, actualOutput, comparison };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateReceiptStatus(receiptId, 'failed', txSignature, message);
      return { success: false };
    }
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
