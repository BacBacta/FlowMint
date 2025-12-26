'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { TokenSelector, type Token } from '@/components/swap/TokenSelector';
import { apiClient, type TokenInfo } from '@/lib/api';

// Common tokens (with logoURI for TokenSelector compatibility)
const POPULAR_TOKENS: Token[] = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9, logoURI: '' },
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, logoURI: '' },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, logoURI: '' },
];

// DCA intervals
const INTERVALS = [
  { label: 'Every hour', value: 3600000 },
  { label: 'Every 4 hours', value: 14400000 },
  { label: 'Every 12 hours', value: 43200000 },
  { label: 'Every day', value: 86400000 },
  { label: 'Every week', value: 604800000 },
];

export default function DCAPage() {
  const { publicKey, connected } = useWallet();
  const queryClient = useQueryClient();

  const [customTokens, setCustomTokens] = useState<Token[]>(POPULAR_TOKENS);
  const [inputToken, setInputToken] = useState<Token>(POPULAR_TOKENS[1]); // USDC
  const [outputToken, setOutputToken] = useState<Token>(POPULAR_TOKENS[0]); // SOL
  const [totalAmount, setTotalAmount] = useState('');
  const [numberOfOrders, setNumberOfOrders] = useState(10);
  const [interval, setInterval] = useState(INTERVALS[3].value); // Daily

  // Resolve token by mint (for custom tokens)
  const resolveTokenByMint = async (mint: string): Promise<Token | null> => {
    const existing = customTokens.find(t => t.mint === mint);
    if (existing) return existing;

    const info: TokenInfo = await apiClient.getTokenByMint(mint);
    const token: Token = {
      symbol: info.symbol,
      mint: info.mint,
      decimals: info.decimals,
      logoURI: info.logoURI || '',
    };
    setCustomTokens(prev => (prev.some(t => t.mint === token.mint) ? prev : [token, ...prev]));
    return token;
  };

  // Fetch existing DCA intents
  const { data: intents, isLoading: intentsLoading } = useQuery({
    queryKey: ['intents', publicKey?.toBase58(), 'dca'],
    queryFn: async () => {
      if (!publicKey) return [];
      const all = await apiClient.getIntents(publicKey.toBase58());
      return all.filter((i: any) => i.type === 'dca');
    },
    enabled: !!publicKey,
  });

  // Create DCA mutation
  const createDCA = useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error('Wallet not connected');

      return apiClient.createIntent({
        userPublicKey: publicKey.toBase58(),
        type: 'dca',
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        totalAmount: Math.floor(parseFloat(totalAmount) * 10 ** inputToken.decimals),
        intervalMs: interval,
        numberOfOrders,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intents'] });
      setTotalAmount('');
    },
  });

  // Cancel DCA mutation
  const cancelDCA = useMutation({
    mutationFn: async (intentId: string) => {
      if (!publicKey) throw new Error('Wallet not connected');
      return apiClient.cancelIntent(intentId, publicKey.toBase58());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intents'] });
    },
  });

  const amountPerOrder = totalAmount
    ? (parseFloat(totalAmount) / numberOfOrders).toFixed(inputToken.decimals)
    : '0';

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Page Header */}
          <div className="mb-8 text-center">
            <h1 className="text-surface-900 text-3xl font-bold dark:text-white">
              Dollar Cost Averaging
            </h1>
            <p className="text-surface-600 dark:text-surface-400 mt-2">
              Automatically buy tokens at regular intervals
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Create DCA Form */}
            <div className="card">
              <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                Create DCA Order
              </h2>

              {!connected ? (
                <div className="text-surface-600 dark:text-surface-400 py-8 text-center">
                  Connect your wallet to create DCA orders
                </div>
              ) : (
                <div className="space-y-6">
                  {/* From Token */}
                  <div>
                    <label className="label mb-2">Spend</label>
                    <TokenSelector
                      selectedToken={inputToken}
                      onSelectToken={setInputToken}
                      tokens={customTokens}
                      resolveTokenByMint={resolveTokenByMint}
                    />
                  </div>

                  {/* To Token */}
                  <div>
                    <label className="label mb-2">To receive</label>
                    <TokenSelector
                      selectedToken={outputToken}
                      onSelectToken={setOutputToken}
                      tokens={customTokens.filter(t => t.mint !== inputToken.mint)}
                      resolveTokenByMint={resolveTokenByMint}
                    />
                  </div>

                  {/* Total Amount */}
                  <div>
                    <label className="label mb-2">Total Amount ({inputToken.symbol})</label>
                    <input
                      type="number"
                      value={totalAmount}
                      onChange={e => setTotalAmount(e.target.value)}
                      placeholder="0.0"
                      className="input w-full"
                      min={0}
                    />
                  </div>

                  {/* Number of Orders */}
                  <div>
                    <label className="label mb-2">Number of Orders</label>
                    <input
                      type="number"
                      value={numberOfOrders}
                      onChange={e => setNumberOfOrders(parseInt(e.target.value) || 1)}
                      className="input w-full"
                      min={2}
                      max={100}
                    />
                  </div>

                  {/* Interval */}
                  <div>
                    <label className="label mb-2">Frequency</label>
                    <select
                      value={interval}
                      onChange={e => setInterval(parseInt(e.target.value))}
                      className="input w-full"
                    >
                      {INTERVALS.map(i => (
                        <option key={i.value} value={i.value}>
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Summary */}
                  {totalAmount && parseFloat(totalAmount) > 0 && (
                    <div className="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                      <div className="text-surface-600 dark:text-surface-400 text-sm">
                        You will swap{' '}
                        <span className="text-surface-900 font-medium dark:text-white">
                          {amountPerOrder} {inputToken.symbol}
                        </span>{' '}
                        for{' '}
                        <span className="text-surface-900 font-medium dark:text-white">
                          {outputToken.symbol}
                        </span>{' '}
                        {INTERVALS.find(i => i.value === interval)?.label.toLowerCase()},{' '}
                        {numberOfOrders} times.
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    onClick={() => createDCA.mutate()}
                    disabled={!totalAmount || createDCA.isPending}
                    className="btn-primary w-full py-3"
                  >
                    {createDCA.isPending ? 'Creating...' : 'Create DCA Order'}
                  </button>

                  {createDCA.isError && (
                    <div className="text-sm text-red-500">{(createDCA.error as Error).message}</div>
                  )}
                </div>
              )}
            </div>

            {/* Active DCA Orders */}
            <div className="card">
              <h2 className="text-surface-900 mb-6 text-xl font-semibold dark:text-white">
                Active DCA Orders
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
                  No active DCA orders
                </div>
              ) : (
                <div className="space-y-4">
                  {intents.map((intent: any) => (
                    <div
                      key={intent.id}
                      className="border-surface-200 dark:border-surface-700 rounded-lg border p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-surface-900 font-medium dark:text-white">
                            {intent.inputMint.slice(0, 4)}... → {intent.outputMint.slice(0, 4)}...
                          </div>
                          <div className="text-surface-500 text-sm">
                            {intent.ordersExecuted || 0} / {intent.numberOfOrders} orders
                          </div>
                        </div>
                        <button
                          onClick={() => cancelDCA.mutate(intent.id)}
                          disabled={cancelDCA.isPending}
                          className="btn-ghost text-sm text-red-500 hover:text-red-600"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="bg-surface-200 dark:bg-surface-700 mt-2 h-2 overflow-hidden rounded-full">
                        <div
                          className="bg-primary-500 h-full"
                          style={{
                            width: `${((intent.ordersExecuted || 0) / intent.numberOfOrders) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
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
