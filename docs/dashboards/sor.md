# Smart Order Router Dashboard

This dashboard covers Smart Order Routing and partial-fill execution behavior.

## Panels

### 1. SOR Plan Build Latency P95
- Metric: `sor_plan_build_latency_ms`
- Breakdown: `acceptance_policy`
- Goal: detect routing build regressions

### 2. Plan Success vs Failure
- Metrics:
  - `sor_plan_success_total`
  - `sor_plan_failure_total`
- Breakdown: `status`, `reason`
- Goal: measure routing outcome quality

### 3. Candidates Evaluated
- Metric: `sor_candidates_evaluated_count`
- Type: Table / time series
- Goal: watch candidate-discovery breadth per RFQ

### 4. Average Splits Per Leg
- Metric: `sor_avg_splits_per_leg`
- Type: Table / time series
- Goal: monitor fragmentation pressure and routing complexity

### 5. Internal Cross Result Mix
- Metric: `sor_internal_cross_result_total`
- Breakdown: `status`
- Goal: compare internal execution assistance vs external-only routing

### 6. SOR Shadow / Canary Divergence
- Metrics:
  - `sor_shadow_total`
  - `sor_shadow_match_total`
  - `sor_shadow_divergence_total`
  - `sor_shadow_price_delta_bps`
- Goal: evaluate rollout safety and recommendation drift

### 7. Step Retry / Fallback / Unwind Signals
- Metrics:
  - `sor_step_retries_total`
  - `sor_step_fallback_total`
  - `sor_plan_unwind_total`
- Goal: detect execution fragility and provider instability

## Interpretation

- rising `sor_plan_build_latency_ms` with rising `sor_candidates_evaluated_count` indicates planning pressure rather than provider failure
- rising `sor_avg_splits_per_leg` with lower success rates suggests fragmented liquidity
- use this with `docs/runbooks/sor-runbook.md` and `docs/alerts-sor.md`
