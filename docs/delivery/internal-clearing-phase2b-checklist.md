# Internal Clearing Phase 2B Delivery Checklist

Generated: 2026-03-11

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

## 1. Schema Complete

- [x] clearing round tables created
  Evidence: `sql/migrations/2026_03_10_create_clearing_round_tables.sql`
- [x] internal-clearing admin audit/task tables created
  Evidence: `sql/migrations/2026_03_10_create_internal_clearing_admin_tables.sql`
- [x] schema verification targets include Phase 2B clearing/admin tables
  Evidence: `scripts/db-schema-targets.mjs`
- [x] schema/index/constraint coverage exists
  Evidence: `test/integration/internal-trades-schema.integration.test.ts`

## 2. Residual Vector Builder Verified

- [x] residual vector builder implemented
  Evidence: `src/core/combo-engine/residual-vector-builder.ts`
- [x] single-leg, two-leg, and partial residual coverage exists
  Evidence: `test/unit/residual-vector-builder.test.ts`
- [x] bucket metadata validation fails closed
  Evidence: `test/unit/residual-vector-builder.test.ts`

## 3. Bucket Registry Verified

- [x] Phase 2B bucket registry implemented
  Evidence: `src/core/combo-engine/phase2b-candidate-registry.ts`
- [x] bucket registration, unregister, snapshot, and pagination coverage exists
  Evidence: `test/unit/phase2b-candidate-registry.test.ts`
- [x] Redis is used only as live index/snapshot cache, not source of truth
  Evidence: registry contract in `src/core/combo-engine/phase2b-candidate-registry.ts`

## 4. Overlap Graph Verified

- [x] overlap graph builder implemented
  Evidence: `src/core/combo-engine/overlap-graph-builder.ts`
- [x] disconnected graph, chain, and cycle coverage exists
  Evidence: `test/unit/overlap-graph-builder.test.ts`
- [x] malformed input and bucket mismatch fail closed
  Evidence: `test/unit/overlap-graph-builder.test.ts`

## 5. Bounded Enumerator Verified

- [x] bounded connected-subset enumerator implemented
  Evidence: `src/core/combo-engine/candidate-group-enumerator.ts`
- [x] 3-party cycle and 4-party bounded group coverage exists
  Evidence: `test/unit/candidate-group-enumerator.test.ts`
- [x] participant-limit, self-trade, and unique-leg-limit rejection covered
  Evidence: `test/unit/candidate-group-enumerator.test.ts`

## 6. Compression Scorer Verified

- [x] clearing compression scorer implemented
  Evidence: `src/core/combo-engine/clearing-compression-scorer.ts`
- [x] exact-cycle and partial-compression coverage exists
  Evidence: `test/unit/clearing-compression-scorer.test.ts`
- [x] deterministic tie-break tuple is computed
  Evidence: `src/core/combo-engine/clearing-compression-scorer.ts`

## 7. Deterministic Planner Verified

- [x] clearing round planner implemented
  Evidence: `src/core/combo-engine/clearing-round-planner.ts`
- [x] deterministic output coverage exists for repeated identical input
  Evidence: `test/unit/clearing-round-planner.test.ts`
- [x] participant lock order is sorted ascending
  Evidence: `test/unit/clearing-round-planner.test.ts`

## 8. Atomic Executor Verified

- [x] multi-party clearing executor implemented
  Evidence: `src/core/combo-engine/multi-party-clearing-executor.ts`
- [x] single-transaction round, participant, leg-match, event, state, and exposure mutation path exists
  Evidence: `src/core/combo-engine/multi-party-clearing-executor.ts`
- [x] authoritative Postgres+Redis executor integration coverage exists
  Evidence: `test/integration/multi-party-clearing-executor.integration.test.ts`

## 9. Exposure Aggregation Verified

- [x] multi-party exposure aggregator implemented
  Evidence: `src/core/combo-engine/multi-party-exposure-aggregator.ts`
- [x] 3-party cycle and partial-clearing coverage exists
  Evidence: `test/unit/multi-party-exposure-aggregator.test.ts`
- [x] executor delegates exposure math to the aggregator
  Evidence: `src/core/combo-engine/multi-party-clearing-executor.ts`, `test/unit/multi-party-clearing-executor.test.ts`

## 10. Replay/Idempotency Verified

- [x] clearing round uniqueness enforces replay-safe round identity
  Evidence: `uq_clearing_rounds_participant_signature` in `sql/migrations/2026_03_10_create_clearing_round_tables.sql`
- [x] duplicate round replay path is covered
  Evidence: `test/integration/multi-party-clearing-executor.integration.test.ts`
- [x] no double exposure mutation under replay/concurrency is covered
  Evidence: `test/integration/multi-party-clearing-executor.integration.test.ts`

## 11. Residual SOR Handoff Verified

- [x] Phase 2B clearing is integrated into combo execution before external routing
  Evidence: `src/core/combo-engine/combo-engine.ts`
- [x] full internal clear and partial residual routing are covered in unit, in-memory lifecycle, and authoritative Postgres+Redis tests
  Evidence: `test/unit/combo-engine.unit.test.ts`, `test/integration/combo-lifecycle.integration.test.ts`, `test/integration/internal-clearing-residual-routing.integration.test.ts`, `tests/combo-routes.test.ts`
