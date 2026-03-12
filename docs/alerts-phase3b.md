# Phase 3B Alerts

## Scope
- qualification evidence write health
- shadow divergence monitoring
- promotion gate failures
- auto safety action creation and resolution
- qualification rollup refresh health
- shadow and canary stop conditions

## Qualification Evidence Writes
- Metric:
  - `qualification_evaluations_written_total{decision_type,strategy_key,mode}`
- Warning:
  - expected qualification writes drop to zero for an enabled strategy during an active shadow or canary window for 15 minutes
- Critical:
  - qualification writes drop to zero for 30 minutes while the target strategy still has active Phase 3B runs
- Operator action:
  - confirm the run is active in `strategy_qualification_runs`
  - inspect `GET /admin/qualification/run/:id/evaluations`
  - inspect runtime qualification hook logs for best-effort skips or strict failures

## Shadow Divergence
- Metric:
  - `shadow_decision_diff_total{decision_type,reason}`
- Warning:
  - sustained divergence increase above the approved baseline for a specific decision family for 10 minutes
- Critical:
  - unexplained divergence spike during planned shadow validation or canary promotion validation
- Stop condition:
  - pause promotion work if divergence rises unexpectedly in any of:
    - `SOR_CONFIG_CHANGE`
    - `RFQ_GROUPING_CHANGE`
    - `RESOLUTION_RISK_THRESHOLD_CHANGE`
    - `PHASE1_INTERNAL_CROSS_CHANGE`
    - `PHASE2A_NETTING_SCOPE_CHANGE`
    - `PHASE2B_CLEARING_STRATEGY_CHANGE`

## Promotion Gate Failures
- Metric:
  - `promotion_gate_fail_total{stage,gate}`
- Warning:
  - blocked promotions rise above the expected operator activity baseline in 1 hour
- Critical:
  - repeated failures on the same strategy and stage after evidence refresh or remediation
- Operator action:
  - inspect the blocked response payload from `POST /admin/qualification/run/:id/promote`
  - inspect `strategy_promotion_events`
  - inspect run detail and rollup evidence

## Auto Safety Actions
- Metrics:
  - `auto_safety_actions_created_total{action_type,trigger_reason,scope_type}`
  - `auto_safety_actions_resolved_total{action_type,scope_type}`
- Warning:
  - new auto safety actions are created unexpectedly outside an acknowledged incident window
- Critical:
  - repeated creation of the same action type on the same strategy and scope without operator resolution
- Unresolved action source:
  - unresolved actions are still inspected from `auto_safety_actions` directly
  - use SQL or the safety-action admin endpoints to confirm whether an action remains unresolved
- Stop condition:
  - do not progress canary qualification if the target strategy or scope has unresolved auto safety actions

## Rollup Refresh Health
- Metrics:
  - `qualification_rollup_refresh_total{status}`
  - `qualification_rollup_refresh_duration_ms`
- Warning:
  - no successful rollup refresh in the expected operational window
- Critical:
  - refresh errors continue for 3 consecutive attempts
- Operator action:
  - run a controlled rollup refresh
  - inspect the materialized view `qualification_metrics_rollup`
  - confirm the latest qualification evidence includes `market` and `venuePair`

## Validation Stop Conditions
- Shadow validation must stop if:
  - `shadow_decision_diff_total` spikes without a planned config/version explanation
  - qualification writes for the target strategy stop unexpectedly
  - any unresolved auto safety action exists on the target strategy or scope
- Canary qualification validation must stop if:
  - promotion gate failures appear on the intended happy path
  - auto safety actions are created on the target strategy without explicit operator acknowledgement
  - rollup refreshes fail or become stale during the validation window
