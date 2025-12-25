/**
 * InvoiceService - PortfolioPay V1
 *
 * Manages merchant invoices for payment requests.
 * Supports idempotency, reservation, and status tracking.
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseService, InvoiceRecord, PolicyRecord, MerchantRecord } from '../db/database';

// Constants
const DEFAULT_INVOICE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESERVATION_TTL_MS = 2 * 60 * 1000; // 2 minutes for payer reservation

export interface CreateInvoiceParams {
  merchantId: string;
  settleMint: string;
  amountOut: string; // lamports/smallest unit as string
  orderId?: string;
  policyId?: string;
  expiresInMs?: number;
  idempotencyKey?: string;
}

export interface InvoiceWithPolicy {
  invoice: InvoiceRecord;
  policy?: PolicyRecord;
  merchant?: MerchantRecord;
}

export interface ReserveInvoiceParams {
  invoiceId: string;
  payerPublicKey: string;
}

export interface CompleteInvoiceParams {
  invoiceId: string;
  txSignature: string;
}

export class InvoiceService {
  constructor(private db: DatabaseService) {}

  /**
   * Create a new invoice for a merchant
   */
  async createInvoice(params: CreateInvoiceParams): Promise<InvoiceRecord> {
    // Check idempotency
    if (params.idempotencyKey) {
      const existing = await this.db.getInvoiceByIdempotencyKey(params.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    // Verify merchant exists
    const merchant = await this.db.getMerchant(params.merchantId);
    if (!merchant) {
      throw new Error(`Merchant not found: ${params.merchantId}`);
    }

    // Verify policy if provided
    if (params.policyId) {
      const policy = await this.db.getPolicy(params.policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${params.policyId}`);
      }
      if (policy.merchantId !== params.merchantId) {
        throw new Error('Policy does not belong to merchant');
      }
    }

    const now = Date.now();
    const expiresAt = now + (params.expiresInMs || DEFAULT_INVOICE_TTL_MS);

    const invoice: InvoiceRecord = {
      id: uuidv4(),
      merchantId: params.merchantId,
      orderId: params.orderId,
      settleMint: params.settleMint,
      amountOut: params.amountOut,
      policyId: params.policyId,
      status: 'pending',
      idempotencyKey: params.idempotencyKey,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.saveInvoice(invoice);

    return invoice;
  }

  /**
   * Get invoice by ID with optional policy and merchant data
   */
  async getInvoice(invoiceId: string, includeRelated = false): Promise<InvoiceWithPolicy | null> {
    const invoice = await this.db.getInvoice(invoiceId);
    if (!invoice) return null;

    if (!includeRelated) {
      return { invoice };
    }

    const [policy, merchant] = await Promise.all([
      invoice.policyId ? this.db.getPolicy(invoice.policyId) : undefined,
      this.db.getMerchant(invoice.merchantId),
    ]);

    return { invoice, policy, merchant };
  }

  /**
   * Reserve an invoice for a specific payer
   * Prevents concurrent payment attempts
   */
  async reserveForPayer(params: ReserveInvoiceParams): Promise<InvoiceRecord> {
    const invoice = await this.db.getInvoice(params.invoiceId);

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Check invoice status
    if (invoice.status === 'paid') {
      throw new Error('Invoice already paid');
    }
    if (invoice.status === 'cancelled') {
      throw new Error('Invoice cancelled');
    }
    if (invoice.status === 'expired' || invoice.expiresAt < Date.now()) {
      throw new Error('Invoice expired');
    }

    // Check if already reserved by another payer
    const now = Date.now();
    if (
      invoice.reservedUntil &&
      invoice.reservedUntil > now &&
      invoice.payerPublicKey !== params.payerPublicKey
    ) {
      throw new Error('Invoice is reserved by another payer');
    }

    // Reserve for this payer
    await this.db.updateInvoice(params.invoiceId, {
      payerPublicKey: params.payerPublicKey,
      reservedUntil: now + RESERVATION_TTL_MS,
      status: 'reserved',
    });

    return (await this.db.getInvoice(params.invoiceId))!;
  }

  /**
   * Extend reservation for a payer (while building tx, etc.)
   */
  async extendReservation(invoiceId: string, payerPublicKey: string): Promise<InvoiceRecord> {
    const invoice = await this.db.getInvoice(invoiceId);

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.payerPublicKey !== payerPublicKey) {
      throw new Error('Invoice reserved by different payer');
    }

    await this.db.updateInvoice(invoiceId, {
      reservedUntil: Date.now() + RESERVATION_TTL_MS,
    });

    return (await this.db.getInvoice(invoiceId))!;
  }

  /**
   * Mark invoice as paid
   */
  async markPaid(params: CompleteInvoiceParams): Promise<InvoiceRecord> {
    const invoice = await this.db.getInvoice(params.invoiceId);

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status === 'paid') {
      // Idempotent - return existing
      return invoice;
    }

    const now = Date.now();
    await this.db.updateInvoice(params.invoiceId, {
      status: 'paid',
      paidAt: now,
      txSignature: params.txSignature,
    });

    return (await this.db.getInvoice(params.invoiceId))!;
  }

  /**
   * Mark invoice as failed (after max retries)
   */
  async markFailed(invoiceId: string, reason?: string): Promise<InvoiceRecord> {
    await this.db.updateInvoice(invoiceId, {
      status: 'failed',
    });

    return (await this.db.getInvoice(invoiceId))!;
  }

  /**
   * Cancel an invoice (by merchant)
   */
  async cancelInvoice(invoiceId: string): Promise<InvoiceRecord> {
    const invoice = await this.db.getInvoice(invoiceId);

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status === 'paid') {
      throw new Error('Cannot cancel paid invoice');
    }

    await this.db.updateInvoice(invoiceId, {
      status: 'cancelled',
    });

    return (await this.db.getInvoice(invoiceId))!;
  }

  /**
   * List invoices for a merchant
   */
  async listMerchantInvoices(
    merchantId: string,
    status?: string
  ): Promise<InvoiceRecord[]> {
    return this.db.getInvoicesByMerchant(merchantId, status);
  }

  /**
   * Check and expire stale invoices
   */
  async expireStaleInvoices(): Promise<number> {
    // This would typically be a background job
    // For now, we'll check on access
    return 0;
  }

  /**
   * Validate invoice is payable
   */
  async validatePayable(invoiceId: string, payerPublicKey: string): Promise<{
    valid: boolean;
    error?: string;
    invoice?: InvoiceRecord;
  }> {
    const invoice = await this.db.getInvoice(invoiceId);

    if (!invoice) {
      return { valid: false, error: 'Invoice not found' };
    }

    const now = Date.now();

    if (invoice.status === 'paid') {
      return { valid: false, error: 'Invoice already paid', invoice };
    }

    if (invoice.status === 'cancelled') {
      return { valid: false, error: 'Invoice cancelled', invoice };
    }

    if (invoice.expiresAt < now) {
      return { valid: false, error: 'Invoice expired', invoice };
    }

    // Check reservation
    if (
      invoice.reservedUntil &&
      invoice.reservedUntil > now &&
      invoice.payerPublicKey &&
      invoice.payerPublicKey !== payerPublicKey
    ) {
      return { valid: false, error: 'Invoice reserved by another payer', invoice };
    }

    return { valid: true, invoice };
  }
}

export const createInvoiceService = (db: DatabaseService): InvoiceService => {
  return new InvoiceService(db);
};
