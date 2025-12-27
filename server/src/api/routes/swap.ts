/**
 * Swap API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import { ExecutionEngine } from '../../services/executionEngine.js';
import { jupiterService, JupiterError } from '../../services/jupiterService.js';
import {
  jupiterUltraService,
  JupiterUltraError,
} from '../../services/jupiterUltraService.js';
import { riskScoringService } from '../../services/riskScoring.js';
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

function isJupiterUltraError(error: unknown): error is JupiterUltraError {
  if (error instanceof JupiterUltraError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'JupiterUltraError'
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
  protectedMode: z.boolean().optional(),
  includeRisk: z.boolean().optional(),
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
 * Ultra API schemas
 */
const ultraOrderSchema = z.object({
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+$/),
  taker: z.string().min(32).max(44).optional(),
  receiver: z.string().min(32).max(44).optional(),
  referralAccount: z.string().min(32).max(44).optional(),
  referralFee: z.number().min(50).max(255).optional(),
  includeRisk: z.boolean().optional(),
  protectedMode: z.boolean().optional(),
});

const ultraExecuteSchema = z.object({
  signedTransaction: z.string().min(1),
  requestId: z.string().min(1),
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
        protectedMode:
          typeof req.query.protectedMode === 'string'
            ? req.query.protectedMode === 'true'
            : undefined,
        includeRisk:
          typeof req.query.includeRisk === 'string' ? req.query.includeRisk === 'true' : undefined,
      });

      log.info({ query }, 'Quote request');

      const quote = await jupiterService.quoteSwap({
        inputMint: query.inputMint,
        outputMint: query.outputMint,
        amount: query.amount,
        slippageBps: query.slippageBps,
        swapMode: query.swapMode,
      });

      if (query.includeRisk) {
        const quoteTimestamp = Date.now();
        const riskAssessment = await riskScoringService.scoreSwap(
          {
            inputMint: query.inputMint,
            outputMint: query.outputMint,
            amountIn: query.amount,
            slippageBps: query.slippageBps,
            protectedMode: query.protectedMode ?? false,
            quoteTimestamp,
          },
          quote
        );

        return res.json({
          success: true,
          data: {
            quote,
            quoteTimestamp,
            riskAssessment,
          },
        });
      }

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

  /**
   * GET /api/v1/swap/token/:mint
   *
   * Resolve token metadata by mint (useful for custom tokens pasted by the user).
   * Uses DexScreener API first (works for new/pump.fun tokens), then falls back to Jupiter.
   */
  router.get('/token/:mint', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mint = z.string().min(32).max(64).parse(req.params.mint);

      // Try DexScreener first (works for new/pump.fun tokens)
      log.info({ mint }, 'Resolving token via DexScreener');
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        if (dexRes.ok) {
          const dexData = (await dexRes.json()) as {
            pairs?: Array<{
              baseToken?: { address: string; symbol: string; name: string };
              info?: { imageUrl?: string };
            }>;
          };
          const pair = dexData?.pairs?.[0];
          if (pair) {
            const baseToken = pair.baseToken;
            if (baseToken && baseToken.address === mint) {
              return res.json({
                success: true,
                data: {
                  symbol: baseToken.symbol,
                  mint: baseToken.address,
                  // DexScreener doesn't always give decimals; default to 9 (common for SPL)
                  decimals: 9,
                  logoURI: pair.info?.imageUrl ?? '',
                },
              });
            }
          }
        }
      } catch (dexErr) {
        log.warn({ mint, error: dexErr }, 'DexScreener lookup failed, trying Jupiter');
      }

      // Fallback to Jupiter token list (may not be available)
      try {
        const tokens = await jupiterService.getTokenList();
        const token = tokens.find(t => t.address === mint || (t as any).mint === mint);
        if (token) {
          return res.json({
            success: true,
            data: {
              symbol: token.symbol,
              mint: (token as any).address ?? (token as any).mint,
              decimals: token.decimals,
              logoURI: token.logoURI ?? '',
            },
          });
        }
      } catch (jupErr) {
        log.warn({ mint, error: jupErr }, 'Jupiter token list lookup failed');
      }

      return res.status(404).json({
        success: false,
        error: 'Token not found',
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

  // ===========================================================================
  // ULTRA API ENDPOINTS
  // ===========================================================================

  /**
   * GET /api/v1/swap/ultra/order
   *
   * Get a swap order from Jupiter Ultra API.
   * Ultra provides RPC-less, optimized swaps with MEV protection.
   * If taker is provided, returns an unsigned transaction ready to sign.
   */
  router.get('/ultra/order', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ultraOrderSchema.parse({
        inputMint: req.query.inputMint,
        outputMint: req.query.outputMint,
        amount: req.query.amount,
        taker: req.query.taker,
        receiver: req.query.receiver,
        referralAccount: req.query.referralAccount,
        referralFee: req.query.referralFee
          ? parseInt(req.query.referralFee as string, 10)
          : undefined,
        includeRisk:
          typeof req.query.includeRisk === 'string' ? req.query.includeRisk === 'true' : undefined,
        protectedMode:
          typeof req.query.protectedMode === 'string'
            ? req.query.protectedMode === 'true'
            : undefined,
      });

      log.info({ query }, 'Ultra order request');

      const order = await jupiterUltraService.getOrder({
        inputMint: query.inputMint,
        outputMint: query.outputMint,
        amount: query.amount,
        taker: query.taker,
        receiver: query.receiver,
        referralAccount: query.referralAccount,
        referralFee: query.referralFee,
      });

      // Include risk assessment if requested
      if (query.includeRisk) {
        const quoteTimestamp = Date.now();
        // Convert Ultra order to a format compatible with risk scoring
        const quoteForRisk = {
          inputMint: order.inputMint,
          inAmount: order.inAmount,
          outputMint: order.outputMint,
          outAmount: order.outAmount,
          otherAmountThreshold: order.otherAmountThreshold,
          swapMode: order.swapMode,
          slippageBps: order.slippageBps,
          platformFee: order.platformFee,
          priceImpactPct: order.priceImpactPct,
          routePlan: order.routePlan,
          contextSlot: 0, // Ultra doesn't provide this
          timeTaken: order.totalTime,
        };

        const riskAssessment = await riskScoringService.scoreSwap(
          {
            inputMint: query.inputMint,
            outputMint: query.outputMint,
            amountIn: query.amount,
            slippageBps: order.slippageBps,
            protectedMode: query.protectedMode ?? false,
            quoteTimestamp,
          },
          quoteForRisk
        );

        return res.json({
          success: true,
          data: {
            order,
            quoteTimestamp,
            riskAssessment,
          },
        });
      }

      res.json({
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

      if (isJupiterUltraError(error)) {
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
   * POST /api/v1/swap/ultra/execute
   *
   * Execute a signed swap transaction through Jupiter Ultra.
   * Ultra handles broadcasting with optimized landing and MEV protection.
   */
  router.post('/ultra/execute', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = ultraExecuteSchema.parse(req.body);

      log.info({ requestId: body.requestId }, 'Ultra execute request');

      const result = await jupiterUltraService.execute({
        signedTransaction: body.signedTransaction,
        requestId: body.requestId,
      });

      if (result.status === 'Failed') {
        return res.status(400).json({
          success: false,
          error: result.error || 'Swap execution failed',
          code: result.code,
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

      if (isJupiterUltraError(error)) {
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
   * GET /api/v1/swap/ultra/holdings/:wallet
   *
   * Get token holdings for a wallet via Ultra API (RPC-less).
   */
  router.get('/ultra/holdings/:wallet', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wallet = z.string().min(32).max(44).parse(req.params.wallet);

      const holdings = await jupiterUltraService.getHoldings(wallet);

      res.json({
        success: true,
        data: holdings,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid wallet address',
          details: error.errors,
        });
      }

      if (isJupiterUltraError(error)) {
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
   * GET /api/v1/swap/ultra/shield
   *
   * Get token safety information via Ultra API.
   */
  router.get('/ultra/shield', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mints = z.string().min(32).parse(req.query.mints);
      const mintList = mints.split(',').filter(m => m.length >= 32);

      if (mintList.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid mints provided',
        });
      }

      const shield = await jupiterUltraService.getShield(mintList);

      res.json({
        success: true,
        data: shield,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid mints parameter',
          details: error.errors,
        });
      }

      if (isJupiterUltraError(error)) {
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
   * GET /api/v1/swap/ultra/health
   *
   * Check if Ultra API is available and API key is valid.
   */
  router.get('/ultra/health', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const isHealthy = await jupiterUltraService.healthCheck();

      if (!isHealthy) {
        return res.status(503).json({
          success: false,
          error: 'Jupiter Ultra API is not available or API key is invalid',
          hint: 'Configure JUPITER_API_KEY via portal.jup.ag',
        });
      }

      res.json({
        success: true,
        data: {
          status: 'ok',
          api: 'Jupiter Ultra',
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
