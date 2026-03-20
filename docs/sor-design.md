# Smart Order Router (SOR) Design

## 1. Purpose & Scope

The Smart Order Router (SOR) selects and executes the best canonical routing strategy for RFQ execution while preserving:

- Canonical-only market semantics (no venue normalization in SOR).
- Deterministic, auditable plan construction.
- Reservation-first execution safety using existing risk semantics.
- Fail-closed behavior with explicit state and history recording.

In scope:

- Candidate scouting from canonical quote/capacity surfaces.
- Cost-based route selection and split planning.
- Multi-step execution orchestration via execution gateway abstractions.
- Plan lifecycle tracking and route history.

Out of scope:

- Venue-specific normalization logic.
- Direct upstream venue API calls from SOR.
- UI/API handler business logic.

## 2. Component Diagram (Textual)

1. `IOrderRouter`
   - Entry point.
   - Validates canonical intent + constraints.
   - Orchestrates scout -> cost model -> splitter -> composer -> runner.
2. `IRouteScout`
   - Fetches canonical route candidates (price/capacity/latency/reliability snapshots).
3. `ICostModel`
   - Computes expected cost and risk-adjusted penalty metrics per candidate.
4. `ISplitter`
   - Applies greedy split with constraints (`min_chunk_size`, tick rounding, provider capacity).
5. `IPlanComposer`
   - Produces deterministic routing plan + ordered route steps.
6. `IPlanRunner`
   - Executes plan in lifecycle phases with reservation and unwind semantics.
7. `IExecutionRouter`
   - Underlying execution abstraction used by runner for concrete route-step execution.
8. Persistence
   - Postgres stores `routing_plans`, `route_candidates`, `route_steps`, `route_history`.
   - Redis stores ephemeral locks/idempotency keys/phase coordination state.

## 3. Data Model Summary

### `routing_plans`

- `id` (uuid, pk)
- `session_id` (uuid, fk -> rfq_sessions)
- `objective_value` (numeric)
- `plan_status` (`DRAFT|RESERVED|RUNNING|COMPLETED|FAILED|UNWOUND`)
- `idempotency_key` (text, unique scope)
- `metadata` (jsonb)
- `created_at`, `updated_at`

### `route_candidates`

- `id` (uuid, pk)
- `plan_id` (uuid, fk -> routing_plans)
- `provider_id` (text)
- `canonical_market_id` (text)
- `canonical_outcome_id` (text nullable for market-level routes)
- `side` (`buy|sell`)
- `unit_price`, `provider_fee`, `protocol_fee`, `gas_cost`, `latency_penalty`, `failure_penalty` (numeric)
- `capacity` (numeric)
- `score` (numeric)
- `metadata` (jsonb)
- `created_at`

### `route_steps`

- `id` (uuid, pk)
- `plan_id` (uuid, fk -> routing_plans)
- `step_index` (int)
- `provider_id` (text)
- `quantity` (numeric)
- `rounded_quantity` (numeric)
- `target_price` (numeric)
- `step_status` (`PENDING|EXECUTING|FILLED|FAILED|SKIPPED|UNWOUND`)
- `execution_ref` (text nullable)
- `metadata` (jsonb)
- `created_at`, `updated_at`

### `route_history`

- `id` (uuid, pk)
- `plan_id` (uuid, fk -> routing_plans)
- `step_id` (uuid nullable fk -> route_steps)
- `event_type` (text)
- `event_payload` (jsonb)
- `occurred_at` (timestamptz)

## 4. Decision Model

Per-candidate effective unit cost:

`effective_unit_cost = base_price + provider_fee + protocol_fee + gas_cost + latency_penalty + failure_penalty`

Total expected cost for allocated quantity `q`:

`candidate_total_cost = q * effective_unit_cost`

Global objective (minimize):

`objective = sum(candidate_total_cost) + residual_unfilled_penalty + unwind_risk_penalty`

Where:

- `failure_penalty` captures provider failure probability * failure impact.
- `latency_penalty` captures stale/fill-risk under latency.
- `residual_unfilled_penalty` discourages plans unlikely to fully satisfy target size.

## 5. Splitter Algorithm (Greedy)

Input:

