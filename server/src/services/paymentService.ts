/**
 * Payment Service
 *
 * Handles "pay any token → USDC" payment processing.
 * V1 enhancements: ExactOut fallback, gasless support, policy attestation.
 */

import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config/index.js';
import { KNOWN_TOKENS } from '../config/risk-policies.js';
import { DatabaseService, PolicyRecord, PaymentQuoteRecord } from '../db/database.js';
import { logger } from '../utils/logger.js';

import {
  AttestationService,
  PlannedExecution,
  ActualExecution,
  RouteHop,
} from './attestationService.js';
import { flowMintOnChainService } from './flowMintOnChain.js';
import { InvoiceService } from './invoiceService.js';
import { jupiterService } from './jupiterService.js';
import { RelayerService } from './relayerService.js';

/**
 * Payment request
 */
export interface PaymentRequest {
  /** Optional payment ID (useful for invoices/links) */
  paymentId?: string;
  /** Payer's public key */
  payerPublicKey: string;
  /** Merchant's public key */
  merchantPublicKey: string;
  /** Exact USDC amount the merchant should receive (in smallest unit, 6 decimals) */
  amountUsdc: string;
  /** Token the payer wants to use */
  tokenFrom: string;
  /** Optional payment memo/reference */
  memo?: string;
  /** Use FlowMint on-chain program */
  useFlowMintProgram?: boolean;
  /** Payer's input token account */
  payerInputAccount?: string;
  /** Payer's USDC token account */
  payerUsdcAccount?: string;
  /** Merchant's USDC token account */
  merchantUsdcAccount?: string;
}

/**
 * Payment quote response
 */
export interface PaymentQuote {
  /** Quote ID for reference */
  quoteId: string;
  /** USDC amount merchant will receive */
  usdcAmount: string;
  /** Token payer will spend */
  inputToken: string;
  /** Estimated input amount needed */
  estimatedInputAmount: string;
  /** Maximum input amount (with slippage) */
  maxInputAmount: string;
  /** Price impact percentage */
  priceImpactPct: string;
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Route information */
  route: {
    steps: number;
    labels: string[];
  };
}

/**
 * Payment execution result
 */
export interface PaymentResult {
  /** Payment ID */
  paymentId: string;
  /** Status */
  status: 'pending' | 'success' | 'failed';
  /** USDC amount */
  usdcAmount: string;
  /** Actual input amount used */
  inputAmount: string;
  /** Input token */
  inputToken: string;
  /** Merchant public key */
  merchantPublicKey: string;
  /** Transaction to sign (base64) */
  transaction?: string;
  /** Last valid block height */
  lastValidBlockHeight?: number;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: number;
  /** Payment record PDA (if using FlowMint program) */
  paymentRecordPda?: string;
  /** Route data (if using FlowMint program) */
  routeData?: string;
}

/**
 * Payment record for database
 */
export interface PaymentRecord {
  paymentId: string;
  payerPublicKey: string;
  merchantPublicKey: string;
  inputToken: string;
  inputAmount: string;
  usdcAmount: string;
  memo?: string;
  status: 'pending' | 'success' | 'failed';
  txSignature?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Quote mode - ExactOut preferred, fallback to ExactIn+refund
 */
export type QuoteMode = 'ExactOut' | 'ExactIn';

/**
 * Fallback reason codes
 */
export type FallbackReason = 'UNSUPPORTED_EXACT_OUT' | 'INSUFFICIENT_LIQUIDITY' | 'RATE_LIMITED';

/**
 * Extended payment quote with fallback info
 */
export interface ExtendedPaymentQuote extends PaymentQuote {
  /** Quote mode used */
  mode: QuoteMode;
  /** Reason for fallback to ExactIn (if applicable) */
  fallbackReason?: FallbackReason;
  /** If ExactIn, the refund amount to merchant */
  refundAmount?: string;
  /** Risk assessment */
  risk: {
    priceImpactBps: number;
    slippageBps: number;
    hops: number;
    warnings: string[];
  };
  /** Gasless eligible */
  gaslessEligible?: boolean;
  /** TTL in milliseconds */
  ttlMs: number;
}

/**
 * Invoice payment request (V1)
 */
export interface InvoicePaymentRequest {
  invoiceId: string;
  payerPublicKey: string;
  payMint: string;
  useGasless?: boolean;
}

/**
 * Payment Service
 *
 * Manages payment processing with token conversion to USDC.
 */
export class PaymentService {
  private readonly log = logger.child({ service: 'PaymentService' });
  private readonly connection: Connection;
  private readonly usdcMint: string;
  private invoiceService?: InvoiceService;
  private attestationService?: AttestationService;
  private relayerService?: RelayerService;
  private signerKeypair?: Keypair;

