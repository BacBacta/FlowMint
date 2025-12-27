/**
 * Jupiter Ultra Swap Service
 *
 * Integrates with Jupiter Ultra API for simplified, optimized token swaps.
 * Ultra API provides RPC-less architecture with built-in transaction optimization,
 * MEV protection, and real-time slippage estimation.
 *
 * @see https://dev.jup.ag/docs/ultra for API documentation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Ultra order request parameters
 */
export interface UltraOrderRequest {
  /** Input token mint address */
  inputMint: string;
  /** Output token mint address */
  outputMint: string;
  /** Amount of input tokens (in smallest unit) */
  amount: string;
  /** Taker (user) public key - required to get a transaction */
  taker?: string;
  /** Receiver public key (defaults to taker) */
  receiver?: string;
  /** Referral account for integrator fees */
  referralAccount?: string;
  /** Referral fee in basis points (50-255) */
  referralFee?: number;
  /** Routers to exclude */
  excludeRouters?: ('iris' | 'jupiterz' | 'dflow' | 'okx')[];
  /** DEXes to exclude (comma-separated) */
  excludeDexes?: string;
}

/**
 * Route plan step in Ultra response
 */
export interface UltraRoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
  bps?: number;
  usdValue?: number;
}

/**
 * Ultra order response from API
 */
export interface UltraOrderResponse {
  /** Routing mode used */
  mode: string;
  /** Input token mint */
  inputMint: string;
  /** Output token mint */
  outputMint: string;
  /** Input amount */
  inAmount: string;
  /** Output amount */
  outAmount: string;
  /** Minimum output amount after slippage */
  otherAmountThreshold: string;
  /** Swap mode (ExactIn) */
  swapMode: string;
  /** Slippage in basis points */
  slippageBps: number;
  /** Price impact percentage (deprecated, use priceImpact) */
  priceImpactPct: string;
  /** Price impact as number */
  priceImpact?: number;
  /** Route plan with steps */
  routePlan: UltraRoutePlanStep[];
  /** Total fee in basis points */
  feeBps: number;
  /** Platform fee details */
  platformFee: {
    feeBps: number;
    amount: string;
  } | null;
  /** Signature fee in lamports */
  signatureFeeLamports: number;
  /** Who pays signature fee */
  signatureFeePayer: string | null;
  /** Prioritization fee in lamports */
  prioritizationFeeLamports: number;
  /** Who pays prioritization fee */
  prioritizationFeePayer: string | null;
  /** Rent fee in lamports */
  rentFeeLamports: number;
  /** Who pays rent fee */
  rentFeePayer: string | null;
  /** Router used */
  router: 'iris' | 'jupiterz' | 'dflow' | 'okx';
  /** Unsigned base64 transaction (null if taker not provided) */
  transaction: string | null;
  /** Whether this is a gasless transaction */
  gasless: boolean;
  /** Request ID for execute endpoint */
  requestId: string;
  /** Total time taken */
  totalTime: number;
  /** Taker public key */
  taker: string | null;
  /** Input USD value */
  inUsdValue?: number;
  /** Output USD value */
  outUsdValue?: number;
  /** Swap USD value */
  swapUsdValue?: number;
  /** Fee mint */
  feeMint?: string;
  /** Quote ID */
  quoteId?: string;
  /** Maker (for JupiterZ) */
  maker?: string;
  /** Expiration time */
  expireAt?: string;
  /** Error code if transaction is empty */
  errorCode?: 1 | 2 | 3;
  /** Error message if transaction is empty */
  errorMessage?: string;
}

/**
 * Ultra execute request
 */
export interface UltraExecuteRequest {
  /** Signed transaction (base64) */
  signedTransaction: string;
  /** Request ID from order response */
  requestId: string;
}

/**
 * Swap event in execute response
 */
export interface UltraSwapEvent {
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  outputAmount: string;
}

/**
 * Ultra execute response
 */
export interface UltraExecuteResponse {
  /** Execution status */
  status: 'Success' | 'Failed';
  /** Status code */
  code: number;
  /** Transaction signature */
  signature?: string;
  /** Slot number */
  slot?: string;
  /** Error message if failed */
  error?: string;
  /** Total input amount */
  totalInputAmount?: string;
  /** Total output amount */
  totalOutputAmount?: string;
  /** Actual input amount */
  inputAmountResult?: string;
  /** Actual output amount */
  outputAmountResult?: string;
  /** Swap events */
  swapEvents?: UltraSwapEvent[];
}

