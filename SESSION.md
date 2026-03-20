# Lotus RFQ Service — Session Log

> This file tracks all development sessions, changes made, and context for resuming work.
> Updated incrementally as each step is taken.

---

## Session: 2026-03-14 (Simulation Console Refinement)

**Goal:** Refine the Historical Simulation Console admin UI for seamless internal testing.

**Dev server:** `npm run dev` → `http://localhost:3000`
**Console URL:** `http://localhost:3000/admin/simulation-console`

---

### Context / Project State at Session Start
- Phase 1 (Internal Crossing Engine) — ✅ Live
- Phase 2A (Resolution Risk Netting Gating) — ✅ Complete
- Phase 3 (SOR Integration) — ✅ Complete
- Phase 4 (Historical Simulation Console) — 🔧 In progress (this session)

The simulation console existed but had three main issues:
1. `Canonical Market ID` was a free-text input (error-prone)
2. `Refresh Scopes` and `Refresh Canonical` required manual button clicks
3. Clicking `Run Simulation` returned a 500 error: `"Failed to trigger historical simulation run"`

---

### Changes Made This Session

#### [2026-03-14] Market ID Dropdown — `src/api/admin/simulation-console.page.ts`
- Replaced free-text `<input>` for `Canonical Market ID` with a `<select>` dropdown
- Dropdown is auto-populated from `resolutionRiskInspection.profiles[].canonicalMarketId` returned by `GET /admin/simulation/canonical/:eventId`
- Renders as `<option>` elements per unique market ID found in profiles

#### [2026-03-14] Auto-Refresh Scopes — `src/api/admin/simulation-console.page.ts`
- `loadScopes()` now called automatically on page load
- Added `onChange` listener to `Market Class` select — triggers `loadScopes()` automatically

#### [2026-03-14] Auto-Refresh Canonical — `src/api/admin/simulation-console.page.ts`
- Added `onChange` listener to `Canonical Event` select — triggers `loadCanonical()` automatically
- Time range inputs (`from`/`to`) are auto-filled from venue coverage start/end dates

#### [2026-03-14] Timezone Fix — `src/api/admin/simulation-console.page.ts`
- **Root cause:** `toISOString().slice(0,16)` doesn't account for local timezone offset in `datetime-local` inputs, causing the simulation window to shift by user's UTC offset (1 hour in GMT+1)
- **Fix:** Apply `date.getTimezoneOffset()` adjustment before writing to the input field:
  ```js
  const toLocalString = (date) => new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0,16);
  ```

#### [2026-03-14] Identity Guard HTML Rendering — `src/api/admin/simulation-console.page.ts`
- **Root cause:** `kv()` helper was HTML-escaping all values, causing `<span class="badge danger">` to print as raw escaped text
- **Fix:** Added optional 3rd element `raw = true` in kv item arrays to bypass escaping for badge HTML:
  ```js
  ["Identity Guard", badge("MULTIPLE_MARKETS", "danger"), true]
  ```

#### [2026-03-14] canonicalMarketId in Run Schema — `src/api/admin/simulation.routes.ts`
- Added `canonicalMarketId: z.string().optional()` to `runBodySchema`
- Passes `canonicalMarketId` from request body to `simulationAdminService.runSimulation()`
- Added specific `catch` for `HistoricalSimulationRunnerError` → returns HTTP 400 with `SIMULATION_RUNNER_ERROR` instead of 500
- Added `ambiguity` field to `canonicalCoverageResponseSchema` and `serializeCanonicalCoverage()`

#### [2026-03-14] Admin Service Update — `src/api/admin/simulation-admin-service.ts`
- `SimulationRunInput` interface: added `canonicalMarketId?: string | null`
- `runSimulation()`: passes `canonicalMarketId` to `historicalSimulationRunner.run()`
- `loadResolutionRiskSnapshotByTimestamp()`: filters assessments by `canonicalMarketId` when provided

#### [2026-03-14] SQL Filter by canonical_market_id — `src/simulation/historical-simulation-runner.ts`
- **Root cause of 500 error:** baseline evaluator was receiving multiple venue market IDs for the same venue under one canonical event (e.g. `polymarket-crypto-btc-60k` + `polymarket-crypto-btc-90k-deprecated`), triggering `ambiguous_venue_scope`
- **Fix:** Added `AND ($4::text IS NULL OR canonical_market_id = $4)` to `loadHistoricalStates()` SQL query
- When a specific market ID is selected in the UI, only matching historical states are loaded

#### [2026-03-14] Database Migrations
- `sql/migrations/2026_03_14_add_historical_canonical_market_id.sql` — adds `canonical_market_id TEXT` to `historical_market_states`
- `sql/migrations/2026_03_14_add_resolution_canonical_market_id.sql` — adds `canonical_market_id TEXT` to `resolution_profiles` and `resolution_risk_assessments`, updates unique constraints

#### [2026-03-14] Seeding — `scripts/seed-simulation-console-preview.ts`
- Updated all `HistoricalMarketState` seeded rows to include `canonicalMarketId`
- Added resolution profiles: `BTC-90K` (Polymarket + Limitless pairing), `BTC-90K-LEGACY` (deprecated Polymarket contract)
- Added `SAFE_EQUIVALENT` assessment between BTC-90K Polymarket ↔ Limitless profiles
- Added `scripts/seed-db.js` as emergency fallback for seeding directly via Node when tsx timeout issues arise

---

### Known Remaining Issues / TODOs

| # | Issue | Status |
|---|---|---|
| 1 | Remove debug `console.log` lines from `simulation-admin-service.ts` and `historical-simulation-runner.ts` | ⬜ TODO |
| 2 | Delete `scripts/seed-db.js` (temp seeding utility) | ⬜ TODO |
| 3 | Resolution Risk shows "Stale / Incomplete" — freshness check likely seeing `expectedPairCount = 0` | ⬜ Investigate |
| 4 | Verify Sports event simulation works the same way with the new `canonicalMarketId` filter | ⬜ TODO |
| 5 | Confirm dropdown population works in production with live `resolution_profiles` data | ⬜ TODO |

---

### Architecture Notes

| Layer | Details |
|---|---|
| Database | Supabase (PostgreSQL) via `pg` Pool. `DATABASE_URL` in `.env` |
| Auth | Admin routes protected by `adminMiddleware` (JWT via `@fastify/jwt`) |
| Frontend | Zero-dependency Vanilla JS embedded as `clientScript` template string in `simulation-console.page.ts`. No build step required. |
| Simulation | `HistoricalSimulationRunner` loads states from `historical_market_states`, groups into slices by timestamp, evaluates each slice against Polymarket/Limitless baselines and the Lotus pricing engine |
| Seeding | `scripts/seed-simulation-console-preview.ts` — run via `npx tsx scripts/seed-simulation-console-preview.ts`. Requires `DATABASE_URL` env var. |

---

### Key Canonical Event IDs (Dev/Preview)

| Event | ID | Category | Market IDs |
|---|---|---|---|
| Sports preview event | `11111111-1111-4111-8111-111111111111` | SPORTS | N/A |
| Crypto preview event | `22222222-2222-4222-8222-222222222222` | CRYPTO | `BTC-90K`, `BTC-90K-LEGACY` |

---

---

## Liquidity Cost Model

### Why It Was Implemented

When Lotus internalises a trade (i.e. crosses a buyer and seller internally rather than routing to an external venue), it takes on a **settlement lag risk**. This is the risk that between the time of internalisation and the time both legs actually settle, the venues resolve differently.

Even if two markets are assessed as `SAFE_EQUIVALENT` (i.e. same oracle, same rules, same intent), there can be a **delay differential** between when Market A settles vs when Market B settles. During that window, Lotus holds an open net position. Capital is locked up, and in a sufficiently liquid venue like Polymarket or Limitless, that locked capital has a measurable cost.

The **Liquidity Cost** metric was implemented to:
1. **Quantify** the drag on capital from settlement lag in basis-point terms, per pair, per assessment
2. **Gate** pooling decisions — pairs with high liquidity cost get a CAUTION or worse classification
3. **Surface** this cost clearly in the Simulation Console so that strategy decisions are informed by real timing data

---

### How It Is Calculated

**File:** `src/core/rfq-engine/resolution-risk-scoring-engine.ts`

The calculation happens inside the `score()` method of `ResolutionRiskScoringEngine`:

