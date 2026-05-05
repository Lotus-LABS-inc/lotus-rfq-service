# Pair-First Rollout Runbook

## Why Lotus Is Moving Pair-First

Lotus is moving pair-first because the clean-basis routeability audits now show:
- `LIMITLESS_OPINION = 0` in `HISTORICAL_ONLY`
- `LIMITLESS_OPINION = 0` in `LIVE_ONLY`
- `POLYMARKET_LIMITLESS_OPINION = 0` in `HISTORICAL_ONLY`
- `POLYMARKET_LIMITLESS_OPINION = 0` in `LIVE_ONLY`

That zero is no longer explained by downstream bugs, silent basis mixing, or obvious ingestion gaps. Tri remains blocked on available data, so rollout should no longer wait on tri.

## Pair Route Classes In Scope

- `PAIR_PM_LIMITLESS`
- `PAIR_PM_OPINION`

Tri is explicitly out of rollout scope for this phase.

## How Historical Vs Live Basis Affects Qualification

- `HISTORICAL_ONLY` is the authoritative simulation and backtest basis.
- `LIVE_ONLY` is the authoritative production-rollout basis.
- `MIXED_BASIS_DIAGNOSTIC` is operator-visible, but it must never drive promotion.

## How To Read Pair-Route Readiness

- `SHADOW_READY`
  - enough evidence exists to observe and audit the route class safely
  - not enough clean live evidence exists for canary
- `CANARY_READY`
  - clean live exact evidence exists for the allowed subset
- `LIMITED_PROD_READY`
  - live canary evidence and operational controls are strong enough for limited production
- `BLOCKED`
  - evidence or controls are insufficient

## Promotion Path

### Shadow

Use when:
- route class readiness is `SHADOW_READY` or better
- family/category is allowlisted for the class
- admin mutation is performed by `ADMIN + 2FA`

### Canary

Use only when:
- route class readiness is `CANARY_READY` or better
- clean `LIVE_ONLY` pair evidence exists
- family/category remains inside the canary allowlist

### Limited Production

Use only after:
- canary health is stable
- replay/reconciliation health stays clean
- demotion hooks and operator controls are validated

## Execution And Settlement Evidence Gate

Pair-first route promotion does not by itself approve live execution. Before any pair route is tested with real orders:

- deploy the backend containing the current venue adapter and settlement evidence code
- confirm `GET /admin/execution-venues` and `GET /admin/execution-venues/LIMITLESS`
- run the Limitless live-submit harness in dry/checklist mode
- run one tiny operator-approved Limitless live harness only after explicit live gates are set
- inspect the redacted harness artifact for submit result, fill state, settlement state, and `settlementVerified`
- if a route includes Predict.fun after explicit lane approval, run the Predict.fun user-signed live-submit harness first; backend must relay only a frontend Turnkey-signed payload and must not sign the order
- if a route includes Opinion, require an active manual Safe link from `POST /user/venue-accounts/opinion/complete-link`; Opinion remains prepare-only until their builder account creation and signed-relay evidence path is confirmed

Settlement rules:

- submit success is not settlement
- Limitless settlement may be verified only from `POST /orders/status/batch` evidence scoped to the active delegated profile when using server-wallet mode
- Predict.fun settlement may be verified only from venue status evidence where a final status such as `SETTLED`/`COMPLETED` has zero remaining size and matching linked-account evidence; `FILLED`/`MATCHED` alone is fill evidence, not settlement
- matched order evidence plus maker-match/trade/tx evidence plus finality such as `MINED`/settled/finalized is required for `SETTLEMENT_VERIFIED`
- unmatched, missing, stale, ambiguous, failed, or unrecognized evidence must remain pending or failed-closed
- no accounting, monetization, sellability, withdrawal availability, or completed receipt may use a leg that is not `SETTLEMENT_VERIFIED`

## When To Demote Or Block

