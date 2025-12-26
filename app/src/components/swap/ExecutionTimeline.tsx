'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { apiClient } from '@/lib/api';

export interface ExecutionEvent {
  id: number;
  receiptId: string;
  eventType:
    | 'quote'
    | 'requote'
    | 'flowmint_inject'
    | 'tx_build'
    | 'tx_send'
    | 'tx_confirm'
    | 'retry'
    | 'success'
    | 'failure';
  timestamp: number;
  rpcEndpoint?: string;
  priorityFee?: number;
  slippageBps?: number;
  signature?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

interface ExecutionTimelineProps {
  receiptId: string;
  isOpen: boolean;
  onClose: () => void;
}

const eventTypeLabels: Record<ExecutionEvent['eventType'], string> = {
  quote: 'Quote Obtained',
  requote: 'Re-Quote',
  flowmint_inject: 'FlowMint Injection',
  tx_build: 'Transaction Built',
  tx_send: 'Transaction Sent',
  tx_confirm: 'Transaction Confirmed',
  retry: 'Retry Attempt',
  success: 'Execution Succeeded',
  failure: 'Execution Failed',
};

const eventTypeIcons: Record<ExecutionEvent['eventType'], string> = {
  quote: '📊',
  requote: '🔄',
  flowmint_inject: '⚡',
  tx_build: '🔧',
  tx_send: '📤',
  tx_confirm: '✅',
  retry: '🔁',
  success: '🎉',
  failure: '❌',
};

const eventTypeColors: Record<ExecutionEvent['eventType'], string> = {
  quote: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  requote: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  flowmint_inject: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  tx_build: 'bg-gray-100 text-gray-800 dark:bg-gray-700/50 dark:text-gray-300',
  tx_send: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  tx_confirm: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  retry: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failure: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function ExecutionTimeline({ receiptId, isOpen, onClose }: ExecutionTimelineProps) {
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['timeline', receiptId],
    queryFn: async (): Promise<ExecutionEvent[]> => {
      return apiClient.getSwapReceiptTimeline(receiptId);
    },
    enabled: isOpen && !!receiptId,
    staleTime: 30000,
  });

  if (!isOpen) return null;

  const events = data || [];
  const totalDuration =
    events.length > 1 ? events[events.length - 1].timestamp - events[0].timestamp : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Execution Timeline</h2>
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

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="h-6 w-6 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
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
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          ) : error ? (
            <div className="py-8 text-center text-red-500">Failed to load timeline</div>
          ) : events.length === 0 ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
              No execution events recorded
            </div>
          ) : (
            <div className="relative">
              {/* Total duration */}
              {totalDuration > 0 && (
                <div className="mb-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Total execution time:{' '}
                  <span className="font-medium">{formatDuration(totalDuration)}</span>
                </div>
              )}

              {/* Timeline */}
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-4 top-0 h-full w-0.5 bg-gray-200 dark:bg-gray-700" />

                {/* Events */}
                <div className="space-y-4">
                  {events.map((event, index) => {
                    const prevEvent = index > 0 ? events[index - 1] : null;
                    const deltaMs = prevEvent ? event.timestamp - prevEvent.timestamp : 0;
                    const isExpanded = expandedEvent === event.id;

                    return (
                      <div key={event.id} className="relative pl-10">
                        {/* Dot */}
                        <div
                          className={`absolute left-2 top-1 h-4 w-4 rounded-full border-2 border-white dark:border-gray-800 ${
                            event.eventType === 'success'
                              ? 'bg-green-500'
                              : event.eventType === 'failure'
                                ? 'bg-red-500'
                                : 'bg-blue-500'
                          }`}
                        />

                        {/* Event card */}
                        <button
                          onClick={() => setExpandedEvent(isExpanded ? null : event.id!)}
                          className="w-full text-left"
                        >
                          <div
                            className={`rounded-lg p-3 transition-colors ${eventTypeColors[event.eventType]} ${
                              isExpanded ? 'ring-2 ring-blue-500' : 'hover:opacity-90'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{eventTypeIcons[event.eventType]}</span>
                                <span className="font-medium">
                                  {eventTypeLabels[event.eventType]}
                                </span>
                              </div>
                              <div className="text-xs opacity-75">
                                {formatTimestamp(event.timestamp)}
                                {deltaMs > 0 && (
                                  <span className="ml-2 rounded bg-white/50 px-1 py-0.5 dark:bg-black/20">
                                    +{formatDuration(deltaMs)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Error message inline */}
                            {event.errorMessage && (
                              <div className="mt-1 text-sm opacity-90">{event.errorMessage}</div>
                            )}
                          </div>
                        </button>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="mt-2 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-700/50">
                            <div className="grid grid-cols-2 gap-2">
                              {event.rpcEndpoint && (
                                <div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    RPC
                                  </span>
                                  <p className="truncate font-mono text-xs">{event.rpcEndpoint}</p>
                                </div>
                              )}
                              {event.priorityFee !== undefined && (
                                <div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Priority Fee
                                  </span>
                                  <p className="font-mono text-xs">{event.priorityFee} lamports</p>
                                </div>
                              )}
                              {event.slippageBps !== undefined && (
                                <div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Slippage
                                  </span>
                                  <p className="font-mono text-xs">{event.slippageBps / 100}%</p>
                                </div>
                              )}
                              {event.signature && (
                                <div className="col-span-2">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Signature
                                  </span>
                                  <a
                                    href={`https://explorer.solana.com/tx/${event.signature}?cluster=devnet`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block truncate font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {event.signature}
                                  </a>
                                </div>
                              )}
                              {event.errorCode && (
                                <div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Error Code
                                  </span>
                                  <p className="font-mono text-xs text-red-600 dark:text-red-400">
                                    {event.errorCode}
                                  </p>
                                </div>
                              )}
                              {event.metadata && Object.keys(event.metadata).length > 0 && (
                                <div className="col-span-2">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Metadata
                                  </span>
                                  <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
                                    {JSON.stringify(event.metadata, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <button onClick={onClose} className="btn-primary w-full">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
