/**
 * Application Configuration
 *
 * Centralizes all configuration with environment variable parsing and defaults.
 */

import { z } from 'zod';

/**
 * Environment variable schema with validation
 */
const configSchema = z.object({
  // Node environment
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Server
  port: z.coerce.number().default(3001),
  apiBaseUrl: z.string().default('http://localhost:3001'),
  corsOrigins: z.string().default('*'),
  rateLimitRpm: z.coerce.number().default(100),

  // Solana
  solana: z.object({
    rpcUrl: z.string().url().default('https://api.devnet.solana.com'),
    network: z.enum(['devnet', 'testnet', 'mainnet-beta']).default('devnet'),
    commitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
  }),

  // Jupiter
  jupiter: z.object({
    apiUrl: z.string().url().default('https://quote-api.jup.ag/v6'),
    platformFeeBps: z.coerce.number().min(0).max(100).default(0),
  }),

  // Pyth
  pyth: z.object({
    endpoint: z.string().url().default('https://hermes.pyth.network'),
  }),

  // Database
  database: z.object({
    url: z.string().default('./data/flowmint.sqlite'),
  }),

  // Protection settings
  protection: z.object({
    defaultMaxSlippageBps: z.coerce.number().default(300),
    protectedMaxSlippageBps: z.coerce.number().default(100),
    maxPriceImpactPct: z.coerce.number().default(1.0),
  }),

  // Optional: Jito
  jito: z
    .object({
      blockEngineUrl: z.string().url().optional(),
      tipLamports: z.coerce.number().default(1000000),
    })
    .optional(),

  // Security
  jwtSecret: z.string().default('development-secret-change-in-production'),

  // Logging
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

/**
 * Parse and validate configuration from environment
 */
function loadConfig() {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    apiBaseUrl: process.env.API_BASE_URL,
    corsOrigins: process.env.CORS_ORIGINS,
    rateLimitRpm: process.env.RATE_LIMIT_RPM,

    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL,
      network: process.env.SOLANA_NETWORK,
      commitment: process.env.SOLANA_COMMITMENT,
    },

    jupiter: {
      apiUrl: process.env.JUPITER_API_URL,
      platformFeeBps: process.env.JUPITER_PLATFORM_FEE_BPS,
    },

    pyth: {
      endpoint: process.env.PYTH_ENDPOINT,
    },

    database: {
      url: process.env.DATABASE_URL,
    },

    protection: {
      defaultMaxSlippageBps: process.env.DEFAULT_MAX_SLIPPAGE_BPS,
      protectedMaxSlippageBps: process.env.PROTECTED_MAX_SLIPPAGE_BPS,
      maxPriceImpactPct: process.env.MAX_PRICE_IMPACT_PCT,
    },

    jito: process.env.JITO_BLOCK_ENGINE_URL
      ? {
          blockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL,
          tipLamports: process.env.JITO_TIP_LAMPORTS,
        }
      : undefined,

    jwtSecret: process.env.JWT_SECRET,
    logLevel: process.env.LOG_LEVEL,
  };

  return configSchema.parse(rawConfig);
}

/**
 * Application configuration
 */
export const config = loadConfig();

/**
 * Configuration type
 */
export type Config = z.infer<typeof configSchema>;
