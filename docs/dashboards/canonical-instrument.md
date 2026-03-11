# Canonical Instrument Dashboard

This dashboard covers the canonical instrument dependency and its direct RFQ intake footprint.

## Panels

### 1. RFQ Creation Rate
- Metric: `rfq_created_total`
- Type: Time series
- Goal: monitor intake health and detect stalls

### 2. Active RFQ Sessions
- Metric: `active_rfq_sessions`
- Type: Time series
- Goal: detect backlog growth when canonical or downstream dependencies are degraded

### 3. Quote Receipt Rate
- Metric: `quote_received_total`
- Type: Time series
- Goal: compare RFQ creation against actual quote flow

### 4. Execution Success vs Failure
- Metrics:
  - `execution_success_total`
  - `execution_failure_total`
- Type: Stacked time series
- Goal: detect canonical-backed execution degradation

### 5. WebSocket Client Load
- Metric: `ws_connections_active`
- Type: Time series
- Goal: correlate intake pressure with RFQ session growth

## Interpretation

- rising `rfq_created_total` with flat `quote_received_total` suggests downstream quote or canonical dependency issues
- rising `active_rfq_sessions` with elevated `execution_failure_total` suggests intake is working but lifecycle completion is degrading
- use this dashboard with the canonical runbook before escalating to risk or routing operators
