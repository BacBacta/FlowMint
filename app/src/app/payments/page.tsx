'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { apiClient } from '@/lib/api';

export default function PaymentsPage() {
  const { publicKey: _publicKey, connected } = useWallet();
  const [activeTab, setActiveTab] = useState<'create' | 'pay'>('create');

  // Merchant form state
  const [merchantId, setMerchantId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [amountUsdc, setAmountUsdc] = useState('');

  // Payment link state
  const [paymentId, setPaymentId] = useState('');
  const [paymentLink, setPaymentLink] = useState<any>(null);

  // Create payment link mutation
  const createPaymentLink = useMutation({
    mutationFn: async () => {
      return apiClient.createPaymentLink({
        merchantId,
        orderId,
        amountUsdc: parseFloat(amountUsdc),
      });
    },
    onSuccess: data => {
      setPaymentLink(data);
    },
  });

  // Fetch payment status
  const { data: paymentStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['paymentStatus', paymentId],
    queryFn: async () => {
      if (!paymentId) return null;
      return apiClient.getPaymentStatus(paymentId);
    },
    enabled: !!paymentId && activeTab === 'pay',
  });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8 text-center">
            <h1 className="text-surface-900 text-3xl font-bold dark:text-white">
              Pay Any Token → USDC
            </h1>
            <p className="text-surface-600 dark:text-surface-400 mt-2">
              Accept payments in any token, receive USDC automatically
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-8 flex justify-center">
            <div className="bg-surface-100 dark:bg-surface-800 inline-flex rounded-lg p-1">
              <button
                onClick={() => setActiveTab('create')}
                className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'create'
                    ? 'text-surface-900 dark:bg-surface-700 bg-white shadow dark:text-white'
                    : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'
                }`}
              >
                Create Payment Link
              </button>
              <button
                onClick={() => setActiveTab('pay')}
                className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'pay'
                    ? 'text-surface-900 dark:bg-surface-700 bg-white shadow dark:text-white'
                    : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'
                }`}
              >
                Pay Invoice
              </button>
            </div>
          </div>

          {/* Create Payment Link Tab */}
          {activeTab === 'create' && (
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Form */}
              <div className="card">
                <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                  Create Payment Link
                </h2>

                <div className="space-y-6">
                  {/* Merchant ID */}
                  <div>
                    <label className="label mb-2">Merchant ID</label>
                    <input
                      type="text"
                      value={merchantId}
                      onChange={e => setMerchantId(e.target.value)}
                      placeholder="your-merchant-id"
                      className="input w-full"
                    />
                  </div>

                  {/* Order ID */}
                  <div>
                    <label className="label mb-2">Order ID / Invoice Number</label>
                    <input
                      type="text"
                      value={orderId}
                      onChange={e => setOrderId(e.target.value)}
                      placeholder="INV-001"
                      className="input w-full"
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="label mb-2">Amount (USDC)</label>
                    <input
                      type="number"
                      value={amountUsdc}
                      onChange={e => setAmountUsdc(e.target.value)}
                      placeholder="100.00"
                      className="input w-full"
                      min={0}
                      step="0.01"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    onClick={() => createPaymentLink.mutate()}
                    disabled={!merchantId || !orderId || !amountUsdc || createPaymentLink.isPending}
                    className="btn-primary w-full py-3"
                  >
                    {createPaymentLink.isPending ? 'Creating...' : 'Create Payment Link'}
                  </button>

                  {createPaymentLink.isError && (
                    <div className="text-sm text-red-500">
                      {(createPaymentLink.error as Error).message}
                    </div>
                  )}
                </div>
              </div>

              {/* Result */}
              <div className="card">
                <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                  Payment Link
                </h2>

                {!paymentLink ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <svg
                      className="text-surface-400 h-12 w-12"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                      />
                    </svg>
                    <p className="text-surface-600 dark:text-surface-400 mt-4">
                      Create a payment link to see it here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">
                        Payment ID
                      </div>
                      <div className="text-surface-900 mt-1 font-mono text-sm dark:text-white">
                        {paymentLink.paymentId}
                      </div>
                    </div>

                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">
                        Payment URL
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={paymentLink.paymentUrl}
                          readOnly
                          className="input flex-1 text-sm"
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(paymentLink.paymentUrl)}
                          className="btn-secondary px-3 py-2"
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">Expires</div>
                      <div className="text-surface-900 mt-1 text-sm dark:text-white">
                        {new Date(paymentLink.expiresAt).toLocaleString()}
                      </div>
                    </div>

                    {/* QR Code Placeholder */}
                    <div className="flex justify-center">
                      <div className="dark:bg-surface-700 flex h-32 w-32 items-center justify-center rounded-lg bg-white">
                        <span className="text-surface-400 text-xs">QR Code</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pay Invoice Tab */}
          {activeTab === 'pay' && (
            <div className="card mx-auto max-w-xl">
              <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                Pay Invoice
              </h2>

              {!connected ? (
                <div className="text-surface-600 dark:text-surface-400 py-8 text-center">
                  Connect your wallet to pay invoices
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Payment ID Input */}
                  <div>
                    <label className="label mb-2">Payment ID</label>
                    <input
                      type="text"
                      value={paymentId}
                      onChange={e => setPaymentId(e.target.value)}
                      placeholder="Enter payment ID"
                      className="input w-full"
                    />
                  </div>

                  {/* Payment Status */}
                  {paymentId && (
                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      {statusLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <svg
                            className="text-primary-500 h-6 w-6 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        </div>
                      ) : paymentStatus ? (
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-surface-600 dark:text-surface-400">Amount</span>
                            <span className="text-surface-900 font-medium dark:text-white">
                              ${paymentStatus.amountUsdc} USDC
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600 dark:text-surface-400">Status</span>
                            <span
                              className={`badge ${
                                paymentStatus.status === 'completed'
                                  ? 'badge-success'
                                  : paymentStatus.status === 'pending'
                                    ? 'badge-warning'
                                    : 'badge-danger'
                              }`}
                            >
                              {paymentStatus.status}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-surface-600 dark:text-surface-400">Merchant</span>
                            <span className="text-surface-900 dark:text-white">
                              {paymentStatus.merchantId}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-surface-600 dark:text-surface-400 text-center">
                          Payment not found
                        </div>
                      )}
                    </div>
                  )}

                  {/* How it works */}
                  <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-4">
                    <h3 className="text-primary-800 dark:text-primary-200 font-medium">
                      How it works
                    </h3>
                    <ul className="text-primary-700 dark:text-primary-300 mt-2 space-y-1 text-sm">
                      <li>• Pay using any token in your wallet</li>
                      <li>• We automatically swap to USDC via Jupiter</li>
                      <li>• Merchant receives exact USDC amount</li>
                      <li>• Fast, low-cost transactions on Solana</li>
                    </ul>
                  </div>

                  {/* Pay Button */}
                  <button
                    disabled={!paymentStatus || paymentStatus?.status !== 'pending'}
                    className="btn-primary w-full py-3"
                  >
                    {paymentStatus?.status === 'completed'
                      ? 'Already Paid'
                      : paymentStatus?.status === 'expired'
                        ? 'Payment Expired'
                        : `Pay $${paymentStatus?.amountUsdc || '0'} USDC`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
