/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Disable ESLint during builds for Vercel
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  // Disable TypeScript errors during builds
  typescript: {
    ignoreBuildErrors: true,
  },

  // Environment variables
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
    NEXT_PUBLIC_SOLANA_RPC_URL:
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet',
  },

  // Webpack configuration for Solana
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };
    return config;
  },

  // Images configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.jup.ag',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
      },
    ],
  },
};

module.exports = nextConfig;
