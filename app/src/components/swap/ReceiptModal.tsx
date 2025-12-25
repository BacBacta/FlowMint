'use client';

import { useState } from 'react';

import { ExecutionTimeline } from './ExecutionTimeline';

interface ReceiptData {
  receiptId: string;
  status: 'pending' | 'success' | 'failed';
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  expectedOutput?: string;
  priceImpact: string;
  slippage: number;
  signature?: string;
  timestamp: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warnings?: string[];
  retryCount?: number;
  executionProfile?: 'AUTO' | 'FAST' | 'CHEAP';
}

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: ReceiptData | null;
}

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const riskColors = {
  LOW: 'text-green-600 dark:text-green-400',
  MEDIUM: 'text-yellow-600 dark:text-yellow-400',
  HIGH: 'text-orange-600 dark:text-orange-400',
  CRITICAL: 'text-red-600 dark:text-red-400',
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatAmount(amount: string, decimals: number = 9): string {
  const num = parseFloat(amount) / Math.pow(10, decimals);
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function ReceiptModal({ isOpen, onClose, receipt }: ReceiptModalProps) {
  const [copied, setCopied] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  if (!isOpen || !receipt) return null;

  const copySignature = async () => {
    if (receipt.signature) {
      await navigator.clipboard.writeText(receipt.signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const slippageActual =
    receipt.expectedOutput && receipt.outputAmount
      ? (
          ((parseFloat(receipt.expectedOutput) - parseFloat(receipt.outputAmount)) /
            parseFloat(receipt.expectedOutput)) *
          100
        ).toFixed(2)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Transaction Receipt</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Status Badge */}
        <div className="mb-4 flex items-center justify-center">
          <span
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${statusColors[receipt.status]}`}
          >
            {receipt.status === 'pending' && '⏳ '}
            {receipt.status === 'success' && '✅ '}
            {receipt.status === 'failed' && '❌ '}
            {receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1)}
          </span>
        </div>

        {/* Receipt Details */}
        <div className="space-y-3">
          {/* Swap Details */}
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Input</span>
              <span className="font-mono font-medium text-gray-900 dark:text-white">
                {formatAmount(receipt.inputAmount)} {shortenAddress(receipt.inputMint)}
              </span>
            </div>
            <div className="flex items-center justify-center py-1">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Output</span>
              <span className="font-mono font-medium text-gray-900 dark:text-white">
                {formatAmount(receipt.outputAmount)} {shortenAddress(receipt.outputMint)}
              </span>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <span className="text-xs text-gray-500 dark:text-gray-400">Price Impact</span>
              <p className="font-medium text-gray-900 dark:text-white">{receipt.priceImpact}%</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <span className="text-xs text-gray-500 dark:text-gray-400">Slippage</span>
              <p className="font-medium text-gray-900 dark:text-white">
                {slippageActual ? `${slippageActual}%` : `${receipt.slippage / 100}%`}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <span className="text-xs text-gray-500 dark:text-gray-400">Risk Level</span>
              <p className={`font-medium ${riskColors[receipt.riskLevel]}`}>{receipt.riskLevel}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <span className="text-xs text-gray-500 dark:text-gray-400">Profile</span>
              <p className="font-medium text-gray-900 dark:text-white">
                {receipt.executionProfile || 'AUTO'}
              </p>
            </div>
          </div>

          {/* Warnings */}
          {receipt.warnings && receipt.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
              <p className="mb-1 text-xs font-medium text-yellow-800 dark:text-yellow-300">
                ⚠️ Warnings
              </p>
              <ul className="space-y-1">
                {receipt.warnings.map((warning, i) => (
                  <li key={i} className="text-xs text-yellow-700 dark:text-yellow-400">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Transaction Signature */}
          {receipt.signature && (
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">Transaction</span>
                <button
                  onClick={copySignature}
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <a
                href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                {receipt.signature}
              </a>
            </div>
          )}

          {/* Timestamp */}
          <div className="text-center text-xs text-gray-500 dark:text-gray-400">
            {formatTimestamp(receipt.timestamp)}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setShowTimeline(true)}
            className="flex-1 rounded-lg border border-gray-300 bg-white py-2.5 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            📋 Timeline
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-gray-900 py-2.5 text-white hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500"
          >
            Close
          </button>
        </div>
      </div>

      {/* Execution Timeline Modal */}
      <ExecutionTimeline
        receiptId={receipt.receiptId}
        isOpen={showTimeline}
        onClose={() => setShowTimeline(false)}
      />
    </div>
  );
}

export default ReceiptModal;