```typescript
// Step 1: Calculate max settlement delay between the two profiles
const maxSettlementDelayHours = this.calculateMaxSettlementDelay(profileA, profileB);

// Step 2: Apply 15% APY base liquidity premium to the delay
const annualRate = new Decimal(0.15);
const liquidityCost = maxSettlementDelayHours > 0
    ? annualRate.times(maxSettlementDelayHours).div(8760)
    : new Decimal(0);
```

**`calculateMaxSettlementDelay()`**:
```typescript
private calculateMaxSettlementDelay(profileA, profileB): number {
    const profileAMaxDelay = Number(profileA.disputeWindowHours ?? 0) + Number(profileA.settlementLagHours ?? 0);
    const profileBMaxDelay = Number(profileB.disputeWindowHours ?? 0) + Number(profileB.settlementLagHours ?? 0);
    return Math.abs(profileAMaxDelay - profileBMaxDelay);
}
```

The delay is the **absolute difference** in total settlement time between the two venues:
- `disputeWindowHours` — how long the venue allows a settlement challenge
- `settlementLagHours` — how long after resolution until funds actually clear

So for example:
- Polymarket: `disputeWindowHours = 24h`, `settlementLagHours = 12h` → total = **36h**
- Limitless: `disputeWindowHours = 0h`, `settlementLagHours = 2h` → total = **2h**
- `maxSettlementDelayHours = |36 - 2| = 34h`

Then:
```
liquidityCost = 0.15 × (34 / 8760) = 0.000582 = 0.0582%
```

This represents ~5.82 basis points of capital cost dragged on each unit of notional by the delayed settlement.

---

### Formula Summary

```
liquidityCost = annualRate × (maxSettlementDelayHours / hoursPerYear)

Where:
  annualRate = 0.15  (15% APY base liquidity premium)
  hoursPerYear = 8760
  maxSettlementDelayHours = |totalDelayA - totalDelayB|
  totalDelay = disputeWindowHours + settlementLagHours
```

Result is stored as a decimal string (e.g. `"0.000582"`) on `ResolutionRiskAssessment.liquidityCost`.

---

### How It Is Surfaced

**In the database:** `resolution_risk_assessments.liquidity_cost` (a `TEXT` column storing the decimal).

**In the API:** `GET /admin/simulation/canonical/:eventId` → `resolutionRiskInspection.assessments[0].liquidityCost`

**In the Simulation Console UI:** (`src/api/admin/simulation-console.page.ts`)
```
Liquidity Cost: 0.0582%
```
The UI renders it as a percentage:
```js
(Number(inspection.assessments?.[0]?.liquidityCost ?? 0) * 100).toFixed(4) + "%"
```

---

### Identity Guard Integration

The scoring engine also includes a hard **Identity Guard** check for market identity mismatches:

```typescript
// If the two profiles belong to different canonical markets, hard-block
if (profileA.canonicalMarketId !== profileB.canonicalMarketId) {
    return {
        equivalenceClass: "DO_NOT_POOL",
        reasons: [`Market identity mismatch: ${profileA.canonicalMarketId} vs ${profileB.canonicalMarketId}`],
        liquidityCost: "0",
        ...
    };
}
```

This prevents a scenario where `BTC-90K-LEGACY` (deprecated, different wording) pairs with `BTC-90K` (current) from being incorrectly assessed as safe just because they share the same `canonicalEventId`.

The `ResolutionRiskEligibilityService` (`src/core/rfq-engine/resolution-risk-eligibility-service.ts`) enforces this further at the pooling decision layer:

```typescript
// Extra guard: reject pairing if canonicalMarketId from assessment doesn't match the requested context
if (context?.canonicalMarketId && assessment.canonicalMarketId !== context.canonicalMarketId) {
    return this.applyPolicy(false, undefined, `identity_mismatch: expected ${context.canonicalMarketId}, found ${assessment.canonicalMarketId}`, ...);
}
```

---

### Design Decisions

| Decision | Rationale |
|---|---|
| **15% APY base rate** | Reflects a reasonable opportunity cost of capital in the prediction market space, aligned with typical DeFi liquidity premium assumptions at the time of implementation |
| **Absolute delay diff, not max** | We care about the *difference* in when the two legs settle — it's that gap during which Lotus holds the open net position, not the total absolute delay of either |
| **liquidityCost = 0 when delay = 0** | If both markets settle at the same time (zero lag differential), there is no capital drag, so cost is 0 |
| **Cost stored as decimal, not BPS** | Keeps it precise and easy to multiply against notional in downstream risk calculations |
| **Clamped to [0, 1]** | The `serializeClampedDecimal` utility ensures no rounding artefacts produce impossible cost values |

---

*This file is maintained by the AI pair programmer. Append new entries below under a new `## Session:` heading when starting a new session.*

## Session: 2026-03-18 (Category Expansion And Canonical Market Labeling)

**Goal:** Expand the internal historical simulation console beyond sports/crypto so local testing can cover politics and esports, including submarket-level canonical data and clearer market labeling.

## Session: 2026-03-20 (Canonical Graph Bootstrap Cutover)

**Goal:** Make the canonical graph the authored identity layer for live bootstrap/canonical mapping sync, while keeping `resolution_profiles` and `resolution_risk_assessments` as projections for current ingest/admin/RFQ consumers.

### Changes Made
- Added `src/canonical/curated-canonical-graph.ts`
  - builds graph snapshots for explicitly curated/live-mapped markets
  - preserves explicit `canonical_market_id` as the executable identity
  - computes pairwise compatibility only inside the curated executable market membership
- Cut over `scripts/sync-live-predexon-mappings.ts`
  - no longer inserts `resolution_profiles` directly
  - now persists `CanonicalGraphSnapshot` via `CanonicalGraphProjector.persistAndProject(...)`
  - still seeds minimal anchor rows into `historical_market_states` for category discovery
- Cut over `scripts/wire-live-predexon-venue-ids.ts`
  - no longer mutates projected `resolution_profiles` directly
  - now republishes the curated single-venue exact markets through the graph projector
- Cut over accepted-path updates in `scripts/sync-opinion-curated-mappings.ts`
  - removes the stale projected row for the accepted Opinion profile
  - republishes the accepted mapping through the graph projector before backfill
- Fixed stale projection cleanup in `src/repositories/canonical-graph.repository.ts`
  - if a venue market ID changes for the same `venueMarketProfileId`, old projected `resolution_profiles` and linked `resolution_risk_assessments` are removed before re-projection
- Fixed `src/core/rfq-engine/resolution-risk-grouping-service.ts`
  - `canonical_market_id` is now loaded into normalized profiles
  - grouping now fail-closes correctly when multiple sub-markets share the same event

### Verification
- `npm test -- test/unit/curated-canonical-graph.test.ts test/unit/resolution-risk-grouping-service.test.ts test/unit/canonical-graph-projector.test.ts`
- `npm run reset:canonical:ingestion-state`
- `npm run sync:predexon:live-mappings`
- `npm run ingest:predexon:mapped -- --venue=ALL --mode=backfill`

### Verified Post-Cutover State
- After reset + graph-backed live sync:
  - `canonical_events = 3`
  - `venue_market_profiles = 3`
  - `proposition_fingerprints = 3`
  - `venue_resolution_profiles = 3`
  - `venue_settlement_profiles = 3`
  - `canonical_executable_markets = 3`
  - `canonical_executable_market_members = 3`
  - `resolution_profiles = 3`
- After fresh mapped ingestion:
  - `historical_market_states = 305`
  - projected `resolution_profiles` stayed aligned to the graph-backed executable identities

### Notes
- The mapped historical ingester still reads projected `resolution_profiles`, but those rows are now graph-derived for the live bootstrap path.
- Compatibility edges remain `0` in the minimal live seed because the current seeded bootstrap set contains only single-venue executable markets.

---

## Session: 2026-03-20 (Layered Canonicalization Graph)

**Goal:** Add an authoritative canonical graph above venue adapters and below routing/risk projections, while preserving the current `resolution_profiles` / `resolution_risk_assessments` read-model path during rollout.

### Changes Made

#### [2026-03-20] New canonical domain layer
- Added `src/canonical/` modules for:
  - `canonicalization-types.ts`
  - `venue-market-profile.ts`
  - `proposition-fingerprint.ts`
  - `canonical-event-clustering.ts`
  - `compatibility-edge-scorer.ts`
  - `canonical-executable-market-builder.ts`
  - `resolution-profile-normalizer.ts`
  - `settlement-profile-normalizer.ts`
  - `canonical-graph-projector.ts`

