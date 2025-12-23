'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { apiClient } from '@/lib/api';
import { SwapComparison } from './SwapComparison';

interface SwapReceipt {
  id: string;
  status: 'pending' | 'confirmed' | 'failed';
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  inputDecimals?: number;
  outputDecimals?: number;
  timestamp: number;
  signature?: string;
}

export function SwapHistory() {
  const { publicKey } = useWallet();
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);

  const {
    data: receipts,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['swapHistory', publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return [];
      return apiClient.getSwapReceipts(publicKey.toBase58());
    },
    enabled: !!publicKey,
  });

  if (isLoading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12">
          <svg className="h-8 w-8 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
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
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <div className="text-red-500 dark:text-red-400">
            Failed to load swap history
          </div>
        </div>
      </div>
    );
  }

  if (!receipts || receipts.length === 0) {
    return (
      <div className="card">
        <div className="py-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-surface-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-surface-900 dark:text-white">
            No swaps yet
          </h3>
          <p className="mt-2 text-surface-600 dark:text-surface-400">
            Your swap history will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold text-surface-900 dark:text-white">
        Swap History
      </h2>
      <div className="space-y-4">
        {receipts.map((receipt: SwapReceipt) => (
          <div
            key={receipt.id}
            className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden"
          >
            {/* Main row */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              onClick={() => setExpandedReceipt(expandedReceipt === receipt.id ? null : receipt.id)}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    receipt.status === 'confirmed'
                      ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                      : receipt.status === 'failed'
                        ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                >
                  {receipt.status === 'confirmed' ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : receipt.status === 'failed' ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="font-medium text-surface-900 dark:text-white">
                    {receipt.inputAmount / 10 ** (receipt.inputDecimals || 9)} →{' '}
                    {receipt.outputAmount / 10 ** (receipt.outputDecimals || 6)}
                  </div>
                  <div className="text-sm text-surface-500">
                    {new Date(receipt.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Compact comparison indicator */}
                {receipt.status === 'confirmed' && (
                  <SwapComparison
                    receiptId={receipt.id}
                    inputAmount={String(receipt.inputAmount)}
                    inputMint={receipt.inputMint}
                    outputMint={receipt.outputMint}
                    compact
                  />
                )}
                {receipt.signature && (
                  <a
                    href={`https://solscan.io/tx/${receipt.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary-500 hover:text-primary-600"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View →
                  </a>
                )}
                <svg
                  className={`h-5 w-5 text-surface-400 transition-transform ${
                    expandedReceipt === receipt.id ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Expanded comparison details */}
            {expandedReceipt === receipt.id && receipt.status === 'confirmed' && (
              <div className="border-t border-surface-200 dark:border-surface-700 p-4 bg-surface-50 dark:bg-surface-800/50">
                <SwapComparison
                  receiptId={receipt.id}
                  inputAmount={String(receipt.inputAmount)}
                  inputMint={receipt.inputMint}
                  outputMint={receipt.outputMint}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
