# 📋 DEVELOPMENT.md - FlowMint Development Tracking

> **Rule**: Any task started must be documented in this file, including challenges, decisions, and resources consulted.

---

## 🎯 Project Overview

FlowMint is an execution layer over Jupiter that delivers reliable, safe, and multi-use functionality on Solana:
- **Swaps**: Reliable token swaps with retry logic and route optimization
- **Simple Intents**: DCA (Dollar-Cost Averaging) and stop-loss orders
- **Payments**: "Pay any token → USDC" payment processing
- **Protected Mode**: Risk policies and safety mechanisms

---

## 📚 Documentation Research & Notes

### Jupiter API (docs.jup.ag)

**Consulted**: 2024-12-23

**Key Findings**:
- **Quote API (v6)**: `GET /quote` returns optimal routes with `inputMint`, `outputMint`, `amount`, `slippageBps`
- **Swap API**: `POST /swap` returns serialized transaction for signing
- **Route Structure**: Contains `routePlan` with steps, `inAmount`, `outAmount`, `priceImpactPct`
- **Slippage**: Specified in basis points (bps), 100 bps = 1%
- **Platform Fees**: Can add `platformFeeBps` to monetize swaps
- **Token Validation**: Check `contextSlot` for quote freshness

**Important Endpoints**:
```
GET  https://quote-api.jup.ag/v6/quote
POST https://quote-api.jup.ag/v6/swap
GET  https://quote-api.jup.ag/v6/swap-instructions (for advanced use)
GET  https://tokens.jup.ag/tokens?tags=verified (token list)
```

**Challenges**:
- Rate limits on free tier
- Quote expiration requires timely execution
- Some tokens may have transfer taxes affecting output

---

### Solana Documentation (docs.solana.com)

**Consulted**: 2024-12-23

**Key Findings**:
- **Transactions**: Max 1232 bytes, includes signatures, message header, account keys, instructions
- **Compute Budget**: Default 200,000 CU, can request up to 1.4M CU per transaction
- **Priority Fees**: Use `ComputeBudgetProgram.setComputeUnitPrice()` for faster inclusion
- **RPC Methods**: `getTokenAccountBalance`, `getLatestBlockhash`, `sendTransaction`
- **Versioned Transactions**: Use v0 for address lookup tables (Jupiter routes may require this)

**Best Practices**:
- Always use recent blockhash (valid ~150 blocks / ~1 minute)
- Implement retry with exponential backoff
- Monitor transaction confirmation status

---

### Anchor Book (book.anchor-lang.com)

**Consulted**: 2024-12-23

**Key Findings**:
- **Account Validation**: Use `#[account]` macro with constraints like `constraint = ...`
- **CPI (Cross-Program Invocation)**: Use `CpiContext::new()` for calling other programs
- **Error Handling**: Define custom errors with `#[error_code]` enum
- **PDA (Program Derived Addresses)**: Use `seeds` and `bump` for deterministic addresses
- **Events**: Emit events for off-chain indexing with `emit!()` macro

**Program Structure**:
```rust
#[program]
mod flowmint {
    pub fn execute_swap(ctx: Context<ExecuteSwap>, ...) -> Result<()> { ... }
    pub fn pay_any_token(ctx: Context<PayAnyToken>, ...) -> Result<()> { ... }
}

#[derive(Accounts)]
pub struct ExecuteSwap<'info> { ... }
```

---

### Pyth Oracle (docs.pyth.network)

**Consulted**: 2024-12-23

**Key Findings**:
- **Hermes API**: REST/WebSocket for off-chain price feeds
- **Price Update Cadence**: Prices update every ~400ms on mainnet
- **Confidence Interval**: Each price includes a confidence band
- **Price Feed IDs**: Use official feed IDs for tokens (e.g., SOL/USD, BTC/USD)
- **Staleness Check**: Verify `publish_time` is recent before using

**Endpoints**:
```
GET https://hermes.pyth.network/api/latest_price_feeds?ids[]=<feed_id>
WebSocket: wss://hermes.pyth.network/ws
```

**Integration Notes**:
- For stop-loss: poll price or use WebSocket stream
- Consider price confidence for large orders

---

### Jito MEV Protection (docs.jito.network)

**Consulted**: 2024-12-23 (Optional feature)

**Key Findings**:
- **Private Transactions**: Submit via Jito Block Engine to avoid frontrunning
- **Bundle API**: Group multiple transactions atomically
- **Tips**: Must include a tip to validators for priority

**Endpoints**:
```
POST https://mainnet.block-engine.jito.wtf/api/v1/transactions
POST https://mainnet.block-engine.jito.wtf/api/v1/bundles
```

---

## ✅ Task Checklist

### Phase 1: Repository Initialization and Setup

