# Resolution Risk Runbook

## Scope
This runbook covers canonical-layer resolution-risk profiles and pairwise assessments. It is for inspection and controlled recomputation only.

Important boundary:
- `resolution_risk:kill_switch` blocks recomputation only.
- Existing persisted assessments remain authoritative for RFQ grouping, SOR routing policy, and internal execution eligibility while the kill switch is active.
- `RESOLUTION_RISK_ENABLED=false` leaves enforcement disabled by default.
- `RESOLUTION_RISK_SHADOW_ENABLED=true` enables decision-only shadow evaluation when sampled.

## Endpoints
- `GET /admin/resolution-risk/canonical/:eventId`
- `POST /admin/resolution-risk/recompute/:profileId`
- `POST /admin/resolution-risk/recompute/canonical/:eventId`
- `GET /resolution-risk/pair?profileAId=...&profileBId=...`
- `GET /resolution-risk/market/:venue/:marketId`

## Inspect A Profile
1. Resolve the profile through the canonical-event inspection response:
   - `GET /admin/resolution-risk/canonical/:eventId`
   - inspect the `profiles` array for the target `id`, `venue`, `venueMarketId`, `canonicalEventId`, and `updatedAt`
2. If the operator only knows venue and market ID:
   - `GET /resolution-risk/market/:venue/:marketId`
   - inspect the returned `profile`
3. Check freshness:
   - `profileCount`
   - `expectedPairCount`
   - `persistedPairCount`
   - `lastComputedAt`
   - `latestProfileUpdatedAt`
   - `isComplete`
   - `isStale`
   - `hasMixedVersions`

Operational interpretation:
- `isComplete=false` means some pairwise assessments are missing.
- `isStale=true` means profiles were updated after the most recent computed assessment, or the assessment set is incomplete.
- `hasMixedVersions=true` means the event contains rows from more than one scoring version and should be normalized by recomputation.

## Inspect A Pairwise Score
1. If the pair is already known:
   - `GET /resolution-risk/pair?profileAId=<id>&profileBId=<id>`
2. If the operator is investigating a whole canonical event:
   - `GET /admin/resolution-risk/canonical/:eventId`
   - inspect the `assessments` array in deterministic lower-ID-first pair order
3. Confirm:
   - `riskScore`
   - `confidenceScore`
   - `equivalenceClass`
   - `factorBreakdown`
   - `reasons`
   - `version`
   - `computedAt`

## Force Recompute
### Recompute All Pairs In One Profile's Canonical Event
Requirements:
- ADMIN privileges
- valid `twoFactorToken`
- `resolution_risk:kill_switch` must not be active

Call:
```http
POST /admin/resolution-risk/recompute/:profileId
Content-Type: application/json

{
  "twoFactorToken": "<token>"
}
```

Expected result:
- `profileId`
- `canonicalEventId`
- `version`
- `assessmentCount`
- `lastComputedAt`

### Recompute All Pairs For One Canonical Event
Requirements:
- ADMIN privileges
- valid `twoFactorToken`
- `resolution_risk:kill_switch` must not be active

Call:
```http
POST /admin/resolution-risk/recompute/canonical/:eventId
Content-Type: application/json

{
  "twoFactorToken": "<token>"
}
```

Expected result:
- `canonicalEventId`
- `version`
- `assessmentCount`
- `lastComputedAt`

## Operational Meaning Of Equivalence Classes
- `SAFE_EQUIVALENT`
  - poolable
  - RFQ venue grouping may place these venues in the same safe lane
  - SOR may treat cross-profile pairs normally
  - automatic internal netting and clearing may proceed
- `CAUTION`
  - separated RFQ lane
  - SOR may route with the configured resolution-risk penalty
  - not eligible for automatic internal compression
- `HIGH_RISK`
  - isolated routing only
  - no auto split across the pair
  - not eligible for automatic internal compression
- `DO_NOT_POOL`
  - non-poolable
  - blocked from pooled RFQ grouping
  - blocked from pooled SOR treatment
  - blocked from automatic internal compression

## Validate Router And RFQ Gating Behavior
### RFQ Grouping
1. Inspect the persisted assessment for the relevant pair.
2. Create or inspect an RFQ for the related canonical market.
3. Confirm RFQ session debug metadata contains `resolution_risk_grouping`.
4. Validate:
   - `SAFE_EQUIVALENT` profiles appear in `safePools`
   - `CAUTION` profiles appear in `cautionLanes`
   - `HIGH_RISK` and `DO_NOT_POOL` profiles appear in `blockedProfiles`
   - `reasonsByProfile` reflects persisted assessment reasons

