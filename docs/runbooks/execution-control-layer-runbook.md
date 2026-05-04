# Execution Control Layer Runbook

Status: ACTIVE  
Last Updated: 2026-04-25

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
- `GET /admin/execution-venues`
- `GET /admin/execution-venues/:venue`

Mutations:
- `POST /admin/execution-control/reconcile/:recordId`
- `POST /admin/execution-control/mark-failed/:recordId`
- `POST /admin/execution-control/retry-safe/:recordId`

Mutation rules:
- ADMIN auth required
- `twoFactorToken` required
- every mutation writes execution-control audit records

## Execution Venue Readiness Surface

Use the execution venue readiness surface to inspect adapter readiness before any operator considers live venue submission.

Routes:
- `GET /admin/execution-venues`
- `GET /admin/execution-venues/POLYMARKET`
- `GET /admin/execution-venues/LIMITLESS`
- `GET /admin/execution-venues/OPINION`
- `GET /admin/execution-venues/MYRIAD`
- `GET /admin/execution-venues/PREDICT_FUN`

Current scope:
- read-only
- admin-authenticated
- no live order submission
- no credential or secret exposure
- venue entries for `POLYMARKET`, `LIMITLESS`, `OPINION`, `MYRIAD`, and `PREDICT_FUN`
- venue-by-venue hybrid execution model:
  - `POLYMARKET`: `BACKEND_SIGNER` through `PolymarketExecutionAdapterV2`
  - `LIMITLESS`: `BACKEND_SIGNER` scaffold through `LimitlessExecutionAdapter`, live flag default false
  - `OPINION`: `USER_SIGNED_BACKEND_RELAY`; builder mode can relay user-signed orders, but Lotus must not sign Safe/user-wallet actions
  - `PREDICT_FUN`: `USER_SIGNED_BACKEND_RELAY`; OAuth order API can relay signed orders when access is enabled, but Lotus must not sign orders with its own key
  - `MYRIAD`: `USER_SIGNED` until official delegated/backend signing is reviewed

Readiness fields:
- `marketRoutingCoverage`: whether Lotus has matching/routing coverage for the venue family
- `liveSubmissionSupported`: whether a reviewed live execution adapter exists for the venue
- `executionSigningModel`: `BACKEND_SIGNER`, `USER_SIGNED`, `USER_SIGNED_BACKEND_RELAY`, `DELEGATED_BACKEND_SIGNER`, or `NOT_SUPPORTED`
- `adapter`: concrete live execution adapter, or `NOT_IMPLEMENTED`
- `structuralReadiness`: adapter/env readiness from the selected venue adapter config
- `operationalStatus`: operator-facing status derived from adapter readiness plus the latest harness artifact
- `liveExecutionEnabled`: whether the live-execution env flag is enabled
- `featureFlagSelected`: whether `POLYMARKET_EXECUTION_MODE=v2` is selected
- `requiredEnvPresent` / `missingEnv`: live-submit readiness gate
- `dryRunRequiredEnvPresent` / `missingDryRunEnv`: dry-run readiness gate
- `lastHarnessAttempt`: latest `artifacts/execution/polymarket-live-submit-checklist.json` result, if present
- `venueAccountRequired` / `venueAccountConfigured`: whether user production flow has an active Turnkey EVM venue-account binding

Operational statuses:
- `NOT_CONFIGURED`: required V2 config is absent or the adapter is not selected
- `LIVE_DISABLED`: dry-run path may be configured, but live execution is disabled
- `STRUCTURALLY_READY`: required local adapter configuration is present
- `EXTERNALLY_BLOCKED`: local adapter structure is ready, but the latest harness attempt was blocked by venue auth or endpoint state

Current Polymarket interpretation:
- `STRUCTURALLY_READY` means Lotus can build and validate the Polymarket V2 execution envelope
- `EXTERNALLY_BLOCKED` means the remaining blocker is outside Lotus local structure, typically API authorization or endpoint availability
- this status does not authorize live submission by itself
- approved-lane enforcement, execution-scope token validation, preflight, settlement verification, and ghost-fill protection still apply
- user-production readiness also requires a `POLYMARKET` venue-account binding for the user's Turnkey EVM wallet
- the binding stores only public metadata: signer wallet address plus the derived Polymarket deposit-wallet address/id
- the Polymarket operator signer/funder/API-key path must stay separate from user Turnkey venue-account bindings
- when `POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED=true`, `/user/venue-accounts/setup-batch` derives the user's deterministic Polymarket deposit-wallet address from their Turnkey EVM owner address
- when `POLYMARKET_RELAYER_URL` and Polymarket builder API credentials are configured, Lotus submits the relayer `WALLET-CREATE` request without a user signature; the binding becomes `ACTIVE` only after the relayer/deployed check confirms the deposit wallet
- derived-only or submitted-but-unconfirmed deposit wallets remain `PENDING`; retrying account setup checks deployment status but must not submit another `WALLET-CREATE` while the same deposit-wallet address is already recorded
- deposit-wallet audit events may store the public relayer transaction id, relayer state, and transaction hash for operator support; never store builder credentials, request signatures, private keys, or raw auth headers
- if deposit-wallet automation is not configured, `/user/venue-accounts/setup-batch` returns a `PENDING` Polymarket deposit-wallet binding with no user signing step

