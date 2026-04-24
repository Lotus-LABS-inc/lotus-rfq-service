# Lotus RFQ Service Summary

## Current System State

Lotus is now operating with an explicit time-basis split, a pair-first crypto rollout posture, and a secondary sports discovery track.

Current frontier truth:
- crypto is the shipping frontier
- politics nominee rollout is now narrowly defined and artifact-backed, but not broad-politics ready
- first live crypto canary package is prepared for:
  - `PAIR_PM_OPINION`
  - `btc_exact_slice_only`
  - `CRYPTO:SAME_DAY_DIRECTIONAL`
- first live canary package status:
  - `CANARY_PACKAGE_READY_PENDING_APPROVAL`
  - explicit operator action still required
  - no auto-activation
- `PAIR_PM_LIMITLESS` remains outside the first live window
- sports is not a rollout frontier
- sports is now a fixture-backed live supply/discovery track
- completed sports winner topics now emit `single | pair | tri | strict_all` lanes and are exposed through the dynamic `/admin/sports-lanes` surface

Current politics nominee truth:
- Republican pair limited-prod lane is ready pending operator action:
  - `NOMINEE|US_PRESIDENT|2028|REPUBLICAN`
  - `LIMITLESS|POLYMARKET`
  - exact-safe candidates:
    - `donald_trump`
    - `donald_trump_jr`
    - `ted_cruz`
    - `tucker_carlson`
- Republican tri lane is now artifact-backed, narrow, and limited-prod eligible only with exact-scope per-run user consent:
  - `NOMINEE|US_PRESIDENT|2028|REPUBLICAN`
  - `LIMITLESS|OPINION|POLYMARKET`
  - exact-safe candidates:
    - `jd_vance`
    - `marco_rubio`
    - `ron_desantis`
- Democratic pair lane is now matcher-backed and readiness-review backed:
  - `NOMINEE|US_PRESIDENT|2028|DEMOCRATIC`
  - `LIMITLESS|POLYMARKET`
  - exact-safe candidates:
    - `alexandria_ocasio_cortez`
    - `andy_beshear`
    - `gavin_newsom`
    - `josh_shapiro`
    - `kamala_harris`
    - `pete_buttigieg`
  - current posture:
    - pair-only
    - `READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION` in the shared readiness layer
    - `DEMOCRATIC_PAIR_LIMITED_PROD_READY_FOR_REVIEW` in the narrow lane package
- hard exclusions remain:
  - `Others`
  - venue-only tails
  - unknown/composite outcomes
- posture remains:
  - pair preferred overall
  - tri allowed only for the narrow Republican subset above
  - no Democratic tri implication
  - no Democratic Opinion lane promotion
  - Republican tri limited-prod use must be gated by a short-lived exact-scope token tied to one RFQ accept run
  - no broad politics rollout
- reusable execution-scope token support now exists in the backend:
  - signed short-lived per-run scope tokens can be minted for exact approved lanes
  - validation rechecks live admin lane authority before accept
  - the token model is reusable for future market/category passes with the same exact-scope opt-in problem

Current clean-basis truth:
- `LIMITLESS_OPINION = 0` in `HISTORICAL_ONLY`
- `LIMITLESS_OPINION = 0` in `LIVE_ONLY`
- `POLYMARKET_LIMITLESS_OPINION = 0` in `HISTORICAL_ONLY`
- `POLYMARKET_LIMITLESS_OPINION = 0` in `LIVE_ONLY`

That means the remaining tri zero is not being treated as:
- a downstream propagation bug
- a basis-mixing artifact
- an obvious ingestion miss

The current defensible rollout surface is pair-first:
- `PAIR_PM_LIMITLESS`
  - usable route family
  - safe-subset-first for canary/prod
- `PAIR_PM_OPINION`
  - narrow proven exact BTC slice
  - broader near-exact inventory remains diagnostic or blocked

Tri is now explicitly non-blocking for the next rollout phase.

## Sports Cardinality Backfill

Sports routeability is now modeled as:
- `single`
- `pair`
- `tri`
- `strict_all`

Current completed topics under that model:
- `SPORTS|LEAGUE_WINNER|EPL|2025_2026`
- `SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026`
- `SPORTS|TOURNAMENT_WINNER|NBA|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026`
- `SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026`
- `SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026`

Per-topic lane counts:
- `4` single
- `6` pair
- `4` tri
- `1` strict_all

