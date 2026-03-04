# Combo RFQ / Multi-Leg Runbook

This runbook documents how to inspect, intervene in, and safely unwind **combo / multi-leg RFQs** using the admin APIs and operational tools.

## 1. Inspecting Combo Plan & Per-Leg States

- **Endpoint**
  - `GET /admin/combo/:id`

- **Example**

```bash
curl -X GET "http://localhost:3000/admin/combo/<COMBO_ID>" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

- **Response (shape)**

- High-level combo session metadata:
  - `comboId`, `state` (e.g. `OPEN`, `EXECUTING`, `EXECUTED`, `FAILED`),
  - `acceptancePolicy` (`ALL_OR_NONE`, `PARTIAL_ALLOWED`, etc.),
  - `expiresAt`,
  - `legs`: canonical legs (`canonicalMarketId`, `canonicalOutcomeId`, `side`, `quantity`).
- Per-leg exposure snapshot:
  - For each leg:
    - `postgres`: `gross`, `net`, `lastUpdated` from Postgres exposure.
    - `redisRolling`: rolling exposure from Redis.

- **Usage**
  - Confirm that:
    - Combo legs match the expected canonical markets and outcomes.
    - State transitions make sense given RFQ lifecycle events.
    - Per-leg exposures in Postgres and Redis look reasonable before taking admin actions.

## 2. Clearing Stuck Reservations (reservationId)

Combo executions rely on the same **risk reservations** and locks as single-leg RFQs.

- If a combo execution crashes after obtaining a reservation but before completion, the **reservation lock** can block new executions for that session.

- **Admin API (risk)**

Use the existing risk admin API to clear a specific reservation:

```bash
curl -X POST "http://localhost:3000/admin/risk/clear-reservation" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "reservationId": "<RESERVATION_ID>"
  }'
```

- **Finding `reservationId`**
  - Look at:
    - Application logs around the time of combo acceptance (`acceptCombo`), which include the reservation token.
    - Risk engine logs and metrics for `validateBeforeExecution`.
  - The same `reservationId`/token is used by both combo and single-leg flows.

- **Caution**
  - Only clear reservations **after** confirming the execution outcome (either fully failed or safely offset).
  - Clearing an active reservation without understanding execution state can lead to unbounded risk.

## 3. Replaying the Execution Runner Safely (Idempotent Re-Run)

The combo execution path is designed to be **idempotent** at the plan level.

- **Preconditions**
  - The original combo execution plan exists and has a known `planId`.
  - The underlying venues either:
    - Did not accept the original orders, or
    - Have well-understood, reconcilable fills.

- **High-Level Steps**
  1. Inspect the combo session:
     - `GET /admin/combo/:id` to understand the current combo state and legs.
  2. Inspect execution status:
     - Use internal tooling / SQL (e.g. `combo_execution_plans`, execution journal) to check already-filled legs.
  3. Trigger a replay:
     - Use the execution runner harness or internal script that replays the `ExecutionPlan` for a given `planId`.
     - Ensure the runner respects idempotency (skips already-filled steps based on the execution repository).
  4. Verify:
     - Confirm final status (`COMPLETED`/`PARTIAL`/`FAILED`) and that exposure updates are consistent.

- **Key Properties**
  - The runner checks previously filled steps and avoids double-executing them.
  - Risk exposure commits are tied to the plan’s `reservationToken` and step identifiers.

## 4. Unwinding Failed Combos & Refunding Users

When combos fail partially or fully after risk reservation, you may need to **unwind** positions and refund users according to business/legal policy.

- **Policy (business/legal)**
  - Follow the organization’s documented refund and unwind policy.
  - Typically requires:
    - Sign-off from Risk and Legal.
    - Clear record of which legs filled, at what prices, and net PnL impact.

- **Operational Steps**
  1. Inspect the combo:
     - `GET /admin/combo/:id` to see legs and current state.
  2. Inspect execution details:
     - Query execution journals / `combo_execution_plans` / leg-level fills.
     - Determine which legs actually filled and which failed.
  3. Decide unwind strategy:
     - Offsetting trades on venues (e.g. `MARKET_SELL` or equivalent) to neutralize residual exposure.
     - Direct ledger corrections/refunds in upstream accounting systems.
  4. Apply refunds:
     - Execute refunds through the standard custody/ledger pipeline; do **not** mutate exposure directly via ad‑hoc SQL.
  5. Document:
     - Record the incident, rationale, and actions taken for later audit.

## 5. Admin Endpoints for Forcing State

### 5.1 Force-Fail a Stuck Combo

- **Endpoint**
  - `POST /admin/combo/:id/force-fail`

- **Payload**

```json
{
  "reason": "operator-visible reason for failure",
  "correlationId": "optional-incident-or-trace-id"
}
```

- **Behavior**
  - Allowed for authenticated ADMINs.
  - If the combo is not yet in a terminal state (`FAILED` or `EXECUTED`), transitions it to `FAILED`.
  - Emits structured logs with:
    - `comboId`, `reason`, `correlationId`, and previous state.
  - Designed to **fail closed**:
    - 404 if combo does not exist.
    - 409 if combo is already terminal.
    - 500 on any internal error.

### 5.2 Force-Complete a Combo (ADMIN + 2FA)

- **Endpoint**
  - `POST /admin/combo/:id/force-complete`

- **Payload**

```json
{
  "reason": "why this combo is being manually finalized",
  "correlationId": "optional-incident-or-trace-id",
  "twoFactorToken": "ADMIN_2FA_TOKEN"
}
```

- **Behavior**
  - Requires:
    - ADMIN privileges (via admin auth middleware), and
    - A non-empty `twoFactorToken` (platform-specific verification applied at the gateway or future 2FA service).
  - If the combo is not yet in a terminal state, transitions it to `EXECUTED`.
  - Logs an auditable entry with:
    - `comboId`, `reason`, `correlationId`, previous state, and the fact that ADMIN+2FA was used.
  - Fails closed:
    - 403 if `twoFactorToken` is missing/invalid.
    - 404 if combo is missing.
    - 409 if combo is already terminal.

> Note: Exposure updates for combos are handled by the combo execution path and reconciliation jobs. Force-complete should be used only when you have independently verified that downstream settlement and exposure are consistent or will be corrected via reconciliation.

## 6. Emergency Kill-Switch & Feature Flag for Combos

Combos have their own emergency kill-switch to prevent **new combo RFQs or executions** while leaving single-leg RFQs unaffected.

- **Redis Key**
  - `combo:kill_switch`

- **Recommended Semantics**
  - Value `"on"` or `"true"` → kill-switch **enabled**.
  - Value `"off"` or key missing → kill-switch **disabled**.

- **Setting the Kill-Switch**

```bash
# Enable combo kill-switch
redis-cli set combo:kill_switch "true"