  // V1 Constants
  private readonly QUOTE_TTL_MS = 15000; // 15 seconds
  private readonly MAX_HOPS = 4;
  private readonly MAX_PRICE_IMPACT_BPS = 300; // 3%
  private readonly DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

  constructor(private readonly db: DatabaseService) {
    this.connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
    this.usdcMint =
      config.solana.network === 'mainnet-beta' ? KNOWN_TOKENS.USDC : KNOWN_TOKENS.USDC;

    this.log.info('PaymentService initialized');
  }

  /**
   * Set V1 services
   */
  setServices(params: {
    invoiceService?: InvoiceService;
    attestationService?: AttestationService;
    relayerService?: RelayerService;
    signerKeypair?: Keypair;
  }): void {
    this.invoiceService = params.invoiceService;
    this.attestationService = params.attestationService;
    this.relayerService = params.relayerService;
    this.signerKeypair = params.signerKeypair;
  }

  /**
   * Get extended payment quote with ExactOut fallback
   *
   * Strategy:
   * 1. Try ExactOut first (merchant gets exact amount)
   * 2. If ExactOut fails/unavailable, use ExactIn with refund logic
   */
  async getExtendedQuote(
    payerPublicKey: string,
    payMint: string,
    settleMint: string,
    amountOut: string,
    policy?: PolicyRecord
  ): Promise<ExtendedPaymentQuote> {
    const quoteId = uuidv4();
    const now = Date.now();

    this.log.info(
      { quoteId, payer: payerPublicKey, payMint, settleMint, amountOut },
      'Getting extended payment quote'
    );

    // Check gasless eligibility
    let gaslessEligible = false;
    if (this.relayerService) {
      const eligibility = await this.relayerService.checkGaslessEligibility(
        payerPublicKey,
        payMint
      );
      gaslessEligible = eligibility.eligible;
    }

    // Direct transfer if same mint
    if (payMint === settleMint) {
      return {
        quoteId,
        usdcAmount: amountOut,
        inputToken: payMint,
        estimatedInputAmount: amountOut,
        maxInputAmount: amountOut,
        priceImpactPct: '0',
        expiresAt: now + this.QUOTE_TTL_MS,
        route: { steps: 0, labels: ['Direct Transfer'] },
        mode: 'ExactOut',
        risk: {
          priceImpactBps: 0,
          slippageBps: 0,
          hops: 0,
          warnings: [],
        },
        gaslessEligible,
        ttlMs: this.QUOTE_TTL_MS,
      };
    }

    // Try ExactOut first
    try {
      const exactOutQuote = await jupiterService.quoteSwap({
        inputMint: payMint,
        outputMint: settleMint,
        amount: amountOut,
        slippageBps: policy?.maxSlippageBps || this.DEFAULT_SLIPPAGE_BPS,
        swapMode: 'ExactOut',
      });

      const priceImpactBps = Math.round(parseFloat(exactOutQuote.priceImpactPct) * 100);
      const hops = exactOutQuote.routePlan.length;

      // Check against policy limits
      const maxPriceImpact = policy?.maxPriceImpactBps || this.MAX_PRICE_IMPACT_BPS;
      const maxHops = policy?.maxHops || this.MAX_HOPS;

      const warnings: string[] = [];
      if (priceImpactBps > maxPriceImpact) {
        warnings.push(`Price impact ${priceImpactBps / 100}% exceeds limit`);
      }
      if (hops > maxHops) {
        warnings.push(`Route has ${hops} hops, exceeds max ${maxHops}`);
      }

      // Calculate max input with buffer
      const estimatedInput = BigInt(exactOutQuote.inAmount);
      const slippageMultiplier = 1.01;
      const maxInput = BigInt(Math.ceil(Number(estimatedInput) * slippageMultiplier));

      return {
        quoteId,
        usdcAmount: amountOut,
        inputToken: payMint,
        estimatedInputAmount: exactOutQuote.inAmount,
        maxInputAmount: maxInput.toString(),
        priceImpactPct: exactOutQuote.priceImpactPct,
        expiresAt: now + this.QUOTE_TTL_MS,
        route: {
          steps: hops,
          labels: exactOutQuote.routePlan.map(step => step.swapInfo.label),
        },
        mode: 'ExactOut',
        risk: {
          priceImpactBps,
          slippageBps: policy?.maxSlippageBps || this.DEFAULT_SLIPPAGE_BPS,
          hops,
          warnings,
        },
        gaslessEligible,
        ttlMs: this.QUOTE_TTL_MS,
      };
    } catch (exactOutError) {
      this.log.warn(
        { error: exactOutError, errorCode: 'UNSUPPORTED_EXACT_OUT' },
        'ExactOut quote failed, trying ExactIn fallback'
      );
    }

    // Fallback: ExactIn mode with refund
    // Estimate input amount needed (add 2% buffer for safety)
    const estimatedInputForExactIn = await this.estimateInputAmount(payMint, settleMint, amountOut);

    const exactInQuote = await jupiterService.quoteSwap({
      inputMint: payMint,
      outputMint: settleMint,
      amount: estimatedInputForExactIn,
      slippageBps: policy?.maxSlippageBps || this.DEFAULT_SLIPPAGE_BPS,
      swapMode: 'ExactIn',
    });

    const priceImpactBps = Math.round(parseFloat(exactInQuote.priceImpactPct) * 100);
    const hops = exactInQuote.routePlan.length;

    // Calculate refund (output - required)
    const outputAmount = BigInt(exactInQuote.outAmount);
    const requiredAmount = BigInt(amountOut);
    const refundAmount =
      outputAmount > requiredAmount ? (outputAmount - requiredAmount).toString() : '0';

    const warnings: string[] = [
      'Using ExactIn mode with potential refund',
      'Code: UNSUPPORTED_EXACT_OUT - ExactOut not available for this pair',
    ];
    if (refundAmount !== '0') {
      warnings.push(`Refund of ~${refundAmount} ${settleMint.slice(0, 8)}... will be returned`);
    }

    return {
      quoteId,
      usdcAmount: amountOut,
      inputToken: payMint,
      estimatedInputAmount: exactInQuote.inAmount,
      maxInputAmount: exactInQuote.inAmount,
      priceImpactPct: exactInQuote.priceImpactPct,
      expiresAt: now + this.QUOTE_TTL_MS,
      route: {
        steps: hops,
        labels: exactInQuote.routePlan.map(step => step.swapInfo.label),
      },
      mode: 'ExactIn',
      fallbackReason: 'UNSUPPORTED_EXACT_OUT',
      refundAmount,
      risk: {
        priceImpactBps,
        slippageBps: policy?.maxSlippageBps || this.DEFAULT_SLIPPAGE_BPS,
        hops,
        warnings,
      },
      gaslessEligible,
      ttlMs: this.QUOTE_TTL_MS,
    };
  }

