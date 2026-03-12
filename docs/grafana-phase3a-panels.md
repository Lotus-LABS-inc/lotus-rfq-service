# Phase 3A Grafana Panels

## Scope
Recommended dashboard panels for deterministic replay, control-plane state, guardrail pressure, and reconciliation outcomes.

## Replay

### Replay Envelopes Written
```promql
sum by (decision_type, mode) (increase(replay_envelopes_written_total[15m]))
```

### Step 19 Replay Envelope Writes By Decision Type
```promql
sum by (decision_type) (increase(replay_envelopes_written_total[15m]))
```

### Replay Outcomes
```promql
sum by (decision_type) (increase(replay_exact_match_total[15m]))
```
```promql
sum by (decision_type) (increase(replay_diff_total[15m]))
```
```promql
sum by (decision_type) (increase(replay_error_total[15m]))
```

### Replay Outcome Ratio by Decision Type
```promql
sum by (decision_type) (increase(replay_exact_match_total[15m]))
/
clamp_min(
  sum by (decision_type) (
    increase(replay_exact_match_total[15m])
    + increase(replay_diff_total[15m])
    + increase(replay_error_total[15m])
  ),
  1
)
```

### Replay Missing by Decision Type
```promql
sum by (decision_type) (increase(replay_missing_total[15m]))
```

## Control Plane

### Planner Shard Paused
```promql
sum(increase(planner_shard_paused_total[15m]))
```

### Bucket Drained
```promql
sum(increase(bucket_drained_total[15m]))
```

### Degraded Mode Activations by Mode and Engine
```promql
sum by (mode, engine, source) (increase(degraded_mode_activations_total[15m]))
```

### Guardrail Mode Transitions
```promql
sum by (engine, mode, reason) (increase(guardrail_mode_transitions_total[15m]))
```

### Phase 3A Shadow Resolution By Engine / Source / Mode
```promql
sum by (engine, source, enforcement_mode) (increase(phase3a_guardrail_shadow_resolution_total[15m]))
```

## Guardrails

### Planner Latency Budget Exceeded
```promql
sum by (engine, planner_type) (increase(planner_latency_budget_exceeded_total[15m]))
```

### Bucket Size Limit Exceeded
```promql
sum by (engine, planner_type) (increase(bucket_size_limit_exceeded_total[15m]))
```

### Graph Density Limit Exceeded
```promql
sum by (engine, planner_type) (increase(graph_density_limit_exceeded_total[15m]))
```

### Lock Wait Limit Exceeded
```promql
sum by (engine, planner_type) (increase(lock_wait_limit_exceeded_total[15m]))
```

### Phase 3A Shadow Evaluations
```promql
sum by (engine, mode) (increase(phase3a_guardrail_shadow_total[15m]))
```

### Phase 3A Shadow Would-Degrade
```promql
sum by (engine, mode) (increase(phase3a_guardrail_shadow_would_degrade_total[15m]))
```

### Phase 3A Shadow Divergence
```promql
sum by (engine, reason) (increase(phase3a_guardrail_shadow_divergence_total[15m]))
```

## Reconciliation

### Reconciliation Runs by Status
```promql
sum by (status, dry_run) (increase(reconciliation_v2_runs_total[15m]))
```

### Reconciliation Run Duration
```promql
histogram_quantile(0.95, sum(rate(reconciliation_v2_run_duration_ms_bucket[15m])) by (le))
```

### Reconciliation Mismatches by Domain / Code / Severity
```promql
sum by (domain, code, severity) (increase(reconciliation_mismatch_total[15m]))
```

### Reconciliation Lock Conflicts
```promql
sum(increase(reconciliation_v2_lock_conflict_total[15m]))
```

### Reconciliation Infrastructure Errors
```promql
sum by (domain, operation) (increase(reconciliation_v2_infra_error_total[15m]))
```

### Step 19 Validation Overview
```promql
sum by (decision_type) (increase(replay_exact_match_total[15m]))
```
```promql
sum by (decision_type) (increase(replay_diff_total[15m]))
```
```promql
sum by (decision_type) (increase(replay_error_total[15m]))
```
```promql
sum by (engine, mode, source) (increase(degraded_mode_activations_total[15m]))
```
```promql
sum by (engine, source, enforcement_mode) (increase(phase3a_guardrail_shadow_resolution_total[15m]))
```
```promql
sum by (engine, mode) (increase(phase3a_guardrail_shadow_total[15m]))
```
```promql
sum by (engine, reason) (increase(phase3a_guardrail_shadow_divergence_total[15m]))
```
```promql
sum(increase(planner_shard_paused_total[15m]))
```
```promql
sum(increase(bucket_drained_total[15m]))
```
```promql
histogram_quantile(0.95, sum(rate(reconciliation_v2_run_duration_ms_bucket[15m])) by (le))
```
```promql
sum(increase(reconciliation_v2_lock_conflict_total[15m]))
```
```promql
sum by (domain, operation) (increase(reconciliation_v2_infra_error_total[15m]))
```

### Reconciliation Fix Attempts
```promql
sum by (domain, code, result) (increase(reconciliation_v2_fixes_total[15m]))
```

## Drill-Down Panels

### Top Degraded Engines
```promql
topk(10, sum by (engine) (increase(degraded_mode_activations_total[1h])))
```

### Top Mismatch Domains
```promql
topk(10, sum by (domain) (increase(reconciliation_mismatch_total[1h])))
```

### Replay Diff / Error by Decision Type
```promql
sum by (decision_type) (increase(replay_diff_total[1h]))
```
```promql
sum by (decision_type) (increase(replay_error_total[1h]))
```

## Notes
- Pair this dashboard with the control-plane state endpoints:
  - `/admin/control-plane/shards`
  - `/admin/control-plane/buckets`
  - `/admin/control-plane/overrides`
  - `/admin/control-plane/guardrail-shadow`
  - `/admin/control-plane/replay/:envelopeId`
- Use [phase3a-replay-control-plane-runbook.md](c:/Users/Admin/Documents/lotus-RFQ-service/lotus-rfq-service/docs/runbooks/phase3a-replay-control-plane-runbook.md) for operational interpretation and escalation.
