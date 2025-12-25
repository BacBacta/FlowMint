/**
 * Risk Breakdown Component
 *
 * Displays detailed risk reasons with explanations.
 */

'use client';

import { ChevronDown, ChevronUp, Info, AlertTriangle, XCircle, CheckCircle } from 'lucide-react';
import { useState } from 'react';

import { RiskBadge, RiskLevel } from './RiskBadge';

export interface RiskReason {
  code: string;
  severity: RiskLevel;
  message: string;
  detail?: string;
  threshold?: { used: number; limit: number };
}

interface RiskBreakdownProps {
  level: RiskLevel;
  reasons: RiskReason[];
  blockedInProtectedMode?: boolean;
  requiresAcknowledgement?: boolean;
  onAcknowledge?: () => void;
  acknowledged?: boolean;
  className?: string;
}

const SEVERITY_ICONS: Record<RiskLevel, typeof CheckCircle> = {
  GREEN: Info,
  AMBER: AlertTriangle,
  RED: XCircle,
};

const SEVERITY_COLORS: Record<RiskLevel, string> = {
  GREEN: 'text-green-600 dark:text-green-400',
  AMBER: 'text-yellow-600 dark:text-yellow-400',
  RED: 'text-red-600 dark:text-red-400',
};

export function RiskBreakdown({
  level,
  reasons,
  blockedInProtectedMode = false,
  requiresAcknowledgement = false,
  onAcknowledge,
  acknowledged: externalAcknowledged,
  className = '',
}: RiskBreakdownProps) {
  const [isExpanded, setIsExpanded] = useState(level !== 'GREEN');
  const [internalAcknowledged, setInternalAcknowledged] = useState(false);

  // Use external acknowledged state if provided, otherwise use internal
  const acknowledged =
    externalAcknowledged !== undefined ? externalAcknowledged : internalAcknowledged;

  const handleAcknowledge = () => {
    setInternalAcknowledged(true);
    onAcknowledge?.();
  };

  // Filter out GREEN reasons if there are more serious ones
  const displayReasons = level === 'GREEN' ? reasons : reasons.filter(r => r.severity !== 'GREEN');

  return (
    <div
      className={`
        rounded-lg border p-4
        ${level === 'GREEN' ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20' : ''}
        ${level === 'AMBER' ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20' : ''}
        ${level === 'RED' ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20' : ''}
        ${className}
      `}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <RiskBadge level={level} size="md" />
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {level === 'GREEN' && 'Trade looks safe'}
            {level === 'AMBER' && 'Review warnings before proceeding'}
            {level === 'RED' && 'High risk trade'}
          </span>
        </div>
        <button className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-4 space-y-3">
          {displayReasons.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              No issues detected with this trade.
            </p>
          ) : (
            displayReasons.map((reason, index) => {
              const Icon = SEVERITY_ICONS[reason.severity];
              return (
                <div
                  key={`${reason.code}-${index}`}
                  className="flex items-start gap-3 rounded bg-white/50 p-2 dark:bg-gray-800/50"
                >
                  <Icon
                    size={18}
                    className={`mt-0.5 flex-shrink-0 ${SEVERITY_COLORS[reason.severity]}`}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {reason.message}
                    </p>
                    {reason.detail && (
                      <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                        {reason.detail}
                      </p>
                    )}
                    {reason.threshold && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                        Value: {reason.threshold.used.toFixed(2)} / Limit:{' '}
                        {reason.threshold.limit.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Blocked warning */}
          {blockedInProtectedMode && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-100 p-3 dark:border-red-800 dark:bg-red-900/30">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                ⚠️ This trade is blocked in Protected Mode
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400/80">
                Disable Protected Mode to proceed at your own risk.
              </p>
            </div>
          )}

          {/* Acknowledgement required */}
          {requiresAcknowledgement && !acknowledged && (
            <div className="mt-3">
              <button
                onClick={handleAcknowledge}
                className="w-full rounded-lg bg-yellow-500 px-4 py-2 font-medium text-white transition-colors hover:bg-yellow-600"
              >
                I understand the risks, proceed anyway
              </button>
            </div>
          )}

          {acknowledged && (
            <p className="text-center text-sm text-yellow-600 dark:text-yellow-400">
              ✓ Risks acknowledged
            </p>
          )}
        </div>
      )}
    </div>
  );
}