- Target quantity.
- Sorted candidates by ascending effective unit cost.
- Constraints: `min_chunk_size`, `tick_size`, `per_provider_capacity`.

Algorithm:

1. Initialize `remaining = target_quantity`.
2. Iterate candidates in score order.
3. For each candidate:
   - `alloc = min(remaining, provider_capacity)`.
   - If `alloc < min_chunk_size`, skip candidate.
   - Round `alloc` to tick granularity.
   - If rounded alloc is zero, skip.
   - Emit route step with rounded alloc.
   - Decrease `remaining`.
4. Stop when `remaining <= 0` or candidates exhausted.
5. If `remaining > 0`, mark plan as partially satisfiable and apply residual penalty/fail policy.

Constraints:

- No step below `min_chunk_size`.
- Tick rounding must be deterministic.
- Provider capacity never exceeded.

## 6. Execution Plan Lifecycle

### Phase 0: Reservation

- Acquire distributed lock (Redis).
- Validate canonical session state and candidate freshness.
- Reserve exposure using existing risk reservation semantics.
- Persist plan status `RESERVED`.

### Phase 1: Run

- Move status to `RUNNING`.
- Execute steps in order via `IExecutionRouter`.
- Record each step transition in `route_history`.
- On failure, apply policy:
  - Continue best-effort steps, or
  - Abort and move to unwind.

### Phase 2: Finalize / Unwind

- If success criteria met, mark `COMPLETED`.
- If policy breached, execute unwind flow and mark `UNWOUND` or `FAILED`.
- Persist final history event and release locks.

## 7. Interfaces To Implement

- `IOrderRouter`
- `IRouteScout`
- `ICostModel`
- `ISplitter`
- `IPlanComposer`
- `IPlanRunner`
- `IExecutionRouter`

Concrete TypeScript stubs are defined in:

- `src/core/sor/types.ts`

## 8. Required Metrics & Tracing Spans

Metrics (minimum):

- Counters:
  - `sor_plan_created_total`
  - `sor_plan_completed_total`
  - `sor_plan_failed_total`
  - `sor_unwind_total`
- Histograms:
  - `sor_scout_latency_ms`
  - `sor_split_latency_ms`
  - `sor_plan_latency_ms`
  - `sor_step_execution_latency_ms`
- Gauges:
  - `sor_active_plans`
  - `sor_locked_sessions`

Tracing spans (minimum):

- `sor.route`
- `sor.scout`
- `sor.cost_model`
- `sor.split`
- `sor.compose`
- `sor.reserve`
- `sor.run_step`
- `sor.finalize`
- `sor.unwind`

Required span attributes:

- `rfq_id`
- `plan_id`
- `provider_id` (when applicable)
- `state`

## 9. Failure Modes & Runbook Actions

## 10. Exact-Market Route Availability

Historical simulation and future Lotus route selection now depend on an exact-market route availability model instead of a hardcoded venue-pair enum.

Supported route modes:

- `POLYMARKET_ONLY`
- `LIMITLESS_ONLY`
- `OPINION_ONLY`
- `MYRIAD_ONLY`
- `POLYMARKET_LIMITLESS`
- `POLYMARKET_OPINION`
- `LIMITLESS_OPINION`
- `POLYMARKET_LIMITLESS_OPINION`

Rules:

- Routeability is computed per exact `canonical_market_id`, never across different markets inside one `canonical_event_id`.
- Single-venue route modes require historical rows for the required venue on that exact market.
- Multi-venue route modes require all required venues on that same exact market plus safe pairwise resolution-risk support.
- A pair edge is eligible only when the persisted assessment is `SAFE_EQUIVALENT` or `EQUIVALENT_WITH_LAG`.
- `MYRIAD_ONLY` is intentionally single-venue in v1 because documented Myriad history provides price charts and market events, not historical quote-depth snapshots.

## 11. Layered Canonicalization Graph

The router must now be understood as consuming a layered canonical graph, not a single merged market identity model.

Authoritative graph objects:

1. `CanonicalEvent`
- broad proposition cluster
- useful for search, discovery, and proposition grouping
- not directly poolable

2. `VenueMarketProfile`
- venue execution object with venue-native IDs, timing, fees, resolution data, settlement data, structure, and payload lineage

