# Internal Netting Runbook

This runbook covers Phase 2A multi-leg internal netting operations. Postgres is authoritative. Redis candidate-registry state is a live snapshot only.

## Inspect a Netted Combo

Use:

`GET /admin/internal-netting/combo/:id`

Verify:
- combo `state`
- each leg `remaining_size`
- linked incoming and matched netting groups
- Redis candidate-registry presence for residual legs only

If `remaining_size = 0` on every leg, the combo should not remain present in the Redis candidate registry.

## Inspect a Netting Group

Use:

`GET /admin/internal-netting/group/:id`

Verify:
- `combo_netting_groups` row
- linked `combo_netting_match_legs`
- both combo session states
- residual state for incoming and matched combos
- exposure journal references for the group

Fail closed if:
- matched legs are missing
- attempt rows are missing
- combo linkage is inconsistent

## Verify Matched Legs

For every `combo_netting_match_legs` row:
- `incoming_leg_id` must exist on the incoming combo
- `matched_leg_id` must exist on the matched combo
- `market_id` and `outcome_id` must match the canonical leg values on both sides
- `matched_size` must not exceed either source leg `size`

Use:
- `GET /admin/internal-netting/group/:id`
- direct SQL only if the admin snapshot reports ambiguity

## Verify Exposures

For a netting group:
- `exposure_journal.reference_id` must equal the netting group id
- there should be journal coverage for both users
- payloads should reference:
  - `incomingComboId`
  - `matchedComboId`
  - per-leg details
  - attempt identifiers

If the group snapshot shows fewer than two exposure journal rows, treat it as a critical discrepancy and reconcile immediately.

## Reconcile Redis vs Postgres

Redis keys:

`combo_net:leg:{marketId}:{outcomeId}:{side}`

Compare Redis against authoritative residual state from `combo_legs.remaining_size`:
- legs with `remaining_size > 0` should be present in the candidate registry
- legs with `remaining_size = 0` should not be present

Use:

`POST /admin/internal-netting/group/:id/reconcile`

Expected discrepancy codes include:
- `MATCH_LEG_REFERENCE_MISSING`
- `MATCH_SIZE_EXCEEDS_LEG_SIZE`
- `COMBO_STATE_RESIDUAL_MISMATCH`
- `EXPOSURE_JOURNAL_INCOMPLETE`
- `REDIS_RESIDUAL_MISMATCH`
- `ATTEMPT_LINK_MISSING`

## Supabase Schema Verification
Schema application to Supabase is explicit. Supabase MCP connectivity is not evidence that repo migrations were applied.

Run:

```bash
npm run db:migrate:supabase
npm run db:verify:supabase
```

Then verify:
1. `schema_migrations` contains the latest `sql/migrations` filenames. All SQL migrations live in `sql/migrations`.
2. Latest internal-netting migrations are present, including:
   - `sql/migrations/2026_03_10_create_combo_netting_tables.sql`
   - `sql/migrations/2026_03_10_create_combo_netting_attempts.sql`
   - `sql/migrations/2026_03_10_create_internal_netting_admin_tables.sql`
3. Treat any missing ledger row or missing table/index as an operational stop.

## Handle Stuck Residual Combos

A combo is operationally stuck when:
- it remains `PARTIALLY_EXECUTED`
- residual legs still show `remaining_size > 0`
- Redis candidate presence or routing follow-up is inconsistent

Procedure:
1. Inspect the combo with `GET /admin/internal-netting/combo/:id`.
2. Inspect each linked group with `GET /admin/internal-netting/group/:id`.
3. Run `POST /admin/internal-netting/group/:id/reconcile` for each linked group.
4. Verify whether the residual legs are still present in the Redis candidate registry.
5. If residual routing is blocked, stop new internal netting first via kill switch.
6. Escalate to the manual unwind workflow if exposure or state discrepancies remain unresolved.

## Force-Fail Workflow

Use:

`POST /admin/internal-netting/group/:id/force-fail`

Requirements:
- ADMIN
- valid `twoFactorToken`
- explicit `reason`

