/**
 * Analytics Dashboard Component
 *
 * Displays platform statistics and user metrics.
 * Includes charts for swap volume, success rates, and execution quality.
 */

'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Activity,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  BarChart3,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

interface PlatformOverview {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  totalVolume: string;
  activeIntents: number;
  completedIntents: number;
  averageExecutionTime: number;
  successRate: number;
}

interface SwapAnalytics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  successRate: number;
  averageSlippage: number;
  totalVolume: string;
  topTokenPairs: Array<{
    inputMint: string;
    outputMint: string;
    count: number;
    volume: string;
  }>;
}

interface ExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageExecutionTime: number;
  retryStats: {
    totalRetries: number;
    successfulRetries: number;
    averageRetriesPerSwap: number;
  };
  rpcStats: {
    [endpoint: string]: {
      requests: number;
      failures: number;
      averageLatency: number;
    };
  };
}

interface UserStats {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  totalVolume: string;
  activeIntents: number;
  completedIntents: number;
  cancelledIntents: number;
  averageSlippage: number;
  successRate: number;
}

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

export function AnalyticsDashboard() {
  const { publicKey } = useWallet();
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [isLoading, setIsLoading] = useState(true);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [swapAnalytics, setSwapAnalytics] = useState<SwapAnalytics | null>(null);
  const [executionStats, setExecutionStats] = useState<ExecutionStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'swaps' | 'execution' | 'user'>('overview');

  // Fetch data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, swapsRes, executionRes] = await Promise.all([
        fetch(`${API_BASE}/analytics/overview?timeRange=${timeRange}`),
        fetch(`${API_BASE}/analytics/swaps?timeRange=${timeRange}`),
        fetch(`${API_BASE}/analytics/execution?timeRange=${timeRange}`),
      ]);

      if (overviewRes.ok) setOverview(await overviewRes.json());
      if (swapsRes.ok) setSwapAnalytics(await swapsRes.json());
      if (executionRes.ok) setExecutionStats(await executionRes.json());

      // Fetch user-specific stats if connected
      if (publicKey) {
        const userRes = await fetch(
          `${API_BASE}/analytics/user/${publicKey.toBase58()}?timeRange=${timeRange}`
        );
        if (userRes.ok) setUserStats(await userRes.json());
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange, publicKey]);

  // Format number with separator
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fr-FR').format(num);
  };

  // Format volume
  const formatVolume = (volume: string) => {
    const num = parseFloat(volume);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  // Format percentage
  const formatPercent = (percent: number) => {
    return `${percent.toFixed(1)}%`;
  };

  // Format time in ms
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Stat card component
  const StatCard = ({
    icon: Icon,
    label,
    value,
    subValue,
    trend,
    color = 'blue',
  }: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    subValue?: string;
    trend?: 'up' | 'down' | 'neutral';
    color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
  }) => {
    const colorClasses = {
      blue: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      green: 'bg-green-500/10 text-green-400 border-green-500/30',
      red: 'bg-red-500/10 text-red-400 border-red-500/30',
      yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      purple: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    };

    return (
      <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
        <div className="flex items-center justify-between mb-2">
          <Icon className="w-5 h-5" />
          {trend && (
            <span className={`flex items-center text-xs ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-400'}`}>
              {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : trend === 'down' ? <ArrowDownRight className="w-3 h-3" /> : null}
            </span>
          )}
        </div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-gray-400">{label}</p>
        {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-400" />
            Analytics
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Statistiques de la plateforme FlowMint
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Time range selector */}
          <div className="flex bg-gray-800 rounded-lg p-1">
            {(['1h', '24h', '7d', '30d', 'all'] as TimeRange[]).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  timeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {range === 'all' ? 'Tout' : range}
              </button>
            ))}
          </div>

          <button
            onClick={fetchData}
            disabled={isLoading}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 text-gray-300 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 mb-6">
        {[
          { id: 'overview', label: 'Vue d\'ensemble' },
          { id: 'swaps', label: 'Swaps' },
          { id: 'execution', label: 'Exécution' },
          ...(publicKey ? [{ id: 'user', label: 'Mes Stats' }] : []),
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Overview Tab */}
      {!isLoading && activeTab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Activity}
              label="Total Swaps"
              value={formatNumber(overview.totalSwaps)}
              subValue={`${formatPercent(overview.successRate)} succès`}
              color="blue"
            />
            <StatCard
              icon={CheckCircle}
              label="Réussis"
              value={formatNumber(overview.successfulSwaps)}
              color="green"
            />
            <StatCard
              icon={XCircle}
              label="Échoués"
              value={formatNumber(overview.failedSwaps)}
              color="red"
            />
            <StatCard
              icon={TrendingUp}
              label="Volume Total"
              value={formatVolume(overview.totalVolume)}
              color="purple"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              icon={Clock}
              label="Temps d'exécution moyen"
              value={formatTime(overview.averageExecutionTime)}
              color="yellow"
            />
            <StatCard
              icon={Activity}
              label="Intents Actifs"
              value={formatNumber(overview.activeIntents)}
              color="blue"
            />
            <StatCard
              icon={CheckCircle}
              label="Intents Complétés"
              value={formatNumber(overview.completedIntents)}
              color="green"
            />
          </div>

          {/* Success Rate Bar */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Taux de Succès</h3>
            <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
                style={{ width: `${overview.successRate}%` }}
              />
            </div>
            <div className="flex justify-between text-sm text-gray-400 mt-2">
              <span>0%</span>
              <span className="text-green-400 font-medium">{formatPercent(overview.successRate)}</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}

      {/* Swaps Tab */}
      {!isLoading && activeTab === 'swaps' && swapAnalytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Activity}
              label="Total Swaps"
              value={formatNumber(swapAnalytics.totalSwaps)}
              color="blue"
            />
            <StatCard
              icon={CheckCircle}
              label="Taux de Succès"
              value={formatPercent(swapAnalytics.successRate)}
              color="green"
            />
            <StatCard
              icon={TrendingUp}
              label="Slippage Moyen"
              value={formatPercent(swapAnalytics.averageSlippage)}
              color="yellow"
            />
            <StatCard
              icon={BarChart3}
              label="Volume"
              value={formatVolume(swapAnalytics.totalVolume)}
              color="purple"
            />
          </div>

          {/* Top Token Pairs */}
          {swapAnalytics.topTokenPairs && swapAnalytics.topTokenPairs.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Top Paires de Tokens</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-gray-400 text-sm">
                      <th className="pb-3">Paire</th>
                      <th className="pb-3">Swaps</th>
                      <th className="pb-3">Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {swapAnalytics.topTokenPairs.map((pair, i) => (
                      <tr key={i} className="text-gray-300">
                        <td className="py-3 font-mono text-sm">
                          {pair.inputMint.slice(0, 6)}.../{pair.outputMint.slice(0, 6)}...
                        </td>
                        <td className="py-3">{formatNumber(pair.count)}</td>
                        <td className="py-3">{formatVolume(pair.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Execution Tab */}
      {!isLoading && activeTab === 'execution' && executionStats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Activity}
              label="Exécutions Totales"
              value={formatNumber(executionStats.totalExecutions)}
              color="blue"
            />
            <StatCard
              icon={CheckCircle}
              label="Taux de Succès"
              value={formatPercent(executionStats.successRate)}
              color="green"
            />
            <StatCard
              icon={Clock}
              label="Temps Moyen"
              value={formatTime(executionStats.averageExecutionTime)}
              color="yellow"
            />
            <StatCard
              icon={RefreshCw}
              label="Total Retries"
              value={formatNumber(executionStats.retryStats?.totalRetries || 0)}
              subValue={`Moy: ${(executionStats.retryStats?.averageRetriesPerSwap || 0).toFixed(2)}/swap`}
              color="purple"
            />
          </div>

          {/* RPC Stats */}
          {executionStats.rpcStats && Object.keys(executionStats.rpcStats).length > 0 && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Statistiques RPC</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-gray-400 text-sm">
                      <th className="pb-3">Endpoint</th>
                      <th className="pb-3">Requêtes</th>
                      <th className="pb-3">Échecs</th>
                      <th className="pb-3">Latence Moy.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {Object.entries(executionStats.rpcStats).map(([endpoint, stats]) => (
                      <tr key={endpoint} className="text-gray-300">
                        <td className="py-3 font-mono text-sm truncate max-w-xs">
                          {endpoint}
                        </td>
                        <td className="py-3">{formatNumber(stats.requests)}</td>
                        <td className="py-3 text-red-400">{formatNumber(stats.failures)}</td>
                        <td className="py-3">{formatTime(stats.averageLatency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User Tab */}
      {!isLoading && activeTab === 'user' && publicKey && userStats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Activity}
              label="Mes Swaps"
              value={formatNumber(userStats.totalSwaps)}
              subValue={`${formatPercent(userStats.successRate)} succès`}
              color="blue"
            />
            <StatCard
              icon={TrendingUp}
              label="Mon Volume"
              value={formatVolume(userStats.totalVolume)}
              color="purple"
            />
            <StatCard
              icon={Activity}
              label="Intents Actifs"
              value={formatNumber(userStats.activeIntents)}
              color="yellow"
            />
            <StatCard
              icon={CheckCircle}
              label="Intents Complétés"
              value={formatNumber(userStats.completedIntents)}
              color="green"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              icon={CheckCircle}
              label="Swaps Réussis"
              value={formatNumber(userStats.successfulSwaps)}
              color="green"
            />
            <StatCard
              icon={XCircle}
              label="Swaps Échoués"
              value={formatNumber(userStats.failedSwaps)}
              color="red"
            />
            <StatCard
              icon={TrendingUp}
              label="Slippage Moyen"
              value={formatPercent(userStats.averageSlippage)}
              color="yellow"
            />
          </div>
        </div>
      )}

      {/* No wallet connected message for user tab */}
      {!isLoading && activeTab === 'user' && !publicKey && (
        <div className="text-center py-12">
          <p className="text-gray-400">
            Connectez votre wallet pour voir vos statistiques personnelles.
          </p>
        </div>
      )}
    </div>
  );
}

export default AnalyticsDashboard;
