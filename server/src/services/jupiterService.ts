/**
 * Jupiter Service
 *
 * Integrates with Jupiter API v6 for token swap quotes and execution.
 *
 * @see https://docs.jup.ag for API documentation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Connection, PublicKey, VersionedTransaction, TransactionMessage } from '@solana/web3.js';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Jupiter quote request parameters
 */
export interface QuoteRequest {
  /** Input token mint address */
  inputMint: string;
  /** Output token mint address */
  outputMint: string;
  /** Amount of input tokens (in smallest unit) */
  amount: string;
  /** Slippage tolerance in basis points */
  slippageBps: number;
  /** Swap mode: ExactIn or ExactOut */
  swapMode?: 'ExactIn' | 'ExactOut';
  /** Only use direct routes */
  onlyDirectRoutes?: boolean;
  /** Maximum number of accounts in transaction */
  maxAccounts?: number;
  /** Platform fee in basis points */
  platformFeeBps?: number;
}

/**
 * Jupiter quote response from API
 */
export interface QuoteResponse {
  /** Input token mint */
  inputMint: string;
  /** Input amount */
  inAmount: string;
  /** Output token mint */
  outputMint: string;
  /** Output amount */
  outAmount: string;
  /** Other amount threshold based on swap mode */
  otherAmountThreshold: string;
  /** Swap mode used */
  swapMode: string;
  /** Slippage in basis points */
  slippageBps: number;
  /** Platform fee if applicable */
  platformFee: {
    amount: string;
    feeBps: number;
  } | null;
  /** Price impact percentage */
  priceImpactPct: string;
  /** Route plan with steps */
  routePlan: RoutePlanStep[];
  /** Context slot for quote freshness */
  contextSlot: number;
  /** Time taken for quote */
  timeTaken: number;
}

/**
 * Step in the route plan
 */
export interface RoutePlanStep {
  /** Swap info for this step */
  swapInfo: {
    /** AMM key/ID */
    ammKey: string;
    /** Label of the AMM */
    label: string;
    /** Input mint for this step */
    inputMint: string;
    /** Output mint for this step */
    outputMint: string;
    /** Input amount */
    inAmount: string;
    /** Output amount */
    outAmount: string;
    /** Fee amount */
    feeAmount: string;
    /** Fee mint */
    feeMint: string;
  };
  /** Percentage of input amount for this route */
  percent: number;
}

/**
 * Jupiter swap request
 */
export interface SwapRequest {
  /** Quote response from quoteSwap */
  quoteResponse: QuoteResponse;
  /** User's public key */
  userPublicKey: string;
  /** Wrap/unwrap SOL automatically */
  wrapAndUnwrapSol?: boolean;
  /** Fee account for platform fees */
  feeAccount?: string;
  /** Track this transaction */
  trackingAccount?: string;
  /** Compute unit price in micro-lamports for priority */
  computeUnitPriceMicroLamports?: number;
  /** Priority level */
  prioritizationFeeLamports?: 'auto' | number;
  /** Use shared accounts for better performance */
  useSharedAccounts?: boolean;
  /** Dynamic compute unit limit */
  dynamicComputeUnitLimit?: boolean;
  /** Skip user accounts RPC call */
  skipUserAccountsRpcCalls?: boolean;
}

/**
 * Jupiter swap response
 */
export interface SwapResponse {
  /** Serialized transaction (base64) */
  swapTransaction: string;
  /** Last valid block height */
  lastValidBlockHeight: number;
  /** Priority fee paid */
  prioritizationFeeLamports: number;
  /** Compute unit limit */
  computeUnitLimit: number;
  /** Priority type used */
  prioritizationType: {
    computeBudget: {
      microLamports: number;
      estimatedMicroLamports: number;
    };
  };
  /** Dynamic slippage report */
  dynamicSlippageReport?: {
    slippageBps: number;
    otherAmount: number;
    simulatedIncurredSlippageBps: number;
    amplificationRatio: string;
  };
  /** Simulation error if any */
  simulationError?: string;
}

