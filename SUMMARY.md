# Lotus RFQ Service Summary

## Current System State

Lotus now runs with an additive compatibility/execution layer above the canonical graph and below the current routing and RFQ read-model seams.

Authoritative layered objects now include:
- `CanonicalEvent`
- `VenueMarketProfile`
- `CompatibilityEdge`
- `CanonicalExecutableMarket`
- `InterpretedContract`
- `CompatibilityDecision`
- `ExecutionIntent`
- `ExecutionRecord`
- `ExecutionStateTransition`

Legacy compatibility/read-model surfaces still remain active during rollout:
- `resolution_profiles`
- `resolution_risk_assessments`

## Routing And Compatibility Rollout Boundary

Current authority split:
- canonical graph + interpreted contracts + compatibility decisions
  - proposition identity, normalized contract semantics, explainable compatibility, versioning, replay linkage
- projected `resolution_*` tables
  - current RFQ/SOR/admin compatibility readers

Important rollout rule:
- CAUTION routing still follows the existing `resolutionRiskReadService` / `resolutionRiskPolicyService` path until an explicit cutover occurs
- the new planner-stage wrappers and compatibility feasibility layer are additive and do not silently redefine CAUTION pooled-routing behavior

## Compatibility Review

Compatibility review and override routes are available:
- `POST /admin/compatibility-review/override`
- `POST /admin/compatibility-review/deactivate`
- `GET /admin/compatibility-review/overrides`
- `GET /admin/compatibility-review/decision/:id`
- `GET /admin/compatibility-review/history/:overrideId`

Mutation rules:
- ADMIN auth required
- `twoFactorToken` required
- overrides are additive and replay-linked
- ambiguous active override state must fail closed

## Execution And Recovery

Execution is now explicitly modeled below RFQ session state:
- `ExecutionIntent`
  - requested action, route-plan linkage, initiator, requested size/notional, intended venues
- `ExecutionRecord`
  - actual downstream execution outcome, venue execution ids, fill details, retry lineage, sync and settlement status
- `ExecutionStateMachine`
  - explicit states from `CREATED` through `RECONCILING`

Recovery subsystem covers:
- delayed approval
- quote expiry
- one-leg fill / one-leg fail
- venue fill with local sync failure
- duplicate retry protection
- stale reservation cleanup linkage
- route revalidation after downstream state changes

Unsafe recovery remains fail-closed.

## Verification Status

Completed in the cleanup pass:
- repo-wide `npm run typecheck` passes
- targeted SOR, replay, resolution-risk, Myriad, projector, and admin compatibility review tests pass
- `test/integration/rfq-lifecycle.test.ts` passes against the local `TEST_DATABASE_URL` on `127.0.0.1:5433`
  - the harness now self-loads the repo-local `.env`
  - execution intent / execution record / execution transition persistence is validated end to end
  - Redis test state is isolated through the in-memory harness double

Current environment contract:
- local development/test DB should be separate from product Supabase
- `DATABASE_URL`
  - local app/dev/ingestion database
- `TEST_DATABASE_URL`
  - separate local test/schema-validation database
- `SUPABASE_DB_URL`
  - product Supabase migration/verification target only
- current checked-in example env now reflects that split
- local development/test convention is now standardized on `127.0.0.1:5433`
- local DB migration and schema validation pass on the `5433` test environment
- Supabase schema migration and verification also pass against the current migration set

## Historical Simulation Status

Working today:
- single-venue simulation for `POLYMARKET`, `LIMITLESS`, `OPINION`, `MYRIAD`
- exact historical `POLYMARKET_LIMITLESS` pair routes across seeded categories
- `MYRIAD_ONLY` conservative simulation

Predict Phase 4 simulation foundation is now present:
- validated Predict REST client for documented market/orderbook/orders/positions/auth surfaces
- Predict market, orderbook, and execution-event adapters
- recorder-ready websocket client plus raw orderbook/match-event recorders
- `PREDICT_ONLY` plus `POLYMARKET_PREDICT`, `LIMITLESS_PREDICT`, and `OPINION_PREDICT` route-mode support at the type/admin surface
- explicit Predict simulation precision labels:
  - `REALIZED`
  - `RECORDED_HISTORICAL`
  - `ESTIMATED_CONSERVATIVE`
  - `INSUFFICIENT_DATA`
- explicit Predict provenance labels:
  - `NATIVE_PREDICT`
  - `PREDExON_FALLBACK`
  - `MIXED_WITH_PROVENANCE`

Current Predict boundary:
- production trading is still disabled
- future execution-prep is `EOA`-only
- Predict Account / smart-wallet flows are deferred
- Predexon fallback for Predict is implemented as an availability-gated fail-closed path because the current published Predexon reference does not clearly expose Predict-specific endpoints

Not yet promoted:
- exact historical Opinion pair routes without proven numeric IDs
- tri-venue route readiness
- Myriad pair/tri routing

## Opinion Pair Boundary

Current limited state without direct Opinion API discovery:
- the repo can preserve unresolved exact-match Opinion curation records
- the repo can validate already-known numeric Opinion ids through Predexon historical orderbooks
- the repo cannot broaden exact historical Opinion pair readiness in a meaningful way without `OPINION_API_KEY`

Current operator-visible consequence:
- `OPINION_ONLY` historical routes can still exist when a known numeric Opinion market is already curated
- `POLYMARKET_OPINION` and `LIMITLESS_OPINION` stay unavailable unless an exact numeric Opinion market id is proven and explicitly accepted in `docs/historical-route-curation.json`

The historical candidate generator now records this boundary explicitly:
- when `OPINION_API_KEY` is missing, generated candidates retain an audit observation that direct Opinion OpenAPI discovery was skipped

## What Next

Recommended next phase:
1. set `OPINION_API_KEY` and keep `OPINION_OPENAPI_BASE_URL` pointed at the documented Opinion OpenAPI surface
2. rerun `npm run generate:historical-route-candidates`
3. review exact Opinion candidates against `docs/predexon-opinion-id-curation.json`
4. accept only exact semantic matches with validated Predexon historical orderbook coverage
5. resync `docs/historical-route-curation.json` into the local historical catalog
6. only then enable any new `POLYMARKET_OPINION`, `LIMITLESS_OPINION`, or tri-venue historical routes

Hard rule for that phase:
- no proxy markets
- no title-only matching
- no threshold/date substitutions
- no route activation without a proven numeric Opinion market id plus Predexon historical validation

## Predict What Next

Recommended next steps for Predict:
1. wire the recorder bootstrap to documented Predict websocket topic/request formats
2. decide the local recorder collection targets for mainnet vs testnet
3. accumulate native Predict recorder history before claiming `RECORDED_HISTORICAL` on real windows
4. keep Predexon fallback disabled until a documented Predict historical surface exists in Predexon
