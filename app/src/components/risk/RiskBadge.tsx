/**
 * Risk Badge Component
 *
 * Displays a traffic light indicator for risk level.
 */

'use client';

import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

export type RiskLevel = 'GREEN' | 'AMBER' | 'RED';

interface RiskBadgeProps {
  level: RiskLevel;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const RISK_CONFIG: Record<
  RiskLevel,
  {
    label: string;
    bgColor: string;
    textColor: string;
    borderColor: string;
    icon: typeof CheckCircle;
  }
> = {
  GREEN: {
    label: 'Safe',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-400',
    borderColor: 'border-green-300 dark:border-green-700',
    icon: CheckCircle,
  },
  AMBER: {
    label: 'Caution',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    textColor: 'text-yellow-700 dark:text-yellow-400',
    borderColor: 'border-yellow-300 dark:border-yellow-700',
    icon: AlertTriangle,
  },
  RED: {
    label: 'High Risk',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-400',
    borderColor: 'border-red-300 dark:border-red-700',
    icon: XCircle,
  },
};

const SIZE_CONFIG = {
  sm: {
    padding: 'px-2 py-0.5',
    iconSize: 14,
    text: 'text-xs',
  },
  md: {
    padding: 'px-2.5 py-1',
    iconSize: 16,
    text: 'text-sm',
  },
  lg: {
    padding: 'px-3 py-1.5',
    iconSize: 18,
    text: 'text-base',
  },
};

export function RiskBadge({
  level,
  size = 'md',
  showLabel = true,
  className = '',
}: RiskBadgeProps) {
  const config = RISK_CONFIG[level];
  const sizeConfig = SIZE_CONFIG[size];
  const Icon = config.icon;

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full border
        ${config.bgColor} ${config.textColor} ${config.borderColor}
        ${sizeConfig.padding} ${sizeConfig.text}
        font-medium
        ${className}
      `}
    >
      <Icon size={sizeConfig.iconSize} />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

/**
 * Risk Indicator Dot
 * Simple colored dot for minimal display
 */
interface RiskDotProps {
  level: RiskLevel;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

const DOT_COLORS: Record<RiskLevel, string> = {
  GREEN: 'bg-green-500',
  AMBER: 'bg-yellow-500',
  RED: 'bg-red-500',
};

const DOT_SIZES = {
  sm: 'w-2 h-2',
  md: 'w-3 h-3',
  lg: 'w-4 h-4',
};

export function RiskDot({ level, size = 'md', pulse = false, className = '' }: RiskDotProps) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <span
        className={`
          inline-block rounded-full
          ${DOT_COLORS[level]} ${DOT_SIZES[size]}
        `}
      />
      {pulse && (
        <span
          className={`
            absolute inline-flex h-full w-full animate-ping rounded-full opacity-75
            ${DOT_COLORS[level]}
          `}
        />
      )}
    </span>
  );
}
