# Internal Clearing Runbook

This runbook covers Phase 2B constrained multi-party internal clearing. Postgres is authoritative. Redis is a live bucket index and snapshot cache only.

Default runtime posture:

- `INTERNAL_CLEARING_ENABLED=false`
- shadow and canary remain opt-in through the existing Phase 2B rollout flags
- `internal_clearing:kill_switch` remains the fastest rollback control

## Inspect a Clearing Round

Use:

`GET /admin/internal-clearing/round/:id`

Verify:
- `clearing_rounds` row
- `clearing_round_participants`
- `clearing_round_leg_matches`
- `clearing_round_events`
- `exposure_journal` links for `source='combo-multi-party-clearing'`
- current authoritative residual states for all participant entities

Fail closed if:
- the round has no participants
- `CLEARING_APPLIED` event is missing
- any leg match references a missing participant

## Inspect Participant Residual State

Use:

`GET /admin/internal-clearing/entity/:id`

Verify:
- combo `state`
- every leg `remaining_size`
- linked clearing-round participation history
- whether Redis bucket membership and snapshot presence match current residual truth

If every leg `remaining_size = 0`, the entity should not remain active in the Phase 2B Redis registry.

## Verify Exposure Consistency

For a clearing round:
- `exposure_journal.reference_id` must equal the clearing round id
- `source` must be `combo-multi-party-clearing`
- each participant user should have exposure journal coverage
- payloads should include round identity and participant identity fields

If any participant user is missing journal coverage, treat it as a critical discrepancy.

## Reconcile Redis vs Postgres

Redis keys:

`clearing:bucket:{bucketId}`

`clearing:entity:{entityId}`

Postgres truth comes from:
- `combo_rfqs.state`
- `combo_legs.remaining_size`

Use:

`POST /admin/internal-clearing/round/:id/reconcile`

Expected discrepancy codes:
- `PARTICIPANT_REFERENCE_MISSING`
- `LEG_MATCH_REFERENCE_MISSING`
- `MATCH_SIZE_EXCEEDS_RESIDUAL`
- `ENTITY_STATE_RESIDUAL_MISMATCH`
- `EXPOSURE_JOURNAL_INCOMPLETE`
- `REDIS_BUCKET_MISMATCH`
- `ROUND_EVENT_MISSING`

## Rebuild Redis Bucket Indexes From Postgres

Use authoritative Postgres only.

Procedure:
1. Load the current combo/entity state from Postgres.
2. Rebuild the residual vector with `ResidualVectorBuilder`.
3. Remove stale Redis state:
   - unregister stale `clearing:entity:{entityId}`
   - remove stale membership from `clearing:bucket:{bucketId}`
4. Re-register only entities with residual legs remaining.
5. Confirm:
   - terminal entities remain absent
   - residual entities exist in the correct bucket and snapshot key

Do not treat Redis as proof of correctness. Rebuild from Postgres whenever there is divergence.

## Handle Stuck Residuals

A residual is operationally stuck when:
- the entity remains `PARTIALLY_EXECUTED`
- residual legs still show `remaining_size > 0`
- clearing participation exists but Redis state or downstream routing is inconsistent

Procedure:
1. Inspect the entity with `GET /admin/internal-clearing/entity/:id`.
2. Inspect every linked round with `GET /admin/internal-clearing/round/:id`.
3. Reconcile the affected round with `POST /admin/internal-clearing/round/:id/reconcile`.
4. Compare current Redis bucket state with authoritative residual truth.
5. If new internal clearing must stop, activate the kill switch first.
6. If discrepancies remain unresolved, create a manual intervention task with `force-fail`.

## Force-Fail Workflow

Use:

`POST /admin/internal-clearing/round/:id/force-fail`

Requirements:
- ADMIN
- valid `twoFactorToken`
- explicit `reason`

Behavior:
- creates an unwind/manual intervention task only
- creates an audit event only
- does not mutate:
  - `clearing_rounds.state`
  - `clearing_round_participants`
  - `clearing_round_leg_matches`
  - `combo_rfqs`
  - `combo_legs`
  - `exposure`
  - `exposure_journal`

Treat `force-fail` as an operator queueing action only.

## Kill Switch

Redis key:

`internal_clearing:kill_switch`

Operational commands:

```bash
redis-cli set internal_clearing:kill_switch "true"
redis-cli del internal_clearing:kill_switch
```

After enabling the kill switch:
1. Confirm new authoritative Phase 2B clearing stops.
2. Confirm residual entities continue on their safe external fallback path where configured.
3. Inspect in-flight clearing rounds for unresolved residual state.
4. Capture round ids, participant ids, and correlation ids.
5. Confirm clearing suppression metrics increment.

## Shadow Rollout

Runtime controls:

- `INTERNAL_CLEARING_ENABLED=false`
- `INTERNAL_CLEARING_SHADOW_ENABLED`
- `INTERNAL_CLEARING_SHADOW_PERCENT`
- `INTERNAL_CLEARING_SHADOW_START_AT`
- `INTERNAL_CLEARING_SHADOW_END_AT`

Enable shadow only after:
1. `npm run db:verify:supabase` passes.
2. `npx vitest run test/unit/internal-clearing-runtime-controls.test.ts test/integration/internal-clearing-residual-routing.integration.test.ts --maxWorkers=1` passes.
3. `npm run stress:internal-clearing` passes.

