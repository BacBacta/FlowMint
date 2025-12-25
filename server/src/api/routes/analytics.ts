/**
 * Analytics API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { DatabaseService } from '../../db/database.js';
import { AnalyticsService, TimeRange } from '../../services/analyticsService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'analytics' });

/**
 * Create analytics routes
 */
export function createAnalyticsRoutes(db: DatabaseService): Router {
  const router = Router();
  const analyticsService = new AnalyticsService(db);

  /**
   * GET /api/v1/analytics/overview
   *
   * Get platform overview
   */
  router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeRange = (req.query.timeRange as TimeRange) || '24h';

      if (!['1h', '24h', '7d', '30d', 'all'].includes(timeRange)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid time range. Use: 1h, 24h, 7d, 30d, or all',
        });
      }

      const overview = await analyticsService.getPlatformOverview(timeRange);

      res.json({
        success: true,
        data: overview,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/analytics/swaps
   *
   * Get swap analytics
   */
  router.get('/swaps', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeRange = (req.query.timeRange as TimeRange) || '24h';
      const analytics = await analyticsService.getSwapAnalytics(timeRange);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/analytics/intents
   *
   * Get intent analytics
   */
  router.get('/intents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeRange = (req.query.timeRange as TimeRange) || '24h';
      const analytics = await analyticsService.getIntentAnalytics(timeRange);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/analytics/users
   *
   * Get user analytics
   */
  router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeRange = (req.query.timeRange as TimeRange) || '24h';
      const analytics = await analyticsService.getUserAnalytics(timeRange);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/analytics/execution
   *
   * Get execution quality metrics
   */
  router.get('/execution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeRange = (req.query.timeRange as TimeRange) || '24h';
      const analytics = await analyticsService.getExecutionQuality(timeRange);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/analytics/user/:userPublicKey
   *
   * Get user-specific analytics
   */
  router.get('/user/:userPublicKey', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userPublicKey } = req.params;
      const analytics = await analyticsService.getUserSwapAnalytics(userPublicKey);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/analytics/comparison/:receiptId
   *
   * Get comparison metrics for a specific swap
   */
  router.get('/comparison/:receiptId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { receiptId } = req.params;
      const comparison = await analyticsService.getComparisonMetrics(receiptId);

      if (!comparison) {
        return res.status(404).json({
          success: false,
          error: 'Receipt not found',
        });
      }

      res.json({
        success: true,
        data: comparison,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
