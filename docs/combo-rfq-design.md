# Multi-Leg / Combo RFQ Engine Design

## 1. Purpose & Scope
The Multi-Leg / Combo RFQ Engine enables Takers to request quotes for complex, multi-leg strategies (e.g., straddles, spreads, parlays) across disparate canonical markets atomically. The engine abstracts the routing, pricing, and execution complexities, allowing LPs to quote on the package as a whole or on individual legs, while guaranteeing strict risk validation and execution semantics.

**Scope:**
- Ingestion of multi-leg RFQ requests tied strictly to canonical market objects.
- Normalization and ranking of combo quotes versus aggregated single-leg quotes.
- Payout-aware pricing validation.
- Atomic reservation and execution routing across multiple venues.

## 2. Acceptance Policies
The engine supports three strict acceptance policies governing how a combo RFQ can be filled:

- **`ALL_OR_NONE` (AON):** The entire requested quantity for *all* legs must be filled simultaneously at or better than the requested aggregate price. If sufficient liquidity across all legs isn't available concurrently, the execution fails entirely. Requires distributed transactions or two-phase commit semantics.
- **`PARTIAL_ALLOWED`:** The combo can be filled for a partial quantity, provided that the *ratio* of the legs remains exactly as requested. For example, if requesting 10 A and 5 B (2:1 ratio), a fill of 4 A and 2 B is acceptable.
- **`BEST_EFFORT`:** (Rarely used for strict arbitrage/risk management) Attempts to fill as much of each leg as possible independently. If one leg fails or partially fills, the other legs proceed. *Warning: Breaks the atomicity of the strategy and exposes the Taker to leg risk.*

## 3. Pricing Algorithms

### 3.1 Payout-Vector Pricing Algorithm (Primary)
When canonical mapping permits, the engine evaluates combo quotes based on the ultimate payout states rather than naive price summation. This ensures capital efficiency and prevents over-collateralization.

**Detailed Steps:**
1. **State Enumeration:** Identify all mutually exclusive terminal states for the underlying canonical markets in the combo.
2. **Payout Matrix Construction:** For each quote leg, determine the payout in every terminal state.
3. **Vector Summation:** Sum the payouts across all legs for each state to create the aggregate payout vector.
4. **Cost Basis Calculation:** The actual risk (or cost) of the combo is the maximum possible loss across all payout states, minus the premium collected.
5. **Ranking:** Rank combo quotes based on the lowest required capital outlay (Cost Basis) for the requested payout vector.

### 3.2 Linear-Sum Method (Fallback)
If payout-vector mapping is impossible (e.g., markets are completely uncorrelated or lack canonical state mapping), the engine falls back to standard linear summation.

**Detailed Steps:**
1. **Leg Aggregation:** Sum the best available prices (`quantity * price`) for each leg independently.
2. **Comparison:** Compare the linear sum of single-leg quotes against explicit combo quotes provided by market makers.
3. **Winner Selection:** The optimal execution path is the one offering the best aggregate price, regardless of whether it's a single LP taking the whole combo or multiple LPs taking individual legs.

## 4. ExecutionPlanBuilder Behavior

The `ExecutionPlanBuilder` translates ranked quotes into a deterministic execution plan.

### Example 1: `ALL_OR_NONE`
**Request:** Buy 100 Leg A, Buy 100 Leg B.
**Available Quotes:**
- LP1: Combo Quote for 100 A + 100 B @ $0.80 total.
- LP2: Single Leg A for 100 @ $0.45
- LP3: Single Leg B for 100 @ $0.40
**Builder Output:**
Selects the Single Leg combination (Total $0.85 > Combo $0.80). However, if LP1 only offered 50 quantity, and no other combo quotes existed, the AON builder would *reject* the plan unless LP2+LP3 combined could satisfy the full 100 quantity simultaneously.

### Example 2: `PARTIAL_ALLOWED`
**Request:** Buy 100 Leg A, Buy 50 Leg B (Ratio 2:1).
**Available Quotes:**
- LP1: Single Leg A for 80 @ $0.40
- LP2: Single Leg B for 30 @ $0.50
**Builder Output:**
The limiting factor is Leg B (30 available). Looking at the 2:1 ratio, 30 B allows for 60 A.
Plan: Execute 60 Leg A with LP1, and 30 Leg B with LP2. The remaining requested quantity is canceled/unfilled.

