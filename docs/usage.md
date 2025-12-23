# FlowMint Usage Guide

This guide covers how to use FlowMint for swaps, DCA orders, stop-loss, and payments.

## Quick Start

### Prerequisites

- Solana wallet (Phantom, Solflare, etc.)
- SOL for transaction fees
- Tokens to swap

### Using the Web Interface

1. Visit the FlowMint app
2. Connect your wallet
3. Select your desired feature (Swap, DCA, Stop-Loss, Payments)

---

## Token Swaps

### Basic Swap

1. Navigate to the **Swap** page
2. Select input token and amount
3. Select output token
4. Review the quote (rate, price impact, slippage)
5. Click **Swap** and approve the transaction

### Understanding Quote Details

- **Rate**: Exchange rate between tokens
- **Price Impact**: How much your trade affects the market price
- **Slippage**: Maximum deviation from quoted price

### Adjusting Slippage

1. Click the settings icon (⚙️)
2. Select a preset (0.1%, 0.5%, 1%, 3%) or enter custom value
3. Higher slippage = more likely to succeed, but may get worse price

### Best Practices

- Check price impact before large trades
- Use limit orders for size trades (coming soon)
- Split large orders to reduce price impact

---

## DCA (Dollar Cost Averaging)

DCA allows you to automatically buy a token at regular intervals.

### Creating a DCA Order

1. Navigate to **DCA**
2. Select the token to spend (e.g., USDC)
3. Select the token to receive (e.g., SOL)
4. Enter total amount to spend
5. Choose number of orders
6. Select frequency (hourly, daily, weekly)
7. Click **Create DCA Order**

### Example

To DCA $1000 into SOL over 10 days:
- Spend: USDC
- Receive: SOL
- Total Amount: 1000 USDC
- Number of Orders: 10
- Frequency: Every day

Result: $100 will be swapped to SOL every day for 10 days.

### Managing DCA Orders

- View active orders in the **Active DCA Orders** section
- Track progress with the progress bar
- Cancel anytime by clicking **Cancel**

### How It Works

1. Your order is stored in our system
2. Every interval, we check if it's time to execute
3. We fetch a fresh quote from Jupiter
4. Execute the swap on your behalf
5. Continue until all orders complete

---

## Stop-Loss Orders

Protect your positions with automated stop-loss triggers.

### Creating a Stop-Loss

1. Navigate to **Stop-Loss**
2. Select the token to sell (e.g., SOL)
3. Enter the amount
4. Set the trigger price (USD)
5. Click **Create Stop-Loss Order**

### Example

To protect 10 SOL position with a stop at $80:
- Token: SOL
- Amount: 10 SOL
- Trigger Price: $80

When SOL drops to $80 or below, the order executes automatically.

### Price Monitoring

- We use Pyth Network for real-time prices
- Prices are checked every 10 seconds
- Orders execute within seconds of trigger

### Supported Tokens

Stop-loss is available for tokens with Pyth price feeds:
- SOL
- ETH
- BTC
- More coming soon

### Limitations

- Market execution only (no guaranteed price)
- Slippage may occur in volatile markets
- Network congestion can delay execution

---

## Payments (Pay Any Token → USDC)

Accept payments in any token, receive USDC.

### For Merchants

#### Creating a Payment Link

1. Navigate to **Payments**
2. Enter your Merchant ID
3. Enter Order/Invoice ID
4. Enter amount in USDC
5. Click **Create Payment Link**

#### Sharing the Link

You'll receive:
- Payment URL to share with customer
- QR code for in-person payments
- Expiration time (default: 1 hour)

#### Tracking Payments

- View payment status (pending, completed, expired)
- Check transaction signature on-chain
- Export payment history (coming soon)

### For Payers

#### Paying an Invoice

1. Navigate to **Payments** > **Pay Invoice**
2. Enter the Payment ID
3. View payment details
4. Select token to pay with
5. Click **Pay**

#### How It Works

1. We calculate exact amount needed in your token
2. Swap executes via Jupiter (ExactOut mode)
3. Merchant receives exact USDC amount
4. You pay in your preferred token

### Example

Invoice: 100 USDC
Paying with: SOL

1. We quote: ~0.67 SOL needed (at $150/SOL)
2. You approve 0.67 SOL + small buffer
3. Swap executes
4. Merchant gets exactly 100 USDC
5. Any excess returned to you

---

## SDK Usage

### Installation

```bash
npm install @flowmint/sdk
# or
pnpm add @flowmint/sdk
```

### Basic Usage

```typescript
import { FlowMintClient } from '@flowmint/sdk';

const client = new FlowMintClient({
  apiUrl: 'https://api.flowmint.io',
});

// Get a quote
const quote = await client.getQuote({
  inputMint: 'So11111111111111111111111111111111111111112', // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: 1_000_000_000, // 1 SOL in lamports
  slippageBps: 50, // 0.5%
});

console.log(`Output: ${quote.outAmount}`);
console.log(`Price Impact: ${quote.priceImpactPct}%`);
```

### Executing a Swap

```typescript
const result = await client.executeSwap({
  userPublicKey: wallet.publicKey.toBase58(),
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: 1_000_000_000,
  slippageBps: 50,
});

if (result.success) {
  console.log(`Swap successful: ${result.signature}`);
}
```

### Creating a DCA

```typescript
const dca = await client.createIntent({
  userPublicKey: wallet.publicKey.toBase58(),
  type: 'dca',
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  outputMint: 'So11111111111111111111111111111111111111112', // SOL
  totalAmount: 100_000_000, // 100 USDC
  numberOfOrders: 10,
  intervalMs: 86400000, // Daily
});

console.log(`DCA created: ${dca.intentId}`);
```

### Creating a Stop-Loss

```typescript
const stopLoss = await client.createIntent({
  userPublicKey: wallet.publicKey.toBase58(),
  type: 'stop-loss',
  inputMint: 'So11111111111111111111111111111111111111112', // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  totalAmount: 10_000_000_000, // 10 SOL
  triggerPrice: 80.0, // $80
  pythFeedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
});
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `SlippageExceeded` | Price moved too much | Increase slippage or retry |
| `PriceImpactTooHigh` | Large trade relative to liquidity | Split into smaller trades |
| `InsufficientBalance` | Not enough tokens | Check wallet balance |
| `TokenBlacklisted` | Token not allowed | Use whitelisted tokens |
| `RateLimitExceeded` | Too many requests | Wait and retry |

### Retry Logic

The SDK automatically retries failed requests:
- Network errors: 3 retries with exponential backoff
- Rate limits: Waits for retry-after header
- Other errors: No retry

---

## FAQ

### Is FlowMint safe?

Yes. We never hold your private keys. All transactions require your wallet approval.

### What fees does FlowMint charge?

Currently, FlowMint is free to use. You only pay:
- Solana network fees (~0.000005 SOL)
- Jupiter swap fees (varies by route)

### Can I cancel a pending swap?

No. Once submitted, swaps are atomic and final.

### What happens if a DCA/stop-loss fails?

We retry automatically. If it continues to fail, the order pauses and you're notified.

### Are my funds locked for DCA?

Currently, funds are swapped from your wallet when each order executes. You need to maintain sufficient balance.

---

## Support

- GitHub Issues: [github.com/flowmint/flowmint/issues](https://github.com/flowmint/flowmint/issues)
- Discord: [discord.gg/flowmint](https://discord.gg/flowmint)
- Twitter: [@flowmint](https://twitter.com/flowmint)
