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
