# Phase 3B Grafana Panels

## Qualification Writes
- Panel:
  - `qualification_evaluations_written_total` by `decision_type`, `strategy_key`, `mode`
- Use:
  - confirm shadow and canary windows are producing evidence
  - spot per-domain qualification dropouts quickly

## Shadow Diffs
- Panel:
  - `shadow_decision_diff_total` by `decision_type`, `reason`
- Use:
  - identify which alternate config or version change is diverging
  - distinguish route, grouping, threshold, crossing, netting, and clearing divergence causes

## Promotion Gate Failures
- Panel:
  - `promotion_gate_fail_total` by `stage`, `gate`
- Use:
  - show repeated replay, reconciliation, latency, economics, incident, or adverse-selection gate failures

## Auto Safety Actions
- Panels:
  - `auto_safety_actions_created_total` by `action_type`, `trigger_reason`, `scope_type`
  - `auto_safety_actions_resolved_total` by `action_type`, `scope_type`
- Manual companion panel:
  - unresolved actions from `auto_safety_actions` via SQL-backed table panel
- Use:
  - track safety action churn
  - verify operator resolution throughput
  - correlate unresolved actions with blocked promotions or canary pauses

## Rollup Refresh
- Panels:
  - `qualification_rollup_refresh_total` by `status`
  - `qualification_rollup_refresh_duration_ms`
- Use:
  - confirm the materialized view refresh path is healthy
  - correlate stale rollup evidence with promotion failures

## Qualification Rollups
- SQL or derived panel sources:
  - `qualification_metrics_rollup`
- Panels:
  - `internalization_rate`
  - `compression_ratio`
  - `fee_savings_total`
  - `slippage_savings_total`
  - `fill_quality_delta`
  - `adverse_selection_indicator`
  - `promotion_readiness_score`
- Group by:
  - `strategy_key`
  - `scope_type`
  - `scope_id`
  - `stage`
  - `engine_version`
  - `config_version`
  - `market`
  - `venue_pair`

## Suggested Dashboard Rows
- Row 1:
  - qualification write rate
  - shadow divergence rate
  - promotion gate failures
- Row 2:
  - safety action creations
  - safety action resolutions
  - unresolved action SQL table
- Row 3:
  - rollup refresh success and duration
  - promotion readiness score by strategy and scope
- Row 4:
  - internalization rate
  - compression ratio
  - fee savings
  - slippage savings
  - fill quality delta
  - adverse selection indicator
