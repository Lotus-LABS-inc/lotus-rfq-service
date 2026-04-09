# Grafana Dashboard: Combo RFQ Engine Panels

> Recommended panels for monitoring the Multi-Leg / Combo RFQ Engine in production.
> All queries assume Prometheus data source. Time range: last 1h, refresh: 10s.

---

## 1. Live Combos by State

**Panel type**: Stat / Time Series

Useful to quickly see how many combos are currently active in each lifecycle state.
Since states are stored in Redis (not directly exported as a gauge), derive from counter deltas.

```promql
# Total created (baseline)
sum(combo_created_total) by (acceptance_policy)

# Total in terminal states (infer: in-flight = created - completed - failed)
sum(combo_execution_success_total) by (acceptance_policy)
sum(combo_execution_failure_total) by (acceptance_policy, reason)
sum(combo_partial_fill_total)
```

**Suggested display**: Multi-value stat bar with colour thresholds
- In-flight > 10 → yellow
- In-flight > 50 → red

---

## 2. Combo Success vs Failure Rate

**Panel type**: Time Series + Bar Gauge

```promql
# Success rate per minute
rate(combo_execution_success_total[1m])

# Failure rate per minute (breakdown by policy and reason)
rate(combo_execution_failure_total[1m]) by (acceptance_policy, reason)

# Success ratio (%)
(
  sum(rate(combo_execution_success_total[5m]))
  /
  (
    sum(rate(combo_execution_success_total[5m]))
    + sum(rate(combo_execution_failure_total[5m]))
  )
) * 100
```

**Alerting suggestion**: Alert when success ratio drops below 90% over a 5-minute window.

```yaml
# Prometheus alerting rule
- alert: ComboHighFailureRate
  expr: |
    (
      sum(rate(combo_execution_failure_total[5m]))
      /
      (sum(rate(combo_execution_success_total[5m])) + sum(rate(combo_execution_failure_total[5m])))
    ) > 0.10
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Combo execution failure rate exceeds 10%"
    description: "{{ $value | humanizePercentage }} of combo executions are failing."
```

---

## 3. Partial Fills Over Time

**Panel type**: Time Series

Track partial fill events to detect policy degradation or connector reliability issues.

```promql
# Partial fills per minute
rate(combo_partial_fill_total[1m])

# Unwind attempts (broken down by outcome)
rate(combo_unwind_attempts_total[1m]) by (outcome)
```

**Interpretation**:
- Rising `outcome="failed"` unwound legs → connector cancel API is degrading
- Rising `outcome="success"` → more ALL_OR_NONE combos are hitting partial fills (LP reliability issue)

---

## 4. Combo Quote Throughput

**Panel type**: Time Series

```promql
# LP quotes received per second
rate(combo_quote_received_total[1m]) by (lp_id, is_combo_quote)
```

**Interpretation**: Sudden drop from a specific LP → LP reliability event or connectivity issue.

---

## 5. Execution Latency Distribution

**Panel type**: Heatmap / Histogram

```promql
# P50 combo execution duration
histogram_quantile(0.50, rate(combo_execution_duration_ms_bucket[5m]))

# P95
histogram_quantile(0.95, rate(combo_execution_duration_ms_bucket[5m]))

# P99
histogram_quantile(0.99, rate(combo_execution_duration_ms_bucket[5m]))

# Breakdown by acceptance policy
histogram_quantile(0.95,
  sum(rate(combo_execution_duration_ms_bucket[5m])) by (le, acceptance_policy)
) by (acceptance_policy)
```

**Alerting suggestion**: Alert when P95 exceeds 2000ms.

```yaml
- alert: ComboExecutionSlowP95
  expr: |
    histogram_quantile(0.95, sum(rate(combo_execution_duration_ms_bucket[5m])) by (le)) > 2000
  for: 3m
  labels:
    severity: warning
  annotations:
    summary: "Combo execution P95 latency is elevated (>2s)"
```

---

## 6. Price Computation Latency

**Panel type**: Gauge / Time Series

```promql
# Price compute P95
histogram_quantile(0.95, rate(combo_price_compute_ms_bucket[5m]))

# Quote ranking P95
histogram_quantile(0.95, rate(combo_ranking_duration_ms_bucket[5m]))
```

**Alerting suggestion**: Price compute exceeding 25ms in P99 may indicate a performance regression in the payout-vector algorithm.

---

## 7. Recommended Dashboard Layout

```
Row 1: [Live Combos by State] [Success vs Failure %] [Partial Fills / min]
Row 2: [Execution Latency P50/P95/P99 (line chart)]
Row 3: [Quote Throughput by LP] [Price Compute Latency] [Unwind Outcome Breakdown]
```

---

## OTEL Trace Integration (Jaeger / Tempo)

The following spans are emitted per combo lifecycle and can be queried in Jaeger or Grafana Tempo:

| Span Name              | Key Attributes                                              |
|------------------------|-------------------------------------------------------------|
| `combo.create`         | `combo.taker_id`, `combo.num_legs`, `combo.acceptance_policy`, `combo.theoretical_price` |
| `combo.rank`           | `combo.session_id`, `combo.lp_id`                          |
| `combo.build_plan`     | `combo.session_id`, `combo.reservation_token`, `combo.plan_id`, `combo.num_steps` |
| `combo.execute_plan`   | `combo.plan_id`, `combo.leg_id`, `combo.lp_id`             |

**Trace query example** (Tempo TraceQL):
```traceql
{ span.combo.acceptance_policy = "ALL_OR_NONE" && duration > 1s }
```

> [!TIP]
> Use `combo.session_id` as a correlation ID across all combo spans to reconstruct the full lifecycle trace for any given combo in Jaeger.

> [!NOTE]
> OTEL traces require a configured `TracerProvider` at application startup.
> See the [OpenTelemetry Node.js SDK docs](https://opentelemetry.io/docs/languages/js/) for setup.
