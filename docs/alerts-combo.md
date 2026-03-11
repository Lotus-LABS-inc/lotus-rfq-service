# Combo RFQ Engine Alerting and Monitoring

This document defines recommended alert conditions for the combo / multi-leg RFQ engine.

## 1. Combo Execution Failure Spike

```yaml
alert: ComboExecutionFailureSpike
expr: sum(increase(combo_execution_failure_total[5m])) > 10
for: 5m
labels:
  severity: critical
annotations:
  summary: "Combo execution failure spike"
  description: "Combo execution failures exceeded threshold over the last 5 minutes."
```

## 2. Combo Quote Drought

```yaml
alert: ComboQuoteDrought
expr: increase(combo_created_total[5m]) > 10 and sum(increase(combo_quote_received_total[5m])) == 0
for: 5m
labels:
  severity: warning
annotations:
  summary: "Combo RFQs created without quote flow"
  description: "Combo creation is active but no normalized LP combo quotes are being received."
```

## 3. Partial Fill Surge

```yaml
alert: ComboPartialFillSurge
expr: increase(combo_partial_fill_total[15m]) > 20
for: 10m
labels:
  severity: warning
annotations:
  summary: "Combo partial fills surged"
  description: "Combo residual routing or liquidity quality may be degrading."
```

## 4. Combo Execution Latency P95

```yaml
alert: ComboExecutionLatencyP95High
expr: histogram_quantile(0.95, sum(rate(combo_execution_duration_ms_bucket[5m])) by (le, acceptance_policy)) > 3000
for: 10m
labels:
  severity: warning
annotations:
  summary: "Combo execution P95 latency high"
  description: "Combo execution duration P95 exceeded 3 seconds."
```

## Operator Actions

1. Inspect combo session state with `GET /admin/combo/:id`.
2. Check whether failures are policy-specific using `acceptance_policy` labels.
3. Correlate `combo_partial_fill_total` with residual external routing and internal execution layers.
4. Use `docs/runbooks/combo-runbook.md` for stuck reservations and replay decisions.