### SOR Behavior
1. Inspect the persisted pairwise assessment.
2. Confirm candidate metadata includes `resolution_profile_id`.
3. Validate policy behavior:
   - `SAFE_EQUIVALENT` -> pooled treatment allowed
   - `CAUTION` -> additive resolution-risk penalty applied
   - `HIGH_RISK` -> isolated-only routing, no auto split
   - `DO_NOT_POOL` -> pooled routing blocked

### Internal Execution Eligibility
1. Inspect the persisted pairwise assessment.
2. Confirm participant/candidate metadata carries `resolution_profile_id`.
3. Validate:
   - `SAFE_EQUIVALENT` -> eligible for automatic internal netting/clearing
   - `CAUTION`, `HIGH_RISK`, `DO_NOT_POOL` -> excluded from automatic internal compression

## Kill Switch
Redis key:
- `resolution_risk:kill_switch`

Enable:
```bash
redis-cli set resolution_risk:kill_switch "true"
```

Disable:
```bash
redis-cli del resolution_risk:kill_switch
```

Expected behavior when enabled:
- admin recompute endpoints fail with `409 KILL_SWITCH_ACTIVE`
- canonical inspection endpoint still works
- RFQ, SOR, and internal execution continue consuming the last persisted assessments
- no scoring or routing policy is relaxed

## Enforcement Rollout
### Default-Off Behavior
- `RESOLUTION_RISK_ENABLED=false`
  - persisted assessments are still read and inspected
  - enforcement is bypassed
  - shadow mode may still record what would have happened

### Enable Enforcement
1. Set `RESOLUTION_RISK_ENABLED=true`
2. Keep `RESOLUTION_RISK_SHADOW_ENABLED=false`
3. restart the service
4. validate:
   - RFQ grouping is enforced
   - SOR penalties/blocks are enforced
   - internal execution exclusions are enforced

### Enable Shadow Mode
1. Set:
   - `RESOLUTION_RISK_ENABLED=false`
   - `RESOLUTION_RISK_SHADOW_ENABLED=true`
   - `RESOLUTION_RISK_SHADOW_PERCENT=<0..1>`
2. optionally set:
   - `RESOLUTION_RISK_SHADOW_START_AT`
   - `RESOLUTION_RISK_SHADOW_END_AT`
3. restart the service
4. validate:
   - `resolution_risk_shadow_total`
   - `resolution_risk_shadow_match_total`
   - `resolution_risk_shadow_divergence_total`
   - `resolution_risk_enforcement_disabled_total`

### Validate Shadow Output
#### RFQ
- inspect `resolution_risk_grouping` vs `resolution_risk_shadow_grouping` in RFQ session metadata
- confirm blocked/separated profiles are observed but not enforced while shadow-only

#### SOR
- inspect:
  - `resolution_risk_penalty_applied_total`
  - `do_not_pool_block_total`
  - shadow divergence metrics
- confirm caution penalties and do-not-pool blocks are observed but not enforced while shadow-only

#### Internal Execution
- inspect `resolution_risk_internal_exclusion_total`
- confirm cross-profile exclusions are observed but candidates are not rejected while shadow-only

### Interpret Divergence Metrics
- `blocked_vs_allowed`
  - enforcement would have blocked a path that shadow allowed
- `separated_vs_pooled`
  - enforcement would have separated RFQ lanes that shadow pooled

## Route-Availability Edge Rules

The admin simulation route sheet now consumes resolution-risk data per exact `canonical_market_id`.

Pair-route requirement:
- a two-venue route is runnable only when the exact market exists on both venues and the corresponding pair assessment is `SAFE_EQUIVALENT` or `EQUIVALENT_WITH_LAG`

Single-venue requirement:
- `POLYMARKET_ONLY`, `LIMITLESS_ONLY`, `OPINION_ONLY`, and `MYRIAD_ONLY` do not require pair assessments
- `MYRIAD_ONLY` still requires exact market identity and historical state evidence, but not a pooled compatibility edge

Tri-route requirement:
- `POLYMARKET_LIMITLESS_OPINION` is runnable only when all three pair edges are present and eligible:
  - `POLYMARKET ↔ LIMITLESS`
  - `POLYMARKET ↔ OPINION`
  - `LIMITLESS ↔ OPINION`