Behavior:
- creates an unwind task only
- creates an audit event only
- does not modify:
  - `combo_netting_groups.state`
  - `combo_netting_match_legs`
  - combo exposure
  - combo state

Treat `force-fail` as an operator queueing action, not an immediate correction.

## Kill Switch

Redis key:

`internal_netting:kill_switch`

Operational commands:

```bash
redis-cli set internal_netting:kill_switch "true"
redis-cli del internal_netting:kill_switch
```

After enabling the kill switch:
1. Confirm new internal-netting attempts stop.
2. Confirm residual combos continue on their safe fallback path only if the application is configured to allow it.
3. Inspect any in-flight netting groups for partial residual state.
4. Capture logs, correlation ids, and affected combo ids.
5. Confirm `combo_internal_net_kill_switch_total` increments for suppressed internal-netting attempts.

## Shadow Rollout

Enable shadow with:

```bash
INTERNAL_NETTING_ENABLED=false
INTERNAL_NETTING_SHADOW_ENABLED=true
INTERNAL_NETTING_SHADOW_PERCENT=0.01
INTERNAL_NETTING_SHADOW_START_AT=2026-03-10T00:00:00.000Z
INTERNAL_NETTING_SHADOW_END_AT=2026-03-24T00:00:00.000Z
```

Verify:
1. `combo_internal_net_shadow_total{sampled="true"}` increases.
2. `combo_internal_net_shadow_match_total` and `combo_internal_net_shadow_divergence_total` move as expected.
3. No new `combo_netting_groups`, `combo_netting_match_legs`, `combo_netting_attempts`, or `exposure_journal` rows are created solely from shadow evaluation.

Disable shadow with:

```bash
INTERNAL_NETTING_SHADOW_ENABLED=false
```

## Canary Rollout

Start canary with:

```bash
INTERNAL_NETTING_ENABLED=false
INTERNAL_NETTING_CANARY_ENABLED=true
INTERNAL_NETTING_CANARY_PERCENT=0.01
INTERNAL_NETTING_CANARY_START_AT=2026-03-24T00:00:00.000Z
INTERNAL_NETTING_CANARY_END_AT=2026-04-07T00:00:00.000Z
```

Promotion criteria:
1. Shadow divergence remains below operational threshold for the agreed window.
2. No duplicate attempt or exposure anomalies appear.
3. Stress and concurrency harnesses pass against current infrastructure.
4. Admin reconciliation shows no unresolved `EXPOSURE_JOURNAL_INCOMPLETE` or `COMBO_STATE_RESIDUAL_MISMATCH` issues.

Stop canary with:

```bash
INTERNAL_NETTING_CANARY_ENABLED=false
```

## Rollback Procedure

1. Set `INTERNAL_NETTING_CANARY_ENABLED=false`.
2. If active issues persist, set `INTERNAL_NETTING_SHADOW_ENABLED=false`.
3. If immediate suppression is required, set `internal_netting:kill_switch`.
4. Verify:
   - `combo_internal_net_attempt_total` stops increasing for authoritative flows.
   - `combo_internal_net_kill_switch_total` increments if the kill switch is active.
   - combo execution continues on the external-only path.

## Divergence Investigation

When shadow and authoritative external-only outcomes diverge:
1. Check whether the request was sampled under shadow or canary.
2. Inspect `combo_internal_net_shadow_divergence_total` by `reason`.
3. Compare `combo_legs.remaining_size` with candidate-registry membership.
4. Inspect `combo_netting_attempts` and `combo_netting_groups` if canary was authoritative.
5. Inspect `exposure_journal` rows with `source='combo-internal-net'`.
6. If divergence is tied to active suppression, confirm `internal_netting:kill_switch`.

## Post-Incident Checklist

- verify `combo_netting_groups`
- verify `combo_netting_match_legs`
- verify `combo_netting_attempts`
- verify `exposure_journal`
- verify `combo_legs.remaining_size`
- verify Redis candidate-registry state
- capture correlation ids and admin event ids
- confirm whether any manual unwind tasks were created
- confirm no residual combo was left in an invalid terminal state
- notify stakeholders
