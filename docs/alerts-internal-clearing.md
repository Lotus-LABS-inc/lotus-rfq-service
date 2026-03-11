# Internal Clearing Alerts

Phase 2B alert set for constrained multi-party internal clearing rollout, canary progression, and limited-prod operation.

Runtime metrics cover live clearing behavior. Planner determinism and Redis rebuild consistency are validated through the bounded stress and rollout-validation suites:

- `npm run stress:internal-clearing`
- `npx vitest run test/integration/internal-clearing-rollout-validation.integration.test.ts --maxWorkers=1`

## Kill Switch Active

```yaml
alert: ComboInternalClearingKillSwitchActive
expr: increase(combo_internal_clearing_kill_switch_total[5m]) > 0
for: 2m
labels:
  severity: critical
```

## Shadow Divergence Spike

```yaml
alert: ComboInternalClearingShadowDivergenceSpike
expr: sum(increase(combo_internal_clearing_shadow_divergence_total[15m])) > 5
for: 10m
labels:
  severity: warning
```

## Planner Or Executor Failure Spike

```yaml
alert: ComboInternalClearingFailureSpike
expr: sum(rate(combo_execution_failure_total{reason="exception"}[5m])) > 0.05
for: 10m
labels:
  severity: critical
```

## Planner Determinism Regression

This is a validation gate, not a live Prometheus metric. Treat any failure in:

- `npm run stress:internal-clearing`
- `test/integration/internal-clearing-rollout-validation.integration.test.ts`

as a hard rollout stop because it means repeated reads of the same bucket snapshot are no longer selecting the same round plan.

## Duplicate Or Replay Anomaly

```yaml
alert: ComboInternalClearingReplayAnomaly
expr: increase(combo_internal_clearing_shadow_divergence_total{reason="error"}[15m]) > 0
for: 5m
labels:
  severity: critical
```

## Residual Or Exposure Mismatch

```yaml
alert: ComboInternalClearingResidualMismatch
expr: increase(combo_internal_clearing_shadow_divergence_total{reason="different_residual_size"}[15m]) > 3
for: 10m
labels:
  severity: warning
```

## Redis Bucket Drift Or Rebuild Mismatch

This is validated operationally from authoritative Postgres residuals.

Trigger operator investigation when:
- admin reconcile reports `REDIS_BUCKET_MISMATCH`
- the rollout-validation or stress harness reports rebuild inconsistency

Operator action:
1. stop relying on Redis bucket state for the affected entities
2. rebuild from Postgres using `ResidualVectorBuilder` + `Phase2BCandidateRegistry`
3. confirm rebuilt `clearing:bucket:{bucketId}` and `clearing:entity:{entityId}` keys match authoritative residual truth

## Residual Routed Externally Above Threshold

```yaml
alert: ComboInternalClearingResidualRoutedHigh
expr: sum(rate(clearing_residual_routed_total[15m])) > 0.25
for: 15m
labels:
  severity: warning
```

## Canary Error Or Divergence Threshold

```yaml
alert: ComboInternalClearingCanaryDivergenceHigh
expr: sum(rate(combo_internal_clearing_shadow_divergence_total[5m])) / clamp_min(sum(rate(combo_internal_clearing_shadow_total{sampled="true"}[5m])), 1) > 0.1
for: 10m
labels:
  severity: critical
```

## Operator Actions

1. Check `internal_clearing:kill_switch`.
2. Verify `clearing_round_attempts_total`, `clearing_round_success_total`, `clearing_round_partial_total`, and `clearing_residual_routed_total`.
3. Inspect `combo_internal_clearing_shadow_total`, `combo_internal_clearing_shadow_match_total`, and `combo_internal_clearing_shadow_divergence_total`.
4. Inspect recent `clearing_rounds`, `clearing_round_participants`, `clearing_round_leg_matches`, and `clearing_round_events`.
5. Inspect `exposure_journal` rows with `source='combo-multi-party-clearing'`.
6. If residual-routed volume spikes or drift anomalies appear, rebuild Redis bucket state from Postgres before re-enabling canary.
7. If canary divergence persists, disable canary first, then enable the kill switch if required.
