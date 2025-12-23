/**
 * Analytics Charts Component
 *
 * Interactive charts for platform analytics using Recharts.
 */

'use client';

import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

interface ChartData {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface TimeSeriesData {
  timestamp: string;
  swaps: number;
  volume: number;
  successRate: number;
}

type TimeRange = '1h' | '24h' | '7d' | '30d';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function AnalyticsCharts() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [tokenDistribution, setTokenDistribution] = useState<ChartData[]>([]);
  const [statusDistribution, setStatusDistribution] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchChartData = async () => {
      setIsLoading(true);
      try {
        // Fetch swap analytics for charts
        const response = await fetch(`${API_BASE}/analytics/swaps?timeRange=${timeRange}`);
        if (response.ok) {
          const data = await response.json();
          
          // Generate time series data (mock for now, would come from backend)
          const points = generateTimeSeriesPoints(timeRange, data);
          setTimeSeriesData(points);

          // Token distribution from top pairs
          if (data.topTokenPairs) {
            const distribution = data.topTokenPairs.slice(0, 5).map((pair: any, i: number) => ({
              name: `${pair.inputMint.slice(0, 4)}.../${pair.outputMint.slice(0, 4)}...`,
              value: pair.count,
            }));
            setTokenDistribution(distribution);
          }

          // Status distribution
          setStatusDistribution([
            { name: 'Réussis', value: data.successfulSwaps || 0 },
            { name: 'Échoués', value: data.failedSwaps || 0 },
          ]);
        }
      } catch (error) {
        console.error('Failed to fetch chart data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchChartData();
  }, [timeRange]);

  // Generate time series data points based on time range
  const generateTimeSeriesPoints = (range: TimeRange, data: any): TimeSeriesData[] => {
    const now = Date.now();
    const points: TimeSeriesData[] = [];
    
    let intervals: number;
    let intervalMs: number;
    let formatDate: (d: Date) => string;

    switch (range) {
      case '1h':
        intervals = 12;
        intervalMs = 5 * 60 * 1000; // 5 minutes
        formatDate = (d) => `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
        break;
      case '24h':
        intervals = 24;
        intervalMs = 60 * 60 * 1000; // 1 hour
        formatDate = (d) => `${d.getHours()}h`;
        break;
      case '7d':
        intervals = 7;
        intervalMs = 24 * 60 * 60 * 1000; // 1 day
        formatDate = (d) => d.toLocaleDateString('fr-FR', { weekday: 'short' });
        break;
      case '30d':
        intervals = 30;
        intervalMs = 24 * 60 * 60 * 1000; // 1 day
        formatDate = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
        break;
    }

    const totalSwaps = data.totalSwaps || 0;
    const avgPerInterval = totalSwaps / intervals;

    for (let i = intervals - 1; i >= 0; i--) {
      const timestamp = new Date(now - i * intervalMs);
      // Simulate data distribution (would be real data from backend)
      const variance = 0.5 + Math.random();
      points.push({
        timestamp: formatDate(timestamp),
        swaps: Math.round(avgPerInterval * variance),
        volume: Math.round(parseFloat(data.totalVolume || '0') / intervals * variance),
        successRate: (data.successRate || 95) + (Math.random() - 0.5) * 10,
      });
    }

    return points;
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/3 mb-4" />
            <div className="h-64 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex justify-end">
        <div className="flex bg-gray-800 rounded-lg p-1">
          {(['1h', '24h', '7d', '30d'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Swaps over time */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Swaps dans le temps</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={timeSeriesData}>
              <defs>
                <linearGradient id="colorSwaps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="timestamp" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
              />
              <Area
                type="monotone"
                dataKey="swaps"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorSwaps)"
                name="Swaps"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Volume over time */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Volume dans le temps</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={timeSeriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="timestamp" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [`${value.toLocaleString()}`, 'Volume']}
              />
              <Bar dataKey="volume" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Success rate over time */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Taux de succès</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeSeriesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="timestamp" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} domain={[80, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Taux de succès']}
              />
              <Line
                type="monotone"
                dataKey="successRate"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Distribution charts */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Distribution</h3>
          <div className="grid grid-cols-2 gap-4">
            {/* Status distribution */}
            <div>
              <h4 className="text-sm text-gray-400 mb-2 text-center">Statut</h4>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-gray-400">Réussis</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-gray-400">Échoués</span>
                </div>
              </div>
            </div>

            {/* Token pairs distribution */}
            <div>
              <h4 className="text-sm text-gray-400 mb-2 text-center">Top Paires</h4>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={tokenDistribution}
                    cx="50%"
                    cy="50%"
                    outerRadius={55}
                    dataKey="value"
                    label={false}
                  >
                    {tokenDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-2 text-xs">
                {tokenDistribution.slice(0, 3).map((item, index) => (
                  <div key={item.name} className="flex items-center gap-1">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: COLORS[index] }}
                    />
                    <span className="text-gray-400 truncate max-w-[60px]">{item.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnalyticsCharts;
