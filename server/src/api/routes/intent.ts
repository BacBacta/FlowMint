/**
 * Intent API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import {
  IntentScheduler,
  IntentType,
  CreateIntentRequest,
} from '../../services/intentScheduler.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'intent' });

/**
 * Request validation schemas
 */
const createDCASchema = z.object({
  userPublicKey: z.string().min(32).max(44),
  tokenFrom: z.string().min(32).max(44),
  tokenTo: z.string().min(32).max(44),
  totalAmount: z.string().regex(/^\d+$/),
  numberOfSwaps: z.number().min(2).max(100),
  intervalSeconds: z.number().min(60).max(2592000), // 1 min to 30 days
  slippageBps: z.number().min(1).max(1000).optional(),
});

const createStopLossSchema = z.object({
  userPublicKey: z.string().min(32).max(44),
  tokenFrom: z.string().min(32).max(44),
  tokenTo: z.string().min(32).max(44),
  totalAmount: z.string().regex(/^\d+$/),
  priceThreshold: z.number().positive(),
  priceDirection: z.enum(['above', 'below']),
  priceFeedId: z.string().length(64), // Pyth price feed ID
  slippageBps: z.number().min(1).max(1000).optional(),
});

const cancelIntentSchema = z.object({
  userPublicKey: z.string().min(32).max(44),
});

/**
 * Create intent routes
 */
export function createIntentRoutes(db: DatabaseService): Router {
  const router = Router();
  // Note: In production, this would share the scheduler with index.ts
  const scheduler = new IntentScheduler(db);

  /**
   * POST /api/v1/intents/dca
   *
   * Create a DCA (Dollar-Cost Averaging) intent
   */
  router.post('/dca', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createDCASchema.parse(req.body);

      log.info(
        {
          user: body.userPublicKey,
          tokenFrom: body.tokenFrom,
          tokenTo: body.tokenTo,
          totalAmount: body.totalAmount,
          numberOfSwaps: body.numberOfSwaps,
        },
        'Create DCA intent'
      );

      const request: CreateIntentRequest = {
        userPublicKey: body.userPublicKey,
        intentType: IntentType.DCA,
        tokenFrom: body.tokenFrom,
        tokenTo: body.tokenTo,
        totalAmount: body.totalAmount,
        numberOfSwaps: body.numberOfSwaps,
        intervalSeconds: body.intervalSeconds,
        slippageBps: body.slippageBps,
      };

      const intent = await scheduler.createIntent(request);

      res.status(201).json({
        success: true,
        data: {
          id: intent.id,
          type: intent.intentType,
          status: intent.status,
          tokenFrom: intent.tokenFrom,
          tokenTo: intent.tokenTo,
          totalAmount: intent.totalAmount,
          amountPerSwap: intent.amountPerSwap,
          intervalSeconds: intent.intervalSeconds,
          nextExecutionAt: intent.nextExecutionAt,
          createdAt: intent.createdAt,
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
   * POST /api/v1/intents/stop-loss
   *
   * Create a stop-loss intent
   */
  router.post('/stop-loss', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createStopLossSchema.parse(req.body);

      log.info(
        {
          user: body.userPublicKey,
          tokenFrom: body.tokenFrom,
          priceThreshold: body.priceThreshold,
          direction: body.priceDirection,
        },
        'Create stop-loss intent'
      );

      const request: CreateIntentRequest = {
        userPublicKey: body.userPublicKey,
        intentType: IntentType.STOP_LOSS,
        tokenFrom: body.tokenFrom,
        tokenTo: body.tokenTo,
        totalAmount: body.totalAmount,
        priceThreshold: body.priceThreshold,
        priceDirection: body.priceDirection,
        priceFeedId: body.priceFeedId,
        slippageBps: body.slippageBps,
      };

      const intent = await scheduler.createIntent(request);

      res.status(201).json({
        success: true,
        data: {
          id: intent.id,
          type: intent.intentType,
          status: intent.status,
          tokenFrom: intent.tokenFrom,
          tokenTo: intent.tokenTo,
          totalAmount: intent.totalAmount,
          priceThreshold: intent.priceThreshold,
          priceDirection: intent.priceDirection,
          createdAt: intent.createdAt,
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
   * DELETE /api/v1/intents/:id
   *
   * Cancel an intent
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = cancelIntentSchema.parse(req.body);

      log.info({ intentId: req.params.id, user: body.userPublicKey }, 'Cancel intent');

      await scheduler.cancelIntent(req.params.id, body.userPublicKey);

      res.json({
        success: true,
        data: {
          id: req.params.id,
          status: 'cancelled',
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
      if (error instanceof Error) {
        if (error.message === 'Intent not found') {
          return res.status(404).json({
            success: false,
            error: error.message,
          });
        }
        if (error.message === 'Unauthorized') {
          return res.status(403).json({
            success: false,
            error: error.message,
          });
        }
      }
      next(error);
    }
  });

  /**
   * GET /api/v1/intents/user/:publicKey
   *
   * Get user's intents
   */
  router.get('/user/:publicKey', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intents = await scheduler.getUserIntents(req.params.publicKey);

      res.json({
        success: true,
        data: intents.map(intent => ({
          id: intent.id,
          type: intent.intentType,
          status: intent.status,
          tokenFrom: intent.tokenFrom,
          tokenTo: intent.tokenTo,
          totalAmount: intent.totalAmount,
          remainingAmount: intent.remainingAmount,
          amountPerSwap: intent.amountPerSwap,
          intervalSeconds: intent.intervalSeconds,
          priceThreshold: intent.priceThreshold,
          priceDirection: intent.priceDirection,
          executionCount: intent.executionCount,
          lastExecutionAt: intent.lastExecutionAt,
          nextExecutionAt: intent.nextExecutionAt,
          createdAt: intent.createdAt,
        })),
        count: intents.length,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/intents/:id
   *
   * Get a specific intent
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intents = await db.getIntent(req.params.id);

      if (!intents) {
        return res.status(404).json({
          success: false,
          error: 'Intent not found',
        });
      }

      res.json({
        success: true,
        data: intents,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/intents/price-feeds
   *
   * Get common Pyth price feed IDs
   */
  router.get('/price-feeds/common', async (_req: Request, res: Response) => {
    // Common Pyth price feed IDs
    const commonFeeds = [
      {
        symbol: 'SOL/USD',
        id: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
      },
      {
        symbol: 'BTC/USD',
        id: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
      },
      {
        symbol: 'ETH/USD',
        id: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
      },
      {
        symbol: 'USDC/USD',
        id: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
      },
      {
        symbol: 'BONK/USD',
        id: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
      },
      {
        symbol: 'JUP/USD',
        id: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e5d8e8fcd24dcc7',
      },
    ];

    res.json({
      success: true,
      data: commonFeeds,
    });
  });

  return router;
}