Current sports admin surface:
- `GET /admin/sports-lanes`
- `GET /admin/sports-lanes/:laneId`
- `GET /admin/sports-lanes/:laneId/readiness`
- `GET /admin/sports-lanes/:laneId/rollback-plan`
- `POST /admin/sports-lanes/:laneId/operator-approval-intent`
- `POST /admin/sports-lanes/:laneId/hold`
- `POST /admin/sports-lanes/:laneId/rollback`

Current generated lane ids:
- EPL:
  - `SPORTS_EPL_WINNER_2025_2026_SINGLE_LIMITLESS`
  - `SPORTS_EPL_WINNER_2025_2026_SINGLE_OPINION`
  - `SPORTS_EPL_WINNER_2025_2026_SINGLE_POLYMARKET`
  - `SPORTS_EPL_WINNER_2025_2026_SINGLE_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_EPL_WINNER_2025_2026_PAIR_OPINION_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_PAIR_POLYMARKET_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `SPORTS_EPL_WINNER_2025_2026_TRI_LIMITLESS_OPINION_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_TRI_OPINION_POLYMARKET_PREDICT`
  - `SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
- La Liga:
  - `SPORTS_LA_LIGA_WINNER_2025_2026_SINGLE_LIMITLESS`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_SINGLE_OPINION`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_SINGLE_POLYMARKET`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_SINGLE_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_OPINION_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_POLYMARKET_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_TRI_LIMITLESS_OPINION_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_TRI_OPINION_POLYMARKET_PREDICT`
  - `SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
- Champions League:
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_SINGLE_LIMITLESS`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_SINGLE_OPINION`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_SINGLE_POLYMARKET`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_SINGLE_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_LIMITLESS_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_OPINION_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_POLYMARKET_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_TRI_LIMITLESS_OPINION_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_TRI_OPINION_POLYMARKET_PREDICT`
  - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
- World Cup:
  - `SPORTS_WORLD_CUP_WINNER_2026_SINGLE_LIMITLESS`
  - `SPORTS_WORLD_CUP_WINNER_2026_SINGLE_OPINION`
  - `SPORTS_WORLD_CUP_WINNER_2026_SINGLE_POLYMARKET`
  - `SPORTS_WORLD_CUP_WINNER_2026_SINGLE_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_OPINION_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_POLYMARKET_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `SPORTS_WORLD_CUP_WINNER_2026_TRI_LIMITLESS_OPINION_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_TRI_OPINION_POLYMARKET_PREDICT`
  - `SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
- NBA Champion:
  - `SPORTS_NBA_CHAMPION_2025_2026_SINGLE_LIMITLESS`
  - `SPORTS_NBA_CHAMPION_2025_2026_SINGLE_OPINION`
  - `SPORTS_NBA_CHAMPION_2025_2026_SINGLE_POLYMARKET`
  - `SPORTS_NBA_CHAMPION_2025_2026_SINGLE_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_LIMITLESS_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_OPINION_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_POLYMARKET_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `SPORTS_NBA_CHAMPION_2025_2026_TRI_LIMITLESS_OPINION_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_TRI_OPINION_POLYMARKET_PREDICT`
  - `SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
- F1 Drivers Champion:
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_SINGLE_LIMITLESS`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_SINGLE_OPINION`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_SINGLE_POLYMARKET`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_SINGLE_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_LIMITLESS_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_OPINION_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_POLYMARKET_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_TRI_LIMITLESS_OPINION_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_TRI_OPINION_POLYMARKET_PREDICT`
  - `SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
- F1 Constructors Champion:
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_SINGLE_LIMITLESS`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_SINGLE_OPINION`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_SINGLE_POLYMARKET`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
- NHL Stanley Cup Champion:
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_SINGLE_LIMITLESS`
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_SINGLE_OPINION`
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_SINGLE_POLYMARKET`
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET`

Lotus now runs with an additive compatibility/execution layer above the canonical graph and below the current routing and RFQ read-model seams.

Authoritative layered objects now include:
- `CanonicalEvent`
- `VenueMarketProfile`
- `CompatibilityEdge`
- `CanonicalExecutableMarket`
- `InterpretedContract`
- `CompatibilityDecision`
- `ExecutionControlDecision`
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
- pair-route rollout readiness must use clean basis-aware evidence
  - `HISTORICAL_ONLY` for simulation qualification
  - `LIVE_ONLY` for production rollout eligibility
  - `MIXED_BASIS` for diagnostics only

## Pair-First Rollout Boundary

Lotus now has explicit pair route classes:
- `PAIR_PM_LIMITLESS`
- `PAIR_PM_OPINION`

These classes are evidence-gated and operator-controlled.

