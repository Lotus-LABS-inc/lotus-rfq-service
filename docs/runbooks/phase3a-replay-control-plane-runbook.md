# Phase 3A Replay And Control Plane Runbook

## Scope
- replay envelope inspection
- exact replay execution
- diff replay execution
- control-plane state inspection
- safe bucket and shard controls
- degradation interpretation
- kill switches and escalation

## Inspect Replay Envelope
- Endpoint:
  - `GET /admin/replay/envelope/:id`
- Purpose:
  - confirm the replay envelope exists
  - inspect the decision family, entity, correlation, config version, engine version, and creation time
- Returned fields:
  - `id`
  - `decisionType`
  - `entityId`
  - `correlationId`
  - `configVersion`
  - `engineVersion`
  - `createdAt`
- This endpoint is metadata-only.
- If you need the existing control-plane metadata view, `GET /admin/control-plane/replay/:envelopeId` is the same read surface and should return consistent metadata.

## Run Exact Replay
- Endpoint:
  - `POST /admin/replay/envelope/:id/run`
- Requirements:
  - admin auth
  - `twoFactorToken`
- Purpose:
  - replay the stored decision exactly from the persisted snapshot with no live reads except loading the envelope
- Result statuses:
  - `MATCH`
    - replayed output matches the stored output snapshot exactly after deterministic normalization
  - `DIFF`
    - replayed output differs from the stored output snapshot
    - inspect `diffSummary` and `replayOutput`
  - `ERROR`
    - replay could not be executed or compared safely
    - treat this as operationally significant

## Interpret Diff Replay
- Endpoint:
  - `POST /admin/replay/envelope/:id/diff`
- Requirements:
  - admin auth
  - `twoFactorToken`
  - at least one of:
    - `configVersion`
    - `engineVersion`
- Purpose:
  - replay the same envelope against an alternate config or engine version
  - compare the original stored output to the alternate replay output
- Diff categories:
  - changed route choices
    - candidate or allocation path changed
  - changed ranking
    - ranking order changed under a new tie-break or score rule
  - changed clearing selection
    - selected Phase 2B participant group or lock order changed
  - changed penalties or gates
    - penalty value or allow/block decision changed
  - changed equivalence class
    - resolution-risk class changed under new scoring inputs
- Use diff replay for:
  - config tuning
  - engine upgrades
  - shadow evaluation before enforcement changes

## Inspect Control Plane State
- Read surfaces:
  - `GET /admin/control-plane/shards`
  - `GET /admin/control-plane/shard/:id`
  - `GET /admin/control-plane/buckets`
  - `GET /admin/control-plane/bucket/:id`
  - `GET /admin/control-plane/overrides`
  - `GET /admin/control-plane/guardrail-shadow`
  - `GET /admin/control-plane/replay/:envelopeId`
- Use shard state to understand:
  - current execution mode
  - active plan count
  - active bucket count
  - stale reservation count
  - average planner latency
- Use bucket state to understand:
  - bucket mode
  - entity count
  - graph density
  - degradation reason
- Use overrides to understand:
  - operator-imposed execution mode
  - scope precedence
  - override expiry

## Pause And Drain Buckets
- Pause one bucket:
  - `POST /admin/control-plane/bucket/:id/pause`
- Drain one bucket:
  - `POST /admin/control-plane/bucket/:id/drain`
- Pause one shard:
  - `POST /admin/control-plane/shard/:id/pause`
- Degrade one shard:
  - `POST /admin/control-plane/shard/:id/degrade`
- Create scoped override:
  - `POST /admin/control-plane/override`
- Operational use:
  - `pause`
    - stop processing for a bucket or shard immediately
  - `drain`
    - stop new bucket entries while allowing current work to finish
  - `degrade`
    - force a safer execution mode on the shard

## Interpret Degradation Modes
- `FULL_MODE`
  - no degradation
- `DISABLE_PHASE2B`
  - skip Phase 2B clearing planner
- `DISABLE_PHASE2A_AND_2B`
  - skip Phase 2A netting and Phase 2B clearing
- `DISABLE_INTERNAL_CROSS`
  - disable internal crossing
- `SOR_ONLY`
  - preserve only the safer SOR path and reduce advanced planning
