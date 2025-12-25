'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NotificationBell } from './notifications';

// Dynamically import wallet button to avoid SSR hydration mismatch
const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  {
    ssr: false,
    loading: () => (
      <div className="bg-surface-200 dark:bg-surface-700 h-10 w-32 animate-pulse rounded-lg" />
    ),
  }
);

const navigation = [
  { name: 'Swap', href: '/swap' },
  { name: 'DCA', href: '/dca' },
  { name: 'Stop-Loss', href: '/stop-loss' },
  { name: 'Payments', href: '/payments' },
  { name: 'Analytics', href: '/analytics' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="border-surface-200 dark:border-surface-700 dark:bg-surface-900/80 sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="from-primary-500 to-accent-500 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="gradient-text text-xl font-bold">FlowMint</span>
        </Link>

        {/* Navigation */}
        <nav className="hidden items-center gap-1 md:flex">
          {navigation.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                    : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Wallet Button & Notifications */}
        <div className="flex items-center gap-4">
          <NotificationBell />
          <WalletMultiButtonDynamic />
        </div>
      </div>
    </header>
  );
}
