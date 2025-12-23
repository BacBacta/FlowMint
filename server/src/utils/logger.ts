/**
 * Logger Utility
 *
 * Configures Pino logger for structured logging.
 */

import pino from 'pino';

import { config } from '../config/index.js';

/**
 * Application logger instance
 */
export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'flowmint-server',
    env: config.nodeEnv,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/**
 * Create a child logger with additional context
 *
 * @param context - Additional context to include in logs
 * @returns Child logger instance
 */
export function createLogger(context: Record<string, unknown>): pino.Logger {
  return logger.child(context);
}