Demote or block when:
- live basis cleanliness regresses
- venue health degrades
- replay/reconciliation drift appears
- the route leaves its allowlisted family/category
- operators lose confidence in evidence freshness or execution controls

## Precision And Provenance Interpretation

- historical exact overlaps are strong simulation evidence
- live-only exact overlaps are the only safe basis for canary/prod promotion
- mixed-basis overlaps remain diagnostic only
- near-exacts are evidence, not promotion authority

## Venue And Family Limitations

### `PAIR_PM_LIMITLESS`

- broad shadow visibility is allowed
- canary and production are restricted to the compatibility-safe exact subset
- BTC same-day directional work remains blocked and does not gate this class

### `PAIR_PM_OPINION`

- the exact BTC March 21 slice is the first promotable family
- broader PM+Opinion near-exact crypto inventory remains shadow-only or blocked

## What Remains Tri-Blocked

Tri remains blocked because:
- `LIMITLESS_OPINION` is still zero on clean bases
- the BTC tri family is not recoverable from currently available safe overlap
- pair rollout should proceed without tri as a dependency

## Politics Nominee Narrow Rollout Addendum

Politics nominee rollout is now allowed only as a narrow artifact-backed extension of the pair-first framework.

Current approved posture:
- Republican pair lane:
  - `NOMINEE|US_PRESIDENT|2028|REPUBLICAN`
  - `LIMITLESS|POLYMARKET`
  - status: `READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION`
  - candidates locked to:
    - `donald_trump`
    - `donald_trump_jr`
    - `ted_cruz`
    - `tucker_carlson`
- Republican tri lane:
  - `NOMINEE|US_PRESIDENT|2028|REPUBLICAN`
  - `LIMITLESS|OPINION|POLYMARKET`
  - status: `READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION`
  - candidates locked to:
    - `jd_vance`
    - `marco_rubio`
    - `ron_desantis`
- Democratic pair:
  - `NOMINEE|US_PRESIDENT|2028|DEMOCRATIC`
  - `LIMITLESS|POLYMARKET`
  - status: `READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION`
  - candidates locked to:
    - `alexandria_ocasio_cortez`
    - `andy_beshear`
    - `gavin_newsom`
    - `josh_shapiro`
    - `kamala_harris`
    - `pete_buttigieg`

Operational rules:
- pair remains preferred overall
- tri is allowed only for the narrow Republican subset above
- no Democratic tri implication is allowed from this addendum
- no Democratic Opinion lane is allowed from this addendum
- Republican tri must be offered only through exact-scope per-run consent:
  - mint `POST /rfq/:id/execution-scope-token`
  - pass the returned token into `POST /rfq/:id/accept`
  - fail closed if live admin authority, venue set, or candidate set drifted
- `Others`, venue-only tails, and unknown/composite outcomes remain excluded
- operator action must be lane-scoped, not broad-politics scoped
- Republican tri rollback must fall back to the Republican pair lane, not broad disable-only
- Democratic pair rollback must return to lane hold/internal-only, not category-wide disable

Politics nominee admin/operator surface:
- `GET /admin/politics-nominee-lanes`
- `GET /admin/politics-nominee-lanes/:laneId`
- `GET /admin/politics-nominee-lanes/:laneId/readiness`
- `GET /admin/politics-nominee-lanes/:laneId/canary-gates`
- `GET /admin/politics-nominee-lanes/:laneId/rollback-plan`
- `POST /admin/politics-nominee-lanes/:laneId/operator-approval-intent`
- `POST /admin/politics-nominee-lanes/:laneId/hold`
- `POST /admin/politics-nominee-lanes/:laneId/rollback`

Mutation rules:
- `ADMIN + 2FA` required
- narrowest supported control is lane-level scope lock
- no broad-politics enable switch is available from this surface

Office-winner narrow review package:
- topic: `OFFICE_WINNER|USA|US_PRESIDENT|2028`
- pair: `LIMITLESS|POLYMARKET`
- candidate scope:
  - `alexandria_ocasio_cortez`
  - `donald_trump`
  - `gavin_newsom`
  - `jd_vance`
  - `josh_shapiro`
  - `kamala_harris`
  - `marco_rubio`