Verification during shadow:
1. Confirm `combo_internal_clearing_shadow_total` increments.
2. Confirm `clearing_rounds` does not increase from shadow-sampled requests alone.
3. Inspect `combo_internal_clearing_shadow_match_total` and `combo_internal_clearing_shadow_divergence_total`.
4. Investigate any sustained `different_clearing_outcome` or `different_residual_size` divergence before promotion.
5. Run `npm run stress:internal-clearing` and confirm the configured runtime budget is not exceeded.
6. Run `npx vitest run test/integration/internal-clearing-rollout-validation.integration.test.ts --maxWorkers=1` and confirm planner determinism and Redis rebuild validation stay green.

## Canary Rollout

Runtime controls:

- `INTERNAL_CLEARING_CANARY_ENABLED`
- `INTERNAL_CLEARING_CANARY_PERCENT`
- `INTERNAL_CLEARING_CANARY_START_AT`
- `INTERNAL_CLEARING_CANARY_END_AT`

Promotion criteria from shadow to canary:
1. shadow checks green for the planned window
2. no unresolved admin reconciliation discrepancies
3. alerts and dashboard artifacts are in place
4. kill-switch drill completed

Verification during canary:
1. Confirm `clearing_round_attempts_total`, `clearing_round_success_total`, `clearing_round_partial_total`, and `clearing_residual_routed_total` move as expected.
2. Confirm `combo_internal_clearing_shadow_divergence_total` remains within threshold.
3. Inspect recent `clearing_rounds`, `clearing_round_participants`, `clearing_round_leg_matches`, and `exposure_journal`.
4. Verify residual combos continue to external routing correctly when not fully cleared.
5. Validate that Redis bucket drift can still be rebuilt from authoritative Postgres residual state before promotion beyond canary.

## Rollback Procedure

1. Set `internal_clearing:kill_switch` to suppress authoritative Phase 2B clearing immediately.
2. Disable `INTERNAL_CLEARING_CANARY_ENABLED`.
3. If shadow is still running, keep it only if divergence inspection is still useful; otherwise disable `INTERNAL_CLEARING_SHADOW_ENABLED`.
4. Verify new combo accepts continue on the safe external-only fallback path.
5. Inspect in-flight or recently committed rounds for unresolved residuals.

## Divergence Investigation

When shadow or canary diverges:
1. inspect the affected combo via `GET /admin/internal-clearing/entity/:id`
2. inspect linked rounds with `GET /admin/internal-clearing/round/:id`
3. compare `combo_legs.remaining_size` with Redis bucket/entity presence
4. inspect `exposure_journal` for `source='combo-multi-party-clearing'`
5. if required, reconcile Redis bucket state from Postgres before re-enabling canary

## Limited Prod Preconditions

Before marking limited-prod ready:
1. Supabase schema verified
2. shadow checks green
3. canary checks green
4. `npm run stress:internal-clearing` green
5. alerts and dashboard docs present
6. admin routes verified
7. kill-switch drill completed
8. planner determinism and Redis rebuild validation green in `test/integration/internal-clearing-rollout-validation.integration.test.ts`

## Stress Validation Profile

The Phase 2B stress harness is the bounded runtime gate for limited-prod readiness.

Key knobs:
- `INTERNAL_CLEARING_STRESS_ENTITY_COUNT`
- `INTERNAL_CLEARING_STRESS_CYCLE_GROUPS`
- `INTERNAL_CLEARING_STRESS_PARTIAL_GROUPS`
- `INTERNAL_CLEARING_STRESS_ROUTING_GROUPS`
- `INTERNAL_CLEARING_STRESS_CONCURRENCY`
- `INTERNAL_CLEARING_STRESS_BUCKET_WINDOW_LIMIT`
- `INTERNAL_CLEARING_STRESS_MAX_RUNTIME_MS`
- `INTERNAL_CLEARING_STRESS_SEED`

Expected validation profile:
- 500 active residual entities in one bucket
- multiple independent 3-party cycles
- partial-overlap groups
- repeated retries under lock contention
- Redis bucket drift followed by rebuild from Postgres
- residual external routing under load through the current combo execution path

Treat any of these as rollout blockers:
- planner non-determinism on the same bucket snapshot
- duplicate clearing rounds
- duplicate clearing exposure mutation
- negative residuals
- combo state vs residual mismatch
- Redis rebuild mismatch
- runtime exceeding the configured profile budget

## Limited Prod Operating Mode

Use allowlisted markets or counterparties first if operationally possible. Keep `internal_clearing:kill_switch` available as the immediate rollback path. Postgres remains authoritative at all times; Redis is only the live bucket index.

## Post-Enable Validation

After enabling limited-prod:
1. inspect new `clearing_rounds`
2. inspect `exposure_journal`
3. inspect `clearing_residual_routed_total`
4. inspect Redis bucket/entity consistency against Postgres residual truth
5. record any divergence or force-fail intervention ids

## Supabase Schema Verification

Supabase MCP connectivity is not evidence that repo migrations were applied.

Run:

```bash
npm run db:migrate:supabase
npm run db:verify:supabase
```

Then verify:
1. `schema_migrations` contains the latest migration filenames.
2. The Phase 2B clearing admin migration is present:
   - `sql/migrations/2026_03_10_create_internal_clearing_admin_tables.sql`
3. Treat missing ledger rows or missing tables/indexes as an operational stop.

## Post-Incident Checklist

- verify `clearing_rounds`
- verify `clearing_round_participants`
- verify `clearing_round_leg_matches`
- verify `clearing_round_events`
- verify `exposure_journal`
- verify `combo_legs.remaining_size`
- verify Redis bucket and entity keys
- capture correlation ids and admin event ids
- confirm whether manual intervention tasks were created
- confirm no residual entity was left in an invalid terminal state
- escalate per manual intervention workflow
