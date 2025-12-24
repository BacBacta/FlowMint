/**
 * Advanced Orders API Routes
 *
 * API endpoints for advanced order types:
 * - Trailing Stop
 * - Bracket Orders (Take Profit + Stop Loss)
 * - Take Profit
 * - Stop Loss
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import {
  getAdvancedOrdersService,
  AdvancedOrderStatus,
  TrailingStopConfig,
  BracketOrderConfig,
  TakeProfitConfig,
  StopLossConfig,
} from '../../services/advancedOrdersService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'advancedOrders' });

// ============================================================================
// Validation Schemas
// ============================================================================

const baseOrderSchema = z.object({
  userPublicKey: z.string().min(32).max(44),
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+$/),
  slippageBps: z.number().min(1).max(5000),
  expiresAt: z.number().optional(),
  useMEVProtection: z.boolean().optional(),
});

const trailingStopSchema = baseOrderSchema.extend({
  trailBps: z.number().min(10).max(5000), // 0.1% to 50%
  activationPrice: z.number().positive().optional(),
});

const bracketOrderSchema = baseOrderSchema.extend({
  takeProfitPrice: z.number().positive(),
  stopLossPrice: z.number().positive(),
  entryPrice: z.number().positive(),
});

const takeProfitSchema = baseOrderSchema.extend({
  targetPrice: z.number().positive(),
});

const stopLossSchema = baseOrderSchema.extend({
  triggerPrice: z.number().positive(),
});

// ============================================================================
// Route Factory
// ============================================================================

/**
 * Create advanced orders routes
 */
export function createAdvancedOrdersRoutes(): Router {
  const router = Router();
  const ordersService = getAdvancedOrdersService();

  // --------------------------------------------------------------------------
  // Trailing Stop
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/orders/advanced/trailing-stop
   *
   * Create a trailing stop order
   */
  router.post('/trailing-stop', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = trailingStopSchema.parse(req.body);

      log.info(
        {
          userPublicKey: body.userPublicKey,
          trailBps: body.trailBps,
          inputMint: body.inputMint,
        },
        'Creating trailing stop order'
      );

      const order = await ordersService.createTrailingStop({
        userPublicKey: body.userPublicKey,
        inputMint: body.inputMint,
        outputMint: body.outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps,
        trailBps: body.trailBps,
        expiresAt: body.expiresAt,
        useMEVProtection: body.useMEVProtection,
        activationPrice: body.activationPrice,
      });

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create trailing stop');
      res.status(500).json({ success: false, error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Bracket Order
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/orders/advanced/bracket
   *
   * Create a bracket order (take profit + stop loss)
   */
  router.post('/bracket', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = bracketOrderSchema.parse(req.body);

      log.info(
        {
          userPublicKey: body.userPublicKey,
          takeProfitPrice: body.takeProfitPrice,
          stopLossPrice: body.stopLossPrice,
        },
        'Creating bracket order'
      );

      const order = await ordersService.createBracketOrder({
        userPublicKey: body.userPublicKey,
        inputMint: body.inputMint,
        outputMint: body.outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps,
        takeProfitPrice: body.takeProfitPrice,
        stopLossPrice: body.stopLossPrice,
        entryPrice: body.entryPrice,
        expiresAt: body.expiresAt,
        useMEVProtection: body.useMEVProtection,
      });

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create bracket order');
      res.status(500).json({ success: false, error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Take Profit
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/orders/advanced/take-profit
   *
   * Create a take profit order
   */
  router.post('/take-profit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = takeProfitSchema.parse(req.body);

      log.info(
        { userPublicKey: body.userPublicKey, targetPrice: body.targetPrice },
        'Creating take profit order'
      );

      const order = await ordersService.createTakeProfit({
        userPublicKey: body.userPublicKey,
        inputMint: body.inputMint,
        outputMint: body.outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps,
        targetPrice: body.targetPrice,
        expiresAt: body.expiresAt,
        useMEVProtection: body.useMEVProtection,
      });

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create take profit order');
      res.status(500).json({ success: false, error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Stop Loss
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/orders/advanced/stop-loss
   *
   * Create a stop loss order
   */
  router.post('/stop-loss', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = stopLossSchema.parse(req.body);

      log.info(
        { userPublicKey: body.userPublicKey, triggerPrice: body.triggerPrice },
        'Creating stop loss order'
      );

      const order = await ordersService.createStopLoss({
        userPublicKey: body.userPublicKey,
        inputMint: body.inputMint,
        outputMint: body.outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps,
        triggerPrice: body.triggerPrice,
        expiresAt: body.expiresAt,
        useMEVProtection: body.useMEVProtection,
      });

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create stop loss order');
      res.status(500).json({ success: false, error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Order Management
  // --------------------------------------------------------------------------

  /**
   * GET /api/v1/orders/advanced/:id
   *
   * Get an order by ID
   */
  router.get('/:id', (req: Request, res: Response) => {
    const order = ordersService.getOrder(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    res.json({
      success: true,
      data: order,
    });
  });

  /**
   * GET /api/v1/orders/advanced/user/:userPublicKey
   *
   * Get all orders for a user
   */
  router.get('/user/:userPublicKey', (req: Request, res: Response) => {
    const status = req.query.status as AdvancedOrderStatus | undefined;
    const orders = ordersService.getUserOrders(req.params.userPublicKey, status);

    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
  });

  /**
   * GET /api/v1/orders/advanced/active
   *
   * Get all active orders (for monitoring)
   */
  router.get('/status/active', (_req: Request, res: Response) => {
    const orders = ordersService.getActiveOrders();

    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
  });

  /**
   * POST /api/v1/orders/advanced/:id/cancel
   *
   * Cancel an order
   */
  router.post('/:id/cancel', (req: Request, res: Response) => {
    try {
      const order = ordersService.cancelOrder(req.params.id);

      log.info({ orderId: req.params.id }, 'Order cancelled');

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ success: false, error: message });
    }
  });

  /**
   * POST /api/v1/orders/advanced/:id/check
   *
   * Check if an order should trigger
   */
  router.post('/:id/check', async (req: Request, res: Response) => {
    try {
      const result = await ordersService.checkOrder(req.params.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ success: false, error: message });
    }
  });

  /**
   * POST /api/v1/orders/advanced/:id/execute
   *
   * Build execution transaction for triggered order
   */
  router.post('/:id/execute', async (req: Request, res: Response) => {
    try {
      const result = await ordersService.buildExecutionTransaction(req.params.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ orderId: req.params.id, error: message }, 'Failed to build execution tx');
      res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * POST /api/v1/orders/advanced/:id/confirm
   *
   * Confirm order execution
   */
  router.post('/:id/confirm', (req: Request, res: Response) => {
    try {
      const { txSignature, success, error: errorMsg } = req.body;

      let order;
      if (success && txSignature) {
        order = ordersService.markExecuted(req.params.id, txSignature);
      } else {
        order = ordersService.markFailed(req.params.id, errorMsg || 'Execution failed');
      }

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ success: false, error: message });
    }
  });

  /**
   * POST /api/v1/orders/advanced/cleanup
   *
   * Clean up old orders
   */
  router.post('/maintenance/cleanup', (req: Request, res: Response) => {
    const maxAgeMs = req.body.maxAgeMs || 7 * 24 * 60 * 60 * 1000; // 7 days default
    const removed = ordersService.cleanup(maxAgeMs);

    res.json({
      success: true,
      data: { removed },
    });
  });

  return router;
}
