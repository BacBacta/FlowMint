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
  - Repository created and connected to GitHub
  - Initial commit pushed to main branch

- [x] **1.2** Create monorepo folder structure *(Completed: 2024-12-23)*
  - `/program` - Anchor on-chain program
  - `/server` - Off-chain execution engine
  - `/app` - React/Next.js frontend
  - `/sdk` - Reusable client library
  - `/docs` - Documentation
  - `/scripts` - Deployment scripts

- [x] **1.3** Write README.md *(Completed: 2024-12-23)*
  - Project introduction and purpose
  - Architecture diagram
  - Quick start guide
  - Environment variables documentation

- [x] **1.4** Create DEVELOPMENT.md *(Completed: 2024-12-23)*
  - This file with task tracking
  - Documentation research notes
  - Progress updates

- [x] **1.5** Configure .gitignore *(Completed: 2024-12-23)*
  - Node, Rust, VS Code, test artifacts excluded
  - Environment files protected

- [x] **1.6** Set up ESLint and Prettier *(Completed: 2024-12-23)*
  - `.eslintrc.js` with TypeScript rules
  - `.prettierrc` with formatting preferences
  - Integration with VS Code

- [x] **1.7** Configure VS Code workspace *(Completed: 2024-12-23)*
  - `.vscode/settings.json` for formatting
  - `.vscode/extensions.json` for recommended extensions
  - `.vscode/tasks.json` for build tasks

- [ ] **1.8** Initialize Anchor program skeleton *(In Progress)*
- [ ] **1.9** Initialize server package with TypeScript
- [ ] **1.10** Initialize app with Next.js
- [ ] **1.11** Initialize SDK package

---

### Phase 2: Core Policy/Execution/Receipt Engine

- [ ] **2.1** Implement `jupiterService.ts`
  - [ ] `quoteSwap()` function
  - [ ] `executeSwap()` function
  - [ ] Error handling for unsupported pairs
  - [ ] Unit tests with mocked API

- [ ] **2.2** Create ExecutionEngine module
  - [ ] Policy validation (whitelist/blacklist)
  - [ ] Slippage enforcement
  - [ ] Size limits relative to liquidity
  - [ ] Retry logic with adjusted slippage
  - [ ] Alternative RPC endpoints

- [ ] **2.3** Build Anchor Router Program
  - [ ] Swap execution instruction
  - [ ] Slippage protection flag
  - [ ] Pay any token instruction
  - [ ] Account validation
  - [ ] Anchor tests

- [ ] **2.4** Implement Receipt Storage
  - [ ] Receipt schema (quote, route, signature, outcome)
  - [ ] Database/JSON store integration
  - [ ] API endpoint for querying receipts

---

### Phase 3: Simple Intents (DCA/Stop-Loss)

- [ ] **3.1** Define Intent data model
  - [ ] JSON schema / DB table
  - [ ] TypeScript types

- [ ] **3.2** Implement IntentScheduler
  - [ ] DCA execution logic
  - [ ] Stop-loss trigger logic
  - [ ] Pyth oracle integration
  - [ ] Cron/queue scheduling

- [ ] **3.3** Build Intent UI
  - [ ] Create DCA form
  - [ ] Create stop-loss form
  - [ ] Status display and history

---

### Phase 4: Pay Any Token → USDC

- [ ] **4.1** Implement `/payments` endpoint
  - [ ] Balance validation
  - [ ] Jupiter route for exact USDC output
  - [ ] Atomic transaction building
  - [ ] Payment receipt generation

- [ ] **4.2** Optional: Anchor `pay_any_token` instruction

- [ ] **4.3** Build Payment UI
  - [ ] Payment form with live rates
  - [ ] QR code generation
  - [ ] Payment link creation

---

### Phase 5: Protected Mode

- [ ] **5.1** Create risk policies configuration
  - [ ] Token whitelist/blacklist
  - [ ] Slippage settings
  - [ ] Price impact thresholds
  - [ ] Size limits

- [ ] **5.2** Implement pre-execution analysis
  - [ ] Quote inspection
  - [ ] Token metadata validation
  - [ ] Threshold checks

- [ ] **5.3** Optional: MEV protection via Jito

---

### Phase 6: Testing, Documentation & CI

- [ ] **6.1** Write unit tests (Jest)
  - [ ] ExecutionEngine tests
  - [ ] IntentScheduler tests
  - [ ] PaymentService tests
  - [ ] ProtectedMode tests

- [ ] **6.2** Write E2E tests (Playwright)
  - [ ] Successful swap scenario
  - [ ] Protected swap rejection
  - [ ] DCA trigger
  - [ ] Payment execution

- [ ] **6.3** Configure GitHub Actions CI
  - [ ] npm ci, test, build
  - [ ] anchor build, test
  - [ ] Lint and security scans

- [ ] **6.4** Complete documentation
  - [ ] architecture.md
  - [ ] usage.md
  - [ ] developer-guide.md
  - [ ] risk-policies.md

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
| *To be documented as encountered* | | |

---

## 📖 Additional Resources Consulted

| Resource | Type | URL | Notes |
|----------|------|-----|-------|
| Jupiter GitHub | Examples | https://github.com/jup-ag | Reference implementations |
| Solana Cookbook | Tutorial | https://solanacookbook.com | Best practices |
| Anchor Examples | Examples | https://github.com/coral-xyz/anchor/tree/master/examples | Program patterns |

---

## 📝 Daily Progress Log

### 2024-12-23

**Completed**:
- Initialized repository structure
- Created README.md with full documentation
- Set up DEVELOPMENT.md for tracking
- Configured .gitignore, ESLint, Prettier
- Set up VS Code workspace settings

**Next Steps**:
- Initialize Anchor program
- Set up server with TypeScript
- Create Next.js app skeleton
- Initialize SDK package

**Blockers**: None

---

*Last Updated: 2024-12-23*
