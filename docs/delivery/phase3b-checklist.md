# Phase 3B Delivery Checklist

Generated: 2026-03-12

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

## 1. Qualification Schema Complete

- [x] qualification schema complete
  Evidence: `sql/migrations/2026_03_12_create_phase3b_qualification_tables.sql`
  Evidence: `src/core/qualification/qualification.types.ts`
  Evidence: `test/unit/qualification-types.test.ts`

## 2. Economic Quality Engine Complete

- [x] economic quality engine complete
  Evidence: `src/core/qualification/economic-quality-engine.ts`
  Evidence: `test/unit/economic-quality-engine.test.ts`

## 3. Counterfactual Baselines Complete

- [x] counterfactual baselines complete
  Evidence: `src/core/qualification/baselines/external-only-baseline.ts`
  Evidence: `src/core/qualification/baselines/no-internalization-baseline.ts`
  Evidence: `src/core/qualification/baselines/no-resolution-risk-baseline.ts`
  Evidence: `test/unit/external-only-baseline.test.ts`
  Evidence: `test/unit/no-internalization-baseline.test.ts`
  Evidence: `test/unit/no-resolution-risk-baseline.test.ts`

## 4. Qualification Run Manager Complete

- [x] qualification run manager complete
  Evidence: `src/core/qualification/qualification-run-manager.ts`
  Evidence: `test/unit/qualification-run-manager.test.ts`
  Evidence: `test/integration/qualification-run-manager.integration.test.ts`

## 5. Shadow Qualification Evaluator Complete

- [x] shadow qualification evaluator complete
  Evidence: `src/core/qualification/shadow-qualification-evaluator.ts`
  Evidence: `test/unit/shadow-qualification-evaluator.test.ts`

## 6. Promotion Gate Evaluator Complete

- [x] promotion gate evaluator complete
  Evidence: `src/core/qualification/promotion-gate-evaluator.ts`
  Evidence: `test/unit/promotion-gate-evaluator.test.ts`

## 7. Auto Safety Action Engine Complete

- [x] auto safety action engine complete
  Evidence: `src/core/qualification/auto-safety-action-engine.ts`
  Evidence: `test/unit/auto-safety-action-engine.test.ts`
  Evidence: `test/integration/auto-safety-action-engine.integration.test.ts`

## 8. Qualification APIs Complete

- [x] qualification APIs complete
  Evidence: `src/api/admin/qualification.routes.ts`
  Evidence: `src/api/admin/qualification-admin-service.ts`
  Evidence: `tests/admin-qualification-routes.test.ts`
  Evidence: `test/unit/qualification-admin-service.test.ts`
  Evidence: `test/integration/qualification-admin-service.integration.test.ts`
  Evidence: qualification admin routes include `GET /admin/qualification/runs`, `GET /admin/qualification/run/:id`, `GET /admin/qualification/run/:id/evaluations`, `POST /admin/qualification/run/:id/promote`, `POST /admin/qualification/run/:id/demote`, and `POST /admin/qualification/run/:id/pause`

## 9. Safety Action APIs Complete

- [x] safety action APIs complete
  Evidence: `src/api/admin/qualification-safety.routes.ts`
  Evidence: `src/api/admin/qualification-safety-admin-service.ts`
  Evidence: `tests/admin-qualification-safety-routes.test.ts`
  Evidence: `test/unit/qualification-safety-admin-service.test.ts`
  Evidence: `test/integration/qualification-safety-admin-service.integration.test.ts`
  Evidence: safety action admin routes include `GET /admin/qualification/safety-actions`, `GET /admin/qualification/safety-action/:id`, and `POST /admin/qualification/safety-action/:id/resolve`

## 10. Metrics Rollup Complete

- [x] metrics rollup complete
  Evidence: `sql/migrations/2026_03_12_create_qualification_metrics_rollup_mv.sql`
  Evidence: `src/core/qualification/qualification-metrics-rollup.ts`
  Evidence: `test/unit/qualification-metrics-rollup.test.ts`
  Evidence: `test/integration/qualification-metrics-rollup.integration.test.ts`
  Evidence: rollups persist or read from `qualification_metrics_rollup`

