/**
 * Express Application Factory
 *
 * Creates and configures the Express application with all routes and middleware.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { DatabaseService } from './db/database.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';

// Route imports
import { createSwapRoutes } from './api/routes/swap.js';
import { createPaymentRoutes } from './api/routes/payment.js';
import { createIntentRoutes } from './api/routes/intent.js';
import { createHealthRoutes } from './api/routes/health.js';
import { createNotificationRoutes } from './api/routes/notifications.js';
import { createAnalyticsRoutes } from './api/routes/analytics.js';

/**
 * Creates and configures the Express application
 *
 * @param db - Database service instance
 * @returns Configured Express application
 */
export function createApp(db: DatabaseService): Express {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: config.rateLimitRpm,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // Health check routes
  app.use('/health', createHealthRoutes());

  // API routes
  const apiRouter = express.Router();
  apiRouter.use('/swap', createSwapRoutes(db));
  apiRouter.use('/payments', createPaymentRoutes(db));
  apiRouter.use('/intents', createIntentRoutes(db));
  apiRouter.use('/notifications', createNotificationRoutes(db));
  apiRouter.use('/analytics', createAnalyticsRoutes(db));

  app.use('/api/v1', apiRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: err }, 'Unhandled error');
    res.status(500).json({
      error: 'Internal server error',
      message: config.nodeEnv === 'development' ? err.message : undefined,
    });
  });

  return app;
}
