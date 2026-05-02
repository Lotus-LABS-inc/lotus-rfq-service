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
| `withdrawalMode` | One of `USER_SIGNED`, `AUTO_RESOLUTION_ONLY`, `PARTNER_MANAGED_BACKEND`, or `UNSUPPORTED`. |
| `userSignedWithdrawalSupported` | Whether Lotus can model the venue as a user-signed or user-authorized withdrawal action. |
| `partnerManagedWithdrawal` | Disabled partner/backend withdrawal metadata when a venue has a server-initiated path that is not a user action. |
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
- Withdrawal mode: `AUTO_RESOLUTION_ONLY` for EOA/user-wallet accounts. Normal user-signed withdrawal is not supported today.
- User-signed withdrawal supported: `false`.
- Partner-managed withdrawal mode: `PARTNER_MANAGED_BACKEND`, disabled by default, HMAC-authenticated, withdrawal-scope gated, and blocked pending explicit custody/security/operator approval.
- Believed live withdrawal path: official Limitless docs describe managed server-wallet withdrawals through `POST /portfolio/withdraw`, with status/history evidence available separately. This is materially different from Polymarket Bridge; Lotus must not generate a manual Bridge address for Limitless unless Limitless later documents that flow.
- Required docs/API validation: official `POST /portfolio/withdraw` docs, portfolio history/status docs, scoped `withdrawal` auth, destination support, supported tokens/chains, cancellation behavior, rate limits, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, insufficient/ambiguous evidence tests, status/evidence tests, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no reviewed live user-authorization semantics for server-wallet withdrawals, no operator-approved production auth model, no sandbox adapter rehearsal that proves read/status compatibility, no explicit approval to call the live withdraw endpoint.

#### Limitless Withdrawal API Finding

Official Limitless docs and team confirmation indicate that withdrawal execution is exposed as a server-wallet API operation, not a Bridge address/user-transfer workflow. Therefore the first Limitless adapter must be scoped as dry-run/read-status only.

In EOA/user-controlled wallet mode, users sign trading orders, but there is no public API where a user signs or broadcasts an explicit withdrawal. Resolved-market payouts happen automatically on-chain through Limitless native resolution mechanics. Lotus should classify this user mode as `AUTO_RESOLUTION_ONLY`, not `USER_SIGNED`.

Limitless account creation and managed wallet/sub-account semantics are a precondition for any withdrawal adapter work. Lotus must not treat a Limitless server wallet as Lotus custody. The acceptable Model A interpretation is:

- the user controls the EOA used to authorize or create the Limitless account/sub-account
- Limitless controls the venue-managed account mechanics
- Lotus stores only user id, venue refs, profile/account ids, route-leg refs, submitted refs, and sanitized evidence
- Lotus never stores the user's EOA private key
- Lotus never signs as the user
- Lotus never calls live withdrawal execution until the exact user-authorization model is reviewed

Expected safe v1 flow:

```text
Lotus prepares a review-only withdrawal quote
-> Lotus prepares non-executable operator/user instructions
-> Lotus optionally reads portfolio history/status
-> Lotus normalizes status/evidence
-> Lotus persists completion only if evidence is exact and gate-approved
```

This flow does not authorize `POST /portfolio/withdraw`. Calling the live withdrawal endpoint is a separate future phase requiring security review, scoped credentials, operator signoff, redaction review, and explicit feature flags.

Official docs reviewed:

- `https://docs.limitless.exchange/api-reference/portfolio/withdraw`
- `https://docs.limitless.exchange/api-reference/portfolio/history`

#### Limitless Adapter Boundary Decision

Classification: user mode `AUTO_RESOLUTION_ONLY`; partner mode `PARTNER_MANAGED_BACKEND` disabled.

`POST /portfolio/withdraw` is not a Lotus-safe user action-preparation endpoint. The official docs describe it as a server-wallet withdrawal that transfers ERC20 funds from a managed sub-account to the partner address using scoped server authentication. The endpoint requires withdrawal-capable HMAC/API-token credentials and does not document a per-withdrawal user EOA signature or user-broadcast transaction.

`POST /portfolio/redeem` is also backend-initiated for redeeming winning positions after resolution. It must not be treated as a user-signed withdrawal endpoint.

Lotus must not expose this endpoint as frontend-safe instructions or wire it into user withdrawal quote/status flows as if it were `USER_AUTHORIZED_ACTION`. Calling it from Lotus would mean Lotus is initiating a venue-side withdrawal under partner/server credentials.

