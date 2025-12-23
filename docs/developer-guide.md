# FlowMint Developer Guide

This guide is for developers who want to contribute to or extend FlowMint.

## Project Structure

```
FlowMint/
├── app/                    # Next.js frontend
│   ├── src/
│   │   ├── app/           # Next.js App Router pages
│   │   ├── components/    # React components
│   │   └── lib/           # Utilities and API client
│   ├── package.json
│   └── tailwind.config.ts
├── program/               # Anchor program (Rust)
│   ├── programs/
│   │   └── flowmint/
│   │       └── src/
│   │           ├── lib.rs
│   │           ├── state.rs
│   │           ├── errors.rs
│   │           └── instructions/
│   ├── Anchor.toml
│   └── Cargo.toml
├── server/                # Express.js backend
│   ├── src/
│   │   ├── api/          # Route handlers
│   │   ├── config/       # Configuration
│   │   ├── db/           # Database layer
│   │   ├── services/     # Business logic
│   │   └── utils/        # Utilities
│   ├── package.json
│   └── tsconfig.json
├── sdk/                   # TypeScript SDK
│   ├── src/
│   │   ├── client.ts
│   │   ├── types.ts
│   │   └── errors.ts
│   └── package.json
├── docs/                  # Documentation
└── package.json           # Root monorepo config
```

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 8+
- Rust 1.70+ (for Anchor program)
- Solana CLI
- Anchor CLI

### Installation

```bash
# Clone repository
git clone https://github.com/flowmint/flowmint.git
cd flowmint

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration
```

### Running Locally

```bash
# Start all services
pnpm dev

# Or start individually:
pnpm --filter server dev     # Backend on :3001
pnpm --filter app dev        # Frontend on :3000
```

### Building

```bash
# Build all packages
pnpm build

# Build individually
pnpm --filter server build
pnpm --filter app build
pnpm --filter @flowmint/sdk build
```

---

## Server Development

### Adding a New API Endpoint

1. Create route handler in `server/src/api/routes/`:

```typescript
// server/src/api/routes/myFeature.ts
import { Router } from 'express';
import { z } from 'zod';
import logger from '../../utils/logger';

const router = Router();

const MyRequestSchema = z.object({
  field: z.string(),
});

router.post('/my-endpoint', async (req, res) => {
  try {
    const data = MyRequestSchema.parse(req.body);
    
    // Your logic here
    
    res.json({ success: true });
  } catch (error) {
    logger.error('My endpoint error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
```

2. Register in `server/src/app.ts`:

```typescript
import myFeatureRoutes from './api/routes/myFeature';

app.use('/api/my-feature', myFeatureRoutes);
```

### Adding a New Service

1. Create service in `server/src/services/`:

```typescript
// server/src/services/myService.ts
import logger from '../utils/logger';
import config from '../config';

class MyService {
  async doSomething(params: DoSomethingParams): Promise<Result> {
    logger.info('Doing something', { params });
    
    // Implementation
    
    return result;
  }
}

export const myService = new MyService();
```

### Database Operations

Using better-sqlite3:

```typescript
import { database } from '../db/database';

// Insert
database.insertReceipt({
  id: 'unique-id',
  userPublicKey: 'pubkey',
  // ...
});

// Query
const receipts = database.getReceiptsByUser('pubkey');

// Custom query
const db = database.getDb();
const result = db.prepare('SELECT * FROM receipts WHERE status = ?').all('confirmed');
```

---

## Frontend Development

### Adding a New Page

1. Create page in `app/src/app/`:

```typescript
// app/src/app/my-feature/page.tsx
'use client';

import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function MyFeaturePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4">
          <h1>My Feature</h1>
          {/* Content */}
        </div>
      </main>
      <Footer />
    </div>
  );
}
```

2. Add to navigation in `Header.tsx`:

```typescript
const navigation = [
  // ... existing items
  { name: 'My Feature', href: '/my-feature' },
];
```

### Adding API Hooks

Using TanStack Query:

```typescript
// app/src/lib/hooks/useMyFeature.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export function useMyData(id: string) {
  return useQuery({
    queryKey: ['myData', id],
    queryFn: () => apiClient.getMyData(id),
    enabled: !!id,
  });
}

export function useMyMutation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: MyData) => apiClient.createMyData(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myData'] });
    },
  });
}
```

### Wallet Integration

