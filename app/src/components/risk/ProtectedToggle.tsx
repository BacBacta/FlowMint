/**
 * Protected Mode Toggle Component
 *
 * Toggle between standard and protected execution modes.
 */

'use client';

import { Shield, ShieldOff } from 'lucide-react';
import { useState } from 'react';

interface ProtectedToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ProtectedToggle({
  enabled,
  onChange,
  disabled = false,
  className = '',
}: ProtectedToggleProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full
          transition-colors duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
        `}
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-white
            transition-transform duration-200
            ${enabled ? 'translate-x-6' : 'translate-x-1'}
          `}
        />
      </button>
      <div className="flex items-center gap-2">
        {enabled ? (
          <Shield size={18} className="text-blue-600 dark:text-blue-400" />
        ) : (
          <ShieldOff size={18} className="text-gray-400" />
        )}
        <span
          className={`text-sm font-medium ${
            enabled
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          Protected Mode
        </span>
      </div>
    </div>
  );
}

/**
 * Protected Mode Card
 * Expandable card with explanation
 */
interface ProtectedModeCardProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ProtectedModeCard({
  enabled,
  onChange,
  disabled = false,
  className = '',
}: ProtectedModeCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className={`
        rounded-lg border p-4
        ${enabled
          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
          : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
        }
        ${className}
      `}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {enabled ? (
            <Shield size={24} className="text-blue-600 dark:text-blue-400" />
          ) : (
            <ShieldOff size={24} className="text-gray-400" />
          )}
          <div>
            <h3 className="font-medium text-gray-800 dark:text-gray-200">
              Protected Mode
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {enabled ? 'Enhanced safety checks enabled' : 'Standard execution'}
            </p>
          </div>
        </div>
        <button
          onClick={() => !disabled && onChange(!enabled)}
          disabled={disabled}
          className={`
            px-4 py-2 rounded-lg font-medium transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            ${enabled
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300'
            }
          `}
        >
          {enabled ? 'Enabled' : 'Enable'}
        </button>
      </div>

      {/* Show details link */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        {showDetails ? 'Hide details' : 'What does this do?'}
      </button>

      {showDetails && (
        <div className="mt-3 p-3 rounded bg-white/50 dark:bg-gray-800/50">
          <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2">
            Protected Mode Features:
          </h4>
          <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Stricter slippage limits (max 1%)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Lower price impact threshold (max 0.3%)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Blocks trades with freeze authority tokens
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Re-quotes before execution
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Shorter quote TTL (15 seconds)
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
