'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { apiClient } from '@/lib/api';

// Common tokens with Pyth feed IDs
const TOKENS_WITH_FEEDS = [
  {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    pythFeedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  },
  {
    symbol: 'ETH',
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    decimals: 8,
    pythFeedId: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  },
  {
    symbol: 'BTC',
    mint: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
    decimals: 8,
    pythFeedId: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  },
];

export default function StopLossPage() {
  const { publicKey, connected } = useWallet();
  const queryClient = useQueryClient();

  const [selectedToken, setSelectedToken] = useState(TOKENS_WITH_FEEDS[0]);
  const [outputToken] = useState({
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  });
  const [amount, setAmount] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');

  // Fetch existing stop-loss intents
  const { data: intents, isLoading: intentsLoading } = useQuery({
    queryKey: ['intents', publicKey?.toBase58(), 'stop-loss'],
    queryFn: async () => {
      if (!publicKey) return [];
      const all = await apiClient.getIntents(publicKey.toBase58());
      return all.filter((i: any) => i.type === 'stop-loss');
    },
    enabled: !!publicKey,
  });

  // Create stop-loss mutation
  const createStopLoss = useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error('Wallet not connected');

      return apiClient.createIntent({
        userPublicKey: publicKey.toBase58(),
        type: 'stop-loss',
        inputMint: selectedToken.mint,
        outputMint: outputToken.mint,
        totalAmount: Math.floor(parseFloat(amount) * 10 ** selectedToken.decimals),
        triggerPrice: parseFloat(triggerPrice),
        pythFeedId: selectedToken.pythFeedId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intents'] });
      setAmount('');
      setTriggerPrice('');
    },
  });

  // Cancel stop-loss mutation
  const cancelStopLoss = useMutation({
    mutationFn: async (intentId: string) => {
      if (!publicKey) throw new Error('Wallet not connected');
      return apiClient.cancelIntent(intentId, publicKey.toBase58());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intents'] });
    },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8 text-center">
            <h1 className="text-surface-900 text-3xl font-bold dark:text-white">
              Stop-Loss Orders
            </h1>
            <p className="text-surface-600 dark:text-surface-400 mt-2">
              Protect your positions with automated stop-loss triggers
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Create Stop-Loss Form */}
            <div className="card">
              <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                Create Stop-Loss
              </h2>

              {!connected ? (
                <div className="text-surface-600 dark:text-surface-400 py-8 text-center">
                  Connect your wallet to create stop-loss orders
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Token to Sell */}
                  <div>
                    <label className="label mb-2">Token to sell</label>
                    <select
                      value={selectedToken.mint}
                      onChange={e => {
                        const token = TOKENS_WITH_FEEDS.find(t => t.mint === e.target.value);
                        if (token) setSelectedToken(token);
                      }}
                      className="input w-full"
                    >
                      {TOKENS_WITH_FEEDS.map(token => (
                        <option key={token.mint} value={token.mint}>
                          {token.symbol}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="label mb-2">Amount ({selectedToken.symbol})</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.0"
                      className="input w-full"
                      min={0}
                    />
                  </div>

                  {/* Trigger Price */}
                  <div>
                    <label className="label mb-2">Trigger Price (USD)</label>
                    <input
                      type="number"
                      value={triggerPrice}
                      onChange={e => setTriggerPrice(e.target.value)}
                      placeholder="0.0"
                      className="input w-full"
                      min={0}
                      step="0.01"
                    />
                    <p className="text-surface-500 mt-1 text-xs">
                      Order will execute when {selectedToken.symbol} price falls to or below this
                      level
                    </p>
                  </div>

                  {/* Info Box */}
                  <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
                    <div className="flex items-start gap-3">
                      <svg
                        className="h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <div className="text-sm text-yellow-800 dark:text-yellow-200">
                        <p className="font-medium">How it works</p>
                        <p className="mt-1">
                          Our system monitors Pyth oracle prices every 10 seconds. When the price
                          hits your trigger, the order executes automatically via Jupiter.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    onClick={() => createStopLoss.mutate()}
                    disabled={!amount || !triggerPrice || createStopLoss.isPending}
                    className="btn-primary w-full py-3"
                  >
                    {createStopLoss.isPending ? 'Creating...' : 'Create Stop-Loss Order'}
                  </button>

                  {createStopLoss.isError && (
                    <div className="text-sm text-red-500">
                      {(createStopLoss.error as Error).message}
                    </div>
                  )}

                  {createStopLoss.isSuccess && (
                    <div className="text-sm text-green-500">
                      Stop-loss order created successfully!
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Active Stop-Loss Orders */}
            <div className="card">
              <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                Active Stop-Loss Orders
              </h2>

              {intentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <svg
                    className="text-primary-500 h-8 w-8 animate-spin"
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
              ) : !intents || intents.length === 0 ? (
                <div className="text-surface-600 dark:text-surface-400 py-8 text-center">
                  No active stop-loss orders
                </div>
              ) : (
                <div className="space-y-4">
                  {intents.map((intent: any) => {
                    const token = TOKENS_WITH_FEEDS.find(t => t.mint === intent.inputMint);
                    return (
                      <div
                        key={intent.id}
                        className="border-surface-200 dark:border-surface-700 rounded-lg border p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="badge-warning">Stop-Loss</span>
                              <span className="text-surface-900 font-medium dark:text-white">
                                {token?.symbol || 'Unknown'}
                              </span>
                            </div>
                            <div className="text-surface-500 mt-1 text-sm">
                              Amount: {intent.totalAmount / 10 ** (token?.decimals || 9)}{' '}
                              {token?.symbol}
                            </div>
                            <div className="text-surface-500 text-sm">
                              Trigger: ${intent.triggerPrice?.toFixed(2) || 'N/A'}
                            </div>
                          </div>
                          <button
                            onClick={() => cancelStopLoss.mutate(intent.id)}
                            disabled={cancelStopLoss.isPending}
                            className="btn-ghost text-sm text-red-500 hover:text-red-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