- `SAFE_FALLBACK`
  - take the most conservative fallback path

Mode resolution is deterministic:
- active overrides are consulted first
- then guardrail-driven degradation
- then default `FULL_MODE`

Override precedence is:
1. `ENGINE`
2. `BUCKET`
3. `SHARD`
4. `MARKET`

Within the same scope, newest override wins.

## Phase 3A Guardrail Shadow Mode
- Env rollout flags:
  - `PHASE3A_GUARDRAIL_SHADOW_ENABLED`
  - `PHASE3A_GUARDRAIL_SHADOW_PERCENT`
  - `PHASE3A_GUARDRAIL_SHADOW_START_AT`
  - `PHASE3A_GUARDRAIL_SHADOW_END_AT`
- Supported engines:
  - `SOR`
  - `NETTING_PHASE2A`
  - `CLEARING_PHASE2B`
- Inspection endpoint:
  - `GET /admin/control-plane/guardrail-shadow?engine=SOR|NETTING_PHASE2A|CLEARING_PHASE2B&shardId=<id>&stableId=<stable-id>[&bucketId=<id>][&marketId=<id>]`
- Override payload contract:
  - use the existing `POST /admin/control-plane/override`
  - set `overrideType=GUARDRAIL_ENFORCEMENT`
  - payload:
    - `{ "enforcementMode": "SHADOW", "reason": "why" }`
    - `{ "enforcementMode": "ENFORCED", "reason": "why" }`
- Resolution rules:
  - control-plane overrides outrank env rollout
  - precedence remains `ENGINE > BUCKET > SHARD > MARKET`
  - newest override wins within the same scope
  - env rollout only applies when no matching `GUARDRAIL_ENFORCEMENT` override exists
  - unsampled or inactive env rollout resolves to `ENFORCED`
- Operational semantics:
  - shadow is observational only
  - no `planner_shard_state` mutation
  - no `bucket_state` mutation
  - no `control_plane_audit_events` write
  - no engine skipping
  - `persist=false` remains enforced under the existing planning guardrail helper
- Rollout steps:
  1. set `PHASE3A_GUARDRAIL_SHADOW_ENABLED=true`
  2. set `PHASE3A_GUARDRAIL_SHADOW_PERCENT` to a small value such as `0.05`
  3. optionally set `PHASE3A_GUARDRAIL_SHADOW_START_AT` and `PHASE3A_GUARDRAIL_SHADOW_END_AT`
  4. create a `GUARDRAIL_ENFORCEMENT` override only if a scope must be forced to `SHADOW` or `ENFORCED`
  5. inspect the effective mode through `GET /admin/control-plane/guardrail-shadow`
  6. monitor the shadow metrics below during the rollout window
  7. disable by setting `PHASE3A_GUARDRAIL_SHADOW_ENABLED=false` or forcing `ENFORCED` at the required scope
- Metrics to inspect:
  - `phase3a_guardrail_shadow_resolution_total`
  - `phase3a_guardrail_shadow_total`
  - `phase3a_guardrail_shadow_would_degrade_total`
  - `phase3a_guardrail_shadow_divergence_total`
- Divergence thresholds:
  - any sudden non-baseline increase in `phase3a_guardrail_shadow_divergence_total` is a stop-and-inspect condition
  - any unexpected same-engine concentration of `phase3a_guardrail_shadow_would_degrade_total` outside a planned pressure window is a rollback condition
- Validation commands:
  - `npx vitest run test/unit/phase3a-guardrail-shadow.test.ts test/unit/control-plane-admin-service.test.ts tests/admin-control-plane-routes.test.ts test/unit/sor.order-router.test.ts test/unit/multi-leg-internal-netting-engine.test.ts test/unit/clearing-round-planner.test.ts test/integration/phase3a-guardrail-shadow.integration.test.ts --maxWorkers=1`
  - `npx vitest run test/integration/phase3a-rollout-validation.integration.test.ts --maxWorkers=1`
  - `npm run stress:phase3a`

## Kill Switches And Escalation
- Resolution risk recomputation kill switch:
  - `resolution_risk:kill_switch`
- Set:
  - `redis-cli set resolution_risk:kill_switch "true"`
