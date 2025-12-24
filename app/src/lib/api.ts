/**
 * FlowMint API Client
 *
 * Client library for interacting with the FlowMint server API.
 * - When NEXT_PUBLIC_API_URL is set: uses external backend (e.g., Fly.io) with /api/v1 routes
 * - When empty: uses Next.js API routes with /api routes
 */

// Backend URL (empty = use Next.js API routes)
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || '';

// API prefix differs based on target
const API_PREFIX = BACKEND_URL ? '/api/v1' : '/api';
const API_URL = BACKEND_URL;

// Types
export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  routePlan: Array<{
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
  }>;
}

export interface SwapRequest {
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
  protectedMode?: boolean;
}

export interface SwapResponse {
  success: boolean;
  signature?: string;
  receipt?: any;
  error?: string;
}

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
}

export interface IntentRequest {
  userPublicKey: string;
  type: 'dca' | 'stop-loss';
  inputMint: string;
  outputMint: string;
  totalAmount: number;
  // DCA specific
  intervalMs?: number;
  numberOfOrders?: number;
  // Stop-loss specific
  triggerPrice?: number;
  pythFeedId?: string;
}

export interface IntentResponse {
  success: boolean;
  intentId?: string;
  error?: string;
}

export interface PaymentRequest {
  merchantId: string;
  orderId: string;
  amountUsdc: number;
  payerPublicKey?: string;
  payerMint?: string;
}

export interface PaymentLinkResponse {
  success: boolean;
  paymentId: string;
  paymentUrl: string;
  qrCode: string;
  expiresAt: string;
}

// API Client
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Health check (backend uses /health directly, not under /api/v1)
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('/health');
  }

  // Swap endpoints
  async getQuote(params: QuoteRequest): Promise<QuoteResponse> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount.toString(),
      slippageBps: (params.slippageBps || 50).toString(),
    });

    return this.request(`${API_PREFIX}/swap/quote?${queryParams}`);
  }

  async executeSwap(params: SwapRequest): Promise<SwapResponse> {
    return this.request(`${API_PREFIX}/swap/execute`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getSwapReceipts(userPublicKey: string): Promise<any[]> {
    return this.request(`${API_PREFIX}/swap/receipts/${userPublicKey}`);
  }

  // Intent endpoints (backend uses /intents, not /intent)
  async createIntent(params: IntentRequest): Promise<IntentResponse> {
    return this.request(`${API_PREFIX}/intents`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getIntents(userPublicKey: string): Promise<any[]> {
    return this.request(`${API_PREFIX}/intents/${userPublicKey}`);
  }

  async cancelIntent(intentId: string): Promise<{ success: boolean }> {
    return this.request(`${API_PREFIX}/intents/${intentId}`, {
      method: 'DELETE',
    });
  }

  // Payment endpoints (backend uses /payments, not /payment)
  async createPaymentLink(params: PaymentRequest): Promise<PaymentLinkResponse> {
    return this.request(`${API_PREFIX}/payments/create-link`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getPaymentStatus(paymentId: string): Promise<any> {
    return this.request(`${API_PREFIX}/payments/${paymentId}`);
  }

  async executePayment(
    paymentId: string,
    payerPublicKey: string,
    payerMint: string
  ): Promise<SwapResponse> {
    return this.request(`${API_PREFIX}/payments/${paymentId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ payerPublicKey, payerMint }),
    });
  }
}

// Export singleton instance
export const apiClient = new ApiClient(API_URL);
