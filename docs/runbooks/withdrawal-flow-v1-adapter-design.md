# Lotus Withdrawal Flow v1 Adapter Design

Status: DESIGN SPEC
Audience: backend, security, operator, venue-integration owners
Last updated: 2026-04-26

## 1. Purpose

Withdrawal v1 introduces venue-specific withdrawal adapters while preserving the current Lotus withdrawal model:

```text
Model A: non-custodial withdrawal preparation and tracking.
```

Withdrawal v0 is DB-backed and non-custodial. Users can create withdrawal intents, quote/preview withdrawals, submit user-broadcast transaction hashes, and read status. Completion reconciliation exists and is evidence-gated.

Withdrawal v1 is the design boundary for adding venue-specific withdrawal adapters. It is not permission to enable live withdrawal execution. Each venue adapter must pass its own documentation review, auth review, smoke test, redaction review, completion evidence review, and operator approval before any live behavior is enabled.

## 2. Non-Custodial Boundary

Lotus must preserve the non-custodial boundary unless a future model is explicitly approved through a separate security and product review.

Hard rules:

- Lotus does not custody user funds.
- Lotus does not sign for users unless a future explicitly approved model exists.
- Lotus does not broadcast live venue withdrawals in v0.
- Withdrawal v1 adapters must preserve user-signed or user-authorized withdrawal semantics.
- A live withdrawal adapter must not imply custody, pooled funds, internal user allocation, treasury withdrawal, or backend-controlled wallet authority.
- Backend-assisted withdrawal flows are out of scope until separately reviewed and explicitly approved.

## 3. Withdrawal Adapter Interface

The proposed adapter contract is intentionally narrow. It separates capability discovery, user action preparation, submitted-reference tracking, status reads, evidence normalization, and error normalization.

```ts
interface WithdrawalVenueAdapter {
  getWithdrawalCapabilities(venue: FundingVenue): Promise<WithdrawalVenueCapability>;

  prepareWithdrawalQuote(input: WithdrawalQuoteIntent): Promise<WithdrawalPreparedQuote>;

  prepareUserAction(input: WithdrawalPreparedQuote): Promise<WithdrawalUserAction>;

  submitUserBroadcastReference(input: {
    withdrawalIntentId: string;
    routeLegId: string;
    sourceVenue: FundingVenue;
    txHash: string;
  }): Promise<WithdrawalSubmittedReference>;

  fetchWithdrawalStatus(input: {
    withdrawalIntentId?: string;
    routeLegId?: string;
    txHash?: string;
  }): Promise<RawWithdrawalStatus>;

  normalizeWithdrawalEvidence(rawEvidence: unknown): NormalizedWithdrawalEvidence;

  validateCompletionEvidence(input: {
    evidence: NormalizedWithdrawalEvidence;
    expectedScope: WithdrawalExpectedScope;
  }): WithdrawalEvidenceValidation;

  normalizeWithdrawalError(error: unknown): WithdrawalAdapterError;
}
```

Method intent:

- `getWithdrawalCapabilities(venue)` returns the venue's supported withdrawal behavior and readiness state.
- `prepareWithdrawalQuote(intent)` creates a quote/preview from Lotus withdrawal state without moving funds.
- `prepareUserAction(intent)` returns frontend-safe user authorization or signing instructions.
- `submitUserBroadcastReference(txHash)` records a user-broadcast reference; it must not broadcast from the backend.
- `fetchWithdrawalStatus(withdrawalId or txHash)` reads status only.
- `normalizeWithdrawalEvidence(rawEvidence)` converts provider or venue status into the Lotus evidence contract.
- `validateCompletionEvidence(evidence, expectedScope)` enforces exact scope and fail-closed completion rules.
- `normalizeWithdrawalError(error)` returns redacted, user-safe and operator-safe errors.

## 4. Venue Capability Fields

Each venue must publish a withdrawal capability record before any adapter can be considered.

Required fields:

