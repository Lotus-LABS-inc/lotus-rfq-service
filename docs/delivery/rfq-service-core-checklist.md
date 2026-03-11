# RFQ Service Core Delivery Checklist

Generated: 2026-03-11

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

This is a current-state readiness assessment for the core RFQ service layers outside the dedicated internal-crossing, internal-netting, and internal-clearing phase checklists.

## 1. Canonical Instrument Layer

- [x] canonical market client is implemented and wired into the RFQ service
  Evidence: `src/core/rfq-engine/canonical-market-client.ts`, `src/api/server.ts`
- [x] RFQ creation depends on canonical market validation before persistence
  Evidence: `src/core/rfq-engine/create-rfq-service.ts`, `tests/create-rfq-service.test.ts`
- [x] RFQ API validates and routes canonical-market requests
  Evidence: `src/api/routes/rfq.ts`, `tests/rfq-route.test.ts`
- [x] authoritative RFQ lifecycle coverage exists for canonical-market-backed sessions
  Evidence: `test/integration/rfq-lifecycle.test.ts`, `tests/rfq-session-manager.test.ts`, `tests/rfq-state-machine.test.ts`
- [x] dedicated canonical-instrument runbook, alerts, and dashboard artifacts exist
  Evidence: `docs/runbooks/canonical-instrument-runbook.md`, `docs/alerts-canonical-instrument.md`, `docs/dashboards/canonical-instrument.md`

## 2. Pre-Trade Risk & Exposure Engine (RFC-Aware for Prediction Markets)

- [x] risk engine is implemented with canonical-market validation, reservation, and exposure checks
  Evidence: `src/core/risk-engine.ts`
- [x] authoritative exposure persistence and Redis rolling cache exist
  Evidence: `src/repositories/exposure.repository.ts`, `src/repositories/exposure-redis-cache.ts`
- [x] reconciliation job exists for exposure parity checks
  Evidence: `src/jobs/reconcile-exposure.job.ts`
- [x] unit and integration coverage exist for reservation and exposure behavior
  Evidence: `test/unit/risk-engine.unit.test.ts`, `test/integration/risk-reservation.integration.test.ts`, `test/unit/internal-risk-utils.test.ts`
- [x] risk admin and operational runbook artifacts exist
  Evidence: `src/api/admin/risk.routes.ts`, `docs/runbooks/risk-engine-runbook.md`
- [x] risk alert artifact exists
  Evidence: `docs/alerts-risk.md`
- [x] dedicated risk dashboard artifact exists
  Evidence: `docs/dashboards/risk.md`

## 3. Multi-Leg / Combo RFQ Engine

- [x] combo RFQ engine is implemented and wired into the API surface
  Evidence: `src/core/combo-engine/combo-engine.ts`, `src/api/combo.routes.ts`, `src/api/server.ts`
- [x] combo quote normalization and execution-plan construction exist
  Evidence: `src/services/combo-quote-normalizer.ts`, `src/core/execution-plan/execution-plan-builder.ts`
- [x] combo unit, route, websocket, reservation, and lifecycle coverage exist
  Evidence: `test/unit/combo-engine.unit.test.ts`, `test/unit/combo-quote-normalizer.unit.test.ts`, `tests/combo-routes.test.ts`, `test/integration/combo-lifecycle.integration.test.ts`, `test/integration/combo-reservation.integration.test.ts`, `test/integration/combo-ws.integration.test.ts`
- [x] combo admin and runbook artifacts exist
  Evidence: `src/api/admin/combo.routes.ts`, `tests/admin-combo-routes.test.ts`, `docs/runbooks/combo-runbook.md`
- [x] dedicated combo alerts and dashboard artifacts exist
  Evidence: `docs/alerts-combo.md`, `docs/dashboards/combo.md`

## 4. Smart Order Routing + Partial Fill Engine

- [x] SOR components are implemented end-to-end
  Evidence: `src/core/sor/order-router.ts`, `src/core/sor/route-scout.ts`, `src/core/sor/cost-model.ts`, `src/core/sor/splitter.ts`, `src/core/sor/plan-composer.ts`, `src/core/sor/plan-runner.ts`
- [x] partial-fill behavior is represented in the routing and execution path
  Evidence: `src/core/sor/plan-runner.ts`, `src/observability/metrics.ts` (`combo_partial_fill_total`, SOR/internal routing metrics)
- [x] unit coverage exists across routing, scoring, splitting, composition, running, and canary selection
  Evidence: `test/unit/sor.order-router.test.ts`, `test/unit/sor.route-scout.test.ts`, `test/unit/sor.cost-model.test.ts`, `test/unit/sor.splitter.test.ts`, `test/unit/sor.plan-composer.test.ts`, `test/unit/sor.plan-runner.test.ts`, `test/unit/sor-canary-selection.test.ts`
- [x] integration and benchmark coverage exist
  Evidence: `test/integration/sor-build-and-run.integration.test.ts`, `test/benchmarks/sor-stress.bench.test.ts`
- [x] SOR admin, runbook, and alerts artifacts exist
  Evidence: `src/api/admin/sor.routes.ts`, `tests/admin-sor-routes.test.ts`, `docs/runbooks/sor-runbook.md`, `docs/alerts-sor.md`
- [x] dedicated SOR dashboard artifact exists in `docs/dashboards`
  Evidence: `docs/dashboards/sor.md`

## Release Decision

- [ ] NOT READY
- [ ] READY FOR SHADOW
- [ ] READY FOR CANARY
- [x] READY FOR LIMITED PROD

Reason:
- The canonical instrument layer, risk engine, combo RFQ engine, and SOR/partial-fill engine are implemented, materially tested, and now have dedicated operational runbook and observability artifacts.
- Canonical, risk, combo, and SOR all have explicit readiness evidence in docs, tests, and server wiring.
- Final production API connectivity and operator signoff remain an operational decision outside the codebase, but the repo no longer has unresolved checklist gaps for these core layers.