- readiness label: `OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- rule state: `SEMANTICALLY_COMPATIBLE_REWORDING`
- operator rule review is required before promotion
- no tri implication or venue widening is allowed
- hold / rollback stay lane-aware and return this lane to internal-only

Additional office-winner narrow review packages:
- Seoul tri:
  - topic: `OFFICE_WINNER|SEOUL|MAYOR|2026`
  - venues: `LIMITLESS|OPINION|POLYMARKET`
  - candidate scope:
    - `chong_won_oh`
    - `na_kyung_won`
    - `oh_se_hoon`
    - `park_ju_min`
  - readiness label: `OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - explicit pair fallback:
    - `LIMITLESS|POLYMARKET`
- Seoul pair:
  - topic: `OFFICE_WINNER|SEOUL|MAYOR|2026`
  - venues: `LIMITLESS|POLYMARKET`
  - posture:
    - separate limited-prod pair choice
    - no user-scope widening into tri
- Busan pair:
  - topic: `OFFICE_WINNER|BUSAN|MAYOR|2026`
  - venues: `LIMITLESS|POLYMARKET`
  - readiness label: `OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- Colombia pair:
  - topic: `OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026`
  - venues: `LIMITLESS|POLYMARKET`
  - readiness label: `OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`

Office-winner local-lane operating rules:
- rule state for current Seoul/Busan/Colombia lanes remains `SEMANTICALLY_COMPATIBLE_REWORDING`
- operator rule review is required before promotion
- no venue widening beyond the exact lane
- no candidate widening beyond the exact shared core
- Busan has no tri implication
- Colombia has no tri implication
- rollback remains lane-aware only

## Office-Exit Narrow Review Addendum

Office-exit now follows the same lane-scoped posture:

- Netanyahu:
  - topic:
    - `OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31`
  - tri lane:
    - `LIMITLESS|POLYMARKET|PREDICT`
  - pair lane:
    - `LIMITLESS|POLYMARKET`
  - proposition:
    - `NETANYAHU_OUT_BEFORE_2027`
  - readiness:
    - `OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`

- Trump:
  - topic:
    - `OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31`
  - strict tri lane:
    - `LIMITLESS|OPINION|POLYMARKET`
  - peer pair lane:
    - `LIMITLESS|POLYMARKET`
  - proposition:
    - `TRUMP_OUT_BEFORE_2027`
  - readiness:
    - `OFFICE_EXIT_TRUMP_2026_LIMITED_PROD_READY_FOR_REVIEW`

Office-exit operating rules:
- pair and tri may both be surfaced as first-class lanes when exact topic and proposition truth support them
- pair must remain separately offerable for users who do not want tri
- no silent four-venue tri implication is allowed for Trump
- no widening beyond the exact office-exit topic, exact venue set, and exact proposition
- rollback remains lane-scoped

Office-exit admin/operator surface:
- `GET /admin/politics-office-exit-lanes`
- `GET /admin/politics-office-exit-lanes/:laneId`
- `GET /admin/politics-office-exit-lanes/:laneId/readiness`
- `GET /admin/politics-office-exit-lanes/:laneId/rollback-plan`
- `POST /admin/politics-office-exit-lanes/:laneId/operator-approval-intent`
- `POST /admin/politics-office-exit-lanes/:laneId/hold`
- `POST /admin/politics-office-exit-lanes/:laneId/rollback`

Current office-exit lane ids:
- `POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT`
- `POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET`
- `POLITICS_OFFICE_EXIT_TRUMP_2026_TRI_LIMITLESS_OPINION_POLYMARKET`
- `POLITICS_OFFICE_EXIT_TRUMP_2026_PAIR_LIMITLESS_POLYMARKET`

## Geopolitical Event-By-Date Narrow Review Addendum

Geopolitical event-by-date now follows the same lane-scoped posture:

- Trump visits China by April 30, 2026:
  - topic:
    - `GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30`
  - primary tri lane:
    - `OPINION|POLYMARKET|PREDICT`
  - first-class pair lanes:
    - `OPINION|POLYMARKET`
    - `OPINION|PREDICT`
    - `POLYMARKET|PREDICT`
  - proposition:
    - `TRUMP_VISIT_CHINA_BY_2026_04_30`
  - readiness:
    - `GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW`

Geopolitical operating rules:
- pair and tri may both be surfaced as first-class lanes when exact topic, proposition, and deadline truth support them
- pair must remain separately offerable for users who do not want tri
- no widening beyond the exact geopolitical topic, exact venue set, and exact proposition
- no widening to the May/June deadline buckets
- no `LIMITLESS` or `MYRIAD` implication for this topic
- rollback remains lane-scoped

Geopolitical admin/operator surface:
- `GET /admin/politics-geopolitical-lanes`
- `GET /admin/politics-geopolitical-lanes/:laneId`
- `GET /admin/politics-geopolitical-lanes/:laneId/readiness`
- `GET /admin/politics-geopolitical-lanes/:laneId/rollback-plan`
- `POST /admin/politics-geopolitical-lanes/:laneId/operator-approval-intent`
- `POST /admin/politics-geopolitical-lanes/:laneId/hold`
- `POST /admin/politics-geopolitical-lanes/:laneId/rollback`

Current geopolitical lane ids:
- `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT`
- `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_POLYMARKET`
- `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_PREDICT`
- `POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT`

Additional geopolitical lane set:
- topic:
  - `GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31`
- tri lane:
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - readiness:
    - `GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- first-class pair lanes:
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_LIMITLESS_POLYMARKET`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_LIMITLESS_OPINION`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_LIMITLESS_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_OPINION_POLYMARKET`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_OPINION_PREDICT`
  - `POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_POLYMARKET_PREDICT`