| Field | Meaning |
|---|---|
| `venue` | Lotus venue identifier such as `POLYMARKET`, `LIMITLESS`, `OPINION`, `MYRIAD`, or `PREDICT_FUN`. |
| `supportsWithdrawal` | Whether Lotus should expose withdrawal flow for this venue. |
| `supportsApiInitiatedWithdrawal` | Whether the venue has an API-supported user-authorized withdrawal path. |
| `supportsUserBroadcastReference` | Whether Lotus can track a user-broadcast transaction or external reference. |
| `supportedDestinationChains` | Destination chains the venue can withdraw to. |
| `supportedDestinationTokens` | Tokens the venue can withdraw. |
| `requiresUserSignature` | Whether a user wallet signature or explicit user authorization is required. |
| `requiresVenueAuth` | Whether server-side venue credentials are required for quote/status/read operations. |
| `supportsPartialWithdrawal` | Whether the venue can withdraw less than total available balance. |
| `supportsCancellation` | Whether an in-flight withdrawal can be cancelled. |
| `completionEvidenceFields` | Fields needed to prove venue release and destination receipt. |
| `rateLimitNotes` | Rate limits, retry policy, backoff, and operator caution notes. |
| `readinessStatus` | `NOT_CONFIGURED`, `DOCS_REQUIRED`, `SANDBOX_READY`, `LIVE_READ_READY`, or `BLOCKED`. |
| `notes` | Venue-specific constraints, unknowns, and manual review notes. |

Capability config is not executable authority. It only describes what might be possible after tests and gates pass.

## 5. Completion Evidence Contract

Live withdrawal completion must be persisted only from normalized, sanitized evidence.

Normalized fields:

| Field | Requirement |
|---|---|
| `completed` | Required for completion persistence. Must be `true`. |
| `venue` | Venue that produced or was checked for evidence. |
| `userId` or `venueUserRef` | Required when available from the venue; must match expected scope if present. |
| `withdrawalIntentId` | Must match expected scope if returned. |
| `routeLegId` | Must match expected scope if returned. |
| `sourceVenue` | Must match the withdrawal leg source venue. |
| `destinationAddress` | Must match the requested destination address. |
| `destinationChain` | Must match the requested destination chain. |
| `destinationToken` | Must match the requested destination token. |
| `amount` | Must be greater than or equal to the withdrawal leg amount after token decimal normalization. |
| `txHash` | Must match the submitted user-broadcast reference when available. |
| `completedAt` | Completion timestamp from venue or destination evidence. |
| `rawEvidenceRedacted` | Redacted summary only; never raw provider internals. |
| `confidence` | `EXACT`, `PARTIAL`, `AMBIGUOUS`, or `FAILED`. |
| `rejectionReason` | Machine-readable reason when evidence fails closed. |

Evidence rules:

- `completed=true` is required for completion persistence.
- Evidence must match expected venue, user, withdrawal, route-leg, destination, token, chain, amount, and tx hash scope when those fields are present.
- Missing critical fields must fail closed or require manual review.
- Venue release alone is not completion.
- Destination receipt alone is not completion unless venue release is also proven.
- A user tx hash alone is not completion.
- Raw provider payloads, auth headers, API keys, private keys, wallet secrets, and venue internals must be redacted.

## 6. Per-Venue Checklist

### POLYMARKET

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Believed live withdrawal path: Polymarket's official docs point to the Bridge API, not the CLOB trading API. The safe first adapter is a prepare/read/status adapter that checks supported assets, gets a bridge quote, creates withdrawal/deposit addresses, instructs the user to send funds from their Polymarket wallet, records the user-broadcast reference, and tracks bridge status.
- Required docs/API validation: official Bridge API docs for supported assets, quote, withdrawal address creation, and transaction status; auth requirements for Bridge calls; supported destination chains/tokens; rate limits; and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, malformed/unavailable fail-closed tests, status/evidence tests, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no operator-approved Bridge API config, no reviewed user-send semantics for generated withdrawal addresses, no sandbox Bridge rehearsal, no reviewed mapping from Bridge status to Lotus completion evidence.

#### Polymarket Bridge API Finding