#### [2026-03-20] New authoritative persistence layer
- Added migration `sql/migrations/2026_03_20_create_canonical_graph_tables.sql`
- New authoritative tables:
  - `canonical_events`
  - `venue_market_profiles`
  - `proposition_fingerprints`
  - `venue_resolution_profiles`
  - `venue_settlement_profiles`
  - `compatibility_edges`
  - `canonical_executable_markets`
  - `canonical_executable_market_members`

#### [2026-03-20] Projection strategy
- Added `src/repositories/canonical-graph.repository.ts`
- Added projector path that persists the graph and then projects back into:
  - `resolution_profiles`
  - `resolution_risk_assessments`
- Projection mapping:
  - `EQUIVALENT` -> `SAFE_EQUIVALENT` or `EQUIVALENT_WITH_LAG`
  - `COMPATIBLE_WITH_CAUTION` -> `CAUTION`
  - `DISTINCT` -> `HIGH_RISK`
  - `DO_NOT_POOL` -> `DO_NOT_POOL`

#### [2026-03-20] Liquidity-cost model placement
- Settlement lag is now treated as economic friction on `CompatibilityEdge`, not as canonical identity
- New edge fields include:
  - `capitalLockHours`
  - `maxSettlementDelayHours`
  - `liquidityCostModelVersion`
  - `liquidityCostBps`
  - `anchoredFinalityHours`
  - `requiresConservativeSettlementAnchor`
- Safe lag-only edges remain groupable
- Unsafe proposition / resolution / finality mismatches remain blocked or cautionary

### Validation
- New targeted unit tests added for:
  - canonical normalizers
  - proposition fingerprinting
  - canonical event clustering
  - compatibility edge scoring
  - executable market building
  - graph projector orchestration
- Targeted canonical test suite passed

### Important Rollout Note
- Current live RFQ/SOR/admin code still consumes projected `resolution_*` tables
- The canonical graph is now the new authoritative storage layer, but not every consumer has been cut over yet
- `npm run typecheck` still fails repo-wide on older unrelated simulation/risk test fixtures and route-mode migration fallout outside this canonical graph change

### [2026-03-20] Reset And Fresh Ingestion Rerun
- Added repeatable reset script:
  - `npm run reset:canonical:ingestion-state`
- Reset tables:
  - `historical_market_states`
  - `historical_simulation_runs`
  - `historical_simulation_results`
  - `historical_simulation_profiles`
  - `historical_simulation_risk_assessments`
  - `resolution_profiles`
  - `resolution_risk_assessments`
  - all new canonical graph tables
- Verified pre-reset footprint was cleared:
  - `historical_market_states`: `5145 -> 0`
  - `resolution_profiles`: `22 -> 0`
  - `resolution_risk_assessments`: `4 -> 0`
- Rebootstrapped minimal live mappings with:
  - `npm run sync:predexon:live-mappings`
- Re-ran fresh mapped historical ingestion with:
  - `npm run ingest:predexon:mapped -- --venue=ALL --mode=backfill`
- Post-rerun state:
  - `historical_market_states = 277`
  - `resolution_profiles = 3`
  - canonical graph tables still `0`

Operational takeaway:
- the reset/clean-slate flow works
- the current ingestion path still writes into the legacy projection path (`resolution_profiles` + `historical_market_states`)
- the new canonical graph tables are not yet populated by ingestion and still need explicit ingestion/projector wiring

---

### Changes Made This Session

#### [2026-03-18] Historical Simulation Category Expansion
- Extended `HistoricalCanonicalCategory` in `src/core/historical-simulation/historical-simulation.types.ts`
- Supported categories now include:
  - `SPORTS`
  - `CRYPTO`
  - `POLITICS`
  - `ESPORTS`
  - `OTHER`

#### [2026-03-18] Canonical Market Read Model Expansion - `src/api/admin/simulation-admin-service.ts`
- Extended simulation admin scope/category handling to include `POLITICS` and `ESPORTS`
- Added `canonicalMarkets` to canonical coverage responses
- Added `CanonicalMarketOption` generation from authoritative resolution profiles plus persisted market rows
- Each canonical market option now includes:
  - `canonicalMarketId`
  - `isRunnable`
  - per-venue market identities and titles
- `runSimulation()` now loads canonical coverage using the selected `canonicalMarketId`, so run metadata/category resolution matches the chosen submarket scope

#### [2026-03-18] Simulation Route Schema Expansion - `src/api/admin/simulation.routes.ts`
- Extended route validation to accept `POLITICS` and `ESPORTS`
- Extended canonical coverage response schema to include `canonicalMarkets`
- Kept route handlers thin and schema-driven

#### [2026-03-18] Simulation Console UI Expansion - `src/api/admin/simulation-console.page.ts`
- Changed UI copy from sports/crypto-only wording to sports/crypto/politics/esports
- Category selector now exposes:
  - `SPORTS`
  - `CRYPTO`
  - `POLITICS`
  - `ESPORTS`
- `loadScopes()` now always requests the selected category instead of hardcoding sports/crypto-only filtering
- Canonical market dropdown labels now show:
  - canonical market id
  - runnable vs not pooled status
  - participating venue labels

#### [2026-03-18] Seed Data Expansion - `scripts/seed-simulation-console-preview.ts`
- Added seeded historical states for:
  - `POLITICS`
    - event `66666666-6666-4666-8666-666666666666`
    - submarkets:
      - `US-ELECTION-2028-DEM`
      - `US-ELECTION-2028-GOP`
  - `ESPORTS`
    - event `77777777-7777-4777-8777-777777777777`
    - submarkets:
      - `LOL-WORLDS-T1`
      - `LOL-WORLDS-GENG`
- Added matching resolution profiles and SAFE_EQUIVALENT assessments for those pairs
- Seed script remains rerunnable and conflict-safe

#### [2026-03-18] Test Coverage Updates
- Updated:
  - `test/unit/simulation-admin-service.test.ts`
  - `tests/admin-simulation-routes.test.ts`
  - `tests/admin-simulation-console-routes.test.ts`
- Added assertions for:
  - expanded categories
  - canonical market option payloads
  - politics/esports UI controls

---

### Validation

- `npm run seed:simulation-console-preview` - passed
- `npx vitest run test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts --maxWorkers=1` - passed

---

### New Local Preview Event IDs

| Event | ID | Category | Canonical Market IDs |
|---|---|---|---|
| Sports preview event | `11111111-1111-4111-8111-111111111111` | SPORTS | N/A |
| Crypto preview event | `22222222-2222-4222-8222-222222222222` | CRYPTO | `BTC-90K`, `BTC-90K-LEGACY` |
| Politics preview event | `66666666-6666-4666-8666-666666666666` | POLITICS | `US-ELECTION-2028-DEM`, `US-ELECTION-2028-GOP` |
| Esports preview event | `77777777-7777-4777-8777-777777777777` | ESPORTS | `LOL-WORLDS-T1`, `LOL-WORLDS-GENG` |

---

### Remaining Follow-up

| # | Issue | Status |
|---|---|---|
| 1 | Restart local app and verify politics/esports scopes render through the live console | Done |
| 2 | Consider whether non-runnable canonical markets should be selectable or display-only in the dropdown | Done - display-only |
| 3 | Remove older temporary debug/seed artifacts that are no longer needed | Open |

#### [2026-03-18] Non-runnable Canonical Market IDs - `src/api/admin/simulation-console.page.ts`
- Canonical market dropdown now keeps non-runnable market IDs visible for audit context
- Non-runnable options are rendered as disabled and cannot be selected
- Runnable options remain selectable
- Added explanatory UI copy stating that display-only market IDs cannot be selected for pooled simulation

## Session: 2026-03-18 (Myriad Phase 4 Extraction Module)

**Goal:** Add a read-only Myriad extraction surface for Lotus Phase 4 historical simulation readiness without moving canonical logic into the integration layer.

### Changes Made This Session

#### [2026-03-18] Added Myriad integration modules
- `src/integrations/myriad/myriad-client.ts`
- `src/integrations/myriad/myriad-schemas.ts`
- `src/integrations/myriad/myriad-question-crawler.ts`
- `src/integrations/myriad/myriad-market-crawler.ts`
- `src/integrations/myriad/myriad-market-detail-enricher.ts`
- `src/integrations/myriad/myriad-market-events-backfill.ts`
- `src/integrations/myriad/myriad-topic-normalizer.ts`
- `src/integrations/myriad/myriad-phase4-shortlist.ts`
- `src/integrations/myriad/myriad-cli-validation.ts`
- `src/integrations/myriad/README.md`

