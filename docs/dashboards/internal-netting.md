# Internal Netting Dashboard

Operational dashboard for Phase 2A multi-leg internal netting shadow and canary rollout.

## Attempts / Success / Partial / Residual Routed

```promql
sum(rate(combo_internal_net_attempt_total[5m]))
sum(rate(combo_internal_net_success_total[5m]))
sum(rate(combo_internal_net_partial_total[5m]))
sum(rate(combo_internal_net_residual_routed_total[5m]))
```

## Kill Switch Suppressions

```promql
sum by (mode) (increase(combo_internal_net_kill_switch_total[15m]))
```

## Shadow Coverage

```promql
sum(rate(combo_internal_net_shadow_total{sampled="true"}[5m])) / clamp_min(sum(rate(combo_internal_net_shadow_total[5m])), 1)
```

## Shadow Match Rate

```promql
sum(rate(combo_internal_net_shadow_match_total[5m])) / clamp_min(sum(rate(combo_internal_net_shadow_total{sampled="true"}[5m])), 1)
```

## Shadow Divergence By Reason

```promql
sum by (reason) (increase(combo_internal_net_shadow_divergence_total[15m]))
```

## Netted Size Distribution

```promql
histogram_quantile(0.50, sum(rate(combo_internal_net_shadow_netted_size_bucket[5m])) by (le))
histogram_quantile(0.95, sum(rate(combo_internal_net_shadow_netted_size_bucket[5m])) by (le))
```

## Canary Authoritative Volume

```promql
sum(rate(combo_internal_net_attempt_total[5m]))
```

## Residual Leg Distribution

```promql
sum by (dimension) (increase(combo_internal_net_shadow_match_total[15m]))
sum by (reason) (increase(combo_internal_net_shadow_divergence_total{reason="different_residual_size"}[15m]))
```

## Failure / Retry Signals

```promql
sum(rate(combo_execution_failure_total{reason="execution_failed"}[5m]))
sum(rate(combo_execution_failure_total{reason="exception"}[5m]))
```