- proposition:
  - `TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31`
- rule state:
  - `SEMANTICALLY_COMPATIBLE_REWORDING`
- operating rule:
  - keep pair and tri as separate first-class routes
  - no widening beyond the exact Greenland topic
  - no `MYRIAD` implication

## Sports EPL Narrow Review Addendum

Sports now has one exact lane-scoped extension of the rollout model:

- Topic:
  - `SPORTS|LEAGUE_WINNER|EPL|2025_2026`
- All-venue lane:
  - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - exact-safe clubs:
    - `arsenal`
    - `liverpool`
    - `manchester_city`
  - readiness:
    - `SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- Pair lane:
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

Sports EPL operating rules:
- pair and all-venue may both be surfaced as first-class lanes when exact topic and club truth support them
- pair must remain separately offerable for users who do not want the all-venue route
- no widening beyond the exact `SPORTS|LEAGUE_WINNER|EPL|2025_2026` topic

Additional sports winner/tournament lane sets:

- La Liga:
  - topic:
    - `SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026`
  - strict-all lane:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - primary pair lane:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`

- Champions League:
  - topic:
    - `SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026`
  - strict-all lane:
    - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - primary pair lane:
    - `SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET`

- World Cup:
  - topic:
    - `SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026`
  - strict-all lane:
    - `SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - primary pair lane:
    - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_POLYMARKET`

- NBA Champion:
  - topic:
    - `SPORTS|TOURNAMENT_WINNER|NBA|2025_2026`
  - strict-all lane:
    - `SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - primary pair lane:
    - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_POLYMARKET_PREDICT`

