'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

type Invoice = {
  id: string;
  orderId?: string;
  amountOut: string;
  settleMint: string;
  status: 'pending' | 'paid' | 'expired' | 'cancelled';
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  txSignature?: string;
};

type MerchantStats = {
  totalRevenue: string;
  totalTransactions: number;
  avgTransactionSize: string;
  pendingInvoices: number;
  conversionRate: string;
};

type ChartDataPoint = {
  date: string;
  amount: number;
};

function MerchantDashboardContent() {
  const searchParams = useSearchParams();
  const merchantIdParam = searchParams.get('merchantId');
  const [merchantId, setMerchantId] = useState(merchantIdParam || '');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Fetch merchant stats
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['merchantStats', merchantId, period],
    queryFn: async () => {
      if (!merchantId) return null;
      const resp = await fetch(
        `/api/v1/merchants/${encodeURIComponent(merchantId)}/stats?period=${period}`
      );
      if (!resp.ok) {
        if (resp.status === 404) return null;
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp.json() as Promise<{
        stats: MerchantStats;
        chartData: ChartDataPoint[];
      }>;
    },
    enabled: !!merchantId,
  });

  // Fetch invoices
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['merchantInvoices', merchantId, statusFilter],
    queryFn: async () => {
      if (!merchantId) return null;
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const resp = await fetch(
        `/api/v1/merchants/${encodeURIComponent(merchantId)}/invoices?${params}`
      );
      if (!resp.ok) {
        if (resp.status === 404) return null;
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp.json() as Promise<{
        invoices: Invoice[];
        stats: { total: number; paid: number; pending: number; totalRevenue: string };
      }>;
    },
    enabled: !!merchantId,
  });

  const handleExport = async () => {
    if (!merchantId) return;
    try {
      const resp = await fetch(`/api/v1/merchants/${encodeURIComponent(merchantId)}/invoices/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'csv' }),
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoices-${merchantId}.csv`;
        a.click();
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleDownloadAttestationKit = async (invoiceId: string) => {
    try {
      const resp = await fetch(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}/attestation/kit`
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attestation-kit-${invoiceId}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download kit failed:', error);
    }
  };

  const stats = statsData?.stats;
  const invoices = invoicesData?.invoices || [];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-surface-900 text-3xl font-bold dark:text-white">
              Merchant Dashboard
            </h1>
            <p className="text-surface-600 dark:text-surface-400 mt-2">
              View your payment analytics and manage invoices
            </p>
          </div>

          {/* Merchant ID Input */}
          {!merchantIdParam && (
            <div className="card mb-8">
              <label className="label mb-2">Merchant ID</label>
              <div className="flex gap-4">
                <input
                  type="text"
                  value={merchantId}
                  onChange={e => setMerchantId(e.target.value)}
                  placeholder="Enter your merchant ID"
                  className="input flex-1"
                />
              </div>
            </div>
          )}

          {merchantId && (
            <>
              {/* Period Selector */}
              <div className="mb-6 flex items-center justify-between">
                <div className="flex gap-2">
                  {(['7d', '30d', '90d'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                        period === p
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400'
                      }`}
                    >
                      {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
                    </button>
                  ))}
                </div>
                <button onClick={handleExport} className="btn-secondary">
                  Export CSV
                </button>
              </div>

              {/* Stats Grid */}
              {statsLoading ? (
                <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="card animate-pulse">
                      <div className="h-4 w-20 rounded bg-surface-200 dark:bg-surface-700" />
                      <div className="mt-2 h-8 w-24 rounded bg-surface-200 dark:bg-surface-700" />
                    </div>
                  ))}
                </div>
              ) : stats ? (
                <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
                  <div className="card">
                    <div className="text-surface-600 dark:text-surface-400 text-sm">
                      Total Revenue
                    </div>
                    <div className="text-surface-900 mt-1 text-2xl font-bold dark:text-white">
                      ${stats.totalRevenue}
                    </div>
                  </div>
                  <div className="card">
                    <div className="text-surface-600 dark:text-surface-400 text-sm">
                      Transactions
                    </div>
                    <div className="text-surface-900 mt-1 text-2xl font-bold dark:text-white">
                      {stats.totalTransactions}
                    </div>
                  </div>
                  <div className="card">
                    <div className="text-surface-600 dark:text-surface-400 text-sm">Avg Size</div>
                    <div className="text-surface-900 mt-1 text-2xl font-bold dark:text-white">
                      ${stats.avgTransactionSize}
                    </div>
                  </div>
                  <div className="card">
                    <div className="text-surface-600 dark:text-surface-400 text-sm">Pending</div>
                    <div className="mt-1 text-2xl font-bold text-yellow-500">
                      {stats.pendingInvoices}
                    </div>
                  </div>
                  <div className="card">
                    <div className="text-surface-600 dark:text-surface-400 text-sm">
                      Conversion Rate
                    </div>
                    <div className="mt-1 text-2xl font-bold text-green-500">
                      {stats.conversionRate}%
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Revenue Chart Placeholder */}
              {statsData?.chartData && statsData.chartData.length > 0 && (
                <div className="card mb-8">
                  <h3 className="text-surface-900 mb-4 text-lg font-semibold dark:text-white">
                    Daily Revenue
                  </h3>
                  <div className="flex h-40 items-end gap-1">
                    {statsData.chartData.map((point, idx) => {
                      const maxAmount = Math.max(...statsData.chartData.map(p => p.amount));
                      const height = maxAmount > 0 ? (point.amount / maxAmount) * 100 : 0;
                      return (
                        <div
                          key={idx}
                          className="flex-1 bg-primary-500 rounded-t transition-all hover:bg-primary-600"
                          style={{ height: `${Math.max(height, 5)}%` }}
                          title={`${point.date}: $${point.amount.toFixed(2)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Invoices Table */}
              <div className="card">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-surface-900 text-lg font-semibold dark:text-white">
                    Recent Invoices
                  </h3>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="input w-40"
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>

                {invoicesLoading ? (
                  <div className="animate-pulse space-y-2">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-12 rounded bg-surface-100 dark:bg-surface-800" />
                    ))}
                  </div>
                ) : invoices.length === 0 ? (
                  <div className="py-8 text-center text-surface-500">No invoices found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-surface-200 dark:border-surface-700">
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            Invoice ID
                          </th>
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            Order
                          </th>
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            Amount
                          </th>
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            Status
                          </th>
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            Created
                          </th>
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            TX
                          </th>
                          <th className="pb-3 font-medium text-surface-600 dark:text-surface-400">
                            Attestation
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map(invoice => (
                          <tr
                            key={invoice.id}
                            className="border-b border-surface-100 dark:border-surface-800"
                          >
                            <td className="py-3 font-mono text-xs text-surface-900 dark:text-white">
                              {invoice.id.slice(0, 8)}...
                            </td>
                            <td className="py-3 text-surface-600 dark:text-surface-400">
                              {invoice.orderId || '-'}
                            </td>
                            <td className="py-3 font-medium text-surface-900 dark:text-white">
                              ${invoice.amountOut}
                            </td>
                            <td className="py-3">
                              <span
                                className={`badge ${
                                  invoice.status === 'paid'
                                    ? 'badge-success'
                                    : invoice.status === 'pending'
                                      ? 'badge-warning'
                                      : 'badge-danger'
                                }`}
                              >
                                {invoice.status}
                              </span>
                            </td>
                            <td className="py-3 text-surface-600 dark:text-surface-400">
                              {new Date(invoice.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3">
                              {invoice.txSignature ? (
                                <a
                                  href={`https://solscan.io/tx/${invoice.txSignature}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary-500 hover:underline"
                                >
                                  View
                                </a>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="py-3">
                              {invoice.status === 'paid' ? (
                                <button
                                  onClick={() => handleDownloadAttestationKit(invoice.id)}
                                  className="text-primary-500 hover:underline"
                                >
                                  Download
                                </button>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function MerchantDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
          <div className="text-white">Loading...</div>
        </div>
      }
    >
      <MerchantDashboardContent />
    </Suspense>
  );
}
