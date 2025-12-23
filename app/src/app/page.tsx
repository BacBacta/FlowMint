import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

const features = [
  {
    name: 'Instant Swaps',
    description:
      'Execute token swaps with optimal routing through Jupiter. Best prices, lowest slippage.',
    href: '/swap',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    ),
  },
  {
    name: 'DCA Orders',
    description:
      'Dollar-cost average into any token with automated recurring swaps. Set it and forget it.',
    href: '/dca',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    name: 'Stop-Loss',
    description:
      'Protect your positions with automated stop-loss orders triggered by real-time Pyth prices.',
    href: '/stop-loss',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    ),
  },
  {
    name: 'Pay Any Token',
    description:
      'Accept payments in any token, receive USDC. Perfect for merchants and invoicing.',
    href: '/payments',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
];

const stats = [
  { label: 'Total Volume', value: '$0', suffix: '' },
  { label: 'Swaps Executed', value: '0', suffix: '' },
  { label: 'Active Intents', value: '0', suffix: '' },
  { label: 'Protected Mode', value: 'ON', suffix: '' },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden gradient-bg">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-surface-900 dark:text-white sm:text-6xl">
                Execution Layer for{' '}
                <span className="gradient-text">Solana DeFi</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-surface-600 dark:text-surface-300">
                Reliable, safe and multi-use execution layer over Jupiter. Trade with confidence 
                using swaps, DCA, stop-loss orders, and &quot;pay any token&quot; payments.
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6">
                <Link href="/swap" className="btn-primary text-base px-8 py-3">
                  Start Trading
                </Link>
                <Link
                  href="/docs"
                  className="btn-ghost text-base px-8 py-3 text-surface-700 dark:text-surface-300"
                >
                  Learn More →
                </Link>
              </div>
            </div>
          </div>

          {/* Background decoration */}
          <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
            <div
              className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-primary-500 to-accent-500 opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
              style={{
                clipPath:
                  'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
              }}
            />
          </div>
        </section>

        {/* Stats Section */}
        <section className="border-y border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <dl className="grid grid-cols-2 gap-8 sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="text-center">
                  <dt className="text-sm font-medium text-surface-600 dark:text-surface-400">
                    {stat.label}
                  </dt>
                  <dd className="mt-2 text-3xl font-bold tracking-tight text-surface-900 dark:text-white">
                    {stat.value}
                    {stat.suffix}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-surface-900 dark:text-white sm:text-4xl">
                Everything you need for DeFi execution
              </h2>
              <p className="mt-4 text-lg text-surface-600 dark:text-surface-300">
                Built on top of Jupiter for optimal routing and pricing. Protected mode keeps you safe.
              </p>
            </div>

            <div className="mx-auto mt-16 max-w-5xl">
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                {features.map((feature) => (
                  <Link
                    key={feature.name}
                    href={feature.href}
                    className="card group hover:border-primary-500 hover:shadow-glow-sm transition-all duration-300"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600 group-hover:bg-primary-500 group-hover:text-white transition-colors dark:bg-primary-900 dark:text-primary-400">
                        {feature.icon}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
                          {feature.name}
                        </h3>
                        <p className="mt-2 text-surface-600 dark:text-surface-400">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-gradient-to-br from-primary-600 to-accent-600 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Ready to start trading?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-primary-100">
                Connect your wallet and experience the best execution layer on Solana.
              </p>
              <div className="mt-8">
                <Link
                  href="/swap"
                  className="inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-base font-medium text-primary-600 shadow-lg hover:bg-primary-50 transition-colors"
                >
                  Launch App
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
