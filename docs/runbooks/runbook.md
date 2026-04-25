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

## Compatibility And Execution Additive Layer

Lotus now persists an additive compatibility/execution layer above the canonical graph and below the current routing/RFQ runtime seams.

Authoritative additive objects:
- `interpreted_contracts`
- `compatibility_versions`
- `compatibility_decisions`
- `compatibility_overrides`
- `route_selection_traces`
- `route_candidate_sets`
- `route_rejection_reasons`
- `execution_intents`
- `execution_records`
- `execution_state_transitions`
- `execution_recovery_actions`

Operational meaning:
- `InterpretedContract` is the post-normalization contract layer built from `VenueMarketProfile + PropositionFingerprint + ResolutionProfile + SettlementProfile`
- `CompatibilityDecision` is the explainable, versioned decision artifact used for explicit compatibility reasoning and override review
- existing `compatibility_edges` remain the canonical factor-scoring substrate
- existing `resolution_profiles` and `resolution_risk_assessments` still support current readers as projections during rollout

Important boundary:
- CAUTION routing semantics have not been cut over to the new compatibility-decision feasibility layer yet
- current CAUTION pooled-routing behavior still follows the existing `resolutionRiskReadService` / `resolutionRiskPolicyService` path
- the new planner-stage wrappers and route traces are additive and observational unless explicit compatibility-decision gating is active

## Compatibility Review Workflow

Admin review routes now exist for explicit compatibility overrides:
- `POST /admin/compatibility-review/override`
- `POST /admin/compatibility-review/deactivate`
- `GET /admin/compatibility-review/overrides`
- `GET /admin/compatibility-review/decision/:id`
- `GET /admin/compatibility-review/history/:overrideId`

Mutation rules:
- ADMIN auth is required
- `twoFactorToken` is required on mutation routes
- overrides are additive decision layers, not in-place mutation of historical decisions
- ambiguous or conflicting active overrides must fail closed and block pooled treatment until cleaned up

Operator checks:
1. inspect the base decision first
2. inspect active overrides second
3. confirm expiry and reviewer identity before treating an overridden class as effective
4. preserve replay linkage when escalating or replaying a route/execution incident

## Execution And Recovery Boundaries

Execution now has its own explicit lifecycle below the RFQ session lifecycle.

Separation of concerns:
- `RFQStateMachine`
  - quote/session workflow
- `ExecutionIntent`
  - requested execution action and approval context
- `ExecutionRecord`
  - realized downstream execution result, venue execution refs, retry lineage, sync status, settlement status
- `ExecutionStateMachine`
  - explicit execution lifecycle and replayable transition history

Execution states:
- `CREATED`
- `CHECKED`
- `QUOTED`
- `AWAITING_APPROVAL`
- `APPROVED`
- `EXECUTING`
- `PARTIALLY_FILLED`
- `FILLED`
- `FAILED`
- `SYNC_PENDING`
- `SETTLED`
- `RECONCILING`

Failure-recovery scope:
- delayed approval
- quote expiry
- one-leg fill / one-leg fail
- venue fill with local sync failure
- duplicate retry risk
- stale reservation cleanup linkage
- route revalidation after downstream state change

Operator rule:
- unsafe or ambiguous recovery must fail closed
- auto-retry is not allowed when idempotency or venue-state certainty is missing
- push those cases into `RECONCILING` or explicit operator review

## Hard Execution Control Layer

The live RFQ accept path now has a hard execution-control boundary.

Boundary rule:
- routing, RFQ decisioning, compatibility, simulation, and qualification may produce plans and lineage
- they may not directly submit venue actions

Current live execution-control path:
- API constructs `ExecutionControlRequest`
- `ExecutionControlGateway` runs policy, freshness, approval, idempotency, and replay checks
- `ExecutionSubmissionOrchestrator` performs the final downstream handoff
- execution-control audits and decisions are persisted before and after submission

Primary storage:
- `execution_control_decisions`
- `execution_approval_states`
- `execution_idempotency_keys`
- `execution_replay_protection_records`
- `execution_submission_lineage`
- `execution_control_audit_records`

Operator surface:
- see `docs/runbooks/execution-control-layer-runbook.md`

