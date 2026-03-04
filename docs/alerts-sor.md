# SOR Alerting and Monitoring

This document defines recommended Prometheus alerts for Smart Order Router (SOR) operations.

## 1) Plan Unwind Burst

```yaml
alert: SORPlanUnwindBurst
expr: increase(sor_plan_unwind_total[5m]) > 5
for: 2m
labels:
  severity: critical
annotations:
  summary: "SOR unwind burst detected"
  description: "SOR generated more than 5 unwind events in 5 minutes."
```

## 2) Low Average Fill Rate (5m)

This is a plan-level success proxy (not exact per-step fill in the current model).

```yaml
alert: SORLowFillRate
expr: (sum(increase(sor_plan_success_total[5m])) / (sum(increase(sor_plan_success_total[5m])) + sum(increase(sor_plan_failure_total[5m])))) < 0.85
for: 5m
labels:
  severity: warning
annotations:
  summary: "SOR average fill rate degraded"
  description: "Plan-level fill proxy is below 85% over the last 5 minutes."
```

## 3) Plan Build Latency P95

```yaml
alert: SORPlanBuildLatencyP95High
expr: histogram_quantile(0.95, sum(rate(sor_plan_build_latency_ms_bucket[5m])) by (le)) > 300
for: 5m
labels:
  severity: warning
annotations:
  summary: "SOR plan build P95 latency high"
  description: "P95 plan build latency exceeded 300ms."
```

## Troubleshooting Actions

1. Inspect `ROUTE_UNWIND_REQUIRED` frequency and recent `route_history` events for impacted plans.
2. Correlate `sor_step_retries_total` and `sor_step_fallback_total` spikes by provider labels.
3. Validate canonical service, Redis, and Postgres latency during the alert window.
4. Check `sor_plan_build_latency_ms` percentiles alongside candidate volumes to isolate routing bottlenecks.
