/**
 * Payment Service
 *
 * Handles "pay any token → USDC" payment processing.
 */

import { PublicKey, Connection } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config/index.js';
import { KNOWN_TOKENS } from '../config/risk-policies.js';
import { logger } from '../utils/logger.js';
import { jupiterService } from './jupiterService.js';
import { flowMintOnChainService } from './flowMintOnChain.js';
import { DatabaseService } from '../db/database.js';

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
 * Payment Service
 *
 * Manages payment processing with token conversion to USDC.
 */
export class PaymentService {
  private readonly log = logger.child({ service: 'PaymentService' });
  private readonly connection: Connection;
  private readonly usdcMint: string;

  constructor(private readonly db: DatabaseService) {
    this.connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
    this.usdcMint =
      config.solana.network === 'mainnet-beta' ? KNOWN_TOKENS.USDC : KNOWN_TOKENS.USDC;

    this.log.info('PaymentService initialized');
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
        labels: quote.routePlan.map((step) => step.swapInfo.label),
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
      const balance = await this.getTokenBalance(
        request.payerPublicKey,
        request.tokenFrom
      );

      // Get quote
      const quote = await this.getPaymentQuote(request);

      if (BigInt(balance) < BigInt(quote.maxInputAmount)) {
        throw new Error(
          `Insufficient balance: have ${balance}, need ${quote.maxInputAmount}`
        );
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
      if (request.useFlowMintProgram && request.payerInputAccount && request.payerUsdcAccount && request.merchantUsdcAccount) {
        const payerPubkey = new PublicKey(request.payerPublicKey);
        const merchantPubkey = new PublicKey(request.merchantPublicKey);
        const routeBuffer = flowMintOnChainService.serializeRoute(jupiterQuote);
        routeData = routeBuffer.toString('base64');

        // Get payment record PDA for reference
        const txTimestamp = Math.floor(timestamp / 1000);
        const [recordPDA] = flowMintOnChainService.getPaymentRecordPDA(payerPubkey, merchantPubkey, txTimestamp);
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