/**
 * Token holdings response
 */
export interface UltraHoldingsResponse {
  /** Wallet address */
  wallet: string;
  /** Token balances */
  tokens: Array<{
    mint: string;
    amount: string;
    decimals: number;
    uiAmount: number;
    usdValue?: number;
  }>;
}

/**
 * Token shield (safety) response
 */
export interface UltraShieldResponse {
  mint: string;
  warnings: string[];
  isSafe: boolean;
}

/**
 * Custom error for Jupiter Ultra API issues
 */
export class JupiterUltraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'JupiterUltraError';
  }
}

// =============================================================================
// Service
// =============================================================================

/**
 * Jupiter Ultra Service for optimized swap operations
 *
 * Ultra API is the recommended API for trading on Solana, providing:
 * - RPC-less architecture (no need to maintain your own RPC)
 * - Built-in transaction optimization and MEV protection
 * - Real-time slippage estimation
 * - Gasless transactions support
 * - Sub-second transaction landing
 */
export class JupiterUltraService {
  private readonly client: AxiosInstance;
  private readonly log = logger.child({ service: 'JupiterUltraService' });

  constructor() {
    if (!config.jupiter.apiKey) {
      this.log.warn('JUPITER_API_KEY not set - Ultra API requires an API key');
    }

    this.client = axios.create({
      baseURL: 'https://api.jup.ag/ultra/v1',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.jupiter.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {}),
      },
    });

    this.log.info({ apiUrl: 'https://api.jup.ag/ultra/v1' }, 'JupiterUltraService initialized');
  }

  /**
   * Get a swap order from Jupiter Ultra
   *
   * This is a combined quote + transaction endpoint. If taker is provided,
   * returns an unsigned transaction ready to be signed and executed.
   *
   * @param request - Order request parameters
   * @returns Order response with quote and optional transaction
   * @throws JupiterUltraError if the order fails
   *
   * @example
   * ```typescript
   * // Get quote only (no transaction)
   * const quote = await jupiterUltraService.getOrder({
   *   inputMint: 'So11111111111111111111111111111111111111112',
   *   outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
   *   amount: '1000000000', // 1 SOL
   * });
   *
   * // Get quote with transaction
   * const order = await jupiterUltraService.getOrder({
   *   inputMint: 'So11111111111111111111111111111111111111112',
   *   outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
   *   amount: '1000000000',
   *   taker: 'UserPublicKeyHere',
   * });
   * ```
   */
  async getOrder(request: UltraOrderRequest): Promise<UltraOrderResponse> {
    this.log.debug({ request }, 'Getting Ultra order');

    try {
      const params = new URLSearchParams({
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
      });

      if (request.taker) {
        params.append('taker', request.taker);
      }
      if (request.receiver) {
        params.append('receiver', request.receiver);
      }
      if (request.referralAccount) {
        params.append('referralAccount', request.referralAccount);
      }
      if (request.referralFee) {
        params.append('referralFee', request.referralFee.toString());
      }
      if (request.excludeRouters && request.excludeRouters.length > 0) {
        params.append('excludeRouters', request.excludeRouters.join(','));
      }
      if (request.excludeDexes) {
        params.append('excludeDexes', request.excludeDexes);
      }

      const response = await this.client.get<UltraOrderResponse>(`/order?${params.toString()}`);

      // Check for error in response (can happen even with 200 status)
      if (response.data.errorCode && response.data.errorMessage) {
        throw new JupiterUltraError(
          response.data.errorMessage,
          `ULTRA_ERROR_${response.data.errorCode}`,
          200,
          response.data
        );
      }

      this.log.info(
        {
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          inAmount: response.data.inAmount,
          outAmount: response.data.outAmount,
          priceImpact: response.data.priceImpact ?? response.data.priceImpactPct,
          router: response.data.router,
          gasless: response.data.gasless,
          hasTransaction: !!response.data.transaction,
        },
        'Ultra order received'
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Ultra order');
    }
  }

  /**
   * Execute a signed swap transaction through Jupiter Ultra
   *
   * Ultra handles transaction broadcasting with optimized landing and MEV protection.
   *
   * @param request - Execute request with signed transaction
   * @returns Execution result with signature and amounts
   * @throws JupiterUltraError if execution fails
   *
   * @example
   * ```typescript
   * const result = await jupiterUltraService.execute({
   *   signedTransaction: signedTxBase64,
   *   requestId: order.requestId,
   * });
   *
   * if (result.status === 'Success') {
   *   console.log('Swap successful:', result.signature);
   * }
   * ```
   */
  async execute(request: UltraExecuteRequest): Promise<UltraExecuteResponse> {
    this.log.debug({ requestId: request.requestId }, 'Executing Ultra swap');

    try {
      const response = await this.client.post<UltraExecuteResponse>('/execute', request);

      if (response.data.status === 'Failed') {
        this.log.error(
          {
            requestId: request.requestId,
            error: response.data.error,
            code: response.data.code,
          },
          'Ultra swap execution failed'
        );
      } else {
        this.log.info(
          {
            requestId: request.requestId,
            signature: response.data.signature,
            inputAmount: response.data.inputAmountResult,
            outputAmount: response.data.outputAmountResult,
          },
          'Ultra swap executed successfully'
        );
      }

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to execute Ultra swap');
    }
  }

  /**
   * Get token holdings for a wallet
   *
   * RPC-less way to get wallet token balances.
   *
   * @param wallet - Wallet public key
   * @returns Token holdings with USD values
   */
  async getHoldings(wallet: string): Promise<UltraHoldingsResponse> {
    try {
      const response = await this.client.get<UltraHoldingsResponse>(`/holdings?wallet=${wallet}`);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get holdings');
    }
  }

  /**
   * Get token safety/shield information
   *
   * Check if a token has any warnings or is considered safe.
   *
   * @param mints - Token mint addresses to check
   * @returns Shield information for each token
   */
  async getShield(mints: string[]): Promise<UltraShieldResponse[]> {
    try {
      const response = await this.client.get<UltraShieldResponse[]>(
        `/shield?mints=${mints.join(',')}`
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'Failed to get shield info');
    }
  }

  /**
   * Check if Ultra API is available and API key is valid
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try a minimal order request without taker
      await this.getOrder({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
      });
      return true;
    } catch (error) {
      if (error instanceof JupiterUltraError && error.code === 'UNAUTHORIZED') {
        return false;
      }
      // Other errors might still mean the API is reachable
      return true;
    }
  }

  /**
   * Handle and transform API errors
   */
  private handleError(error: unknown, context: string): JupiterUltraError {
    if (error instanceof JupiterUltraError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: string; message?: string; code?: number }>;
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

      if (statusCode === 401 || statusCode === 403) {
        return new JupiterUltraError(
          'Jupiter Ultra API unauthorized - configure JUPITER_API_KEY via portal.jup.ag',
          'UNAUTHORIZED',
          statusCode,
          axiosError.response?.data
        );
      }
      if (statusCode === 400) {
        return new JupiterUltraError(
          `Invalid request: ${message}`,
          'INVALID_REQUEST',
          statusCode,
          axiosError.response?.data
        );
      }
      if (statusCode === 404) {
        return new JupiterUltraError(
          'Route not found - token pair may not be supported',
          'ROUTE_NOT_FOUND',
          statusCode
        );
      }
      if (statusCode === 429) {
        return new JupiterUltraError('Rate limited - please retry later', 'RATE_LIMITED', statusCode);
      }
      if (statusCode && statusCode >= 500) {
        return new JupiterUltraError(
          'Jupiter Ultra API is temporarily unavailable',
          'SERVICE_ERROR',
          statusCode
        );
      }

      return new JupiterUltraError(`${context}: ${message}`, 'API_ERROR', statusCode);
    }

    const err = error as Error;
    this.log.error({ error: err }, context);
    return new JupiterUltraError(`${context}: ${err.message}`, 'UNKNOWN_ERROR');
  }
}

// Export singleton instance
export const jupiterUltraService = new JupiterUltraService();