- Clear:
  - `redis-cli del resolution_risk:kill_switch`
- Effect:
  - freezes resolution-risk recomputation only
  - does not disable read-path consumption of persisted assessments

Replay and control-plane escalation flow:
1. inspect replay envelope metadata
2. inspect shard, bucket, and override state
3. run exact replay
4. run diff replay if config or engine drift is suspected
5. if mismatches are operationally unsafe, stop at inspection and apply:
   - bucket pause
   - bucket drain
   - shard pause
   - shard degrade
6. escalate when:
   - exact replay returns `ERROR`
   - diff replay changes critical route, clearing, penalty, or equivalence decisions
   - degradation repeatedly escalates to `SAFE_FALLBACK`

## Run ReconciliationV2
- Default posture:
  - `dryRun=true`
  - `autoFix=false`
- Authoritative truth:
  - Postgres remains authoritative
  - `autoFix` may rebuild Redis or index state only
  - never use reconciliation to mutate authoritative Postgres records
- Singleton behavior:
  - the job uses Redis lock key `phase3a:reconciliation_v2:lock`
  - only one run may execute at a time
  - concurrent attempts fail closed with a lock-conflict error
- Operational use:
  - use `dryRun` first to inspect mismatch domain, code, and severity
  - enable `autoFix` only after confirming the mismatch is Redis/index drift and the repair is approved
  - if lock conflict occurs, inspect whether another run is active before retrying
  - if infrastructure error occurs, stop and restore Redis/Postgres health before rerunning
- Stop conditions:
  - Redis connection closure
  - Redis `SCAN` or `SMEMBERS` failure
  - Postgres query failure
  - lock renewal failure or lost ownership of the singleton lock
- Metrics to inspect:
  - `reconciliation_v2_runs_total`
  - `reconciliation_v2_run_duration_ms`
  - `reconciliation_v2_lock_conflict_total`
  - `reconciliation_v2_infra_error_total`
  - `reconciliation_v2_fixes_total`

## Phase 3A Stress Proof
- Commands:
  - `npm run stress:phase3a`
  - `npx vitest run test/integration/phase3a-rollout-validation.integration.test.ts --maxWorkers=1`
- Balanced default knobs:
  - `PHASE3A_STRESS_SEED=phase3a-stress`
  - `PHASE3A_STRESS_CAPTURE_CONCURRENCY=4`
  - `PHASE3A_STRESS_CAPTURE_SCENARIOS_PER_ENGINE=12`
  - `PHASE3A_STRESS_EXACT_BURST=36`
  - `PHASE3A_STRESS_DIFF_BURST=18`
  - `PHASE3A_STRESS_CONTROL_PLANE_OPS=12`
  - `PHASE3A_STRESS_RECON_BATCH_SIZE=25`
  - `PHASE3A_STRESS_MAX_RUNTIME_MS=420000`
- Acceptance thresholds:
  - stress harness exits `0`
  - rollout-validation suite is green
  - same-version replay `DIFF=0` and `ERROR=0`
  - alternate-version diff replay `ERROR=0`
  - contradictory `execution_mode_changed` audit rows = `0`
  - reconciliation scoped Postgres fingerprint drift = `0`
  - reconciliation lock leak = `0`
  - runtime <= `420000ms`
- Stop conditions:
  - `replay_write_failures_total` increases during proof outside the injected scenario
  - `replay_error_total` increases during proof
  - same-version exact replay returns any `DIFF` or `ERROR`
  - `reconciliation_v2_infra_error_total` increases during proof
  - control-plane audit rows show `previous_mode = new_mode`
  - `phase3a:reconciliation_v2:lock` remains present after proof completion

## When To Stop At Inspection Only
- stop at inspection only when:
  - replay status is `MATCH`
  - control-plane mode is stable and expected
  - no active override drift is present
  - no bucket or shard is overloaded or degraded unexpectedly
  - Phase 3A shadow divergence remains within approved baseline

## When To Use Pause, Drain, Or Degrade
- use `pause` when:
  - you need immediate stop-the-line behavior
- use `drain` when:
  - you need safe wind-down without admitting new bucket work
- use `degrade` when:
  - guardrails or replay evidence show one engine path is unsafe but a safer fallback remains available