Official Polymarket docs indicate that withdrawal/deposit movement is handled through the Bridge API, while CLOB authentication/trading docs are separate. Therefore the first concrete Polymarket withdrawal adapter should be named and scoped as a bridge adapter, not a CLOB trading adapter.

Expected safe v1 flow:

```text
Lotus checks Bridge supported assets
-> Lotus requests a bridge withdrawal quote
-> Lotus creates/receives withdrawal or deposit address instructions
-> user sends funds from the Polymarket wallet to the generated address
-> Lotus records the user-broadcast reference or address
-> Lotus reads Bridge transaction status
-> Lotus normalizes completion evidence
-> Lotus persists completion only if evidence is exact and gate-approved
```

This flow still does not authorize backend signing, backend broadcasting, custody, or live venue mutation. The user action remains external/user-authorized. The adapter may prepare instructions and read status; it must not claim that a Bridge quote or generated address means completion.

Official docs reviewed:

- `https://docs.polymarket.com/api-reference`
- `https://docs.polymarket.com/trading/bridge/withdraw`
- `https://docs.polymarket.com/api-reference/bridge/create-withdrawal-addresses`
- `https://docs.polymarket.com/api-reference/bridge/get-a-quote`
- `https://docs.polymarket.com/api-reference/bridge/get-transaction-status`
- `https://docs.polymarket.com/api-reference/authentication`

#### Proposed `PolymarketBridgeWithdrawalAdapter`

The first concrete Polymarket adapter should implement a narrow prepare/read/status contract:

```ts
interface PolymarketBridgeWithdrawalAdapter {
  getWithdrawalCapabilities(): Promise<WithdrawalVenueCapability>;

  getSupportedBridgeAssets(): Promise<PolymarketBridgeSupportedAssets>;

  prepareWithdrawalQuote(input: {
    withdrawalIntentId: string;
    routeLegId: string;
    userId: string;
    sourceVenue: "POLYMARKET";
    destinationAddress: string;
    destinationChain: string;
    destinationToken: string;
    amount: string;
  }): Promise<PolymarketBridgeWithdrawalQuote>;

  prepareUserAction(input: {
    quoteId: string;
    withdrawalIntentId: string;
    routeLegId: string;
  }): Promise<PolymarketBridgeUserAction>;

  submitUserBroadcastReference(input: {
    withdrawalIntentId: string;
    routeLegId: string;
    txHash?: string;
    bridgeAddress?: string;
  }): Promise<WithdrawalSubmittedReference>;

  fetchWithdrawalStatus(input: {
    txHash?: string;
    bridgeAddress?: string;
  }): Promise<PolymarketBridgeRawStatus>;

  normalizeWithdrawalEvidence(rawEvidence: unknown): NormalizedWithdrawalEvidence;

  validateCompletionEvidence(input: {
    evidence: NormalizedWithdrawalEvidence;
    expectedScope: WithdrawalExpectedScope;
  }): WithdrawalEvidenceValidation;

  normalizeWithdrawalError(error: unknown): WithdrawalAdapterError;
}
```

Adapter constraints:

- `prepareWithdrawalQuote` must validate chain, token, amount, and destination against Lotus withdrawal capability before calling or trusting a Bridge quote.
- `prepareUserAction` may return only frontend-safe instructions: destination address, chain, token, amount, expiration, fee summary, and user-facing warnings.
- `submitUserBroadcastReference` records the user's reference only; it must not broadcast.
- `fetchWithdrawalStatus` must be read-only.
- `normalizeWithdrawalEvidence` must redact raw Bridge payloads.
- `validateCompletionEvidence` must require `completed=true`, exact destination, exact token, exact chain, sufficient amount, and matching submitted reference when available.
- Any ambiguous, stale, malformed, missing, or mismatched Bridge status must map to not completed.

#### Polymarket Bridge Dry-Run Command

Before wiring the Polymarket Bridge adapter into user withdrawal endpoints, operators must run the dry-run command:

```bash
npm run funding:polymarket-bridge-withdrawal-dry-run
```

