# Phase 3A Alerts

## Scope
These alerts cover deterministic replay, control-plane operator actions, degradation activation, guardrail violations, and reconciliation integrity for Phase 3A.

## Critical Alerts

### Replay Errors
- metric: `replay_error_total`
- trigger: any sustained increase over `15m`
- severity: critical
- response:
  - inspect `/admin/replay/envelope/:id`
  - run exact replay on affected envelopes
  - check for correlated control-plane degradations or replay write failures

### Replay Missing
- metric: `replay_missing_total`
- trigger: any non-zero increase over `15m`
- severity: critical
- response:
  - run `ReconciliationV2`
  - inspect envelope metadata for the referenced decision type
  - verify replay capture mode and replay writer health

### Repeated Degradation Activation
- metric: `degraded_mode_activations_total`
- trigger: sustained increase over `10m`, especially for:
  - `SAFE_FALLBACK`
  - `DISABLE_PHASE2A_AND_2B`
  - `DISABLE_PHASE2B`
- severity: critical
- response:
  - inspect shard and bucket state via `/admin/control-plane/...`
  - confirm if the degradation is override-driven or guardrail-driven
  - escalate if degradation persists outside an approved maintenance window

### Phase 3A Shadow Divergence
- metric: `phase3a_guardrail_shadow_divergence_total`
- trigger: sustained increase above approved baseline over `15m`
- severity: critical
- response:
  - inspect `GET /admin/control-plane/guardrail-shadow` for the affected scope
  - confirm whether the divergence is expected from the active rollout window
  - force `ENFORCED` override or disable env shadow rollout if divergence is unexplained

### Sustained Reconciliation Mismatch
- metric: `reconciliation_mismatch_total`
- trigger: sustained non-zero increase over `15m`
- severity: critical
- response:
  - inspect discrepancy `domain`, `code`, and `severity`
  - run reconciliation in `dryRun`
  - apply Redis-only fixes only if approved

### Reconciliation Infrastructure Errors
- metric: `reconciliation_v2_infra_error_total`
- trigger: any sustained increase over `15m`
- severity: critical
- response:
  - stop further reconciliation runs
  - inspect Redis and Postgres connectivity
  - confirm whether failure occurred during lock, scan, or query activity
  - rerun only after infrastructure health is restored

### Kill Switch Active Outside Approved Window
- key/state:
  - `resolution_risk:kill_switch`
  - any relevant control-plane kill switch present beyond maintenance window
- trigger: key present or state persisted longer than expected
- severity: critical
- response:
  - confirm whether recomputation freeze was operator-intended
  - escalate through the Phase 3A runbook if not planned

## Warning Alerts

### Replay Diffs Above Baseline
- metric: `replay_diff_total`
- trigger: sustained increase over `15m` above the normal shadow / upgrade baseline
- severity: warning
- response:
  - inspect diff replay output
  - classify whether changes are expected from config or engine-version rollout

### Planner Shard Paused Outside Maintenance
- metric: `planner_shard_paused_total`
- trigger: any increase outside approved maintenance window
- severity: warning
- response:
  - inspect shard mode
  - confirm who paused it and why

### Bucket Drained Outside Maintenance
- metric: `bucket_drained_total`
- trigger: any increase outside approved maintenance window
- severity: warning
- response:
  - inspect bucket state and degradation reason
  - verify if drain was operator-driven or a follow-on operational response

### Planner Latency Budget Violations
- metric: `planner_latency_budget_exceeded_total`
- trigger: sustained non-zero rate over `10m`
- severity: warning
- response:
  - inspect planner type / engine labels
  - correlate with degradation activations and latency histograms

### Bucket Size Limit Violations
- metric: `bucket_size_limit_exceeded_total`
- trigger: sustained non-zero rate over `10m`
- severity: warning
- response:
  - inspect bucket cardinality growth
  - confirm whether degradation to `DISABLE_PHASE2B` or similar occurred

### Graph Density Limit Violations
- metric: `graph_density_limit_exceeded_total`
- trigger: sustained non-zero rate over `10m`
- severity: warning
- response:
  - inspect Phase 2B candidate graph pressure
  - correlate with clearing planner disablement

### Lock Wait Limit Violations
- metric: `lock_wait_limit_exceeded_total`
- trigger: sustained non-zero rate over `10m`
- severity: warning
- response:
  - inspect lock contention
  - confirm whether Phase 2A/2B degradation was activated

### Reconciliation Lock Conflicts
- metric: `reconciliation_v2_lock_conflict_total`
- trigger: repeated increase over `15m`
- severity: warning
- response:
  - confirm whether another reconciliation run is already active
  - avoid overlapping `dryRun` and `autoFix` attempts
  - inspect operator scheduling before retrying

### Phase 3A Shadow Would-Degrade Concentration
- metric: `phase3a_guardrail_shadow_would_degrade_total`
- trigger: sustained increase for one engine outside an injected proof or planned rollout window
- severity: warning
- response:
  - inspect the affected engine scope via `/admin/control-plane/guardrail-shadow`
  - confirm whether the guardrail pressure is expected
  - rollback the shadow rollout if the concentration is unexplained

## Step 19 Validation Stop Conditions

### Same-Version Replay Diff During Proof
- metric: `replay_diff_total`
- trigger: any non-zero increase during the Step 19 same-version proof window
- severity: critical
- response:
  - stop the proof run immediately
  - inspect the affected envelope with exact replay metadata and diff output
  - do not promote Step 19 until the deterministic mismatch is classified and resolved

### Replay Write Failure During Proof
- metric: `replay_write_failures_total`
- trigger: any sustained increase during the Step 19 proof window
- severity: critical
- response:
  - stop the proof run
  - inspect replay writer health and storage connectivity
  - rerun only after the writer path is clean

### Safe Fallback Outside Injected Scenario Window
- metric: `degraded_mode_activations_total{mode="SAFE_FALLBACK"}`
- trigger: sustained increase outside the injected guardrail scenario window
- severity: warning
- response:
  - inspect the affected engine and shard
  - confirm whether the activation was part of the controlled proof
  - escalate to critical if it persists after the proof window ends

### Phase 3A Shadow Divergence During Rollout
- metric: `phase3a_guardrail_shadow_divergence_total`
- trigger: any non-baseline increase during the Step 20 rollout validation window
- severity: critical
- response:
  - stop widening the rollout immediately
  - inspect the effective mode, matched override, and shadow source through `/admin/control-plane/guardrail-shadow`
  - roll back by env disable or forcing `ENFORCED` on the affected scope

## Operational Notes
- `replay_envelopes_written_total` is the baseline success counter for replay capture.
- `degraded_mode_activations_total` is the canonical transition counter for effective execution-mode changes.
- `guardrail_mode_transitions_total` complements degradation metrics and shows engine-level handling transitions.
- `phase3a_guardrail_shadow_resolution_total` is the canonical operator-visibility counter for live shadow resolution source and mode.
- Reconciliation alerts should be interpreted together with:
  - `reconciliation_v2_runs_total`
  - `reconciliation_v2_run_duration_ms`
  - `reconciliation_v2_lock_conflict_total`
  - `reconciliation_v2_infra_error_total`
  - `reconciliation_v2_fixes_total`
- Use [phase3a-replay-control-plane-runbook.md](c:/Users/Admin/Documents/lotus-RFQ-service/lotus-rfq-service/docs/runbooks/phase3a-replay-control-plane-runbook.md) for escalation, replay, pause/drain, and degradation procedures.
