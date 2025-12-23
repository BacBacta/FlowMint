/**
 * Payment API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import { PaymentService } from '../../services/paymentService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'payment' });

/**
 * Request validation schemas
 */
const paymentQuoteSchema = z.object({
  payerPublicKey: z.string().min(32).max(44),
  merchantPublicKey: z.string().min(32).max(44),
  amountUsdc: z.string().regex(/^\d+$/),
  tokenFrom: z.string().min(32).max(44),
});

const executePaymentSchema = z.object({
  payerPublicKey: z.string().min(32).max(44),
  merchantPublicKey: z.string().min(32).max(44),
  amountUsdc: z.string().regex(/^\d+$/),
  tokenFrom: z.string().min(32).max(44),
  memo: z.string().max(64).optional(),
});

const confirmPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  txSignature: z.string().min(64).max(100),
  success: z.boolean(),
});

/**
 * Create payment routes
 */
export function createPaymentRoutes(db: DatabaseService): Router {
  const router = Router();
  const paymentService = new PaymentService(db);

  /**
   * POST /api/v1/payments/quote
   *
   * Get a payment quote
   */
  router.post('/quote', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = paymentQuoteSchema.parse(req.body);

      log.info(
        {
          payer: body.payerPublicKey,
          merchant: body.merchantPublicKey,
          amountUsdc: body.amountUsdc,
        },
        'Payment quote request'
      );

      const quote = await paymentService.getPaymentQuote({
        payerPublicKey: body.payerPublicKey,
        merchantPublicKey: body.merchantPublicKey,
        amountUsdc: body.amountUsdc,
        tokenFrom: body.tokenFrom,
      });

      res.json({
        success: true,
        data: quote,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * POST /api/v1/payments
   *
   * Execute a payment
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = executePaymentSchema.parse(req.body);

      log.info(
        {
          payer: body.payerPublicKey,
          merchant: body.merchantPublicKey,
          amountUsdc: body.amountUsdc,
        },
        'Execute payment request'
      );

      const result = await paymentService.executePayment({
        payerPublicKey: body.payerPublicKey,
        merchantPublicKey: body.merchantPublicKey,
        amountUsdc: body.amountUsdc,
        tokenFrom: body.tokenFrom,
        memo: body.memo,
      });

      if (result.status === 'failed') {
        return res.status(400).json({
          success: false,
          error: result.error,
          paymentId: result.paymentId,
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * POST /api/v1/payments/confirm
   *
   * Confirm payment transaction result
   */
  router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = confirmPaymentSchema.parse(req.body);

      log.info({ paymentId: body.paymentId, success: body.success }, 'Confirm payment');

      await paymentService.updatePaymentStatus(
        body.paymentId,
        body.success ? 'success' : 'failed',
        body.txSignature
      );

      res.json({
        success: true,
        data: {
          paymentId: body.paymentId,
          status: body.success ? 'success' : 'failed',
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * GET /api/v1/payments/:id
   *
   * Get a payment by ID
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payment = await paymentService.getPayment(req.params.id);

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found',
        });
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/payments/user/:publicKey
   *
   * Get user's payments
   */
  router.get('/user/:publicKey', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payments = await paymentService.getUserPayments(req.params.publicKey);

      res.json({
        success: true,
        data: payments,
        count: payments.length,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/payments/link
   *
   * Generate a payment link
   */
  router.post('/link', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          merchantPublicKey: z.string().min(32).max(44),
          amountUsdc: z.string().regex(/^\d+$/),
          memo: z.string().max(64).optional(),
        })
        .parse(req.body);

      const link = paymentService.generatePaymentLink({
        merchantPublicKey: body.merchantPublicKey,
        amountUsdc: body.amountUsdc,
        memo: body.memo,
      });

      res.json({
        success: true,
        data: {
          link,
          merchantPublicKey: body.merchantPublicKey,
          amountUsdc: body.amountUsdc,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  return router;
}