  /**
   * Estimate input amount for ExactIn fallback
   */
  private async estimateInputAmount(
    payMint: string,
    settleMint: string,
    targetOutput: string
  ): Promise<string> {
    try {
      // Get a rough quote to estimate rate
      const testAmount = '1000000'; // 1 USDC worth
      const testQuote = await jupiterService.quoteSwap({
        inputMint: payMint,
        outputMint: settleMint,
        amount: testAmount,
        slippageBps: 100,
        swapMode: 'ExactIn',
      });

      // Calculate rate and estimate input
      const inputPerOutput = Number(testQuote.inAmount) / Number(testQuote.outAmount);
      const estimatedInput = Math.ceil(Number(targetOutput) * inputPerOutput * 1.02); // 2% buffer

      return estimatedInput.toString();
    } catch {
      // Fallback: assume 1:1 with buffer
      return ((BigInt(targetOutput) * 102n) / 100n).toString();
    }
  }

  /**
   * Save quote to database for tracking
   */
  async saveQuote(quote: ExtendedPaymentQuote, invoiceId: string, payer: string): Promise<void> {
    const quoteRecord: PaymentQuoteRecord = {
      id: quote.quoteId,
      invoiceId,
      payer,
      payMint: quote.inputToken,
      planJson: JSON.stringify({
        mode: quote.mode,
        route: quote.route,
        estimatedInput: quote.estimatedInputAmount,
        maxInput: quote.maxInputAmount,
      }),
      riskJson: JSON.stringify(quote.risk),
      requiresGasless: quote.gaslessEligible || false,
      ttlMs: quote.ttlMs,
      expiresAt: quote.expiresAt,
      createdAt: Date.now(),
    };

    await this.db.savePaymentQuote(quoteRecord);
  }

