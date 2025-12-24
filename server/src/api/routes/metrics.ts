/**
 * Metrics API Routes
 *
 * Exposes Prometheus-compatible metrics endpoint for monitoring.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';

import { getMetricsService } from '../../services/metricsService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'metrics' });

const router: RouterType = Router();

/**
 * GET /metrics
 * Returns Prometheus-formatted metrics
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const metricsService = getMetricsService();
    const metrics = await metricsService.getMetrics();

    res.set('Content-Type', metricsService.getContentType());
    res.status(200).send(metrics);
  } catch (error) {
    log.error({ error }, 'Failed to get metrics');
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

export default router;