- F1 Drivers Champion:
  - topic:
    - `SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026`
  - strict-all lane:
    - `SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - primary pair lane:
    - `SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET`
  - pair exact-safe drivers:
    - `charles_leclerc`
    - `fernando_alonso`
    - `george_russell`
    - `kimi_antonelli`
    - `lando_norris`
    - `lewis_hamilton`
    - `max_verstappen`
    - `oscar_piastri`
  - strict-all exact-safe drivers:
    - `george_russell`
    - `lando_norris`
    - `max_verstappen`
    - `oscar_piastri`
  - readiness:
    - `SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`

Sports admin/operator surface:
- `GET /admin/sports-lanes`
- `GET /admin/sports-lanes/:laneId`
- `GET /admin/sports-lanes/:laneId/readiness`
- `GET /admin/sports-lanes/:laneId/rollback-plan`
- `GET /admin/sports-lanes/:laneId/authority-state`
- `POST /admin/sports-lanes/:laneId/operator-approval-intent`
- `POST /admin/sports-lanes/:laneId/hold`
- `POST /admin/sports-lanes/:laneId/rollback`
- strict all-venue core remains exactly 3 clubs
- venue-only tails remain excluded
- rollback remains lane-scoped

Sports admin/operator surface:
- `GET /admin/sports-lanes`
- `GET /admin/sports-lanes/:laneId`
- `GET /admin/sports-lanes/:laneId/readiness`
- `GET /admin/sports-lanes/:laneId/rollback-plan`
- `POST /admin/sports-lanes/:laneId/operator-approval-intent`
- `POST /admin/sports-lanes/:laneId/hold`
- `POST /admin/sports-lanes/:laneId/rollback`

## Sports La Liga Narrow Review Addendum

Sports now also has an exact lane-scoped La Liga extension of the rollout model:

- Topic:
  - `SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026`
- All-venue lane:
  - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - exact-safe clubs:
    - `atletico_madrid`
    - `barcelona`
    - `real_madrid`
  - readiness:
    - `SPORTS_LA_LIGA_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- Pair lane:
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

Sports La Liga operating rules:
- pair and all-venue may both be surfaced as first-class lanes when exact topic and club truth support them
- pair must remain separately offerable for users who do not want the all-venue route
- no widening beyond the exact `SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026` topic
- strict all-venue core remains exactly 3 clubs
- venue-only tails remain excluded
- rollback remains lane-scoped

## Sports Lane Cardinality Addendum

Sports now uses an explicit route ladder:
- `SINGLE`
- `PAIR`
- `TRI`
- `STRICT_ALL`

Operating rules:
- safety preference order is:
  - `STRICT_ALL > TRI > PAIR > SINGLE`
- lower-cardinality lanes may still be offered as first-class routes
- `SINGLE` remains fail-closed:
  - `Others` excluded
  - unknown/composite outcomes excluded
- `/admin/sports-lanes` is dynamic and exposes generated lane ids from the matcher lane catalogs

Current completed sports topics under this model:
- `SPORTS|LEAGUE_WINNER|EPL|2025_2026`
- `SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026`
- `SPORTS|TOURNAMENT_WINNER|NBA|2025_2026`
- `SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026`
- `SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026`

Per-topic lane counts:
- `4` single
- `6` pair
- `4` tri
- `1` strict_all

Generated lane ids:
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
- F1 Constructors Champion:
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_SINGLE_LIMITLESS`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_SINGLE_OPINION`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_SINGLE_POLYMARKET`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_LIMITLESS_OPINION`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_OPINION_POLYMARKET`
  - `SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_TRI_LIMITLESS_OPINION_POLYMARKET`

## Sports World Cup Narrow Review Addendum

Sports now also has an exact lane-scoped FIFA World Cup extension of the rollout model:

- Topic:
  - `SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026`
- Strict-all lane:
  - `LIMITLESS|OPINION|POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT`
  - exact-safe teams:
    - `brazil`
    - `england`
    - `france`
    - `spain`
  - readiness:
    - `SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
- Pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe teams:
    - `argentina`
    - `belgium`
    - `brazil`
    - `croatia`
    - `england`
    - `france`
    - `germany`
    - `italy`
    - `mexico`
    - `netherlands`
    - `portugal`
    - `spain`
    - `united_states`
    - `uruguay`
  - readiness:
    - `SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`

