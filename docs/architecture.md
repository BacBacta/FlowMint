# FlowMint Architecture

This document describes the high-level architecture of FlowMint, an execution layer over Jupiter for Solana.

## Overview

FlowMint is a multi-component system designed to provide reliable, safe, and multi-use execution functionality on Solana:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FlowMint                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐  │
│  │    React    │   │  TypeScript │   │    Anchor   │   │  TypeScript │  │
│  │   Frontend  │   │     SDK     │   │   Program   │   │   Server    │  │
│  │   (Next.js) │   │             │   │   (Rust)    │   │  (Express)  │  │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘  │
│         │                 │                 │                  │         │
│         └─────────────────┴────────┬────────┴──────────────────┘         │
│                                    │                                     │
│                          ┌─────────▼─────────┐                           │
│                          │   Solana Network  │                           │
│                          │   + Jupiter API   │                           │
│                          │   + Pyth Oracle   │                           │
│                          └───────────────────┘                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. React Frontend (`/app`)

A Next.js 14 application providing the user interface.

**Technology Stack:**
- Next.js 14 with App Router
- TanStack Query for data fetching
- Solana Wallet Adapters
- Tailwind CSS for styling

**Key Features:**
- Wallet connection (Phantom, Solflare, etc.)
- Token swap interface
- DCA order management
- Stop-loss configuration
- Payment link creation

### 2. TypeScript SDK (`/sdk`)

A client library for programmatic access to FlowMint.

**Features:**
- Type-safe API client
- Automatic retries with exponential backoff
- Rate limiting handling
- Comprehensive error types

**Usage:**
```typescript
import { FlowMintClient } from '@flowmint/sdk';

const client = new FlowMintClient({
  apiUrl: 'https://api.flowmint.io',
});

const quote = await client.getQuote({
  inputMint: 'SOL_MINT',
  outputMint: 'USDC_MINT',
  amount: 1_000_000_000, // 1 SOL
});
```

### 3. Anchor Program (`/program`)

The on-chain Solana program built with Anchor.

**Instructions:**
- `initialize` - Set up protocol config
- `execute_swap` - Record swap execution
- `pay_any_token` - Process payments
- `update_config` - Admin configuration
- `toggle_protected_mode` - Emergency controls

**Account Types:**
- `ProtocolConfig` - Global settings
- `SwapReceipt` - Swap execution records
- `PaymentRecord` - Payment tracking
- `UserStats` - Per-user statistics

### 4. TypeScript Server (`/server`)

Express.js backend providing the REST API.

**Services:**

#### Jupiter Service
- Quote fetching from Jupiter API v6
- Swap transaction building
- Route optimization

#### Execution Engine
- Policy validation (slippage, price impact)
- Retry logic with exponential backoff
- RPC failover
- Receipt management

#### Intent Scheduler
- DCA order execution (cron-based)
- Stop-loss monitoring (Pyth price feeds)
- Order lifecycle management

#### Payment Service
- ExactOut quote generation
- Payment link creation
- Status tracking

## Data Flow

### Swap Flow

```
User → Frontend → API → Jupiter Service → Jupiter API
                     ↓
              Execution Engine → Validate Policies
                     ↓
              Build & Sign TX → Solana RPC
                     ↓
              Record Receipt → Database
                     ↓
                  Response → User
```

### DCA Flow

```
User Creates DCA Intent → Database
         ↓
Scheduler (every minute) → Check pending DCAs
         ↓
Jupiter Quote → Execute if interval passed
         ↓
Record execution → Update intent status
         ↓
Repeat until complete
```

### Stop-Loss Flow

```
User Creates Stop-Loss → Database
         ↓
Scheduler (every 10s) → Fetch Pyth prices
         ↓
Price ≤ trigger? → Execute swap via Jupiter
         ↓
Record execution → Mark intent complete
```

## Security Considerations

### Protected Mode

The system includes a "protected mode" that can be toggled by admins to:
- Limit trading to whitelisted tokens
- Enforce stricter slippage limits
- Block high-risk operations

### Risk Policies

All swaps are validated against risk policies:
- Token whitelist/blacklist
- Maximum slippage (5% default)
- Maximum price impact (3% default)
- User-specific limits

### Transaction Signing

- Users sign transactions client-side
- Server never holds private keys
- All operations require wallet approval

## Database Schema

