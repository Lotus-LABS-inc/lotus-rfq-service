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

## 6. Exact-Market Route Discovery

Historical simulation route selection now uses exact `canonical_market_id` route availability instead of the older hardcoded venue-pair assumption.

Operator checks:

1. Load `GET /admin/simulation/canonical/:eventId`
2. Confirm the target `canonicalMarkets[]` entry is runnable for the desired `routeMode`
3. Use `routeModeSummary` and `hasTriVenueRoute` to confirm whether the event contains any true 3-platform route
4. If pooled routing is unavailable, read the explicit failure reason before retrying or escalating

Important:

- pooled routing fails closed on ambiguous identity or unsafe resolution-risk edges
- single-venue routes may still remain available when pooled routing is blocked

## Historical Simulation Inventory

The admin simulation surface now includes a simulation-only historical inventory alongside live canonical inventory.

Operator notes:

1. `catalogScope=live`
- current live canonical inventory
- candidate for eventual Lotus user routing, subject to the live routing policy

2. `catalogScope=historical_simulation`
- simulation-only historical inventory
- safe to test in the admin console
- not automatically exposed to live Lotus users

Historical inventory is generated and approved through:
- `npm run generate:historical-route-candidates`
- `docs/historical-route-curation.json`
- `npm run sync:historical-route-curation`

## Canonical Graph Rollout

Lotus now maintains an authoritative canonical graph above the existing `resolution_*` tables.

Authoritative objects:
- `canonical_events`
- `venue_market_profiles`
- `proposition_fingerprints`
- `venue_resolution_profiles`
- `venue_settlement_profiles`
- `compatibility_edges`
- `canonical_executable_markets`
- `canonical_executable_market_members`

Current rollout rule:
- existing RFQ, SOR, admin, and simulation surfaces still read `resolution_profiles` and `resolution_risk_assessments`
- those tables are now projection/read-model surfaces during rollout

Operational takeaway:
- if routing/admin data looks wrong, validate the canonical graph first, then the projected `resolution_*` rows
