'use client';

import { useEffect, useState } from 'react';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';

import { TokenSelector } from './TokenSelector';

// Common tokens
const POPULAR_TOKENS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9, logoURI: '' },
  {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    logoURI: '',
  },
  {
    symbol: 'USDT',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    logoURI: '',
  },
];

export function SwapForm() {
  const { publicKey, signTransaction } = useWallet();
  const { connection: _connection } = useConnection();
  const queryClient = useQueryClient();

  const [inputToken, setInputToken] = useState(POPULAR_TOKENS[0]);
  const [outputToken, setOutputToken] = useState(POPULAR_TOKENS[1]);
  const [inputAmount, setInputAmount] = useState('');
  const [slippage, setSlippage] = useState(50); // 0.5% in bps
  const [showSettings, setShowSettings] = useState(false);

  // Debounced quote fetch
  const debouncedAmount = useDebounce(inputAmount, 500);

  // Fetch quote
  const {
    data: quote,
    isLoading: isQuoteLoading,
    error: quoteError,
  } = useQuery({
    queryKey: ['quote', inputToken.mint, outputToken.mint, debouncedAmount],
    queryFn: async () => {
      if (!debouncedAmount || parseFloat(debouncedAmount) <= 0) {
        return null;
      }
      const amountInLamports = Math.floor(parseFloat(debouncedAmount) * 10 ** inputToken.decimals);
      return apiClient.getQuote({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: amountInLamports,
        slippageBps: slippage,
      });
    },
    enabled: !!debouncedAmount && parseFloat(debouncedAmount) > 0,
    staleTime: 10000, // 10 seconds
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  // Execute swap mutation
  const swapMutation = useMutation({
    mutationFn: async () => {
      if (!publicKey || !signTransaction || !quote) {
        throw new Error('Wallet not connected or no quote');
      }

      // Get swap transaction from server
      const swapTx = await apiClient.executeSwap({
        userPublicKey: publicKey.toBase58(),
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: Math.floor(parseFloat(inputAmount) * 10 ** inputToken.decimals),
        slippageBps: slippage,
      });

      return swapTx;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote'] });
      queryClient.invalidateQueries({ queryKey: ['swapHistory'] });
      setInputAmount('');
    },
  });

  // Swap tokens
  const handleSwapTokens = () => {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
    setInputAmount('');
  };

  // Calculate output amount
  const outputAmount = quote
    ? (parseInt(quote.outAmount) / 10 ** outputToken.decimals).toFixed(6)
    : '';

  // Price impact
  const priceImpact = quote?.priceImpactPct
    ? (parseFloat(quote.priceImpactPct) * 100).toFixed(2)
    : null;

  return (
    <div className="card">
      {/* Settings Button */}
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="btn-ghost rounded-lg p-2"
          title="Settings"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-surface-50 dark:bg-surface-900 mb-6 rounded-lg p-4">
          <label className="label mb-2">Slippage Tolerance</label>
          <div className="flex gap-2">
            {[10, 50, 100, 300].map(bps => (
              <button
                key={bps}
                onClick={() => setSlippage(bps)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  slippage === bps
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-200 text-surface-700 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-300'
                }`}
              >
                {bps / 100}%
              </button>
            ))}
            <input
              type="number"
              value={slippage / 100}
              onChange={e => setSlippage(Math.floor(parseFloat(e.target.value) * 100))}
              className="input w-20 text-center"
              placeholder="Custom"
              min={0}
              max={50}
              step={0.1}
            />
          </div>
        </div>
      )}

      {/* Input Token */}
      <div className="bg-surface-50 dark:bg-surface-900 rounded-xl p-4">
        <label className="label mb-2">You pay</label>
        <div className="flex items-center gap-4">
          <input
            type="number"
            value={inputAmount}
            onChange={e => setInputAmount(e.target.value)}
            placeholder="0.0"
            className="text-surface-900 placeholder:text-surface-400 flex-1 bg-transparent text-3xl font-semibold focus:outline-none dark:text-white"
          />
          <TokenSelector
            selectedToken={inputToken}
            onSelectToken={setInputToken}
            tokens={POPULAR_TOKENS}
          />
        </div>
      </div>

      {/* Swap Button */}
      <div className="relative z-10 -my-3 flex justify-center">
        <button
          onClick={handleSwapTokens}
          className="bg-surface-100 text-surface-600 hover:bg-surface-200 dark:border-surface-800 dark:bg-surface-700 dark:text-surface-400 flex h-10 w-10 items-center justify-center rounded-xl border-4 border-white transition-colors"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      </div>

      {/* Output Token */}
      <div className="bg-surface-50 dark:bg-surface-900 rounded-xl p-4">
        <label className="label mb-2">You receive</label>
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={isQuoteLoading ? 'Loading...' : outputAmount}
            readOnly
            placeholder="0.0"
            className="text-surface-900 placeholder:text-surface-400 flex-1 bg-transparent text-3xl font-semibold focus:outline-none dark:text-white"
          />
          <TokenSelector
            selectedToken={outputToken}
            onSelectToken={setOutputToken}
            tokens={POPULAR_TOKENS}
          />
        </div>
      </div>

      {/* Quote Details */}
      {quote && (
        <div className="bg-surface-50 dark:bg-surface-900 mt-4 rounded-lg p-4 text-sm">
          <div className="text-surface-600 dark:text-surface-400 flex justify-between">
            <span>Rate</span>
            <span>
              1 {inputToken.symbol} ≈{' '}
              {(parseFloat(outputAmount) / parseFloat(inputAmount)).toFixed(4)} {outputToken.symbol}
            </span>
          </div>
          {priceImpact && (
            <div className="mt-2 flex justify-between">
              <span className="text-surface-600 dark:text-surface-400">Price Impact</span>
              <span
                className={
                  parseFloat(priceImpact) > 1
                    ? 'text-red-500'
                    : parseFloat(priceImpact) > 0.3
                      ? 'text-yellow-500'
                      : 'text-green-500'
                }
              >
                {priceImpact}%
              </span>
            </div>
          )}
          <div className="text-surface-600 dark:text-surface-400 mt-2 flex justify-between">
            <span>Slippage</span>
            <span>{slippage / 100}%</span>
          </div>
        </div>
      )}

      {/* Error Message */}
      {quoteError && (
        <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          Failed to get quote. Please try again.
        </div>
      )}

      {/* Swap Button */}
      <button
        onClick={() => swapMutation.mutate()}
        disabled={!quote || swapMutation.isPending || !inputAmount}
        className="btn-primary mt-6 w-full py-4 text-lg"
      >
        {swapMutation.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
            Swapping...
          </span>
        ) : !inputAmount ? (
          'Enter an amount'
        ) : !quote ? (
          'Getting quote...'
        ) : (
          'Swap'
        )}
      </button>

      {/* Success/Error for mutation */}
      {swapMutation.isSuccess && (
        <div className="mt-4 rounded-lg bg-green-50 p-4 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Swap executed successfully!
        </div>
      )}
      {swapMutation.isError && (
        <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          Swap failed: {(swapMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}

// Custom hook for debouncing
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
