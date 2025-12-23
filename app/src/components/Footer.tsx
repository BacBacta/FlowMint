import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-primary-500 to-accent-500">
              <svg
                className="h-4 w-4 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-surface-900 dark:text-surface-100">
              FlowMint
            </span>
          </div>

          {/* Links */}
          <nav className="flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/flowmint/flowmint"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/flowmint"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
            >
              Discord
            </a>
          </nav>

          {/* Copyright */}
          <p className="text-sm text-surface-500 dark:text-surface-500">
            © {new Date().getFullYear()} FlowMint. Built on Solana.
          </p>
        </div>
      </div>
    </footer>
  );
}