Default behavior uses mocked Bridge responses. Real HTTP dry-run reads require explicit operator config:

```text
POLYMARKET_BRIDGE_WITHDRAWALS_ENABLED=true
POLYMARKET_BRIDGE_API_BASE_URL=<operator-approved Bridge base URL>
POLYMARKET_BRIDGE_AUTH_MODE=NONE|BEARER
POLYMARKET_BRIDGE_API_KEY=<server-side only, if BEARER>
POLYMARKET_BRIDGE_TIMEOUT_MS=5000
POLYMARKET_BRIDGE_DRY_RUN_ONLY=true
```

The command writes:

```text
artifacts/funding/polymarket-bridge-withdrawal-dry-run.json
artifacts/funding/polymarket-bridge-withdrawal-dry-run.md
```

Expected successful artifact fields:

- `status=COMPLETED`
- `supportedAssetsChecked=true`
- `quotePrepared=true`
- `userActionPrepared=true`
- `statusFetched=true`
- `evidenceNormalized=true`
- `redactionVerified=true`
- `safety.backendSignedTransaction=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.liveVenueWithdrawalExecutionEnabled=false`
- `safety.completionPersisted=false`

Real HTTP dry-run interpretation:

- A `COMPLETED` dry-run artifact proves Bridge prepare/read/status compatibility only.
- It confirms Lotus can parse supported assets, prepare a quote, create user-action instructions, read status, normalize evidence, and preserve redaction.
- It does not prove withdrawal completion because no real user transfer is sent during the dry-run.
- Completion evidence is expected to remain `completed=false` unless a separate controlled transfer rehearsal is explicitly approved and performed.
- User endpoint wiring must stay disabled until an operator reviews the dry-run artifact and approves sandbox-only adapter wiring.

This dry-run does not update withdrawal records, does not persist completion, does not change OpenAPI, and does not make the existing user withdrawal APIs call Polymarket Bridge.

Next adapter phase decision:

- The next safe implementation phase is disabled-by-default sandbox wiring behind existing withdrawal quote/status paths.
- `POST /funding/withdrawals/:id/quote` may prepare a Polymarket Bridge quote/user-action payload only when `POLYMARKET_BRIDGE_WITHDRAWALS_ENABLED=true`, `POLYMARKET_BRIDGE_DRY_RUN_ONLY=true`, and the withdrawal source is exactly `POLYMARKET`.
- `GET /funding/withdrawals/:id/status` may read Bridge status only for the recorded bridge address or user-broadcast reference.
- Sandbox wiring must not submit funds, sign, broadcast, persist completion, or enable live venue withdrawal execution.
- The default withdrawal v0 quote/status behavior remains unchanged when the Bridge flags are off or the adapter is not configured.
- Sandbox quote responses may include `routePreview.polymarketBridge` and sanitized `routeLeg.providerStatus` metadata for UI/operator review.
- `routePreview.polymarketBridge` is frontend-safe instruction metadata only: quote/action summary, destination, estimated fees, expiry, warnings, and `completionPersisted=false`.
- Bridge sandbox status can update sanitized provider status, but it must not create withdrawal reconciliation records or set `WITHDRAWAL_LEG_COMPLETED`.
- Any Bridge status that appears completed during sandbox wiring is compatibility evidence only; completion persistence still requires the separate evidence-gated completion path.
- The controlled user-transfer rehearsal starts with `npm run funding:polymarket-bridge-user-transfer-rehearsal:start`.
- The start command prepares a Bridge user-action artifact with `status=ACTION_REQUIRED`; it does not send funds, sign, broadcast, persist completion, or enable live withdrawal execution.
- Operators must manually send from the Polymarket wallet only after verifying the Bridge address, destination wallet, token, amount, and expiry in the artifact.
- The existing `LOTUS_WITHDRAWAL_V0` fallback remains the default until the sandbox wiring is explicitly enabled.