```sql
-- Swap Receipts
CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  user_public_key TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  input_amount INTEGER NOT NULL,
  output_amount INTEGER NOT NULL,
  slippage_bps INTEGER NOT NULL,
  price_impact REAL NOT NULL,
  signature TEXT,
  status TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- Intents (DCA / Stop-Loss)
CREATE TABLE intents (
  id TEXT PRIMARY KEY,
  user_public_key TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  executed_amount INTEGER DEFAULT 0,
  interval_ms INTEGER,
  number_of_orders INTEGER,
  orders_executed INTEGER DEFAULT 0,
  next_execution_time TEXT,
  trigger_price REAL,
  pyth_feed_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Payments
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  amount_usdc REAL NOT NULL,
  status TEXT NOT NULL,
  payer_public_key TEXT,
  payer_mint TEXT,
  payer_amount REAL,
  signature TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);
```

## External Dependencies

### Jupiter API v6

- Endpoint: `https://quote-api.jup.ag/v6`
- Used for: Quote fetching, swap transaction building
- Rate limits: Respect Jupiter's rate limits

### Pyth Network

- Endpoint: `https://hermes.pyth.network`
- Used for: Real-time price feeds for stop-loss
- Price IDs: Standard Pyth feed IDs

### Solana RPC

- Primary: Helius (configurable)
- Fallback: QuickNode, public RPC
- Used for: Transaction submission, confirmation

## Scalability

### Horizontal Scaling

- Stateless API servers
- Database connection pooling
- Redis for session/cache (future)

### Performance Optimizations

- Quote caching (10 second TTL)
- Batch intent processing
- Connection reuse

## Monitoring

### Metrics to Track

- Swap success rate
- Intent execution rate
- API response times
- Jupiter API latency
- RPC node health

### Logging

- Structured JSON logging (Pino)
- Request/response logging
- Error tracking with context

## Future Enhancements

1. **Limit Orders** - Price-triggered swaps
2. **TWAP Orders** - Time-weighted average price
3. **Multi-leg Swaps** - Complex routing
4. **Webhook Notifications** - Real-time updates
5. **Mobile SDK** - React Native support
## On-Chain Jupiter CPI Integration

FlowMint's Anchor program executes swaps via Cross-Program Invocation (CPI) to Jupiter.

### Jupiter CPI Flow

```
User signs TX → FlowMint Program → Jupiter CPI → DEX Aggregation
                      ↓
              Validate Route Data
                      ↓
              Execute Jupiter Swap
                      ↓
              Verify Output Amount
                      ↓
              Create SwapReceipt PDA
                      ↓
              Update UserStats
```

### Route Serialization

Jupiter quotes are serialized to Borsh format for on-chain deserialization:

```rust
pub struct JupiterRoute {
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub amount_in: u64,
    pub minimum_amount_out: u64,
    pub steps: Vec<RouteStep>,
    pub expires_at: i64,
}

pub struct RouteStep {
    pub dex_program_id: Pubkey,
    pub in_amount: u64,
    pub out_amount: u64,
    pub pool_info: [u8; 32],
}
```

### Instruction Injection

The off-chain engine injects FlowMint instructions into Jupiter transactions:

```typescript
// 1. Get Jupiter transaction
const jupiterTx = await jupiterService.getSwapTransaction(quote);

// 2. Build FlowMint instruction
const flowMintIx = buildExecuteSwapInstruction({
  user,
  inputMint,
  outputMint,
  amountIn,
  minimumAmountOut,
  routeData,
});

// 3. Inject into transaction
const wrappedTx = injectFlowMintInstruction(jupiterTx, flowMintIx);

// 4. Return for user signing
return wrappedTx.serialize();
```

### PDA Derivation

FlowMint uses Program Derived Addresses for deterministic account storage:

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Config | `["config"]` | Protocol settings |
| Receipt | `["receipt", user, timestamp]` | Swap records |
| UserStats | `["user_stats", user]` | User metrics |
| PaymentRecord | `["payment", payer, merchant, timestamp]` | Payment tracking |

### Protected Mode Enforcement

On-chain validation ensures slippage limits are respected:

```rust
// Validate slippage against protocol config
let max_slippage = if protected_mode {
    config.protected_slippage_bps
} else {
    config.default_slippage_bps
};

require!(
    slippage_bps <= max_slippage,
    FlowMintError::SlippageExceeded
);

// Post-swap verification
let actual_out = ctx.accounts.user_output_account.amount;
require!(
    actual_out >= minimum_amount_out,
    FlowMintError::InsufficientOutput
);
```