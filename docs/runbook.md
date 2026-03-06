# SOR Operational Runbook

Status: PRODUCTION READY
Last Updated: 2026-03-06

## 1. System Overview
The Smart Order Router (SOR) is responsible for routing client RFQ executions across multiple liquidity providers (LPs), internal inventories, and venues. It ensures atomic execution, self-trade prevention, and optimal cost routing.

## 2. Monitoring & Observability
Prometheus metrics are exposed at `/metrics`. 

### Key Metrics to Watch:
- `sor_plan_build_latency_ms`: P99 should be < 100ms.
- `sor_plan_success_total` / `sor_plan_failure_total`: Successful plans vs failures.
- `sor_step_retries_total`: High counts indicate provider latency or API issues.
- `sor_step_fallback_total`: High counts indicate primary providers failing frequently.

### Alerts:
- **SOR_High_Latency**: Alert if `sor_plan_build_latency_ms{quantile="0.99"}` > 200ms for 5 minutes.
- **SOR_Plan_Failures**: Alert if `rate(sor_plan_failure_total[5m])` > 5%.
- **SOR_Unwind_High**: Alert if `rate(sor_plan_unwind_total[5m])` > 2%. Indicates atomic execution failures.

## 3. Administrative Operations
Runtime controls are available via the Admin API: `POST /admin/sor/config`.

### Feature Flags:
- `sorEnabled`: Globally enable/disable SOR routing.
- `sorCanaryShadowEnabled`: Enable shadow mode (SOR builds plans but doesn't execute them, comparing results with legacy logic).
- `sorCanaryPercent`: Percentage of traffic to route through SOR in production.

### Operational Procedures:
- **Disabling SOR**: If SOR is causing instability, set `sorEnabled: false`. The system will fallback to legacy routing where applicable.
- **Force Unwinding a Plan**: Use `POST /admin/sor/plan/:id/force-unwind` if a plan is stuck in a pending state.
- **Retrying a Step**: Use `POST /admin/sor/plan/:id/retry-step` to manually retry a failed execution step with a different provider.

## 4. Troubleshooting
Common issues and steps to resolve:

- **401 Unauthorized**: Ensure `ADMIN+2FA` token is valid for all config updates.
- **409 Conflict (Candidate Not Found)**: Manually retrying a step with a provider not in the original candidate list.
- **Insufficient Liquidity Error**: Check LP connectivity and available sizes for the requested market.

## 5. Escalation Contacts
- Engineering: `Eng-On-Call` (PagerDuty)
- Trading Desk: `Desk-Ops` (Slack #trading-ops)
