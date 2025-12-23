/**
 * FlowMint SDK Types
 */

// Quote types
export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
}

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  routePlan: RoutePlan[];
}

export interface RoutePlan {
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
}

// Swap types
export interface SwapRequest {
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
}

export interface SwapResponse {
  success: boolean;
  signature?: string;
  receipt?: SwapReceipt;
  error?: string;
}

export interface SwapReceipt {
  id: string;
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  slippageBps: number;
  priceImpact: number;
  signature: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: string;
}

// Intent types
export type IntentType = 'dca' | 'stop-loss';
export type IntentStatus = 'active' | 'completed' | 'cancelled' | 'failed';

export interface IntentRequest {
  userPublicKey: string;
  type: IntentType;
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

export interface Intent {
  id: string;
  userPublicKey: string;
  type: IntentType;
  status: IntentStatus;
  inputMint: string;
  outputMint: string;
  totalAmount: number;
  executedAmount: number;
  // DCA specific
  intervalMs?: number;
  numberOfOrders?: number;
  ordersExecuted?: number;
  nextExecutionTime?: string;
  // Stop-loss specific
  triggerPrice?: number;
  pythFeedId?: string;
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// Payment types
export interface PaymentRequest {
  merchantId: string;
  orderId: string;
  amountUsdc: number;
  payerPublicKey?: string;
  payerMint?: string;
  metadata?: Record<string, string>;
}

export interface PaymentLinkResponse {
  success: boolean;
  paymentId: string;
  paymentUrl: string;
  qrCode: string;
  expiresAt: string;
}

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'expired' | 'failed';

export interface Payment {
  id: string;
  merchantId: string;
  orderId: string;
  amountUsdc: number;
  status: PaymentStatus;
  payerPublicKey?: string;
  payerMint?: string;
  payerAmount?: number;
  signature?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

// Health types
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  version: string;
  services: {
    database: boolean;
    jupiter: boolean;
    solana: boolean;
    pyth: boolean;
  };
}

// Token types
export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
}

// Risk types
export type RiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export interface RiskAssessment {
  level: RiskLevel;
  priceImpact: number;
  slippage: number;
  inputTokenRisk: string;
  outputTokenRisk: string;
  warnings: string[];
}
