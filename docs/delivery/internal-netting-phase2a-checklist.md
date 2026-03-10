# Internal Netting Phase 2A Delivery Checklist

Generated: 2026-03-10

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

## 1. Schema Complete

- [x] combo netting tables created
  Evidence: `sql/migrations/2026_03_10_create_combo_netting_tables.sql`
- [x] Supabase migration command exists
  Evidence: `npm run db:migrate:supabase`
- [x] migration ledger exists
  Evidence: `sql/migrations/2026_03_10_create_schema_migrations.sql`
- [x] Supabase verification command exists
  Evidence: `npm run db:verify:supabase`
- [x] latest repo migrations verified on Supabase
  Evidence: `npm run db:migrate:test`, `npm run db:schema:validate`, and `npm run db:verify:supabase` passed against the current Supabase target on 2026-03-10
- [x] residual leg state persisted
  Evidence: `sql/migrations/2026_03_10_add_combo_leg_remaining_size.sql`
- [x] attempt-level idempotency table created
  Evidence: `sql/migrations/2026_03_10_create_combo_netting_attempts.sql`
- [x] admin audit/task tables created
  Evidence: `sql/migrations/2026_03_10_create_internal_netting_admin_tables.sql`
- [x] schema/index/constraint coverage exists
  Evidence: `test/integration/internal-trades-schema.integration.test.ts`

## 2. Candidate Registry Working

- [x] combo leg registration implemented
  Evidence: `src/core/combo-engine/combo-netting-candidate-registry.ts`
- [x] unregister without scans implemented
  Evidence: reverse index handling in `src/core/combo-engine/combo-netting-candidate-registry.ts`
- [x] opposite-compatible candidate lookup tested
  Evidence: `test/unit/combo-netting-candidate-registry.test.ts`

## 3. Compatibility Engine Tested

- [x] exact opposite combo compatibility covered
  Evidence: `test/unit/combo-netting-compatibility-engine.test.ts`
- [x] constrained overlap compatibility covered
  Evidence: `test/unit/combo-netting-compatibility-engine.test.ts`
- [x] self-trade rejection covered
  Evidence: `test/unit/combo-netting-compatibility-engine.test.ts`
- [x] incompatible outcome and price ambiguity fail closed
  Evidence: `test/unit/combo-netting-compatibility-engine.test.ts`

## 4. Atomic Netting Transaction Tested

- [x] group, leg, residual, attempt, and event writes occur in one transaction
  Evidence: `src/core/combo-engine/multi-leg-internal-netting-engine.ts`
- [x] rollback on downstream failure covered
  Evidence: `test/unit/multi-leg-internal-netting-engine.test.ts`
- [x] concurrent same-pair net attempts covered
  Evidence: `test/integration/combo-netting-concurrency.integration.test.ts`

## 5. Exposure Aggregation Verified

- [x] multi-leg exposure aggregation implemented with prediction-market math
  Evidence: `src/core/combo-engine/combo-netting-exposure-aggregation.ts`
- [x] aggregated totals and per-leg detail tested
  Evidence: `test/unit/combo-netting-exposure-aggregation.test.ts`
- [x] grouped exposure journal writes occur from aggregate inputs
  Evidence: `src/core/combo-engine/multi-leg-internal-netting-engine.ts`

## 6. Replay/Idempotency Verified

- [x] deterministic attempt id prevents duplicate netting mutation
  Evidence: `combo_netting_attempts` plus `src/core/combo-engine/multi-leg-internal-netting-engine.ts`
- [x] exposure mutation idempotency enforced inside the transaction
  Evidence: `src/core/combo-engine/multi-leg-internal-netting-engine.ts`
- [x] duplicate replay and retry-after-rollback covered
  Evidence: `test/integration/combo-netting-concurrency.integration.test.ts`

## 7. Residual Smart-Router Handoff Verified

- [x] internal netting occurs before combo external execution
  Evidence: `src/core/combo-engine/combo-engine.ts`
- [x] fully netted combos stop before external routing
  Evidence: `test/unit/combo-engine.unit.test.ts`
- [x] residual-only execution plan path covered
  Evidence: `test/unit/combo-engine.unit.test.ts`

## 8. Admin Routes Complete

- [x] internal-netting admin routes implemented
  Evidence: `src/api/admin/internal-netting.routes.ts`
- [x] reconcile route implemented
  Evidence: `src/api/admin/internal-netting.routes.ts`
- [x] force-fail route creates task/audit only
  Evidence: `src/api/admin/internal-netting-admin-service.ts`
- [x] admin permission and 2FA route coverage exists
  Evidence: `tests/admin-internal-netting-routes.test.ts`

## 9. Runbook Complete

- [x] internal-netting runbook written
  Evidence: `docs/runbooks/internal-netting-runbook.md`
- [x] matched-leg, exposure, Redis/Postgres, and force-fail workflows documented
  Evidence: `docs/runbooks/internal-netting-runbook.md`
- [x] kill switch documented with implemented runtime suppression
  Evidence: `docs/runbooks/internal-netting-runbook.md`, `src/core/combo-engine/combo-engine.ts`

## 10. Metrics and Alerts Configured

- [x] internal-netting execution metrics registered
  Evidence: `combo_internal_net_attempt_total`, `combo_internal_net_success_total`, `combo_internal_net_partial_total`, `combo_internal_net_residual_routed_total`
- [x] kill-switch suppression metric registered
  Evidence: `combo_internal_net_kill_switch_total`
- [x] internal-netting-specific alerts configured
  Evidence: `docs/alerts-internal-netting.md`
- [x] internal-netting-specific dashboards defined
  Evidence: `docs/dashboards/internal-netting.md`

## 11. Stress Tests Passed

- [x] internal-netting-specific stress harness exists
  Evidence: `scripts/stress-internal-netting.ts`
- [x] internal-netting-specific stress run passed
  Evidence: `npm run stress:internal-netting`
- [x] adjacent combo/internal concurrency coverage exists
  Evidence: `test/integration/combo-netting-concurrency.integration.test.ts`

## 12. Shadow Mode Ready

- [x] internal-netting-specific shadow mode exists
  Evidence: `src/core/combo-engine/combo-engine.ts`, `src/core/combo-engine/runtime-controls.ts`, `src/core/combo-engine/multi-leg-internal-netting-engine.ts`
- [x] shadow evaluation tests exist
  Evidence: `test/unit/combo-engine.unit.test.ts`, `test/unit/internal-netting-runtime-controls.test.ts`
- [x] shadow rollout procedure documented
  Evidence: `docs/runbooks/internal-netting-runbook.md`

## 13. Canary Rollout Ready

- [x] internal-netting-specific canary controls exist
  Evidence: `src/utils/env.ts`, `.env.example`, `src/core/combo-engine/combo-engine.ts`
- [x] canary metrics and comparison dashboards exist
  Evidence: `src/observability/metrics.ts`, `docs/dashboards/internal-netting.md`, `docs/alerts-internal-netting.md`
- [x] canary rollout playbook documented
  Evidence: `docs/runbooks/internal-netting-runbook.md`

## Release Decision

- [ ] NOT READY
- [ ] READY FOR SHADOW
- [x] READY FOR CANARY
- [ ] READY FOR LIMITED PROD

Reason:
- Core Phase 2A engine, idempotency, residual routing, admin tooling, shadow/canary controls, observability artifacts, and stress evidence are present.
- `READY FOR LIMITED PROD` remains intentionally unset until real production API connectivity and final operator signoff are completed.