Fail-closed reasons surfaced into route availability:
- `missing_pair_assessment`
- `incomplete_resolution_risk`
- `stale_resolution_risk`
- `unsafe_equivalence`
- `ambiguous_venue_identity`

## Canonical Graph Authority

Resolution-risk rows are now treated as projected read models from the authoritative canonical graph.

Authoritative graph objects:
- `CanonicalEvent`
- `VenueMarketProfile`
- `CompatibilityEdge`
- `CanonicalExecutableMarket`

Operational meaning:
- `resolution_profiles` is not the source of proposition identity by itself
- `resolution_risk_assessments` is not the source of venue discovery by itself
- both are routing/admin projections fed by the canonical graph

When debugging a bad pair:
1. confirm both venue markets are under the same `CanonicalEvent`
2. inspect whether they actually belong to the same `CanonicalExecutableMarket`
3. inspect the persisted `CompatibilityEdge` reason set before allowing any pooled treatment

## Liquidity Cost Interpretation

`EQUIVALENT_WITH_LAG` now means:
- the pair is still execution-safe enough to compare and route together
- Lotus must price capital lock / timing friction
- Lotus must anchor settlement/finality to the slowest safe side

It does not mean:
- dispute or reversal risk was ignored
- unsafe resolution semantics were priced through

If the edge is unsafe on proposition, resolution, or finality:
- expect `CAUTION` or `DO_NOT_POOL`
- do not override that with a liquidity premium

Operator rule:
- if any required edge is missing, stale, unsafe, or ambiguous, pooled routing must remain blocked for that route mode
- single-venue routing may still remain available
- `penalty_vs_no_penalty`
  - enforcement would have applied a caution penalty that shadow skipped
- `excluded_vs_allowed`
  - enforcement would have excluded internal execution that shadow allowed
- `missing_assessment`
  - a persisted assessment required for enforcement was absent
- `missing_profile_mapping`
  - a profile mapping required for enforcement was absent

### Production Validation Steps
1. confirm freshness is complete for target canonical events
2. confirm `hasMixedVersions=false`
3. confirm alerts in `docs/alerts-resolution-risk.md` are wired
4. run shadow mode and confirm divergence stays within expected bounds
5. enable enforcement only after shadow review is complete
6. keep `resolution_risk:kill_switch` available to freeze recomputation without weakening enforcement

Operator checks after enabling:
1. `GET /admin/resolution-risk/canonical/:eventId` still returns inspection output
2. `POST /admin/resolution-risk/recompute/:profileId` returns `409`
3. `POST /admin/resolution-risk/recompute/canonical/:eventId` returns `409`

## Historical Simulation Catalog Edge Source

The simulation-only historical catalog has its own pair-assessment store:

- `historical_simulation_profiles`
- `historical_simulation_risk_assessments`

Operational rule:
- these rows are only used by the admin historical simulation route-discovery path
- they do not replace or mutate live `resolution_risk_assessments`

When a historical multi-venue route is missing:
1. confirm the exact venues exist on the same `HISTSIM-...` canonical market
2. confirm accepted pair edges exist in `historical_simulation_risk_assessments`
3. if the market is only in the candidate manifest, it is not yet approved
4. if the route is unresolved because an Opinion numeric ID is missing, do not synthesize an assessment

Current v1 limitation:
- Opinion historical pair edges can only be created for already-known numeric IDs
- Myriad historical ingestion is available, but Myriad pooled pair/tri edges are not enabled in v1

## Supabase Verification
Before operational changes in a new environment:
1. Run:
```bash
npm run db:migrate:supabase
npm run db:verify:supabase
```
2. Confirm `resolution_profiles` and `resolution_risk_assessments` exist.
3. Confirm the latest migration is present in `schema_migrations`.
4. If verification fails, treat the environment as not ready for recomputation or routing policy validation.

## Incident Handling
Use this sequence:
1. Inspect the canonical event through `GET /admin/resolution-risk/canonical/:eventId`
2. Confirm completeness, freshness, and scoring version
3. Inspect the affected pair through `GET /resolution-risk/pair`
4. Validate RFQ grouping and SOR/internal policy behavior against the persisted class
5. If profiles changed or rows are stale, perform a controlled recompute
6. If recomputation must be frozen, enable `resolution_risk:kill_switch`
