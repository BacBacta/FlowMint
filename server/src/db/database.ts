/**
 * Database Service
 *
 * SQLite database for storing receipts, intents, and payments.
 * Uses sql.js for pure JavaScript SQLite (no native dependencies).
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../utils/logger.js';
import { Intent, IntentType, IntentStatus } from '../services/intentScheduler.js';
import { PaymentRecord } from '../services/paymentService.js';

/**
 * Receipt record
 */
export interface ReceiptRecord {
  receiptId: string;
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps: number;
  protectedMode: boolean;
  priceImpactPct: string;
  status: 'pending' | 'success' | 'failed';
  txSignature?: string;
  error?: string;
  timestamp: number;
}

/**
 * Database Service
 *
 * Manages SQLite database for FlowMint data persistence.
 */
export class DatabaseService {
  private db: SqlJsDatabase | null = null;
  private readonly log = logger.child({ service: 'DatabaseService' });
  private isMemory: boolean;

  constructor(private readonly dbPath: string) {
    this.isMemory = dbPath === ':memory:';
  }

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    this.log.info({ dbPath: this.dbPath }, 'Initializing database');

    const SQL = await initSqlJs();

    if (this.isMemory) {
      // In-memory database for tests
      this.db = new SQL.Database();
    } else {
      // Try to load existing database file
      try {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(this.dbPath)) {
          const buffer = fs.readFileSync(this.dbPath);
          this.db = new SQL.Database(buffer);
        } else {
          this.db = new SQL.Database();
        }
      } catch (error) {
        this.log.warn({ error }, 'Could not load database file, creating new one');
        this.db = new SQL.Database();
      }
    }

    this.createTables();
    this.log.info('Database initialized');
  }

  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Receipts table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS receipts (
        receipt_id TEXT PRIMARY KEY,
        user_public_key TEXT NOT NULL,
        input_mint TEXT NOT NULL,
        output_mint TEXT NOT NULL,
        in_amount TEXT NOT NULL,
        out_amount TEXT NOT NULL,
        slippage_bps INTEGER NOT NULL,
        protected_mode INTEGER NOT NULL,
        price_impact_pct TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_signature TEXT,
        error TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_public_key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_timestamp ON receipts(timestamp DESC)`);

    // Intents table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY,
        user_public_key TEXT NOT NULL,
        intent_type TEXT NOT NULL,
        token_from TEXT NOT NULL,
        token_to TEXT NOT NULL,
        total_amount TEXT NOT NULL,
        remaining_amount TEXT NOT NULL,
        interval_seconds INTEGER,
        amount_per_swap TEXT,
        price_threshold REAL,
        price_direction TEXT,
        price_feed_id TEXT,
        status TEXT NOT NULL,
        slippage_bps INTEGER NOT NULL,
        execution_count INTEGER DEFAULT 0,
        last_execution_at INTEGER,
        next_execution_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_intents_user ON intents(user_public_key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_intents_type ON intents(intent_type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_intents_next_execution ON intents(next_execution_at)`);

    // Payments table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id TEXT PRIMARY KEY,
        payer_public_key TEXT NOT NULL,
        merchant_public_key TEXT NOT NULL,
        input_token TEXT NOT NULL,
        input_amount TEXT NOT NULL,
        usdc_amount TEXT NOT NULL,
        memo TEXT,
        status TEXT NOT NULL,
        tx_signature TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_public_key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_public_key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);

    // Notifications table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_public_key TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_public_key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)`);

    // Receipt comparisons table (actual vs estimated)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS receipt_comparisons (
        receipt_id TEXT PRIMARY KEY,
        estimated_output TEXT NOT NULL,
        actual_output TEXT NOT NULL,
        difference TEXT NOT NULL,
        difference_percent REAL NOT NULL,
        slippage_used INTEGER NOT NULL,
        actual_slippage REAL NOT NULL,
        execution_time_ms INTEGER,
        retry_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (receipt_id) REFERENCES receipts(receipt_id)
      )
    `);

    // Job locks table (for idempotent intent execution)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS job_locks (
        id TEXT PRIMARY KEY,
        job_key TEXT UNIQUE NOT NULL,
        intent_id TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        result TEXT,
        error TEXT,
        attempts INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_job_locks_key ON job_locks(job_key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_job_locks_intent ON job_locks(intent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_job_locks_status ON job_locks(status)`);

    // Execution metrics table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS execution_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id TEXT,
        rpc_endpoint TEXT,
        success INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0,
        error_type TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_execution_metrics_created ON execution_metrics(created_at DESC)`);

    this.log.debug('Database tables created');
  }

  /**
   * Save database to file (call this after modifications)
   */
  private saveToFile(): void {
    if (!this.db || this.isMemory) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      this.log.error({ error }, 'Failed to save database to file');
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
      this.log.info('Database connection closed');
    }
  }

  // ==================== Receipt Methods ====================

  /**
   * Save a receipt
   */
  async saveReceipt(receipt: ReceiptRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO receipts (
        receipt_id, user_public_key, input_mint, output_mint,
        in_amount, out_amount, slippage_bps, protected_mode,
        price_impact_pct, status, tx_signature, error, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.receiptId,
        receipt.userPublicKey,
        receipt.inputMint,
        receipt.outputMint,
        receipt.inAmount,
        receipt.outAmount,
        receipt.slippageBps,
        receipt.protectedMode ? 1 : 0,
        receipt.priceImpactPct,
        receipt.status,
        receipt.txSignature || null,
        receipt.error || null,
        receipt.timestamp,
      ]
    );

    this.saveToFile();
  }

  /**
   * Update receipt status
   */
  async updateReceiptStatus(
    receiptId: string,
    status: 'success' | 'failed',
    txSignature?: string,
    error?: string
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE receipts SET status = ?, tx_signature = ?, error = ? WHERE receipt_id = ?`,
      [status, txSignature || null, error || null, receiptId]
    );

    this.saveToFile();
  }

  /**
   * Get receipt by ID
   */
  async getReceipt(receiptId: string): Promise<ReceiptRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec('SELECT * FROM receipts WHERE receipt_id = ?', [receiptId]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapReceiptRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Get receipts for a user
   */
  async getUserReceipts(userPublicKey: string, limit = 50): Promise<ReceiptRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM receipts WHERE user_public_key = ? ORDER BY timestamp DESC LIMIT ?`,
      [userPublicKey, limit]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row) => this.mapReceiptRow(result[0].columns, row));
  }

  private mapReceiptRow(columns: string[], values: any[]): ReceiptRecord {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      receiptId: row.receipt_id,
      userPublicKey: row.user_public_key,
      inputMint: row.input_mint,
      outputMint: row.output_mint,
      inAmount: row.in_amount,
      outAmount: row.out_amount,
      slippageBps: row.slippage_bps,
      protectedMode: row.protected_mode === 1,
      priceImpactPct: row.price_impact_pct,
      status: row.status,
      txSignature: row.tx_signature,
      error: row.error,
      timestamp: row.timestamp,
    };
  }

  // ==================== Intent Methods ====================

  /**
   * Save an intent
   */
  async saveIntent(intent: Intent): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO intents (
        id, user_public_key, intent_type, token_from, token_to,
        total_amount, remaining_amount, interval_seconds, amount_per_swap,
        price_threshold, price_direction, price_feed_id, status,
        slippage_bps, execution_count, last_execution_at, next_execution_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        intent.id,
        intent.userPublicKey,
        intent.intentType,
        intent.tokenFrom,
        intent.tokenTo,
        intent.totalAmount,
        intent.remainingAmount,
        intent.intervalSeconds || null,
        intent.amountPerSwap || null,
        intent.priceThreshold || null,
        intent.priceDirection || null,
        intent.priceFeedId || null,
        intent.status,
        intent.slippageBps,
        intent.executionCount,
        intent.lastExecutionAt || null,
        intent.nextExecutionAt || null,
        intent.createdAt,
        intent.updatedAt,
      ]
    );

    this.saveToFile();
  }

  /**
   * Update intent status
   */
  async updateIntentStatus(intentId: string, status: IntentStatus): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`UPDATE intents SET status = ?, updated_at = ? WHERE id = ?`, [
      status,
      Date.now(),
      intentId,
    ]);

    this.saveToFile();
  }

  /**
   * Update intent fields
   */
  async updateIntent(intentId: string, updates: Partial<Intent>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.remainingAmount !== undefined) {
      fields.push('remaining_amount = ?');
      values.push(updates.remainingAmount);
    }
    if (updates.executionCount !== undefined) {
      fields.push('execution_count = ?');
      values.push(updates.executionCount);
    }
    if (updates.lastExecutionAt !== undefined) {
      fields.push('last_execution_at = ?');
      values.push(updates.lastExecutionAt);
    }
    if (updates.nextExecutionAt !== undefined) {
      fields.push('next_execution_at = ?');
      values.push(updates.nextExecutionAt);
    }
    if (updates.updatedAt !== undefined) {
      fields.push('updated_at = ?');
      values.push(updates.updatedAt);
    }

    if (fields.length === 0) return;

    values.push(intentId);
    const sql = `UPDATE intents SET ${fields.join(', ')} WHERE id = ?`;
    this.db.run(sql, values);

    this.saveToFile();
  }

  /**
   * Get intent by ID
   */
  async getIntent(intentId: string): Promise<Intent | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec('SELECT * FROM intents WHERE id = ?', [intentId]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapIntentRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Get user's intents
   */
  async getUserIntents(userPublicKey: string): Promise<Intent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM intents WHERE user_public_key = ? ORDER BY created_at DESC`,
      [userPublicKey]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row) => this.mapIntentRow(result[0].columns, row));
  }

  /**
   * Get active intents by type
   */
  async getActiveIntents(intentType: IntentType): Promise<Intent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM intents WHERE intent_type = ? AND status = 'active'`,
      [intentType]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row) => this.mapIntentRow(result[0].columns, row));
  }

  private mapIntentRow(columns: string[], values: any[]): Intent {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      id: row.id,
      userPublicKey: row.user_public_key,
      intentType: row.intent_type as IntentType,
      tokenFrom: row.token_from,
      tokenTo: row.token_to,
      totalAmount: row.total_amount,
      remainingAmount: row.remaining_amount,
      intervalSeconds: row.interval_seconds,
      amountPerSwap: row.amount_per_swap,
      priceThreshold: row.price_threshold,
      priceDirection: row.price_direction,
      priceFeedId: row.price_feed_id,
      status: row.status as IntentStatus,
      slippageBps: row.slippage_bps,
      executionCount: row.execution_count,
      lastExecutionAt: row.last_execution_at,
      nextExecutionAt: row.next_execution_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ==================== Payment Methods ====================

  /**
   * Save a payment
   */
  async savePayment(payment: PaymentRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO payments (
        payment_id, payer_public_key, merchant_public_key,
        input_token, input_amount, usdc_amount, memo,
        status, tx_signature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payment.paymentId,
        payment.payerPublicKey,
        payment.merchantPublicKey,
        payment.inputToken,
        payment.inputAmount,
        payment.usdcAmount,
        payment.memo || null,
        payment.status,
        payment.txSignature || null,
        payment.createdAt,
        payment.updatedAt,
      ]
    );

    this.saveToFile();
  }

  /**
   * Update payment status
   */
  async updatePaymentStatus(
    paymentId: string,
    status: 'success' | 'failed',
    txSignature?: string
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE payments SET status = ?, tx_signature = ?, updated_at = ? WHERE payment_id = ?`,
      [status, txSignature || null, Date.now(), paymentId]
    );

    this.saveToFile();
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec('SELECT * FROM payments WHERE payment_id = ?', [paymentId]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapPaymentRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Get payments for a user
   */
  async getUserPayments(publicKey: string): Promise<PaymentRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM payments WHERE payer_public_key = ? OR merchant_public_key = ? ORDER BY created_at DESC`,
      [publicKey, publicKey]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row) => this.mapPaymentRow(result[0].columns, row));
  }

  private mapPaymentRow(columns: string[], values: any[]): PaymentRecord {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      paymentId: row.payment_id,
      payerPublicKey: row.payer_public_key,
      merchantPublicKey: row.merchant_public_key,
      inputToken: row.input_token,
      inputAmount: row.input_amount,
      usdcAmount: row.usdc_amount,
      memo: row.memo,
      status: row.status,
      txSignature: row.tx_signature,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ==================== Notification Methods ====================

  /**
   * Save a notification
   */
  async saveNotification(notification: {
    id: string;
    userPublicKey: string;
    type: string;
    priority: string;
    title: string;
    message: string;
    data?: Record<string, any>;
    read: boolean;
    createdAt: number;
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO notifications (
        id, user_public_key, type, priority, title, message, data, read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        notification.id,
        notification.userPublicKey,
        notification.type,
        notification.priority,
        notification.title,
        notification.message,
        notification.data ? JSON.stringify(notification.data) : null,
        notification.read ? 1 : 0,
        notification.createdAt,
      ]
    );

    this.saveToFile();
  }

  /**
   * Get user's notifications
   */
  async getUserNotifications(
    userPublicKey: string,
    limit = 50,
    unreadOnly = false
  ): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    const query = unreadOnly
      ? `SELECT * FROM notifications WHERE user_public_key = ? AND read = 0 ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM notifications WHERE user_public_key = ? ORDER BY created_at DESC LIMIT ?`;

    const result = this.db.exec(query, [userPublicKey, limit]);

    if (result.length === 0) return [];

    return result[0].values.map((row) => {
      const cols = result[0].columns;
      const obj: Record<string, any> = {};
      cols.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return {
        id: obj.id,
        userPublicKey: obj.user_public_key,
        type: obj.type,
        priority: obj.priority,
        title: obj.title,
        message: obj.message,
        data: obj.data ? JSON.parse(obj.data) : null,
        read: obj.read === 1,
        createdAt: obj.created_at,
      };
    });
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`UPDATE notifications SET read = 1 WHERE id = ?`, [notificationId]);
    this.saveToFile();
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(userPublicKey: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`UPDATE notifications SET read = 1 WHERE user_public_key = ?`, [userPublicKey]);
    this.saveToFile();
  }

  /**
   * Get unread notification count
   */
  async getUnreadNotificationCount(userPublicKey: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT COUNT(*) as count FROM notifications WHERE user_public_key = ? AND read = 0`,
      [userPublicKey]
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  // ==================== Analytics Methods ====================

  /**
   * Save receipt comparison (actual vs estimated)
   */
  async saveReceiptComparison(comparison: {
    receiptId: string;
    estimatedOutput: string;
    actualOutput: string;
    difference: string;
    differencePercent: number;
    slippageUsed: number;
    actualSlippage: number;
    executionTimeMs?: number;
    retryCount?: number;
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT OR REPLACE INTO receipt_comparisons (
        receipt_id, estimated_output, actual_output, difference,
        difference_percent, slippage_used, actual_slippage,
        execution_time_ms, retry_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        comparison.receiptId,
        comparison.estimatedOutput,
        comparison.actualOutput,
        comparison.difference,
        comparison.differencePercent,
        comparison.slippageUsed,
        comparison.actualSlippage,
        comparison.executionTimeMs || 0,
        comparison.retryCount || 0,
        Date.now(),
      ]
    );

    this.saveToFile();
  }

  /**
   * Get receipt comparison
   */
  async getReceiptComparison(receiptId: string): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM receipt_comparisons WHERE receipt_id = ?`,
      [receiptId]
    );

    if (result.length === 0 || result[0].values.length === 0) return null;

    const cols = result[0].columns;
    const row = result[0].values[0];
    const obj: Record<string, any> = {};
    cols.forEach((col, idx) => {
      obj[col] = row[idx];
    });

    return {
      receiptId: obj.receipt_id,
      estimatedOutput: obj.estimated_output,
      actualOutput: obj.actual_output,
      difference: obj.difference,
      differencePercent: obj.difference_percent,
      slippageUsed: obj.slippage_used,
      actualSlippage: obj.actual_slippage,
      executionTimeMs: obj.execution_time_ms,
      retryCount: obj.retry_count,
    };
  }

  /**
   * Save execution metric
   */
  async saveExecutionMetric(metric: {
    receiptId?: string;
    rpcEndpoint: string;
    success: boolean;
    latencyMs: number;
    retryCount?: number;
    errorType?: string;
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO execution_metrics (
        receipt_id, rpc_endpoint, success, latency_ms, retry_count, error_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        metric.receiptId || null,
        metric.rpcEndpoint,
        metric.success ? 1 : 0,
        metric.latencyMs,
        metric.retryCount || 0,
        metric.errorType || null,
        Date.now(),
      ]
    );

    this.saveToFile();
  }

  /**
   * Get receipts since timestamp
   */
  async getReceiptsSince(since: number): Promise<ReceiptRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM receipts WHERE timestamp >= ? ORDER BY timestamp DESC`,
      [since]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) => this.mapReceiptRow(result[0].columns, row));
  }

  /**
   * Get intents since timestamp
   */
  async getIntentsSince(since: number): Promise<Intent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM intents WHERE created_at >= ? ORDER BY created_at DESC`,
      [since]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) => this.mapIntentRow(result[0].columns, row));
  }

  /**
   * Get all active intents
   */
  async getAllActiveIntents(): Promise<Intent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM intents WHERE status = 'active'`);

    if (result.length === 0) return [];
    return result[0].values.map((row) => this.mapIntentRow(result[0].columns, row));
  }

  /**
   * Get user statistics
   */
  async getUserStats(since: number): Promise<{
    totalUsers: number;
    activeUsers: number;
    newUsers: number;
    returningUsers: number;
    totalSwaps: number;
    powerUsers: number;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    // Total unique users ever
    const totalResult = this.db.exec(`SELECT COUNT(DISTINCT user_public_key) as count FROM receipts`);
    const totalUsers = totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0;

    // Active users in period
    const activeResult = this.db.exec(
      `SELECT COUNT(DISTINCT user_public_key) as count FROM receipts WHERE timestamp >= ?`,
      [since]
    );
    const activeUsers = activeResult.length > 0 ? (activeResult[0].values[0][0] as number) : 0;

    // New users (first swap in period)
    const newResult = this.db.exec(
      `SELECT COUNT(*) as count FROM (
        SELECT user_public_key, MIN(timestamp) as first_swap FROM receipts
        GROUP BY user_public_key
        HAVING first_swap >= ?
      )`,
      [since]
    );
    const newUsers = newResult.length > 0 ? (newResult[0].values[0][0] as number) : 0;

    // Total swaps in period
    const swapsResult = this.db.exec(
      `SELECT COUNT(*) as count FROM receipts WHERE timestamp >= ?`,
      [since]
    );
    const totalSwaps = swapsResult.length > 0 ? (swapsResult[0].values[0][0] as number) : 0;

    // Power users (>10 swaps)
    const powerResult = this.db.exec(
      `SELECT COUNT(*) as count FROM (
        SELECT user_public_key, COUNT(*) as swap_count FROM receipts
        GROUP BY user_public_key
        HAVING swap_count > 10
      )`
    );
    const powerUsers = powerResult.length > 0 ? (powerResult[0].values[0][0] as number) : 0;

    return {
      totalUsers,
      activeUsers,
      newUsers,
      returningUsers: activeUsers - newUsers,
      totalSwaps,
      powerUsers,
    };
  }

  /**
   * Get execution statistics
   */
  async getExecutionStats(since: number): Promise<{
    averageExecutionTimeMs: number;
    rpcSuccessRate: number;
    averageRetries: number;
    averageSlippageDifference: number;
    quoteAccuracy: number;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    // Execution metrics
    const metricsResult = this.db.exec(
      `SELECT 
        AVG(latency_ms) as avg_latency,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
        AVG(retry_count) as avg_retries
      FROM execution_metrics WHERE created_at >= ?`,
      [since]
    );

    // Comparison accuracy
    const compResult = this.db.exec(
      `SELECT 
        AVG(ABS(difference_percent)) as avg_diff,
        AVG(CASE WHEN ABS(difference_percent) < 0.5 THEN 1.0 ELSE 0.0 END) as accuracy
      FROM receipt_comparisons WHERE created_at >= ?`,
      [since]
    );

    const metrics = metricsResult.length > 0 ? metricsResult[0].values[0] : [0, 1, 0];
    const comp = compResult.length > 0 ? compResult[0].values[0] : [0, 1];

    return {
      averageExecutionTimeMs: (metrics[0] as number) || 0,
      rpcSuccessRate: (metrics[1] as number) || 1,
      averageRetries: (metrics[2] as number) || 0,
      averageSlippageDifference: (comp[0] as number) || 0,
      quoteAccuracy: (comp[1] as number) || 1,
    };
  }

  // ==================== Job Lock Methods ====================

  /**
   * Create a new job lock
   */
  async createJobLock(job: {
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    attempts: number;
    createdAt: number;
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO job_locks (
        id, job_key, intent_id, scheduled_at, status, started_at, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.jobKey,
        job.intentId,
        job.scheduledAt,
        job.status,
        job.startedAt || null,
        job.attempts,
        job.createdAt,
      ]
    );

    this.saveToFile();
  }

  /**
   * Get job by key
   */
  async getJobByKey(jobKey: string): Promise<{
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    completedAt?: number;
    result?: string;
    error?: string;
    attempts: number;
    createdAt: number;
  } | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec('SELECT * FROM job_locks WHERE job_key = ?', [jobKey]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapJobLockRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Get job by ID
   */
  async getJobById(jobId: string): Promise<{
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    completedAt?: number;
    result?: string;
    error?: string;
    attempts: number;
    createdAt: number;
  } | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec('SELECT * FROM job_locks WHERE id = ?', [jobId]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapJobLockRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Update job status and fields
   */
  async updateJobLock(
    jobId: string,
    updates: {
      status?: string;
      startedAt?: number;
      completedAt?: number;
      result?: string;
      error?: string;
      attempts?: number;
    }
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt);
    }
    if (updates.result !== undefined) {
      fields.push('result = ?');
      values.push(updates.result);
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.attempts !== undefined) {
      fields.push('attempts = ?');
      values.push(updates.attempts);
    }

    if (fields.length === 0) return;

    values.push(jobId);
    const sql = `UPDATE job_locks SET ${fields.join(', ')} WHERE id = ?`;
    this.db.run(sql, values);

    this.saveToFile();
  }

  /**
   * Get jobs for an intent
   */
  async getJobsByIntent(intentId: string): Promise<Array<{
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    completedAt?: number;
    result?: string;
    error?: string;
    attempts: number;
    createdAt: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      'SELECT * FROM job_locks WHERE intent_id = ? ORDER BY scheduled_at DESC',
      [intentId]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row) => this.mapJobLockRow(result[0].columns, row));
  }

  /**
   * Get stale running jobs (for cleanup)
   */
  async getStaleJobs(staleThresholdMs: number = 300000): Promise<Array<{
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    attempts: number;
    createdAt: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const threshold = Date.now() - staleThresholdMs;

    const result = this.db.exec(
      `SELECT * FROM job_locks WHERE status = 'running' AND started_at < ?`,
      [threshold]
    );

    if (result.length === 0) return [];

    return result[0].values.map((row) => this.mapJobLockRow(result[0].columns, row));
  }

  private mapJobLockRow(columns: string[], values: any[]): {
    id: string;
    jobKey: string;
    intentId: string;
    scheduledAt: number;
    status: string;
    startedAt?: number;
    completedAt?: number;
    result?: string;
    error?: string;
    attempts: number;
    createdAt: number;
  } {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      id: row.id,
      jobKey: row.job_key,
      intentId: row.intent_id,
      scheduledAt: row.scheduled_at,
      status: row.status,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      result: row.result || undefined,
      error: row.error || undefined,
      attempts: row.attempts,
      createdAt: row.created_at,
    };
  }
}

