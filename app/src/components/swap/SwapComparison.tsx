/**
 * Swap Comparison Component
 *
 * Displays comparison between estimated and actual swap output.
 * Shows slippage variance, execution quality indicators.
 */

'use client';

import { useState, useEffect } from 'react';
import { Check, AlertTriangle, X, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// Use relative path for Next.js API routes
const API_BASE = '/api';

interface ComparisonData {
  receiptId: string;
  estimatedOutput: string;
  actualOutput: string;
  estimatedMinOutput: string;
  slippageBps: number;
  actualSlippageBps: number;
  priceImpactPct: number;
  executionQuality: 'excellent' | 'good' | 'acceptable' | 'poor';
  comparedAt: number;
}

interface SwapComparisonProps {
  receiptId: string;
  inputAmount: string;
  inputMint: string;
  outputMint: string;
  compact?: boolean;
}

export function SwapComparison({
  receiptId,
  inputAmount: _inputAmount,
  inputMint: _inputMint,
  outputMint: _outputMint,
  compact = false,
}: SwapComparisonProps) {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchComparison = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${API_BASE}/analytics/comparison/${receiptId}`);

        if (response.status === 404) {
          // No comparison data available
          setComparison(null);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch comparison');
        }

        const data = await response.json();
        setComparison(data);
      } catch (err) {
        console.error('Failed to fetch comparison:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    if (receiptId) {
      fetchComparison();
    }
  }, [receiptId]);

  // Get quality indicator
  const getQualityInfo = (quality: string) => {
    switch (quality) {
      case 'excellent':
        return {
          icon: Check,
          color: 'text-green-400',
          bgColor: 'bg-green-500/10',
          label: 'Excellent',
          description: 'Mieux que prévu',
        };
      case 'good':
        return {
          icon: Check,
          color: 'text-blue-400',
          bgColor: 'bg-blue-500/10',
          label: 'Bon',
          description: "Proche de l'estimation",
        };
      case 'acceptable':
        return {
          icon: AlertTriangle,
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          label: 'Acceptable',
          description: 'Dans la limite de slippage',
        };
      case 'poor':
        return {
          icon: X,
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          label: 'Faible',
          description: 'En dessous des attentes',
        };
      default:
        return {
          icon: Minus,
          color: 'text-gray-400',
          bgColor: 'bg-gray-500/10',
          label: 'N/A',
          description: 'Pas de données',
        };
    }
  };

  // Format amount with decimals
  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(4)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(4)}K`;
    return num.toFixed(6);
  };

  // Calculate percentage difference
  const getPercentDiff = () => {
    if (!comparison) return 0;
    const estimated = parseFloat(comparison.estimatedOutput);
    const actual = parseFloat(comparison.actualOutput);
    if (estimated === 0) return 0;
    return ((actual - estimated) / estimated) * 100;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={`${compact ? 'inline-flex items-center gap-1' : 'p-3'} text-gray-400`}>
        <div className="h-4 w-4 animate-pulse rounded-full bg-gray-600" />
        {!compact && <span className="text-sm">Chargement...</span>}
      </div>
    );
  }

  // No comparison data
  if (!comparison || error) {
    if (compact) return null;

    return (
      <div className="rounded-lg bg-gray-800/50 p-3 text-sm text-gray-500">
        Pas de données de comparaison disponibles
      </div>
    );
  }

  const percentDiff = getPercentDiff();
  const qualityInfo = getQualityInfo(comparison.executionQuality);
  const QualityIcon = qualityInfo.icon;

  // Compact view for table rows
  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <div className={`rounded p-1 ${qualityInfo.bgColor}`}>
          <QualityIcon className={`h-3 w-3 ${qualityInfo.color}`} />
        </div>
        <span className={`text-xs ${percentDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {percentDiff >= 0 ? '+' : ''}
          {percentDiff.toFixed(2)}%
        </span>
      </div>
    );
  }

  // Full comparison view
  return (
    <div className="space-y-4 rounded-lg bg-gray-800 p-4">
      {/* Header with quality badge */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-300">Comparaison Estimé vs Réel</h4>
        <div className={`flex items-center gap-1 rounded-full px-2 py-1 ${qualityInfo.bgColor}`}>
          <QualityIcon className={`h-3 w-3 ${qualityInfo.color}`} />
          <span className={`text-xs font-medium ${qualityInfo.color}`}>{qualityInfo.label}</span>
        </div>
      </div>

      {/* Comparison bars */}
      <div className="space-y-3">
        {/* Estimated */}
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-400">Estimé</span>
            <span className="font-mono text-white">{formatAmount(comparison.estimatedOutput)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-700">
            <div className="h-full rounded-full bg-blue-500" style={{ width: '100%' }} />
          </div>
        </div>

        {/* Actual */}
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-400">Réel</span>
            <span className="flex items-center gap-1 font-mono text-white">
              {formatAmount(comparison.actualOutput)}
              {percentDiff >= 0 ? (
                <TrendingUp className="h-3 w-3 text-green-400" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-400" />
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-700">
            <div
              className={`h-full rounded-full transition-all ${
                percentDiff >= 0 ? 'bg-green-500' : 'bg-red-500'
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, 100 + percentDiff))}%`,
              }}
            />
          </div>
        </div>

        {/* Minimum expected */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Minimum attendu (avec slippage)</span>
          <span className="font-mono">{formatAmount(comparison.estimatedMinOutput)}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 border-t border-gray-700 pt-2">
        <div className="text-center">
          <p
            className={`text-lg font-bold ${percentDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {percentDiff >= 0 ? '+' : ''}
            {percentDiff.toFixed(2)}%
          </p>
          <p className="text-xs text-gray-500">Différence</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white">
            {(comparison.actualSlippageBps / 100).toFixed(2)}%
          </p>
          <p className="text-xs text-gray-500">Slippage Réel</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white">{comparison.priceImpactPct.toFixed(2)}%</p>
          <p className="text-xs text-gray-500">Impact Prix</p>
        </div>
      </div>

      {/* Quality description */}
      <div className={`text-xs ${qualityInfo.color} text-center`}>{qualityInfo.description}</div>
    </div>
  );
}

export default SwapComparison;
