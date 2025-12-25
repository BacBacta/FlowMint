/**
 * Database Factory
 *
 * Automatically selects SQLite or PostgreSQL based on DATABASE_URL.
 * - SQLite: Local development (file path or :memory:)
 * - PostgreSQL: Production (postgresql:// or postgres://)
 */

import { logger } from '../utils/logger.js';

import { DatabaseService } from './database.js';
import { PostgresService } from './postgres.js';

const log = logger.child({ service: 'DatabaseFactory' });

/**
 * Database interface (common methods)
 */
export interface IDatabase {
  initialize(): Promise<void>;
  close(): void | Promise<void>;

  // Receipts
  saveReceipt(receipt: any): Promise<void>;
  updateReceiptStatus(
    receiptId: string,
    status: 'success' | 'failed',
    txSignature?: string,
    error?: string
  ): Promise<void>;
  getReceipt(receiptId: string): Promise<any | null>;
  getUserReceipts(userPublicKey: string, limit?: number): Promise<any[]>;

  // Intents
  saveIntent(intent: any): Promise<void>;
  updateIntent(intent: any): Promise<void>;
  getIntent(intentId: string): Promise<any | null>;
  getUserIntents(userPublicKey: string): Promise<any[]>;
  getActiveIntents(): Promise<any[]>;
  getPendingDCAIntents(): Promise<any[]>;
  getActiveStopLossIntents(): Promise<any[]>;

  // Payments
  savePayment(payment: any): Promise<void>;
  updatePayment(payment: any): Promise<void>;
  getPayment(paymentId: string): Promise<any | null>;

  // Job Locks
  acquireJobLock(jobKey: string, intentId: string, scheduledAt: number): Promise<any | null>;
  updateJobLock(
    jobId: string,
    status: 'running' | 'completed' | 'failed',
    result?: string,
    error?: string
  ): Promise<void>;
  getJobLock(jobKey: string): Promise<any | null>;
  getJobsByIntentId(intentId: string): Promise<any[]>;
}

/**
 * Check if DATABASE_URL is PostgreSQL
 */
function isPostgres(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

/**
 * Create database instance based on DATABASE_URL
 */
export function createDatabase(databaseUrl: string): IDatabase {
  if (isPostgres(databaseUrl)) {
    log.info('Using PostgreSQL database');
    return new PostgresService(databaseUrl) as unknown as IDatabase;
  } else {
    log.info({ path: databaseUrl }, 'Using SQLite database');
    return new DatabaseService(databaseUrl) as unknown as IDatabase;
  }
}

/**
 * Get database type from URL
 */
export function getDatabaseType(databaseUrl: string): 'postgres' | 'sqlite' {
  return isPostgres(databaseUrl) ? 'postgres' : 'sqlite';
}