Current rollout interpretation:
- `PAIR_PM_LIMITLESS`
  - shadow-ready as a class
  - canary/prod restricted to compatibility-safe exact subsets
- `PAIR_PM_OPINION`
  - shadow-ready on the exact BTC slice
  - broader PM↔Opinion near-exact families remain blocked or shadow-only

Current first-live-window package:
- route class:
  - `PAIR_PM_OPINION`
- scope label:
  - `btc_exact_slice_only`
- family:
  - `CRYPTO:SAME_DAY_DIRECTIONAL`
- explicitly out of scope:
  - `PAIR_PM_LIMITLESS`
  - `CRYPTO:ATH_BY_DATE`
  - any broader BTC slice
  - any non-BTC asset
  - tri
  - sports/esports

Admin visibility now includes:
- `GET /admin/pair-routes`
- `GET /admin/pair-routes/:routeClass`
- `GET /admin/pair-routes/:routeClass/readiness`
- `GET /admin/pair-routes/:routeClass/coverage`
- `POST /admin/pair-routes/:routeClass/promote-shadow`
- `POST /admin/pair-routes/:routeClass/promote-canary`
- `POST /admin/pair-routes/:routeClass/demote`

Mutation rules:
- `ADMIN + 2FA` required
- audited promotion/demotion events only
- fail closed outside allowlisted families/categories

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

Hard execution-control boundary is now active for the live RFQ accept path.

Execution-control objects now include:
- `ExecutionControlDecision`
- `ExecutionApprovalState`
- `ExecutionIdempotencyKey`
- `ExecutionReplayProtectionRecord`
- `ExecutionSubmissionLineage`
- `ExecutionControlAuditRecord`

Live cutover:
- `/rfq/:id/accept` no longer directly drives `planRunner.run(...)` or `legacyExecutionRouter.execute(...)`
- those handoffs now pass through `ExecutionControlGateway`
- `ExecutionSubmissionOrchestrator` is the only layer allowed to invoke downstream execution handlers in the RFQ path

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

Admin execution-control routes now exist:
- `GET /admin/execution-control/intents`
- `GET /admin/execution-control/intent/:id`
- `GET /admin/execution-control/records`
- `GET /admin/execution-control/record/:id`
- `GET /admin/execution-control/idempotency/:key`
- `POST /admin/execution-control/reconcile/:recordId`
- `POST /admin/execution-control/mark-failed/:recordId`
- `POST /admin/execution-control/retry-safe/:recordId`

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
- Predexon fallback for Predict is implemented as a documented, availability-gated fail-closed path
- current-state Predict bootstrap is available through `npm run sync:predict:current-state`
- live market discovery/probing is available through `npm run scan:predict:live-markets`
- recorder bootstrap is available through `npm run record:predict:orderbooks`
- Predexon fallback coverage scanning is available through `npm run scan:predict:predexon-fallback`
- current-state bootstrap populates canonical graph rows, `predict_market_metadata`, current `predict_orderbook_snapshots` when available, and current-state `historical_market_states`
- current-state bootstrap does not overclaim history; it remains `ESTIMATED_CONSERVATIVE` unless recorder or realized-event evidence exists
- current live verification on 2026-03-27 found no recordable Predict orderbooks for the accessible mainnet market set, so recorder bootstrap currently exits cleanly with zero selected markets rather than fabricating coverage
- Predict historical admission is now evidence-gated:
  - `PREDICT_ONLY` may remain visible/runnable as current-state conservative evidence
  - `POLYMARKET_PREDICT`, `LIMITLESS_PREDICT`, and `OPINION_PREDICT` remain blocked unless the exact Predict market has recorder-backed or ingested fallback historical evidence
  - current-state-only Predict rows no longer promote pair-route availability by themselves
- admin canonical coverage now exposes Predict readiness states:
  - `CURRENT_STATE_ONLY`
  - `RECORDER_ACCUMULATING`
  - `HISTORICAL_READY_NATIVE`
  - `HISTORICAL_READY_FALLBACK`
  - `UNUSABLE`

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

## Broad Semantic Discovery Upgrade

Lotus now uses a checked-in semantic rulepack instead of narrow inline alias maps and title-only discovery seams.

What changed:
- shared semantic rulepack covers:
  - phrase families
  - entity aliases
  - competition/tournament aliases
  - time/deadline families
  - threshold/operator families
  - discovery keyword families
- parser registry now supports:
  - `POLITICS`
  - `CRYPTO`
  - `SPORTS`
  - `ESPORTS`
  - `CULTURE`
  - `TECH`
  - `WEATHER`
  - `OTHER`