  /**
   * Build route hops from Jupiter quote for attestation
   */
  private buildRouteHops(jupiterQuote: any): RouteHop[] {
    return jupiterQuote.routePlan.map((step: any) => ({
      dex: step.swapInfo.label,
      inputMint: step.swapInfo.inputMint,
      outputMint: step.swapInfo.outputMint,
      inputAmount: step.swapInfo.inAmount,
      outputAmount: step.swapInfo.outAmount,
    }));
  }

  /**
   * Create attestation for a completed payment
   */
  async createPaymentAttestation(params: {
    invoiceId: string;
    policy: PolicyRecord;
    quote: ExtendedPaymentQuote;
    txSignature: string;
    slot: number;
    actualAmountIn: string;
    actualAmountOut: string;
  }): Promise<string | undefined> {
    if (!this.attestationService || !this.signerKeypair) {
      this.log.warn('Attestation service not configured');
      return undefined;
    }

    const planned: PlannedExecution = {
      payMint: params.quote.inputToken,
      settleMint: this.usdcMint,
      amountIn: params.quote.estimatedInputAmount,
      amountOut: params.quote.usdcAmount,
      route: [], // Would be populated from detailed quote
      priceImpactBps: params.quote.risk.priceImpactBps,
      slippageBps: params.quote.risk.slippageBps,
      gasless: params.quote.gaslessEligible || false,
    };

    const actual: ActualExecution = {
      signature: params.txSignature,
      slot: params.slot,
      amountInActual: params.actualAmountIn,
      amountOutActual: params.actualAmountOut,
      feesPaid: '5000', // Placeholder
      success: true,
      timestamp: Date.now(),
    };

    try {
      const attestation = await this.attestationService.createAttestation({
        invoiceId: params.invoiceId,
        policy: params.policy,
        planned,
        actual,
        signerKeypair: this.signerKeypair,
      });

      return attestation.id;
    } catch (error) {
      this.log.error({ error }, 'Failed to create attestation');
      return undefined;
    }
  }

  /**
   * Get a payment quote
   *
   * Uses Jupiter's ExactOut mode to ensure merchant receives exact USDC amount.
   */
  async getPaymentQuote(request: PaymentRequest): Promise<PaymentQuote> {
    const quoteId = uuidv4();

    this.log.info(
      {
        quoteId,
        payer: request.payerPublicKey,
        merchant: request.merchantPublicKey,
        usdcAmount: request.amountUsdc,
        tokenFrom: request.tokenFrom,
      },
      'Getting payment quote'
    );

    // Validate addresses
    try {
      new PublicKey(request.payerPublicKey);
      new PublicKey(request.merchantPublicKey);
      new PublicKey(request.tokenFrom);
    } catch {
      throw new Error('Invalid public key format');
    }

    // Check if paying with USDC directly
    if (request.tokenFrom === this.usdcMint) {
      return {
        quoteId,
        usdcAmount: request.amountUsdc,
        inputToken: request.tokenFrom,
        estimatedInputAmount: request.amountUsdc,
        maxInputAmount: request.amountUsdc,
        priceImpactPct: '0',
        expiresAt: Date.now() + 60000, // 1 minute
        route: {
          steps: 0,
          labels: ['Direct USDC Transfer'],
        },
      };
    }

    // Get Jupiter quote with ExactOut mode
    const quote = await jupiterService.quoteSwap({
      inputMint: request.tokenFrom,
      outputMint: this.usdcMint,
      amount: request.amountUsdc,
      slippageBps: 50, // Conservative 0.5% slippage for payments
      swapMode: 'ExactOut',
    });

    // Calculate max input with slippage buffer
    const estimatedInput = BigInt(quote.inAmount);
    const slippageMultiplier = 1.01; // 1% buffer
    const maxInput = BigInt(Math.ceil(Number(estimatedInput) * slippageMultiplier));

    return {
      quoteId,
      usdcAmount: request.amountUsdc,
      inputToken: request.tokenFrom,
      estimatedInputAmount: quote.inAmount,
      maxInputAmount: maxInput.toString(),
      priceImpactPct: quote.priceImpactPct,
      expiresAt: Date.now() + 30000, // 30 seconds
      route: {
        steps: quote.routePlan.length,
        labels: quote.routePlan.map(step => step.swapInfo.label),
      },
    };
  }

