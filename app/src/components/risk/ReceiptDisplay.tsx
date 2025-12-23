/**
 * Receipt Display Component
 *
 * Shows detailed swap receipt with quote vs actual comparison.
 */

'use client';

import { ExternalLink, Copy, CheckCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useState } from 'react';

import { RiskBadge, RiskLevel } from './RiskBadge';

export interface ReceiptData {
  receiptId: string;
  signature?: string;
  status: 'pending' | 'confirmed' | 'failed';
  request: {
    inputMint: string;
    outputMint: string;
    amountIn: string;
    slippageBps: number;
    mode: 'standard' | 'protected';
  };
  quote: {
    outAmount: string;
    minOutAmount: string;
    priceImpactPct: string;
    routeSteps: number;
  };
  result?: {
    outAmountActual?: string;
  };
  diff?: {
    quotedOutAmount: string;
    actualOutAmount?: string;
    deltaPct?: string;
  };
  execution: {
    attempts: number;
    totalTimeMs?: number;
    computeUnits?: number;
    priorityFee?: number;
  };
  risk: {
    level: RiskLevel;
  };
  createdAt: number;
}

interface ReceiptDisplayProps {
  receipt: ReceiptData;
  inputSymbol?: string;
  outputSymbol?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  className?: string;
}

export function ReceiptDisplay({
  receipt,
  inputSymbol = 'TOKEN',
  outputSymbol = 'TOKEN',
  inputDecimals = 9,
  outputDecimals = 9,
  className = '',
}: ReceiptDisplayProps) {
  const [copiedSignature, setCopiedSignature] = useState(false);

  const formatAmount = (amount: string, decimals: number): string => {
    const value = parseFloat(amount) / Math.pow(10, decimals);
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  };

  const copySignature = () => {
    if (receipt.signature) {
      navigator.clipboard.writeText(receipt.signature);
      setCopiedSignature(true);
      setTimeout(() => setCopiedSignature(false), 2000);
    }
  };

  const deltaPct = receipt.diff?.deltaPct ? parseFloat(receipt.diff.deltaPct) : 0;
  const deltaPositive = deltaPct > 0;
  const deltaIcon = deltaPct > 0 ? TrendingUp : deltaPct < 0 ? TrendingDown : Minus;
  const DeltaIcon = deltaIcon;

  return (
    <div
      className={`
        rounded-lg border border-gray-200 dark:border-gray-700 
        bg-white dark:bg-gray-800 overflow-hidden
        ${className}
      `}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-gray-800 dark:text-gray-200">
              Swap Receipt
            </h3>
            <RiskBadge level={receipt.risk.level} size="sm" />
          </div>
          <span
            className={`
              px-2 py-0.5 rounded text-xs font-medium
              ${receipt.status === 'confirmed'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : receipt.status === 'failed'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }
            `}
          >
            {receipt.status}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Amounts */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">Sent</p>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {formatAmount(receipt.request.amountIn, inputDecimals)} {inputSymbol}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">
              {receipt.result?.outAmountActual ? 'Received' : 'Expected'}
            </p>
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {formatAmount(
                receipt.result?.outAmountActual || receipt.quote.outAmount,
                outputDecimals
              )}{' '}
              {outputSymbol}
            </p>
          </div>
        </div>

        {/* Quote vs Actual */}
        {receipt.result?.outAmountActual && receipt.diff && (
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Quote vs Actual
              </span>
              <div className="flex items-center gap-1">
                <DeltaIcon
                  size={16}
                  className={
                    deltaPositive
                      ? 'text-green-500'
                      : deltaPct < 0
                      ? 'text-red-500'
                      : 'text-gray-400'
                  }
                />
                <span
                  className={`text-sm font-medium ${
                    deltaPositive
                      ? 'text-green-600 dark:text-green-400'
                      : deltaPct < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {deltaPositive ? '+' : ''}
                  {deltaPct.toFixed(4)}%
                </span>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-500">
              <div>
                Quoted: {formatAmount(receipt.diff.quotedOutAmount, outputDecimals)}
              </div>
              <div>
                Actual: {formatAmount(receipt.diff.actualOutAmount || '0', outputDecimals)}
              </div>
            </div>
          </div>
        )}

        {/* Execution details */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-500">Slippage</span>
            <span className="text-gray-700 dark:text-gray-300">
              {(receipt.request.slippageBps / 100).toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-500">Impact</span>
            <span className="text-gray-700 dark:text-gray-300">
              {parseFloat(receipt.quote.priceImpactPct).toFixed(4)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-500">Route</span>
            <span className="text-gray-700 dark:text-gray-300">
              {receipt.quote.routeSteps} hop{receipt.quote.routeSteps > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-500">Mode</span>
            <span className="text-gray-700 dark:text-gray-300 capitalize">
              {receipt.request.mode}
            </span>
          </div>
          {receipt.execution.totalTimeMs && (
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-500">Time</span>
              <span className="text-gray-700 dark:text-gray-300">
                {(receipt.execution.totalTimeMs / 1000).toFixed(2)}s
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-500">Attempts</span>
            <span className="text-gray-700 dark:text-gray-300">
              {receipt.execution.attempts}
            </span>
          </div>
        </div>

        {/* Signature */}
        {receipt.signature && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">
              Transaction Signature
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-gray-600 dark:text-gray-400 truncate">
                {receipt.signature}
              </code>
              <button
                onClick={copySignature}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                title="Copy signature"
              >
                {copiedSignature ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <Copy size={16} className="text-gray-400" />
                )}
              </button>
              <a
                href={`https://solscan.io/tx/${receipt.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                title="View on Solscan"
              >
                <ExternalLink size={16} className="text-gray-400" />
              </a>
            </div>
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-gray-400 text-center">
          {new Date(receipt.createdAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
