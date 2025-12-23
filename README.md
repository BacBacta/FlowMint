# 🌊 FlowMint

[![Build Status](https://github.com/BacBacta/FlowMint/actions/workflows/ci.yml/badge.svg)](https://github.com/BacBacta/FlowMint/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Reliable, safe, and multi-use execution layer over Jupiter on Solana**

FlowMint provides a robust infrastructure for executing token swaps, managing simple intents (DCA/stop-loss), processing "pay any token → USDC" payments, and offering a protected mode for safer trading on Solana.

---

## 🎯 Features

- **🔄 Smart Swaps**: Reliable token swaps via Jupiter with automatic retry and route optimization
- **📊 Simple Intents**: Dollar-Cost Averaging (DCA) and stop-loss orders with Pyth oracle integration
- **💳 Universal Payments**: Accept any token, receive USDC instantly
- **🛡️ Protected Mode**: Risk policies, slippage protection, and optional MEV protection via Jito

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FlowMint                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Frontend   │  │     SDK      │  │    Docs      │              │
│  │  (Next.js)   │  │ (TypeScript) │  │  (Markdown)  │              │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘              │
│         │                 │                                          │
│         ▼                 ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Server (Node/TypeScript)                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │   │
│  │  │ Jupiter     │ │ Execution   │ │ Intent Scheduler    │   │   │
│  │  │ Service     │ │ Engine      │ │ (DCA/Stop-Loss)     │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │   │
│  │  │ Payment     │ │ Protected   │ │ Receipt Store       │   │   │
│  │  │ Service     │ │ Mode        │ │ (Database)          │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                      │
│                               ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Anchor Program (On-Chain Router)                │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │   │
│  │  │ Swap        │ │ Pay Any     │ │ Slippage            │   │   │
│  │  │ Execution   │ │ Token       │ │ Protection          │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                      │
└───────────────────────────────┼──────────────────────────────────────┘
                                ▼
                    ┌───────────────────┐
                    │   Solana Network  │
                    │   + Jupiter API   │
                    │   + Pyth Oracle   │
                    └───────────────────┘
```

---

## 📁 Project Structure

```
FlowMint/
├── program/           # Anchor on-chain program (Rust)
│   ├── programs/      # Smart contract source
│   ├── tests/         # Anchor integration tests
│   └── Anchor.toml    # Anchor configuration
│
├── server/            # Off-chain execution engine (Node/TypeScript)
│   ├── src/
│   │   ├── services/  # Jupiter, Execution, Intent, Payment services
│   │   ├── config/    # Risk policies and configuration
│   │   ├── api/       # REST API routes
│   │   └── db/        # Database models and receipts
│   └── tests/         # Jest unit tests
│
├── app/               # Frontend application (Next.js/React)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── hooks/
│   └── tests/         # Playwright E2E tests
│
├── sdk/               # Reusable TypeScript client library
│   ├── src/
│   └── tests/
│
├── docs/              # Documentation
│   ├── architecture.md
│   ├── usage.md
│   ├── developer-guide.md
│   └── risk-policies.md
│
├── scripts/           # Deployment and utility scripts
├── .github/           # GitHub Actions CI/CD
├── README.md          # This file
└── DEVELOPMENT.md     # Development tracking and notes
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.x
- **Rust** >= 1.70.0
- **Solana CLI** >= 1.17.0
- **Anchor** >= 0.29.0
- **pnpm** (recommended) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/BacBacta/FlowMint.git
cd FlowMint

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Build the Anchor program
cd program && anchor build && cd ..

# Start the development server
pnpm dev
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# Solana Configuration
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=devnet

# Jupiter API
JUPITER_API_URL=https://quote-api.jup.ag/v6

# Pyth Oracle
PYTH_ENDPOINT=https://hermes.pyth.network

# Server Configuration
PORT=3001
DATABASE_URL=./data/flowmint.sqlite

# Optional: Jito MEV Protection
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf

# Wallet (for server-side signing - use with caution)
# WALLET_PRIVATE_KEY=your_base58_private_key
```

---

## 🔧 Development

### Available Scripts

```bash
# Root commands (monorepo)
pnpm dev              # Start all services in development mode
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm format           # Format code with Prettier

# Program (Anchor)
cd program
anchor build          # Compile the program
anchor test           # Run Anchor tests
anchor deploy         # Deploy to configured network

# Server
cd server
pnpm dev              # Start development server
pnpm test             # Run Jest tests
pnpm test:watch       # Run tests in watch mode

# Frontend
cd app
pnpm dev              # Start Next.js dev server
pnpm build            # Production build
pnpm test:e2e         # Run Playwright E2E tests
```

### Code Style

- **TypeScript**: Strict mode enabled, ESLint + Prettier
- **Rust**: rustfmt for formatting, clippy for linting
- **Commits**: Conventional Commits format

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design and component interactions |
| [API Usage](docs/usage.md) | API endpoints and SDK usage examples |
| [Developer Guide](docs/developer-guide.md) | Contributing guidelines and code standards |
| [Risk Policies](docs/risk-policies.md) | Protected mode and safety mechanisms |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Development tracking and research notes |

---

## 🛡️ Security

FlowMint implements multiple layers of protection:

1. **Token Whitelists/Blacklists**: Configurable allow/deny lists
2. **Slippage Protection**: Maximum slippage enforcement
3. **Liquidity Checks**: Size limits relative to pool liquidity
4. **Price Impact Analysis**: Abort swaps exceeding thresholds
5. **Token Metadata Validation**: Check for freeze authority, transfer taxes
6. **Optional MEV Protection**: Private relay via Jito

---

## 🤝 Contributing

We welcome contributions! Please see our [Developer Guide](docs/developer-guide.md) for:

- Code of Conduct
- Branch naming conventions
- Commit message format
- Pull request process

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Resources

- [Jupiter Documentation](https://docs.jup.ag)
- [Solana Documentation](https://docs.solana.com)
- [Anchor Book](https://book.anchor-lang.com)
- [Pyth Network](https://docs.pyth.network)
- [Jito Documentation](https://docs.jito.network)

---

<p align="center">
  Built with ❤️ for the Solana ecosystem
</p>