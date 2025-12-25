/**
 * Jupiter Orders Routes
 *
 * API endpoints for Jupiter Recurring (DCA) and Trigger (Limit) orders.
 */

import { Router, Request, Response } from 'express';

import { getJupiterOrdersService } from '../../services/jupiterOrdersService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'jupiter-orders' });

/**
 * Create Jupiter orders routes
 */
export function createJupiterOrdersRoutes(): Router {
  const router = Router();
  const jupiterOrders = getJupiterOrdersService();

  // ==========================================================================
  // Recurring Orders (DCA)
  // ==========================================================================

  /**
   * POST /api/v1/jupiter/recurring/create
   *
   * Create a time-based recurring order (DCA).
   */
  router.post('/recurring/create', async (req: Request, res: Response) => {
    try {
      const {
        user,
        inputMint,
        outputMint,
        inAmount,
        numberOfOrders,
        interval,
        minPrice,
        maxPrice,
        startAt,
      } = req.body;

      if (!user || !inputMint || !outputMint || !inAmount || !numberOfOrders || !interval) {
        return res.status(400).json({
          error:
            'Missing required fields: user, inputMint, outputMint, inAmount, numberOfOrders, interval',
        });
      }

      const result = await jupiterOrders.createRecurringOrder({
        user,
        inputMint,
        outputMint,
        params: {
          time: {
            inAmount,
            numberOfOrders: Number(numberOfOrders),
            interval: Number(interval),
            minPrice: minPrice || null,
            maxPrice: maxPrice || null,
            startAt: startAt || null,
          },
        },
      });

      log.info({ user, requestId: result.requestId }, 'Recurring order created');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create recurring order');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/jupiter/recurring/execute
   *
   * Execute a recurring order after signing.
   */
  router.post('/recurring/execute', async (req: Request, res: Response) => {
    try {
      const { requestId, signedTransaction } = req.body;

      if (!requestId || !signedTransaction) {
        return res.status(400).json({
          error: 'Missing required fields: requestId, signedTransaction',
        });
      }

      const result = await jupiterOrders.executeRecurringOrder({
        requestId,
        signedTransaction,
      });

      log.info({ requestId, signature: result.signature }, 'Recurring order executed');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to execute recurring order');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/jupiter/recurring/cancel
   *
   * Cancel a recurring order.
   */
  router.post('/recurring/cancel', async (req: Request, res: Response) => {
    try {
      const { order, signer } = req.body;

      if (!order || !signer) {
        return res.status(400).json({
          error: 'Missing required fields: order, signer',
        });
      }

      const result = await jupiterOrders.cancelRecurringOrder({ order, signer });

      log.info({ order }, 'Recurring order cancel transaction created');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to cancel recurring order');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/jupiter/recurring/:user
   *
   * Get recurring orders for a user.
   */
  router.get('/recurring/:user', async (req: Request, res: Response) => {
    try {
      const { user } = req.params;
      const { status } = req.query;

      const orders = await jupiterOrders.getRecurringOrders(
        user,
        status as 'active' | 'historical' | undefined
      );

      return res.json({ orders, count: orders.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to get recurring orders');
      return res.status(500).json({ error: message });
    }
  });

  // ==========================================================================
  // Trigger Orders (Limit Orders)
  // ==========================================================================

  /**
   * POST /api/v1/jupiter/trigger/create
   *
   * Create a trigger (limit) order.
   */
  router.post('/trigger/create', async (req: Request, res: Response) => {
    try {
      const {
        inputMint,
        outputMint,
        maker,
        payer,
        makingAmount,
        takingAmount,
        slippageBps,
        expiredAt,
        feeBps,
        feeAccount,
        wrapAndUnwrapSol,
      } = req.body;

      if (!inputMint || !outputMint || !maker || !makingAmount || !takingAmount) {
        return res.status(400).json({
          error:
            'Missing required fields: inputMint, outputMint, maker, makingAmount, takingAmount',
        });
      }

      const result = await jupiterOrders.createTriggerOrder({
        inputMint,
        outputMint,
        maker,
        payer: payer || maker,
        params: {
          makingAmount,
          takingAmount,
          slippageBps: slippageBps ? Number(slippageBps) : undefined,
          expiredAt: expiredAt ? Number(expiredAt) : undefined,
          feeBps: feeBps ? Number(feeBps) : undefined,
        },
        feeAccount,
        wrapAndUnwrapSol: wrapAndUnwrapSol ?? true,
      });

      log.info({ maker, order: result.order }, 'Trigger order created');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create trigger order');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/jupiter/trigger/execute
   *
   * Execute a trigger order after signing.
   */
  router.post('/trigger/execute', async (req: Request, res: Response) => {
    try {
      const { requestId, signedTransaction } = req.body;

      if (!requestId || !signedTransaction) {
        return res.status(400).json({
          error: 'Missing required fields: requestId, signedTransaction',
        });
      }

      const result = await jupiterOrders.executeTriggerOrder({
        requestId,
        signedTransaction,
      });

      log.info({ requestId, signature: result.signature }, 'Trigger order executed');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to execute trigger order');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/jupiter/trigger/cancel
   *
   * Cancel a trigger order.
   */
  router.post('/trigger/cancel', async (req: Request, res: Response) => {
    try {
      const { order, signer } = req.body;

      if (!order || !signer) {
        return res.status(400).json({
          error: 'Missing required fields: order, signer',
        });
      }

      const result = await jupiterOrders.cancelTriggerOrder({ order, signer });

      log.info({ order }, 'Trigger order cancel transaction created');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to cancel trigger order');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/jupiter/trigger/:maker
   *
   * Get trigger orders for a user.
   */
  router.get('/trigger/:maker', async (req: Request, res: Response) => {
    try {
      const { maker } = req.params;
      const { status } = req.query;

      const orders = await jupiterOrders.getTriggerOrders(
        maker,
        status as 'open' | 'historical' | undefined
      );

      return res.json({ orders, count: orders.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to get trigger orders');
      return res.status(500).json({ error: message });
    }
  });

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * POST /api/v1/jupiter/calculate/dca
   *
   * Calculate DCA parameters.
   */
  router.post('/calculate/dca', async (req: Request, res: Response) => {
    try {
      const { totalAmount, numberOfOrders, intervalSeconds } = req.body;

      if (!totalAmount || !numberOfOrders || !intervalSeconds) {
        return res.status(400).json({
          error: 'Missing required fields: totalAmount, numberOfOrders, intervalSeconds',
        });
      }

      const amountPerOrder = jupiterOrders.calculateAmountPerOrder(
        totalAmount,
        Number(numberOfOrders)
      );
      const totalDurationSeconds = jupiterOrders.calculateTotalDuration(
        Number(numberOfOrders),
        Number(intervalSeconds)
      );

      return res.json({
        amountPerOrder,
        totalDurationSeconds,
        totalDurationDays: totalDurationSeconds / 86400,
        summary: `${numberOfOrders} orders of ${amountPerOrder} each, every ${intervalSeconds} seconds`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/jupiter/calculate/trigger-price
   *
   * Calculate trigger order target price.
   */
  router.post('/calculate/trigger-price', async (req: Request, res: Response) => {
    try {
      const { makingAmount, takingAmount, inputDecimals, outputDecimals } = req.body;

      if (
        !makingAmount ||
        !takingAmount ||
        inputDecimals === undefined ||
        outputDecimals === undefined
      ) {
        return res.status(400).json({
          error:
            'Missing required fields: makingAmount, takingAmount, inputDecimals, outputDecimals',
        });
      }

      const price = jupiterOrders.calculateTriggerPrice(
        makingAmount,
        takingAmount,
        Number(inputDecimals),
        Number(outputDecimals)
      );

      return res.json({
        price,
        summary: `Target price: ${price.toFixed(6)} output per input`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return res.status(400).json({ error: message });
    }
  });

  return router;
}

export default createJupiterOrdersRoutes;