- [x] **1.1** Initialize local Git repository *(Completed: 2024-12-23)*
- [x] **1.2** Create monorepo folder structure *(Completed: 2024-12-23)*
- [x] **1.3** Write README.md *(Completed: 2024-12-23)*
- [x] **1.4** Create DEVELOPMENT.md *(Completed: 2024-12-23)*
- [x] **1.5** Configure .gitignore *(Completed: 2024-12-23)*
- [x] **1.6** Set up ESLint and Prettier *(Completed: 2024-12-23)*
- [x] **1.7** Configure VS Code workspace *(Completed: 2024-12-23)*
- [x] **1.8** Initialize Anchor program skeleton *(Completed: 2024-12-23)*
- [x] **1.9** Initialize server package with TypeScript *(Completed: 2024-12-23)*
- [x] **1.10** Initialize app with Next.js *(Completed: 2024-12-23)*
- [x] **1.11** Initialize SDK package *(Completed: 2024-12-23)*

---

### Phase 2a: Core Policy/Execution/Receipt Engine

- [x] **2a.1** Implement `jupiterService.ts` *(Completed: 2024-12-23)*
  - [x] `quoteSwap()` function with ExactIn/ExactOut modes
  - [x] `getSwapTransaction()` function
  - [x] `deserializeTransaction()` for versioned transactions
  - [x] Error handling for unsupported pairs
  - [x] Unit tests with mocked API

- [x] **2a.2** Create ExecutionEngine module *(Completed: 2024-12-23)*
  - [x] Policy validation (whitelist/blacklist)
  - [x] Slippage enforcement
  - [x] Size limits relative to liquidity
  - [x] Risk assessment with warnings
  - [x] Receipt generation and storage

- [x] **2a.3** Implement IntentScheduler *(Completed: 2024-12-23)*
  - [x] Intent data model (DCA, stop-loss)
  - [x] Cron-based scheduling
  - [x] Pyth oracle price monitoring
  - [x] DCA execution at intervals
  - [x] Stop-loss trigger logic

- [x] **2a.4** Build Anchor Router Program (skeleton) *(Completed: 2024-12-23)*
  - [x] Program structure with instructions module
  - [x] State definitions (ProtocolConfig, SwapReceipt, UserStats)
  - [x] Error definitions
  - [x] Basic initialize instruction

---

### Phase 2b: Complete On-Chain Program and Integration *(Completed: 2024-12-24)*

- [x] **2b.1** Anchor Swap Execution with Jupiter CPI
  - [x] Created `jupiter.rs` module with CPI integration
  - [x] `JupiterRoute` struct with validation methods
  - [x] `execute_jupiter_swap()` CPI function
  - [x] Route deserialization from Borsh format
  - [x] Output verification after swap
  - [x] SwapReceipt PDA creation
  - [x] UserStats tracking

- [x] **2b.2** Anchor Payment Execution
  - [x] `pay_any_token` instruction
  - [x] Jupiter CPI for token → USDC conversion
  - [x] Direct USDC transfer to merchant
  - [x] Excess refund to payer
  - [x] PaymentRecord PDA creation

- [x] **2b.3** Off-chain Engine FlowMint Integration
  - [x] Created `flowMintOnChain.ts` service
  - [x] PDA derivation functions (config, receipt, user stats, payment)
  - [x] Route serialization for on-chain use
  - [x] Instruction builders for swap and payment
  - [x] Transaction injection with FlowMint instructions
  - [x] Updated `executionEngine.ts` with FlowMint flag
  - [x] Updated `paymentService.ts` with FlowMint integration

- [x] **2b.4** Frontend Pages
  - [x] Stop-loss page with Pyth feed integration
  - [x] Payment page with merchant/payer views
  - [x] DCA management page
  - [x] Swap interface with wallet integration

- [x] **2b.5** Testing
  - [x] Anchor test suite (`program/tests/flowmint.ts`)
  - [x] FlowMint on-chain service tests
  - [x] Execution engine tests
  - [x] Payment service tests

---

### Phase 3: Simple Intents (DCA/Stop-Loss) *(Completed: 2024-12-23)*

- [x] **3.1** Define Intent data model *(Completed)*
  - [x] Database schema for intents
  - [x] TypeScript types for DCA, stop-loss, limit orders

- [x] **3.2** Implement IntentScheduler *(Completed)*
  - [x] DCA execution logic with intervals
  - [x] Stop-loss trigger logic with Pyth prices
  - [x] Cron-based monitoring loop
  - [x] Intent status management

- [x] **3.3** Build Intent UI *(Completed)*
  - [x] DCA creation form
  - [x] Stop-loss creation form
  - [x] Active intents display
  - [x] Cancel functionality

---

### Phase 4: Pay Any Token → USDC *(Completed: 2024-12-24)*

- [x] **4.1** Implement `/payments` endpoint *(Completed)*
  - [x] Balance validation
  - [x] Jupiter quote with ExactOut mode
  - [x] Payment record storage
  - [x] Transaction building

- [x] **4.2** Anchor `pay_any_token` instruction *(Completed)*
  - [x] Jupiter CPI for swap
  - [x] USDC transfer to merchant
  - [x] Excess refund handling
  - [x] PaymentRecord PDA