#### [2026-03-18] API scope implemented
- `GET /questions`
- `GET /questions/:id`
- `GET /markets`
- `GET /markets/:id`
- `GET /markets/:id/events`

#### [2026-03-18] Myriad extraction behavior
- schema-first runtime validation with Zod
- retry / backoff / 429 handling in client
- deterministic paginated crawling for questions and markets
- market detail enrichment with price chart extraction from `outcomes[*].price_charts`
- event backfill with `since` / `until` and deterministic ascending replay order
- derived Lotus category normalization:
  - `SPORTS`
  - `CRYPTO`
  - `POLITICS`
  - `CULTURE`
  - `TECH`
  - `WEATHER`
  - `OTHER`
- shortlist generation for:
  - high-liquidity
  - category-balanced
  - recently resolved
- safe read-only CLI validation wrapper for `myriad markets list --json`

### Validation

- `npx vitest run test/unit/myriad-client.test.ts test/unit/myriad-extraction.test.ts test/unit/myriad-cli-validation.test.ts --maxWorkers=1` - passed

### Remaining Notes

- `npx tsc --noEmit` still fails repo-wide, but the failures are pre-existing and unrelated to the Myriad module
- No trading, claim, quote, or wallet mutation actions were added

#### [2026-03-18] Local Preview Dataset Reseeded
- Reran `npm run seed:simulation-console-preview`
- Verified live simulation scopes for:
  - `SPORTS`
  - `CRYPTO`
  - `POLITICS`
  - `ESPORTS`
- Preview console remains available at `http://localhost:3000/admin/simulation-console`

## Session: 2026-03-18 (Live Myriad Preview Dataset + Console Wiring)

**Goal:** Run the Myriad extractor against the live official API, generate a shortlist artifact, and expose shortlisted Myriad markets inside the internal console as a read-only preview without polluting the existing Predexon + Limitless paired simulation model.

### Changes Made This Session

#### [2026-03-18] Live Myriad API compatibility fixes
- Updated `src/integrations/myriad/myriad-schemas.ts`
  - `GET /questions` now accepts the live `meta` envelope as well as the documented `pagination` envelope
  - `outcomes[*].price_charts` now accepts the live array-of-series shape:
    - `[{ timeframe, prices: [{ value, timestamp, date }], change_percent }]`
  - `closingPrice` now accepts `null`
  - `topHolders` now accepts the live string-address array shape
- Updated `src/integrations/myriad/myriad-market-detail-enricher.ts`
  - detail enrichment now uses documented `marketId + network_id` lookup instead of slug lookup
  - price-chart extraction now normalizes both parsed and raw point shapes into deterministic `{ timestamp, price }` points

#### [2026-03-18] Added Myriad preview artifact model
- Added `src/integrations/myriad/myriad-preview-artifact.ts`
- Introduced a validated read-only preview artifact shape for console use:
  - generated time
  - artifact source metadata
  - preview candidates
  - shortlist membership
  - category labels

#### [2026-03-18] Added live shortlist builder
- Added `scripts/build-myriad-phase4-preview.ts`
- Added package script:
  - `npm run build:myriad-phase4-preview`
- Script behavior:
  - fetches live Myriad markets for:
    - `SPORTS`
    - `CRYPTO`
    - `POLITICS`
    - `ESPORTS` via keyword-based discovery
  - enriches selected markets through `GET /markets/:id?network_id=...`
  - resolves question grouping through `GET /questions?keyword=...`
  - backfills recent event history with a 7-day lookback
  - builds deterministic Phase 4 candidates and shortlist membership
  - writes preview artifact to:
    - `.tmp/myriad-phase4-preview.json`

#### [2026-03-18] Wired Myriad preview into admin APIs
- Updated `src/api/admin/simulation-admin-service.ts`
  - added read-only Myriad preview artifact loading
  - added `SimulationMyriadPreviewNotFoundError`
  - default artifact path:
    - `.tmp/myriad-phase4-preview.json`
- Updated `src/api/admin/simulation.routes.ts`
  - added:
    - `GET /admin/simulation/myriad-preview`
  - supports optional query:
    - `category=SPORTS|CRYPTO|POLITICS|ESPORTS`

#### [2026-03-18] Wired Myriad preview into internal console
- Updated `src/api/admin/simulation-console.page.ts`
  - added `Myriad Preview Candidates` section
  - loads `GET /admin/simulation/myriad-preview`
  - filters preview data by the currently selected category
  - clearly labels Myriad preview as read-only and not part of the current paired simulation engine

### Validation

- `npx vitest run test/unit/myriad-client.test.ts test/unit/myriad-extraction.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts --maxWorkers=1` - passed
- `npm run build:myriad-phase4-preview` - passed
- Verified local endpoint:
  - `GET /admin/simulation/myriad-preview?category=SPORTS`
- Restarted local app and verified the updated console HTML includes:
  - `GET /admin/simulation/myriad-preview`
  - `Myriad Preview Candidates`

### Current Live Preview Output

- Artifact path:
  - `C:\Users\Admin\Documents\lotus-RFQ-service\lotus-rfq-service\.tmp\myriad-phase4-preview.json`
- Generated candidates:
  - `8`
- Preview categories present:
  - `CRYPTO`
  - `ESPORTS`
  - `POLITICS`
  - `SPORTS`

### Important Boundary

- Myriad candidates are visible in the internal console for testing and review, but they are not wired into the existing runnable Predexon + Limitless historical simulation path.
- The Myriad preview section is intentionally read-only and preview-only.

## Session: 2026-03-18 (Myriad Wired Into 3-Venue Historical Simulation)

**Goal:** Upgrade Myriad from read-only preview into a real simulation venue so the historical engine can evaluate `POLYMARKET + LIMITLESS + MYRIAD` slices end-to-end.

### Changes Made This Session

#### [2026-03-18] Added Myriad baseline support to the simulation engine
- Added `src/simulation/baselines/myriad-only-baseline.ts`
- Updated `src/simulation/baselines/shared.ts`
  - added `MYRIAD_ONLY`
  - added conservative `inferMyriadFillProbability()`
- Updated `src/simulation/baselines/best-external-only-baseline.ts`
  - best-external comparison now considers `MYRIAD` when present

#### [2026-03-18] Extended the runner for venue-pair-aware state loading
- Updated `src/simulation/historical-simulation-runner.ts`
  - added `myriadOnly` to per-slice baseline results
  - added `myriadOnlyBaselineEvaluator` dependency
  - added explicit venue filtering in `loadHistoricalStates()` based on `venuePair`
    - `POLYMARKET_LIMITLESS`
    - `POLYMARKET_LIMITLESS_MYRIAD`
  - this prevents 2-venue runs from accidentally ingesting Myriad rows once tri-venue data exists

#### [2026-03-18] Extended admin/API contracts for tri-venue scopes
- Updated `src/api/admin/simulation-admin-service.ts`
  - `listScopes()` now supports:
    - `POLYMARKET_LIMITLESS`
    - `POLYMARKET_LIMITLESS_MYRIAD`
  - scope coverage now includes `myriadRows`
  - tri-venue scopes require Polymarket + Limitless + Myriad coverage
  - 2-venue scopes still require Polymarket + Limitless coverage
- Updated `src/api/admin/simulation.routes.ts`
  - added `venuePair` schema union for scopes and run requests
  - scope response schema now includes `myriadRows`

#### [2026-03-18] Updated internal console for tri-venue simulation
- Updated `src/api/admin/simulation-console.page.ts`
  - added venue-pair selector option:
    - `Predexon + Limitless + Myriad`
  - scope loading now passes the selected `venuePair`
  - canonical market selection now evaluates runnability against the selected venue pair
  - baseline results now render `Myriad only`
  - improvement metrics now render `Myriad`
  - console copy updated to reflect tri-venue simulation support

#### [2026-03-18] Seeded runnable tri-venue historical data
- Updated `scripts/seed-simulation-console-preview.ts`
  - added Myriad historical rows for:
    - `SPORTS`
    - `CRYPTO`
    - `POLITICS`
    - `ESPORTS`
  - sports rows now use `canonicalMarketId = SPORTS-M1`
  - added Myriad resolution profiles for the seeded markets
  - added all pairwise SAFE_EQUIVALENT assessments required for complete tri-venue freshness
  - made profile seeding idempotent on `(venue, venue_market_id)`
  - made assessment seeding resolve real stored profile IDs before insert