Sports World Cup operating rules:
- pair and strict-all may both be surfaced as first-class lanes when exact topic and team truth support them
- pair must remain separately offerable for users who do not want the strict-all route
- no widening beyond the exact `SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026` topic
- strict all-venue core remains exactly 4 teams
- venue-only tails remain excluded
- rollback remains lane-scoped

## Sports NBA Champion Narrow Review Addendum

Sports now also has an exact lane-scoped NBA champion extension of the rollout model:

- Topic:
  - `SPORTS|TOURNAMENT_WINNER|NBA|2025_2026`
- Strict-all lane:
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
- Pair lane:
  - `POLYMARKET|PREDICT`
  - lane id:
    - `SPORTS_NBA_CHAMPION_2025_2026_PAIR_POLYMARKET_PREDICT`
  - exact-safe teams:
    - `30` team matcher-backed scope
  - readiness:
    - `SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`

Sports NBA operating rules:
- pair and strict-all may both be surfaced as first-class lanes when exact topic and team truth support them
- pair must remain separately offerable for users who do not want the strict-all route
- no widening beyond the exact `SPORTS|TOURNAMENT_WINNER|NBA|2025_2026` topic
- strict all-venue core remains exactly 4 teams
- venue-only tails remain excluded
- rollback remains lane-scoped

## Sports F1 Constructors Champion Narrow Review Addendum

- Topic:
  - `SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026`
- Tri lane:
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
- Pair lane:
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

Sports F1 Constructors operating rules:
- pair and tri may both be surfaced as first-class lanes when exact constructor truth supports them
- no widening beyond the exact `SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026` topic
- no invented Predict lane until venue truth exists
- venue-only tails remain excluded
- rollback remains lane-scoped

## Sports LPL Winner Narrow Review Addendum

- Topic:
  - `SPORTS|LEAGUE_WINNER|LPL|2026`
- Tri lane:
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
- Pair lane:
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

Sports LPL operating rules:
- pair and tri may both be surfaced as first-class lanes when exact team truth supports them
- no widening beyond the exact `SPORTS|LEAGUE_WINNER|LPL|2026` topic
- `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
- venue-only tails remain excluded
- rollback remains lane-scoped

## Sports NHL Stanley Cup Narrow Review Addendum

- Topic:
  - `SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026`
- Tri lane:
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
- Pair lane:
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

Sports NHL Stanley Cup operating rules:
- pair and tri may both be surfaced as first-class lanes when exact team truth supports them
- no widening beyond the exact `SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026` topic
- `SEMANTICALLY_COMPATIBLE_REWORDING` remains review-gated
- no strict-all lane is justified
- rollback remains lane-scoped

## Crypto BTC ATH-by-Date

- Admin namespace:
  - `GET /admin/crypto-lanes`
  - `GET /admin/crypto-lanes/:laneId`
  - `GET /admin/crypto-lanes/:laneId/readiness`
  - `GET /admin/crypto-lanes/:laneId/rollback-plan`
  - `GET /admin/crypto-lanes/:laneId/authority-state`
  - `POST /admin/crypto-lanes/:laneId/operator-approval-intent`
  - `POST /admin/crypto-lanes/:laneId/hold`
  - `POST /admin/crypto-lanes/:laneId/rollback`
- Topic:
  - `CRYPTO|ATH_BY_DATE|BTC`
- Pair lane:
  - `LIMITLESS|POLYMARKET`
  - lane id:
    - `CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
  - exact-safe shared buckets:
    - `2026-06-30`
    - `2026-09-30`
    - `2026-12-31`
  - readiness:
    - `CRYPTO_BTC_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`
  - admin decision:
    - `READY_BUT_MISSING_OPERATOR_REVIEW`

Crypto BTC ATH-by-date operating rules:
- no widening beyond the exact shared `LIMITLESS|POLYMARKET` date buckets
- March `2026-03-31` remains excluded as a non-shared tail
- no tri implication is justified from current truth
- approval, hold, and rollback remain lane-scoped only

