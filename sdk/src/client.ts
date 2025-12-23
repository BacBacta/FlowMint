/**
 * FlowMint SDK Client
 *
 * Main client class for interacting with the FlowMint API
 */

import {
  type QuoteRequest,
  type QuoteResponse,
  type SwapRequest,
  type SwapResponse,
  type SwapReceipt,
  type IntentRequest,
  type IntentResponse,
  type Intent,
  type PaymentRequest,
  type PaymentLinkResponse,
  type Payment,
  type HealthResponse,
  type Token,
} from './types';
import { FlowMintError, ApiError, NetworkError, RateLimitError } from './errors';

export interface FlowMintClientConfig {
  /** Base URL of the FlowMint API */
  apiUrl?: string;
  /** API key for authentication (optional) */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retries for failed requests */
  retries?: number;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

const DEFAULT_CONFIG: Required<Omit<FlowMintClientConfig, 'apiKey' | 'fetch'>> = {
  apiUrl: 'https://api.flowmint.io',
  timeout: 30000,
  retries: 3,
};

export class FlowMintClient {
  private readonly config: Required<Omit<FlowMintClientConfig, 'apiKey' | 'fetch'>> & {
    apiKey?: string;
    fetch: typeof fetch;
  };

  constructor(config: FlowMintClientConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      fetch: config.fetch || globalThis.fetch.bind(globalThis),
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    attempt = 1,
  ): Promise<T> {
    const url = `${this.config.apiUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await this.config.fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new RateLimitError(retryAfter ? parseInt(retryAfter) : undefined);
        }

        // Parse error response
        let errorMessage = `HTTP ${response.status}`;
        let errorDetails: Record<string, unknown> | undefined;

        try {
          const errorBody = await response.json();
          errorMessage = errorBody.message || errorBody.error || errorMessage;
          errorDetails = errorBody;
        } catch {
          // Ignore JSON parse errors
        }

        throw new ApiError(errorMessage, response.status, errorDetails);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError('Request timeout');
      }

      // Handle network errors with retry
      if (error instanceof NetworkError && attempt < this.config.retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.request<T>(endpoint, options, attempt + 1);
      }

      // Handle rate limiting with retry
      if (error instanceof RateLimitError && error.retryAfter && attempt < this.config.retries) {
        await new Promise((resolve) => setTimeout(resolve, error.retryAfter! * 1000));
        return this.request<T>(endpoint, options, attempt + 1);
      }

      throw error;
    }
  }

  // =========================================================================
  // Health
  // =========================================================================

  /**
   * Check the health status of the FlowMint API
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/health');
  }

  // =========================================================================
  // Swap
  // =========================================================================

  /**
   * Get a swap quote
   */
  async getQuote(params: QuoteRequest): Promise<QuoteResponse> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount.toString(),
      slippageBps: (params.slippageBps || 50).toString(),
    });

    return this.request<QuoteResponse>(`/api/swap/quote?${queryParams}`);
  }

  /**
   * Execute a token swap
   */
  async executeSwap(params: SwapRequest): Promise<SwapResponse> {
    return this.request<SwapResponse>('/api/swap/execute', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get swap receipts for a user
   */
  async getSwapReceipts(userPublicKey: string): Promise<SwapReceipt[]> {
    return this.request<SwapReceipt[]>(`/api/swap/receipts/${userPublicKey}`);
  }

  /**
   * Get a specific swap receipt
   */
  async getSwapReceipt(receiptId: string): Promise<SwapReceipt> {
    return this.request<SwapReceipt>(`/api/swap/receipt/${receiptId}`);
  }

  // =========================================================================
  // Intents (DCA / Stop-Loss)
  // =========================================================================

  /**
   * Create a new intent (DCA or stop-loss)
   */
  async createIntent(params: IntentRequest): Promise<IntentResponse> {
    return this.request<IntentResponse>('/api/intent', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get all intents for a user
   */
  async getIntents(userPublicKey: string): Promise<Intent[]> {
    return this.request<Intent[]>(`/api/intent/${userPublicKey}`);
  }

  /**
   * Get a specific intent
   */
  async getIntent(intentId: string): Promise<Intent> {
    return this.request<Intent>(`/api/intent/id/${intentId}`);
  }

  /**
   * Cancel an intent
   */
  async cancelIntent(intentId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/intent/${intentId}`, {
      method: 'DELETE',
    });
  }

  // =========================================================================
  // Payments
  // =========================================================================

  /**
   * Create a payment link
   */
  async createPaymentLink(params: PaymentRequest): Promise<PaymentLinkResponse> {
    return this.request<PaymentLinkResponse>('/api/payment/create-link', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get payment status
   */
  async getPayment(paymentId: string): Promise<Payment> {
    return this.request<Payment>(`/api/payment/${paymentId}`);
  }

  /**
   * Execute a payment
   */
  async executePayment(
    paymentId: string,
    payerPublicKey: string,
    payerMint: string,
  ): Promise<SwapResponse> {
    return this.request<SwapResponse>(`/api/payment/${paymentId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ payerPublicKey, payerMint }),
    });
  }

  /**
   * Get payments for a merchant
   */
  async getMerchantPayments(merchantId: string): Promise<Payment[]> {
    return this.request<Payment[]>(`/api/payment/merchant/${merchantId}`);
  }

  // =========================================================================
  // Tokens
  // =========================================================================

  /**
   * Get list of supported tokens
   */
  async getTokens(): Promise<Token[]> {
    return this.request<Token[]>('/api/tokens');
  }

  /**
   * Get token by mint address
   */
  async getToken(mint: string): Promise<Token> {
    return this.request<Token>(`/api/tokens/${mint}`);
  }
}
