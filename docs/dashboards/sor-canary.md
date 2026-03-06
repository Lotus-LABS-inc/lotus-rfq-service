# SOR Canary Dashboard (PromQL)

## Scope
Compare SOR shadow decisions with legacy authoritative decisions during the 2-week canary rollout.

## Panels

1. Shadow Coverage Rate
```promql
sum(rate(sor_shadow_total{sampled="true"}[5m])) / clamp_min(sum(rate(sor_shadow_total[5m])), 1)
```

2. Decision Match Rate
```promql
sum(rate(sor_shadow_match_total[5m])) / clamp_min(sum(rate(sor_shadow_total{sampled="true"}[5m])), 1)
```

3. Divergence By Reason
```promql
sum by (reason) (increase(sor_shadow_divergence_total[15m]))
```

4. Price Delta P50/P95/P99 (bps)
```promql
histogram_quantile(0.50, sum(rate(sor_shadow_price_delta_bps_bucket[5m])) by (le))
```
```promql
histogram_quantile(0.95, sum(rate(sor_shadow_price_delta_bps_bucket[5m])) by (le))
```
```promql
histogram_quantile(0.99, sum(rate(sor_shadow_price_delta_bps_bucket[5m])) by (le))
```

5. Shadow Comparator Error Rate
```promql
sum(rate(sor_shadow_divergence_total{reason="error"}[5m])) / clamp_min(sum(rate(sor_shadow_total{sampled="true"}[5m])), 1)
```

6. Authoritative Path Split (Legacy vs SOR)
```promql
sum(rate(sor_shadow_total{mode="legacy_authoritative"}[5m]))
```
```promql
sum(rate(sor_shadow_total{mode="sor_authoritative"}[5m]))
```

## Rollout Checklist (2 weeks)
1. Day 1-3: set `SOR_CANARY_PERCENT=0.01`.
2. Day 4-7: set `SOR_CANARY_PERCENT=0.05` only if:
   - error rate < 1%
   - decision match trend stable
3. Day 8-14: set `SOR_CANARY_PERCENT=0.10` only if:
   - p95 price delta within desk threshold
   - no sustained divergence spikes

## Promotion Criteria
- Stable comparator error rate.
- Divergence reasons understood and accepted by execution/risk teams.
- No incident-level regressions in settle/fail outcomes.

## Rollback Criteria
- Flip `SOR_ENABLED=false`.
- Flip `SOR_CANARY_SHADOW_ENABLED=false`.
- Keep collecting legacy metrics and investigate `SOR_CANARY_DECISION` events.

