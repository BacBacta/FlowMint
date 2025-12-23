import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'FlowMint - Solana Execution Layer',
  description:
    'Reliable, safe and multi-use execution layer over Jupiter: swaps, DCA, stop-loss, and payments on Solana.',
  keywords: ['Solana', 'DeFi', 'Jupiter', 'Swap', 'DCA', 'Stop-loss', 'Payments', 'Web3'],
  authors: [{ name: 'FlowMint Team' }],
  openGraph: {
    title: 'FlowMint - Solana Execution Layer',
    description:
      'Reliable, safe and multi-use execution layer over Jupiter: swaps, DCA, stop-loss, and payments on Solana.',
    type: 'website',
    locale: 'en_US',
    siteName: 'FlowMint',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FlowMint - Solana Execution Layer',
    description:
      'Reliable, safe and multi-use execution layer over Jupiter: swaps, DCA, stop-loss, and payments on Solana.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="bg-surface-50 dark:bg-surface-950 min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
