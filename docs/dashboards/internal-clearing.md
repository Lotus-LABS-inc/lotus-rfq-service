# Internal Clearing Dashboard

Operational dashboard for Phase 2B constrained multi-party internal clearing shadow, canary, and limited-prod operation.

Live metrics cover runtime behavior. Deterministic planner selection, Redis rebuild consistency, and bounded-runtime validation come from:

- `npm run stress:internal-clearing`
- `test/integration/internal-clearing-rollout-validation.integration.test.ts`

## Attempts / Success / Partial / Residual Routed

```promql
sum(rate(clearing_round_attempts_total[5m]))
sum(rate(clearing_round_success_total[5m]))
sum(rate(clearing_round_partial_total[5m]))
sum(rate(clearing_residual_routed_total[5m]))
```

## Kill Switch Suppressions

```promql
sum by (mode) (increase(combo_internal_clearing_kill_switch_total[15m]))
```

## Shadow Coverage

```promql
sum(rate(combo_internal_clearing_shadow_total{sampled="true"}[5m])) / clamp_min(sum(rate(combo_internal_clearing_shadow_total[5m])), 1)
```

## Shadow Match Rate

```promql
sum(rate(combo_internal_clearing_shadow_match_total[5m])) / clamp_min(sum(rate(combo_internal_clearing_shadow_total{sampled="true"}[5m])), 1)
```

## Shadow Divergence By Reason

```promql
sum by (reason) (increase(combo_internal_clearing_shadow_divergence_total[15m]))
```

## Residual Routed Externally

```promql
sum(rate(clearing_residual_routed_total[5m]))
```

## Runtime Enablement State

```promql
combo_internal_clearing_enabled_state
```

## Canary Authoritative Volume

```promql
sum(rate(clearing_round_attempts_total[5m]))
```

## Residual Leg Distribution

```promql
sum by (dimension) (increase(combo_internal_clearing_shadow_match_total[15m]))
sum by (reason) (increase(combo_internal_clearing_shadow_divergence_total{reason="different_residual_size"}[15m]))
```

## Replay / No-Op Round Rate

```promql
sum(rate(combo_internal_clearing_shadow_divergence_total{reason="error"}[5m]))
```

## Executor Failure Signals

```promql
sum(rate(combo_execution_failure_total{reason="execution_failed"}[5m]))
sum(rate(combo_execution_failure_total{reason="exception"}[5m]))
```

## Validation Panels

Use the following non-Prometheus validation outputs during shadow, canary, and limited-prod gating:

- planner determinism from repeated planning over the same bucket snapshot
- duplicate-round count from `clearing_rounds`
- duplicate exposure count from `exposure_journal`
- Redis rebuild consistency after deliberate bucket drift
- bounded runtime for the configured stress profile