# Disable combo kill-switch
redis-cli del combo:kill_switch
```

- **Expected Behavior (once fully wired)**
  - New combo RFQs and combo executions should:
    - Check `combo:kill_switch` before processing.
    - Reject with a clear error (e.g. `COMBO_KILL_SWITCH_ACTIVE`) when the switch is enabled.

- **Operational Guidance**
  - Use the combo kill-switch when:
    - Detecting systemic issues specific to combo pricing, risk, or settlement.
    - Running high-risk migrations or maintenance affecting combo-only components.
  - After disabling:
    - Confirm via logs and metrics that new combo RFQs and executions are being accepted normally.
    - Run risk reconciliation to ensure exposures are consistent.

## 7. Deployment & Rollout Notes for Combos

- **Feature flag**
  - Env var: `COMBO_RFQ_ENABLED`.
  - Recommended behavior:
    - When `COMBO_RFQ_ENABLED` is `false` or unset:
      - User-facing combo endpoints (e.g. `/combo-rfqs`, `/lp/:id/combo-quotes`) should respond with a feature-disabled error (4xx) and avoid touching the combo engine.
    - When `COMBO_RFQ_ENABLED` is `true`:
      - Combo RFQ creation, quote collection, and execution are enabled (still subject to risk engine checks and `combo:kill_switch`).

- **Zero-downtime DB migrations**
  - Apply combo-related schema changes in **three phases**:
    1. **Additive schema changes**:
       - Create new tables (`combo_rfqs`, `combo_legs`, execution plan tables) and indexes via additive migrations only.
       - Do not drop or rewrite large columns while the system is live.
    2. **Deploy application changes**:
       - Roll out a version of the RFQ service that reads/writes the new combo tables while remaining compatible with the previous schema.
    3. **Tighten constraints (optional)**:
       - Once all instances run the new version and combo flows are stable, add stricter constraints (FKs, `NOT NULL`, unique indexes) as separate migrations.

- **Gradual rollout with traffic shadowing**
  - **Phase 1 – Internal only**
    - Enable `COMBO_RFQ_ENABLED=true` in staging.
    - Run full CI (unit + integration tests, migrations validation, metrics checks) and smoke tests before any production exposure.
  - **Phase 2 – Limited partner testing**
    - In production, keep `COMBO_RFQ_ENABLED=true` but gate real combo usage behind an **allowlist** (LP / taker IDs, or dedicated API keys).
    - Monitor combo-specific metrics (creation counts, execution duration, failure reasons, unwind attempts).
  - **Phase 3 – Traffic shadowing (≈2 weeks)**
    - Mirror a slice of real RFQ traffic into the combo engine as **shadow requests**:
      - Run full pricing, payout, risk, and planning logic.
      - Do **not** route orders to venues or commit exposure; treat results as observability-only.
    - Compare combo plans vs single-leg paths using logs and dashboards.
  - **Phase 4 – Gradual enablement**
    - Increase the fraction of real orders permitted to use combos (by allowlist expansion or percentage-based routing).
    - Keep `combo:kill_switch` documented as the fast rollback mechanism if issues are detected.
  - **Phase 5 – General availability**
    - Once stable for at least two weeks of shadowing and limited production flow:
      - Enable combos for all tenants by default via `COMBO_RFQ_ENABLED=true`.
      - Retain both the feature flag and `combo:kill_switch` for incident response and emergency rollback.

## 8. Post-Incident Checklist (Combos)

- [ ] **Confirm Combo State**: For impacted combos, ensure final states (`EXECUTED` / `FAILED`) align with actual market activity.
- [ ] **Verify Exposure**: Cross-check combo leg exposures in Postgres vs Redis using both:
  - `GET /admin/combo/:id`, and
  - Risk reconciliation jobs.
- [ ] **Run Reconciliation**: If any doubt, run the exposure reconciliation job with auto-fix enabled.
- [ ] **Audit Logs**: Review application logs for `force-fail` / `force-complete` actions and ensure they match operator intents.
- [ ] **Stakeholder Communication**: Notify Risk, Legal, and any affected users/LPs of the final state and remediation steps taken.