Allowed next work is limited to read-only portfolio history/status evidence mapping and an SDK upgrade review for `@limitless-exchange/sdk >= 1.0.6`. Completion persistence must not use this path until real evidence fields are validated and a separate security/custody review explicitly approves the server-initiated withdrawal model or Limitless provides a documented user-authorized withdrawal flow.

#### Limitless Partner-Managed Approval Gate

Partner-managed Limitless withdrawal is not approved by capability config, HMAC read credentials, or a successful dry-run. It requires a separate operator/internal approval gate:

```bash
npm run funding:limitless-partner-managed-withdrawal-gate
```

The gate is blocked by default. It only passes in operator/internal gate context when all explicit approval metadata is present, fresh, and scoped to `LIMITLESS`:

```bash
LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED=true
LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE=LIMITLESS
LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID=<approval id>
LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_SECURITY_REVIEW_ID=<security/custody review id>
LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_OPERATOR_APPROVED_BY=<operator ref>
LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVED_AT=<ISO timestamp>
LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT=<ISO timestamp>
```

Passing this gate still does not implement or call `POST /portfolio/withdraw` or `POST /portfolio/redeem`. It is only an approval artifact. A separate implementation pass must keep user-facing routes unable to call those mutation endpoints unless custody/security review explicitly approves a backend-managed withdrawal model.

#### Limitless Withdrawal Dry-Run Command

Before the dry-run can be considered meaningful, operators must complete the account/sub-account readiness checklist:

- Confirm whether the intended Limitless account is a normal account, managed wallet, delegated account, or sub-account.
- Confirm the user-controlled EOA that owns or authorized the account.
- Confirm whether a numeric `profileId` is required for the Programmatic API.
- Confirm the API token is scoped to the same account/profile and has only the minimum read/status scopes needed for dry-run.
- Confirm whether `x-on-behalf-of` is required; if required, it must be a positive integer profile id that the token is authorized to use.
- Confirm no user private key, session cookie, or signing secret is stored in Lotus config.
- Confirm the dry-run target is portfolio history/status only, not `POST /portfolio/withdraw`.
- Record the account/profile decision in the operator artifact or deployment notes before any live withdrawal execution design continues.

Prefer the SDK-backed Programmatic API diagnostic before the manual HTTP dry-run:

```bash
npm run funding:limitless-sdk-auth-dry-run
```

This command constructs the official SDK `HttpClient` with server-side HMAC credentials, then calls only read-only `PortfolioFetcher` methods:

- `getPositions()`
- `getUserHistory(1, 25)`
- `getProfile(address)` only when `LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS` is configured

If the installed SDK helper sends a `page` parameter that the live API rejects, the diagnostic may fall back to `HttpClient.get('/portfolio/history?limit=25')`. That fallback still uses the SDK HMAC client and remains read-only.

Expected successful SDK dry-run fields:

- `status=COMPLETED`
- `mode=SDK_HMAC_READ_ONLY`
- `positionsRead=true`
- `historyRead=true`
- `profileReadAttempted=false` unless a profile wallet address is configured
- `redactionVerified=true`
- `safety.liveVenueWithdrawalEndpointCalled=false`
- `safety.backendSignedTransaction=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.completionPersisted=false`

The SDK diagnostic is authentication/read validation only. It must not call trading, account creation, delegated signing, order, approval, or withdrawal mutation methods.

Operators can validate the disabled-by-default Limitless adapter with:

```bash
npm run funding:limitless-withdrawal-dry-run
```

Default behavior uses mocked Limitless responses. Real HTTP dry-run reads require explicit operator config:

```text
LIMITLESS_WITHDRAWAL_ADAPTER_ENABLED=true
LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL=https://api.limitless.exchange
LIMITLESS_WITHDRAWAL_ADAPTER_AUTH_MODE=NONE|API_KEY|HMAC
LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY=<server-side only>
LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET=<server-side only, if HMAC>
LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID=<optional managed wallet profile id>
LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_PATH=/portfolio/history
LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_QUERY=limit=25
LIMITLESS_WITHDRAWAL_ADAPTER_TIMESTAMP_FORMAT=ISO
LIMITLESS_WITHDRAWAL_ADAPTER_TIMEOUT_MS=5000
LIMITLESS_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY=true
```