## 5. Integration Points

- **Canonical Client:** The Combo Engine *strictly* relies on the canonical client to resolve market definitions, terminal states (for payout vector math), and settlement resolution rules. It never infers market correlation locally.
- **RiskEngine Reservation Model:** Before execution, the engine must atomically acquire reservations via `RiskEngine.validateBeforeExecution` for *every* leg in the Execution Plan. If any leg fails risk validation (e.g., an individual market cap is breached), the entire combo execution is aborted (AON) or re-planned (Partial).
- **Execution Router Interface:** The Combo Engine hands off the validated `ExecutionPlan` to the existing `ExecutionRouterService`. The router must support a combo-aware payload, ensuring it attempts execution across venues and handles partial fill unwinds if a leg fails post-routing.

## 6. TypeScript Interfaces
*(See `src/core/combo-engine/combo-rfq.interfaces.ts` for actual definitions).*
- `IComboEngine`
- `IComboRepository`
- `IComboQuoteNormalizer`
- `IExecutionPlanBuilder`

## 7. Architecture & Dataflow

### Textual Dataflow
1. **Ingestion:** `POST /combo-rfq` -> `ComboEngine.createComboRFQ()`
2. **Broadcasting:** Emits events to LPs detailing the canonical legs and requested policy.
3. **Aggregation:** `ComboEngine.collectQuote()` ingests both combo quotes and single-leg quotes.
4. **Ranking:** `ComboEngine.rankQuotes()` invokes `IComboQuoteNormalizer` (Payout-Vector or Linear-Sum).
5. **Planning:** Taker accepts -> `ExecutionPlanBuilder` creates routing instructions based on policy (AON, Partial).
6. **Risk Validation:** `RiskEngine` atomically reserves gross exposure for all legs.
7. **Execution:** `ExecutionRouter` dispatches legs to respective venues.
8. **Finalization:** `ComboEngine` processes execution callbacks, updating status and triggering idempotency checks.

### Failure Modes & Idempotency
- **Idempotency:** All combo operations are keyed by `combo_session_id` and `execution_plan_id`. Retries of `acceptCombo` with the same payload return the existing plan state.
- **Atomic Failure:** If a multi-leg execution fails halfway through routing, the `ExecutionRouter` relies on exchange-level revert mechanisms or initiates offset trades (if configured) to unwind the partial fill, respecting the `ALL_OR_NONE` invariant.

## 8. Required Metrics and Alerts
- **Metrics (Prometheus):**
  - `combo_rfq_created_total{legs="N"}`
  - `combo_quote_normalization_latency_ms`
  - `combo_execution_plan_generated_total{policy="AON|PARTIAL"}`
  - `combo_pricing_fallback_total` (Count of times falling back to Linear-Sum from Payout-Vector)
- **Alerts:**
  - `HighComboFallbackRate`: Triggered if >20% of combos fall back to linear summation, indicating canonical mapping issues.
  - `ComboUnwindFailure`: Triggered if an AON execution partially fills and the unwind process fails.

## 9. Runbook Summary (Top 6 Failure Scenarios)
1. **Reservation Leak:** If combo execution crashes post-risk-lock, run `curl -X POST /admin/risk/clear-reservation -d '{"reservationId": "combo_id"}'` to release collateral.
2. **Partial Fill Unwind Failure (AON):** If automatic unwind fails, manual intervention required. Query `execution_journal` for stranded legs and manually offset via exchange admin tools.
3. **LP Retraction during Routing:** If an LP pulls a quote mid-combo, `ExecutionRouter` fails closed. Taker must resubmit. Check `lp_stats` for high retraction rates.
4. **Idempotency Replay Loop:** If a client spam-retries an accepted combo, verify `combo_executions` table `transaction_hash`. If populated, API gateway is failing to return cached success response.
5. **Canonical Mismatch:** If payout-vector pricing throws errors, verify `canonical_market_id` mappings in the Canonical Service. Run `npx tsx scripts/sync-canonical.ts`.
6. **Reconciliation Failure:** Unwind operations may cause temporary exposure drift. Run `RISK_AUTO_FIX=true npx tsx scripts/reconcile-exposure.sh`.
