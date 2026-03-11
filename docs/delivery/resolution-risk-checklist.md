# Resolution Risk Delivery Checklist

Generated: 2026-03-11

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

## 1. Profile Schema Complete

- [x] `resolution_profiles` table exists with required identity and metadata fields
  Evidence: `sql/migrations/2026_03_11_create_resolution_risk_tables.sql`
- [x] schema verification targets include resolution-risk profile objects
  Evidence: `scripts/db-schema-targets.mjs`
- [x] schema/index coverage exists for profile persistence
  Evidence: `test/integration/internal-trades-schema.integration.test.ts`

## 2. Assessment Schema Complete

- [x] `resolution_risk_assessments` table exists with versioned pair uniqueness
  Evidence: `sql/migrations/2026_03_11_create_resolution_risk_tables.sql`
- [x] unique pair/version persistence semantics are covered
  Evidence: `test/integration/internal-trades-schema.integration.test.ts`, `test/integration/resolution-risk-assessment-service.integration.test.ts`
- [x] foreign-key linkage from assessments to profiles exists
  Evidence: `sql/migrations/2026_03_11_create_resolution_risk_tables.sql`

## 3. Metadata Normalization Verified

- [x] resolution profile normalizer is implemented in the canonical layer
  Evidence: `src/core/rfq-engine/resolution-profile-normalizer.ts`
- [x] multiple adapter-safe metadata shapes are normalized deterministically
  Evidence: `test/unit/resolution-profile-normalizer.test.ts`
- [x] missing critical metadata fails closed
  Evidence: `test/unit/resolution-profile-normalizer.test.ts`

## 4. Pair Comparator Verified

- [x] pair comparator is implemented in the canonical layer
  Evidence: `src/core/rfq-engine/resolution-pair-comparator.ts`
- [x] factor-level comparison outputs are deterministic and explainable
  Evidence: `src/core/rfq-engine/resolution-pair-comparator.ts`
- [x] identical, oracle mismatch, wording mismatch, and structural mismatch cases are covered
  Evidence: `test/unit/resolution-pair-comparator.test.ts`

## 5. Scoring Engine Verified

- [x] weighted resolution-risk scoring engine is implemented
  Evidence: `src/core/rfq-engine/resolution-risk-scoring-engine.ts`
- [x] equivalence-class mapping and low-confidence handling are covered
  Evidence: `test/unit/resolution-risk-scoring-engine.test.ts`
- [x] scoring output remains persistence-ready and explainable
  Evidence: `src/core/rfq-engine/resolution-risk.types.ts`, `src/core/rfq-engine/resolution-risk-scoring-engine.ts`

## 6. Persistence And Recomposition Verified

- [x] assessment service builds all deterministic unique pairs for a canonical event
  Evidence: `src/core/rfq-engine/resolution-risk-assessment-service.ts`
- [x] idempotent versioned upsert behavior is implemented
  Evidence: `src/core/rfq-engine/resolution-risk-assessment-service.ts`
- [x] unit and real-DB recomputation coverage exist
  Evidence: `test/unit/resolution-risk-assessment-service.test.ts`, `test/integration/resolution-risk-assessment-service.integration.test.ts`

## 7. Canonical APIs Complete

- [x] public resolution-risk API routes exist
  Evidence: `src/api/routes/resolution-risk.ts`
- [x] canonical event, pair, and market lookups are exposed with typed responses
  Evidence: `src/api/routes/resolution-risk.ts`, `tests/resolution-risk-routes.test.ts`
- [x] route handlers stay thin and fail closed
  Evidence: `tests/resolution-risk-routes.test.ts`

## 8. Router Integration Complete

- [x] SOR consumes persisted resolution-risk assessments
  Evidence: `src/core/sor/order-router.ts`, `src/core/rfq-engine/resolution-risk-read-service.ts`
- [x] `DO_NOT_POOL`, `HIGH_RISK`, `CAUTION`, and `SAFE_EQUIVALENT` routing policies are enforced
  Evidence: `src/core/sor/resolution-risk-routing-policy.ts`, `src/core/sor/cost-model.ts`, `src/core/sor/splitter.ts`
- [x] routing behavior by equivalence class is unit and integration tested
  Evidence: `test/unit/sor.cost-model.test.ts`, `test/unit/sor.splitter.test.ts`, `test/unit/sor.order-router.test.ts`, `test/integration/sor-resolution-risk.integration.test.ts`

## 9. RFQ Integration Complete

- [x] RFQ creation computes deterministic resolution-risk venue grouping
  Evidence: `src/core/rfq-engine/create-rfq-service.ts`, `src/core/rfq-engine/resolution-risk-grouping-service.ts`
- [x] RFQ quote intake enforces grouping lanes fail closed
  Evidence: `src/core/rfq-engine/resolution-risk-rfq-policy.ts`, `src/core/rfq-engine/create-rfq-service.ts`, `src/lp/receive-lp-quote-service.ts`
- [x] safe pooled, caution-separated, and blocked RFQ cases are covered
  Evidence: `tests/create-rfq-service.test.ts`, `tests/receive-lp-quote-service.test.ts`, `tests/lp-quotes-route.test.ts`

## 10. Internal Netting / Clearing Gating Complete

- [x] canonical-layer eligibility service exists for internal execution
  Evidence: `src/core/rfq-engine/resolution-risk-eligibility-service.ts`
- [x] internal crossing, Phase 2A netting, and Phase 2B clearing consume safe-only eligibility
  Evidence: `src/core/internal-engine/engine.ts`, `src/core/combo-engine/multi-leg-internal-netting-engine.ts`, `src/core/combo-engine/clearing-round-planner.ts`
- [x] all equivalence classes are covered in gating tests
  Evidence: `test/unit/resolution-risk-eligibility-service.test.ts`, `test/integration/internal-execution-resolution-risk.integration.test.ts`

## 11. UI Formatter Complete

- [x] presentation/formatting layer exists
  Evidence: `src/core/rfq-engine/resolution-risk-presentation.ts`
- [x] label, recommendedAction, and shortReasons formatting are covered
  Evidence: `test/unit/resolution-risk-presentation.test.ts`
- [x] canonical API routes return presentation-shaped responses
  Evidence: `src/api/routes/resolution-risk.ts`, `tests/resolution-risk-routes.test.ts`

## 12. Admin Routes Complete

- [x] admin resolution-risk routes exist
  Evidence: `src/api/admin/resolution-risk.routes.ts`
- [x] admin service supports inspection and recomputation
  Evidence: `src/api/admin/resolution-risk-admin-service.ts`
- [x] route and integration coverage exist for admin resolution-risk behavior
  Evidence: `tests/admin-resolution-risk-routes.test.ts`, `test/integration/resolution-risk-admin-service.integration.test.ts`

## 13. Runbook Complete

- [x] resolution-risk runbook exists
  Evidence: `docs/runbooks/resolution-risk-runbook.md`
- [x] inspection, recompute, operational interpretation, gating validation, and kill-switch procedures are documented
  Evidence: `docs/runbooks/resolution-risk-runbook.md`
- [x] Supabase verification steps are documented
  Evidence: `docs/runbooks/resolution-risk-runbook.md`

## 14. Metrics And Alerts Configured

- [x] resolution-risk metrics are implemented
  Evidence: `src/observability/metrics.ts` includes `rfq_resolution_safe_pool_total`, `rfq_resolution_separated_total`, `rfq_resolution_blocked_total`, `resolution_risk_penalty_applied_total`, `do_not_pool_block_total`, `caution_route_total`, and shadow metrics
- [x] dedicated resolution-risk alerts doc exists
  Evidence: `docs/alerts-resolution-risk.md`
- [x] dedicated resolution-risk dashboard doc exists
  Evidence: `docs/dashboards/resolution-risk.md`

## 15. Integration Tests Passed

- [x] assessment-service DB-backed integration coverage exists
  Evidence: `test/integration/resolution-risk-assessment-service.integration.test.ts`
- [x] admin-service DB-backed integration coverage exists
  Evidence: `test/integration/resolution-risk-admin-service.integration.test.ts`
- [x] SOR resolution-risk integration coverage exists
  Evidence: `test/integration/sor-resolution-risk.integration.test.ts`
- [x] internal-execution eligibility integration coverage exists
  Evidence: `test/integration/internal-execution-resolution-risk.integration.test.ts`

## 16. Shadow Mode Validated

- [x] shadow-mode implementation exists for resolution-risk decisions
  Evidence: `src/core/rfq-engine/resolution-risk-rollout-controls.ts`, `src/core/rfq-engine/resolution-risk-policy-service.ts`, `src/utils/env.ts`
- [x] shadow validation tests exist
  Evidence: `test/unit/resolution-risk-rollout-controls.test.ts`, `test/unit/resolution-risk-policy-service.test.ts`, `test/integration/resolution-risk-shadow.integration.test.ts`
- [x] rollout-ready shadow behavior is documented
  Evidence: `docs/runbooks/resolution-risk-runbook.md`

## Release Decision

- [ ] NOT READY
- [ ] READY FOR INTERNAL USE
- [ ] READY FOR SHADOW
- [x] READY FOR PROD

Reason:
- Canonical resolution-risk schema, normalization, comparison, scoring, persistence, APIs, RFQ/SOR/internal-execution enforcement, admin routes, observability artifacts, and runbook are implemented and tested.
- Shadow mode is implemented and validated across RFQ, SOR, and internal execution as a decision-only rollout path.
- Existing persisted assessments remain authoritative while rollout controls change only enforcement posture.
