# FlowMint PortfolioPay V2 - Merchant Integration Guide

## Overview

FlowMint PortfolioPay V2 enables merchants to accept crypto payments that are automatically converted to USDC. This guide covers everything you need to integrate V2 features into your application.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [Creating Invoices](#creating-invoices)
4. [Webhooks](#webhooks)
5. [Merchant Portal API](#merchant-portal-api)
6. [Attestations & Verification](#attestations--verification)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## Getting Started

### Prerequisites

- A FlowMint merchant account
- API credentials (API Key)
- Webhook endpoint (HTTPS required for production)

### Base URLs

```
Production: https://api.flowmint.io/api/v1
Staging:    https://staging-api.flowmint.io/api/v1
```

### SDK Installation

```bash
# Node.js
npm install @flowmint/sdk

# Python
pip install flowmint

# Go
go get github.com/flowmint/flowmint-go
```

---

## Authentication

All API requests require authentication via API key.

### API Key Header

```http
X-API-Key: fm_live_xxxxxxxxxxxxxxxxxxxx
```

### Example Request

```typescript
const response = await fetch('https://api.flowmint.io/api/v1/merchants/YOUR_MERCHANT_ID/invoices', {
  headers: {
    'X-API-Key': 'fm_live_xxxxxxxxxxxxxxxxxxxx',
    'Content-Type': 'application/json'
  }
});
```

### Rate Limits

| Tier       | Requests/min | Requests/day |
|------------|--------------|--------------|
| Standard   | 60           | 10,000       |
| Pro        | 200          | 50,000       |
| Enterprise | Custom       | Custom       |

Rate limit headers are included in all responses:
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Creating Invoices

### POST /invoices

Create a new payment invoice.

```typescript
const invoice = await flowmint.invoices.create({
  merchantId: 'your-merchant-id',
  usdcAmount: '100.00',          // Amount in USDC
  orderId: 'order-12345',        // Your internal order ID
  description: 'Premium subscription',
  expiresIn: 900,                // 15 minutes in seconds
  metadata: {
    customer_email: 'customer@example.com',
    product_sku: 'PREMIUM-001'
  },
  // V2: Token preferences
  acceptedTokens: ['SOL', 'BONK', 'JUP'],  // Optional: limit accepted tokens
  maxLegs: 3                               // Optional: max split-tender legs
});
```

### Response

```json
{
  "id": "inv_abc123xyz",
  "merchantId": "merchant-001",
  "status": "pending",
  "usdcAmount": "100000000",
  "orderId": "order-12345",
  "paymentUrl": "https://pay.flowmint.io/inv_abc123xyz",
  "qrCode": "data:image/png;base64,...",
  "expiresAt": 1699999999000,
  "createdAt": 1699999000000
}
```

---

## Webhooks

V2 introduces robust webhook delivery with HMAC signatures and automatic retries.

### Webhook Events

| Event               | Description                          |
|---------------------|--------------------------------------|
| `invoice.created`   | Invoice was created                  |
| `invoice.paid`      | Invoice was fully paid               |
| `invoice.expired`   | Invoice expired without payment      |
| `payment.failed`    | Payment attempt failed               |
| `payment.leg_completed` | Single leg of split-tender completed |

### Webhook Payload

```json
{
  "id": "evt_xyz789",
  "event": "invoice.paid",
  "createdAt": 1699999999000,
  "data": {
    "invoiceId": "inv_abc123xyz",
    "merchantId": "merchant-001",
    "orderId": "order-12345",
    "usdcAmount": "100000000",
    "paidAt": 1699999888000,
    "payerPublicKey": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "legs": [
      {
        "tokenMint": "So11111111111111111111111111111111111111112",
        "tokenSymbol": "SOL",
        "amountIn": "500000000",
        "usdcOut": "50000000",
        "txSignature": "5j7s3t...",
        "dex": "jupiter"
      },
      {
        "tokenMint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        "tokenSymbol": "BONK",
        "amountIn": "50000000000",
        "usdcOut": "50000000",
        "txSignature": "3k8x2w...",
        "dex": "jupiter"
      }
    ],
    "attestationId": "att_def456"
  }
}
```

### Signature Verification

All webhooks are signed with HMAC-SHA256. Verify signatures to ensure authenticity.

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // Parse signature header: t=timestamp,v1=signature
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];
  
  if (!timestamp || !v1) {
    return false;
  }
  
  // Check timestamp (reject if > 5 minutes old)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) {
    return false;
  }
  
  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  // Constant-time comparison
  return crypto.timingSafeEqual(
    Buffer.from(v1, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

// Express middleware example
app.post('/webhooks/flowmint', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-flowmint-signature'] as string;
  const payload = req.body.toString();
  
  if (!verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET!)) {
    return res.status(401).send('Invalid signature');
  }
  
  const event = JSON.parse(payload);
  
  switch (event.event) {
    case 'invoice.paid':
      // Handle successful payment
      await fulfillOrder(event.data.orderId);
      break;
    case 'invoice.expired':
      // Handle expiration
      await cancelOrder(event.data.orderId);
      break;
    case 'payment.failed':
      // Handle failure
      await notifyCustomer(event.data.orderId);
      break;
  }
  
  res.status(200).send('OK');
});
```

### Testing Webhooks

```bash
# Test your webhook endpoint
curl -X POST https://api.flowmint.io/api/v1/webhooks/test \
  -H "X-API-Key: your-api-key"
```

---

## Merchant Portal API

### List Invoices

```http
GET /merchants/{merchantId}/invoices
```

Query Parameters:
- `status` - Filter by status (comma-separated): `pending,paid,expired,failed`
- `from` - Start timestamp (ms)
- `to` - End timestamp (ms)
- `orderId` - Filter by order ID
- `payer` - Filter by payer public key
- `search` - Search in order ID and description
- `page` - Page number (default: 1)
- `limit` - Results per page (max: 100)
- `sortBy` - Sort field: `createdAt`, `usdcAmount`, `status`
- `sortOrder` - Sort direction: `asc`, `desc`

```typescript
const invoices = await flowmint.merchants.listInvoices('merchant-001', {
  status: ['paid', 'pending'],
  from: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
  page: 1,
  limit: 20
});
```

### Export Invoices

```http
GET /merchants/{merchantId}/export
```

Query Parameters:
- `format` - Export format: `csv`, `json`
- `status` - Filter by status
- `from` / `to` - Date range
- `includeLegs` - Include payment legs: `true`, `false`
- `includeAttestations` - Include attestation data: `true`, `false`

```typescript
// Download CSV export
const csv = await flowmint.merchants.export('merchant-001', {
  format: 'csv',
  from: Date.now() - 30 * 24 * 60 * 60 * 1000,
  includeLegs: true
});

// Save to file
fs.writeFileSync('invoices.csv', csv);
```

### Get Statistics

```http
GET /merchants/{merchantId}/stats
```

```typescript
const stats = await flowmint.merchants.getStats('merchant-001', {
  days: 30
});

// Response
{
  "totalInvoices": 1234,
  "paidInvoices": 1100,
  "expiredInvoices": 100,
  "failedInvoices": 34,
  "successRate": 0.891,
  "totalVolume": "125000000000",  // 125,000 USDC
  "totalFees": "625000000",       // 625 USDC (0.5%)
  "avgSettlementTime": 45000,     // 45 seconds
  "uniquePayers": 850,
  "topTokens": [
    { "token": "SOL", "count": 500 },
    { "token": "USDC", "count": 300 },
    { "token": "BONK", "count": 200 }
  ]
}
```

### Create Dispute

```http
POST /merchants/{merchantId}/disputes
```

```typescript
const dispute = await flowmint.disputes.create({
  merchantId: 'merchant-001',
  invoiceId: 'inv_abc123xyz',
  reason: 'missing_payment',  // or: 'wrong_amount', 'duplicate', 'fraud', 'other'
  description: 'Payment confirmed on chain but not reflected in invoice status'
});
```

---

## Attestations & Verification

V2 attestations provide cryptographic proof of payment with per-leg verification.

### Verify Attestation

```http
GET /attestations/{attestationId}/verify
```

```typescript
const verification = await flowmint.attestations.verify('att_def456');

// Response
{
  "valid": true,
  "version": "2.0",
  "errors": [],
  "warnings": [],
  "verifiedAt": 1699999999000,
  "attestation": {
    "id": "att_def456",
    "invoiceId": "inv_abc123xyz",
    "policyHash": "sha256:abc123...",
    "signerPubkey": "FMxyz...",
    "signature": "...",
    "legs": [
      {
        "legIndex": 0,
        "tokenMint": "So11...",
        "proofHash": "sha256:...",
        "txSignature": "5j7s3t...",
        "verified": true
      }
    ]
  }
}
```

### Get Verification Kit

For merchants who want to independently verify attestations:

```http
GET /attestations/{attestationId}/kit
```

```typescript
const kit = await flowmint.attestations.getVerificationKit('att_def456');

// Response includes:
// - Attestation data
// - Step-by-step verification instructions
// - Sample verification code
// - RPC endpoints for on-chain verification
```

---

## Error Handling

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "errorCode": "MACHINE_READABLE_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

### Common Error Codes

| Code                  | HTTP | Description                           |
|-----------------------|------|---------------------------------------|
| `UNAUTHORIZED`        | 401  | Invalid or missing API key            |
| `FORBIDDEN`           | 403  | Access denied to resource             |
| `NOT_FOUND`           | 404  | Resource not found                    |
| `RATE_LIMITED`        | 429  | Too many requests                     |
| `INVALID_REQUEST`     | 400  | Invalid request parameters            |
| `INVOICE_EXPIRED`     | 422  | Invoice has expired                   |
| `INSUFFICIENT_BALANCE`| 422  | Payer has insufficient balance        |
| `QUOTE_EXPIRED`       | 422  | Price quote has expired               |
| `CIRCUIT_OPEN`        | 503  | Service temporarily unavailable       |

### Retry Strategy

For transient errors (5xx, `RATE_LIMITED`, `CIRCUIT_OPEN`):

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }
      
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
```

---

## Best Practices

### 1. Idempotency

Always use unique `orderId` values. If a request fails, you can safely retry with the same `orderId` without creating duplicate invoices.

### 2. Webhook Reliability

- Respond to webhooks within 30 seconds
- Return 2xx status to acknowledge receipt
- Process asynchronously for long operations
- Implement idempotency using `event.id`

```typescript
app.post('/webhooks', async (req, res) => {
  const event = req.body;
  
  // Check if already processed
  if (await isEventProcessed(event.id)) {
    return res.status(200).send('Already processed');
  }
  
  // Acknowledge immediately
  res.status(200).send('OK');
  
  // Process async
  processEvent(event).catch(console.error);
});
```

### 3. Amount Handling

All amounts are in atomic units (lamports for SOL, etc.). For USDC (6 decimals):
- `1000000` = 1 USDC
- `100000000` = 100 USDC

```typescript
function usdcToAtomic(amount: string): string {
  return (parseFloat(amount) * 1_000_000).toString();
}

function atomicToUsdc(amount: string): string {
  return (parseInt(amount) / 1_000_000).toFixed(2);
}
```

### 4. Security

- Store webhook secrets securely (environment variables, secrets manager)
- Always verify webhook signatures
- Use HTTPS for all endpoints
- Rotate API keys periodically
- Implement IP allowlisting if supported

### 5. Testing

Use staging environment for testing:

```typescript
const flowmint = new FlowMint({
  apiKey: 'fm_test_xxxxx',
  baseUrl: 'https://staging-api.flowmint.io'
});
```

---

## Support

- Documentation: https://docs.flowmint.io
- API Status: https://status.flowmint.io
- Discord: https://discord.gg/flowmint
- Email: support@flowmint.io

---

## Changelog

### V2.0.0 (Current)
- Multi-token split-tender payments
- Per-leg attestation proofs
- Webhook delivery with HMAC signatures
- Merchant portal API
- Circuit breaker safety system
- Dispute management
