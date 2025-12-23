/**
 * Execution Status Component
 *
 * Shows swap execution progress with status steps.
 */

'use client';

import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react';

export type ExecutionStep = 'quoting' | 'building' | 'sending' | 'confirming' | 'confirmed' | 'failed';

interface ExecutionStatusProps {
  currentStep: ExecutionStep;
  error?: string;
  signature?: string;
  attempts?: number;
  className?: string;
}

const STEPS: { key: ExecutionStep; label: string }[] = [
  { key: 'quoting', label: 'Getting quote' },
  { key: 'building', label: 'Building transaction' },
  { key: 'sending', label: 'Sending to network' },
  { key: 'confirming', label: 'Confirming' },
];

export function ExecutionStatus({
  currentStep,
  error,
  signature,
  attempts,
  className = '',
}: ExecutionStatusProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);
  const isComplete = currentStep === 'confirmed';
  const isFailed = currentStep === 'failed';

  return (
    <div className={`p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 ${className}`}>
      <div className="space-y-3">
        {STEPS.map((step, index) => {
          const isPast = index < currentIndex || isComplete;
          const isCurrent = index === currentIndex && !isComplete && !isFailed;
          const isFutureOrFailed = index > currentIndex || isFailed;

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 ${
                isFutureOrFailed && !isPast ? 'opacity-40' : ''
              }`}
            >
              {/* Status icon */}
              {isPast ? (
                <CheckCircle size={20} className="text-green-500" />
              ) : isCurrent ? (
                <Loader2 size={20} className="text-blue-500 animate-spin" />
              ) : isFailed && index === currentIndex ? (
                <XCircle size={20} className="text-red-500" />
              ) : (
                <Circle size={20} className="text-gray-300 dark:text-gray-600" />
              )}

              {/* Label */}
              <span
                className={`text-sm ${
                  isPast
                    ? 'text-green-600 dark:text-green-400'
                    : isCurrent
                    ? 'text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-500 dark:text-gray-500'
                }`}
              >
                {step.label}
              </span>

              {/* Progress indicator for current step */}
              {isCurrent && (
                <span className="text-xs text-gray-400">
                  {attempts && attempts > 1 ? `(attempt ${attempts})` : ''}
                </span>
              )}
            </div>
          );
        })}

        {/* Success state */}
        {isComplete && (
          <div className="mt-4 p-3 rounded-lg bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle size={20} />
              <span className="font-medium">Transaction confirmed!</span>
            </div>
            {signature && (
              <a
                href={`https://solscan.io/tx/${signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-sm text-green-600 dark:text-green-400 hover:underline block"
              >
                View on Solscan →
              </a>
            )}
          </div>
        )}

        {/* Failed state */}
        {isFailed && error && (
          <div className="mt-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <XCircle size={20} />
              <span className="font-medium">Transaction failed</span>
            </div>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact execution indicator
 */
interface ExecutionIndicatorProps {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
}

export function ExecutionIndicator({ status, message }: ExecutionIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
        status === 'loading'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          : status === 'success'
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      }`}
    >
      {status === 'loading' && <Loader2 size={16} className="animate-spin" />}
      {status === 'success' && <CheckCircle size={16} />}
      {status === 'error' && <XCircle size={16} />}
      <span>{message}</span>
    </div>
  );
}