For Limitless Programmatic API reads, `HMAC` mode uses the documented headers `lmts-api-key`, `lmts-timestamp`, and `lmts-signature`. The signature payload is:

```text
{timestamp}
{HTTP METHOD}
{request path with query string}
{request body}
```

`LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET` must be the base64 secret from the Limitless programmatic API setup. The adapter base64-decodes it before signing. If the API key is scoped to a managed wallet profile, set `LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID`; the client sends it as `x-on-behalf-of`.

`LIMITLESS_WITHDRAWAL_ADAPTER_TIMESTAMP_FORMAT` may be `ISO` or `UNIX_MS`. Use `UNIX_MS` if the Programmatic API token expects millisecond timestamps in `lmts-timestamp`.

`LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_PATH` and `LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_QUERY` are diagnostic dry-run controls. Limitless portfolio history uses cursor pagination, so the safe default query is `limit=25`; add `cursor=<value>` only when continuing a documented page. These controls let operators test the exact documented portfolio history/status path and query shape without changing runtime withdrawal behavior. They must not be used to point at a mutation endpoint.

The command writes:

```text
artifacts/funding/limitless-withdrawal-dry-run.json
artifacts/funding/limitless-withdrawal-dry-run.md
```

Expected successful artifact fields:

- `status=COMPLETED`
- `quotePrepared=true`
- `userActionPrepared=true`
- `statusFetched=true`
- `evidenceNormalized=true`
- `redactionVerified=true`
- `safety.liveVenueWithdrawalEndpointCalled=false`
- `safety.backendSignedTransaction=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.completionPersisted=false`

Real HTTP dry-run interpretation:

- A `COMPLETED` dry-run artifact proves review-only quote preparation, portfolio-history/status read compatibility, evidence normalization, and redaction only.
- It does not prove live withdrawal execution.
- It does not call `POST /portfolio/withdraw`.
- It does not persist completion.
- Live Limitless withdrawal execution must remain disabled until a separate adapter implementation gate explicitly approves it.

### OPINION

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Classification: `USER_SAFE_AUTHORIZED_ACTION_CANDIDATE`.
- Docs reviewed: `https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode` and `https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem`.
- Believed live withdrawal path: Opinion Builder Mode describes non-custodial user management where users retain control of funds through Gnosis Safe wallets and sign operations with their own keys. Builder API keys authenticate builder calls, but the user EOA signs Safe transactions.
- Required docs/API validation: exact `Split / Merge / Redeem / Withdraw` page behavior, destination support, token support, Safe transaction shape, status API, rate limits, sandbox/test mode, and whether withdrawal is available as a Safe transaction rather than a server-initiated transfer.
- Required auth/config: venue-specific feature flag default off, server-side builder API key only, user-controlled EOA/Safe references only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked Safe-action adapter tests, exact-scope evidence tests, malformed response tests, controlled user-signature rehearsal, controlled live-read smoke, no-secret regression, admin visibility.
- Current Lotus dry-run: `OpinionSafeWithdrawalAdapter` may prepare disabled-by-default BNB Smart Chain `USDT` instructions in `USER_SAFE_DRY_RUN` mode only.
- Blockers before live adapter: no reviewed broad rollout, no production evidence host review, and no approved Opinion mutation endpoint. BSC/USDT completion still requires fresh non-synthetic evidence smoke and completion gate review.

#### Opinion Safe Withdrawal Boundary Decision

Opinion is not classified as `SERVER_INITIATED_WITHDRAWAL` based on the reviewed docs. The relevant Builder Mode docs state that users retain control of funds through Gnosis Safe wallets and sign operations with their own keys. They also list token operations, including `Split / Merge / Redeem / Withdraw`, as Safe transactions.

Allowed next work:

- run `npm run funding:opinion-withdrawal-dry-run` and review the redacted artifact
- prepare frontend/operator-safe Safe action instructions only
- require the user EOA/Safe owner to sign the Safe transaction
- record user-submitted tx hash/reference
- map completion only from exact on-chain or venue evidence

Blocked behavior:

- no backend user private key handling
- no backend Safe owner signing
- no backend transaction broadcast
- no live Opinion withdrawal mutation from Lotus until a controlled user-signed Safe rehearsal passes
- no completion persistence without a fresh, non-synthetic, redacted evidence smoke and completion gate

