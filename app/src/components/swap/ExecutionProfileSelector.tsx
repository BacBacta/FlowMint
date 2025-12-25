'use client';

import { useState } from 'react';

/**
 * Execution profile options
 * - AUTO: Balanced approach, automatic fee adjustment
 * - FAST: Higher fees for faster confirmation
 * - CHEAP: Lower fees, may take longer
 */
export type ExecutionProfile = 'AUTO' | 'FAST' | 'CHEAP';

interface ExecutionProfileSelectorProps {
  value: ExecutionProfile;
  onChange: (profile: ExecutionProfile) => void;
  disabled?: boolean;
}

const profiles: {
  id: ExecutionProfile;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: 'AUTO',
    label: 'Auto',
    description: 'Balanced speed and cost',
    icon: '⚡',
  },
  {
    id: 'FAST',
    label: 'Fast',
    description: 'Priority fees for quick confirmation',
    icon: '🚀',
  },
  {
    id: 'CHEAP',
    label: 'Économique',
    description: 'Lower fees, may take longer',
    icon: '💰',
  },
];

export function ExecutionProfileSelector({
  value,
  onChange,
  disabled = false,
}: ExecutionProfileSelectorProps) {
  const [showTooltip, setShowTooltip] = useState<ExecutionProfile | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Execution Profile
      </label>
      <div className="flex gap-2">
        {profiles.map(profile => (
          <button
            key={profile.id}
            onClick={() => !disabled && onChange(profile.id)}
            onMouseEnter={() => setShowTooltip(profile.id)}
            onMouseLeave={() => setShowTooltip(null)}
            disabled={disabled}
            className={`relative flex flex-1 flex-col items-center rounded-lg border-2 p-3 transition-all ${
              value === profile.id
                ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            <span className="text-2xl">{profile.icon}</span>
            <span
              className={`mt-1 text-sm font-medium ${
                value === profile.id
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {profile.label}
            </span>

            {/* Tooltip */}
            {showTooltip === profile.id && (
              <div className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 transform whitespace-nowrap rounded bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-gray-700">
                {profile.description}
                <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-gray-900 dark:bg-gray-700" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ExecutionProfileSelector;