/**
 * Custom error for Jupiter API issues
 */
export class JupiterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'JupiterError';
  }
}

/**
 * Jupiter Service for swap operations
 *
 * Provides methods to get quotes and execute token swaps
 * through the Jupiter aggregator.
 */
export class JupiterService {
  private readonly client: AxiosInstance;
  private readonly connection: Connection;
  private readonly log = logger.child({ service: 'JupiterService' });

  constructor() {
    this.client = axios.create({
      baseURL: config.jupiter.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.connection = new Connection(config.solana.rpcUrl, config.solana.commitment);

    this.log.info({ apiUrl: config.jupiter.apiUrl }, 'JupiterService initialized');
  }

  /**
   * Get a swap quote from Jupiter
   *
   * @param request - Quote request parameters
   * @returns Quote response with route and pricing
   * @throws JupiterError if the quote fails
   *
   * @example
   * ```typescript
   * const quote = await jupiterService.quoteSwap({
   *   inputMint: 'So11111111111111111111111111111111111111112',
   *   outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
   *   amount: '1000000000', // 1 SOL
   *   slippageBps: 50, // 0.5%
   * });
   * ```
   */
  async quoteSwap(request: QuoteRequest): Promise<QuoteResponse> {
    this.log.debug({ request }, 'Getting swap quote');

    try {
      const params = new URLSearchParams({
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        slippageBps: request.slippageBps.toString(),
      });

      if (request.swapMode) {
        params.append('swapMode', request.swapMode);
      }
      if (request.onlyDirectRoutes) {
        params.append('onlyDirectRoutes', 'true');
      }
      if (request.maxAccounts) {
        params.append('maxAccounts', request.maxAccounts.toString());
      }
      if (request.platformFeeBps || config.jupiter.platformFeeBps) {
        params.append(
          'platformFeeBps',
          (request.platformFeeBps || config.jupiter.platformFeeBps).toString()
        );
      }

      // NOTE: axios treats a leading slash as an absolute path and will drop the
      // path component from baseURL. Since our baseURL is typically
      // "https://quote-api.jup.ag/v6", we must use a relative path here.
      const response = await this.client.get<QuoteResponse>(`quote?${params.toString()}`);

      this.log.info(
        {
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          inAmount: response.data.inAmount,
          outAmount: response.data.outAmount,
          priceImpactPct: response.data.priceImpactPct,
          routeSteps: response.data.routePlan.length,
        },
        'Quote received'
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get swap quote');
    }
  }

  /**
   * Get the swap transaction from Jupiter
   *
   * @param request - Swap request with quote and user info
   * @returns Swap response with serialized transaction
   * @throws JupiterError if the swap preparation fails
   *
   * @example
   * ```typescript
   * const swap = await jupiterService.getSwapTransaction({
   *   quoteResponse: quote,
   *   userPublicKey: 'UserPublicKeyHere...',
   *   wrapAndUnwrapSol: true,
   * });
   * ```
   */
  async getSwapTransaction(request: SwapRequest): Promise<SwapResponse> {
    this.log.debug({ userPublicKey: request.userPublicKey }, 'Getting swap transaction');

    try {
      // Same rule as above: keep this relative so baseURL's "/v6" is preserved.
      const response = await this.client.post<SwapResponse>('swap', {
        quoteResponse: request.quoteResponse,
        userPublicKey: request.userPublicKey,
        wrapAndUnwrapSol: request.wrapAndUnwrapSol ?? true,
        feeAccount: request.feeAccount,
        trackingAccount: request.trackingAccount,
        computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports,
        prioritizationFeeLamports: request.prioritizationFeeLamports ?? 'auto',
        useSharedAccounts: request.useSharedAccounts ?? true,
        dynamicComputeUnitLimit: request.dynamicComputeUnitLimit ?? true,
        skipUserAccountsRpcCalls: request.skipUserAccountsRpcCalls ?? false,
      });

      if (response.data.simulationError) {
        throw new JupiterError(
          `Swap simulation failed: ${response.data.simulationError}`,
          'SIMULATION_FAILED',
          undefined,
          response.data
        );
      }

      this.log.info(
        {
          priorityFee: response.data.prioritizationFeeLamports,
          computeUnits: response.data.computeUnitLimit,
        },
        'Swap transaction ready'
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get swap transaction');
    }
  }

  /**
   * Execute a complete swap (quote + transaction)
   *
   * This is a convenience method that combines quoteSwap and getSwapTransaction.
   *
   * @param params - Swap parameters
   * @returns Quote and swap transaction
   */
  async executeSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
    userPublicKey: string;
    swapMode?: 'ExactIn' | 'ExactOut';
  }): Promise<{ quote: QuoteResponse; swap: SwapResponse }> {
    // Get quote
    const quote = await this.quoteSwap({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      swapMode: params.swapMode,
    });

    // Get swap transaction
    const swap = await this.getSwapTransaction({
      quoteResponse: quote,
      userPublicKey: params.userPublicKey,
    });

    return { quote, swap };
  }

  /**
   * Deserialize a swap transaction for inspection or signing
   *
   * @param swapTransaction - Base64 encoded transaction
   * @returns Deserialized VersionedTransaction
   */
  deserializeTransaction(swapTransaction: string): VersionedTransaction {
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    return VersionedTransaction.deserialize(swapTransactionBuf);
  }

  /**
   * Get token list from Jupiter
   *
   * @param tags - Filter by tags (e.g., 'verified', 'strict')
   * @returns List of tokens
   */
  async getTokenList(tags?: string[]): Promise<TokenInfo[]> {
    try {
      const params = tags ? `?tags=${tags.join(',')}` : '';
      const response = await axios.get<TokenInfo[]>(
        `https://tokens.jup.ag/tokens${params}`
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get token list');
    }
  }

  /**
   * Check if a token pair is supported
   *
   * @param inputMint - Input token mint
   * @param outputMint - Output token mint
   * @returns Whether the pair is tradeable
   */
  async isPairSupported(inputMint: string, outputMint: string): Promise<boolean> {
    try {
      await this.quoteSwap({
        inputMint,
        outputMint,
        amount: '1000000', // Small test amount
        slippageBps: 100,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle and transform API errors
   */
  private handleError(error: unknown, context: string): JupiterError {
    if (error instanceof JupiterError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      const statusCode = axiosError.response?.status;
      const message =
        axiosError.response?.data?.error ||
        axiosError.response?.data?.message ||
        axiosError.message;

      this.log.error(
        {
          statusCode,
          message,
          url: axiosError.config?.url,
        },
        context
      );

      // Handle specific error codes
      if (statusCode === 400) {
        return new JupiterError(
          `Invalid request: ${message}`,
          'INVALID_REQUEST',
          statusCode,
          axiosError.response?.data
        );
      }
      if (statusCode === 404) {
        return new JupiterError(
          'Route not found - token pair may not be supported',
          'ROUTE_NOT_FOUND',
          statusCode
        );
      }
      if (statusCode === 429) {
        return new JupiterError('Rate limited - please retry later', 'RATE_LIMITED', statusCode);
      }
      if (statusCode && statusCode >= 500) {
        return new JupiterError('Jupiter API is temporarily unavailable', 'SERVICE_ERROR', statusCode);
      }

      return new JupiterError(`${context}: ${message}`, 'API_ERROR', statusCode);
    }

    const err = error as Error;
    this.log.error({ error: err }, context);
    return new JupiterError(`${context}: ${err.message}`, 'UNKNOWN_ERROR');
  }
}

/**
 * Token information from Jupiter
 */
export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  daily_volume?: number;
}

// Export singleton instance
export const jupiterService = new JupiterService();
