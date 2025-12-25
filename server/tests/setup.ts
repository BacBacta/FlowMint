/**
 * Jest Setup File
 *
 * This file is run before each test file.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
process.env.SOLANA_NETWORK = 'devnet';
process.env.JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
process.env.PYTH_ENDPOINT = 'https://hermes.pyth.network';
process.env.DATABASE_URL = ':memory:';
process.env.LOG_LEVEL = 'silent';

// Extend Jest matchers if needed
expect.extend({
  toBeValidPublicKey(received: string) {
    const pass = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(received);
    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} not to be a valid Solana public key`
          : `Expected ${received} to be a valid Solana public key`,
    };
  },
});

// Global test utilities
global.console = {
  ...console,
  // Suppress console.log during tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: console.warn,
  error: console.error,
};

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global teardown - clear all timers and pending handles
afterAll(async () => {
  // Clear any remaining timers
  jest.useRealTimers();
  
  // Clear the prom-client registry to stop internal timers
  try {
    const { register } = await import('prom-client');
    register.clear();
  } catch {
    // prom-client may not be loaded in all test files
  }
  
  // Small delay to allow pending microtasks to complete
  await new Promise((resolve) => setImmediate(resolve));
});
