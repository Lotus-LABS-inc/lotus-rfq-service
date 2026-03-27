# SOR Runbook

## Scope
This runbook covers Smart Order Router (SOR) operational recovery for stuck routing plans, forced unwind, controlled step retry, and exposure reconciliation after execution incidents.

## Detect Stuck Plans
Use these indicators:
- `routing_plans.state = 'RUNNING'` with no `route_history` updates for more than 2 minutes.
- `route_steps.state = 'EXECUTING'` with `submitted_at` older than expected step timeout window.
- Repeated `ROUTE_STEP_LOCK_SKIPPED` and no eventual `ROUTE_STEP_FILLED` or `ROUTE_STEP_FAILED`.
- Alert triggers from [alerts-sor.md](/c:/Users/Admin/Documents/lotus-RFQ-service/lotus-rfq-service/docs/alerts-sor.md).

Operational query:
```sql
SELECT p.id, p.rfq_id, p.state, MAX(h.created_at) AS last_event_at
FROM routing_plans p
LEFT JOIN route_history h ON h.routing_plan_id = p.id
WHERE p.state = 'RUNNING'
GROUP BY p.id, p.rfq_id, p.state
ORDER BY last_event_at NULLS FIRST;
```

## Force-Unwind Procedure (ADMIN+2FA)
1. Validate incident scope and affected `plan_id`.
2. Fetch plan snapshot:
`GET /admin/sor/plan/:id`
3. Confirm unresolved failures and policy impact (especially `ALL_OR_NONE`).
4. Execute force unwind with ADMIN+2FA:
`POST /admin/sor/plan/:id/force-unwind`
payload:
```json
{
  "reason": "manual_operator_unwind",
  "twoFactorToken": "123456"
}
```
5. Verify:
- plan state is terminal (`UNWOUND`),
- `route_history` contains `ADMIN_FORCE_UNWIND`,
- downstream incident ticket references the unwind reason and operator.

## Safely Re-Run Plan Runner (ADMIN+2FA)
Use only when:
- provider candidate is available for same leg,
- replay is approved in incident channel,
- idempotency expectations are confirmed.

Steps:
1. Fetch snapshot:
`GET /admin/sor/plan/:id`
2. Select failed step and replacement provider from current plan candidates.
3. Submit retry request:
`POST /admin/sor/plan/:id/retry-step`
payload:
```json
{
  "stepId": "<route_step_uuid>",
  "newProviderId": "<provider_id>",
  "newProviderType": "LP",
  "reason": "provider_timeout_retry",
  "twoFactorToken": "123456"
}
```
4. Verify terminal state transition and route history entry `ADMIN_STEP_RETRY_REQUESTED`.
5. Confirm no duplicate exposure application for retried step execution IDs.

## Reconcile Exposures After Unwind
After any unwind action:
1. Run exposure reconciliation job/process.
2. Compare exposure journal and final step outcomes:
- every filled step should have one idempotent exposure update,
- unwound or failed steps must not have net duplicated updates.
3. Validate risk totals and rolling exposure cache parity.
4. If mismatch persists, escalate to risk operator and freeze further retries for affected plan.

## Post-Incident Checklist
Required audit items:
1. `plan_id`, `rfq_id`, operator `user_id`, timestamp.
2. Admin action payloads:
- force-unwind reason,
- retry-step step ID/provider/reason.
3. Route timeline from `route_history`.
4. Step state timeline from `route_steps`.
5. Exposure reconciliation result and any manual adjustments.
6. Metrics and logs for window:
- SOR plan/step traces (`sor.build_plan`, `sor.plan_runner.step_execute`),
- retry/fallback counters,
- unwind counters.
7. Incident summary and prevention actions recorded in incident tracker.

## Feature Flag Operations
### Enable/Disable SOR
Use environment configuration:
- `SOR_ENABLED=true` to route authoritative accept flow through SOR.
- `SOR_ENABLED=false` to route authoritative accept flow through legacy execution path.

### Canary Shadow Start/Stop
For shadow-only comparison:
- `SOR_CANARY_SHADOW_ENABLED=true`
- `SOR_CANARY_PERCENT` in `[0,1]`
- set optional window:
  - `SOR_CANARY_START_AT` (ISO)
  - `SOR_CANARY_END_AT` (ISO)

Stop canary safely:
1. Set `SOR_CANARY_SHADOW_ENABLED=false`.
2. Verify `sor_shadow_total{sampled="true"}` returns to zero.

### Interpreting Shadow Metrics
- `sor_shadow_match_total`: agreement between shadow and authoritative decisions.
- `sor_shadow_divergence_total`: divergence reason breakdown.
- `sor_shadow_price_delta_bps`: economic spread distribution.
- `sor_enabled_state`: confirms authoritative mode per runtime.

### Canary Rollback Steps
1. Disable authoritative SOR: `SOR_ENABLED=false`.
2. Disable shadow: `SOR_CANARY_SHADOW_ENABLED=false`.
3. Confirm no new `SOR_CANARY_DECISION` events for active sessions.
4. Review recent divergence/error spikes and file incident summary.

