# FlowMint Risk Policies

This document describes the risk management policies implemented in FlowMint.

## Overview

FlowMint implements multiple layers of risk protection to ensure safe execution:

1. **Token Policies** - Whitelists and blacklists
2. **Slippage Controls** - Maximum allowed slippage
3. **Price Impact Limits** - Protection against large market moves
4. **Protected Mode** - Emergency restrictions
5. **User Limits** - Per-user safeguards

---

## Token Policies

### Whitelisted Tokens

These tokens are fully supported with the highest trust level:

| Token | Mint Address | Risk Level |
|-------|--------------|------------|
| SOL | `So11111111111111111111111111111111111111112` | Low |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Low |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | Low |
| RAY | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` | Low |
| SRM | `SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt` | Low |
| ORCA | `orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE` | Low |

### Blacklisted Tokens

These tokens are blocked from trading:

- Known scam tokens
- Honeypot tokens
- Tokens with transfer restrictions that break swaps
- Deprecated/migrated tokens

### Unknown Tokens

Tokens not on the whitelist receive:
- Higher slippage requirements
- Lower transaction limits
- Additional warnings to users

---

## Slippage Controls

### Default Slippage Settings

| Risk Level | Default Slippage | Max Slippage |
|------------|------------------|--------------|
| Low | 0.5% (50 bps) | 5% (500 bps) |
| Medium | 1% (100 bps) | 3% (300 bps) |
| High | N/A | N/A (blocked) |

### Per-Token Overrides

Some tokens require different slippage due to liquidity:

```typescript
const SLIPPAGE_OVERRIDES = {
  // High liquidity - lower slippage
  'SOL': { default: 30, max: 300 },
  'USDC': { default: 10, max: 100 },
  
  // Lower liquidity - higher slippage
  'RARE_TOKEN': { default: 100, max: 500 },
};
```

### User-Specified Slippage

Users can specify slippage within allowed limits:
- Minimum: 0.01% (1 bps)
- Maximum: 5% (500 bps) for most tokens
- Values outside range are rejected

---

## Price Impact Limits

### Thresholds

| Price Impact | Action |
|--------------|--------|
| < 0.3% | ✅ Execute normally |
| 0.3% - 1% | ⚠️ Warning displayed |
| 1% - 3% | ⚠️ Strong warning, confirmation required |
| > 3% | ❌ Blocked by default |

### Override for Advanced Users

Advanced users can enable high price impact trades:
- Requires explicit opt-in
- Additional confirmation step
- Logged for audit purposes

### Calculation

Price impact is sourced from Jupiter's quote response:

```typescript
const priceImpact = parseFloat(quote.priceImpactPct);

