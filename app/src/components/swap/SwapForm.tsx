'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  RiskBadge,
  RiskBreakdown,
  ProtectedToggle,
  ExecutionStatus,
  type RiskLevel,
  type RiskReason,
  type ExecutionStep,
} from '@/components/risk';
import { apiClient, type TokenInfo } from '@/lib/api';

import { ExecutionProfileSelector, type ExecutionProfile } from './ExecutionProfileSelector';
import { ReceiptModal } from './ReceiptModal';
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

  const [customTokens, setCustomTokens] = useState(POPULAR_TOKENS);
  const [inputToken, setInputToken] = useState(POPULAR_TOKENS[0]);
  const [outputToken, setOutputToken] = useState(POPULAR_TOKENS[1]);
  const [inputAmount, setInputAmount] = useState('');
  const [slippage, setSlippage] = useState(50); // 0.5% in bps
  const [showSettings, setShowSettings] = useState(false);
  const [protectedMode, setProtectedMode] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [executionProfile, setExecutionProfile] = useState<ExecutionProfile>('AUTO');
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [lastReceipt, _setLastReceipt] = useState<any>(null);

  const safeParseNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const formatBaseUnits = (baseUnits: unknown, decimals: number, displayDecimals = 6): string => {
    if (typeof baseUnits !== 'string' || !/^\d+$/.test(baseUnits)) return '';
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return '';

    const value = BigInt(baseUnits);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = value % divisor;

    if (decimals === 0) return whole.toString();

    const fracFull = frac.toString().padStart(decimals, '0');
    const shown = fracFull.slice(0, Math.min(displayDecimals, decimals));
    const paddedShown = shown.padEnd(displayDecimals, '0');
    return `${whole.toString()}.${paddedShown}`;
  };

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

      // Reset and start execution tracking
      setExecutionSteps([
        { id: 'prepare', label: 'Preparing transaction', status: 'current' },
        { id: 'sign', label: 'Waiting for signature', status: 'pending' },
        { id: 'send', label: 'Sending transaction', status: 'pending' },
        { id: 'confirm', label: 'Confirming on-chain', status: 'pending' },
      ]);

      // Get swap transaction from server
      setExecutionSteps(prev =>
        prev.map(s =>
          s.id === 'prepare'
            ? { ...s, status: 'completed' }
            : s.id === 'sign'
              ? { ...s, status: 'current' }
              : s
        )
      );

      const swapTx = await apiClient.executeSwap({
        userPublicKey: publicKey.toBase58(),
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: Math.floor(parseFloat(inputAmount) * 10 ** inputToken.decimals).toString(),
        slippageBps: slippage,
        protectedMode,
      });

      // Update execution steps after successful submission
      setExecutionSteps(prev =>
        prev.map(s =>
          s.id === 'sign'
            ? { ...s, status: 'completed' }
            : s.id === 'send'
              ? { ...s, status: 'current' }
              : s
        )
      );

      return swapTx;
    },
    onSuccess: () => {
      setExecutionSteps(prev => prev.map(s => ({ ...s, status: 'completed' as const })));
      queryClient.invalidateQueries({ queryKey: ['quote'] });
      queryClient.invalidateQueries({ queryKey: ['swapHistory'] });
      setInputAmount('');
      setRiskAcknowledged(false);
    },
  });

  // Swap tokens
  const handleSwapTokens = () => {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
    setInputAmount('');
  };

  const resolveTokenByMint = async (mint: string) => {
    const existing = customTokens.find(t => t.mint === mint);
    if (existing) return existing;

    const info: TokenInfo = await apiClient.getTokenByMint(mint);
    const token = {
      symbol: info.symbol,
      mint: info.mint,
      decimals: info.decimals,
      logoURI: info.logoURI || '',
    };
    setCustomTokens(prev => (prev.some(t => t.mint === token.mint) ? prev : [token, ...prev]));
    return token;
  };

  // Calculate output amount
  const outputAmount = quote ? formatBaseUnits(quote.outAmount, outputToken.decimals, 6) : '';

  // Price impact
  const priceImpactPct = safeParseNumber(quote?.priceImpactPct);
  const priceImpact = priceImpactPct !== null ? (priceImpactPct * 100).toFixed(2) : null;

  // Calculate risk level based on quote
  const calculateRiskLevel = (): RiskLevel => {
    if (!quote) return 'GREEN';
    const impactPct = safeParseNumber(quote.priceImpactPct);
    const impact = impactPct === null ? 0 : impactPct * 100;
    if (impact > 3 || slippage > 300) return 'RED';
    if (impact > 1 || slippage > 100) return 'AMBER';
    return 'GREEN';
  };

  const riskLevel = calculateRiskLevel();

  // Build risk reasons for display
  const buildRiskReasons = (): RiskReason[] => {
    const reasons: RiskReason[] = [];
    if (!quote) return reasons;

    const impactPct = safeParseNumber(quote.priceImpactPct);
    const impact = impactPct === null ? 0 : impactPct * 100;

    if (impact > 3) {
      reasons.push({
        code: 'HIGH_PRICE_IMPACT',
        severity: 'RED',
        message: `Price impact is ${impact.toFixed(2)}%, which exceeds the 3% threshold`,
      });
    } else if (impact > 1) {
      reasons.push({
        code: 'MODERATE_PRICE_IMPACT',
        severity: 'AMBER',
        message: `Price impact of ${impact.toFixed(2)}% is notable`,
      });
    }

    if (slippage > 300) {
      reasons.push({
        code: 'HIGH_SLIPPAGE',
        severity: 'RED',
        message: `Slippage tolerance of ${slippage / 100}% is very high`,
      });
    } else if (slippage > 100) {
      reasons.push({
        code: 'MODERATE_SLIPPAGE',
        severity: 'AMBER',
        message: `Slippage tolerance of ${slippage / 100}% is above normal`,
      });
    }

    if (quote.routePlan?.length > 3) {
      reasons.push({
        code: 'COMPLEX_ROUTE',
        severity: 'AMBER',
        message: `Route has ${quote.routePlan.length} steps, which may increase fees`,
      });
    }

    return reasons;
  };

  const riskReasons = buildRiskReasons();
  const requiresAcknowledgement = riskLevel === 'AMBER' && !protectedMode;
  const isBlocked = riskLevel === 'RED' && protectedMode;

  return (
    <div className="card">
      {/* Protected Mode Toggle */}
      <div className="mb-4">
        <ProtectedToggle enabled={protectedMode} onChange={setProtectedMode} />
      </div>

      {/* Settings Button */}
      <div className="mb-4 flex items-center justify-between">
        {/* Risk Badge */}
        {quote && <RiskBadge level={riskLevel} size="sm" />}

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

          {/* Execution Profile Selector */}
          <div className="mt-4">
            <ExecutionProfileSelector value={executionProfile} onChange={setExecutionProfile} />
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
            tokens={customTokens}
            resolveTokenByMint={resolveTokenByMint}
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
            tokens={customTokens}
            resolveTokenByMint={resolveTokenByMint}
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
              {(() => {
                const inAmt = safeParseNumber(inputAmount);
                const outAmt = safeParseNumber(outputAmount);
                if (inAmt === null || outAmt === null || inAmt <= 0) return '-';
                return (outAmt / inAmt).toFixed(4);
              })()}{' '}
              {outputToken.symbol}
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

      {/* Risk Breakdown */}
      {quote && riskReasons.length > 0 && (
        <div className="mt-4">
          <RiskBreakdown
            reasons={riskReasons}
            level={riskLevel}
            blockedInProtectedMode={isBlocked}
            requiresAcknowledgement={requiresAcknowledgement}
            onAcknowledge={() => setRiskAcknowledged(true)}
            acknowledged={riskAcknowledged}
          />
        </div>
      )}

      {/* Blocked in Protected Mode Warning */}
      {isBlocked && (
        <div className="mt-4 rounded-lg bg-red-50 p-4 dark:bg-red-900/30">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">
                Blocked by Protected Mode
              </p>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                This swap has been blocked because it exceeds the safety thresholds for protected
                mode. Disable protected mode to proceed (at your own risk).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Execution Status (during swap) */}
      {swapMutation.isPending && executionSteps.length > 0 && (
        <div className="mt-4">
          <ExecutionStatus steps={executionSteps} variant="minimal" />
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
        disabled={
          !quote ||
          swapMutation.isPending ||
          !inputAmount ||
          isBlocked ||
          (requiresAcknowledgement && !riskAcknowledged)
        }
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
        ) : isBlocked ? (
          '🛡️ Blocked by Protected Mode'
        ) : requiresAcknowledgement && !riskAcknowledged ? (
          'Acknowledge Risks to Continue'
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

      {/* Receipt Modal */}
      <ReceiptModal
        isOpen={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        receipt={lastReceipt}
      />
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
