/**
 * Express Application Factory
 *
 * Creates and configures the Express application with all routes and middleware.
 */

import cors from 'cors';
import express, { Express, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// Route imports
import { createAdvancedOrdersRoutes } from './api/routes/advancedOrders.js';
import { createAnalyticsRoutes } from './api/routes/analytics.js';
import { createAuthRoutes } from './api/routes/auth.js';
import { createDelegationRoutes } from './api/routes/delegation.js';
import { createHealthRoutes } from './api/routes/health.js';
import { createIntentRoutes } from './api/routes/intent.js';
import { createJupiterOrdersRoutes } from './api/routes/jupiterOrders.js';
import metricsRouter from './api/routes/metrics.js';
import { createMEVRoutes } from './api/routes/mev.js';
import { createNotificationRoutes } from './api/routes/notifications.js';
import { createPaymentRoutes } from './api/routes/payment.js';
import { createSwapRoutes } from './api/routes/swap.js';
import swaggerRouter from './api/swagger.js';
import { config } from './config/index.js';
import { DatabaseService } from './db/database.js';
import { createPortfolioPayRouter, initPortfolioPayServices } from './routes/portfoliopay.js';
import { logger } from './utils/logger.js';

/**
 * Creates and configures the Express application
 *
 * @param db - Database service instance
 * @returns Configured Express application
 */
export async function createApp(db: DatabaseService): Promise<Express> {
  const app = express();

  // Initialize PortfolioPay V1 services
  await initPortfolioPayServices(db);
  logger.info('PortfolioPay V1 services initialized');

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

  // Metrics endpoint (Prometheus format)
  app.use('/metrics', metricsRouter);

  // API Documentation (Swagger UI)
  app.use('/docs', swaggerRouter);

  // API routes
  const apiRouter = express.Router();
  apiRouter.use('/auth', createAuthRoutes());
  apiRouter.use('/swap', createSwapRoutes(db));
  apiRouter.use('/payments', createPaymentRoutes(db));
  apiRouter.use('/intents', createIntentRoutes(db));
  apiRouter.use('/notifications', createNotificationRoutes(db));
  apiRouter.use('/analytics', createAnalyticsRoutes(db));
  apiRouter.use('/delegation', createDelegationRoutes(db));
  apiRouter.use('/jupiter', createJupiterOrdersRoutes());
  apiRouter.use('/mev', createMEVRoutes(db));
  apiRouter.use('/orders/advanced', createAdvancedOrdersRoutes());

  // PortfolioPay V1 routes
  apiRouter.use('/', createPortfolioPayRouter());

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
