/**
 * Swap API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import { ExecutionEngine } from '../../services/executionEngine.js';
import { jupiterService, JupiterError } from '../../services/jupiterService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'swap' });

function isJupiterError(error: unknown): error is JupiterError {
  if (error instanceof JupiterError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'JupiterError'
  );
}

/**
 * Request validation schemas
 */
const quoteRequestSchema = z.object({
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+$/),
  slippageBps: z.number().min(1).max(5000),
  swapMode: z.enum(['ExactIn', 'ExactOut']).optional(),
});

const executeSwapSchema = z.object({
  userPublicKey: z.string().min(32).max(44),
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+$/),
  slippageBps: z.number().min(1).max(5000),
  protectedMode: z.boolean().optional(),
  exactOut: z.boolean().optional(),
});

const confirmSwapSchema = z.object({
  receiptId: z.string().uuid(),
  txSignature: z.string().min(64).max(100),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Create swap routes
 */
export function createSwapRoutes(db: DatabaseService): Router {
  const router = Router();
  const executionEngine = new ExecutionEngine(db);

  /**
   * GET /api/v1/swap/quote
   *
   * Get a swap quote from Jupiter
   */
  router.get('/quote', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = quoteRequestSchema.parse({
        inputMint: req.query.inputMint,
        outputMint: req.query.outputMint,
        amount: req.query.amount,
        slippageBps: parseInt(req.query.slippageBps as string, 10),
        swapMode: req.query.swapMode,
      });

      log.info({ query }, 'Quote request');

      const quote = await jupiterService.quoteSwap({
        inputMint: query.inputMint,
        outputMint: query.outputMint,
        amount: query.amount,
        slippageBps: query.slippageBps,
        swapMode: query.swapMode,
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

      if (isJupiterError(error)) {
        // Bubble up Jupiter status when available; otherwise use a 502.
        const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 502;
        return res.status(status).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }
      next(error);
    }
  });

  /**
   * POST /api/v1/swap/execute
   *
   * Execute a swap - returns transaction for client to sign
   */
  router.post('/execute', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = executeSwapSchema.parse(req.body);

      log.info(
        {
          userPublicKey: body.userPublicKey,
          inputMint: body.inputMint,
          outputMint: body.outputMint,
          amount: body.amount,
        },
        'Execute swap request'
      );

      const result = await executionEngine.executeSwap({
        userPublicKey: body.userPublicKey,
        inputMint: body.inputMint,
        outputMint: body.outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps,
        protectedMode: body.protectedMode,
        exactOut: body.exactOut,
      });

      if (result.status === 'failed') {
        return res.status(400).json({
          success: false,
          error: result.error,
          receiptId: result.receiptId,
          riskLevel: result.riskLevel,
          warnings: result.warnings,
        });
      }

      res.json({
        success: true,
        data: {
          receiptId: result.receiptId,
          status: result.status,
          quote: result.quote,
          transaction: result.transaction,
          lastValidBlockHeight: result.lastValidBlockHeight,
          riskLevel: result.riskLevel,
          warnings: result.warnings,
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
   * POST /api/v1/swap/confirm
   *
   * Confirm swap transaction result
   */
  router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = confirmSwapSchema.parse(req.body);

      log.info({ receiptId: body.receiptId, success: body.success }, 'Confirm swap');

      await executionEngine.updateReceiptStatus(
        body.receiptId,
        body.success ? 'success' : 'failed',
        body.txSignature,
        body.error
      );

      res.json({
        success: true,
        data: {
          receiptId: body.receiptId,
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
   * GET /api/v1/swap/receipt/:id
   *
   * Get a swap receipt
   */
  router.get('/receipt/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const receipt = await executionEngine.getReceipt(req.params.id);

      if (!receipt) {
        return res.status(404).json({
          success: false,
          error: 'Receipt not found',
        });
      }

      res.json({
        success: true,
        data: receipt,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/swap/receipt/:id/timeline
   *
   * Get execution timeline for a swap receipt
   */
  router.get('/receipt/:id/timeline', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const receipt = await executionEngine.getReceipt(req.params.id);

      if (!receipt) {
        return res.status(404).json({
          success: false,
          error: 'Receipt not found',
        });
      }

      const timeline = await db.getExecutionEvents(req.params.id);

      res.json({
        success: true,
        data: {
          receiptId: req.params.id,
          events: timeline,
          count: timeline.length,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/swap/receipts/:userPublicKey
   *
   * Get user's swap receipts
   */
  router.get(
    '/receipts/:userPublicKey',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limit = parseInt(req.query.limit as string, 10) || 50;
        const receipts = await executionEngine.getUserReceipts(req.params.userPublicKey, limit);

        res.json({
          success: true,
          data: receipts,
          count: receipts.length,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/v1/swap/tokens
   *
   * Get tradeable tokens list
   */
  router.get('/tokens', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const tokens = await jupiterService.getTokenList(['verified']);

      res.json({
        success: true,
        data: tokens.slice(0, 100), // Limit response size
        count: tokens.length,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
