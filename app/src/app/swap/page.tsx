'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SwapForm } from '@/components/swap/SwapForm';
import { SwapHistory } from '@/components/swap/SwapHistory';

export default function SwapPage() {
  const { connected } = useWallet();
  const [activeTab, setActiveTab] = useState<'swap' | 'history'>('swap');

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8 text-center">
            <h1 className="text-surface-900 text-3xl font-bold dark:text-white">Token Swap</h1>
            <p className="text-surface-600 dark:text-surface-400 mt-2">
              Swap tokens with optimal routing through Jupiter
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex justify-center">
            <div className="bg-surface-100 dark:bg-surface-800 inline-flex rounded-lg p-1">
              <button
                onClick={() => setActiveTab('swap')}
                className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'swap'
                    ? 'text-surface-900 dark:bg-surface-700 bg-white shadow dark:text-white'
                    : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'
                }`}
              >
                Swap
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`rounded-md px-6 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'history'
                    ? 'text-surface-900 dark:bg-surface-700 bg-white shadow dark:text-white'
                    : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white'
                }`}
              >
                History
              </button>
            </div>
          </div>

          {/* Content */}
          {!connected ? (
            <div className="card text-center">
              <div className="py-12">
                <svg
                  className="text-surface-400 mx-auto h-12 w-12"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
                  />
                </svg>
                <h3 className="text-surface-900 mt-4 text-lg font-medium dark:text-white">
                  Connect your wallet
                </h3>
                <p className="text-surface-600 dark:text-surface-400 mt-2">
                  Connect your Solana wallet to start swapping tokens
                </p>
              </div>
            </div>
          ) : activeTab === 'swap' ? (
            <SwapForm />
          ) : (
            <SwapHistory />
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
