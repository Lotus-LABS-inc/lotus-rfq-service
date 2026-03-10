# Internal Netting Alerts

Phase 2A alert set for multi-leg internal netting rollout and canary operations.

## Kill Switch Active

```yaml
alert: ComboInternalNetKillSwitchActive
expr: increase(combo_internal_net_kill_switch_total[5m]) > 0
for: 2m
labels:
  severity: critical
```

## Shadow Divergence Spike

```yaml
alert: ComboInternalNetShadowDivergenceSpike
expr: sum(increase(combo_internal_net_shadow_divergence_total[15m])) > 5
for: 10m
labels:
  severity: warning
```

## Replay Or Duplicate Anomaly

```yaml
alert: ComboInternalNetReplayAnomaly
expr: increase(combo_internal_net_shadow_divergence_total{reason="error"}[15m]) > 0
for: 5m
labels:
  severity: critical
```

## Residual Or Exposure Mismatch

```yaml
alert: ComboInternalNetResidualMismatch
expr: increase(combo_internal_net_shadow_divergence_total{reason="different_residual_size"}[15m]) > 3
for: 10m
labels:
  severity: warning
```

## Canary Error Or Divergence Threshold

```yaml
alert: ComboInternalNetCanaryDivergenceHigh
expr: sum(rate(combo_internal_net_shadow_divergence_total[5m])) / clamp_min(sum(rate(combo_internal_net_shadow_total{sampled="true"}[5m])), 1) > 0.1
for: 10m
labels:
  severity: critical
```

## Operator Actions

1. Check `internal_netting:kill_switch`.
2. Verify `combo_internal_net_attempt_total`, `combo_internal_net_success_total`, and `combo_internal_net_partial_total`.
3. Inspect recent `combo_netting_attempts` and `combo_netting_groups`.
4. Inspect `exposure_journal` rows with `source='combo-internal-net'`.
5. If divergence persists, disable canary first, then shadow if required.
