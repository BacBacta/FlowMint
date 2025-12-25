/**
 * PortfolioPay V1 API Routes
 *
 * Invoice management, payment quotes, and attestation verification.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { Keypair, Connection } from '@solana/web3.js';

import { logger } from '../utils/logger.js';
import { DatabaseService } from '../db/database.js';
import { InvoiceService, CreateInvoiceParams } from '../services/invoiceService.js';
import { AttestationService } from '../services/attestationService.js';
import { RelayerService } from '../services/relayerService.js';
import { PaymentService, ExtendedPaymentQuote } from '../services/paymentService.js';
import { config } from '../config/index.js';

const log = logger.child({ module: 'portfoliopay-routes' });

// Initialize services
let db: DatabaseService;
let invoiceService: InvoiceService;
let attestationService: AttestationService;
let relayerService: RelayerService;
let paymentService: PaymentService;
let signerKeypair: Keypair;

/**
 * Initialize PortfolioPay services
 */
export async function initPortfolioPayServices(database: DatabaseService): Promise<void> {
  db = database;
  
  // Create signer keypair for attestations
  // In production, load from secure storage
  const signerSecret = process.env.ATTESTATION_SIGNER_KEY;
  if (signerSecret) {
    try {
      const secretKey = Uint8Array.from(JSON.parse(signerSecret));
      signerKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      log.warn('Invalid ATTESTATION_SIGNER_KEY, generating ephemeral keypair');
      signerKeypair = Keypair.generate();
    }
  } else {
    log.warn('No ATTESTATION_SIGNER_KEY set, generating ephemeral keypair');
    signerKeypair = Keypair.generate();
  }

  // Initialize services
  invoiceService = new InvoiceService(db);
  attestationService = new AttestationService(db, process.env.BASE_URL);
  
  const connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
  
  // Relayer keypair (optional)
  let relayerKeypair: Keypair | undefined;
  const relayerSecret = process.env.RELAYER_PRIVATE_KEY;
  if (relayerSecret) {
    try {
      const secretKey = Uint8Array.from(JSON.parse(relayerSecret));
      relayerKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      log.warn('Invalid RELAYER_PRIVATE_KEY');
    }
  }
  
  relayerService = new RelayerService(connection, db, relayerKeypair);
  
  paymentService = new PaymentService(db);
  paymentService.setServices({
    invoiceService,
    attestationService,
    relayerService,
    signerKeypair,
  });

  log.info({
    attestationSigner: signerKeypair.publicKey.toBase58(),
    relayerConfigured: !!relayerKeypair,
  }, 'PortfolioPay services initialized');
}

/**
 * Create PortfolioPay router
 */