## Postmortem Ownership
Every SOR incident requires a postmortem within 24 hours with:
- Incident commander (owner) and backup owner.
- Start/end timestamps (UTC), blast radius, and affected partners.
- Timeline anchored to `routing_plans`, `route_steps`, and `route_history`.
- Root cause, contributing factors, and concrete prevention items.
- Linked evidence: traces, metrics snapshots, and admin-action audit logs.

## Escalation Contacts
Use role-based escalation (do not rely on personal-only contacts):
1. Primary On-Call Backend Engineer (`#oncall-exchange`, pager duty primary).
2. Secondary On-Call SRE (`#oncall-sre`, pager duty secondary).
3. Risk Operations Lead (`#risk-ops`, escalation for exposure mismatch/unwind incidents).
4. Security On-Call (`#security-oncall`, required for auth abuse/admin endpoint misuse).
5. Engineering Manager (final escalation owner for prolonged degradation > 30 minutes).

## Exact-Market Route Availability

The admin simulation surface now exposes route availability by exact `canonical_market_id`, not by event-level venue guessing.

Supported route modes:

- `POLYMARKET_ONLY`
- `LIMITLESS_ONLY`
- `OPINION_ONLY`
- `MYRIAD_ONLY`
- `POLYMARKET_LIMITLESS`
- `POLYMARKET_OPINION`
- `LIMITLESS_OPINION`
- `POLYMARKET_LIMITLESS_OPINION`

### Inspect Routeability For One Event
1. Load `GET /admin/simulation/canonical/:eventId`
2. Inspect:
   - `canonicalMarkets[].routeModes`
   - `routeModeSummary`
   - `hasTriVenueRoute`
   - `triVenueRouteableMarketCount`
3. Confirm the target exact market is runnable for the requested route mode before attempting a pooled simulation.

### Interpret Unavailable Reasons
- `missing_required_venue`
  - the exact market is not present on every venue required by the route mode
- `missing_pair_assessment`
  - a required resolution-risk edge is absent
- `stale_resolution_risk`
  - assessments exist but were computed before the latest profile update
- `unsafe_equivalence`
  - the required pair exists but is not eligible for pooled routing
- `ambiguous_venue_identity`
  - more than one active profile exists for a required venue on the same exact market

### Tri-Venue Diagnosis
For `POLYMARKET_LIMITLESS_OPINION`, all three pair edges must be safe on the same exact market.

If tri-venue routing is unavailable:
1. inspect `canonicalMarkets[].routeModes` for the selected exact market
2. identify which pair edge is missing or unsafe
3. confirm the issue is not identity ambiguity on one venue
4. if the exact market exists on all three venues but one edge is missing, escalate to resolution-risk recomputation before re-testing

### Myriad-Only Interpretation
`MYRIAD_ONLY` is valid when the exact market has Myriad historical rows.

Operational meaning:
- historical replay is based on documented Myriad price charts plus market events
- historical orderbook depth is not available
- fills are conservative and evidence-bounded, not arbitrary-size historical quote replays

Current policy:
- do not expect Myriad pair or tri-venue route modes in v1
- treat Myriad as single-venue simulation inventory until exact cross-venue compatibility edges are curated

## Historical Simulation Catalog Workflow

Use this flow when operators need more historical route inventory for simulation without promoting markets into live Lotus routing.

### Generate Historical Candidates
Run:
```bash
npm run generate:historical-route-candidates
```

Output:
- `docs/historical-route-candidates.json`

Meaning:
- this is discovery only
- nothing is written into live routing inventory
- nothing becomes runnable until curation marks it `accepted`

### Curate Historical Routes
Edit:
- `docs/historical-route-curation.json`

Rules:
- `accepted` means the exact historical market is approved for simulation-only catalog sync
- `unresolved` means keep it visible but non-routable
- `rejected` means explicitly block promotion into the historical catalog

### Apply Historical Catalog Sync
Run:
```bash
npm run sync:historical-route-curation
```

Effects:
- upserts `historical_simulation_profiles`
- upserts `historical_simulation_risk_assessments`
- backfills `historical_market_states` under `HISTSIM::...` / `HISTSIM-...`

### Verify Historical Routeability
1. Load `GET /admin/simulation/scopes?routeMode=<mode>`
2. confirm the event appears with `catalogScope=historical_simulation`
3. inspect `GET /admin/simulation/canonical/:eventId`
4. confirm the exact market is runnable for the requested route mode

Current known seeded historical catalog routes:
- `HISTSIM::LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF`
  - runnable for `OPINION_ONLY`
- `HISTSIM::US-POLITICS-2028-DEM-NOM-GAVIN-NEWSOM`
  - runnable for `POLYMARKET_LIMITLESS`
- `HISTSIM::CRYPTO-BTC-ALL-TIME-HIGH-BY-2026-03-31`
  - runnable for `POLYMARKET_LIMITLESS`