Non-Polymarket interpretation:
- `marketRoutingCoverage=COVERED_BY_MATCHING` means Lotus can surface venue market coverage for matching/routing review
- `LIMITLESS` may report `liveSubmissionSupported=true` only for the backend-signer adapter scaffold; `LIMITLESS_LIVE_EXECUTION_ENABLED=false` remains the default
- `OPINION` remains a prepare-only/manual Safe-link scaffold until builder-mode account linking and settlement evidence are reviewed
- `PREDICT_FUN` has a guarded user-signed OAuth relay path: Lotus prepares frontend-safe order instructions, the user signs with the linked Turnkey EVM wallet, and backend relay submit remains disabled unless `PREDICT_FUN_LIVE_EXECUTION_ENABLED=true`
- Predict.fun signed relay validates the signer, linked Predict account, token/outcome, side, expiry, and prepared payload before calling `/v1/oauth/orders/create`
- Predict.fun settlement remains unverified until venue status/fill evidence is reviewed; do not treat an accepted relay response as final settlement
- `MYRIAD` remains `USER_SIGNED`; Lotus may prepare frontend-safe signing instructions later, but backend live submission must fail closed
- `operationalStatus=NOT_CONFIGURED` is expected until a venue-specific execution adapter, smoke harness, settlement proof, and operator signoff are implemented
- do not treat funding readiness or market coverage as live execution readiness

Limitless backend-signer boundary:
- `LIMITLESS_EXECUTION_MODE=backend_signer` selects the adapter scaffold
- `LIMITLESS_LIVE_EXECUTION_ENABLED=true` is required before submit attempts
- `LIMITLESS_BASE_URL`, `LIMITLESS_API_KEY`, and `LIMITLESS_EXECUTION_PRIVATE_KEY` are server-only live-submit inputs
- `npm run execution:limitless-live-submit-harness` writes a redacted operator checklist artifact and remains blocked unless `LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED=true`, the operator confirmation string, and tiny order envs are configured
- `/admin/execution-venues/LIMITLESS` reads `artifacts/execution/limitless-live-submit-checklist.json` when present so operators can see the latest harness mode, blockers, warnings, and submit result without secrets
- current Limitless settlement evidence is intentionally not auto-verified by the adapter; production enablement still needs a reviewed fill/status/settlement reader and live-submit harness

Production execution-venues smoke:
- run `npm run admin:execution-venues-smoke` with `ADMIN_EXECUTION_VENUES_SMOKE_BASE_URL` and `ADMIN_EXECUTION_VENUES_SMOKE_JWT`
- the smoke checks `/admin/execution-venues`, `/admin/execution-venues/POLYMARKET`, `/admin/execution-venues/PREDICT_FUN`, and `/admin/execution-venues/LIMITLESS`
- artifacts are written under `artifacts/execution/` and store only summarized status, response timing, blockers, and secret-scan findings

Polymarket V2 dry-run boundary:
- the `clobV2DryRun` metadata and dry-run signing fixture are Lotus-internal validation artifacts
- they prove local payload/scope hashing, builder-code presence, and secret redaction
- they are not Polymarket's raw V2 `/order` request body
- live submission must use the `@polymarket/clob-client-v2` SDK path with `tokenID`, `price`, `size`, `side`, and `builderCode`
- do not use the dry-run envelope as an external API contract

Security rules:
- API keys, passphrases, private keys, and secrets must remain server-side only
- readiness responses must never include credential values
- harness artifacts may include status/error codes, but not secrets
- do not paste `.env` values into tickets, logs, or operator notes

Operator rule:
- treat `/admin/execution-venues` as an inspection surface only
- do not enable live submission until the harness checklist, adapter tests, settlement/finality behavior, and operator signoff are complete

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
