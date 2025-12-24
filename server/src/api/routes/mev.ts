/**
 * MEV Protection API Routes
 *
 * Provides endpoints for MEV-protected transaction submission via Jito.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import {
  getMEVProtectionService,
  MEVProtectionMode,
} from '../../services/mevProtectionService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'mev' });

// ============================================================================
// Validation Schemas
// ============================================================================

const submitTransactionSchema = z.object({
  /** Base64 encoded signed transaction */
  signedTransaction: z.string().min(100),
  /** Receipt ID for tracking */
  receiptId: z.string().uuid().optional(),
  /** Protection mode: jito (bundle), priority (high fee), none */
  mode: z.enum(['jito', 'priority', 'none']).default('jito'),
  /** Tip for Jito in lamports (default: 1M lamports = 0.001 SOL) */
  tipLamports: z.number().min(10000).max(10000000).optional(),
  /** Skip preflight checks */
  skipPreflight: z.boolean().optional(),
  /** Commitment level */
  commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
});

const checkStatusSchema = z.object({
  /** Bundle ID from Jito submission */
  bundleId: z.string(),
});

// ============================================================================
// Route Factory
// ============================================================================

/**
 * Create MEV protection routes
 */
export function createMEVRoutes(db: DatabaseService): Router {
  const router = Router();
  const mevService = getMEVProtectionService();

  /**
   * POST /api/v1/mev/submit
   *
   * Submit a signed transaction with MEV protection.
   *
   * The client signs the transaction locally and sends it here
   * for MEV-protected submission via Jito bundles.
   */
  router.post('/submit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = submitTransactionSchema.parse(req.body);

      log.info(
        {
          mode: body.mode,
          tipLamports: body.tipLamports,
          receiptId: body.receiptId,
        },
        'MEV protected submission request'
      );

      const result = await mevService.submitTransaction({
        signedTransaction: body.signedTransaction,
        mode: body.mode as MEVProtectionMode,
        tipLamports: body.tipLamports,
        skipPreflight: body.skipPreflight,
        commitment: body.commitment,
      });

      // Update receipt if provided
      if (body.receiptId) {
        try {
          await db.updateReceiptStatus(
            body.receiptId,
            result.confirmed ? 'success' : 'failed',
            result.signature
          );

          // Log MEV submission event
          await db.saveExecutionEvent({
            receiptId: body.receiptId,
            eventType: 'mev_submit',
            timestamp: Date.now(),
            priorityFee: body.tipLamports,
            metadata: {
              mode: result.mode,
              protected: result.protected,
              bundleId: result.bundleId,
              latencyMs: result.latencyMs,
            },
          });
        } catch (updateError) {
          log.warn({ receiptId: body.receiptId, error: updateError }, 'Failed to update receipt');
        }
      }

      log.info(
        {
          signature: result.signature,
          mode: result.mode,
          protected: result.protected,
          bundleId: result.bundleId,
          latencyMs: result.latencyMs,
        },
        'MEV protected submission complete'
      );

      res.json({
        success: true,
        data: {
          signature: result.signature,
          protected: result.protected,
          mode: result.mode,
          bundleId: result.bundleId,
          slot: result.slot,
          confirmed: result.confirmed,
          latencyMs: result.latencyMs,
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

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'MEV submission failed');

      res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/v1/mev/tip
   *
   * Get recommended tip amounts based on network conditions.
   */
  router.get('/tip', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const tips = await mevService.getRecommendedTip();

      res.json({
        success: true,
        data: {
          low: tips.low,
          medium: tips.medium,
          high: tips.high,
          recommended: tips.medium,
          unit: 'lamports',
          lowSol: tips.low / 1e9,
          mediumSol: tips.medium / 1e9,
          highSol: tips.high / 1e9,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/mev/status
   *
   * Check if Jito MEV protection is available.
   */
  router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const jitoAvailable = await mevService.isJitoAvailable();
      const endpoints = mevService.getAvailableEndpoints();

      res.json({
        success: true,
        data: {
          jitoAvailable,
          endpoints: Object.keys(endpoints),
          currentEndpoint: process.env.JITO_ENDPOINT || 'mainnet',
          modes: ['jito', 'priority', 'none'],
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/mev/endpoints
   *
   * Get available Jito endpoints (for region selection).
   */
  router.get('/endpoints', (_req: Request, res: Response) => {
    const endpoints = mevService.getAvailableEndpoints();

    res.json({
      success: true,
      data: endpoints,
    });
  });

  return router;
}