- broader semantics are now applied across:
  - Opinion exact-match curation
  - loose historical candidate discovery
  - Myriad category inference
  - admin routeability / near-miss summary surfaces

Safety boundary remains unchanged:
- matching is still deterministic and auditable
- no fuzzy/LLM acceptance logic
- `semantic_exact_live_only` may improve inventory overlap visibility only
- historical pair/tri promotion still requires documented historical evidence and existing routeability gates

Operator visibility improved:
- routeability summary now exposes:
  - exact live-only Opinion overlaps
  - exact historical-qualified Opinion overlaps
  - near-miss counts
  - dominant near-miss reasons
  - dominant failed semantic dimensions

## What Next

Recommended next phase:
1. move `PAIR_PM_LIMITLESS` into intentional shadow with the safe-subset-first policy
2. move `PAIR_PM_OPINION` into intentional shadow around the exact BTC slice
3. keep canary blocked until clean `LIVE_ONLY` pair evidence improves for the exact allowed subset
4. treat tri as non-blocking and stop using `LIMITLESS_OPINION` as the immediate rollout dependency
5. use `docs/pair-route-rollout-summary.json` and the pair-route admin surfaces as the operator source of truth

Recommended politics nominee next phase:
1. record operator approval intent for the Republican pair lane:
   - `POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET`
   - exact-safe candidates:
     - `donald_trump`
     - `donald_trump_jr`
     - `ted_cruz`
     - `tucker_carlson`
2. keep the Republican tri lane canary-only:
   - `POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET`
3. use the Democratic pair limited-prod readiness package to complete lane-scoped operator review for `LIMITLESS|POLYMARKET`
4. use the politics nominee limited-prod readiness artifacts and lane-scoped admin surfaces as the source of truth for nominee rollout status

Hard rules for this phase:
- no forced tri dependency
- no mixed-basis promotion
- no broad PM↔Limitless canary outside the exact-safe subset
- no broad PM↔Opinion canary outside the exact BTC slice
- no threshold relaxation or semantics retuning for rollout

## Predict What Next

Recommended next steps for Predict:
1. run `npm run sync:predict:current-state -- --environment=mainnet` to seed real current-state inventory locally
2. use `npm run scan:predict:live-markets -- --environment=mainnet` to identify recordable live IDs
3. run `npm run record:predict:orderbooks -- --environment=mainnet --marketIds=<ids>` on a schedule and accumulate native recorder history
4. run `npm run scan:predict:predexon-fallback -- --environment=mainnet --marketIds=<ids> --start=<iso> --end=<iso>` to persist explicit fallback coverage evidence
5. use `npm run ingest:predict:predexon-fallback` only for market ids and windows that actually return documented fallback snapshots
6. only promote Predict pair routes after readiness moves to `HISTORICAL_READY_NATIVE` or `HISTORICAL_READY_FALLBACK` for the exact market/window

## Fast Testing Workflow

New local fast-testing scripts:
- `npm run batch:historical:proven`
- `npm run batch:predict:evidence -- --environment=mainnet`
- `npm run report:simulation:canonical-events`

Recommended sequence:
1. `npm run sync:predexon:live-mappings`
2. `npm run wire:predexon:live-ids`
3. `npm run sync:historical-route-curation`
4. `npm run batch:historical:proven`
5. `npm run batch:predict:evidence -- --environment=mainnet`
6. `npm run report:simulation:canonical-events`

Current verified result:
- proven persisted batch now runs only on the evidence-backed historical set:
  - `OPINION_ONLY`
  - `POLYMARKET_LIMITLESS`
- default run shape is:
  - `BUY`
  - `SELL`
  - `requestedNotional = 100`
  - `strategyKey = strategy.sim.v1`
- category report now surfaces single, pair, and tri opportunities from current ingested venue inventory
- Predict remains report-only for pair modes until historically qualified
- latest Predict evidence run completed with:
  - current-state bootstrap succeeded
  - live market scan selected `0` recordable market ids
  - recorder and fallback scan skipped cleanly with `no_live_markets_found`

## Sports Discovery Status

Sports is currently secondary to crypto and is operating as a fixture-backed live supply/discovery track, not as a rollout frontier.

Current active targeted pockets:
- `SPORTS|MATCHUP_WINNER|EPL`
- `SPORTS|MATCHUP_WINNER|LA_LIGA`
- `ESPORTS|MATCHUP_WINNER|VALORANT`
- `ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS`

Held / superseded pockets:
- `ESPORTS|MATCHUP_WINNER|KPL`
- `ESPORTS|MATCHUP_WINNER|LCK`