3. `CompatibilityEdge`
- explicit pairwise execution relationship between two venue profiles under the same `CanonicalEvent`
- classes:
  - `EQUIVALENT`
  - `COMPATIBLE_WITH_CAUTION`
  - `DISTINCT`
  - `DO_NOT_POOL`

4. `CanonicalExecutableMarket`
- execution-safe grouping derived only from eligible `CompatibilityEdge`s
- this is the routing-facing identity behind pooled execution

Design rule:
- SOR must never infer pooled execution from `CanonicalEvent` alone.
- SOR may only pool when the relevant venue profiles belong to the same `CanonicalExecutableMarket`.

## 12. Liquidity Cost And Conservative Finality

Settlement lag is not part of proposition identity.

It is handled on `CompatibilityEdge` as priced friction only after semantic safety is already acceptable.

Persisted edge fields include:
- `capitalLockHours`
- `maxSettlementDelayHours`
- `liquidityCostModelVersion`
- `liquidityCostBps`
- `anchoredFinalityHours`
- `requiresConservativeSettlementAnchor`

Operational policy:
- unsafe proposition / resolution / finality mismatches do not become “equivalent with a fee”
- lag-only safe edges may remain groupable, but SOR must price the lag and anchor payout/finality to the slowest safe timeline
- Tri-venue routeability requires all three pair edges to pass:
  - `POLYMARKET ↔ LIMITLESS`
  - `POLYMARKET ↔ OPINION`
  - `LIMITLESS ↔ OPINION`

Unavailable route modes must fail closed with explicit reasons:

- `missing_required_venue`
- `missing_historical_rows`
- `missing_pair_assessment`
- `incomplete_resolution_risk`
- `stale_resolution_risk`
- `unsafe_equivalence`
- `ambiguous_venue_identity`

Operational consequence:

- ambiguous or unsafe pooled routes do not block single-venue or external-only routing
- this preserves the fail-to-SOR behavior for user continuity while keeping pooled internalization fail-closed

## 11. Simulation-Only Historical Catalog

To support route testing before live cross-venue inventory is fully curated, the admin historical simulation layer now unions in a simulation-only historical catalog.

Inventory boundary:

- live routing inventory remains in:
  - `resolution_profiles`
  - `resolution_risk_assessments`
- historical simulation-only inventory now lives in:
  - `historical_simulation_profiles`
  - `historical_simulation_risk_assessments`

Time-series behavior:

- accepted historical discoveries write their state history into `historical_market_states`
- simulation-only rows use dedicated canonical IDs:
  - event ids prefixed with `HISTSIM::`
  - market ids prefixed with `HISTSIM-`

Approval model:

- candidate generation is non-destructive
- generated candidates go to `docs/historical-route-candidates.json`
- only checked-in `accepted` entries from `docs/historical-route-curation.json` are synced into the catalog
- unresolved or rejected historical candidates never become routable

Admin/API consequence:

- simulation scope and canonical-coverage responses include `catalogScope`
  - `live`
  - `historical_simulation`
- Myriad historical inventory may appear in those responses as `catalogScope=live` graph-backed inventory, but its v1 runnable route is only `MYRIAD_ONLY`
- this lets operators test historical exact markets without confusing them with current live Lotus routeability

Current limitation:

- pair and tri-venue historical routes still require curated exact market IDs and safe pair assessments on all participating venues
- Opinion historical discovery remains limited to already known numeric IDs

1. Lock acquisition failure
   - Action: reject execution attempt, retry with bounded backoff, alert on sustained contention.
2. Reservation failure
   - Action: fail closed, record reason in `route_history`, return non-executable status.
3. Candidate exhaustion / insufficient capacity
   - Action: fail or partial policy path, emit risk and routing diagnostics.
4. Step execution failure
   - Action: record failed step; run configured fallback or unwind policy.
5. Persistence failure
   - Action: stop execution progression, emit critical alert, keep lock until safe release path.
6. Idempotency collision
   - Action: return existing plan handle/status; avoid duplicate execution side effects.

Runbook linkage:

- Add SOR operational procedures under combo/risk runbooks with:
  - lock contention playbook,
  - reservation stuck cleanup,
  - unwind verification checklist,
  - rollback/kill-switch procedures.