### MYRIAD

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Classification: `USER_WALLET_AUTHORIZED_ACTION_CANDIDATE`.
- Docs reviewed: `https://docs.myriad.markets/deposit-and-withdraw`.
- Believed live withdrawal path: Myriad docs describe a non-custodial account powered by ThirdWeb where funds are either in the user's wallet or in smart contracts. User-facing withdrawal supports moving funds to an Ethereum-compatible wallet on BNB Smart Chain in USD1, or to an Abstract Wallet in USDC.e.
- Required docs/API validation: exact withdrawal UI/action path, supported destination rails (`BNB Smart Chain` USD1 and `Abstract Wallet` USDC.e), user authorization semantics, status/finality fields, chain/token contract addresses, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side read/evidence credentials only if needed, user wallet references only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked user-wallet instruction adapter tests, fail-closed status tests, exact destination evidence tests for BNB USD1, controlled user-wallet rehearsal, no-secret regression, admin visibility.
- Current Lotus dry-run: `MyriadWalletWithdrawalAdapter` may prepare disabled-by-default BNB Smart Chain `USD1` instructions in `USER_WALLET_DRY_RUN` mode only.
- Blockers before live adapter: no controlled user-wallet rehearsal, no operator-approved production evidence host, and no reviewed Abstract USDC.e support. BNB/USD1 completion still requires fresh non-synthetic evidence smoke and completion gate review.

#### Myriad Wallet Withdrawal Boundary Decision

Myriad is not classified as `SERVER_INITIATED_WITHDRAWAL` based on the reviewed docs. Myriad's user docs state that the account uses a non-custodial crypto wallet and that funds are not in Myriad's possession. Withdrawals are described as user-facing wallet movements to an Ethereum-compatible BNB Smart Chain wallet in USD1 or to an Abstract Wallet in USDC.e.

Allowed next work:

- run `npm run funding:myriad-withdrawal-dry-run` and review the redacted artifact
- prepare frontend-safe user-wallet instructions only for BNB Smart Chain `USD1`
- require the user to complete the Myriad/ThirdWeb wallet action outside Lotus
- record user-submitted tx hash/reference
- map completion only from exact BNB USD1 evidence in this pass

Blocked behavior:

- no backend private key export/import
- no backend ThirdWeb wallet signing
- no backend transaction broadcast
- no server-side withdrawal execution from Lotus unless future docs prove a user-authorized action model
- no completion persistence without a fresh, non-synthetic, redacted evidence smoke and completion gate

### PREDICT_FUN

- Current v0 status: DB-backed withdrawal records exist; evidence smoke and completion gate coverage exist; no live withdrawal execution.
- Known evidence smoke coverage: read-only smoke and completion gate artifacts are supported.
- Classification: `USER_WALLET_AUTHORIZED_ACTION_CANDIDATE`.
- Believed live withdrawal path: Predict.fun wallet docs describe user wallets backed by Privy/ZeroDev, not a Lotus-controlled server wallet. Predict.fun must not be confused with PredictIt or any other Predict-branded venue.
- Required docs/API validation: official withdrawal/action docs or UI flow confirmation, supported destination chains/tokens, auth model, user authorization requirements, status/evidence API, rate limits, and sandbox/test mode.
- Required auth/config: venue-specific feature flag default off, server-side evidence/read credentials only, approved evidence/read hosts, timeout, minimum confirmations, redaction policy.
- Required tests: mocked adapter tests, venue-name safety tests, exact-scope evidence tests, controlled user-wallet rehearsal, controlled live-read smoke, no-secret regression, admin visibility.
- Blockers before live adapter: no validated Lotus adapter for the exact user-wallet withdrawal action/evidence path, no sandbox/test mode confirmation, no operator-approved venue identity mapping.

#### Predict.fun Wallet/ZeroDev Withdrawal Design

Predict.fun withdrawal work must follow a frontend/user-wallet authorization model. Lotus may prepare frontend-safe instructions, but the user must authorize, sign, or confirm withdrawal activity through Predict.fun, Privy, ZeroDev, or a user-controlled wallet path.

Lotus must not:

- hold, request, import, export, or store user private keys or wallet seeds
- perform ZeroDev smart-account operations server-side for users
- use Privy admin/user impersonation to move funds
- store Privy secrets, ZeroDev signer material, session cookies, or user JWTs as withdrawal authority
- sign or broadcast Predict.fun withdrawal transactions from the backend
- call live withdrawal mutation APIs unless a future documented flow proves the action is user-authorized and frontend-approved

Intended safe flow:

