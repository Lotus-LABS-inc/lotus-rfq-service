# Execution Control Layer Runbook

Status: ACTIVE  
Last Updated: 2026-03-27

## Purpose
The execution control layer is the hard boundary between decisioning and executable action.

Decision producers may:
- build routes
- score candidates
- emit compatibility lineage
- recommend execution

Decision producers may not:
- submit venue actions
- trigger signing
- advance final execution through direct adapter calls

Only `ExecutionControlGateway` may cross that boundary.

## Control Flow
`ExecutionControlGateway` owns:
- policy validation
- route and quote freshness validation
- approval binding checks
- idempotency allocation and reuse checks
- replay protection checks
- authoritative `ExecutionIntent` creation
- authoritative `ExecutionRecord` creation and transition history
- submission handoff through `ExecutionSubmissionOrchestrator`
- fail-safe routing into `BLOCKED`, `FAILED`, `SYNC_PENDING`, or `RECONCILING`
- execution-control audit logging

## Approval Boundary
Approval is bound to execution context, not just user identity.

Binding inputs:
- route plan id
- canonical executable market id
- user / wallet reference
- venue targets
- requested size / notional
- config version
- engine version
- submission kind

Current rollout:
- external non-custodial approval binding is implemented in the control layer
- live RFQ accept currently resolves as `NOT_REQUIRED` because venue signing is not yet wired from this path
- internal cross and internal clearing remain `NOT_REQUIRED`

Operator rule:
- stale or mismatched approvals must never be reused

## Idempotency And Replay Protection
The layer persists:
- `execution_idempotency_keys`
- `execution_replay_protection_records`
- `execution_submission_lineage`
- `execution_control_decisions`
- `execution_control_audit_records`

Rules:
- same request context may reuse the same idempotency key
- changed route, wallet, or venue target invalidates reuse
- uncertain downstream state must not trigger blind retry
- duplicate-risk cases move to `RECONCILING`

## Outcome Handling
Use these operator meanings:
- `BLOCKED`: policy, freshness, approval, or replay gate failed before submission
- `AWAITING_APPROVAL`: executable path is valid but approval is not yet bound/fresh
- `SUBMITTED`: downstream execution was handed off successfully
- `SYNC_PENDING`: downstream state may have changed but local certainty is incomplete
- `RECONCILING`: duplicate risk or ambiguous external state requires operator reconciliation
- `FAILED`: safe, certain failure

## Admin Routes
Read:
- `GET /admin/execution-control/intents`
- `GET /admin/execution-control/intent/:id`
- `GET /admin/execution-control/records`
- `GET /admin/execution-control/record/:id`
- `GET /admin/execution-control/idempotency/:key`

Mutations:
- `POST /admin/execution-control/reconcile/:recordId`
- `POST /admin/execution-control/mark-failed/:recordId`
- `POST /admin/execution-control/retry-safe/:recordId`

Mutation rules:
- ADMIN auth required
- `twoFactorToken` required
- every mutation writes execution-control audit records

## Operator Actions
Use `reconcile` when:
- venue response was uncertain
- sync is incomplete
- duplicate submission risk exists

Use `mark-failed` when:
- the failure is certain
- downstream state is known
- retry is not safe

Use `retry-safe` only when:
- the same idempotency lineage is valid
- replay-protection state is clear
- the prior attempt did not leave uncertain downstream state

## Current Live Cutover
Live RFQ accept now flows through execution control for:
- internal cross finalization
- SOR plan execution handoff
- legacy RFQ execution handoff

The combo/internalization family still needs the same boundary applied when those paths are promoted through live server wiring.