### LIMITLESS

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Believed live withdrawal path: unknown until Limitless withdrawal docs, auth model, and status/evidence fields are reviewed.
- Required docs/API validation: official withdrawal docs, destination support, supported tokens/chains, status endpoint, cancellation behavior, rate limits, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, insufficient/ambiguous evidence tests, status/evidence tests, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no operator-approved withdrawal API contract, no validated user authorization semantics, no sandbox adapter rehearsal.

### OPINION

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Believed live withdrawal path: unknown until Opinion withdrawal docs and auth model are reviewed.
- Required docs/API validation: official withdrawal docs, destination support, token support, user authorization requirements, status API, rate limits, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, exact-scope evidence tests, malformed response tests, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no reviewed live withdrawal path, no operator-approved auth model, no sandbox withdrawal rehearsal.

### MYRIAD

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Believed live withdrawal path: unknown until Myriad withdrawal docs and API auth are reviewed.
- Required docs/API validation: official withdrawal docs, destination support, token support, status/finality fields, rate limits, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, fail-closed status tests, exact destination evidence tests, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no reviewed live withdrawal path, no sandbox/test evidence for user-authorized withdrawals, no operator signoff.

### PREDICT_FUN

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Believed live withdrawal path: unknown until Predict.fun withdrawal docs and API auth are reviewed. Predict.fun must not be confused with PredictIt or any other Predict-branded venue.
- Required docs/API validation: official withdrawal docs, supported destination chains/tokens, auth model, user authorization requirements, status API, rate limits, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, venue-name safety tests, exact-scope evidence tests, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no reviewed live withdrawal path, no sandbox/test mode confirmation, no operator-approved venue identity mapping.

## 7. Safety Gates Before Live Withdrawal Execution

Before any live withdrawal execution is enabled for any venue:

- OpenAPI docs must be updated if API shape or behavior changes.
- Per-venue adapter unit and integration tests must pass.
- A controlled live-read smoke test must pass against an operator-approved service.
- No API response, log, artifact, or audit event may expose secrets or raw provider internals.
- Operator-approved config must be present and reviewed.
- Admin/operator visibility must show intent, source venues, route legs, destination, status, evidence status, completion gate state, failures/retries, redacted evidence, and audit events.
- Completion must remain evidence-gated.
- Backend signing must remain disabled unless separately approved.
- Backend broadcasting must remain disabled unless separately approved.
- Live withdrawal feature flags must default off.
- Live execution must be venue-scoped; do not enable all venues at once.

## 8. Admin/Operator Surface Requirements

Operators need read-only visibility before any live adapter is enabled:

- withdrawal intent id and user id
- source venues and source allocation
- route legs and submitted references
- destination address, chain, token, and amount
- aggregate withdrawal status and per-leg status
- evidence status and confidence
- completion gate state
- failure, retry, and rejection reasons
- redacted raw evidence summary
- audit event ids and timestamps
- adapter mode, configured host, auth mode, and redaction status without secrets

Admin reads must not call live mutation endpoints and must not persist completion.

## 9. Implementation Phases

Phase 1: live-read status adapter only

- Add venue-specific read/status clients.
- Keep all mutation disabled.
- Confirm normalization, redaction, fail-closed behavior, and admin visibility.

Phase 2: user-broadcast reference tracking

- Track references produced by user-controlled venue or wallet actions.
- Do not broadcast from the backend.
- Persist completion only through evidence-gated reconciliation.

Phase 3: venue-supported user-authorized withdrawal action

- Prepare user-authorized withdrawal action only if venue docs prove the user remains the authorizing party.
- Keep feature flags default off.
- Require per-venue security review and operator signoff.

Phase 4: optional backend-assisted flow

- Out of scope until a separate custody, signing, auth, compliance, and incident-response review approves it.
- Must not be implemented as an extension of v1 without a new design review.

## 10. Out of Scope

- Lotus custody or pooled user funds
- Smart contracts
- Internal treasury withdrawals
- Auto-rebalancing
- Instant settlement LP
- Full position abstraction
- Backend signing
- Backend broadcasting
- Live venue withdrawal execution without venue-specific approval