Current live targeted discovery result:
- `EPL`
  - discovered `0`
  - admitted `0`
  - bound `0`
  - 2+ venue overlap `0`
- `LA_LIGA`
  - discovered `0`
  - admitted `0`
  - bound `0`
  - 2+ venue overlap `0`
- `VALORANT`
  - discovered `0`
  - admitted `0`
  - bound `0`
  - 2+ venue overlap `0`
- `LEAGUE_OF_LEGENDS`
  - discovered `0`
  - admitted `0`
  - bound `0`
  - 2+ venue overlap `0`

Current sports conclusion:
- all active pockets: `SPORTS_TARGETED_INGESTION_NO_CHANGE_SUPPLY_THIN`
- no real cross-venue overlap appeared in the current local run
- no evidence that matcher ambiguity is the blocker
- single best next sports action: `HOLD_POCKET_WAIT_FOR_SUPPLY`

Sports EPL addendum:
- narrow sports lane truth is now artifact-backed for:
  - `SPORTS|LEAGUE_WINNER|EPL|2025_2026`
- all-venue lane:
  - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - exact-safe clubs:
    - `arsenal`
    - `liverpool`
    - `manchester_city`
  - readiness:
    - `SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- peer pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe clubs:
    - `arsenal`
    - `aston_villa`
    - `chelsea`
    - `liverpool`
    - `manchester_city`
    - `manchester_united`
  - readiness:
    - `SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- sports admin/operator surface now exists at:
  - `GET /admin/sports-lanes`
  - `GET /admin/sports-lanes/:laneId`
  - `GET /admin/sports-lanes/:laneId/readiness`
  - `GET /admin/sports-lanes/:laneId/rollback-plan`
  - `POST /admin/sports-lanes/:laneId/operator-approval-intent`
  - `POST /admin/sports-lanes/:laneId/hold`
  - `POST /admin/sports-lanes/:laneId/rollback`
- current sports operating posture:
  - pair and all-venue are both first-class routes when exact club truth supports them
  - `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
  - no widening beyond the exact EPL `2025_2026` winner topic
  - strict all-venue core remains exactly 3 clubs
  - venue-only tails remain excluded
- additional narrow sports lane truth is now artifact-backed for:
  - `SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026`
- La Liga all-venue lane:
  - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - exact-safe clubs:
    - `atletico_madrid`
    - `barcelona`
    - `real_madrid`
  - readiness:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- La Liga peer pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe clubs:
    - `atletico_madrid`
    - `barcelona`
    - `real_madrid`
    - `villarreal`
  - readiness:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- current sports operating posture for La Liga:
  - pair and all-venue are both first-class routes when exact club truth supports them
  - `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
  - no widening beyond the exact La Liga `2025_2026` winner topic
  - strict all-venue core remains exactly 3 clubs
  - venue-only tails remain excluded
- additional narrow sports lane truth is now artifact-backed for:
  - `SPORTS|TOURNAMENT_WINNER|NBA|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026`
- NBA strict-all lane:
  - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - exact-safe teams:
    - `boston_celtics`
    - `detroit_pistons`
    - `oklahoma_city_thunder`
    - `san_antonio_spurs`
  - readiness:
    - `SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- NBA peer pair lane:
  - `POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_POLYMARKET_PREDICT`
  - exact-safe teams:
    - `30` team matcher-backed scope
  - readiness:
    - `SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- current sports operating posture for NBA:
  - pair and strict-all are both first-class routes when exact team truth supports them
  - `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
  - no widening beyond the exact NBA `2025_2026` champion topic
  - strict all-venue core remains exactly 4 teams
  - venue-only tails remain excluded
- F1 Constructors tri lane:
  - `LIMITLESS|OPINION|POLYMARKET`
  - lane id:
    - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - exact-safe constructors:
    - `ferrari`
    - `mclaren`
    - `mercedes`
    - `red_bull_racing`
  - readiness:
    - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- F1 Constructors pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe constructors:
    - `aston_martin`
    - `audi`
    - `ferrari`
    - `mclaren`
    - `mercedes`
    - `red_bull_racing`
    - `williams`
  - readiness:
    - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- current sports operating posture for F1 Constructors:
  - pair and tri are both first-class routes when exact constructor truth supports them
  - `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
  - no widening beyond the exact F1 constructors `2026` topic
  - no invented Predict lane until venue truth exists
  - venue-only tails remain excluded
