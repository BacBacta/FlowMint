/**
 * Analytics Page
 *
 * Displays platform-wide and user-specific analytics dashboard.
 */

'use client';

import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AnalyticsDashboard } from '@/components/analytics';

export default function AnalyticsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 py-8">
        <AnalyticsDashboard />
      </main>
      <Footer />
    </div>
  );
}
