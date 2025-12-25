/**
 * Database Service
 *
 * SQLite database for storing receipts, intents, and payments.
 * Uses sql.js for pure JavaScript SQLite (no native dependencies).
 */

import * as fs from 'fs';
import * as path from 'path';

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

import { Intent, IntentType, IntentStatus } from '../services/intentScheduler.js';
import { PaymentRecord } from '../services/paymentService.js';
import { logger } from '../utils/logger.js';

export interface PaymentLinkRecord {
  paymentId: string;
  merchantId: string;
  orderId: string;
  amountUsdc: string; // smallest unit (6 decimals)
  status: 'pending' | 'completed' | 'expired' | 'failed';
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export type ExecutionEventType =
  | 'quote'
  | 'requote'
  | 'flowmint_inject'
  | 'tx_build'
  | 'tx_send'
  | 'tx_confirm'
  | 'retry'
  | 'success'
  | 'failure'
  | 'mev_submit';

export interface ExecutionEventRecord {
  id?: number;
  receiptId: string;
  eventType: ExecutionEventType;
  timestamp: number;
  rpcEndpoint?: string;
  priorityFee?: number;
  slippageBps?: number;
  signature?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Token delegation record for non-custodial DCA
 */
export interface DelegationRecord {
  id: string;
  userPublicKey: string;
  tokenMint: string;
  tokenAccount: string;
  delegatePublicKey: string;
  approvedAmount: string;
  remainingAmount: string;
  status: 'pending' | 'active' | 'revoked' | 'exhausted';
  intentId?: string;
  approvalSignature?: string;
  createdAt: number;
  updatedAt: number;
}

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

// ==================== PortfolioPay V1 Types ====================

/**
 * Merchant record
 */
export interface MerchantRecord {
  id: string;
  name: string;
  settleMint: string;
  webhookUrl?: string;
  apiKeyHash?: string;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: number;
  updatedAt: number;
}

/**
 * Policy record for merchant payment rules
 */
export interface PolicyRecord {
  id: string;
  merchantId: string;
  name: string;
  jsonCanonical: string;
  hash: string;
  version: number;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  maxHops: number;
  protectedMode: boolean;
  allowedTokens?: string[];
  deniedTokens?: string[];
  createdAt: number;
}

/**
 * Invoice record
 */
export interface InvoiceRecord {
  id: string;
  merchantId: string;
  orderId?: string;
  settleMint: string;
  amountOut: string;
  policyId?: string;
  status: 'pending' | 'reserved' | 'paid' | 'expired' | 'failed' | 'refunded' | 'cancelled';
  idempotencyKey?: string;
  payerPublicKey?: string;
  reservedUntil?: number;
  expiresAt: number;
  paidAt?: number;
  txSignature?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payment quote record
 */
export interface PaymentQuoteRecord {
  id: string;
  invoiceId: string;
  payer: string;
  payMint: string;
  planJson: string;
  riskJson: string;
  feesJson?: string;
  requiresGasless: boolean;
  ttlMs: number;
  expiresAt: number;
  createdAt: number;
}

/**
 * Payment attempt type
 */
export type PaymentAttemptEventType =
  | 'quote'
  | 'build'
  | 'send'
  | 'gasless_submit'
  | 'confirm'
  | 'requote'
  | 'retry'
  | 'success'
  | 'failure'
  | 'refund';

/**
 * Payment attempt record
 */
export interface PaymentAttemptRecord {
  id?: number;
  invoiceId: string;
  quoteId?: string;
  attemptNo: number;
  eventType: PaymentAttemptEventType;
  mode?: 'normal' | 'gasless';
  signature?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  metadataJson?: string;
  createdAt: number;
}

/**
 * Attestation record
 */
export interface AttestationRecord {
  id: string;
  invoiceId: string;
  policyHash: string;
  payloadJson: string;
  plannedJson: string;
  actualJson: string;
  signerPubkey: string;
  signature: string;
  verificationUrl?: string;
  createdAt: number;
}

/**
 * Relayer submission record
 */
export interface RelayerSubmissionRecord {
  id: string;
  invoiceId: string;
  payer: string;
  signedTxHash: string;
  relayerFeeLamports?: number;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  signature?: string;
  error?: string;
  submittedAt: number;
  confirmedAt?: number;
  createdAt: number;
}

// ==================== V1.5 Split-Tender Types ====================

/**
 * Split-tender strategy
 */
export type SplitTenderStrategy = 'min-risk' | 'min-slippage' | 'min-failure';

/**
 * Invoice reservation record (for multi-leg payments)
 */
export interface InvoiceReservationRecord {
  id: string;
  invoiceId: string;
  payer: string;
  strategy: SplitTenderStrategy;
  planJson: string;
  totalLegs: number;
  completedLegs: number;
  usdcCollected: string;
  status: 'active' | 'completed' | 'expired' | 'failed' | 'cancelled' | 'partial-failure';
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payment leg status
 */
export type PaymentLegStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/**
 * Payment leg record (individual swap in split-tender)
 */
export interface PaymentLegRecord {
  id: string;
  reservationId: string;
  invoiceId: string;
  legIndex: number;
  payMint: string;
  amountIn: string;
  expectedUsdcOut: string;
  actualUsdcOut?: string;
  routeJson?: string;
  riskJson?: string;
  status: PaymentLegStatus;
  txSignature?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
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
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_intents_next_execution ON intents(next_execution_at)`
    );

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
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_public_key)`
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);

