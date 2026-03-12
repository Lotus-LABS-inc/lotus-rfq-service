# Phase 3B Qualification Runbook

## Scope
- qualification run lifecycle inspection and progression
- economic quality evidence inspection
- promotion gate interpretation
- auto safety action inspection and acknowledgement
- safe demotion and pause procedures
- control-plane override and kill-switch usage during Phase 3B incidents

## Qualification Stages And Statuses
- Stages:
  - `INTERNAL_ONLY`
  - `SHADOW`
  - `CANARY`
  - `LIMITED_PROD`
  - `BROAD_PROD`
- Statuses:
  - `PENDING`
  - `RUNNING`
  - `SUCCEEDED`
  - `FAILED`
  - `CANCELLED`
  - `PAUSED`
- Legal promotion path:
  - `INTERNAL_ONLY -> SHADOW`
  - `SHADOW -> CANARY`
  - `CANARY -> LIMITED_PROD`
  - `LIMITED_PROD -> BROAD_PROD`
- Demotion may only move to a lower stage in the same ordered sequence.

## Create Qualification Run
- Current operator reality:
  - there is no `/admin/qualification` create endpoint yet
  - qualification runs are created through a controlled Postgres-backed service or approved SQL procedure
- Required fields:
  - `strategy_key`
  - `scope_type`
  - `scope_id`
  - `stage`
  - `engine_version`
  - `config_version`
- Canonical service path:
  - `QualificationRunManager.createRun(strategyKey, scopeType, scopeId, stage, engineVersion, configVersion)`
- Persisted table:
  - `strategy_qualification_runs`
- Operational rules:
  - Postgres is authoritative
  - do not create multiple concurrent active runs for the same `strategy_key + scope_type + scope_id`
  - use the exact rollout stage intended for the run start
  - record any operator context in `metadata` through the approved service path when available
- If a direct SQL procedure is used, verify afterward with:
  - `GET /admin/qualification/runs`
  - `GET /admin/qualification/run/:id`

## Inspect Qualification Runs
- List runs:
  - `GET /admin/qualification/runs`
- Filters:
  - `stage`
  - `status`
  - `scopeType`
  - `scopeId`
- Run detail:
  - `GET /admin/qualification/run/:id`
- Decision evaluations:
  - `GET /admin/qualification/run/:id/evaluations`
- Use run detail to inspect:
  - current stage and status
  - engine version and config version
  - evaluation count
  - counts by `decision_type`
  - rolled-up `realized`, `counterfactual`, and `improvement` numeric summaries

## Inspect Economic Quality
- Primary evidence surfaces:
  - `GET /admin/qualification/run/:id`
  - `GET /admin/qualification/run/:id/evaluations`
- Metrics to inspect in `strategy_decision_evaluations` payloads:
  - `realized_metrics`
  - `counterfactual_metrics`
  - `improvement_metrics`
- Common economic fields:
  - `realizedFillPrice`
  - `realizedEffectiveCost`
  - `realizedSlippage`
  - `realizedFees`
  - `timeToFillMs`
  - `partialFillRatio`
  - `priceImprovement`
  - `slippageSaved`
  - `feeSaved`
  - `externalNotionalAvoided`
  - `internalizationGain`
  - `compressionGain`
- Rollup source:
  - materialized view `qualification_metrics_rollup`
  - read model `QualificationMetricsRollup`
- Current operator reality:
  - there is no admin HTTP endpoint for rollups yet
  - inspect rollups through approved SQL access
- Rollup fields to inspect:
  - `internalization_rate`
  - `compression_ratio`
  - `fee_savings`
  - `slippage_savings`
  - `fill_quality_delta`
  - `adverse_selection_indicator`
  - `promotion_readiness_score`
- SQL inspection pattern:
```sql
SELECT
  strategy_key,
  scope_type,
  scope_id,
  stage,
  engine_version,
  config_version,
  market,
  venue_pair,
  evaluation_count,
  internalization_rate,
  compression_ratio,
  fee_savings_total,
  slippage_savings_total,
  fill_quality_delta,
  adverse_selection_indicator
FROM qualification_metrics_rollup
WHERE strategy_key = $1
ORDER BY stage, market, venue_pair;
```
- Fail closed rule:
  - if required market or venue metadata is missing from evaluations, rows are excluded from the rollup rather than backfilled from live state

