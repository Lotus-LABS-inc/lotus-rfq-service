# Phase 3A Delivery Checklist

Generated: 2026-03-12

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

## 1. Replay Schema Complete

- [x] replay schema complete
  Evidence: `sql/migrations/2026_03_11_create_replay_tables.sql`
  Evidence: `src/core/replay/replay.types.ts`
  Evidence: `test/unit/replay-types.test.ts`

## 2. Replay Envelope Writer Complete

- [x] replay envelope writer complete
  Evidence: `src/core/replay/replay-envelope-writer.ts`
  Evidence: `test/unit/replay-envelope-writer.test.ts`
  Evidence: `test/integration/replay-envelope-writer.integration.test.ts`

## 3. Snapshot Builders Complete

- [x] snapshot builders complete
  Evidence: `src/core/replay/builders/`
  Evidence: `test/unit/replay-snapshot-builders.test.ts`

## 4. Exact Replay Runner Complete

- [x] exact replay runner complete
  Evidence: `src/core/replay/exact-replay-runner.ts`
  Evidence: `test/unit/exact-replay-runner.test.ts`
  Evidence: `test/integration/exact-replay-runner.integration.test.ts`

## 5. Diff Replay Runner Complete

- [x] diff replay runner complete
  Evidence: `src/core/replay/diff-replay-runner.ts`
  Evidence: `test/unit/diff-replay-runner.test.ts`
  Evidence: `test/integration/diff-replay-runner.integration.test.ts`

## 6. Replay Integrated Into All Critical Engines

- [x] replay integrated into all critical engines
  Evidence: `src/core/replay/replay-decision-capture-service.ts`
  Evidence: replay capture is wired into resolution-risk assessment, RFQ grouping, SOR, internal cross, Phase 2A netting, and Phase 2B clearing planner
  Evidence: `test/unit/replay-decision-capture-service.test.ts`
  Evidence: `test/integration/replay-decision-capture.integration.test.ts`

## 7. Control Plane Schema Complete

- [x] control plane schema complete
  Evidence: `sql/migrations/2026_03_11_create_control_plane_state_tables.sql`
  Evidence: `sql/migrations/2026_03_12_create_control_plane_audit_events.sql`
  Evidence: `src/core/replay/control-plane.types.ts`

## 8. Read APIs Complete

- [x] read APIs complete
  Evidence: `src/api/admin/control-plane.routes.ts`
  Evidence: `src/api/admin/control-plane-admin-service.ts`
  Evidence: `tests/admin-control-plane-routes.test.ts`

## 9. Mutation APIs Complete

- [x] mutation APIs complete
  Evidence: `src/api/admin/control-plane.routes.ts`
  Evidence: `src/api/admin/control-plane-admin-service.ts`
  Evidence: pause, drain, degrade, and override coverage in `tests/admin-control-plane-routes.test.ts`

## 10. Guardrail Config Complete

- [x] guardrail config complete
  Evidence: `src/guardrails/guardrail-config.ts`
  Evidence: `test/unit/guardrail-config.test.ts`

## 11. Guardrail Evaluator Complete

- [x] guardrail evaluator complete
  Evidence: `src/guardrails/guardrail-evaluator.ts`
  Evidence: `test/unit/guardrail-evaluator.test.ts`

## 12. Degradation Manager Complete

- [x] degradation manager complete
  Evidence: `src/guardrails/degradation-manager.ts`
  Evidence: `test/unit/degradation-manager.test.ts`

## 13. Engine Integrations Complete

- [x] engine integrations complete
  Evidence: `src/guardrails/planning-guardrail-helper.ts`
  Evidence: `src/core/sor/order-router.ts`
  Evidence: `src/core/combo-engine/multi-leg-internal-netting-engine.ts`
  Evidence: `src/core/combo-engine/clearing-round-planner.ts`
  Evidence: `test/integration/guardrail-planning.integration.test.ts`

## 14. Reconciliation V2 Complete

- [x] reconciliation v2 complete
  Evidence: implementation exists in `src/jobs/reconciliation-v2.job.ts`
  Evidence: unit coverage exists in `test/unit/reconciliation-v2.job.test.ts`
  Evidence: integration coverage exists in `test/integration/reconciliation-v2.job.integration.test.ts`
  Evidence: singleton Redis lock, typed infra errors, and paginated scans are implemented in `src/jobs/reconciliation-v2.job.ts`
  Evidence: `reconciliation_v2_run_duration_ms`, `reconciliation_v2_lock_conflict_total`, and `reconciliation_v2_infra_error_total` are registered in `src/observability/metrics.ts`
  Evidence: `npx vitest run test/unit/reconciliation-v2.job.test.ts --maxWorkers=1` passed on 2026-03-12
  Evidence: `npx vitest run test/integration/reconciliation-v2.job.integration.test.ts --maxWorkers=1` passed on 2026-03-12

