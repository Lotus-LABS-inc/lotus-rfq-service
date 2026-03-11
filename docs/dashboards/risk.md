# Risk Engine Dashboard

This dashboard covers the pre-trade risk and exposure engine.

## Panels

### 1. Risk Rejection Rate
- Metric: `risk_validation_rejected_total`
- Breakdown: `reason`
- Goal: detect rising rejection pressure or bad client/request behavior

### 2. Active Reservations
- Metric: `risk_reservations_active`
- Type: Time series
- Goal: detect stuck reservations or execution backlog

### 3. Risk Validation Latency P95/P99
- Metric: `risk_validation_latency_ms`
- Type: Histogram quantile
- Goal: ensure the risk engine is not becoming the RFQ bottleneck

### 4. Current Exposure by User / Market / Side
- Metric: `risk_exposure_current`
- Breakdown: `user_id`, `market_id`, `side`
- Goal: inspect live exposure concentration

### 5. Total Gross and Net Exposure
- Metrics:
  - `risk_total_gross_exposure`
  - `risk_total_net_exposure`
- Type: Time series
- Goal: track total portfolio pressure

### 6. Reconciliation Drift
- Metrics:
  - `risk_reconcile_mismatches_total`
  - `risk_reconciliation_diff_total`
- Goal: detect Postgres vs Redis exposure divergence

### 7. Admin Risk Actions
- Metric: `admin_risk_actions_total`
- Breakdown: `action`
- Goal: audit operational intervention frequency

## Interpretation

- rising `risk_reservations_active` with stable RFQ intake suggests cleanup failure or downstream execution delays
- non-zero reconciliation drift should be treated as a hard operational concern
- use with `docs/runbooks/risk-engine-runbook.md` and `docs/alerts-risk.md`