- LPL tri lane:
  - `LIMITLESS|OPINION|POLYMARKET`
  - lane id:
    - `SPORTS_LPL_WINNER_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - exact-safe teams:
    - `anyones_legend`
    - `bilibili_gaming`
    - `jd_gaming`
    - `top_esports`
  - readiness:
    - `SPORTS_LPL_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- LPL pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `SPORTS_LPL_WINNER_2026_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe teams:
    - `anyones_legend`
    - `bilibili_gaming`
    - `jd_gaming`
    - `top_esports`
    - `weibo_gaming`
  - readiness:
    - `SPORTS_LPL_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- current sports operating posture for LPL:
  - pair and tri are both first-class routes when exact team truth supports them
  - `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
  - no widening beyond the exact LPL `2026` winner topic
  - venue-only tails remain excluded
- NHL Stanley Cup tri lane:
  - `LIMITLESS|OPINION|POLYMARKET`
  - lane id:
    - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - exact-safe teams:
    - `colorado_avalanche`
    - `dallas_stars`
    - `edmonton_oilers`
    - `tampa_bay_lightning`
  - readiness:
    - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- NHL Stanley Cup pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe teams:
    - `anaheim_ducks`
    - `carolina_hurricanes`
    - `colorado_avalanche`
    - `dallas_stars`
    - `edmonton_oilers`
    - `florida_panthers`
    - `los_angeles_kings`
    - `minnesota_wild`
    - `montreal_canadiens`
    - `new_jersey_devils`
    - `new_york_rangers`
    - `tampa_bay_lightning`
    - `toronto_maple_leafs`
    - `vegas_golden_knights`
    - `washington_capitals`
    - `winnipeg_jets`
  - readiness:
    - `SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- current sports operating posture for NHL Stanley Cup:
  - pair and tri are both first-class routes
  - `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
  - no widening beyond the exact NHL Stanley Cup `2025_2026` topic
  - no strict-all lane is justified
  - rollback/hold remain lane-scoped only

Office-winner limited-prod review package now exists for:
- `OFFICE_WINNER|USA|US_PRESIDENT|2028`
- `LIMITLESS|POLYMARKET`
- candidates:
  - `alexandria_ocasio_cortez`
  - `donald_trump`
  - `gavin_newsom`
  - `jd_vance`
  - `josh_shapiro`
  - `kamala_harris`
  - `marco_rubio`

Current office-winner readiness posture:
- label: `OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- rule state: `SEMANTICALLY_COMPATIBLE_REWORDING`
- operator rule review required before promotion
- no tri implication
- no venue widening beyond `LIMITLESS|POLYMARKET`
- additional local office-winner readiness packages now exist for:
  - `OFFICE_WINNER|SEOUL|MAYOR|2026`
    - tri lane:
      - `LIMITLESS|OPINION|POLYMARKET`
      - readiness:
        - `OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
    - pair lane:
      - `LIMITLESS|POLYMARKET`
      - readiness:
        - `OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - `OFFICE_WINNER|BUSAN|MAYOR|2026`
    - pair lane:
      - `LIMITLESS|POLYMARKET`
      - readiness:
        - `OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - `OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026`
    - pair lane:
      - `LIMITLESS|POLYMARKET`
      - readiness:
        - `OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- office-winner admin/operator surface now covers:
  - `POLITICS_OFFICE_WINNER_US_PRESIDENT_2028_PAIR_LIMITLESS_POLYMARKET`
  - `POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
  - `POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET`
  - `POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET`
  - `POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET`
- current local office-winner rule posture remains:
  - `SEMANTICALLY_COMPATIBLE_REWORDING`
  - operator rule review required before promotion
  - no broad office-winner activation
  - no Busan tri implication
  - no Colombia tri implication

Office-exit limited-prod review packages now exist for:
- `OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31`
  - tri lane:
    - `LIMITLESS|POLYMARKET|PREDICT`
    - proposition:
      - `NETANYAHU_OUT_BEFORE_2027`
    - readiness:
      - `OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - pair lane:
    - `LIMITLESS|POLYMARKET`
    - proposition:
      - `NETANYAHU_OUT_BEFORE_2027`
    - readiness:
      - `OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- `OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31`
  - strict tri lane:
    - `LIMITLESS|OPINION|POLYMARKET`
    - proposition:
      - `TRUMP_OUT_BEFORE_2027`
    - readiness:
      - `OFFICE_EXIT_TRUMP_2026_LIMITED_PROD_READY_FOR_REVIEW`
  - peer pair lane:
    - `LIMITLESS|POLYMARKET`
    - proposition:
      - `TRUMP_OUT_BEFORE_2027`
    - readiness:
      - `OFFICE_EXIT_TRUMP_2026_LIMITED_PROD_READY_FOR_REVIEW`

Office-exit admin/operator surface now includes:
- `GET /admin/politics-office-exit-lanes`
- `GET /admin/politics-office-exit-lanes/:laneId`
- `GET /admin/politics-office-exit-lanes/:laneId/readiness`
- `GET /admin/politics-office-exit-lanes/:laneId/rollback-plan`
- `POST /admin/politics-office-exit-lanes/:laneId/operator-approval-intent`
- `POST /admin/politics-office-exit-lanes/:laneId/hold`
- `POST /admin/politics-office-exit-lanes/:laneId/rollback`

Current office-exit lane registry:
- `POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
- `POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET`
- `POLITICS_OFFICE_EXIT_TRUMP_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
- `POLITICS_OFFICE_EXIT_TRUMP_2026_PAIR_LIMITLESS_POLYMARKET`

Current office-exit operating posture:
- pair and tri are both first-class lanes when exact topic and proposition truth support them
- pair is not treated as fallback-only
- no four-venue tri implication is allowed for Trump
- no office-exit venue widening beyond the exact admitted lane
- Netanyahu remains review-gated because rule state is `SEMANTICALLY_COMPATIBLE_REWORDING`
- Trump is review-ready with `EXACT_RULE_COMPATIBLE`

Geopolitical event-by-date addendum:
- narrow geopolitical family truth is now artifact-backed for:
  - `GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30`
- current geopolitical posture:
  - tri lane:
    - `OPINION|POLYMARKET|PREDICT`
    - proposition:
      - `TRUMP_VISIT_CHINA_BY_2026_04_30`
    - readiness:
      - `GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW`
  - first-class pair lanes:
    - `OPINION|POLYMARKET`
    - `OPINION|PREDICT`
    - `POLYMARKET|PREDICT`
    - each exposes:
      - `TRUMP_VISIT_CHINA_BY_2026_04_30`
      - `GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW`
- geopolitical admin surface now exists at:
  - `GET /admin/politics-geopolitical-lanes`
  - `GET /admin/politics-geopolitical-lanes/:laneId`
  - `GET /admin/politics-geopolitical-lanes/:laneId/readiness`
  - `GET /admin/politics-geopolitical-lanes/:laneId/rollback-plan`
  - `POST /admin/politics-geopolitical-lanes/:laneId/operator-approval-intent`
  - `POST /admin/politics-geopolitical-lanes/:laneId/hold`
  - `POST /admin/politics-geopolitical-lanes/:laneId/rollback`
- current geopolitical lane ids:
  - `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_POLYMARKET`
  - `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT`
- additional geopolitical topic now advanced:
  - `GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31`
  - tri lane:
    - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
    - readiness:
      - `GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - first-class pair lanes:
    - `LIMITLESS|POLYMARKET`
    - `LIMITLESS|OPINION`
    - `LIMITLESS|PREDICT`
    - `OPINION|POLYMARKET`
    - `OPINION|PREDICT`
    - `POLYMARKET|PREDICT`