## Interpret Promotion Gate Failures
- Promotion endpoint:
  - `POST /admin/qualification/run/:id/promote`
- Requirements:
  - admin auth
  - `twoFactorToken`
- Gate families:
  - replay stability
  - reconciliation health
  - planner latency
  - economic quality
  - incident count
  - adverse selection
- Promotion behavior:
  - only the next legal stage may be recommended
  - promotion succeeds only if every gate passes
  - promotion persists a `strategy_promotion_events` row
- Blocked outcomes:
  - `PROMOTION_GATE_BLOCKED`
    - gate evaluation ran successfully and one or more gates failed
  - `INSUFFICIENT_QUALIFICATION_EVIDENCE`
    - the service could not build the full gate input from persisted Postgres evidence
    - do not guess missing evidence from Redis or env defaults
- Metrics:
  - `promotion_gate_fail_total{stage,gate}` increments when promotion is blocked by explicit failed gates
- Operational reading:
  - use the returned `failedGates` payload to see `gate`, `reason`, `observed`, and `threshold`
  - if economics fail, inspect recent `strategy_decision_evaluations` and the rollup view
  - if replay or reconciliation gates fail, inspect the linked Phase 3A runbook and underlying operational incidents before retrying promotion

## Promote, Demote, And Pause Runs
- Promote:
  - `POST /admin/qualification/run/:id/promote`
  - body:
```json
{
  "twoFactorToken": "123456"
}
```
- Demote:
  - `POST /admin/qualification/run/:id/demote`
  - body:
```json
{
  "twoFactorToken": "123456",
  "targetStage": "SHADOW",
  "reason": "operator reason"
}
```
- Pause:
  - `POST /admin/qualification/run/:id/pause`
  - body:
```json
{
  "twoFactorToken": "123456",
  "reason": "optional operator reason"
}
```
- Safe demotion rules:
  - only demote to a lower stage
  - always provide a concrete reason
  - demotion persists a `strategy_promotion_events` row
  - demotion changes qualification state only; it does not automatically change live execution posture
  - if live execution risk is present, pair demotion with control-plane action immediately
- Pause rules:
  - pause sets run status to `PAUSED`
  - pause does not cancel or close the run
  - pause does not automatically pause live execution scope

## Inspect Auto Safety Actions
- List actions:
  - `GET /admin/qualification/safety-actions`
- Load one action:
  - `GET /admin/qualification/safety-action/:id`
- Audit source:
  - `auto_safety_actions`
- Supported trigger families:
  - `replay_diff_spike`
  - `reconciliation_mismatch_spike`
  - `planner_latency_breach_sustained`
  - `negative_economic_quality_sustained`
  - `stale_reservation_growth`
  - `internalization_failure_spike`
- Supported action types:
  - `DEMOTE_STAGE`
  - `DISABLE_PHASE2B`
  - `DISABLE_PHASE2A_AND_2B`
  - `FORCE_SOR_ONLY`
  - `DISABLE_RESOLUTION_POOLING`
  - `PAUSE_SCOPE`
- SQL inspection pattern:
```sql
SELECT
  id,
  strategy_key,
  scope_type,
  scope_id,
  action_type,
  trigger_reason,
  created_at,
  resolved_at,
  metadata
FROM auto_safety_actions
WHERE resolved_at IS NULL
ORDER BY created_at DESC;
```
- Metadata should be inspected for:
  - `configVersion`
  - trigger evidence
  - applied control-plane operation details
  - scope and shard context
  - requested demotion target when `action_type = 'DEMOTE_STAGE'`

## Acknowledge And Resolve Auto Safety Actions
- Resolve endpoint:
  - `POST /admin/qualification/safety-action/:id/resolve`
- Body:
```json
{
  "twoFactorToken": "123456",
  "resolutionReason": "operator acknowledged and reviewed control-plane state"
}
```
- Behavior:
  - sets `resolved_at`
  - does not automatically revert control-plane state
  - keeps the action audit row intact
