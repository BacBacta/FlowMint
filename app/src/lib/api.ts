/**
 * FlowMint API Client
 *
 * Client library for interacting with the FlowMint server API.
 * - When NEXT_PUBLIC_API_URL is set: uses external backend (e.g., Fly.io) with /api/v1 routes
 * - When empty: uses Next.js API routes with /api routes
 */

import bs58 from 'bs58';

// Backend URL (empty = use Next.js API routes)
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || '';

// API prefix differs based on target
const API_PREFIX = BACKEND_URL ? '/api/v1' : '/api';
const API_URL = BACKEND_URL;

/**
 * Create the message that must be signed for intent operations.
 * Must match the backend format exactly.
 */
export function createIntentAuthMessage(
  action: 'CREATE_DCA' | 'CREATE_STOP_LOSS' | 'CANCEL',
  userPublicKey: string,
  timestamp: number
): string {
  return `FlowMint Intent ${action}\n\nWallet: ${userPublicKey}\nTimestamp: ${timestamp}\n\nSign this message to authorize this action. This will not trigger a blockchain transaction.`;
}

/**
 * Sign an intent message using the wallet's signMessage function.
 * Returns the signature as a base58 string.
 */
export async function signIntentMessage(
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  action: 'CREATE_DCA' | 'CREATE_STOP_LOSS' | 'CANCEL',
  userPublicKey: string
): Promise<{ signature: string; timestamp: number }> {
  const timestamp = Date.now();
  const message = createIntentAuthMessage(action, userPublicKey, timestamp);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await signMessage(messageBytes);
  const signature = bs58.encode(signatureBytes);
  return { signature, timestamp };
}

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

export type RiskSignal = 'GREEN' | 'AMBER' | 'RED';

export interface RiskReason {
  code: string;
  severity: RiskSignal;
  message: string;
  detail?: string;
  threshold?: { used: number; limit: number };
}

export interface RiskAssessment {
  level: RiskSignal;
  tokenSafetyLevel?: RiskSignal;
  tradeRiskLevel?: RiskSignal;
  reasons: RiskReason[];
  blockedInProtectedMode: boolean;
  requiresAcknowledgement: boolean;
  quoteAgeSeconds: number;
  timestamp: number;
}

export interface QuoteWithRisk {
  quote: QuoteResponse;
  quoteTimestamp: number;
  riskAssessment: RiskAssessment;
}

export interface SwapRequest {
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  amount: string; // Base units as string
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

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  logoURI: string;
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

export interface SwapExecutionEvent {
  id: number;
  receiptId: string;
  eventType:
    | 'quote'
    | 'requote'
    | 'flowmint_inject'
    | 'tx_build'
    | 'tx_send'
    | 'tx_confirm'
    | 'retry'
    | 'success'
    | 'failure';
  timestamp: number;
  rpcEndpoint?: string;
  priorityFee?: number;
  slippageBps?: number;
  signature?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
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

    const payload: any = await response.json().catch(() => null);

    // Backend typically returns { success: boolean, data?: any, error?: string }
    if (payload && typeof payload === 'object' && 'success' in payload) {
      if (payload.success === false) {
        const message = payload.error || payload.message || `HTTP ${response.status}`;
        throw new Error(message);
      }
      if (!response.ok) {
        const message = payload.error || payload.message || `HTTP ${response.status}`;
        throw new Error(message);
      }
      // Prefer unwrapping `data` when present.
      if ('data' in payload) {
        return payload.data as T;
      }
      return payload as T;
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload as T;
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

  async getQuoteWithRisk(params: QuoteRequest & { protectedMode: boolean }): Promise<QuoteWithRisk> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount.toString(),
      slippageBps: (params.slippageBps || 50).toString(),
      protectedMode: String(params.protectedMode),
      includeRisk: 'true',
    });

    return this.request(`${API_PREFIX}/swap/quote?${queryParams}`);
  }

  async getTokenByMint(mint: string): Promise<TokenInfo> {
    return this.request(`${API_PREFIX}/swap/token/${encodeURIComponent(mint)}`);
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

  async getSwapReceiptTimeline(receiptId: string): Promise<SwapExecutionEvent[]> {
    const result = await this.request<{ receiptId: string; events: SwapExecutionEvent[] }>(
      `${API_PREFIX}/swap/receipt/${encodeURIComponent(receiptId)}/timeline`
    );
    return result.events || [];
  }

  // Intent endpoints (backend uses /intents, not /intent)
  // Now require signature and timestamp for wallet ownership proof
  async createIntent(
    params: IntentRequest,
    signatureData: { signature: string; timestamp: number }
  ): Promise<IntentResponse> {
    if (params.type === 'dca') {
      return this.request(`${API_PREFIX}/intents/dca`, {
        method: 'POST',
        body: JSON.stringify({
          userPublicKey: params.userPublicKey,
          tokenFrom: params.inputMint,
          tokenTo: params.outputMint,
          totalAmount: String(Math.floor(params.totalAmount)),
          numberOfSwaps: params.numberOfOrders,
          intervalSeconds: params.intervalMs ? Math.floor(params.intervalMs / 1000) : undefined,
          signature: signatureData.signature,
          timestamp: signatureData.timestamp,
        }),
      });
    }

    return this.request(`${API_PREFIX}/intents/stop-loss`, {
      method: 'POST',
      body: JSON.stringify({
        userPublicKey: params.userPublicKey,
        tokenFrom: params.inputMint,
        tokenTo: params.outputMint,
        totalAmount: String(Math.floor(params.totalAmount)),
        priceThreshold: params.triggerPrice,
        // Default to 'below' as a safe/common stop-loss direction.
        priceDirection: 'below',
        priceFeedId: params.pythFeedId,
        signature: signatureData.signature,
        timestamp: signatureData.timestamp,
      }),
    });
  }

  async getIntents(userPublicKey: string): Promise<any[]> {
    return this.request(`${API_PREFIX}/intents/user/${userPublicKey}`);
  }

  async cancelIntent(
    intentId: string,
    userPublicKey: string,
    signatureData: { signature: string; timestamp: number }
  ): Promise<{ success: boolean }> {
    return this.request(`${API_PREFIX}/intents/${intentId}`, {
      method: 'DELETE',
      body: JSON.stringify({
        userPublicKey,
        signature: signatureData.signature,
        timestamp: signatureData.timestamp,
      }),
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