Execution adapter readiness:
- `GET /admin/execution-venues`
- `GET /admin/execution-venues/POLYMARKET`

Use this read-only surface to distinguish local adapter structure from external venue blockers. A Polymarket status of `STRUCTURALLY_READY` means Lotus has the local V2 adapter shape configured; `EXTERNALLY_BLOCKED` means the last guarded harness attempt was rejected by venue auth or endpoint state. Neither status bypasses approved-lane enforcement, execution-scope token validation, settlement verification, or ghost-fill protection.

## Current Verification Status

Code verification completed in this cleanup pass:
- `npm run typecheck` passes
- targeted SOR, replay, resolution-risk, Myriad, projector, and admin override tests pass
- `npm test -- test/integration/rfq-lifecycle.test.ts` passes on the local test harness
  - repo-local `.env` is loaded explicitly
  - local test DB target is `TEST_DATABASE_URL` on `127.0.0.1:5433`
  - execution intent / record / state transition persistence is validated through `/rfq/:id/accept`

Database verification boundary:
- operational target split should be:
  - `DATABASE_URL` -> local dev/app database
  - `TEST_DATABASE_URL` -> separate local test/schema-validation database
  - `SUPABASE_DB_URL` -> product Supabase migration/verification target
- local development/test convention is standardized on `127.0.0.1:5433`
- `npm run db:migrate:test` passes
- `npm run db:schema:validate` passes
- `npm run db:migrate:supabase` passes
- `npm run db:verify:supabase` passes

Operational rule:
- keep local app/test data on `5433`
- keep Supabase for schema + migration verification and future product data only

## Predict Phase 4 Simulation

Predict is now integrated as a simulation and qualification venue, not a live execution venue.

Operator rules:
- use native Predict REST/WS data as the primary source
- treat recorder data as the only valid path to high-fidelity native historical depth
- do not claim `RECORDED_HISTORICAL` precision unless recorder or equivalent replay evidence exists
- treat Predexon fallback for Predict as disabled unless a documented Predict historical surface is available from Predexon
- do not allow Predict pair-route historical simulations from current-state-only rows
- use the readiness gate:
  - `CURRENT_STATE_ONLY`
  - `RECORDER_ACCUMULATING`
  - `HISTORICAL_READY_NATIVE`
  - `HISTORICAL_READY_FALLBACK`
  - `UNUSABLE`
- keep production Predict trade submission disabled in this phase

Predict env/example settings:
- `PREDICT_MAINNET_BASE_URL`
- `PREDICT_TESTNET_BASE_URL`
- `PREDICT_API_KEY`
- `PREDICT_METADATA_VERSION`
- `PREDICT_WS_MAINNET_URL`
- `PREDICT_WS_TESTNET_URL`

Operational Predict commands:
- `npm run sync:predict:current-state -- --environment=mainnet`
- `npm run scan:predict:live-markets -- --environment=mainnet`
- `npm run record:predict:orderbooks -- --environment=mainnet --marketIds=<ids>`
- `npm run scan:predict:predexon-fallback -- --environment=mainnet --marketIds=<ids> --start=<iso> --end=<iso>`
- `npm run ingest:predict:predexon-fallback -- --environment=mainnet --marketIds=<ids> --start=<iso> --end=<iso>`

Fast testing workflow:
- `npm run batch:historical:proven`
  - runs the persisted proven historical batch only
  - current default scope:
    - `OPINION_ONLY`
    - `POLYMARKET_LIMITLESS`
  - current default inputs:
    - `BUY`
    - `SELL`
    - `requestedNotional = 100`
    - `strategyKey = strategy.sim.v1`
- `npm run batch:predict:evidence -- --environment=mainnet`
  - runs:
    - current-state bootstrap
    - live market scan
    - recorder bootstrap only if live ids are found
    - Predexon fallback scan only if live ids are found
  - if no ids are found, the script exits cleanly with `no_live_markets_found`
- `npm run report:simulation:canonical-events`
  - emits category-grouped canonical event routeability
  - includes single, pair, and tri opportunities
  - keeps non-qualified Predict and tri routes visible as report-only, not runnable
