# Internal Crossing Phase 1 Delivery Checklist

Generated: 2026-03-10

Status legend:
- `[x] DONE`
- `[~] PARTIAL`
- `[ ] PENDING`
- `[?] NOT VERIFIED`

## 1. Schema & Persistence

- [x] `trades` table migration applied
  Evidence: `sql/migrations/2026_03_06_create_internal_trades.sql`
- [x] indexes verified
  Evidence: `test/integration/internal-trades-schema.integration.test.ts`
- [x] unique match protection verified
  Evidence: `uq_trades_match` plus integration coverage in `test/integration/internal-trades-schema.integration.test.ts`
- [x] order state transitions verified
  Evidence: partial-to-filled flow in `test/integration/internal-crossing-engine.integration.test.ts`
- [x] exposure journal linkage verified
  Evidence: trade-linked exposure journal assertions in `test/integration/internal-crossing-engine.integration.test.ts`

## 2. Redis Book Integrity

- [x] `add/remove/updateRemaining` tested
  Evidence: `test/unit/internal-order-book.test.ts`
- [x] best opposite retrieval tested
  Evidence: `test/unit/internal-order-book.test.ts`
- [x] Redis rebuild-from-Postgres script exists
  Evidence: `scripts/rebuild-internal-cross-book.ts` plus `test/integration/internal-cross-rebuild.integration.test.ts`
- [x] stale order cleanup process documented
  Evidence: `docs/runbooks/internal-cross-runbook.md`

## 3. Locking & Concurrency

- [x] deterministic dual-lock ordering implemented
  Evidence: `src/core/internal-engine/locker.ts` plus `test/unit/order-locker.test.ts`
- [x] retry with backoff implemented
  Evidence: `src/core/internal-engine/locker.ts`
- [x] deadlock simulation passed
  Evidence: lock retry/failure coverage in `test/unit/order-locker.test.ts`
- [x] concurrent match simulation passed
  Evidence: concurrent taker scenario in `test/integration/internal-crossing-engine.integration.test.ts`
- [x] no duplicate trades under retry
  Evidence: unit and integration idempotent retry coverage in internal crossing tests

## 4. Matching Engine Correctness

- [x] self-trade prevention enforced
  Evidence: unit and integration coverage in internal crossing tests
- [x] price-time priority verified
  Evidence: order-book unit tests verify price ordering and FIFO at equal price
- [x] partial fill logic verified
  Evidence: unit and integration internal crossing tests
- [x] residual routing handoff verified
  Evidence: internal crossing is attempted before external SOR routing in `src/core/sor/order-router.ts`
- [x] transaction rollback leaves no corruption
  Evidence: unit rollback scenario in `test/unit/internal-crossing-engine.test.ts`

## 5. Exposure Integrity

- [x] buyer/seller exposure updated atomically
  Evidence: single transaction path in `src/core/internal-engine/engine.ts`
- [x] idempotent replay protection verified
  Evidence: duplicate trade protection and retry tests in internal crossing suite
- [x] reservation release verified
  Evidence: `rollbackReservation` coverage in `test/unit/risk-engine.unit.test.ts`
- [x] failed transaction leaves no partial exposure
  Evidence: rollback assertions in unit tests; authoritative exposure assertions in integration tests

## 6. Routing Integration

- [x] `INTERNAL_CROSS` liquidity source added
  Evidence: `src/core/sor/types.ts`
- [x] smart router attempts internal cross before external routing
  Evidence: `src/core/sor/order-router.ts`
- [x] residual order routed correctly
  Evidence: residual build result and SOR handoff path in `src/core/sor/order-router.ts` and `src/api/server.ts`
- [x] metrics emitted for internal cross attempts
  Evidence: `src/observability/metrics.ts` and `src/core/sor/order-router.ts`

## 7. Admin & Ops

- [x] admin internal-cross routes implemented
  Evidence: `src/api/admin/internal-cross.routes.ts`
- [x] 2FA enforced on mutation actions
  Evidence: mutation route body validation plus `tests/admin-internal-cross-routes.test.ts`
- [x] internal-cross runbook written
  Evidence: `docs/runbooks/internal-cross-runbook.md`
- [x] kill switch documented and tested
  Evidence: runbook plus kill-switch behavior in `test/unit/sor.order-router.test.ts`

## 8. Testing

- [x] unit tests pass
  Evidence: internal crossing unit suites currently passing
- [x] integration tests pass
  Evidence: `test/integration/internal-crossing-engine.integration.test.ts` currently passing
- [x] stress tests pass
  Evidence: `scripts/stress-internal-cross.ts`
- [x] chaos/failure simulation pass
  Evidence: `scripts/chaos-internal-cross.ts` plus internal crossing failure-path unit coverage

## 9. Observability

- [x] metrics registered
  Evidence: `internal_crossing_total`, `internal_crossing_filled_size_total`, `sor_internal_cross_result_total`
- [x] traces registered
  Evidence: `internal_cross.attempt`, `internal_cross.lock_pair`, `internal_cross.match_transaction`, `internal_cross.redis_sync`, `internal_cross.shadow_evaluate`
- [x] alerts configured
  Evidence: `docs/alerts-internal-cross.md`
- [x] dashboards defined
  Evidence: `docs/dashboards/internal-cross.md`

## 10. Rollout

- [x] feature flag `INTERNAL_CROSS_ENABLED` exists
  Evidence: `src/utils/env.ts`, `.env.example`, `src/api/server.ts`
- [x] shadow mode tested
  Evidence: `test/unit/sor.order-router.test.ts`
- [x] canary rollout plan documented
  Evidence: `docs/runbooks/internal-cross-runbook.md`
- [x] rollback plan documented
  Evidence: `docs/runbooks/internal-cross-runbook.md`

## Release Decision

- [ ] NOT READY
- [x] READY FOR SHADOW
- [ ] READY FOR CANARY
- [ ] READY FOR LIMITED PROD

Reason:
- Core engine, routing integration, admin tooling, runtime controls, rebuild tooling, and observability docs are present.
- Shadow rollout controls now exist and are backed by tests and operator procedures.
- Canary and limited production still require production evidence and signoff, not just implementation.

## Signoff

- Infra
  - Name:
  - Date:
  - Status:

- Backend
  - Name:
  - Date:
  - Status:

- Risk
  - Name:
  - Date:
  - Status:

- Ops
  - Name:
  - Date:
  - Status:
