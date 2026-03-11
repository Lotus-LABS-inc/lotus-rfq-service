# Combo RFQ Engine Dashboard

This dashboard covers the multi-leg / combo RFQ engine from intake through execution.

## Panels

### 1. Combo Creation Rate
- Metric: `combo_created_total`
- Breakdown: `acceptance_policy`
- Goal: track combo RFQ intake by policy

### 2. Combo Quote Receipt Rate
- Metric: `combo_quote_received_total`
- Breakdown: `lp_id`, `is_combo_quote`
- Goal: monitor quote flow and normalization health

### 3. Combo Success vs Failure
- Metrics:
  - `combo_execution_success_total`
  - `combo_execution_failure_total`
- Breakdown: `acceptance_policy`
- Goal: detect policy-specific execution degradation

### 4. Combo Partial Fill Volume
- Metric: `combo_partial_fill_total`
- Type: Time series
- Goal: detect rising residual-routing pressure

### 5. Combo Execution Duration P95
- Metric: `combo_execution_duration_ms`
- Breakdown: `acceptance_policy`
- Goal: measure end-to-end combo execution latency

### 6. Combo Price Compute Latency
- Metric: `combo_price_compute_ms`
- Type: Time series
- Goal: detect pricing-engine slowdowns

### 7. Internal Net / Residual Routing
- Metrics:
  - `combo_internal_net_attempt_total`
  - `combo_internal_net_success_total`
  - `combo_internal_net_partial_total`
  - `combo_internal_net_residual_routed_total`
- Goal: track how much combo flow completes internally vs externally

## Interpretation

- a widening gap between `combo_created_total` and `combo_quote_received_total` indicates intake is ahead of pricing/liquidity response
- rising `combo_partial_fill_total` with rising `combo_execution_failure_total` indicates degraded residual execution quality
- use alongside the combo runbook and internal execution checklists for deeper incident response
