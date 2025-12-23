/**
 * Analytics Page
 *
 * Displays platform-wide and user-specific analytics dashboard.
 */

import { Metadata } from 'next';
import { AnalyticsDashboard } from '@/components/analytics';

export const metadata: Metadata = {
  title: 'Analytics | FlowMint',
  description: 'Statistiques et métriques de la plateforme FlowMint',
};

export default function AnalyticsPage() {
  return (
    <main className="from-surface-950 via-surface-900 to-surface-950 min-h-screen bg-gradient-to-br">
      <AnalyticsDashboard />
    </main>
  );
}