```text
User creates a Lotus withdrawal intent
-> Lotus validates venue-ready balance and destination scope
-> Lotus returns Predict.fun-specific frontend instructions only
-> User completes the Predict.fun / Privy / ZeroDev wallet action
-> User submits tx hash or reference to Lotus
-> Lotus reads sanitized evidence
-> Lotus persists completion only through the existing evidence gate
```

Future Predict.fun validation must prove the evidence fields for exact scope matching: transaction hash, destination address, destination chain, destination token, amount, completed time, and wallet/account id. No user-facing rollout or completion persistence should proceed until a controlled user-wallet rehearsal artifact is completed, redacted, reviewed, and fresh.

#### Predict.fun BSC/USDT Evidence And Wallet Requirement

For the current Predict.fun withdrawal phase, Lotus treats Predict.fun withdrawals as BSC USDT only:

- `destinationChain=BSC`
- `destinationToken=USDT`
- BSC USDT token address `0x55d398326f99059fF775485246999027B3197955`

Predict.fun completion evidence can be checked with the internal `BSC_ONCHAIN` evidence mode. This mode reads a BSC transaction receipt through an operator-approved RPC endpoint, finds an ERC20/BEP20 `Transfer` log for the configured USDT contract, and fail-closes unless the transfer matches the expected destination wallet, token, amount, chain, submitted tx hash, and minimum confirmation policy.

The evidence mode is read-only. It does not call Predict.fun, Privy, ZeroDev, LI.FI, or a live venue withdrawal endpoint. It does not sign, broadcast, move funds, or persist completion by itself.

Predict.fun withdrawals also require a user-controlled EVM-compatible receive wallet before the frontend should let a user create the withdrawal intent. Lotus stores only public wallet metadata through the user withdrawal wallet profile surface:

- `GET /user/withdrawal-wallets`
- `PUT /user/withdrawal-wallets/evm`

Stored wallet fields are public receive metadata only: address, chain family, label, verification timestamp, and created/updated timestamps. Lotus must not store private keys, wallet seeds, Privy secrets, ZeroDev signer material, session cookies, user JWTs, or wallet auth tokens.

For private beta full-exit routing, the Predict.fun first hop is BSC USDT into the user's Turnkey EVM wallet. If the user requests a Solana destination, Lotus should prepare the second leg as a user-signed LI.FI bridge-back to Solana USDC, not Solana USDT. The controlled production rehearsal used:

- `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_SOURCE_CHAIN=BSC`
- `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_SOURCE_TOKEN_ADDRESS=0x55d398326f99059fF775485246999027B3197955`
- `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_SYMBOL=USDC`
- `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

LI.FI rejected Solana USDT for this bridge-back route during the beta rehearsal. Treat Solana USDC as the supported default unless a fresh route rehearsal proves otherwise.

Frontend copy should be explicit:

```text
Add an EVM-compatible wallet to receive BSC USDT withdrawals.
```

#### Predict.fun User-Wallet Dry-Run Command

Operators can validate the disabled-by-default Predict.fun instruction adapter with:

```bash
npm run funding:predictfun-withdrawal-dry-run
```

The command does not call Predict.fun, Privy, ZeroDev, a live withdrawal API, LI.FI execution, or any venue mutation path. It prepares only frontend-safe instruction metadata and writes:

- `artifacts/funding/predictfun-withdrawal-dry-run.json`
- `artifacts/funding/predictfun-withdrawal-dry-run.md`

Expected successful fields:

- `status=COMPLETED`
- `mode=USER_WALLET_DRY_RUN`
- `quotePrepared=true`
- `userActionPrepared=true`
- `redactionVerified=true`
- `safety.backendSignedTransaction=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.backendPrivateKeyHandling=false`
- `safety.backendZeroDevSigning=false`
- `safety.privyUserImpersonation=false`
- `safety.completionPersisted=false`

When `PREDICT_FUN_FUNDING_WITHDRAWALS_ENABLED=true`, `PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED=true`, `PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE=USER_WALLET_DRY_RUN`, and `PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY=true`, `POST /funding/withdrawals/:id/quote` may return frontend-safe `routePreview.predictFunUserWallet` metadata for a single-source `PREDICT_FUN` withdrawal. This sandbox wiring still does not sign, broadcast, hold keys, impersonate Privy users, run ZeroDev operations server-side, move funds, persist completion, or enable live withdrawal execution.

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