### Validation

- `npx vitest run test/unit/historical-simulation-runner.test.ts test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts --maxWorkers=1` - passed
- `npm run seed:simulation-console-preview` - passed
- Verified live API:
  - `GET /admin/simulation/scopes?category=CRYPTO&marketClass=BINARY&venuePair=POLYMARKET_LIMITLESS_MYRIAD`
  - returns the seeded tri-venue crypto scope
- Verified live dry-run:
  - `POST /admin/simulation/run`
  - `venuePair = POLYMARKET_LIMITLESS_MYRIAD`
  - `canonicalEventId = 22222222-2222-4222-8222-222222222222`
  - `canonicalMarketId = BTC-90K`
  - returned:
    - `myriadOnly` baseline
    - `bestExternalOnly` winner selection across 3 venues
    - `venueSpecific.myriadOnly` improvement metrics
    - `Lotus` evaluation with `venueCount = 3`

### Runtime Notes

- Local console remains:
  - `http://localhost:3000/admin/simulation-console`
- The running app was restarted after the tri-venue changes

### Current State

- Myriad is no longer preview-only from the engine perspective
- The historical simulation engine now supports:
  - `POLYMARKET_LIMITLESS`
  - `POLYMARKET_LIMITLESS_MYRIAD`
- The separate `Myriad Preview Candidates` section still exists for discovery context, but Myriad now also participates directly in runnable tri-venue simulation

## Session: 2026-03-18 (Amount-Aware Multi-Venue Historical Routing)

**Goal:** Extend the historical simulation engine from unit-size venue comparison into deterministic order-routing simulation with explicit `BUY` / `SELL` and notional-aware single-winner vs split routing.

### Changes Made This Session

#### [2026-03-18] Added side/notional simulation contracts
- Updated `src/core/historical-simulation/historical-simulation.types.ts`
  - added `HistoricalSimulationOrderSide`
  - added `HistoricalRoutedVenueAllocation`
  - added `HistoricalRoutedExecutionPlan`
  - added `HistoricalRoutingComparison`
- Updated `src/simulation/historical-simulation-runner.ts`
  - `HistoricalSimulationRunnerInput` now requires:
    - `side`
    - `requestedNotional`
  - runner metadata now persists both fields
  - slice context now passes both fields into Lotus historical evaluators

#### [2026-03-18] Made baselines side-aware and notional-aware
- Updated `src/simulation/baselines/shared.ts`
  - baseline input now uses:
    - `side`
    - `requestedNotional`
  - price selection is now side-aware:
    - `BUY` prefers ask-side evidence
    - `SELL` prefers bid-side evidence
  - fill-probability inference for Polymarket now uses bid/ask depth based on side
  - estimate metadata now records:
    - `side`
    - `requestedNotional`
    - `requestedQuantity`
    - `referencePrice`
    - `selectedPrice`
- Updated:
  - `src/simulation/baselines/polymarket-only-baseline.ts`
  - `src/simulation/baselines/limitless-only-baseline.ts`
  - `src/simulation/baselines/myriad-only-baseline.ts`
  - baselines now compute economics from requested notional rather than a hardcoded unit size

#### [2026-03-18] Added deterministic routing-plan simulation
- Rebuilt `src/simulation/default-historical-lotus-evaluators.ts`
  - added side-aware historical route candidate extraction
  - added deterministic `singleWinnerPlan`
  - added deterministic greedy `multiSplitPlan`
  - compares plans by:
    - higher fill ratio
    - lower effective cost
    - fewer allocations
    - stable plan ordering
  - `feeAdjustedLotusResult` now includes:
    - `routingComparison`
    - selected plan metadata
- Conservative routing rules in v1:
  - split routing only uses explicit depth when available
  - price-only venues can still win `singleWinner`
  - no synthetic liquidity is invented
  - partial fills produce residual notional instead of pretending completion

#### [2026-03-18] Extended admin API and console for routed simulation
- Updated `src/api/admin/simulation.routes.ts`
  - `POST /admin/simulation/run` now requires:
    - `side`
    - `requestedNotional`
- Updated `src/api/admin/simulation-admin-service.ts`
  - forwards `side` and `requestedNotional` to the runner
  - stores both in run metadata
- Updated `src/api/admin/simulation-console.page.ts`
  - added `Side` selector
  - added `Requested Notional` input
  - run summary now shows:
    - side
    - requested notional
  - Lotus section now renders:
    - winning route plan
    - alternate route plan
    - per-venue allocations
    - fill ratio
    - residual notional
    - plain-language route comparison

#### [2026-03-18] Updated simulation test coverage
- Updated:
  - `test/unit/historical-simulation-runner.test.ts`
  - `test/integration/historical-simulation-runner.integration.test.ts`
  - `test/unit/simulation-admin-service.test.ts`
  - `tests/admin-simulation-routes.test.ts`
  - `tests/admin-simulation-console-routes.test.ts`
- Added/updated scenario coverage for:
  - side-aware venue preference (`BUY` vs `SELL`)
  - split routing on larger notionals
  - tri-venue routing with Myriad present
  - partial-fill / residual handling
  - admin/API validation for side and requested notional
- Updated older baseline and qualification unit suites to match the new baseline input contract:
  - `test/unit/polymarket-only-baseline.test.ts`
  - `test/unit/limitless-only-baseline.test.ts`
  - `test/unit/best-external-only-baseline.test.ts`
  - `test/unit/no-internalization-baseline.test.ts`
  - `test/unit/qualification-historical-simulation-service.test.ts`

### Validation

- `npx vitest run test/unit/historical-simulation-runner.test.ts test/integration/historical-simulation-runner.integration.test.ts test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts --maxWorkers=1` - passed
- `npx vitest run test/unit/polymarket-only-baseline.test.ts test/unit/limitless-only-baseline.test.ts test/unit/best-external-only-baseline.test.ts test/unit/no-internalization-baseline.test.ts test/unit/qualification-historical-simulation-service.test.ts --maxWorkers=1` - passed

### Runtime Notes

- Console route remains:
  - `http://localhost:3000/admin/simulation-console`
- The simulation console now expects:
  - `venuePair`
  - `marketClass`
  - `canonicalEventId`
  - optional `canonicalMarketId`
  - `side`
  - `requestedNotional`
  - `from`
  - `to`
  - `strategyKey`

### Current State

- Historical simulation is now order-aware, not just unit-price-aware
- The engine can compare:
  - `SINGLE_WINNER`
  - `MULTI_SPLIT`
- Myriad participates in tri-venue routing when `POLYMARKET_LIMITLESS_MYRIAD` is selected
- The UI now exposes route-plan output rather than only baseline cards
- Repo-wide `tsc --noEmit` still fails, but the remaining errors are largely outside this routing work and are concentrated in older resolution-risk typing drift plus a few simulation-adjacent test files that have not yet been fully reconciled

## Session: 2026-03-18 (Fair Hybrid Fillability For Historical Routing)

**Goal:** Remove the unfair routing asymmetry where price-only `SINGLE_WINNER` plans could implicitly claim full fill while `MULTI_SPLIT` only counted explicit historical depth.

### Changes Made This Session

#### [2026-03-18] Added provable-vs-unproven routing fields
- Updated `src/core/historical-simulation/historical-simulation.types.ts`
  - `HistoricalRoutedVenueAllocation` now records:
    - `isProvable`
    - `isResidualUnknownDepth`
  - `HistoricalRoutedExecutionPlan` now records:
    - `provableFilledNotional`
    - `provableFilledQuantity`
    - `provableFillRatio`
    - `unprovenResidualNotional`
    - `unprovenResidualQuantity`
    - `containsUnknownDepth`
  - `HistoricalRoutingComparison` now records:
    - `comparisonBasis`

#### [2026-03-18] Made routing comparison use the same fillability standard
- Updated `src/simulation/default-historical-lotus-evaluators.ts`
  - `SINGLE_WINNER`
    - price-only winners no longer claim provable full fill
    - they now surface:
      - `fillProbability = null`
      - `fillProbabilityReason = "depth_missing"`
      - `provableFillRatio = 0`
      - unproven residual metadata
  - `MULTI_SPLIT`
    - still allocates explicit-depth venues first
    - now supports one trailing price-only residual leg
    - that residual is labeled:
      - `depthSource = "unknown_depth_residual"`
      - `isResidualUnknownDepth = true`
      - `isProvable = false`
  - plan comparison now uses:
    1. `provableFillRatio`
    2. economically comparable cost
    3. fewer allocations
    4. stable order preferring `SINGLE_WINNER` on exact ties