- additional geopolitical lane ids:
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_LIMITLESS_POLYMARKET`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_LIMITLESS_OPINION`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_LIMITLESS_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_OPINION_POLYMARKET`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_OPINION_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_POLYMARKET_PREDICT`
- engineering posture:
  - pair and tri are both first-class routes when exact truth supports them
  - no geopolitical venue widening beyond the exact admitted lane
  - no widening to the May/June deadline buckets
  - rollback/hold remain lane-scoped only
  - Greenland is review-gated under `SEMANTICALLY_COMPATIBLE_REWORDING` because the Opinion wording is narrower than the other venues
- crypto admin surface now exists at:
  - `GET /admin/crypto-lanes`
  - `GET /admin/crypto-lanes/:laneId`
  - `GET /admin/crypto-lanes/:laneId/readiness`
  - `GET /admin/crypto-lanes/:laneId/rollback-plan`
  - `POST /admin/crypto-lanes/:laneId/operator-approval-intent`
  - `POST /admin/crypto-lanes/:laneId/hold`
  - `POST /admin/crypto-lanes/:laneId/rollback`
- current crypto lane id:
  - `CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
- exact crypto topic now advanced:
  - `CRYPTO|ATH_BY_DATE|BTC`
- exact-safe shared date buckets:
  - `2026-06-30`
  - `2026-09-30`
  - `2026-12-31`
- current crypto readiness posture:
  - readiness:
    - `CRYPTO_BTC_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`
  - admin decision:
    - `READY_BUT_MISSING_OPERATOR_REVIEW`
- crypto operating posture:
  - explicit pair route is `LIMITLESS|POLYMARKET`
  - March `2026-03-31` remains excluded
  - no tri implication is justified
  - hold and rollback remain lane-scoped only
- crypto ATH-by-date admin surface is now multi-lane:
  - `CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
  - `CRYPTO_ETH_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
  - `CRYPTO_SOL_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
  - `CRYPTO_XRP_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
- additional exact crypto topics now advanced:
  - `CRYPTO|ATH_BY_DATE|ETH`
  - `CRYPTO|ATH_BY_DATE|SOL`
  - `CRYPTO|ATH_BY_DATE|XRP`
- ETH/SOL/XRP exact-safe shared buckets:
  - `2026-06-30`
  - `2026-09-30`
  - `2026-12-31`
- current additional crypto readiness labels:
  - `CRYPTO_ETH_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`
  - `CRYPTO_SOL_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`
  - `CRYPTO_XRP_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`

## Crypto Threshold-By-Date April 2026

- `/admin/crypto-lanes` now serves both crypto families:
  - `ATH_BY_DATE`
  - `THRESHOLD_BY_DATE`
- threshold lane ids:
  - `CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
