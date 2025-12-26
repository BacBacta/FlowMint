/**
 * Payment API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { DatabaseService, type PaymentLinkRecord } from '../../db/database.js';
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

const createPaymentLinkSchema = z
  .object({
    // Historically called merchantId, but it's actually a Solana address (public key).
    merchantId: z.string().optional(),
    merchantPublicKey: z.string().optional(),
    orderId: z.string().min(1).max(64),
    amountUsdc: z.union([z.number().positive(), z.string().min(1)]),
  })
  .superRefine((value, ctx) => {
    const merchant = value.merchantPublicKey ?? value.merchantId;
    if (!merchant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'merchantId is required',
        path: ['merchantId'],
      });
      return;
    }
    if (merchant.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        type: 'string',
        inclusive: true,
        minimum: 32,
        message: 'String must contain at least 32 character(s)',
        path: ['merchantId'],
      });
    }
    if (merchant.length > 44) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: 'string',
        inclusive: true,
        maximum: 44,
        message: 'String must contain at most 44 character(s)',
        path: ['merchantId'],
      });
    }
  })
  .transform(value => ({
    merchantId: (value.merchantPublicKey ?? value.merchantId)!,
    orderId: value.orderId,
    amountUsdc: value.amountUsdc,
  }));

const executePaymentByIdSchema = z.object({
  payerPublicKey: z.string().min(32).max(44),
  payerMint: z.string().min(32).max(44),
});

const confirmPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  txSignature: z.string().min(64).max(100),
  success: z.boolean(),
});

function toUsdcBaseUnits(amount: number | string): string {
  const parsed = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid amountUsdc');
  }
  const units = Math.round(parsed * 1_000_000);
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error('Invalid amountUsdc');
  }
  return String(units);
}

function formatUsdc(baseUnits: string): string {
  const value = BigInt(baseUnits);
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

function mapPaymentStatus(status: string): 'pending' | 'completed' | 'failed' {
  if (status === 'success') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

/**
 * Create payment routes
 */
export function createPaymentRoutes(db: DatabaseService): Router {
  const router = Router();
  const paymentService = new PaymentService(db);

  /**
   * POST /api/v1/payments/create-link
   *
   * Create an invoice-style payment link.
   */
  router.post('/create-link', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createPaymentLinkSchema.parse(req.body);
      const now = Date.now();
      const amountUsdc = toUsdcBaseUnits(body.amountUsdc);

      // Check if a payment link with the same orderId already exists for this merchant
      const existingLink = await db.getPaymentLinkByOrderId(body.merchantId, body.orderId);
      if (existingLink) {
        // If the existing link is still pending and not expired, return it
        if (existingLink.status === 'pending' && existingLink.expiresAt > now) {
          return res.json({
            success: true,
            data: {
              paymentId: existingLink.paymentId,
              merchantId: existingLink.merchantId,
              orderId: existingLink.orderId,
              amountUsdc: formatUsdc(existingLink.amountUsdc),
              expiresAt: existingLink.expiresAt,
              message: 'Existing payment link returned',
            },
          });
        }
        // If the existing link is completed, reject the creation
        if (existingLink.status === 'completed') {
          return res.status(409).json({
            success: false,
            error: `Order ID "${body.orderId}" has already been paid`,
          });
        }
        // If the existing link is expired or failed, allow creation of a new one
        // (we'll create a new payment link below)
      }

      const paymentId = uuidv4();
      const expiresAt = now + 30 * 60 * 1000; // 30 minutes

      const record: PaymentLinkRecord = {
        paymentId,
        merchantId: body.merchantId,
        orderId: body.orderId,
        amountUsdc,
        status: 'pending',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };

      await db.savePaymentLink(record);

      res.json({
        success: true,
        data: {
          paymentId,
          merchantId: body.merchantId,
          orderId: body.orderId,
          amountUsdc: formatUsdc(amountUsdc),
          expiresAt,
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
   * POST /api/v1/payments/:paymentId/execute
   *
   * Execute a payment for a previously created invoice.
   */
  router.post('/:paymentId/execute', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = executePaymentByIdSchema.parse(req.body);
      const paymentId = req.params.paymentId;

      const link = await db.getPaymentLink(paymentId);
      if (!link) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found',
        });
      }

      if (Date.now() > link.expiresAt) {
        await db.updatePaymentLinkStatus(paymentId, 'expired');
        return res.status(410).json({
          success: false,
          error: 'Payment expired',
        });
      }

      const result = await paymentService.executePayment({
        paymentId,
        payerPublicKey: body.payerPublicKey,
        merchantPublicKey: link.merchantId,
        amountUsdc: link.amountUsdc,
        tokenFrom: body.payerMint,
        memo: link.orderId,
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

      const link = await db.getPaymentLink(body.paymentId);
      if (link) {
        await db.updatePaymentLinkStatus(body.paymentId, body.success ? 'completed' : 'failed');
      }

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
   * GET /api/v1/payments/:id
   *
   * Get a payment by ID
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const [link, payment] = await Promise.all([
        db.getPaymentLink(id),
        paymentService.getPayment(id),
      ]);

      if (!link && !payment) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found',
        });
      }

      if (link) {
        const now = Date.now();
        let status: 'pending' | 'completed' | 'failed' | 'expired' = 'pending';
        if (payment?.status) {
          status = mapPaymentStatus(payment.status);
        } else if (
          link.status === 'completed' ||
          link.status === 'failed' ||
          link.status === 'expired'
        ) {
          status = link.status;
        }

        if (status === 'pending' && now > link.expiresAt) {
          status = 'expired';
        }

        return res.json({
          success: true,
          data: {
            paymentId: link.paymentId,
            merchantId: link.merchantId,
            orderId: link.orderId,
            amountUsdc: formatUsdc(link.amountUsdc),
            status,
            expiresAt: link.expiresAt,
            txSignature: payment?.txSignature,
          },
        });
      }

      // Fallback: payment exists without a link
      res.json({
        success: true,
        data: {
          paymentId: payment!.paymentId,
          merchantId: payment!.merchantPublicKey,
          amountUsdc: formatUsdc(payment!.usdcAmount),
          status: mapPaymentStatus(payment!.status),
          txSignature: payment!.txSignature,
        },
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

  /**
   * GET /api/v1/payments/merchant/:merchantId/orders
   *
   * Get all payment links (orders) for a merchant
   */
  router.get('/merchant/:merchantId/orders', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { merchantId } = req.params;
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      if (!merchantId || merchantId.length < 32) {
        return res.status(400).json({
          success: false,
          error: 'Invalid merchant ID',
        });
      }

      const { links, total } = await db.getPaymentLinksByMerchant(merchantId, {
        status,
        limit,
        offset,
      });

      // Calculate stats
      const stats = {
        total,
        pending: links.filter(l => l.status === 'pending').length,
        completed: links.filter(l => l.status === 'completed').length,
        expired: links.filter(l => l.status === 'expired' || l.expiresAt < Date.now()).length,
        totalAmount: links
          .filter(l => l.status === 'completed')
          .reduce((sum, l) => sum + BigInt(l.amountUsdc), 0n)
          .toString(),
      };

      res.json({
        success: true,
        data: {
          orders: links.map(link => ({
            paymentId: link.paymentId,
            orderId: link.orderId,
            amountUsdc: formatUsdc(link.amountUsdc),
            status: link.expiresAt < Date.now() && link.status === 'pending' ? 'expired' : link.status,
            createdAt: link.createdAt,
            expiresAt: link.expiresAt,
          })),
          stats: {
            ...stats,
            totalAmount: formatUsdc(stats.totalAmount || '0'),
          },
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + links.length < total,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