- [x] **4.3** Build Payment UI *(Completed)*
  - [x] Payment link creation
  - [x] Pay invoice interface
  - [x] Payment status tracking

---

### Phase 5: Protected Mode *(Completed: 2024-12-23)*

- [x] **5.1** Create risk policies configuration *(Completed)*
  - [x] Token whitelist/blacklist in `risk-policies.ts`
  - [x] Slippage limits (default/protected modes)
  - [x] Price impact thresholds
  - [x] Size limits relative to liquidity

- [x] **5.2** Implement pre-execution analysis *(Completed)*
  - [x] Quote inspection and validation
  - [x] Risk level calculation
  - [x] Warning generation
  - [x] Threshold enforcement

---

### Phase 6: Testing, Documentation & CI

- [x] **6.1** Write unit tests (Jest) *(Completed: 2024-12-24)*
  - [x] ExecutionEngine tests
  - [x] FlowMintOnChain tests
  - [x] PaymentService tests
  - [x] JupiterService tests

- [x] **6.2** Write Anchor tests *(Completed: 2024-12-24)*
  - [x] Initialize instruction tests
  - [x] Execute swap tests
  - [x] Pay any token tests
  - [x] Admin function tests

- [ ] **6.3** Write E2E tests (Playwright)
  - [ ] Successful swap scenario
  - [ ] Protected swap rejection
  - [ ] DCA trigger
  - [ ] Payment execution

- [ ] **6.4** Configure GitHub Actions CI
  - [ ] npm ci, test, build
  - [ ] anchor build, test
  - [ ] Lint and security scans

- [x] **6.5** Complete documentation *(Completed: 2024-12-24)*
  - [x] architecture.md
  - [x] usage.md
  - [x] This DEVELOPMENT.md file

---

## 🔧 Technical Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Use pnpm for package management | Faster installs, better disk efficiency | 2024-12-23 |
| Next.js 14 for frontend | App router, server components, built-in API routes | 2024-12-23 |
| SQLite for local development | Simple setup, migrate to PostgreSQL for production | 2024-12-23 |
| Anchor 0.29+ | Latest stable with improved security features | 2024-12-23 |
| Jupiter v6 API | Most current version with best features | 2024-12-23 |

---

## 🐛 Challenges & Solutions

| Challenge | Solution | Status |
|-----------|----------|--------|
| better-sqlite3 native compilation issues | Migrated to sql.js (pure JS) | ✅ Resolved |
| Tailwind CSS PostCSS configuration | Added tailwindcss to PostCSS plugins | ✅ Resolved |
| WalletMultiButton hydration error | Used dynamic import with ssr: false | ✅ Resolved |
| Jupiter CPI complexity | Created dedicated jupiter.rs module | ✅ Resolved |
| Route serialization for on-chain | Used Borsh with custom structs | ✅ Resolved |

---

## 📖 Additional Resources Consulted

| Resource | Type | URL | Notes |
|----------|------|-----|-------|
| Jupiter GitHub | Examples | https://github.com/jup-ag | Reference implementations |
| Solana Cookbook | Tutorial | https://solanacookbook.com | Best practices |
| Anchor Examples | Examples | https://github.com/coral-xyz/anchor/tree/master/examples | Program patterns |
| Jupiter V6 Docs | API | https://station.jup.ag/docs | Quote/Swap endpoints |
| Borsh Serialization | Docs | https://borsh.io | On-chain data format |

---

## 📝 Daily Progress Log

### 2024-12-24

**Completed (Phase 2b)**:
- Created `jupiter.rs` module for Jupiter CPI integration
- Implemented full `execute_swap` instruction with on-chain validation
- Implemented `pay_any_token` instruction with USDC conversion
- Created `flowMintOnChain.ts` service for PDA derivation and instruction building
- Updated `executionEngine.ts` with FlowMint instruction injection
- Updated `paymentService.ts` with FlowMint payment integration
- Wrote comprehensive Anchor test suite
- Wrote unit tests for FlowMint services
- Updated DEVELOPMENT.md with Phase 2b progress

**Technical Highlights**:
- Jupiter CPI executes swap with route deserialization
- Route data serialized with Borsh for deterministic on-chain parsing
- Receipt and Payment PDAs track all transactions
- Off-chain engine injects FlowMint instruction into Jupiter transactions
- All instructions include protected mode support

**Next Steps**:
- Run `anchor build` to generate IDL
- Deploy to localnet for testing
- Write E2E Playwright tests
- Configure GitHub Actions CI

---

### 2024-12-23

**Completed**:
- Initialized repository structure
- Created all core services (jupiterService, executionEngine, intentScheduler, paymentService)
- Built Anchor program skeleton with state definitions
- Created Next.js frontend with all pages (swap, DCA, stop-loss, payments)
- Implemented SDK with client library
- Fixed build issues (sql.js, Tailwind, hydration)
- Pushed 83 files to GitHub

**Next Steps**:
- Complete on-chain program implementation (Phase 2b)

**Blockers**: None

---

*Last Updated: 2024-12-24*