- Operational procedure:
  1. inspect the unresolved row in `auto_safety_actions` or `GET /admin/qualification/safety-action/:id`
  2. inspect current shard, bucket, and override state through control-plane endpoints
  3. confirm the trigger condition has cleared
  4. revert any live execution override or degradation through the existing control-plane process if appropriate
  5. resolve the action through `POST /admin/qualification/safety-action/:id/resolve`
  6. verify `resolved_at` is set and record the operator reason
  7. verify there was no silent control-plane rollback

## Pause Scope And Override Flow
- Qualification-only pause:
  - `POST /admin/qualification/run/:id/pause`
- Live execution safety controls:
  - `POST /admin/control-plane/bucket/:id/pause`
  - `POST /admin/control-plane/bucket/:id/drain`
  - `POST /admin/control-plane/shard/:id/pause`
  - `POST /admin/control-plane/shard/:id/degrade`
  - `POST /admin/control-plane/override`
- Use qualification pause only when:
  - you need to stop Phase 3B progression
  - live execution may continue under the current approved posture
- Use control-plane actions when:
  - live execution path must be reduced, paused, drained, or forced into a safer mode
  - an auto safety action has changed shard or bucket posture
  - demotion alone is not operationally sufficient

## Kill Switches And Override Flow
- Qualification itself:
  - Postgres-backed
  - no Redis authority dependency
- Existing kill switches to reuse during incidents:
  - `resolution_risk:kill_switch`
  - `internal_cross:kill_switch`
  - `internal_netting:kill_switch`
  - `internal_clearing:kill_switch`
- Existing override and execution control surfaces:
  - `GET /admin/control-plane/shards`
  - `GET /admin/control-plane/buckets`
  - `GET /admin/control-plane/overrides`
  - `POST /admin/control-plane/bucket/:id/pause`
  - `POST /admin/control-plane/bucket/:id/drain`
  - `POST /admin/control-plane/shard/:id/pause`
  - `POST /admin/control-plane/shard/:id/degrade`
  - `POST /admin/control-plane/override`
- Use kill switches when:
  - the subsystem itself must stop authoritative work immediately
- Use overrides and degrade flows when:
  - you need scoped, reversible reduction in live behavior
  - you want auditable execution-mode control without full subsystem suppression

## Phase 3B Alerts And Dashboards
- Alerts:
  - `docs/alerts-phase3b.md`
- Grafana panels:
  - `docs/grafana-phase3b-panels.md`
- Core metrics:
  - `qualification_evaluations_written_total`
  - `shadow_decision_diff_total`
  - `promotion_gate_fail_total`
  - `auto_safety_actions_created_total`
  - `auto_safety_actions_resolved_total`
  - `qualification_rollup_refresh_total`
  - `qualification_rollup_refresh_duration_ms`

## Validation Commands
- Shadow validation:
  - `npx vitest run test/integration/phase3b-shadow-validation.integration.test.ts --maxWorkers=1`
- Canary qualification-flow validation:
  - `npx vitest run test/integration/phase3b-canary-qualification-flow.integration.test.ts --maxWorkers=1`

## Post-Incident Checklist
1. Confirm the affected qualification run id, current `stage`, and current `status`.
2. Inspect `GET /admin/qualification/run/:id` and `GET /admin/qualification/run/:id/evaluations`.
3. Inspect qualification rollup evidence in `qualification_metrics_rollup`.
4. Check whether promotion was blocked and inspect any `strategy_promotion_events`.
5. Inspect unresolved rows in `auto_safety_actions`.
6. Inspect shard, bucket, and override state via `/admin/control-plane/...`.
7. Confirm whether any of these kill switches are active:
   - `resolution_risk:kill_switch`
   - `internal_cross:kill_switch`
   - `internal_netting:kill_switch`
   - `internal_clearing:kill_switch`
8. Decide whether the strategy should remain paused, be demoted, or return to `SHADOW`.
9. If live posture was changed, confirm the paired control-plane rollback or continued degrade decision.
10. Record the incident outcome in run metadata, promotion event metadata, or auto safety resolution metadata through the approved service path.