#### [2026-03-18] Updated console explanation layer
- Updated `src/api/admin/simulation-console.page.ts`
  - plan cards now separate:
    - provably fillable now
    - residual with unknown depth
    - economically assigned but unproven capacity
  - allocation tables now show whether each leg is provable
  - routing comparison now explicitly states:
    - the comparison basis
    - that price-only residual capacity is distinct from provable fill
  - improvement cards now warn when the selected plan includes unknown-depth residual capacity

#### [2026-03-18] Updated tests for fair hybrid behavior
- Updated `test/unit/historical-simulation-runner.test.ts`
  - added coverage for:
    - price-only single-winner plans exposing unknown-depth residual
    - split plans with one explicit-depth leg plus one unknown-depth residual leg
    - plan comparison fairness based on provable fill
  - updated prior side-aware expectations to the new fairness policy
- Updated `tests/admin-simulation-console-routes.test.ts`
  - verifies the new UI strings for provable fill and unknown residual capacity

### Validation

- `npx vitest run test/unit/historical-simulation-runner.test.ts tests/admin-simulation-console-routes.test.ts --maxWorkers=1` - passed

### Current State

- Routing comparison is now fairer:
  - price-only venues can still participate economically
  - but only explicit depth counts as provable fill
- The console now explains:
  - how much fill is provable
  - how much residual is only economically assigned
  - why one plan beat the other
## 2026-03-19: Predexon Standardization On Opinion

### Summary
- Runnable historical simulation has been standardized away from `MYRIAD` and onto `OPINION` for the tri-venue path.
- The supported runnable venue pairs are now:
  - `POLYMARKET_LIMITLESS`
  - `POLYMARKET_LIMITLESS_OPINION`
- Myriad extraction code remains in the repo as a separate non-runnable integration, but it is no longer part of the simulation/admin/console path.

### Simulation / Admin / Console
- Replaced `myriadOnly` baseline wiring with `opinionOnly`.
- Added `src/simulation/baselines/opinion-only-baseline.ts`.
- Removed the runnable Myriad baseline file from the simulation surface.
- Updated:
  - `src/simulation/historical-simulation-runner.ts`
  - `src/api/admin/simulation-admin-service.ts`
  - `src/api/admin/simulation.routes.ts`
  - `src/api/admin/simulation-console.page.ts`
  - `src/api/server.ts`
- Removed `/admin/simulation/myriad-preview` from the runnable admin surface.
- Console copy and venue labels now refer to Opinion instead of Myriad.

### Predexon Ingestion
- Extended `src/integrations/predexon/predexon-client.ts` with first-class historical orderbook methods for:
  - Polymarket
  - Limitless
  - Opinion
- Extended `src/integrations/predexon/predexon-schemas.ts` with:
  - Limitless historical orderbook response parsing
  - Opinion historical orderbook response parsing
- Extended `src/integrations/predexon/predexon-historical-adapter.ts` so normalized historical fragments can be built for:
  - `POLYMARKET`
  - `LIMITLESS`
  - `OPINION`
- Generalized `src/jobs/ingest-predexon-historical.job.ts` so the Predexon ingestion path can ingest:
  - `POLYMARKET` via discovery + candles/orderbooks/trades
  - `LIMITLESS` via configured scope provider + historical orderbooks
  - `OPINION` via configured scope provider + historical orderbooks
- Direct Limitless ingestion remains in the repo as fallback-only and is no longer the intended default simulation source.

### Seed / Local Preview
- Updated `scripts/seed-simulation-console-preview.ts` to replace Myriad preview rows and resolution profiles with Opinion-backed rows.
- Pairwise resolution-risk assessments now seed:
  - `POLYMARKET ↔ LIMITLESS`
  - `POLYMARKET ↔ OPINION`
  - `LIMITLESS ↔ OPINION`
- Seed reruns are now safe against existing `resolution_profiles.id` conflicts.

### Tests
- Updated simulation/admin/console/unit/integration tests from Myriad -> Opinion.
- Added Predexon unit coverage for:
  - Limitless historical orderbooks
  - Opinion historical orderbooks
  - generalized Predexon ingestion job support for Limitless

### Validation
- Passed:
  - `npx vitest run test/unit/ingest-predexon-historical.job.test.ts test/unit/predexon-client.test.ts test/unit/predexon-historical-adapter.test.ts tests/admin-simulation-console-routes.test.ts tests/admin-simulation-routes.test.ts test/unit/simulation-admin-service.test.ts test/unit/historical-simulation-runner.test.ts test/integration/historical-simulation-runner.integration.test.ts test/unit/qualification-historical-simulation-service.test.ts --maxWorkers=1`

## 2026-03-19: Predexon Full Ingestion + Confidence Grade

### Summary
- Added a manual-first Predexon mapped-market ingestion path for all canonically mapped:
  - `POLYMARKET`
  - `LIMITLESS`
  - `OPINION`
- Added a single per-run confidence grade to the internal simulation console.
- Kept canonical identity outside Predexon. The new ingestion path reads mapped venue scopes from the existing canonical / resolution-profile layer.

### Ingestion Scope
- Expanded ingestion-side categories in `src/jobs/historical-ingestion.shared.ts` to:
  - `sports`
  - `crypto`
  - `politics`
  - `esports`
- `HistoricalIngestionJobInput` now supports manual scope filters:
  - `categories`
  - `canonicalEventId`
  - `canonicalMarketId`

### Predexon Mapped-Market Ingestion
- Added `PredexonMappedMarketScopeProvider` in `src/jobs/ingest-predexon-historical.job.ts`
  - reads mapped venue scopes from `resolution_profiles`
  - derives category from the latest `historical_market_states` coverage for the same canonical event / market
  - uses Polymarket event/market discovery only to enrich mapped Polymarket scopes with real `conditionId` / token metadata
  - uses authoritative mapped venue IDs directly for:
    - `LIMITLESS`
    - `OPINION`
- `PredexonHistoricalIngestionJob` now accepts manual category / canonical filters and passes them into the scope provider.

### Canonical Mapping Resolver
- Added `src/simulation/resolution-profile-historical-mapping-resolver.ts`
  - resolves historical venue states back into:
    - `canonicalEventId`
    - `canonicalMarketId`
    - `canonicalCategory`
    - `resolutionProfileId`
  - uses `resolution_profiles` as the authoritative mapping source
  - falls back to `OTHER` only if category is missing from stored historical coverage

### Manual Entry Point
- Added `scripts/ingest-predexon-mapped-historical.ts`
- Added package command:
  - `npm run ingest:predexon:mapped`
- Supported flags:
  - `--venue=POLYMARKET|LIMITLESS|OPINION|ALL`
  - `--mode=backfill|incremental`
  - `--category=sports,crypto,politics,esports`
  - `--canonicalEventId=<uuid>`
  - `--canonicalMarketId=<id>`
  - `--start=<ISO datetime>`
  - `--end=<ISO datetime>`
  - `--batchSize=<number>`
  - `--overlapMs=<number>`
- Added Predexon env placeholders in `.env.example`:
  - `PREDEXON_BASE_URL`
  - `PREDEXON_API_KEY`
  - `PREDEXON_METADATA_VERSION`

### Confidence Grade UI
- Updated `src/api/admin/simulation-console.page.ts`
- The Lotus result panel now derives a single per-run confidence grade from the winning route:
  - `HIGH`
    - full provable fill
    - no unknown-depth residual
  - `MEDIUM`
    - material provable fill, but residual still depends on price-only capacity
  - `LOW`
    - weak provable fill or mostly price-only residual
  - `BLOCKED`
    - Lotus path blocked / not evaluated
- The grade is shown ahead of the detailed routing cards with a plain-language explanation.

### Validation
- Passed:
  - `npx vitest run test/unit/ingest-predexon-historical.job.test.ts tests/admin-simulation-console-routes.test.ts --maxWorkers=1`