  /**
   * Execute a payment
   *
   * Creates the swap + transfer transaction for the payer to sign.
   */
  async executePayment(request: PaymentRequest): Promise<PaymentResult> {
    const paymentId = request.paymentId || uuidv4();
    const timestamp = Date.now();

    this.log.info(
      {
        paymentId,
        payer: request.payerPublicKey,
        merchant: request.merchantPublicKey,
        usdcAmount: request.amountUsdc,
      },
      'Executing payment'
    );

    try {
      // Validate payer balance
      const balance = await this.getTokenBalance(request.payerPublicKey, request.tokenFrom);

      // Get quote
      const quote = await this.getPaymentQuote(request);

      if (BigInt(balance) < BigInt(quote.maxInputAmount)) {
        throw new Error(`Insufficient balance: have ${balance}, need ${quote.maxInputAmount}`);
      }

      // Direct USDC transfer
      if (request.tokenFrom === this.usdcMint) {
        // For direct USDC, we just need a transfer instruction
        // The actual transfer would be handled differently
        return {
          paymentId,
          status: 'pending',
          usdcAmount: request.amountUsdc,
          inputAmount: request.amountUsdc,
          inputToken: request.tokenFrom,
          merchantPublicKey: request.merchantPublicKey,
          timestamp,
        };
      }

      // Get Jupiter quote for swap
      const jupiterQuote = await jupiterService.quoteSwap({
        inputMint: request.tokenFrom,
        outputMint: this.usdcMint,
        amount: request.amountUsdc,
        slippageBps: 50,
        swapMode: 'ExactOut',
      });

      // Get swap transaction
      const swap = await jupiterService.getSwapTransaction({
        quoteResponse: jupiterQuote,
        userPublicKey: request.payerPublicKey,
        wrapAndUnwrapSol: true,
      });

      let finalTransaction = swap.swapTransaction;
      let paymentRecordPda: string | undefined;
      let routeData: string | undefined;

      // Step: Inject FlowMint instruction if using on-chain program
      if (
        request.useFlowMintProgram &&
        request.payerInputAccount &&
        request.payerUsdcAccount &&
        request.merchantUsdcAccount
      ) {
        const payerPubkey = new PublicKey(request.payerPublicKey);
        const merchantPubkey = new PublicKey(request.merchantPublicKey);
        const routeBuffer = flowMintOnChainService.serializeRoute(jupiterQuote);
        routeData = routeBuffer.toString('base64');

        // Get payment record PDA for reference
        const txTimestamp = Math.floor(timestamp / 1000);
        const [recordPDA] = flowMintOnChainService.getPaymentRecordPDA(
          payerPubkey,
          merchantPubkey,
          txTimestamp
        );
        paymentRecordPda = recordPDA.toString();

        // Build FlowMint pay_any_token instruction
        const flowMintInstruction = flowMintOnChainService.buildPayAnyTokenInstruction({
          payer: payerPubkey,
          merchant: merchantPubkey,
          payerInputAccount: new PublicKey(request.payerInputAccount),
          payerUsdcAccount: new PublicKey(request.payerUsdcAccount),
          merchantUsdcAccount: new PublicKey(request.merchantUsdcAccount),
          inputMint: new PublicKey(request.tokenFrom),
          usdcMint: new PublicKey(this.usdcMint),
          jupiterProgram: new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
          amountIn: BigInt(jupiterQuote.inAmount),
          exactUsdcOut: BigInt(request.amountUsdc),
          memo: request.memo || null,
          jupiterAccounts: [], // Will be populated from Jupiter transaction
        });

        // Deserialize Jupiter transaction and inject FlowMint instruction
        const jupiterTx = jupiterService.deserializeTransaction(swap.swapTransaction);
        const wrappedTx = await flowMintOnChainService.injectFlowMintInstruction(
          jupiterTx,
          flowMintInstruction,
          payerPubkey
        );

        // Serialize the wrapped transaction
        finalTransaction = Buffer.from(wrappedTx.serialize()).toString('base64');

        this.log.info(
          { paymentRecordPda, routeDataLen: routeBuffer.length },
          'FlowMint payment instruction injected'
        );
      }

      // Save payment record
      const record: PaymentRecord = {
        paymentId,
        payerPublicKey: request.payerPublicKey,
        merchantPublicKey: request.merchantPublicKey,
        inputToken: request.tokenFrom,
        inputAmount: jupiterQuote.inAmount,
        usdcAmount: request.amountUsdc,
        memo: request.memo,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await this.db.savePayment(record);

      return {
        paymentId,
        status: 'pending',
        usdcAmount: request.amountUsdc,
        inputAmount: jupiterQuote.inAmount,
        inputToken: request.tokenFrom,
        merchantPublicKey: request.merchantPublicKey,
        transaction: finalTransaction,
        lastValidBlockHeight: swap.lastValidBlockHeight,
        timestamp,
        paymentRecordPda,
        routeData,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ paymentId, error }, 'Payment failed');

      return {
        paymentId,
        status: 'failed',
        usdcAmount: request.amountUsdc,
        inputAmount: '0',
        inputToken: request.tokenFrom,
        merchantPublicKey: request.merchantPublicKey,
        error: message,
        timestamp,
      };
    }
  }

