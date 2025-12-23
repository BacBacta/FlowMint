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
}