## Crypto ETH/SOL/XRP ATH-by-Date

- Admin namespace:
  - `GET /admin/crypto-lanes`
  - `GET /admin/crypto-lanes/:laneId`
  - `GET /admin/crypto-lanes/:laneId/readiness`
  - `GET /admin/crypto-lanes/:laneId/rollback-plan`
  - `POST /admin/crypto-lanes/:laneId/operator-approval-intent`
  - `POST /admin/crypto-lanes/:laneId/hold`
  - `POST /admin/crypto-lanes/:laneId/rollback`
- Topics:
  - `CRYPTO|ATH_BY_DATE|ETH`
  - `CRYPTO|ATH_BY_DATE|SOL`
  - `CRYPTO|ATH_BY_DATE|XRP`
- Pair lanes:
  - `CRYPTO_ETH_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
  - `CRYPTO_SOL_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
  - `CRYPTO_XRP_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET`
- Exact-safe shared buckets on current truth:
  - `2026-06-30`
  - `2026-09-30`
  - `2026-12-31`
- Readiness:
  - `CRYPTO_ETH_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`
  - `CRYPTO_SOL_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`
  - `CRYPTO_XRP_ATH_BY_DATE_LIMITED_PROD_READY_FOR_REVIEW`

Crypto ETH/SOL/XRP ATH-by-date operating rules:
- no widening beyond the exact shared `LIMITLESS|POLYMARKET` date buckets
- March `2026-03-31` remains excluded wherever it is not shared
- no tri implication is justified from current truth
- approval, hold, and rollback remain lane-scoped only

## Crypto Threshold-By-Date April 2026

- Admin namespace remains:
  - `GET /admin/crypto-lanes`
  - `GET /admin/crypto-lanes/:laneId`
  - `GET /admin/crypto-lanes/:laneId/readiness`
  - `GET /admin/crypto-lanes/:laneId/rollback-plan`
  - `POST /admin/crypto-lanes/:laneId/operator-approval-intent`
  - `POST /admin/crypto-lanes/:laneId/hold`
  - `POST /admin/crypto-lanes/:laneId/rollback`
- Families:
  - `CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30`
  - `CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30`
  - `CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30`
  - `CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30`
- Lane ids:
  - `CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT`
- Venue pair:
  - `POLYMARKET|PREDICT`
- Exact-topic rule:
  - the live ladders include both reach and dip contracts, so the internal exact key must remain comparator-aware:
    - `...|ABOVE|<THRESHOLD>`
    - `...|BELOW|<THRESHOLD>`
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

Crypto threshold-by-date operating rules:
- pair-only `POLYMARKET|PREDICT`
- no tri implication
- no venue-only threshold widening
- approval, hold, and rollback remain lane-scoped only

## Crypto First-To-Threshold-By-Date 2027

- Admin namespace remains:
  - `GET /admin/crypto-lanes`
  - `GET /admin/crypto-lanes/:laneId`
  - `GET /admin/crypto-lanes/:laneId/readiness`
  - `GET /admin/crypto-lanes/:laneId/rollback-plan`
  - `POST /admin/crypto-lanes/:laneId/operator-approval-intent`
  - `POST /admin/crypto-lanes/:laneId/hold`
  - `POST /admin/crypto-lanes/:laneId/rollback`
- Family keys:
  - `CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01`
  - `CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01`
  - `CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01`
- Lane ids:
  - `CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT`
- Venue pair:
  - `POLYMARKET|PREDICT`
- Exact semantics:
  - lower-threshold-first vs higher-threshold-first binary market
  - deadline `2027-01-01`
  - fallback `50/50 if neither threshold is hit`
- Exact-safe binary cores:
  - BTC:
    - `$60k first`
    - `$80k first`
  - ETH:
    - `$1,000 first`
    - `$3,000 first`
  - SOL:
    - `$60 first`
    - `$140 first`
- Readiness:
  - `CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - `CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
  - `CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`