### Manual Runtime Validation
- Successfully executed:
  - `npx tsx scripts/ingest-predexon-mapped-historical.ts --venue=LIMITLESS --mode=backfill --category=sports,crypto,politics,esports --start=2026-03-12T12:00:00.000Z --end=2026-03-12T12:31:00.000Z`
- The job now:
  - loads mapped scopes from the canonical/profile layer
  - calls live Predexon endpoints
  - handles per-scope failures without aborting the whole run

### Important Limitation
- The current local preview DB still uses synthetic seeded venue IDs for the console demo data.
- Because those preview IDs do not correspond to live Predexon market slugs / IDs, the live mapped ingestion run completed with `failedScopes > 0` and `insertedRows = 0` for the preview Limitless scopes.
- So:
  - the manual ingestion pipeline is implemented and executable
  - but full live ingestion requires real canonically mapped venue IDs in `resolution_profiles`, not the preview-only seeded identifiers

## Session: 2026-03-19 (Exact Canonical Market Rewrite)

**Goal:** Split the broken mixed canonical pairs into exact proposition-specific markets, preserve old mixed history under `LEGACY-*`, and remap live Predexon ingestion onto the corrected canonical IDs.

### Canonical Rewrite
- Added authoritative rewrite spec:
  - `src/simulation/canonical-market-rewrite-spec.ts`
- Added transactional migration script:
  - `scripts/rewrite-canonical-exact-markets.ts`
- Added package command:
  - `npm run migrate:canonical:exact-markets`
- Rewrote the six broken canonical market IDs into:
  - `POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN`
  - `LIMITLESS-MLB-DODGERS-GAME-WINNER`
  - `OPINION-MLB-DODGERS-WORLD-SERIES-WIN`
  - `POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31`
  - `LIMITLESS-BTC-ABOVE-90K`
  - `OPINION-BTC-ABOVE-90K-BY-2026-03-31`
  - `POLYMARKET-2028-DEM-NOM-GAVIN-NEWSOM`
  - `US-ELECTION-2028-DEMOCRATIC-WINS`
  - `POLYMARKET-2028-GOP-NOM-MIKE-PENCE`
  - `US-ELECTION-2028-REPUBLICAN-WINS`
  - `POLYMARKET-LOL-WORLDS-2026-LCK-TEAM-WINS`
  - `LOL-WORLDS-2026-T1-WINS`
  - `POLYMARKET-LOL-2026-GENG-GOLDEN-ROAD`
  - `LOL-WORLDS-2026-GENG-WINS`
- Preserved the old mixed buckets as:
  - `LEGACY-SPORTS-M1`
  - `LEGACY-BTC-90K`
  - `LEGACY-US-ELECTION-2028-DEM`
  - `LEGACY-US-ELECTION-2028-GOP`
  - `LEGACY-LOL-WORLDS-T1`
  - `LEGACY-LOL-WORLDS-GENG`

### DB Mutation Results
- Executed:
  - `npm run migrate:canonical:exact-markets`
- Immediate migration results:
  - moved historical rows from the 6 broken IDs into their `LEGACY-*` buckets
  - updated 18 `resolution_profiles` rows to their new exact canonical IDs
  - deleted 18 broken `resolution_risk_assessments`
  - inserted fresh exact-overlap assessments only for:
    - `US-ELECTION-2028-DEMOCRATIC-WINS`
    - `US-ELECTION-2028-REPUBLICAN-WINS`
    - `LOL-WORLDS-2026-T1-WINS`
    - `LOL-WORLDS-2026-GENG-WINS`

### Live Wiring And Ingestion
- Updated live Polymarket wiring:
  - `scripts/wire-live-predexon-venue-ids.ts`
- Executed:
  - `npm run wire:predexon:live-ids`
  - `npm run ingest:predexon:mapped -- --venue=POLYMARKET --mode=backfill --category=politics --canonicalEventId=66666666-6666-4666-8666-666666666666 --start=2026-03-10T00:00:00.000Z --end=2026-03-19T23:59:59.000Z`
  - `npm run ingest:predexon:mapped -- --venue=POLYMARKET --mode=backfill --category=crypto --canonicalEventId=22222222-2222-4222-8222-222222222222 --start=2026-03-10T00:00:00.000Z --end=2026-03-19T23:59:59.000Z`
  - `npm run ingest:predexon:mapped -- --venue=POLYMARKET --mode=backfill --category=sports --canonicalEventId=11111111-1111-4111-8111-111111111111 --start=2026-03-10T00:00:00.000Z --end=2026-03-19T23:59:59.000Z`
  - `npm run ingest:predexon:mapped -- --venue=POLYMARKET --mode=backfill --category=esports --canonicalEventId=77777777-7777-4777-8777-777777777777 --start=2026-03-10T00:00:00.000Z --end=2026-03-19T23:59:59.000Z`
- Resulting exact-ID historical rows now exist for:
  - `POLYMARKET-2028-DEM-NOM-GAVIN-NEWSOM`
  - `POLYMARKET-2028-GOP-NOM-MIKE-PENCE`
  - `POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31`
  - `POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN`
  - `POLYMARKET-LOL-WORLDS-2026-LCK-TEAM-WINS`
  - `POLYMARKET-LOL-2026-GENG-GOLDEN-ROAD`

### Opinion Curation
- Rewrote the machine-readable Opinion manifest to the new exact IDs:
  - `docs/predexon-opinion-id-curation.json`
- Re-ran:
  - `npm run sync:predexon:opinion-curation`
- Outcome:
  - `updated = 0`
  - `unresolved = 6`
- No exact public numeric Opinion IDs were found yet for the unresolved politics, crypto, sports, or esports Opinion rows.

### Historical Identity Fix
- Follow-up issue discovered during verification:
  - `historical_market_states` uniqueness still ignored `canonical_market_id`
  - new exact backfills could overwrite `LEGACY-*` rows on conflict
- Fix applied in repo:
  - `sql/migrations/2026_03_19_preserve_historical_market_state_canonical_identity.sql`
  - `src/repositories/historical-market-state.repository.ts`
- Applied live DB index update so future exact backfills no longer collapse legacy and exact rows onto the same identity key.
- Performed a one-off legacy recovery copy after the index fix to restore the pre-overwrite legacy counts for:
  - `LEGACY-SPORTS-M1`
  - `LEGACY-BTC-90K`
  - `LEGACY-US-ELECTION-2028-DEM`
  - `LEGACY-US-ELECTION-2028-GOP`
  - `LEGACY-LOL-WORLDS-T1`
  - `LEGACY-LOL-WORLDS-GENG`

### Validation
- Passed:
  - `npm test -- test/unit/ingest-predexon-historical.job.test.ts test/unit/historical-simulation-runner.test.ts test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts test/unit/canonical-historical-normalizer.test.ts test/unit/predexon-historical-adapter.test.ts`

## Session: 2026-03-19 (Route Mode Availability Rewrite)

**Goal:** Replace the narrow simulation `venuePair` model with exact-market `routeMode` discovery so Lotus/admin can surface real single-venue, pair, and tri-venue routes across Predexon, Limitless, and Opinion.

### Shared Route Mode Model
- Added a shared historical simulation route-mode registry in:
  - `src/core/historical-simulation/historical-simulation.types.ts`
- Supported route modes:
  - `POLYMARKET_ONLY`
  - `LIMITLESS_ONLY`
  - `OPINION_ONLY`
  - `POLYMARKET_LIMITLESS`
  - `POLYMARKET_OPINION`
  - `LIMITLESS_OPINION`
  - `POLYMARKET_LIMITLESS_OPINION`

### Exact Market Route Availability
- Reworked `src/api/admin/simulation-admin-service.ts` so routeability is computed per exact `canonical_market_id`
- Multi-venue routes now fail closed unless:
  - all required venues exist on the same exact market
  - historical rows exist for those venues
  - required resolution-risk pair edges exist
  - all required edges are `SAFE_EQUIVALENT` or `EQUIVALENT_WITH_LAG`
- Unavailable route modes now surface explicit reasons:
  - `missing_required_venue`
  - `missing_historical_rows`
  - `missing_pair_assessment`
  - `incomplete_resolution_risk`
  - `stale_resolution_risk`
  - `unsafe_equivalence`
  - `ambiguous_venue_identity`
- Tri-venue routing now requires all three exact pair edges:
  - `POLYMARKET ↔ LIMITLESS`
  - `POLYMARKET ↔ OPINION`
  - `LIMITLESS ↔ OPINION`