if (priceImpact > config.maxPriceImpact) {
  throw new PolicyError('PRICE_IMPACT_TOO_HIGH');
}
```

---

## Protected Mode

Protected mode is an emergency feature that restricts functionality.

### Triggers

- Admin manual activation
- Detected exploit attempts
- Market volatility alerts
- Smart contract anomalies

### Restrictions When Active

| Feature | Normal Mode | Protected Mode |
|---------|-------------|----------------|
| Swap whitelisted tokens | ✅ | ✅ |
| Swap unknown tokens | ✅ | ❌ |
| Max slippage | 5% | 1% |
| Max price impact | 3% | 0.5% |
| DCA orders | ✅ | ⏸️ Paused |
| Stop-loss | ✅ | ⏸️ Paused |
| Payments | ✅ | ⚠️ USDC only |

### Admin Controls

```typescript
// Toggle via admin API
POST /api/admin/protected-mode
{
  "enabled": true,
  "reason": "Market volatility"
}
```

### On-Chain Toggle

Protected mode can also be toggled on-chain:

```rust
pub fn toggle_protected_mode(ctx: Context<ToggleProtectedMode>, enabled: bool) -> Result<()> {
    let config = &mut ctx.accounts.protocol_config;
    config.protected_mode = enabled;
    Ok(())
}
```

---

## User Limits

### Per-User Safeguards

| Limit | Default | Notes |
|-------|---------|-------|
| Max swap per tx | $100,000 | Can be raised with verification |
| Daily swap volume | $500,000 | Rolling 24-hour window |
| Active DCA orders | 10 | Concurrent orders |
| Active stop-loss | 20 | Concurrent orders |
| API rate limit | 100/min | Per API key |

### User Stats Tracking

```typescript
interface UserStats {
  totalSwaps: number;
  totalVolume: number;
  dailyVolume: number;
  activeIntents: number;
  riskScore: RiskLevel;
}
```

### Progressive Limits

New users start with lower limits:

| Account Age | Swap Limit | Daily Volume |
|-------------|------------|--------------|
| < 1 day | $1,000 | $5,000 |
| 1-7 days | $10,000 | $50,000 |
| 7-30 days | $50,000 | $200,000 |
| > 30 days | $100,000 | $500,000 |

---

## Risk Assessment

### Risk Level Calculation

```typescript
function calculateRiskLevel(params: SwapParams): RiskLevel {
  let score = 0;
  
  // Token risk
  if (isBlacklisted(params.inputMint) || isBlacklisted(params.outputMint)) {
    return 'blocked';
  }
  
  if (!isWhitelisted(params.inputMint)) score += 2;
  if (!isWhitelisted(params.outputMint)) score += 2;
  
  // Price impact risk
  if (params.priceImpact > 0.01) score += 1;
  if (params.priceImpact > 0.03) score += 2;
  
  // Slippage risk
  if (params.slippageBps > 100) score += 1;
  if (params.slippageBps > 300) score += 2;
  
  // Amount risk
  if (params.amountUsd > 10000) score += 1;
  if (params.amountUsd > 50000) score += 2;
  
  // Determine level
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}
```

### Risk Indicators

| Indicator | Low Risk | Medium Risk | High Risk |
|-----------|----------|-------------|-----------|
| Token Status | Whitelisted | Unknown | Blacklisted |
| Price Impact | < 0.3% | 0.3% - 1% | > 1% |
| Slippage | < 1% | 1% - 3% | > 3% |
| Trade Size | < $10k | $10k - $50k | > $50k |

---

## Monitoring & Alerts

### Automated Monitoring

- Real-time slippage tracking
- Price impact anomaly detection
- Volume spike alerts
- Failed transaction patterns

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Failed swap rate | > 5% | > 15% |
| Avg slippage | > 1% | > 3% |
| Avg price impact | > 0.5% | > 2% |
| API error rate | > 1% | > 5% |

### Incident Response

1. **Detection** - Automated monitoring triggers alert
2. **Assessment** - Team evaluates severity
3. **Action** - Enable protected mode if needed
4. **Communication** - Notify users via UI banner
5. **Resolution** - Fix issue, disable protected mode
6. **Postmortem** - Document and improve

---

## Configuration

### Environment Variables

```bash
# Risk thresholds
MAX_SLIPPAGE_BPS=500
MAX_PRICE_IMPACT=0.03
DEFAULT_SLIPPAGE_BPS=50

# Protected mode
PROTECTED_MODE_ENABLED=false

# User limits
MAX_SWAP_AMOUNT_USD=100000
MAX_DAILY_VOLUME_USD=500000
```

### Runtime Configuration

```typescript
// server/src/config/risk-policies.ts
export const riskConfig = {
  slippage: {
    default: 50,
    max: 500,
  },
  priceImpact: {
    warning: 0.003,
    confirm: 0.01,
    max: 0.03,
  },
  protectedMode: {
    enabled: false,
    maxSlippage: 100,
    maxPriceImpact: 0.005,
  },
};
```

---

## Best Practices for Users

1. **Use recommended slippage** - Default values are optimized
2. **Check price impact** - Split large orders if needed
3. **Trade whitelisted tokens** - Lower risk, better execution
4. **Start small** - Test with small amounts first
5. **Monitor transactions** - Verify execution on-chain

---

## Audit & Compliance

### Logging

All policy decisions are logged:

```typescript
logger.info('Policy check', {
  action: 'swap',
  user: publicKey,
  inputMint,
  outputMint,
  amount,
  slippage,
  priceImpact,
  riskLevel,
  decision: 'approved',
});
```

### Audit Trail

- All swaps recorded with full parameters
- Policy violations logged
- Protected mode changes tracked
- Admin actions audited

### Reporting

- Daily risk reports generated
- Weekly volume analysis
- Monthly policy review