Crypto first-to-threshold operating rules:
- pair-only `POLYMARKET|PREDICT`
- no tri implication
- no venue widening
- ambiguous tie handling remains operator-reviewed
- approval, hold, and rollback remain lane-scoped only
- XRP is supported by family design but not onboarded in this pass

## Crypto FDV Threshold After Launch

- Admin namespace remains `/admin/crypto-lanes`.
- Family keys:
  - `CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH`
  - `CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|METAMASK|ONE_DAY_AFTER_LAUNCH`
  - `CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|OPENSEA|ONE_DAY_AFTER_LAUNCH`
  - `CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|REYA|ONE_DAY_AFTER_LAUNCH`
- Lane ids:
  - `CRYPTO_EXTENDED_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_METAMASK_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_OPENSEA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_REYA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT`
- Venue pair:
  - `POLYMARKET|PREDICT`
- Exact-safe shared FDV thresholds:
  - Extended: `$150M`, `$300M`, `$500M`, `$800M`, `$1B`, `$2B`, `$3B`
  - MetaMask: `$700M`, `$1B`, `$2B`, `$3B`, `$4B`
  - OpenSea: `$500M`, `$1B`, `$2B`, `$3B`, `$5B`
  - Reya: `$150M`, `$200M`, `$300M`, `$400M`, `$1B`
- Excluded non-shared tails:
  - MetaMask Polymarket-only `$300M`, `$500M`
  - OpenSea Polymarket-only duplicate `$100M` and `$300M`
  - Reya Polymarket-only `$70M`
- Opinion-backed tri lanes are not materialized unless Opinion rows are fetched and normalized exactly.
- Approval, hold, and rollback remain lane-scoped only.

## Crypto Token Launch By Date

- Admin namespace remains `/admin/crypto-lanes`.
- Family keys:
  - `CRYPTO|TOKEN_LAUNCH_BY_DATE|METAMASK`
  - `CRYPTO|TOKEN_LAUNCH_BY_DATE|BASE`
- Lane ids:
  - `CRYPTO_METAMASK_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT`
  - `CRYPTO_BASE_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT`
- Venue pair:
  - `POLYMARKET|PREDICT`
- Exact-safe shared launch dates:
  - MetaMask: `2025-12-31`, `2026-06-30`, `2026-09-30`
  - Base: `2026-06-30`, `2026-12-31`
- Excluded non-shared dates:
  - Base `2025-12-31` remains excluded from the Predict-backed pair because the supplied Predict URL is the 2026 family.
- Opinion-backed tri lanes are not materialized unless Opinion rows are fetched and normalized exactly.
- Approval, hold, and rollback remain lane-scoped only.

## Minimal Operator Review Gate

The current sports and crypto market lanes remain review-gated until a lane-scoped operator approval intent exists. The gate is exposed through:

- `GET /admin/sports-lanes/:laneId/authority-state`
- `GET /admin/crypto-lanes/:laneId/authority-state`

Execution-scope tokens now support `SPORTS_LANE` and `CRYPTO_LANE` scopes. Token issuance and validation fail closed unless:

- the latest lane-scoped promotion event is `OPERATOR_APPROVAL_INTENT`
- the lane readiness decision is still `READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION` or the legacy-equivalent `READY_BUT_MISSING_OPERATOR_REVIEW`
- the live venue set still matches the token and the actual execution route
- the live candidate set still matches the token

Any later hold or rollback event becomes the latest lane event and clears `operatorApprovedToOffer`, which blocks new tokens and invalidates stale ones before execution.

Temporary bootstrap note:

- `npm run admin:bootstrap-approve-market-lanes -- --dry-run` can be used only for this dev/staging bootstrap pass while the frontend approval surface is unavailable.
- The script uses the same admin services as the API, skips already-approved lanes, and refuses non-local DB hosts unless `--allow-non-local` is explicitly passed.
- Do not use the script as the long-term production approval workflow; production operator review should use the audited admin UI/API routes.
