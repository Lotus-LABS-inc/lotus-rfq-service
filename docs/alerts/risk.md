# Risk Engine Alerting & Monitoring

This document outlines the recommended alert conditions and monitoring panels for the Pre-Trade Risk & Exposure Engine.

## Alert Conditions (Prometheus/Alertmanager)

### 1. High Validation Rejection Rate
Triggers if the number of risk-related rejections exceeds a threshold, indicating potential issues with user quotas or market volatility.
```yaml
alert: HighRiskRejections
expr: increase(risk_validation_rejected_total[1m]) > 50
for: 2m
labels:
  severity: warning
annotations:
  summary: "High rate of risk rejections"
  description: "Risk engine has rejected more than 50 RFQs/Executions in the last minute."
```

### 2. Reconciliation Discrepancy
Triggers if the background reconciliation job finds any mismatch between Postgres and Redis.
```yaml
alert: RiskExposureMismatch
expr: risk_reconcile_mismatches_total > 0
for: 0m
labels:
  severity: critical
annotations:
  summary: "Risk exposure mismatch detected"
  description: "Authoritative Postgres state differs from rolling Redis counters. Manual investigation or auto-fix required."
```

### 3. Stalled Reservations
Triggers if there are active risk reservations held for too long, suggesting failed executions that didn't clean up their locks.
```yaml
alert: StalledRiskReservations
expr: risk_reservations_active > 10
for: 5m
labels:
  severity: warning
annotations:
  summary: "Stalled risk reservations"
  description: "More than 10 risk reservations have been active for over 5 minutes."
```

## Recommended Grafana Panels

### 1. Exposure by Market
- **Type**: Bar Gauge / Pie Chart
- **Query**: `sum by (market_id) (risk_exposure_current)`
- **Goal**: Monitor which markets are nearing their global or per-market notional caps.

### 2. Top Users by Notional
- **Type**: Table / Bar Chart
- **Query**: `topk(10, sum by (user_id) (risk_exposure_current))`
- **Goal**: Identify heavy hitters and monitor user-level cap utilization.

### 3. Reservation Trend
- **Type**: Time Series
- **Query**: `risk_reservations_active`
- **Goal**: Visualize the lifecycle of RFQ acceptances and identify spikes in concurrent execution attempts.

### 4. Risk Latency (P99)
- **Type**: Time Series
- **Query**: `histogram_quantile(0.99, sum(rate(risk_validation_latency_ms_bucket[5m])) by (le))`
- **Goal**: Ensure the risk engine is not introducing significant overhead to the RFQ lifecycle.