- [x] dedicated real Postgres+Redis end-to-end residual-routing proof after Phase 2B clearing exists
  Evidence: `test/integration/internal-clearing-residual-routing.integration.test.ts`

## 12. Admin Routes Complete

- [x] internal-clearing admin routes implemented
  Evidence: `src/api/admin/internal-clearing.routes.ts`
- [x] internal-clearing admin service implemented
  Evidence: `src/api/admin/internal-clearing-admin-service.ts`
- [x] route permission and 2FA coverage exists
  Evidence: `tests/admin-internal-clearing-routes.test.ts`

## 13. Runbook Complete

- [x] internal-clearing runbook written
  Evidence: `docs/runbooks/internal-clearing-runbook.md`
- [x] inspection, reconciliation, Redis rebuild, stuck residual, and kill-switch procedures documented
  Evidence: `docs/runbooks/internal-clearing-runbook.md`
- [x] Supabase schema verification procedure documented
  Evidence: `docs/runbooks/internal-clearing-runbook.md`

## 14. Metrics and Alerts Configured

- [x] core Phase 2B clearing metrics are registered
  Evidence: `clearing_round_attempts_total`, `clearing_round_success_total`, `clearing_round_partial_total`, `clearing_residual_routed_total` in `src/observability/metrics.ts`
- [x] internal-clearing rollout metrics are registered
  Evidence: `combo_internal_clearing_kill_switch_total`, `combo_internal_clearing_shadow_total`, `combo_internal_clearing_shadow_match_total`, `combo_internal_clearing_shadow_divergence_total`, `combo_internal_clearing_enabled_state`
- [x] internal-clearing-specific alerts doc exists
  Evidence: `docs/alerts-internal-clearing.md`
- [x] internal-clearing-specific dashboard doc exists
  Evidence: `docs/dashboards/internal-clearing.md`
- [x] planner determinism and Redis drift/rebuild validation are documented in rollout artifacts
  Evidence: `docs/alerts-internal-clearing.md`, `docs/dashboards/internal-clearing.md`, `docs/runbooks/internal-clearing-runbook.md`

## 15. Stress Tests Passed

- [x] internal-clearing-specific stress harness exists
  Evidence: `scripts/stress-internal-clearing.ts`, `package.json`
- [x] internal-clearing-specific stress run passed
  Evidence: `npm run stress:internal-clearing` passed on March 11, 2026
- [x] executor concurrency and replay integration proof exists
  Evidence: `test/integration/multi-party-clearing-executor.integration.test.ts`
- [x] 500-entity bucket, contention, drift/rebuild, and residual-routing load validation exist
  Evidence: `scripts/stress-internal-clearing.ts`, `test/integration/internal-clearing-rollout-validation.integration.test.ts`

## 16. Shadow Mode Ready

- [x] internal-clearing-specific rollout controls exist
  Evidence: `src/utils/env.ts`, `src/core/combo-engine/internal-clearing-runtime-controls.ts`
- [x] combo engine contains internal-clearing shadow evaluation path
  Evidence: `src/core/combo-engine/combo-engine.ts`
- [x] explicit Phase 2B shadow behavior tests and operator docs exist at checklist grade
  Evidence: `test/unit/internal-clearing-runtime-controls.test.ts`, `test/unit/combo-engine.unit.test.ts`, `test/integration/internal-clearing-residual-routing.integration.test.ts`, `docs/runbooks/internal-clearing-runbook.md`
- [x] shadow plans are computed, logged, and never committed
  Evidence: `src/core/combo-engine/combo-engine.ts`, `test/integration/internal-clearing-rollout-validation.integration.test.ts`

## 17. Canary Rollout Ready

- [x] internal-clearing-specific canary controls exist
  Evidence: `src/utils/env.ts`, `src/core/combo-engine/internal-clearing-runtime-controls.ts`
- [x] combo engine supports authoritative canary gating for internal clearing
  Evidence: `src/core/combo-engine/combo-engine.ts`
- [x] internal-clearing-specific canary playbook, alerts, dashboards, and promotion evidence exist
  Evidence: `docs/runbooks/internal-clearing-runbook.md`, `docs/alerts-internal-clearing.md`, `docs/dashboards/internal-clearing.md`, `test/integration/internal-clearing-residual-routing.integration.test.ts`
- [x] rollout validation includes bounded runtime, planner determinism, and residual-routing proof
  Evidence: `test/integration/internal-clearing-rollout-validation.integration.test.ts`, `scripts/stress-internal-clearing.ts`

## Release Decision

- [ ] NOT READY
- [ ] READY FOR SHADOW
- [ ] READY FOR CANARY
- [x] READY FOR LIMITED PROD

Reason:
- Engineering, runtime, and operator readiness for Phase 2B constrained multi-party internal clearing are complete.
- Authoritative residual-routing proof, replay/concurrency proof, alerts, dashboards, stress evidence, shadow/canary tests, and runbook rollout procedures are present in the repo.
- Final production API connectivity and operator signoff remain an explicit operational decision outside the codebase.
