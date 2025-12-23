/**
 * FlowMint Server Entry Point
 *
 * Initializes and starts the FlowMint execution engine server.
 */

import 'dotenv/config';

import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { DatabaseService } from './db/database.js';
import { IntentScheduler } from './services/intentScheduler.js';

async function main(): Promise<void> {
  logger.info('Starting FlowMint Server...');
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Network: ${config.solana.network}`);

  // Initialize database
  const db = new DatabaseService(config.database.url);
  await db.initialize();
  logger.info('Database initialized');

  // Create Express app
  const app = createApp(db);

  // Initialize intent scheduler for DCA and stop-loss
  const scheduler = new IntentScheduler(db);
  await scheduler.start();
  logger.info('Intent scheduler started');

  // Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
    logger.info(`API available at ${config.apiBaseUrl}`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');

      // Stop scheduler
      await scheduler.stop();
      logger.info('Intent scheduler stopped');

      // Close database
      db.close();
      logger.info('Database connection closed');

      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled Rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught Exception');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start server');
  process.exit(1);
});