export function createPortfolioPayRouter(): Router {
  const router = Router();

  // ==================== Merchant Routes ====================

  /**
   * POST /api/v1/merchants
   * Register a new merchant
   */
  router.post('/merchants', async (req: Request, res: Response) => {
    try {
      const { name, settleMint, webhookUrl } = req.body;

      if (!name || !settleMint) {
        return res.status(400).json({ error: 'name and settleMint required' });
      }

      // Generate API key
      const apiKey = uuidv4();
      const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

      const merchant = {
        id: uuidv4(),
        name,
        settleMint,
        webhookUrl,
        apiKeyHash,
        status: 'active' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.saveMerchant(merchant);

      log.info({ merchantId: merchant.id, name }, 'Merchant created');

      res.status(201).json({
        id: merchant.id,
        name: merchant.name,
        settleMint: merchant.settleMint,
        apiKey, // Only returned once!
        webhookUrl: merchant.webhookUrl,
        status: merchant.status,
        createdAt: merchant.createdAt,
      });
    } catch (error) {
      log.error({ error }, 'Failed to create merchant');
      res.status(500).json({ error: 'Failed to create merchant' });
    }
  });

  /**
   * GET /api/v1/merchants/:id
   * Get merchant details
   */
  router.get('/merchants/:id', async (req: Request, res: Response) => {
    try {
      const merchant = await db.getMerchant(req.params.id);

      if (!merchant) {
        return res.status(404).json({ error: 'Merchant not found' });
      }

      res.json({
        id: merchant.id,
        name: merchant.name,
        settleMint: merchant.settleMint,
        webhookUrl: merchant.webhookUrl,
        status: merchant.status,
        createdAt: merchant.createdAt,
      });
    } catch (error) {
      log.error({ error }, 'Failed to get merchant');
      res.status(500).json({ error: 'Failed to get merchant' });
    }
  });

  // ==================== Policy Routes ====================

  /**
   * POST /api/v1/policies
   * Create a payment policy
   */
  router.post('/policies', async (req: Request, res: Response) => {
    try {
      const {
        merchantId,
        name,
        maxSlippageBps = 100,
        maxPriceImpactBps = 300,
        maxHops = 4,
        protectedMode = true,
        allowedTokens,
        deniedTokens,
      } = req.body;

      if (!merchantId || !name) {
        return res.status(400).json({ error: 'merchantId and name required' });
      }

      // Verify merchant exists
      const merchant = await db.getMerchant(merchantId);
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant not found' });
      }

      // Build canonical JSON for hashing
      const jsonCanonical = JSON.stringify({
        merchantId,
        maxSlippageBps,
        maxPriceImpactBps,
        maxHops,
        protectedMode,
        allowedTokens: allowedTokens?.sort() || [],
        deniedTokens: deniedTokens?.sort() || [],
      });

      const hash = crypto.createHash('sha256').update(jsonCanonical).digest('hex');

      // Check for existing policy with same hash
      const existingPolicy = await db.getPolicyByHash(hash);
      if (existingPolicy) {
        return res.json(existingPolicy);
      }

      const policy = {
        id: uuidv4(),
        merchantId,
        name,
        jsonCanonical,
        hash,
        version: 1,
        maxSlippageBps,
        maxPriceImpactBps,
        maxHops,
        protectedMode,
        allowedTokens,
        deniedTokens,
        createdAt: Date.now(),
      };

      await db.savePolicy(policy);

      log.info({ policyId: policy.id, merchantId, hash }, 'Policy created');

      res.status(201).json(policy);
    } catch (error) {
      log.error({ error }, 'Failed to create policy');
      res.status(500).json({ error: 'Failed to create policy' });
    }
  });

  /**
   * GET /api/v1/policies/:id
   * Get policy by ID
   */
  router.get('/policies/:id', async (req: Request, res: Response) => {
    try {
      const policy = await db.getPolicy(req.params.id);

      if (!policy) {
        return res.status(404).json({ error: 'Policy not found' });
      }

      res.json(policy);
    } catch (error) {
      log.error({ error }, 'Failed to get policy');
      res.status(500).json({ error: 'Failed to get policy' });
    }
  });

  // ==================== Invoice Routes ====================

  /**
   * POST /api/v1/invoices
   * Create a new invoice
   */
  router.post('/invoices', async (req: Request, res: Response) => {
    try {
      const {
        merchantId,
        settleMint,
        amountOut,
        orderId,
        policyId,
        expiresInMs,
        idempotencyKey,
      } = req.body;

      if (!merchantId || !settleMint || !amountOut) {
        return res.status(400).json({
          error: 'merchantId, settleMint, and amountOut required',
        });
      }

      const params: CreateInvoiceParams = {
        merchantId,
        settleMint,
        amountOut,
        orderId,
        policyId,
        expiresInMs,
        idempotencyKey,
      };

      const invoice = await invoiceService.createInvoice(params);

      log.info({ invoiceId: invoice.id, merchantId, amountOut }, 'Invoice created');

      res.status(201).json(invoice);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to create invoice');
      res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/invoices/:id
   * Get invoice details
   */
  router.get('/invoices/:id', async (req: Request, res: Response) => {
    try {
      const includeRelated = req.query.include === 'related';
      const result = await invoiceService.getInvoice(req.params.id, includeRelated);

      if (!result) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      res.json(result);
    } catch (error) {
      log.error({ error }, 'Failed to get invoice');
      res.status(500).json({ error: 'Failed to get invoice' });
    }
  });

  /**
   * POST /api/v1/invoices/:id/cancel
   * Cancel an invoice
   */
  router.post('/invoices/:id/cancel', async (req: Request, res: Response) => {
    try {
      const invoice = await invoiceService.cancelInvoice(req.params.id);
      res.json(invoice);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to cancel invoice');
      res.status(400).json({ error: message });
    }
  });

  // ==================== Payment Routes ====================

  /**
   * POST /api/v1/payments/quote
   * Get a payment quote for an invoice
   */
  router.post('/payments/quote', async (req: Request, res: Response) => {
    try {
      const { invoiceId, payerPublicKey, payMint } = req.body;

      if (!invoiceId || !payerPublicKey || !payMint) {
        return res.status(400).json({
          error: 'invoiceId, payerPublicKey, and payMint required',
        });
      }

      // Validate invoice is payable
      const validation = await invoiceService.validatePayable(invoiceId, payerPublicKey);
      if (!validation.valid || !validation.invoice) {
        return res.status(400).json({ error: validation.error });
      }

      const invoice = validation.invoice;

      // Get policy if exists
      let policy;
      if (invoice.policyId) {
        policy = await db.getPolicy(invoice.policyId);
      }

      // Reserve invoice for payer
      await invoiceService.reserveForPayer({ invoiceId, payerPublicKey });

      // Get quote with ExactOut fallback
      const quote = await paymentService.getExtendedQuote(
        payerPublicKey,
        payMint,
        invoice.settleMint,
        invoice.amountOut,
        policy
      );

      // Save quote for tracking
      await paymentService.saveQuote(quote, invoiceId, payerPublicKey);

      log.info({
        invoiceId,
        quoteId: quote.quoteId,
        mode: quote.mode,
        gasless: quote.gaslessEligible,
      }, 'Payment quote generated');

      res.json({
        quoteId: quote.quoteId,
        invoiceId,
        mode: quote.mode,
        payMint,
        settleMint: invoice.settleMint,
        amountOut: invoice.amountOut,
        estimatedAmountIn: quote.estimatedInputAmount,
        maxAmountIn: quote.maxInputAmount,
        refundAmount: quote.refundAmount,
        priceImpactPct: quote.priceImpactPct,
        route: quote.route,
        risk: quote.risk,
        gaslessEligible: quote.gaslessEligible,
        expiresAt: quote.expiresAt,
        ttlMs: quote.ttlMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to get payment quote');
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/payments/quote-multi
   * Get a multi-token split payment quote (V1.5)
   * Allows paying with up to 2 tokens combined
   */
  router.post('/payments/quote-multi', async (req: Request, res: Response) => {
    try {
      const {
        invoiceId,
        payerPublicKey,
        payMints,
        maxLegs = 2,
        strategy = 'min-risk',
      } = req.body;

      // Validate inputs
      if (!invoiceId || !payerPublicKey || !Array.isArray(payMints) || payMints.length === 0) {
        return res.status(400).json({
          error: 'invoiceId, payerPublicKey, and payMints[] required',
        });
      }

      if (payMints.length > 2) {
        return res.status(400).json({
          error: 'Maximum 2 tokens allowed',
        });
      }

      if (!['min-risk', 'min-slippage', 'min-failure'].includes(strategy)) {
        return res.status(400).json({
          error: 'Invalid strategy. Use: min-risk, min-slippage, or min-failure',
        });
      }

      // Validate invoice is payable
      const validation = await invoiceService.validatePayable(invoiceId, payerPublicKey);
      if (!validation.valid || !validation.invoice) {
        return res.status(400).json({ error: validation.error });
      }

      const invoice = validation.invoice;

      // Check for existing active reservation
      const existingReservation = await db.getReservationByInvoice(invoiceId);
      if (existingReservation && existingReservation.status === 'active') {
        if (existingReservation.payer !== payerPublicKey) {
          return res.status(409).json({
            error: 'Invoice is reserved by another payer',
          });
        }
        // Return existing reservation
        return res.json({
          reservationId: existingReservation.id,
          plan: JSON.parse(existingReservation.planJson),
          expiresAt: existingReservation.expiresAt,
          status: existingReservation.status,
        });
      }

      // Get policy if exists
      let policy;
      if (invoice.policyId) {
        policy = await db.getPolicy(invoice.policyId);
      }

      // Get planner (lazy init)
      const { createSplitTenderPlanner } = await import('../services/splitTenderPlanner.js');
      const connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
      const planner = createSplitTenderPlanner(connection, db);

      // Get user balances
      const balances = await planner.getUserBalances(payerPublicKey, payMints);

      // Plan the split payment
      const planResult = await planner.plan({
        invoiceId,
        payerPublicKey,
        payMints,
        amountOut: invoice.amountOut,
        settleMint: invoice.settleMint,
        strategy: strategy as 'min-risk' | 'min-slippage' | 'min-failure',
        policy: policy ?? undefined,
        balances,
      });

      if (!planResult.success || !planResult.plan) {
        return res.status(400).json({
          error: planResult.error || 'Could not plan split payment',
        });
      }

      // Create reservation and legs
      const { reservation, legs } = await planner.createReservation(
        invoiceId,
        payerPublicKey,
        planResult.plan
      );

      log.info({
        invoiceId,
        reservationId: reservation.id,
        strategy,
        legsCount: legs.length,
        totalExpectedUsdc: planResult.plan.totalExpectedUsdcOut,
      }, 'Multi-token quote generated');

      res.json({
        reservationId: reservation.id,
        invoiceId,
        payer: payerPublicKey,
        strategy: planResult.plan.strategy,
        legs: planResult.plan.legs.map((leg, idx) => ({
          legIndex: idx,
          payMint: leg.payMint,
          amountIn: leg.amountIn,
          expectedUsdcOut: leg.expectedUsdcOut,
          priceImpactPct: (leg.priceImpactBps / 100).toFixed(2),
          risk: leg.risk,
        })),
        totalAmountIn: planResult.plan.totalAmountIn,
        totalExpectedUsdcOut: planResult.plan.totalExpectedUsdcOut,
        settlementAmount: planResult.plan.settlementAmount,
        refundPolicy: planResult.plan.refundPolicy,
        aggregateRisk: planResult.plan.aggregateRisk,
        estimatedDurationMs: planResult.plan.estimatedDurationMs,
        expiresAt: reservation.expiresAt,
        status: reservation.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to get multi-token quote');
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/payments/execute-leg
   * Execute a single leg of a split payment (V1.5)
   */
  router.post('/payments/execute-leg', async (req: Request, res: Response) => {
    try {
      const { reservationId, legIndex, signedTransaction } = req.body;

      if (!reservationId || legIndex === undefined) {
        return res.status(400).json({
          error: 'reservationId and legIndex required',
        });
      }

      // Get reservation
      const reservation = await db.getInvoiceReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      if (reservation.status !== 'active') {
        return res.status(400).json({
          error: `Reservation is ${reservation.status}`,
        });
      }

      if (Date.now() > reservation.expiresAt) {
        await db.updateInvoiceReservation(reservationId, { status: 'expired' });
        return res.status(400).json({ error: 'Reservation expired' });
      }

      // Get legs
      const legs = await db.getLegsByReservation(reservationId);
      const leg = legs.find((l) => l.legIndex === legIndex);

      if (!leg) {
        return res.status(404).json({
          error: `Leg ${legIndex} not found`,
        });
      }

      if (leg.status === 'completed') {
        return res.status(400).json({
          error: 'Leg already completed',
          txSignature: leg.txSignature,
        });
      }

      // Validate leg order (must execute in sequence)
      const previousLeg = legs.find((l) => l.legIndex === legIndex - 1);
      if (previousLeg && previousLeg.status !== 'completed') {
        return res.status(400).json({
          error: `Previous leg ${legIndex - 1} must be completed first`,
        });
      }

      // Execute leg
      const { createSplitTenderExecutor } = await import('../services/splitTenderExecutor.js');
      const connection = new Connection(config.solana.rpcUrl, config.solana.commitment);
      const executor = createSplitTenderExecutor(connection, db);

      const result = await executor.executeLeg({
        leg,
        reservation,
        payerPublicKey: reservation.payer,
        signedTransaction,
      });

      if (result.success) {
        log.info({
          reservationId,
          legIndex,
          txSignature: result.txSignature,
        }, 'Leg executed successfully');

        // Check if all legs complete
        const progress = await executor.getProgress(reservationId);

        res.json({
          success: true,
          legIndex,
          txSignature: result.txSignature,
          actualUsdcOut: result.actualUsdcOut,
          progress,
        });
      } else {
        log.warn({
          reservationId,
          legIndex,
          error: result.error,
          shouldRetry: result.shouldRetry,
        }, 'Leg execution failed');

        res.status(400).json({
          success: false,
          legIndex,
          error: result.error,
          shouldRetry: result.shouldRetry,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to execute leg');
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/payments/reservation/:reservationId/progress
   * Get progress of a split payment reservation (V1.5)
   */
  router.get('/payments/reservation/:reservationId/progress', async (req: Request, res: Response) => {
    try {
      const { reservationId } = req.params;

      const reservation = await db.getInvoiceReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      const legs = await db.getLegsByReservation(reservationId);
      const plan = JSON.parse(reservation.planJson);

      const percentComplete = reservation.totalLegs > 0
        ? Math.round((reservation.completedLegs / reservation.totalLegs) * 100)
        : 0;

      res.json({
        reservationId,
        invoiceId: reservation.invoiceId,
        payer: reservation.payer,
        strategy: reservation.strategy,
        status: reservation.status,
        totalLegs: reservation.totalLegs,
        completedLegs: reservation.completedLegs,
        usdcCollected: reservation.usdcCollected,
        targetAmount: plan.settlementAmount,
        percentComplete,
        expiresAt: reservation.expiresAt,
        isExpired: Date.now() > reservation.expiresAt,
        legs: legs.map((leg) => ({
          legIndex: leg.legIndex,
          payMint: leg.payMint,
          amountIn: leg.amountIn,
          expectedUsdcOut: leg.expectedUsdcOut,
          actualUsdcOut: leg.actualUsdcOut,
          status: leg.status,
          txSignature: leg.txSignature,
          errorMessage: leg.errorMessage,
          retryCount: leg.retryCount,
          maxRetries: leg.maxRetries,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to get reservation progress');
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/payments/build
   * Build a payment transaction
   */
  router.post('/payments/build', async (req: Request, res: Response) => {
    try {
      const { quoteId, payerPublicKey } = req.body;

      if (!quoteId || !payerPublicKey) {
        return res.status(400).json({
          error: 'quoteId and payerPublicKey required',
        });
      }

      // Get quote from database
      const quote = await db.getPaymentQuote(quoteId);
      if (!quote) {
        return res.status(404).json({ error: 'Quote not found' });
      }

      // Check quote expiry
      if (quote.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Quote expired' });
      }

      // Get invoice
      const invoice = await db.getInvoice(quote.invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      // Extend reservation
      await invoiceService.extendReservation(quote.invoiceId, payerPublicKey);

      // Build transaction using payment service
      const paymentResult = await paymentService.executePayment({
        paymentId: quote.invoiceId,
        payerPublicKey,
        merchantPublicKey: invoice.merchantId, // Would need merchant wallet
        amountUsdc: invoice.amountOut,
        tokenFrom: quote.payMint,
      });

      if (paymentResult.status === 'failed') {
        return res.status(400).json({ error: paymentResult.error });
      }

      // Record payment attempt
      await db.savePaymentAttempt({
        invoiceId: quote.invoiceId,
        quoteId,
        attemptNo: 1,
        eventType: 'build',
        mode: quote.requiresGasless ? 'gasless' : 'normal',
        createdAt: Date.now(),
      });

      res.json({
        invoiceId: quote.invoiceId,
        quoteId,
        transaction: paymentResult.transaction,
        lastValidBlockHeight: paymentResult.lastValidBlockHeight,
        requiresGasless: quote.requiresGasless,
        message: 'Sign and submit transaction',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to build payment transaction');
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/payments/confirm
   * Confirm a payment was submitted
   */
  router.post('/payments/confirm', async (req: Request, res: Response) => {
    try {
      const { invoiceId, txSignature } = req.body;

      if (!invoiceId || !txSignature) {
        return res.status(400).json({
          error: 'invoiceId and txSignature required',
        });
      }

      // Mark invoice as paid
      const invoice = await invoiceService.markPaid({ invoiceId, txSignature });

      // Record confirmation attempt
      await db.savePaymentAttempt({
        invoiceId,
        attemptNo: 1,
        eventType: 'confirm',
        signature: txSignature,
        status: 'confirmed',
        createdAt: Date.now(),
      });

      log.info({ invoiceId, txSignature }, 'Payment confirmed');

      res.json({
        invoiceId,
        status: 'paid',
        txSignature,
        paidAt: invoice.paidAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to confirm payment');
      res.status(400).json({ error: message });
    }
  });

  // ==================== Relayer Routes ====================

  /**
   * POST /api/v1/relayer/submit
   * Submit a gasless transaction
   */
  router.post('/relayer/submit', async (req: Request, res: Response) => {
    try {
      const { invoiceId, payerPublicKey, signedTransaction } = req.body;

      if (!invoiceId || !payerPublicKey || !signedTransaction) {
        return res.status(400).json({
          error: 'invoiceId, payerPublicKey, and signedTransaction required',
        });
      }

      // Verify invoice exists and is reserved
      const invoice = await db.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      if (invoice.payerPublicKey !== payerPublicKey) {
        return res.status(400).json({ error: 'Invoice not reserved for this payer' });
      }

      // Get relayer keypair from environment
      let relayerKeypair: Keypair | undefined;
      const relayerSecret = process.env.RELAYER_PRIVATE_KEY;
      if (relayerSecret) {
        try {
          const secretKey = Uint8Array.from(JSON.parse(relayerSecret));
          relayerKeypair = Keypair.fromSecretKey(secretKey);
        } catch {
          log.error('Invalid RELAYER_PRIVATE_KEY');
        }
      }

      if (!relayerKeypair) {
        return res.status(503).json({ error: 'Gasless relay not available' });
      }

      // Submit gasless transaction
      const result = await relayerService.submitGasless({
        invoiceId,
        payer: payerPublicKey,
        signedTransaction,
        relayerKeypair,
      });

      if (!result.success) {
        // Record failed attempt
        await db.savePaymentAttempt({
          invoiceId,
          attemptNo: 1,
          eventType: 'gasless_submit',
          mode: 'gasless',
          status: 'failed',
          errorMessage: result.error,
          createdAt: Date.now(),
        });

        return res.status(400).json({
          error: result.error,
          submissionId: result.submissionId,
        });
      }

      // Record successful submission
      await db.savePaymentAttempt({
        invoiceId,
        attemptNo: 1,
        eventType: 'gasless_submit',
        mode: 'gasless',
        signature: result.signature,
        status: 'submitted',
        createdAt: Date.now(),
      });

      log.info({
        invoiceId,
        submissionId: result.submissionId,
        signature: result.signature,
      }, 'Gasless transaction submitted');

      res.json({
        success: true,
        submissionId: result.submissionId,
        signature: result.signature,
        message: 'Transaction submitted, awaiting confirmation',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error }, 'Failed to submit gasless transaction');
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/relayer/status/:submissionId
   * Check gasless submission status
   */
  router.get('/relayer/status/:submissionId', async (req: Request, res: Response) => {
    try {
      const submission = await relayerService.getSubmission(req.params.submissionId);

      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      res.json({
        submissionId: submission.id,
        invoiceId: submission.invoiceId,
        status: submission.status,
        signature: submission.signature,
        error: submission.error,
        confirmedAt: submission.confirmedAt,
      });
    } catch (error) {
      log.error({ error }, 'Failed to get submission status');
      res.status(500).json({ error: 'Failed to get submission status' });
    }
  });

  /**
   * GET /api/v1/relayer/eligibility
   * Check gasless eligibility
   */
  router.get('/relayer/eligibility', async (req: Request, res: Response) => {
    try {
      const { payerPublicKey, payMint } = req.query;

      if (!payerPublicKey || !payMint) {
        return res.status(400).json({
          error: 'payerPublicKey and payMint query params required',
        });
      }

      const eligibility = await relayerService.checkGaslessEligibility(
        payerPublicKey as string,
        payMint as string
      );

      res.json(eligibility);
    } catch (error) {
      log.error({ error }, 'Failed to check eligibility');
      res.status(500).json({ error: 'Failed to check eligibility' });
    }
  });

  // ==================== Attestation Routes ====================

  /**
   * GET /api/v1/attestations/:id
   * Get attestation details
   */
  router.get('/attestations/:id', async (req: Request, res: Response) => {
    try {
      const attestation = await attestationService.getAttestation(req.params.id);

      if (!attestation) {
        return res.status(404).json({ error: 'Attestation not found' });
      }

      res.json(attestationService.buildAttestationSummary(attestation));
    } catch (error) {
      log.error({ error }, 'Failed to get attestation');
      res.status(500).json({ error: 'Failed to get attestation' });
    }
  });

  /**
   * GET /api/v1/attestations/:id/verify
   * Verify an attestation
   */
  router.get('/attestations/:id/verify', async (req: Request, res: Response) => {
    try {
      const result = await attestationService.verifyAttestation(req.params.id);

      res.json({
        valid: result.valid,
        errors: result.errors,
        attestation: result.attestation
          ? attestationService.buildAttestationSummary(result.attestation)
          : undefined,
      });
    } catch (error) {
      log.error({ error }, 'Failed to verify attestation');
      res.status(500).json({ error: 'Failed to verify attestation' });
    }
  });

  /**
   * GET /api/v1/invoices/:id/attestation
   * Get attestation for an invoice
   */
  router.get('/invoices/:id/attestation', async (req: Request, res: Response) => {
    try {
      const attestation = await attestationService.getAttestationByInvoice(req.params.id);

      if (!attestation) {
        return res.status(404).json({ error: 'Attestation not found for invoice' });
      }

      res.json(attestationService.buildAttestationSummary(attestation));
    } catch (error) {
      log.error({ error }, 'Failed to get invoice attestation');
      res.status(500).json({ error: 'Failed to get invoice attestation' });
    }
  });

  // ==================== Health & Info ====================

  /**
   * GET /api/v1/portfoliopay/info
   * Get PortfolioPay service info
   */
  router.get('/portfoliopay/info', async (_req: Request, res: Response) => {
    res.json({
      version: '1.0.0',
      features: {
        gasless: true,
        attestation: true,
        exactOutFallback: true,
      },
      limits: {
        quoteTtlMs: 15000,
        maxHops: 4,
        maxPriceImpactBps: 300,
      },
      gaslessAllowlist: relayerService.getGaslessAllowlist(),
      attestationSigner: signerKeypair?.publicKey.toBase58(),
    });
  });

  return router;
}

export { invoiceService, attestationService, relayerService, paymentService };