    // Payment links (invoices) table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS payment_links (
        payment_id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        amount_usdc TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payment_links_merchant ON payment_links(merchant_id)`
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status)`);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payment_links_expires ON payment_links(expires_at)`
    );

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

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_public_key)`
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)`);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)`
    );

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

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_execution_metrics_created ON execution_metrics(created_at DESC)`
    );

    // Execution events table (timeline for receipts)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS execution_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        rpc_endpoint TEXT,
        priority_fee INTEGER,
        slippage_bps INTEGER,
        signature TEXT,
        status TEXT,
        error_code TEXT,
        error_message TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (receipt_id) REFERENCES receipts(receipt_id)
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_execution_events_receipt ON execution_events(receipt_id)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_execution_events_timestamp ON execution_events(timestamp)`
    );

    // Token delegations table (for non-custodial DCA)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS token_delegations (
        id TEXT PRIMARY KEY,
        user_public_key TEXT NOT NULL,
        token_mint TEXT NOT NULL,
        token_account TEXT NOT NULL,
        delegate_public_key TEXT NOT NULL,
        approved_amount TEXT NOT NULL,
        remaining_amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        intent_id TEXT,
        approval_signature TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_delegations_user ON token_delegations(user_public_key)`
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_delegations_status ON token_delegations(status)`);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_delegations_intent ON token_delegations(intent_id)`
    );

    // ==================== PortfolioPay V1 Tables ====================

    // Merchants table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        settle_mint TEXT NOT NULL,
        webhook_url TEXT,
        api_key_hash TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status)`);

    // Policies table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        json_canonical TEXT NOT NULL,
        hash TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        max_slippage_bps INTEGER DEFAULT 100,
        max_price_impact_bps INTEGER DEFAULT 300,
        max_hops INTEGER DEFAULT 4,
        protected_mode INTEGER DEFAULT 0,
        allowed_tokens TEXT,
        denied_tokens TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_policies_merchant ON policies(merchant_id)`);
    this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_hash ON policies(hash)`);

    // Invoices table (extends payment_links concept)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        order_id TEXT,
        settle_mint TEXT NOT NULL,
        amount_out TEXT NOT NULL,
        policy_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        idempotency_key TEXT UNIQUE,
        payer_public_key TEXT,
        reserved_until INTEGER,
        expires_at INTEGER NOT NULL,
        paid_at INTEGER,
        tx_signature TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id),
        FOREIGN KEY (policy_id) REFERENCES policies(id)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoices_expires ON invoices(expires_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoices_payer ON invoices(payer_public_key)`);

    // Payment quotes table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS payment_quotes (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        payer TEXT NOT NULL,
        pay_mint TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        risk_json TEXT NOT NULL,
        fees_json TEXT,
        requires_gasless INTEGER DEFAULT 0,
        ttl_ms INTEGER DEFAULT 15000,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payment_quotes_invoice ON payment_quotes(invoice_id)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payment_quotes_expires ON payment_quotes(expires_at)`
    );

    // Payment attempts table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS payment_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT NOT NULL,
        quote_id TEXT,
        attempt_no INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        mode TEXT,
        signature TEXT,
        status TEXT,
        error_code TEXT,
        error_message TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id),
        FOREIGN KEY (quote_id) REFERENCES payment_quotes(id)
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON payment_attempts(invoice_id)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_payment_attempts_quote ON payment_attempts(quote_id)`
    );

    // Attestations table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS attestations (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        planned_json TEXT NOT NULL,
        actual_json TEXT NOT NULL,
        signer_pubkey TEXT NOT NULL,
        signature TEXT NOT NULL,
        verification_url TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_attestations_invoice ON attestations(invoice_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_attestations_policy ON attestations(policy_hash)`);

    // Relayer submissions table (for gasless tracking)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS relayer_submissions (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        payer TEXT NOT NULL,
        signed_tx_hash TEXT NOT NULL,
        relayer_fee_lamports INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        signature TEXT,
        error TEXT,
        submitted_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_relayer_invoice ON relayer_submissions(invoice_id)`
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relayer_status ON relayer_submissions(status)`);

    // ==================== V1.5 Split-Tender Tables ====================

    // Invoice reservations table (prevents double payment during multi-leg)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS invoice_reservations (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL UNIQUE,
        payer TEXT NOT NULL,
        strategy TEXT NOT NULL DEFAULT 'min-risk',
        plan_json TEXT NOT NULL,
        total_legs INTEGER NOT NULL,
        completed_legs INTEGER NOT NULL DEFAULT 0,
        usdc_collected TEXT NOT NULL DEFAULT '0',
        status TEXT NOT NULL DEFAULT 'active',
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_reservations_invoice ON invoice_reservations(invoice_id)`
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_payer ON invoice_reservations(payer)`);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_reservations_status ON invoice_reservations(status)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_reservations_expires ON invoice_reservations(expires_at)`
    );

    // Payment legs table (tracks individual token swaps in split-tender)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS payment_legs (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        leg_index INTEGER NOT NULL,
        pay_mint TEXT NOT NULL,
        amount_in TEXT NOT NULL,
        expected_usdc_out TEXT NOT NULL,
        actual_usdc_out TEXT,
        route_json TEXT,
        risk_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        tx_signature TEXT,
        error_code TEXT,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (reservation_id) REFERENCES invoice_reservations(id),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_legs_reservation ON payment_legs(reservation_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_legs_invoice ON payment_legs(invoice_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_legs_status ON payment_legs(status)`);
    this.db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_legs_unique ON payment_legs(reservation_id, leg_index)`
    );

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

    return result[0].values.map(row => this.mapReceiptRow(result[0].columns, row));
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

    return result[0].values.map(row => this.mapIntentRow(result[0].columns, row));
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

    return result[0].values.map(row => this.mapIntentRow(result[0].columns, row));
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

    return result[0].values.map(row => this.mapPaymentRow(result[0].columns, row));
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

  // ==================== Payment Link Methods ====================

  async savePaymentLink(link: PaymentLinkRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO payment_links (
        payment_id, merchant_id, order_id, amount_usdc,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        link.paymentId,
        link.merchantId,
        link.orderId,
        link.amountUsdc,
        link.status,
        link.expiresAt,
        link.createdAt,
        link.updatedAt,
      ]
    );

    this.saveToFile();
  }

  async updatePaymentLinkStatus(
    paymentId: string,
    status: PaymentLinkRecord['status']
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`UPDATE payment_links SET status = ?, updated_at = ? WHERE payment_id = ?`, [
      status,
      Date.now(),
      paymentId,
    ]);

    this.saveToFile();
  }

  async getPaymentLink(paymentId: string): Promise<PaymentLinkRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec('SELECT * FROM payment_links WHERE payment_id = ?', [paymentId]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.mapPaymentLinkRow(result[0].columns, result[0].values[0]);
  }

  private mapPaymentLinkRow(columns: string[], values: any[]): PaymentLinkRecord {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      paymentId: row.payment_id,
      merchantId: row.merchant_id,
      orderId: row.order_id,
      amountUsdc: row.amount_usdc,
      status: row.status,
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
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

    return result[0].values.map(row => {
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

    const result = this.db.exec(`SELECT * FROM receipt_comparisons WHERE receipt_id = ?`, [
      receiptId,
    ]);

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
    return result[0].values.map(row => this.mapReceiptRow(result[0].columns, row));
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
    return result[0].values.map(row => this.mapIntentRow(result[0].columns, row));
  }

  /**
   * Get all active intents
   */
  async getAllActiveIntents(): Promise<Intent[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM intents WHERE status = 'active'`);

    if (result.length === 0) return [];
    return result[0].values.map(row => this.mapIntentRow(result[0].columns, row));
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
    const totalResult = this.db.exec(
      `SELECT COUNT(DISTINCT user_public_key) as count FROM receipts`
    );
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
  async getJobsByIntent(intentId: string): Promise<
    Array<{
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
    }>
  > {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      'SELECT * FROM job_locks WHERE intent_id = ? ORDER BY scheduled_at DESC',
      [intentId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => this.mapJobLockRow(result[0].columns, row));
  }

  /**
   * Get stale running jobs (for cleanup)
   */
  async getStaleJobs(staleThresholdMs: number = 300000): Promise<
    Array<{
      id: string;
      jobKey: string;
      intentId: string;
      scheduledAt: number;
      status: string;
      startedAt?: number;
      attempts: number;
      createdAt: number;
    }>
  > {
    if (!this.db) throw new Error('Database not initialized');

    const threshold = Date.now() - staleThresholdMs;

    const result = this.db.exec(
      `SELECT * FROM job_locks WHERE status = 'running' AND started_at < ?`,
      [threshold]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => this.mapJobLockRow(result[0].columns, row));
  }

  private mapJobLockRow(
    columns: string[],
    values: any[]
  ): {
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

  // ==================== Execution Events (Timeline) Methods ====================

  /**
   * Save an execution event to the timeline
   */
  async saveExecutionEvent(event: Omit<ExecutionEventRecord, 'id' | 'createdAt'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    this.db.run(
      `INSERT INTO execution_events (
        receipt_id, event_type, timestamp, rpc_endpoint, priority_fee,
        slippage_bps, signature, status, error_code, error_message,
        metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.receiptId,
        event.eventType,
        event.timestamp,
        event.rpcEndpoint || null,
        event.priorityFee || null,
        event.slippageBps || null,
        event.signature || null,
        event.status || null,
        event.errorCode || null,
        event.errorMessage || null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        now,
      ]
    );

    this.saveToFile();
  }

  /**
   * Get execution events for a receipt (timeline)
   */
  async getExecutionEvents(receiptId: string): Promise<ExecutionEventRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM execution_events WHERE receipt_id = ? ORDER BY timestamp ASC`,
      [receiptId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => this.mapExecutionEventRow(result[0].columns, row));
  }

  private mapExecutionEventRow(columns: string[], values: any[]): ExecutionEventRecord {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      id: row.id,
      receiptId: row.receipt_id,
      eventType: row.event_type as ExecutionEventType,
      timestamp: Number(row.timestamp),
      rpcEndpoint: row.rpc_endpoint || undefined,
      priorityFee: row.priority_fee !== null ? Number(row.priority_fee) : undefined,
      slippageBps: row.slippage_bps !== null ? Number(row.slippage_bps) : undefined,
      signature: row.signature || undefined,
      status: row.status || undefined,
      errorCode: row.error_code || undefined,
      errorMessage: row.error_message || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: Number(row.created_at),
    };
  }

  // ==================== Token Delegation Methods ====================

  /**
   * Save a new delegation
   */
  async saveDelegation(delegation: DelegationRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO token_delegations (
        id, user_public_key, token_mint, token_account, delegate_public_key,
        approved_amount, remaining_amount, status, intent_id, approval_signature,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        delegation.id,
        delegation.userPublicKey,
        delegation.tokenMint,
        delegation.tokenAccount,
        delegation.delegatePublicKey,
        delegation.approvedAmount,
        delegation.remainingAmount,
        delegation.status,
        delegation.intentId || null,
        delegation.approvalSignature || null,
        delegation.createdAt,
        delegation.updatedAt,
      ]
    );

    this.saveToFile();
    this.log.debug({ delegationId: delegation.id }, 'Delegation saved');
  }

  /**
   * Get a delegation by ID
   */
  async getDelegation(delegationId: string): Promise<DelegationRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM token_delegations WHERE id = ?`, [delegationId]);

    if (result.length === 0 || result[0].values.length === 0) {
      return undefined;
    }

    return this.mapDelegationRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Get delegations by user
   */
  async getDelegationsByUser(userPublicKey: string): Promise<DelegationRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM token_delegations WHERE user_public_key = ? ORDER BY created_at DESC`,
      [userPublicKey]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => this.mapDelegationRow(result[0].columns, row));
  }

  /**
   * Get active delegation for user and token
   */
  async getActiveDelegation(
    userPublicKey: string,
    tokenMint: string
  ): Promise<DelegationRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM token_delegations 
       WHERE user_public_key = ? AND token_mint = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userPublicKey, tokenMint]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return undefined;
    }

    return this.mapDelegationRow(result[0].columns, result[0].values[0]);
  }

  /**
   * Update a delegation
   */
  async updateDelegation(delegation: DelegationRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE token_delegations SET
        remaining_amount = ?,
        status = ?,
        approval_signature = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        delegation.remainingAmount,
        delegation.status,
        delegation.approvalSignature || null,
        delegation.updatedAt,
        delegation.id,
      ]
    );

    this.saveToFile();
    this.log.debug(
      { delegationId: delegation.id, status: delegation.status },
      'Delegation updated'
    );
  }

  /**
   * Map database row to DelegationRecord
   */
  private mapDelegationRow(columns: string[], values: any[]): DelegationRecord {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    return {
      id: row.id,
      userPublicKey: row.user_public_key,
      tokenMint: row.token_mint,
      tokenAccount: row.token_account,
      delegatePublicKey: row.delegate_public_key,
      approvedAmount: row.approved_amount,
      remainingAmount: row.remaining_amount,
      status: row.status as 'pending' | 'active' | 'revoked' | 'exhausted',
      intentId: row.intent_id || undefined,
      approvalSignature: row.approval_signature || undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ==================== PortfolioPay V1 Methods ====================

  // ---------- Merchant Methods ----------

  async saveMerchant(merchant: MerchantRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO merchants (id, name, settle_mint, webhook_url, api_key_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        merchant.id,
        merchant.name,
        merchant.settleMint,
        merchant.webhookUrl || null,
        merchant.apiKeyHash || null,
        merchant.status,
        merchant.createdAt,
        merchant.updatedAt,
      ]
    );

    this.saveToFile();
  }

  async getMerchant(merchantId: string): Promise<MerchantRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM merchants WHERE id = ?`, [merchantId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return {
      id: row.id,
      name: row.name,
      settleMint: row.settle_mint,
      webhookUrl: row.webhook_url || undefined,
      apiKeyHash: row.api_key_hash || undefined,
      status: row.status,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ---------- Policy Methods ----------

  async savePolicy(policy: PolicyRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO policies (id, merchant_id, name, json_canonical, hash, version, max_slippage_bps, max_price_impact_bps, max_hops, protected_mode, allowed_tokens, denied_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        policy.id,
        policy.merchantId,
        policy.name,
        policy.jsonCanonical,
        policy.hash,
        policy.version,
        policy.maxSlippageBps,
        policy.maxPriceImpactBps,
        policy.maxHops,
        policy.protectedMode ? 1 : 0,
        policy.allowedTokens ? JSON.stringify(policy.allowedTokens) : null,
        policy.deniedTokens ? JSON.stringify(policy.deniedTokens) : null,
        policy.createdAt,
      ]
    );

    this.saveToFile();
  }

  async getPolicy(policyId: string): Promise<PolicyRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM policies WHERE id = ?`, [policyId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapPolicyRow(row);
  }

  async getPolicyByHash(hash: string): Promise<PolicyRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM policies WHERE hash = ?`, [hash]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapPolicyRow(row);
  }

  private mapPolicyRow(row: Record<string, any>): PolicyRecord {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      name: row.name,
      jsonCanonical: row.json_canonical,
      hash: row.hash,
      version: Number(row.version),
      maxSlippageBps: Number(row.max_slippage_bps),
      maxPriceImpactBps: Number(row.max_price_impact_bps),
      maxHops: Number(row.max_hops),
      protectedMode: Boolean(row.protected_mode),
      allowedTokens: row.allowed_tokens ? JSON.parse(row.allowed_tokens) : undefined,
      deniedTokens: row.denied_tokens ? JSON.parse(row.denied_tokens) : undefined,
      createdAt: Number(row.created_at),
    };
  }

  // ---------- Invoice Methods ----------

  async saveInvoice(invoice: InvoiceRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO invoices (id, merchant_id, order_id, settle_mint, amount_out, policy_id, status, idempotency_key, payer_public_key, reserved_until, expires_at, paid_at, tx_signature, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoice.id,
        invoice.merchantId,
        invoice.orderId || null,
        invoice.settleMint,
        invoice.amountOut,
        invoice.policyId || null,
        invoice.status,
        invoice.idempotencyKey || null,
        invoice.payerPublicKey || null,
        invoice.reservedUntil || null,
        invoice.expiresAt,
        invoice.paidAt || null,
        invoice.txSignature || null,
        invoice.createdAt,
        invoice.updatedAt,
      ]
    );

    this.saveToFile();
  }

  async getInvoice(invoiceId: string): Promise<InvoiceRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapInvoiceRow(row);
  }

  async getInvoiceByIdempotencyKey(key: string): Promise<InvoiceRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM invoices WHERE idempotency_key = ?`, [key]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapInvoiceRow(row);
  }

  async updateInvoice(invoiceId: string, updates: Partial<InvoiceRecord>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.payerPublicKey !== undefined) {
      setClauses.push('payer_public_key = ?');
      values.push(updates.payerPublicKey);
    }
    if (updates.reservedUntil !== undefined) {
      setClauses.push('reserved_until = ?');
      values.push(updates.reservedUntil);
    }
    if (updates.paidAt !== undefined) {
      setClauses.push('paid_at = ?');
      values.push(updates.paidAt);
    }
    if (updates.txSignature !== undefined) {
      setClauses.push('tx_signature = ?');
      values.push(updates.txSignature);
    }

    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(invoiceId);

    this.db.run(`UPDATE invoices SET ${setClauses.join(', ')} WHERE id = ?`, values);

    this.saveToFile();
  }

  async getInvoicesByMerchant(
    merchantId: string,
    options?: {
      status?: string;
      fromDate?: number;
      toDate?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<InvoiceRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const conditions = ['merchant_id = ?'];
    const params: any[] = [merchantId];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options?.fromDate) {
      conditions.push('created_at >= ?');
      params.push(options.fromDate);
    }

    if (options?.toDate) {
      conditions.push('created_at <= ?');
      params.push(options.toDate);
    }

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const query = `SELECT * FROM invoices WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const result = this.db.exec(query, params);

    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const mapped = this.mapRow(result[0].columns, row);
      return this.mapInvoiceRow(mapped);
    });
  }

  private mapInvoiceRow(row: Record<string, any>): InvoiceRecord {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      orderId: row.order_id || undefined,
      settleMint: row.settle_mint,
      amountOut: row.amount_out,
      policyId: row.policy_id || undefined,
      status: row.status,
      idempotencyKey: row.idempotency_key || undefined,
      payerPublicKey: row.payer_public_key || undefined,
      reservedUntil: row.reserved_until ? Number(row.reserved_until) : undefined,
      expiresAt: Number(row.expires_at),
      paidAt: row.paid_at ? Number(row.paid_at) : undefined,
      txSignature: row.tx_signature || undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ---------- Payment Quote Methods ----------

  async savePaymentQuote(quote: PaymentQuoteRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO payment_quotes (id, invoice_id, payer, pay_mint, plan_json, risk_json, fees_json, requires_gasless, ttl_ms, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quote.id,
        quote.invoiceId,
        quote.payer,
        quote.payMint,
        quote.planJson,
        quote.riskJson,
        quote.feesJson || null,
        quote.requiresGasless ? 1 : 0,
        quote.ttlMs,
        quote.expiresAt,
        quote.createdAt,
      ]
    );

    this.saveToFile();
  }

  async getPaymentQuote(quoteId: string): Promise<PaymentQuoteRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM payment_quotes WHERE id = ?`, [quoteId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      payer: row.payer,
      payMint: row.pay_mint,
      planJson: row.plan_json,
      riskJson: row.risk_json,
      feesJson: row.fees_json || undefined,
      requiresGasless: Boolean(row.requires_gasless),
      ttlMs: Number(row.ttl_ms),
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
    };
  }

  // ---------- Payment Attempt Methods ----------

  async savePaymentAttempt(attempt: PaymentAttemptRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO payment_attempts (invoice_id, quote_id, attempt_no, event_type, mode, signature, status, error_code, error_message, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.invoiceId,
        attempt.quoteId || null,
        attempt.attemptNo,
        attempt.eventType,
        attempt.mode || null,
        attempt.signature || null,
        attempt.status || null,
        attempt.errorCode || null,
        attempt.errorMessage || null,
        attempt.metadataJson || null,
        attempt.createdAt,
      ]
    );

    this.saveToFile();
  }

  async getPaymentAttempts(invoiceId: string): Promise<PaymentAttemptRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM payment_attempts WHERE invoice_id = ? ORDER BY created_at ASC`,
      [invoiceId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const mapped = this.mapRow(result[0].columns, row);
      return {
        id: mapped.id ? Number(mapped.id) : undefined,
        invoiceId: mapped.invoice_id,
        quoteId: mapped.quote_id || undefined,
        attemptNo: Number(mapped.attempt_no),
        eventType: mapped.event_type as PaymentAttemptEventType,
        mode: mapped.mode as 'normal' | 'gasless' | undefined,
        signature: mapped.signature || undefined,
        status: mapped.status || undefined,
        errorCode: mapped.error_code || undefined,
        errorMessage: mapped.error_message || undefined,
        metadataJson: mapped.metadata_json || undefined,
        createdAt: Number(mapped.created_at),
      };
    });
  }

  // ---------- Attestation Methods ----------

  async saveAttestation(attestation: AttestationRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO attestations (id, invoice_id, policy_hash, payload_json, planned_json, actual_json, signer_pubkey, signature, verification_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attestation.id,
        attestation.invoiceId,
        attestation.policyHash,
        attestation.payloadJson,
        attestation.plannedJson,
        attestation.actualJson,
        attestation.signerPubkey,
        attestation.signature,
        attestation.verificationUrl || null,
        attestation.createdAt,
      ]
    );

    this.saveToFile();
  }

  async getAttestation(attestationId: string): Promise<AttestationRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM attestations WHERE id = ?`, [attestationId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapAttestationRow(row);
  }

  async getAttestationByInvoice(invoiceId: string): Promise<AttestationRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM attestations WHERE invoice_id = ?`, [invoiceId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapAttestationRow(row);
  }

  private mapAttestationRow(row: Record<string, any>): AttestationRecord {
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      policyHash: row.policy_hash,
      payloadJson: row.payload_json,
      plannedJson: row.planned_json,
      actualJson: row.actual_json,
      signerPubkey: row.signer_pubkey,
      signature: row.signature,
      verificationUrl: row.verification_url || undefined,
      createdAt: Number(row.created_at),
    };
  }

  // ---------- Relayer Submission Methods ----------

  async saveRelayerSubmission(submission: RelayerSubmissionRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO relayer_submissions (id, invoice_id, payer, signed_tx_hash, relayer_fee_lamports, status, signature, error, submitted_at, confirmed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        submission.id,
        submission.invoiceId,
        submission.payer,
        submission.signedTxHash,
        submission.relayerFeeLamports || null,
        submission.status,
        submission.signature || null,
        submission.error || null,
        submission.submittedAt,
        submission.confirmedAt || null,
        submission.createdAt,
      ]
    );

    this.saveToFile();
  }

  async updateRelayerSubmission(
    submissionId: string,
    updates: Partial<RelayerSubmissionRecord>
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.signature !== undefined) {
      setClauses.push('signature = ?');
      values.push(updates.signature);
    }
    if (updates.error !== undefined) {
      setClauses.push('error = ?');
      values.push(updates.error);
    }
    if (updates.confirmedAt !== undefined) {
      setClauses.push('confirmed_at = ?');
      values.push(updates.confirmedAt);
    }

    values.push(submissionId);

    this.db.run(`UPDATE relayer_submissions SET ${setClauses.join(', ')} WHERE id = ?`, values);

    this.saveToFile();
  }

  async getRelayerSubmission(submissionId: string): Promise<RelayerSubmissionRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM relayer_submissions WHERE id = ?`, [submissionId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      payer: row.payer,
      signedTxHash: row.signed_tx_hash,
      relayerFeeLamports: row.relayer_fee_lamports ? Number(row.relayer_fee_lamports) : undefined,
      status: row.status,
      signature: row.signature || undefined,
      error: row.error || undefined,
      submittedAt: Number(row.submitted_at),
      confirmedAt: row.confirmed_at ? Number(row.confirmed_at) : undefined,
      createdAt: Number(row.created_at),
    };
  }

  // ---------- Helper Methods ----------

  private mapRow(columns: string[], values: any[]): Record<string, any> {
    const row: Record<string, any> = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });
    return row;
  }

  // ==================== V1.5 Split-Tender Methods ====================

  // ---------- Invoice Reservation Methods ----------

  async saveInvoiceReservation(reservation: InvoiceReservationRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO invoice_reservations (id, invoice_id, payer, strategy, plan_json, total_legs, completed_legs, usdc_collected, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reservation.id,
        reservation.invoiceId,
        reservation.payer,
        reservation.strategy,
        reservation.planJson,
        reservation.totalLegs,
        reservation.completedLegs,
        reservation.usdcCollected,
        reservation.status,
        reservation.expiresAt,
        reservation.createdAt,
        reservation.updatedAt,
      ]
    );

    this.saveToFile();
  }

  async getInvoiceReservation(
    reservationId: string
  ): Promise<InvoiceReservationRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM invoice_reservations WHERE id = ?`, [reservationId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapReservationRow(row);
  }

  async getReservationByInvoice(invoiceId: string): Promise<InvoiceReservationRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM invoice_reservations WHERE invoice_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [invoiceId]
    );

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapReservationRow(row);
  }

  async updateInvoiceReservation(
    reservationId: string,
    updates: Partial<InvoiceReservationRecord>
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.completedLegs !== undefined) {
      setClauses.push('completed_legs = ?');
      values.push(updates.completedLegs);
    }
    if (updates.usdcCollected !== undefined) {
      setClauses.push('usdc_collected = ?');
      values.push(updates.usdcCollected);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }

    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(reservationId);

    this.db.run(`UPDATE invoice_reservations SET ${setClauses.join(', ')} WHERE id = ?`, values);

    this.saveToFile();
  }

  async expireStaleReservations(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    this.db.run(
      `UPDATE invoice_reservations SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at < ?`,
      [now, now]
    );

    this.saveToFile();

    const result = this.db.exec(`SELECT changes() as count`);
    return result.length > 0 ? Number(result[0].values[0][0]) : 0;
  }

  private mapReservationRow(row: Record<string, any>): InvoiceReservationRecord {
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      payer: row.payer,
      strategy: row.strategy as SplitTenderStrategy,
      planJson: row.plan_json,
      totalLegs: Number(row.total_legs),
      completedLegs: Number(row.completed_legs),
      usdcCollected: row.usdc_collected,
      status: row.status,
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  // ---------- Payment Leg Methods ----------

  async savePaymentLeg(leg: PaymentLegRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO payment_legs (id, reservation_id, invoice_id, leg_index, pay_mint, amount_in, expected_usdc_out, actual_usdc_out, route_json, risk_json, status, tx_signature, error_code, error_message, retry_count, max_retries, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leg.id,
        leg.reservationId,
        leg.invoiceId,
        leg.legIndex,
        leg.payMint,
        leg.amountIn,
        leg.expectedUsdcOut,
        leg.actualUsdcOut || null,
        leg.routeJson || null,
        leg.riskJson || null,
        leg.status,
        leg.txSignature || null,
        leg.errorCode || null,
        leg.errorMessage || null,
        leg.retryCount,
        leg.maxRetries,
        leg.startedAt || null,
        leg.completedAt || null,
        leg.createdAt,
      ]
    );

    this.saveToFile();
  }

  async getPaymentLeg(legId: string): Promise<PaymentLegRecord | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(`SELECT * FROM payment_legs WHERE id = ?`, [legId]);

    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = this.mapRow(result[0].columns, result[0].values[0]);
    return this.mapLegRow(row);
  }

  async getLegsByReservation(reservationId: string): Promise<PaymentLegRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM payment_legs WHERE reservation_id = ? ORDER BY leg_index ASC`,
      [reservationId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const mapped = this.mapRow(result[0].columns, row);
      return this.mapLegRow(mapped);
    });
  }

  async updatePaymentLeg(legId: string, updates: Partial<PaymentLegRecord>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.actualUsdcOut !== undefined) {
      setClauses.push('actual_usdc_out = ?');
      values.push(updates.actualUsdcOut);
    }
    if (updates.txSignature !== undefined) {
      setClauses.push('tx_signature = ?');
      values.push(updates.txSignature);
    }
    if (updates.errorCode !== undefined) {
      setClauses.push('error_code = ?');
      values.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push('error_message = ?');
      values.push(updates.errorMessage);
    }
    if (updates.retryCount !== undefined) {
      setClauses.push('retry_count = ?');
      values.push(updates.retryCount);
    }
    if (updates.startedAt !== undefined) {
      setClauses.push('started_at = ?');
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = ?');
      values.push(updates.completedAt);
    }

    values.push(legId);

    this.db.run(`UPDATE payment_legs SET ${setClauses.join(', ')} WHERE id = ?`, values);

    this.saveToFile();
  }

  async getPendingLegs(reservationId: string): Promise<PaymentLegRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM payment_legs WHERE reservation_id = ? AND status IN ('pending', 'failed') AND retry_count < max_retries ORDER BY leg_index ASC`,
      [reservationId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const mapped = this.mapRow(result[0].columns, row);
      return this.mapLegRow(mapped);
    });
  }

  private mapLegRow(row: Record<string, any>): PaymentLegRecord {
    return {
      id: row.id,
      reservationId: row.reservation_id,
      invoiceId: row.invoice_id,
      legIndex: Number(row.leg_index),
      payMint: row.pay_mint,
      amountIn: row.amount_in,
      expectedUsdcOut: row.expected_usdc_out,
      actualUsdcOut: row.actual_usdc_out || undefined,
      routeJson: row.route_json || undefined,
      riskJson: row.risk_json || undefined,
      status: row.status as PaymentLegStatus,
      txSignature: row.tx_signature || undefined,
      errorCode: row.error_code || undefined,
      errorMessage: row.error_message || undefined,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      startedAt: row.started_at ? Number(row.started_at) : undefined,
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
      createdAt: Number(row.created_at),
    };
  }
}