## 15. Admin Replay APIs Complete

- [x] admin replay APIs complete
  Evidence: `src/api/admin/replay.routes.ts`
  Evidence: `src/api/admin/replay-admin-service.ts`
  Evidence: `tests/admin-replay-routes.test.ts`

## 16. Runbook Complete

- [x] runbook complete
  Evidence: `docs/runbooks/phase3a-replay-control-plane-runbook.md`

## 17. Metrics And Alerts Complete

- [x] metrics and alerts complete
  Evidence: `src/observability/metrics.ts`
  Evidence: `docs/alerts-phase3a.md`
  Evidence: `docs/grafana-phase3a-panels.md`

## 18. Integration Tests Complete

- [x] integration tests complete
  Evidence: replay, guardrail, and admin integration suites exist and have been exercised
  Evidence: `test/integration/reconciliation-v2.job.integration.test.ts` now covers Redis-safe teardown and singleton lock concurrency
  Evidence: `npx vitest run test/integration/reconciliation-v2.job.integration.test.ts --maxWorkers=1` passed on 2026-03-12

## 19. Stress Tests Complete

- [x] stress tests complete
  Evidence: `scripts/stress-phase3a.ts` added with bounded capture, exact replay, diff replay, guardrail/control-plane pressure, and reconciliation proof flow
  Evidence: `test/integration/phase3a-rollout-validation.integration.test.ts` added for canary-readiness validation
  Evidence: `.github/workflows/ci.yml` now runs `npm run stress:phase3a` and `npx vitest run test/integration/phase3a-rollout-validation.integration.test.ts --maxWorkers=1`
  Evidence: `npx vitest run test/integration/phase3a-rollout-validation.integration.test.ts --maxWorkers=1` passed on 2026-03-12
  Evidence: `npm run stress:phase3a` passed on 2026-03-12
  Evidence: stress summary recorded `attempted=36`, `persisted=36`, `exactReplay MATCH=36`, `diffReplay ERROR=0`, `duplicateRounds=0`, `duplicateExposure=0`, `negativeResiduals=0`, `contradictoryAuditRows=0`, `fingerprintDrift=0`, `lockPresent=false`, `runtimeMs=154662`

## 20. Shadow Mode Ready

- [x] shadow mode ready
  Evidence: `src/guardrails/phase3a-guardrail-shadow.ts` adds env-driven rollout, deterministic sampling, and control-plane override precedence for `GUARDRAIL_ENFORCEMENT`
  Evidence: `src/api/admin/control-plane.routes.ts` exposes `GET /admin/control-plane/guardrail-shadow`
  Evidence: `src/api/admin/control-plane-admin-service.ts` inspects active shadow config, matched override, and effective enforcement mode
  Evidence: `src/core/sor/order-router.ts`, `src/core/combo-engine/multi-leg-internal-netting-engine.ts`, and `src/core/combo-engine/clearing-round-planner.ts` now resolve live Phase 3A shadow enforcement before `evaluatePlanningGuardrails(...)`
  Evidence: `test/unit/phase3a-guardrail-shadow.test.ts`, `test/unit/control-plane-admin-service.test.ts`, and `tests/admin-control-plane-routes.test.ts` cover deterministic sampling, override precedence, malformed payload rejection, and shadow inspection
  Evidence: `test/unit/sor.order-router.test.ts`, `test/unit/multi-leg-internal-netting-engine.test.ts`, and `test/unit/clearing-round-planner.test.ts` prove shadow remains observational only for SOR, Phase 2A, and Phase 2B
  Evidence: `test/integration/phase3a-guardrail-shadow.integration.test.ts` proves shadow evaluation does not mutate `planner_shard_state`, `bucket_state`, or `control_plane_audit_events`
  Evidence: `npx vitest run test/unit/phase3a-guardrail-shadow.test.ts test/unit/control-plane-admin-service.test.ts tests/admin-control-plane-routes.test.ts test/unit/sor.order-router.test.ts test/unit/multi-leg-internal-netting-engine.test.ts test/unit/clearing-round-planner.test.ts test/integration/phase3a-guardrail-shadow.integration.test.ts --maxWorkers=1` passed on 2026-03-12

## Release State

- [ ] NOT READY
- [x] READY FOR INTERNAL USE
- [x] READY FOR SHADOW
- [x] READY FOR CANARY

Reason:
- Replay, control plane, guardrails, stress proof, and operator-ready Phase 3A shadow mode are implemented.
- SOR, Phase 2A, and Phase 2B now support observational guardrail shadow evaluation with admin inspection and rollout controls.