## 11. Engine Integrations Complete

- [x] engine integrations complete
  Evidence: `src/core/qualification/runtime-qualification-hook.ts`
  Evidence: `src/core/sor/order-router.ts`
  Evidence: `src/core/rfq-engine/create-rfq-service.ts`
  Evidence: `src/core/rfq-engine/resolution-risk-policy-service.ts`
  Evidence: `src/core/internal-engine/engine.ts`
  Evidence: `src/core/combo-engine/multi-leg-internal-netting-engine.ts`
  Evidence: `src/core/combo-engine/clearing-round-planner.ts`
  Evidence: `test/unit/runtime-qualification-hook.test.ts`
  Evidence: `test/unit/sor.order-router.test.ts`
  Evidence: `tests/create-rfq-service.test.ts`
  Evidence: `test/unit/resolution-risk-policy-service.test.ts`
  Evidence: `test/unit/internal-crossing-engine.test.ts`
  Evidence: `test/unit/multi-leg-internal-netting-engine.test.ts`
  Evidence: `test/unit/clearing-round-planner.test.ts`

## 12. Runbook Complete

- [x] runbook complete
  Evidence: `docs/runbooks/phase3b-qualification-runbook.md`

## 13. Metrics And Alerts Complete

- [x] metrics and alerts complete
  Evidence: `src/observability/metrics.ts`
  Evidence: `docs/alerts-phase3b.md`
  Evidence: `docs/grafana-phase3b-panels.md`
  Evidence: `qualification_evaluations_written_total`, `shadow_decision_diff_total`, `promotion_gate_fail_total`, `auto_safety_actions_created_total`, `auto_safety_actions_resolved_total`, `qualification_rollup_refresh_total`, and `qualification_rollup_refresh_duration_ms` are implemented

## 14. Integration Tests Complete

- [x] integration tests complete
  Evidence: `test/integration/qualification-run-manager.integration.test.ts`
  Evidence: `test/integration/qualification-admin-service.integration.test.ts`
  Evidence: `test/integration/qualification-safety-admin-service.integration.test.ts`
  Evidence: `test/integration/qualification-metrics-rollup.integration.test.ts`
  Evidence: `test/integration/auto-safety-action-engine.integration.test.ts`
  Evidence: `test/integration/phase3b-shadow-validation.integration.test.ts`
  Evidence: `test/integration/phase3b-canary-qualification-flow.integration.test.ts`

## 15. Shadow Mode Validated

- [x] shadow mode validated
  Evidence: `src/core/qualification/runtime-qualification-hook.ts`
  Evidence: `src/core/qualification/shadow-qualification-evaluator.ts`
  Evidence: `test/integration/phase3b-shadow-validation.integration.test.ts`
  Evidence: validated with `npx vitest run test/integration/phase3b-shadow-validation.integration.test.ts --maxWorkers=1`

## 16. Canary Qualification Flow Validated

- [x] canary qualification flow validated
  Evidence: `test/integration/phase3b-canary-qualification-flow.integration.test.ts`
  Evidence: validated with `npx vitest run test/integration/phase3b-canary-qualification-flow.integration.test.ts --maxWorkers=1`

## Release State

- [ ] NOT READY
- [x] READY FOR INTERNAL QUALIFICATION
- [x] READY FOR SHADOW
- [x] READY FOR CANARY
- [ ] READY FOR LIMITED PROD

Reason:
- Internal qualification is ready because schema, scoring, baselines, lifecycle, APIs, rollups, runtime hooks, and runbook are implemented.
- Shadow is ready because safety-action APIs, alerts/panels, and explicit Phase 3B shadow validation exist.
- Canary is ready because the canary qualification-flow validation exists and covers promotion, blocked promotion, auto safety auditing, and pause/demote recovery.
- Limited prod remains blocked because the repo does not yet show explicit limited-prod rollout criteria or sustained canary evidence beyond bounded validation.
