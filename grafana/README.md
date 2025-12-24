# FlowMint Monitoring

This directory contains Grafana dashboards and Prometheus configuration for monitoring FlowMint.

## 📊 Available Dashboards

### FlowMint Overview (`flowmint-overview.json`)

A comprehensive dashboard with:

- **Overview Stats**: Operations count, success rate, median duration, active intents
- **Operations**: Rate by type (swap, payment, DCA), success vs failure trends
- **Latency**: Operation duration percentiles (p50, p90, p99), quote & confirmation latency
- **Risk & Errors**: Risk-blocked operations by level, failures by error code
- **Retries & Requotes**: Retry reasons, requote frequency

## 🚀 Quick Start

### Option 1: Docker Compose

Add to your `docker-compose.yml`:

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./grafana/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'

  grafana:
    image: grafana/grafana:latest
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - ./grafana/dashboards:/var/lib/grafana/dashboards/flowmint
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    depends_on:
      - prometheus
```

### Option 2: Manual Import

1. Start Prometheus with `grafana/prometheus.yml`
2. Open Grafana → Configuration → Data Sources → Add Prometheus
3. Import → Upload JSON → Select `dashboards/flowmint-overview.json`

## 📈 Metrics Exposed

| Metric | Type | Description |
|--------|------|-------------|
| `flowmint_operations_total` | Counter | Total operations by type and profile |
| `flowmint_operations_success_total` | Counter | Successful operations |
| `flowmint_operations_failed_total` | Counter | Failed operations with error_code |
| `flowmint_requotes_total` | Counter | Quote refreshes during execution |
| `flowmint_retries_total` | Counter | Transaction retries by reason |
| `flowmint_risk_blocked_total` | Counter | Operations blocked by risk gating |
| `flowmint_operation_duration_seconds` | Histogram | End-to-end operation duration |
| `flowmint_confirmation_duration_seconds` | Histogram | TX confirmation time |
| `flowmint_quote_latency_seconds` | Histogram | Jupiter quote API latency |
| `flowmint_active_intents` | Gauge | Active DCA/stop-loss intents |
| `flowmint_pending_jobs` | Gauge | Pending scheduler jobs |

## 🔔 Alerting

Example alert rules (add to Prometheus or Grafana):

```yaml
groups:
  - name: flowmint
    rules:
      - alert: HighFailureRate
        expr: sum(rate(flowmint_operations_failed_total[5m])) / sum(rate(flowmint_operations_total[5m])) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High operation failure rate (>10%)"

      - alert: SlowOperations
        expr: histogram_quantile(0.90, sum(rate(flowmint_operation_duration_seconds_bucket[5m])) by (le)) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "p90 operation duration exceeds 30s"

      - alert: RiskBlockingSpike
        expr: sum(increase(flowmint_risk_blocked_total[15m])) > 10
        for: 1m
        labels:
          severity: info
        annotations:
          summary: "Spike in risk-blocked operations"
```

## 🛠️ Customization

### Adding New Panels

1. Edit the dashboard JSON or use Grafana UI
2. Use PromQL queries against `flowmint_*` metrics
3. Export updated JSON to `dashboards/`

### Filtering by Type

Most metrics support label filtering:
- `type`: `swap`, `payment`, `dca`, `stop_loss`
- `profile`: `AUTO`, `FAST`, `CHEAP`
- `risk_level`: `GREEN`, `AMBER`, `RED`
