/**
 * PostgreSQL Database Service
 *
 * PostgreSQL adapter for production deployment on Vercel/Neon.
 * Provides the same interface as the SQLite DatabaseService.
 */

import { Pool, PoolClient } from 'pg';

import { Intent, IntentType, IntentStatus } from '../services/intentScheduler.js';
import { PaymentRecord } from '../services/paymentService.js';
import { logger } from '../utils/logger.js';

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
 * Job lock record
 */
export interface JobLock {
  id: string;
  jobKey: string;
  intentId: string;
  scheduledAt: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  attempts: number;
  createdAt: number;
}

/**
 * PostgreSQL Database Service
 */
export class PostgresService {
  private pool: Pool | null = null;
  private readonly log = logger.child({ service: 'PostgresService' });

  constructor(private readonly connectionString: string) {}

  /**
   * Initialize the database connection pool
   */
  async initialize(): Promise<void> {
    this.log.info('Initializing PostgreSQL connection');

    this.pool = new Pool({
      connectionString: this.connectionString,
      ssl: {
        rejectUnauthorized: false, // Required for Neon
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT NOW()');
      this.log.info('PostgreSQL connection established');
    } finally {
      client.release();
    }

    await this.createTables();
    this.log.info('PostgreSQL initialized');
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    const client = await this.pool.connect();
    try {
      // Receipts table
      await client.query(`
        CREATE TABLE IF NOT EXISTS receipts (
          receipt_id TEXT PRIMARY KEY,
          user_public_key TEXT NOT NULL,
          input_mint TEXT NOT NULL,
          output_mint TEXT NOT NULL,
          in_amount TEXT NOT NULL,
          out_amount TEXT NOT NULL,
          slippage_bps INTEGER NOT NULL,
          protected_mode BOOLEAN NOT NULL,
          price_impact_pct TEXT NOT NULL,
          status TEXT NOT NULL,
          tx_signature TEXT,
          error TEXT,
          timestamp BIGINT NOT NULL,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
        )
      `);

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_public_key)`
      );
      await client.query(`CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status)`);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_receipts_timestamp ON receipts(timestamp DESC)`
      );

      // Intents table
      await client.query(`
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
          price_threshold DOUBLE PRECISION,
          price_direction TEXT,
          price_feed_id TEXT,
          status TEXT NOT NULL,
          slippage_bps INTEGER NOT NULL,
          execution_count INTEGER DEFAULT 0,
          last_execution_at BIGINT,
          next_execution_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_intents_user ON intents(user_public_key)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_intents_type ON intents(intent_type)`);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_intents_next_execution ON intents(next_execution_at)`
      );

      // Payments table
      await client.query(`
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
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_public_key)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_public_key)`
      );
      await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);

      // Notifications table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_public_key TEXT NOT NULL,
          type TEXT NOT NULL,
          priority TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          data TEXT,
          read BOOLEAN DEFAULT FALSE,
          created_at BIGINT NOT NULL
        )
      `);

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_public_key)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)`
      );

      // Job locks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS job_locks (
          id TEXT PRIMARY KEY,
          job_key TEXT UNIQUE NOT NULL,
          intent_id TEXT NOT NULL,
          scheduled_at BIGINT NOT NULL,
          status TEXT NOT NULL,
          started_at BIGINT,
          completed_at BIGINT,
          result TEXT,
          error TEXT,
          attempts INTEGER DEFAULT 1,
          created_at BIGINT NOT NULL
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_job_locks_key ON job_locks(job_key)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_job_locks_intent ON job_locks(intent_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_job_locks_status ON job_locks(status)`);

      // Execution metrics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS execution_metrics (
          id SERIAL PRIMARY KEY,
          receipt_id TEXT,
          rpc_endpoint TEXT,
          success BOOLEAN NOT NULL,
          latency_ms INTEGER NOT NULL,
          retry_count INTEGER DEFAULT 0,
          error_type TEXT,
          created_at BIGINT NOT NULL
        )
      `);

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_execution_metrics_created ON execution_metrics(created_at DESC)`
      );

      this.log.debug('PostgreSQL tables created');
    } finally {
      client.release();
    }
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.log.info('PostgreSQL connection closed');
    }
  }

  // ==================== Receipt Methods ====================

  async saveReceipt(receipt: ReceiptRecord): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(
      `INSERT INTO receipts (
        receipt_id, user_public_key, input_mint, output_mint,
        in_amount, out_amount, slippage_bps, protected_mode,
        price_impact_pct, status, tx_signature, error, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        receipt.receiptId,
        receipt.userPublicKey,
        receipt.inputMint,
        receipt.outputMint,
        receipt.inAmount,
        receipt.outAmount,
        receipt.slippageBps,
        receipt.protectedMode,
        receipt.priceImpactPct,
        receipt.status,
        receipt.txSignature || null,
        receipt.error || null,
        receipt.timestamp,
      ]
    );
  }

  async updateReceiptStatus(
    receiptId: string,
    status: 'success' | 'failed',
    txSignature?: string,
    error?: string
  ): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(
      `UPDATE receipts SET status = $1, tx_signature = $2, error = $3 WHERE receipt_id = $4`,
      [status, txSignature || null, error || null, receiptId]
    );
  }

  async getReceipt(receiptId: string): Promise<ReceiptRecord | null> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query('SELECT * FROM receipts WHERE receipt_id = $1', [
      receiptId,
    ]);

    if (result.rows.length === 0) return null;

    return this.mapReceiptRow(result.rows[0]);
  }

  async getUserReceipts(userPublicKey: string, limit = 50): Promise<ReceiptRecord[]> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query(
      `SELECT * FROM receipts WHERE user_public_key = $1 ORDER BY timestamp DESC LIMIT $2`,
      [userPublicKey, limit]
    );

    return result.rows.map(row => this.mapReceiptRow(row));
  }

  private mapReceiptRow(row: any): ReceiptRecord {
    return {
      receiptId: row.receipt_id,
      userPublicKey: row.user_public_key,
      inputMint: row.input_mint,
      outputMint: row.output_mint,
      inAmount: row.in_amount,
      outAmount: row.out_amount,
      slippageBps: row.slippage_bps,
      protectedMode: row.protected_mode,
      priceImpactPct: row.price_impact_pct,
      status: row.status,
      txSignature: row.tx_signature,
      error: row.error,
      timestamp: Number(row.timestamp),
    };
  }

  // ==================== Intent Methods ====================

  async saveIntent(intent: Intent): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(
      `INSERT INTO intents (
        id, user_public_key, intent_type, token_from, token_to,
        total_amount, remaining_amount, interval_seconds, amount_per_swap,
        price_threshold, price_direction, price_feed_id, status,
        slippage_bps, execution_count, last_execution_at, next_execution_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
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
        intent.executionCount || 0,
        intent.lastExecutionAt || null,
        intent.nextExecutionAt || null,
        intent.createdAt,
        intent.updatedAt,
      ]
    );
  }

  async updateIntent(intent: Intent): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(
      `UPDATE intents SET
        remaining_amount = $1, status = $2, execution_count = $3,
        last_execution_at = $4, next_execution_at = $5, updated_at = $6
      WHERE id = $7`,
      [
        intent.remainingAmount,
        intent.status,
        intent.executionCount,
        intent.lastExecutionAt || null,
        intent.nextExecutionAt || null,
        intent.updatedAt,
        intent.id,
      ]
    );
  }

  async getIntent(intentId: string): Promise<Intent | null> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query('SELECT * FROM intents WHERE id = $1', [intentId]);

    if (result.rows.length === 0) return null;

    return this.mapIntentRow(result.rows[0]);
  }

  async getUserIntents(userPublicKey: string): Promise<Intent[]> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query(
      `SELECT * FROM intents WHERE user_public_key = $1 ORDER BY created_at DESC`,
      [userPublicKey]
    );

    return result.rows.map(row => this.mapIntentRow(row));
  }

  async getActiveIntents(): Promise<Intent[]> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query(
      `SELECT * FROM intents WHERE status = $1 ORDER BY next_execution_at ASC`,
      [IntentStatus.ACTIVE]
    );

    return result.rows.map(row => this.mapIntentRow(row));
  }

  async getPendingDCAIntents(): Promise<Intent[]> {
    if (!this.pool) throw new Error('Database not initialized');

    const now = Date.now();
    const result = await this.pool.query(
      `SELECT * FROM intents 
       WHERE intent_type = $1 AND status = $2 
       AND (next_execution_at IS NULL OR next_execution_at <= $3)
       ORDER BY next_execution_at ASC`,
      [IntentType.DCA, IntentStatus.ACTIVE, now]
    );

    return result.rows.map(row => this.mapIntentRow(row));
  }

  async getActiveStopLossIntents(): Promise<Intent[]> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query(
      `SELECT * FROM intents WHERE intent_type = $1 AND status = $2`,
      [IntentType.STOP_LOSS, IntentStatus.ACTIVE]
    );

    return result.rows.map(row => this.mapIntentRow(row));
  }

  private mapIntentRow(row: any): Intent {
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
      lastExecutionAt: row.last_execution_at ? Number(row.last_execution_at) : undefined,
      nextExecutionAt: row.next_execution_at ? Number(row.next_execution_at) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ==================== Payment Methods ====================

  async savePayment(payment: PaymentRecord): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(
      `INSERT INTO payments (
        payment_id, payer_public_key, merchant_public_key,
        input_token, input_amount, usdc_amount, memo,
        status, tx_signature, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
  }

  async updatePayment(payment: PaymentRecord): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(
      `UPDATE payments SET status = $1, tx_signature = $2, updated_at = $3 WHERE payment_id = $4`,
      [payment.status, payment.txSignature || null, payment.updatedAt, payment.paymentId]
    );
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query('SELECT * FROM payments WHERE payment_id = $1', [
      paymentId,
    ]);

    if (result.rows.length === 0) return null;

    return this.mapPaymentRow(result.rows[0]);
  }

  private mapPaymentRow(row: any): PaymentRecord {
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
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ==================== Job Lock Methods ====================

  async acquireJobLock(
    jobKey: string,
    intentId: string,
    scheduledAt: number
  ): Promise<JobLock | null> {
    if (!this.pool) throw new Error('Database not initialized');

    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    try {
      await this.pool.query(
        `INSERT INTO job_locks (id, job_key, intent_id, scheduled_at, status, attempts, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, jobKey, intentId, scheduledAt, 'pending', 1, now]
      );

      return {
        id,
        jobKey,
        intentId,
        scheduledAt,
        status: 'pending',
        attempts: 1,
        createdAt: now,
      };
    } catch (error: any) {
      // Unique constraint violation = job already exists
      if (error.code === '23505') {
        return null;
      }
      throw error;
    }
  }

  async updateJobLock(
    jobId: string,
    status: 'running' | 'completed' | 'failed',
    result?: string,
    error?: string
  ): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    const now = Date.now();
    const completedAt = status === 'completed' || status === 'failed' ? now : null;

    await this.pool.query(
      `UPDATE job_locks SET 
        status = $1, started_at = COALESCE(started_at, $2), 
        completed_at = $3, result = $4, error = $5
       WHERE id = $6`,
      [status, now, completedAt, result || null, error || null, jobId]
    );
  }

  async getJobLock(jobKey: string): Promise<JobLock | null> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query('SELECT * FROM job_locks WHERE job_key = $1', [jobKey]);

    if (result.rows.length === 0) return null;

    return this.mapJobLockRow(result.rows[0]);
  }

  async getJobsByIntentId(intentId: string): Promise<JobLock[]> {
    if (!this.pool) throw new Error('Database not initialized');

    const result = await this.pool.query(
      'SELECT * FROM job_locks WHERE intent_id = $1 ORDER BY scheduled_at DESC',
      [intentId]
    );

    return result.rows.map(row => this.mapJobLockRow(row));
  }

  private mapJobLockRow(row: any): JobLock {
    return {
      id: row.id,
      jobKey: row.job_key,
      intentId: row.intent_id,
      scheduledAt: Number(row.scheduled_at),
      status: row.status,
      startedAt: row.started_at ? Number(row.started_at) : undefined,
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
      result: row.result,
      error: row.error,
      attempts: row.attempts,
      createdAt: Number(row.created_at),
    };
  }
}