- threshold family keys:
  - `CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30`
  - `CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30`
  - `CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30`
  - `CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30`
- exact-topic shape is comparator-aware because the live ladders contain both reach and dip contracts:
  - `...|ABOVE|<THRESHOLD>`
  - `...|BELOW|<THRESHOLD>`
- venue pair:
  - `POLYMARKET|PREDICT`
- BTC exact-safe thresholds:
  - above: `70,000`, `75,000`, `80,000`, `85,000`, `90,000`, `95,000`, `100,000`, `105,000`, `110,000`, `150,000`
  - below: `20,000`, `25,000`, `30,000`, `35,000`, `40,000`, `45,000`, `50,000`, `55,000`, `60,000`, `65,000`
  - rejected tails:
    - above `82,500`
    - below `70,000`
    - below `75,000`
  - readiness:
    - `CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_LIMITED_PROD_READY_FOR_REVIEW`
  - admin decision:
    - `READY_BUT_MISSING_OPERATOR_REVIEW`
- ETH exact-safe thresholds:
  - above: `2,200`, `2,400`, `2,600`, `2,800`, `3,000`, `3,200`, `3,400`, `3,600`, `3,800`, `4,000`
  - below: `200`, `400`, `600`, `800`, `1,000`, `1,200`, `1,400`, `1,600`, `1,800`, `2,000`
  - rejected tails:
    - none
  - readiness:
    - `CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- SOL exact-safe thresholds:
  - above: `90`, `100`, `110`, `120`, `130`, `140`, `150`, `160`
  - below: `10`, `20`, `30`, `40`, `50`, `60`, `70`
  - rejected tails:
    - above `80`
  - readiness:
    - `CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- BNB exact-safe thresholds:
  - above: `700`, `800`, `900`, `1,000`
  - below: `100`, `200`, `300`, `400`, `500`
  - rejected tails:
    - above `600`
  - readiness:
    - `CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- threshold operating posture:
  - pair-only `POLYMARKET|PREDICT`
  - no tri implication
  - no venue-only threshold widening
  - approval, hold, and rollback remain lane-scoped only

## Crypto First-To-Threshold-By-Date 2027

- `/admin/crypto-lanes` now serves three crypto families:
  - `ATH_BY_DATE`
  - `THRESHOLD_BY_DATE`
  - `FIRST_TO_THRESHOLD_BY_DATE`
- first-to-threshold lane ids:
  - `CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT`
- family keys:
  - `CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01`
  - `CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01`
  - `CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01`
- venue pair:
  - `POLYMARKET|PREDICT`
- exact-safe binary outcome cores:
  - BTC:
    - `$60k first`
    - `$80k first`
  - ETH:
    - `$1,000 first`
    - `$3,000 first`
  - SOL:
    - `$60 first`
    - `$140 first`
- exact semantics:
  - deadline `2027-01-01`
  - fallback `50/50 if neither threshold is hit`
  - single-asset first-hit resolution only
- current readiness labels:
  - `CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - `CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - `CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- first-to-threshold operating posture:
  - pair-only `POLYMARKET|PREDICT`
  - no tri implication
  - no venue widening
  - approval, hold, and rollback remain lane-scoped only
  - XRP is supported by family design but not onboarded in this pass