```typescript
import { useWallet, useConnection } from '@solana/wallet-adapter-react';

function MyComponent() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  
  if (!connected) {
    return <div>Please connect your wallet</div>;
  }
  
  // Use publicKey, signTransaction, connection
}
```

---

## Anchor Program Development

### Building the Program

```bash
cd program

# Build
anchor build

# Get program ID
solana address -k target/deploy/flowmint-keypair.json

# Update Anchor.toml with program ID
```

### Adding a New Instruction

1. Define accounts in `lib.rs`:

```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        init,
        payer = user,
        space = 8 + MyAccount::SIZE,
        seeds = [b"my-account", user.key().as_ref()],
        bump
    )]
    pub my_account: Account<'info, MyAccount>,
    
    pub system_program: Program<'info, System>,
}
```

2. Add instruction handler:

```rust
pub fn my_instruction(ctx: Context<MyInstruction>, param: u64) -> Result<()> {
    let my_account = &mut ctx.accounts.my_account;
    
    my_account.value = param;
    my_account.owner = ctx.accounts.user.key();
    
    emit!(MyEvent {
        account: my_account.key(),
        value: param,
    });
    
    Ok(())
}
```

3. Add to program:

```rust
#[program]
pub mod flowmint {
    // ... existing instructions
    
    pub fn my_instruction(ctx: Context<MyInstruction>, param: u64) -> Result<()> {
        instructions::my_instruction::handler(ctx, param)
    }
}
```

### Testing the Program

```bash
# Start local validator
solana-test-validator

# Deploy
anchor deploy

# Run tests
anchor test
```

---

## SDK Development

### Adding SDK Methods

```typescript
// sdk/src/client.ts

export class FlowMintClient {
  // ... existing methods
  
  /**
   * New method description
   */
  async myNewMethod(params: MyParams): Promise<MyResponse> {
    return this.request<MyResponse>('/api/my-endpoint', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}
```

### Adding Types

```typescript
// sdk/src/types.ts

export interface MyParams {
  field: string;
  amount: number;
}

export interface MyResponse {
  success: boolean;
  data?: MyData;
  error?: string;
}
```

### Building and Testing SDK

```bash
cd sdk

# Build
pnpm build

# Type check
pnpm typecheck

# Test
pnpm test
```

---

## Testing

### Server Tests

```bash
cd server
pnpm test

# With coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

Example test:

```typescript
// server/tests/services/jupiterService.test.ts
import { jupiterService } from '../../src/services/jupiterService';

describe('JupiterService', () => {
  it('should get a quote', async () => {
    const quote = await jupiterService.quoteSwap({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: 1_000_000_000,
      slippageBps: 50,
    });
    
    expect(quote).toBeDefined();
    expect(quote.outAmount).toBeDefined();
  });
});
```

### Frontend Tests

```bash
cd app
pnpm test
```

### E2E Tests

```bash
# Using Playwright
pnpm test:e2e
```

---

## Code Style

### TypeScript

- Use strict mode
- Prefer `const` over `let`
- Use explicit types for function parameters and returns
- Use async/await over callbacks

### React

- Use functional components with hooks
- Colocate component logic with components
- Use TanStack Query for server state
- Keep components focused and composable

### Rust

- Follow Anchor conventions
- Use custom error types
- Document public functions
- Keep instructions small

### Formatting

```bash
# Format all code
pnpm format

# Lint all code
pnpm lint

# Fix lint issues
pnpm lint:fix
```

---

## Deployment

### Server

```bash
# Build Docker image
docker build -t flowmint-server ./server

# Run
docker run -p 3001:3001 flowmint-server
```

### Frontend

```bash
# Build
cd app && pnpm build

# Preview
pnpm start

# Deploy to Vercel
vercel --prod
```

### Program

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Write/update tests
5. Run lints and tests
6. Commit with conventional commits: `feat: add my feature`
7. Push and create a Pull Request

### Commit Convention

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `style:` - Formatting
- `refactor:` - Code restructuring
- `test:` - Adding tests
- `chore:` - Maintenance

---

## Troubleshooting

### Common Issues

**pnpm install fails:**
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

**Anchor build fails:**
```bash
anchor clean
anchor build
```

**TypeScript errors:**
```bash
pnpm typecheck
# Check individual package tsconfig
```

**Port already in use:**
```bash
lsof -i :3000
kill -9 <PID>
```