  /**
   * Get token balance for an account
   */
  private async getTokenBalance(owner: string, mint: string): Promise<string> {
    try {
      const ownerPubkey = new PublicKey(owner);
      const mintPubkey = new PublicKey(mint);

      // For native SOL
      if (mint === KNOWN_TOKENS.WSOL) {
        const balance = await this.connection.getBalance(ownerPubkey);
        return balance.toString();
      }

      // For SPL tokens
      const accounts = await this.connection.getParsedTokenAccountsByOwner(ownerPubkey, {
        mint: mintPubkey,
      });

      if (accounts.value.length === 0) {
        return '0';
      }

      const tokenAccount = accounts.value[0];
      return tokenAccount.account.data.parsed.info.tokenAmount.amount;
    } catch (error) {
      this.log.error({ owner, mint, error }, 'Error getting token balance');
      return '0';
    }
  }

  /**
   * Update payment status after confirmation
   */
  async updatePaymentStatus(
    paymentId: string,
    status: 'success' | 'failed',
    txSignature?: string
  ): Promise<void> {
    await this.db.updatePaymentStatus(paymentId, status, txSignature);
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    return this.db.getPayment(paymentId);
  }

  /**
   * Get payments for a user (as payer or merchant)
   */
  async getUserPayments(publicKey: string): Promise<PaymentRecord[]> {
    return this.db.getUserPayments(publicKey);
  }

  /**
   * Generate a payment link
   */
  generatePaymentLink(params: {
    merchantPublicKey: string;
    amountUsdc: string;
    memo?: string;
  }): string {
    const baseUrl = config.apiBaseUrl;
    const queryParams = new URLSearchParams({
      merchant: params.merchantPublicKey,
      amount: params.amountUsdc,
    });

    if (params.memo) {
      queryParams.append('memo', params.memo);
    }

    return `${baseUrl}/pay?${queryParams.toString()}`;
  }
}