### Admin API And Console
- Updated `src/api/admin/simulation.routes.ts`
  - request/response contract now uses `routeMode`
  - deprecated `venuePair` input alias remains accepted for compatibility
  - canonical coverage now returns:
    - `routeModeSummary`
    - `hasTriVenueRoute`
    - `triVenueRouteableMarketCount`
    - per-market `routeModes`
- Updated `src/api/admin/simulation-console.page.ts`
  - `Venue Pair` selector renamed to `Route Mode`
  - all 7 route modes are visible
  - exact markets stay visible with runnable/unavailable route badges
  - the console now requires exact market selection when an event has multiple runnable markets for the chosen mode
  - tri-venue availability is visible in the canonical summary

### Docs Updated
- `docs/sor-design.md`
- `docs/runbooks/sor-runbook.md`
- `docs/runbooks/resolution-risk-runbook.md`
- `docs/runbook.md`
- repo-root `lotus_data_engineering.md`

### Validation
- Passed:
  - `npm test -- test/unit/historical-simulation-types.test.ts test/unit/historical-simulation-runner.test.ts test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts test/unit/qualification-historical-simulation-service.test.ts`

## Session: 2026-03-19 (Simulation-Only Historical Route Catalog)

**Goal:** Add a fail-closed historical exact-market discovery/catalog flow for simulation routes without polluting live Lotus routing inventory.

### Catalog Tables
- Added:
  - `sql/migrations/2026_03_19_create_historical_simulation_catalog_tables.sql`
- New simulation-only canonical tables:
  - `historical_simulation_profiles`
  - `historical_simulation_risk_assessments`

### Shared Backend Wiring
- Added:
  - `src/api/admin/historical-simulation-catalog-service.ts`
- Updated:
  - `src/api/admin/simulation-admin-service.ts`
  - `src/api/admin/simulation.routes.ts`
  - `src/api/admin/simulation-console.page.ts`
  - `src/api/server.ts`
- Admin simulation responses now surface:
  - `catalogScope = live | historical_simulation`
- Historical `HISTSIM::...` event IDs are now accepted by the canonical coverage route.

### Candidate And Curation Workflow
- Added:
  - `src/simulation/historical-route-catalog-manifest.ts`
  - `scripts/generate-historical-route-candidates.ts`
  - `scripts/sync-historical-route-curation.ts`
  - `docs/historical-route-candidates.json`
  - `docs/historical-route-curation.json`
- Added package commands:
  - `npm run generate:historical-route-candidates`
  - `npm run sync:historical-route-curation`

### Runtime Behavior
- Historical discoveries remain simulation-only by default.
- Nothing writes historical discoveries into `resolution_profiles`.
- Accepted manifest entries sync into:
  - `historical_simulation_profiles`
  - `historical_simulation_risk_assessments`
  - `historical_market_states` under `HISTSIM::...` / `HISTSIM-...`

### Initial Live Verification
- Executed:
  - `npm run db:migrate:supabase`
  - `npm run generate:historical-route-candidates`
  - `npm run sync:historical-route-curation`
- Current generated candidate count:
  - `18`
- Current accepted historical-catalog routes:
  - `1`
- Current unresolved routes left in curated manifest:
  - `4`

### First Accepted Historical Route
- Event:
  - `HISTSIM::LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF`
- Market:
  - `HISTSIM-LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF`
- Venue:
  - `OPINION`
- Venue market id:
  - `6808`
- Historical rows inserted:
  - `100`
- Admin API now reports:
  - `catalogScope = historical_simulation`
  - runnable `routeMode = OPINION_ONLY`

### Simulation Runner Follow-up Fix
- Updated:
  - `src/simulation/historical-simulation-runner.ts`
- Fix:
  - single-venue route modes no longer force missing-venue baseline evaluators
  - `OPINION_ONLY` historical catalog routes now run successfully end to end

### Validation
- Passed:
  - `npm test -- test/unit/historical-simulation-catalog-service.test.ts test/unit/historical-simulation-runner.test.ts test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts`
- Verified via admin API:
  - `GET /admin/simulation/canonical/HISTSIM::LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF`
  - dry-run `POST /admin/simulation/run` for `OPINION_ONLY` on that historical event succeeded

### Current Limitation
- Exact historical 2-venue and 3-venue routes still require approved exact IDs plus safe pairwise assessments on every required venue.
- Opinion historical discovery remains limited to already-known numeric IDs; no crawler was added in this pass.

## Session: 2026-03-20 (Myriad Historical Ingestion + MYRIAD_ONLY Simulation)

**Goal:** Promote Myriad from read-only extraction into a real historical-ingestion source under the canonical graph, while keeping Myriad routing single-venue and conservative in v1.

### Implemented Modules
- Added:
  - `src/integrations/myriad/myriad-historical-adapter.ts`
  - `src/jobs/ingest-myriad-historical.job.ts`
  - `src/simulation/baselines/myriad-only-baseline.ts`
  - `scripts/ingest-myriad-historical.ts`
- Updated:
  - `src/core/historical-simulation/historical-simulation.types.ts`
  - `src/simulation/baselines/shared.ts`
  - `src/simulation/baselines/best-external-only-baseline.ts`
  - `src/simulation/historical-simulation-runner.ts`
  - `src/api/server.ts`
  - `src/api/admin/simulation-admin-service.ts`
  - `src/api/admin/simulation.routes.ts`
  - `src/api/admin/simulation-console.page.ts`
  - `src/integrations/myriad/myriad-market-crawler.ts`
  - `package.json`

### Runtime Behavior
- Myriad historical ingestion is now graph-first:
  - Myriad market detail is normalized into `VenueMarketProfile`
  - Myriad question data is used as proposition-hint input only
  - graph snapshots are persisted and projected before historical rows are inserted
- Historical Myriad rows write into `historical_market_states` with:
  - `venue = MYRIAD`
  - conservative candle/event payloads
  - no invented bid/ask, spread, orderbook, or trade-tape fields
- Added route mode:
  - `MYRIAD_ONLY`
- Current Myriad routing policy:
  - single-venue only in v1
  - no Myriad pair or tri-venue route modes enabled yet

### Myriad Evidence Model
- Documented historical evidence used:
  - `GET /markets`
  - `GET /markets/:id`
  - `GET /markets/:id/events`
  - embedded `price_charts`
- Conservative replay rules:
  - realized price plus market-event evidence only
  - no historical quote-depth reconstruction
  - fills must remain AMM-style and evidence-bounded

### Operational Fixes
- Myriad `batchSize` now caps candidate markets processed during market crawl instead of only setting page size.
- Added deterministic ASCII-safe sanitization for Myriad text before persistence because the current Postgres server encoding is `WIN1252`.
- The manual Myriad ingest script now forces UTF-8 client encoding on connect.

### Validation
- Passed:
  - `npm test -- test/unit/myriad-historical-adapter.test.ts test/unit/historical-simulation-runner.test.ts test/unit/simulation-admin-service.test.ts tests/admin-simulation-routes.test.ts tests/admin-simulation-console-routes.test.ts test/unit/historical-simulation-types.test.ts test/unit/qualification-historical-simulation-service.test.ts`
  - `npm test -- test/unit/myriad-historical-adapter.test.ts test/unit/myriad-extraction.test.ts test/unit/historical-simulation-runner.test.ts`
- Executed:
  - `npm run ingest:myriad -- --mode=backfill --category=crypto --batchSize=20`

### Resulting DB State
- `historical_market_states` rows by venue:
  - `MYRIAD = 49023`
  - `POLYMARKET = 103`
  - `LIMITLESS = 101`
  - `OPINION = 101`
- Graph/projected profile rows by venue:
  - `venue_market_profiles.MYRIAD = 10`
  - `resolution_profiles.MYRIAD = 10`
- Largest ingested Myriad exact markets so far:
  - `MYRIAD-CRYPTO-ABSTRACT-TGE-DATE-ANNOUNCED-BEFORE-MAY-N2741 = 43245`
  - `MYRIAD-CRYPTO-FEAR-OR-GREED-N2741 = 3320`
  - `MYRIAD-CRYPTO-BTC-PRICE-ABOVE-70-000-ON-MARCH-20-2026-AT-11-59PM-UTC-N42220 = 2445`

### Current Limitation
- Some Myriad markets have very large event histories, so direct backfills can take several minutes even with a small candidate-market batch.
- Myriad pair/tri routing remains intentionally blocked until exact cross-venue compatibility edges are curated.
