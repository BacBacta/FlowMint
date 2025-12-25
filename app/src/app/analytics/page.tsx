/**
 * Analytics Page
 *
 * Displays platform-wide and user-specific analytics dashboard.
 */

'use client';

import { AnalyticsDashboard } from '@/components/analytics';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

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
