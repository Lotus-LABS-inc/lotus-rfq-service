# Internal Cross Alerts

## Purpose
These alerts cover Phase 1 internal crossing health, Redis/Postgres divergence, and rollout controls.

## Alerts

### Kill Switch Active
```yaml
alert: InternalCrossKillSwitchActive
expr: increase(internal_cross_kill_switch_total[5m]) > 0
for: 1m
labels:
  severity: warning
```

### Duplicate Trade Anomaly
```yaml
alert: InternalCrossDuplicateTradeAnomaly
expr: increase(internal_cross_shadow_divergence_total{reason="duplicate_trade"}[5m]) > 0
for: 2m
labels:
  severity: critical
```

### Rebuild Discrepancy Spike
```yaml
alert: InternalCrossRebuildDiscrepancySpike
expr: increase(internal_cross_rebuild_discrepancy_total[15m]) > 10
for: 5m
labels:
  severity: warning
```

### Exposure Journal Mismatch Rate
```yaml
alert: InternalCrossExposureMismatch
expr: increase(internal_cross_shadow_divergence_total{reason="exposure_mismatch"}[15m]) > 0
for: 5m
labels:
  severity: critical
```

### Redis/Postgres Divergence
```yaml
alert: InternalCrossRedisPostgresDivergence
expr: increase(internal_cross_rebuild_discrepancy_total{discrepancy_type=~"missing_snapshot|stale_snapshot"}[15m]) > 5
for: 5m
labels:
  severity: warning
```

## Operator Actions
1. Check `internal_cross:kill_switch`.
2. Run `npm run rebuild:internal-cross-book -- --dry-run`.
3. Inspect affected trades and orders through the internal-cross admin routes.
4. If reservations may be leaked, verify `pre-exec-reserve` journal rows and clear only through risk-engine semantics.