- `HISTSIM::SPORTS-2026-NBA-CHAMPION-OKLAHOMA-CITY-THUNDER`
  - runnable for `POLYMARKET_LIMITLESS`
- `HISTSIM::SPORTS-2026-NHL-STANLEY-CUP-COLORADO-AVALANCHE`
  - runnable for `POLYMARKET_LIMITLESS`
- `HISTSIM::ESPORTS-LOL-LCK-2026-T1-WINS`
  - runnable for `POLYMARKET_LIMITLESS`
- `HISTSIM::ESPORTS-LOL-LCK-2026-GENG-WINS`
  - runnable for `POLYMARKET_LIMITLESS`

Current historical pair-readiness baseline:
- `POLITICS`: 1 exact pair route
- `CRYPTO`: 1 exact pair route
- `SPORTS`: 2 exact pair routes
- `ESPORTS`: 2 exact pair routes

Important boundary:
- historical simulation catalog entries do not become live Lotus route inventory automatically

Direct Myriad ingest:
```bash
npm run ingest:myriad -- --mode=backfill --category=crypto --batchSize=20
```

Notes:
- `batchSize` currently caps candidate markets processed, not the depth of each market's event history
- use `--maxEventPages` / `--maxEventRows` or the matching env vars to cap heavy market histories
- some Myriad markets have very large event histories, so uncapped backfills can take several minutes

## Canonical Graph Checks Before Escalation

When a route looks surprising, check the graph layers in this order:

1. `CanonicalEvent`
- are the venue markets about the same proposition at all?

2. `CanonicalExecutableMarket`
- are they actually in the same execution-safe group?

3. `CompatibilityEdge`
- is the pair `EQUIVALENT`, cautionary, distinct, or blocked?
- what reasons were persisted?

Routing rule:
- SOR can only pool inside one `CanonicalExecutableMarket`
- broad event overlap without executable grouping is not enough

## Liquidity-Cost-Aware Routing Interpretation

If a route is available with lag:
- it may still be safe
- Lotus prices `liquidityCostBps`
- Lotus anchors payout/finality to the slowest safe side

If a route is unavailable:
- do not assume lag alone is the reason
- first verify whether the failure is actually identity, resolution, or finality safety

## Compatibility Decision Rollout Boundary

Lotus now persists explicit:
- `InterpretedContract`
- `CompatibilityDecision`
- compatibility versions
- compatibility overrides
- route selection traces

These are additive to the current SOR path.

Current rollout rule:
- explicit compatibility decisions are authoritative decision artifacts for audit, replay, and override review
- current SOR pooled-routing treatment for `COMPATIBLE_WITH_CAUTION` still follows the existing `resolutionRiskReadService` / `resolutionRiskPolicyService` path
- the new feasibility filter must not be treated as the authoritative CAUTION cutover until a separate routing-policy rollout says so

Operational implication:
- if a current SOR result looks inconsistent with a stored `CompatibilityDecision`, first confirm whether the route ran through the legacy resolution-risk gating path or an explicit compatibility-decision path
- route traces are currently more authoritative for audit than for changing CAUTION routing behavior

## Route Selection Trace And Replay

SOR now records additive planner-stage artifacts:
- feasibility filtering result
- candidate set
- route rejection reasons
- chosen-route rationale
- compatibility decision ids used in the trace

Use these artifacts when diagnosing routing incidents:
1. inspect the routing plan and route history
2. inspect the route selection trace for candidate ordering and rejection reasons
3. confirm which compatibility decision versions were linked
4. confirm whether an override version was active
5. only then compare against replay output

Replay rule:
- route replay must be interpreted against the exact compatibility basis that the trace references
- do not infer compatibility from broad event identity or from `resolution_*` rows alone when the route trace provides narrower decision lineage

## Execution Intent, Record, And Recovery

SOR planning is now operationally separate from downstream execution state.

Execution objects:
- `ExecutionIntent`
  - intended route plan, requested size/notional, initiator, approval state, intended venue set
- `ExecutionRecord`
  - actual downstream execution, venue execution ids, fill details, retry lineage, sync status, settlement status
- `ExecutionStateTransition`
  - replayable transition history for the execution lifecycle

Recovery subsystem scope:
- quote expiry
- delayed approval
- one-leg fill / one-leg fail
- venue fill with local sync failure
- duplicate submission protection
- stale reservation cleanup linkage

Operational rule:
- the recovery subsystem is additive and explicit
- unsafe recovery must fail closed and escalate to operator review
- do not rely on unstructured logs to reconstruct execution state; use transition history and recovery actions first

## Cleanup Status (2026-03-21)

Completed in the compatibility/execution cleanup pass:
- `sor.order-router` CAUTION regression fixed
- additive planner-stage wrappers kept without changing current CAUTION policy authority
- replay and resolution-risk type drift cleaned up
- route and replay tests aligned to current `canonicalMarketId` and scoring input shapes

Remaining environment boundary:
- schema validation is still blocked until local Postgres connection details are aligned with the running instance
