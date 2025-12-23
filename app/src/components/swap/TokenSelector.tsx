'use client';

import { useState } from 'react';

interface Token {
  symbol: string;
  mint: string;
  decimals: number;
  logoURI: string;
}

interface TokenSelectorProps {
  selectedToken: Token;
  onSelectToken: (token: Token) => void;
  tokens: Token[];
}

export function TokenSelector({ selectedToken, onSelectToken, tokens }: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTokens = tokens.filter(
    token =>
      token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.mint.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-surface-200 text-surface-900 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600 flex items-center gap-2 rounded-xl px-4 py-2 font-medium transition-colors dark:text-white"
      >
        {selectedToken.logoURI ? (
          <img
            src={selectedToken.logoURI}
            alt={selectedToken.symbol}
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <div className="bg-primary-500 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white">
            {selectedToken.symbol[0]}
          </div>
        )}
        <span>{selectedToken.symbol}</span>
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown Menu */}
          <div className="border-surface-200 dark:border-surface-700 dark:bg-surface-800 absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border bg-white p-2 shadow-xl">
            {/* Search */}
            <div className="mb-2 p-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tokens..."
                className="input w-full"
                autoFocus
              />
            </div>

            {/* Token List */}
            <div className="max-h-64 overflow-y-auto">
              {filteredTokens.length === 0 ? (
                <div className="text-surface-500 py-4 text-center text-sm">No tokens found</div>
              ) : (
                filteredTokens.map(token => (
                  <button
                    key={token.mint}
                    onClick={() => {
                      onSelectToken(token);
                      setIsOpen(false);
                      setSearchQuery('');
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                      token.mint === selectedToken.mint
                        ? 'bg-primary-50 dark:bg-primary-900/30'
                        : 'hover:bg-surface-100 dark:hover:bg-surface-700'
                    }`}
                  >
                    {token.logoURI ? (
                      <img
                        src={token.logoURI}
                        alt={token.symbol}
                        className="h-8 w-8 rounded-full"
                      />
                    ) : (
                      <div className="bg-primary-500 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white">
                        {token.symbol[0]}
                      </div>
                    )}
                    <div>
                      <div className="text-surface-900 font-medium dark:text-white">
                        {token.symbol}
                      </div>
                      <div className="text-surface-500 text-xs">
                        {token.mint.slice(0, 8)}...{token.mint.slice(-6)}
                      </div>
                    </div>
                    {token.mint === selectedToken.mint && (
                      <svg
                        className="text-primary-500 ml-auto h-5 w-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
