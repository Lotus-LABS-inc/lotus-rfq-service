# Canonical Instrument Layer Alerting and Monitoring

This document defines recommended alert conditions and dashboards for the canonical instrument dependency used by RFQ creation and validation.

## 1. RFQ Creation Stalls

```yaml
alert: CanonicalRFQCreateStall
expr: increase(rfq_created_total[10m]) == 0
for: 10m
labels:
  severity: warning
annotations:
  summary: "RFQ creation stalled"
  description: "No RFQs were created for 10 minutes. Check canonical instrument dependency and RFQ intake path."
```

## 2. RFQ Session Backlog Growth

```yaml
alert: CanonicalRFQBacklogGrowth
expr: active_rfq_sessions > 250
for: 10m
labels:
  severity: warning
annotations:
  summary: "Active RFQ session backlog is growing"
  description: "Active RFQ sessions exceed the expected operating range. Canonical dependency or downstream execution may be blocked."
```

## 3. Quote Drought Against RFQ Intake

```yaml
alert: CanonicalQuoteDrought
expr: increase(rfq_created_total[5m]) > 20 and increase(quote_received_total[5m]) == 0
for: 5m
labels:
  severity: critical
annotations:
  summary: "RFQs are being created but no quotes are arriving"
  description: "Canonical validation may be succeeding while downstream quote flow is unavailable."
```

## 4. Execution Failure Spike

```yaml
alert: CanonicalExecutionFailureSpike
expr: increase(execution_failure_total[5m]) > 20
for: 5m
labels:
  severity: warning
annotations:
  summary: "Execution failures spiking on canonical-backed flow"
  description: "Execution failures rose above threshold. Validate canonical market identity and downstream routing."
```

## Operator Actions

1. Inspect recent `rfq_sessions` rows and verify `canonical_market_id` values are present and consistent.
2. Check application logs around `create-rfq-service` and `canonical-market-client`.
3. Validate the configured canonical service target in `src/api/server.ts`.
4. If canonical responses are degraded, keep RFQ creation fail-closed rather than introducing local symbol substitutions.
