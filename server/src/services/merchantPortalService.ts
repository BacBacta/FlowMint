/**
 * MerchantPortalService - V2 Merchant Dashboard Operations
 *
 * Provides invoice listing, export, search, disputes, and analytics.
 */

import { v4 as uuidv4 } from 'uuid';

import { DatabaseService, InvoiceRecord } from '../db/database';
import { logger } from '../utils/logger';

const log = logger.child({ service: 'MerchantPortalService' });

// ==================== Types ====================

export interface InvoiceFilter {
  status?: string[];
  fromDate?: number;
  toDate?: number;
  minAmount?: string;
  maxAmount?: string;
  orderId?: string;
  payerPublicKey?: string;
  searchQuery?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: 'createdAt' | 'usdcAmount' | 'status' | 'paidAt';
  sortOrder?: 'asc' | 'desc';
}

export interface InvoiceListResult {
  invoices: InvoiceRecord[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ExportOptions {
  format: 'csv' | 'json';
  filter?: InvoiceFilter;
  includeLegs?: boolean;
  includeAttestations?: boolean;
}

export interface ExportResult {
  data: string | Buffer;
  filename: string;
  contentType: string;
  recordCount: number;
}

export interface DisputeRecord {
  id: string;
  merchantId: string;
  invoiceId: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  priority: DisputePriority;
  evidence?: string;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type DisputeReason =
  | 'missing_payment'
  | 'wrong_amount'
  | 'duplicate'
  | 'fraud'
  | 'technical_error'
  | 'other';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';
export type DisputePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface MerchantStats {
  totalInvoices: number;
  paidInvoices: number;
  expiredInvoices: number;
  failedInvoices: number;
  successRate: number;
  totalVolume: string;
  totalFees: string;
  avgSettlementTime?: number;
  uniquePayers: number;
  topTokens: Array<{ token: string; count: number; volume: string }>;
}

export interface DailyStats {
  date: string;
  invoiceCount: number;
  paidCount: number;
  volume: string;
  fees: string;
}

// ==================== Service ====================

export class MerchantPortalService {
  constructor(private db: DatabaseService) {}

  /**
   * List invoices with filtering and pagination
   */
  async getInvoices(
    merchantId: string,
    filter: InvoiceFilter = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<InvoiceListResult> {
    log.debug(
      { merchantId, filter, pagination },
      'Fetching invoices'
    );

    // Get invoices from database with filters
    const allInvoices = await this.db.getInvoicesByMerchant(merchantId);

    // Apply filters
    let filtered = this.applyFilters(allInvoices, filter);

    // Sort
    filtered = this.sortInvoices(
      filtered,
      pagination.sortBy || 'createdAt',
      pagination.sortOrder || 'desc'
    );

    // Paginate
    const total = filtered.length;
    const start = (pagination.page - 1) * pagination.limit;
    const end = start + pagination.limit;
    const invoices = filtered.slice(start, end);

    return {
      invoices,
      total,
      page: pagination.page,
      limit: pagination.limit,
      hasMore: end < total,
    };
  }

  /**
   * Get invoice detail with related data
   */
  async getInvoiceDetail(
    merchantId: string,
    invoiceId: string
  ): Promise<InvoiceRecord | null> {
    const invoice = await this.db.getInvoice(invoiceId);

    if (!invoice || invoice.merchantId !== merchantId) {
      return null;
    }

    return invoice;
  }

  /**
   * Export invoices to CSV or JSON
   */
  async exportInvoices(
    merchantId: string,
    options: ExportOptions
  ): Promise<ExportResult> {
    log.info(
      { merchantId, format: options.format },
      'Exporting invoices'
    );

    // Get all invoices matching filter
    const allInvoices = await this.db.getInvoicesByMerchant(merchantId);
    const filtered = this.applyFilters(allInvoices, options.filter || {});

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `invoices_${merchantId}_${timestamp}.${options.format}`;

    if (options.format === 'csv') {
      const csv = this.generateCSV(filtered);
      return {
        data: csv,
        filename,
        contentType: 'text/csv',
        recordCount: filtered.length,
      };
    } else {
      const json = JSON.stringify(filtered, null, 2);
      return {
        data: json,
        filename,
        contentType: 'application/json',
        recordCount: filtered.length,
      };
    }
  }

  /**
   * Create a dispute
   */
  async createDispute(
    merchantId: string,
    invoiceId: string,
    reason: DisputeReason,
    description: string
  ): Promise<DisputeRecord | null> {
    // Verify invoice belongs to merchant
    const invoice = await this.db.getInvoice(invoiceId);
    if (!invoice || invoice.merchantId !== merchantId) {
      return null;
    }

    const dispute: DisputeRecord = {
      id: uuidv4(),
      merchantId,
      invoiceId,
      reason,
      description,
      status: 'open',
      priority: this.calculateDisputePriority(invoice, reason),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save dispute (in production, would use DB)
    log.info(
      { disputeId: dispute.id, invoiceId, reason },
      'Dispute created'
    );

    return dispute;
  }

  /**
   * Get disputes for merchant
   */
  async getDisputes(
    merchantId: string,
    status?: string,
    pagination: { page: number; limit: number } = { page: 1, limit: 20 }
  ): Promise<{ disputes: DisputeRecord[]; total: number }> {
    // In production, fetch from database
    return { disputes: [], total: 0 };
  }

  /**
   * Get merchant statistics
   */
  async getStats(
    merchantId: string,
    fromDate: number,
    toDate: number
  ): Promise<MerchantStats> {
    const invoices = await this.db.getInvoicesByMerchant(merchantId);

    // Filter by date range
    const filtered = invoices.filter(
      (inv) => inv.createdAt >= fromDate && inv.createdAt <= toDate
    );

    const paidInvoices = filtered.filter((inv) => inv.status === 'paid');
    const expiredInvoices = filtered.filter((inv) => inv.status === 'expired');
    const failedInvoices = filtered.filter((inv) => inv.status === 'failed');

    // Calculate totals
    const totalVolume = paidInvoices.reduce(
      (sum, inv) => sum + BigInt(inv.amountOut),
      0n
    );

    // Calculate fees (0.5% of volume)
    const totalFees = totalVolume / 200n;

    // Calculate average settlement time
    let totalSettlementTime = 0;
    let settledCount = 0;
    for (const inv of paidInvoices) {
      if (inv.paidAt) {
        totalSettlementTime += inv.paidAt - inv.createdAt;
        settledCount++;
      }
    }

    // Count unique payers
    const uniquePayers = new Set(
      paidInvoices.map((inv) => inv.payerPublicKey).filter(Boolean)
    ).size;

    // Token usage would come from legs in production
    const topTokens: Array<{ token: string; count: number; volume: string }> = [];

    return {
      totalInvoices: filtered.length,
      paidInvoices: paidInvoices.length,
      expiredInvoices: expiredInvoices.length,
      failedInvoices: failedInvoices.length,
      successRate:
        filtered.length > 0
          ? paidInvoices.length / filtered.length
          : 0,
      totalVolume: totalVolume.toString(),
      totalFees: totalFees.toString(),
      avgSettlementTime:
        settledCount > 0
          ? Math.round(totalSettlementTime / settledCount)
          : undefined,
      uniquePayers,
      topTokens,
    };
  }

  /**
   * Get daily statistics
   */
  async getDailyStats(
    merchantId: string,
    fromDate: number,
    toDate: number
  ): Promise<DailyStats[]> {
    const invoices = await this.db.getInvoicesByMerchant(merchantId);

    // Group by date
    const byDate = new Map<string, InvoiceRecord[]>();

    for (const inv of invoices) {
      if (inv.createdAt >= fromDate && inv.createdAt <= toDate) {
        const date = new Date(inv.createdAt).toISOString().split('T')[0];
        const existing = byDate.get(date) || [];
        existing.push(inv);
        byDate.set(date, existing);
      }
    }

    // Calculate stats per day
    const stats: DailyStats[] = [];

    for (const [date, dayInvoices] of byDate) {
      const paid = dayInvoices.filter((inv) => inv.status === 'paid');
      const volume = paid.reduce(
        (sum, inv) => sum + BigInt(inv.amountOut),
        0n
      );
      const fees = volume / 200n;

      stats.push({
        date,
        invoiceCount: dayInvoices.length,
        paidCount: paid.length,
        volume: volume.toString(),
        fees: fees.toString(),
      });
    }

    return stats.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Regenerate API key
   */
  async regenerateApiKey(merchantId: string): Promise<string> {
    const newApiKey = uuidv4();
    // In production, would hash and save to DB
    log.info({ merchantId }, 'API key regenerated');
    return newApiKey;
  }

  // ==================== Private Helpers ====================

  private applyFilters(
    invoices: InvoiceRecord[],
    filter: InvoiceFilter
  ): InvoiceRecord[] {
    return invoices.filter((inv) => {
      // Status filter
      if (filter.status && filter.status.length > 0) {
        if (!filter.status.includes(inv.status)) return false;
      }

      // Date range
      if (filter.fromDate && inv.createdAt < filter.fromDate) return false;
      if (filter.toDate && inv.createdAt > filter.toDate) return false;

      // Amount range
      if (filter.minAmount) {
        if (BigInt(inv.amountOut) < BigInt(filter.minAmount)) return false;
      }
      if (filter.maxAmount) {
        if (BigInt(inv.amountOut) > BigInt(filter.maxAmount)) return false;
      }

      // Order ID
      if (filter.orderId && inv.orderId !== filter.orderId) return false;

      // Payer
      if (filter.payerPublicKey && inv.payerPublicKey !== filter.payerPublicKey) {
        return false;
      }

      // Search query
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const searchable = [inv.id, inv.orderId, inv.payerPublicKey]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });
  }

  private sortInvoices(
    invoices: InvoiceRecord[],
    sortBy: string,
    sortOrder: 'asc' | 'desc'
  ): InvoiceRecord[] {
    return [...invoices].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'createdAt':
          comparison = a.createdAt - b.createdAt;
          break;
        case 'usdcAmount':
          comparison =
            Number(BigInt(a.amountOut) - BigInt(b.amountOut));
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'paidAt':
          comparison = (a.paidAt || 0) - (b.paidAt || 0);
          break;
        default:
          comparison = a.createdAt - b.createdAt;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  private generateCSV(invoices: InvoiceRecord[]): string {
    const headers = [
      'id',
      'orderId',
      'status',
      'amountUsdc',
      'payerPublicKey',
      'txSignature',
      'createdAt',
      'paidAt',
    ];

    const rows = invoices.map((inv) => [
      inv.id,
      inv.orderId || '',
      inv.status,
      (Number(inv.amountOut) / 1_000_000).toFixed(2),
      inv.payerPublicKey || '',
      inv.txSignature || '',
      new Date(inv.createdAt).toISOString(),
      inv.paidAt ? new Date(inv.paidAt).toISOString() : '',
    ]);

    const csvRows = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ];

    return csvRows.join('\n');
  }

  private calculateDisputePriority(
    invoice: InvoiceRecord,
    reason: DisputeReason
  ): DisputePriority {
    // High value invoices get higher priority
    const amount = BigInt(invoice.amountOut);
    if (amount > 10_000_000_000n) {
      // > 10,000 USDC
      return 'urgent';
    }
    if (amount > 1_000_000_000n) {
      // > 1,000 USDC
      return 'high';
    }

    // Fraud gets high priority
    if (reason === 'fraud') {
      return 'high';
    }

    return 'normal';
  }
}

// Singleton instance
let merchantPortalInstance: MerchantPortalService | null = null;

export function getMerchantPortalService(
  db: DatabaseService
): MerchantPortalService {
  if (!merchantPortalInstance) {
    merchantPortalInstance = new MerchantPortalService(db);
  }
  return merchantPortalInstance;
}

export default MerchantPortalService;
