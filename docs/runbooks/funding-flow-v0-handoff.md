# Lotus Funding Flow Handoff

Status: HANDOFF READY  
Audience: funding-flow owner  
Last updated: 2026-04-25

## 1. Purpose

This handoff explains the intended Lotus funding architecture for the co-developer who will own Funding Flow v0.

This is architecture context, not an instruction to build everything at once. The immediate goal is to make sure the first implementation is shaped correctly so it can grow into the full Lotus funding product without a rewrite.

Funding must be designed as the capital-movement equivalent of the Lotus matcher, RFQ, SOR, execution, settlement, and accounting system.

Lotus is not a venue. Lotus is an execution and intelligence layer on top of venues such as:

- Polymarket
- Opinion
- Limitless
- Myriad
- Predict.fun
- future venues

The user should not need to manually understand:

- which venue supports which chain
- which token a venue requires
- how to bridge funds
- how to split funds across venues
- whether funds are merely on-chain or truly venue-ready

The desired product experience is:

```text
I have USDC. I want to trade. Lotus routes my funds to the venues needed.
```

## 2. Product Goal

Funding prepares venue-ready capital for approved trade execution.

MVP custody model:

```text
Model A: non-custodial funding preparation.
```

In Model A, Lotus generates route instructions, validates that the route matches operator-approved funding capabilities, tracks the user-broadcast transaction, and reconciles whether capital became venue-ready. The user signs with their own wallet. Lotus does not custody user funds, sign wallet transactions, broadcast user wallet transactions, pool user funds, or internally allocate user balances in v0.

In plain terms:

1. A user chooses a source wallet, source chain, source token, and amount.
2. Lotus creates a funding intent.
3. Lotus checks which venues need funding and what each venue can receive through the Funding Capability Matrix.
4. Lotus plans the route, including direct transfer, swap, bridge, or split funding.
5. Lotus uses a route provider such as LI.FI to produce route quotes and unsigned transaction instructions.
6. The user signs and broadcasts from their wallet.
7. Lotus tracks every route leg.
8. Lotus confirms destination receipt.
9. Lotus confirms venue credit.
10. Lotus marks funds `READY_TO_TRADE` only after venue readiness is confirmed.
11. Execution preflight can then allow trades that require that venue-ready balance.

Funding does not execute trades. Funding only prepares usable venue capital.

## 3. Core Architecture

The full funding architecture is:

```text
Funding intent
-> Funding Capability Matrix
-> funding route planner
-> route legs
-> LI.FI or another route provider
-> user wallet signature/broadcast
-> destination confirmation
-> venue credit/finalization
-> funding accounting
-> READY_TO_TRADE status
```

The execution architecture is separate:

```text
RFQ intent
-> SOR route
-> execution adapter
-> settlement verification
-> accounting
```

The connection point is execution preflight.

Execution preflight must check that the required venue balance is `READY_TO_TRADE` before allowing live execution.

A LI.FI transaction hash is not enough.

A bridge-complete status is not enough.

Only venue-ready confirmation is enough.

### Market Capability Matrix vs Funding Capability Matrix

Do not merge market routeability and funding routeability into one concept.

Market Capability Matrix:

- answers which venues, markets, outcomes, and lane scopes are tradable
- belongs to matcher/readiness/operator approval and SOR routeability
- decides whether a market lane can ever be executable after operator approval

Funding Capability Matrix:

- answers which venue can receive which chain, token, destination address, and finalization path
- belongs to capital movement and venue-ready balance checks
- decides whether funding can safely prepare execution-ready capital for a venue

Execution requires both matrices to pass their own checks:

- an operator-approved market lane
- venue-ready capital for the exact venue, token, user, and amount required by the execution route

## 4. Funding vs Execution

Funding and execution must stay separate.

Funding answers:

- Can this user move capital into Lotus-supported venues?
- Which venue needs which token?
- Which chain should the token land on?
- Did the transfer/bridge/swap complete?
- Did the venue actually credit the user?
- Is the venue balance ready to trade?

Execution answers:

- Is the market lane operator-approved?
- Is the RFQ still valid?
- Is the execution-scope token valid?
- Which approved route should SOR use?
- Can the venue adapter submit the order?
- Did settlement/finality verify?
- Can accounting update the user position?

Funding must not submit orders. Execution must not assume funds are ready just because a funding route started.

## 5. Full Funding Abstraction

The architecture should support full Lotus funding abstraction from the start:

- multi-chain
- multi-token
- multi-venue
- split deposits
- per-venue funding readiness
- later withdrawals
- later rebalancing
- later funding-scope tokens
- later position abstraction integration

Implementation can be phased, but the model must not be single-target-only.

Important distinction:

```text
Architecture must support split funding immediately.
Implementation can start with one route leg and one target venue first.
```

Do not design a model that assumes one source deposit maps to one venue forever.

## 5A. Capital Mobility / Funding Orchestration

Funding is Lotus's capital mobility layer. It moves user intent from "I have USDC" to "this venue has execution-ready capital for this user" without turning Lotus into a custodian.

The funding brain is Lotus, not LI.FI. Lotus owns:

- target venue selection from the Funding Capability Matrix
- split allocation planning
- route validation and stale-quote rejection
- frontend-safe signing instructions
- per-leg status tracking
- destination confirmation
- venue readiness confirmation
- auditability and operator visibility
- execution preflight gating

LI.FI is one route provider in this orchestration. Future providers can be added behind the same Lotus funding planner, but provider success must never be treated as final trade readiness.

Terminology:

- Use `execution-ready capital` when describing capital that can satisfy execution preflight.
- Use `venue-ready balance` when describing funds that a specific venue confirms as usable.
- Use `derived capital view` when displaying balances across venues.
- Avoid `unified balance` unless explicitly qualifying it as a derived view, not custody or pooled funds.

## 6. Domain Objects

### FundingIntent

Represents the user's funding request.

A `FundingIntent` should support both single-target and split-target funding.

Suggested fields:

- `fundingIntentId`
- `userId`
- `sourceChain`
- `sourceToken`
- `sourceAmount`
- `targets[]`
- `status`
- `aggregateRouteQuote`
- `totalEstimatedFees`
- `totalEstimatedTime`
- `auditEventIds`
- `createdAt`
- `updatedAt`

Important:

`FundingIntent` must not assume one target venue. It should support multiple `FundingTarget` records from day one.

Example:

```text
User funds 1,000 USDC from Solana.
Target split:
- 50% Polymarket
- 30% Limitless
- 20% Opinion
```

That should be one `FundingIntent` with three `FundingTarget` entries.

### FundingTarget

Represents one target venue allocation inside a `FundingIntent`.

Suggested fields:

- `targetVenue`
- `targetChain`
- `targetToken`
- `targetAmount`
- `targetPercentage`
- `venueCapabilitySnapshot`
- `status`

Examples:

- Polymarket target: receive venue-compatible USDC.
- Limitless target: receive venue-compatible USDC or ETH depending on capability.
- Myriad target: receive venue-compatible SOL or ETH depending on capability.

The exact token and chain must come from the Funding Capability Matrix, not hardcoded assumptions.

### FundingRouteLeg

Represents the route execution for one target.

Each target gets one or more route legs.

Suggested fields:

- `routeLegId`
- `fundingIntentId`
- `targetVenue`
- `sourceChain`
- `sourceToken`
- `sourceAmount`
- `destinationChain`
- `destinationToken`
- `destinationAmountEstimate`
- `routeProvider`
- `routeQuote`
- `txHashes`
- `bridgeStatus`
- `destinationStatus`
- `venueCreditStatus`
- `status`
- `errorReason`

Important:

Route legs must be independently tracked. One leg can succeed while another fails or remains pending.

### VenueCapability

Represents what a venue can accept for funding.

This is the funding-side capability model. It is separate from the market capability model used for matcher/readiness/operator-approved lane routeability.

Do not hardcode one chain/token per venue.

Suggested fields:

- `venue`
- `supportedChains`
- `supportedTokens`
- `preferredChain`
- `preferredToken`
- `autoCreditSupported`
- `requiresFinalizationStep`
- `supportsDirectDeposit`
- `supportsWithdrawal`
- `readinessStatus`
- `notes`

Important:

Predict.fun is not PredictIt. Treat Predict.fun as its own venue.

The Funding Capability Matrix is the source of truth for target chain/token/destination selection.

Known examples from the architecture flow:

- Polymarket: venue-compatible USDC, commonly represented as `USDC.e` in the current diagram
- Limitless: `USDC` / `ETH`
- Myriad: `SOL` / `ETH`
- Opinion, Predict.fun, and future venues: confirm through Funding Capability Matrix config before routing

These examples are not a substitute for the capability matrix.

### FundingExecution

Represents active execution of a funding route or set of route legs.

Suggested fields:

- `fundingExecutionId`
- `fundingIntentId`
- `routeLegIds`
- `currentStatus`
- `submittedAt`
- `completedAt`
- `failedAt`
- `failureReason`
- `retryAvailable`
- `auditEventIds`

This is separate from trade execution. It is the movement of funds, not the execution of an order.

### FundingReconciliationRecord

Represents the proof that funds reached the destination and became venue-ready.

Suggested fields:

- `reconciliationId`
- `fundingIntentId`
- `routeLegId`
- `targetVenue`
- `destinationTxHash`
- `destinationReceived`
- `venueCreditConfirmed`
- `readyToTrade`
- `checkedAt`
- `notes`

This is the record execution preflight should trust.

If `readyToTrade` is not true for the required venue, execution must not proceed on that venue.

## 7. Lifecycle States

Funding needs aggregate states and per-leg states.

Suggested aggregate states:

- `INTENT_CREATED`
- `ROUTES_QUOTED`
- `USER_SIGNATURE_REQUIRED`
- `USER_SIGNED`
- `ROUTES_SUBMITTED`
- `PARTIALLY_BRIDGING`
- `BRIDGING`
- `PARTIALLY_DESTINATION_RECEIVED`
- `DESTINATION_RECEIVED`
- `PARTIALLY_VENUE_CREDIT_PENDING`
- `VENUE_CREDIT_PENDING`
- `PARTIALLY_READY_TO_TRADE`
- `READY_TO_TRADE`
- `PARTIALLY_FAILED`
- `FAILED`
- `CANCELLED`
- `REFUNDED_OR_RETRY_REQUIRED`

Suggested per-leg states:

- `LEG_CREATED`
- `LEG_QUOTED`
- `LEG_SIGNATURE_REQUIRED`
- `LEG_SUBMITTED`
- `LEG_BRIDGE_PENDING`
- `LEG_DESTINATION_RECEIVED`
- `LEG_VENUE_CREDIT_PENDING`
- `LEG_READY_TO_TRADE`
- `LEG_FAILED`
- `LEG_CANCELLED`
- `LEG_RETRY_REQUIRED`

Rules:

- If one leg is ready and another is pending, aggregate state should be `PARTIALLY_READY_TO_TRADE`.
- Execution can only use the venue leg that is `READY_TO_TRADE`.
- A failed leg must not mark the whole intent ready.
- Partial readiness must be visible in UI and API.
- No execution path may assume all legs succeeded.

## 8. Split Funding Rules

Split funding means a single user funding intent can produce multiple venue-specific route legs.

Rules:

- Each venue target gets its own `FundingTarget`.
- Each `FundingTarget` gets its own route leg or route plan.
- Each route leg can succeed, fail, or require finalization independently.
- Aggregate status must reflect the combined state.
- Execution can only use target venue balances that are `READY_TO_TRADE`.
- Partial readiness is valid.
- UI must show per-venue status clearly.
- No execution path may assume all legs succeeded.
- Venue adapters decide final venue readiness.
- Every leg must be audited separately.

Example split state:

```text
Polymarket: READY_TO_TRADE
Limitless: LEG_BRIDGE_PENDING
Opinion: LEG_FAILED
```

In that example:

- Polymarket execution may proceed if the RFQ/SOR route uses Polymarket and all execution authority checks pass.
- Limitless execution must wait.
- Opinion execution must fail preflight or request retry/remediation.

## 9. LI.FI Role

LI.FI is the first route provider for Funding v0.

Primary docs:

- LI.FI MCP server overview: https://docs.li.fi/mcp-server/overview
- LI.FI introduction: https://docs.li.fi/introduction/introduction
- LI.FI API reference: https://docs.li.fi/api-reference/introduction
- LI.FI SDK overview: https://docs.li.fi/sdk/overview

LI.FI should handle:

- route quote
- bridge/swap plan
- transaction payload
- route status where available

Lotus should wrap LI.FI with its own planner.

Lotus remains responsible for:

- Funding Capability Matrix lookup
- route validation
- status normalization
- per-leg lifecycle
- destination confirmation
- venue-ready confirmation
- audit trail
- frontend-safe messaging
- execution preflight integration

LI.FI is a route provider, not the funding brain or the entire funding product.

### Current v0 Implementation Flags

Funding v0 is implemented fail-closed by default. Operators must configure these flags before route quotes or execution preflight enforcement are active:

- `LIFI_API_BASE_URL=https://li.quest/v1`
- `LIFI_API_KEY` optional and server-side only
- `LIFI_QUOTE_TIMEOUT_MS=10000`
- `LIFI_QUOTE_TTL_SECONDS=60`
- `FUNDING_LIFI_QUOTES_ENABLED=false` by default
- `FUNDING_LIVE_SUBMIT_ENABLED=false`; backend v0 never signs or broadcasts wallet transactions
- `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED=false` until venue-ready funding records are available
- `FUNDING_VENUE_READINESS_CHECKS_ENABLED=false` until the operator wants route status refresh to call venue readiness checkers
- `POLYMARKET_FUNDING_DESTINATION_ADDRESS` required before Polymarket funding quotes can be enabled
- `POLYMARKET_FUNDING_READINESS_MODE=DISABLED` by default; allowed values are `DISABLED`, `STUB`, and `LIVE_READ`
- `POLYMARKET_FUNDING_READINESS_ENABLED=false` by default
- `POLYMARKET_FUNDING_BALANCE_URL` is optional and must point to a server-side, operator-approved balance read path before enabling Polymarket readiness checks
- `POLYMARKET_FUNDING_READ_AUTH_MODE=NONE` by default; use `BEARER` only with server-side operator-approved read credentials
- `POLYMARKET_FUNDING_READ_API_KEY` is server-side only and must never be returned in API responses, artifacts, logs, or receipts
- `POLYMARKET_FUNDING_READ_TIMEOUT_MS=5000`
- `POLYMARKET_FUNDING_MIN_CONFIRMATIONS=0` unless a venue-specific finality policy requires more confirmations
- `POLYMARKET_INTERNAL_BALANCE_READ_ENABLED=false` by default; set to `true` only when the internal read-only CLOB balance service should serve `/internal/polymarket/funding-balance`
- `LIMITLESS_FUNDING_DESTINATION_ADDRESS` required before Limitless funding quotes can be enabled
- `LIMITLESS_FUNDING_PREFERRED_CHAIN=BASE` and `LIMITLESS_FUNDING_PREFERRED_CHAIN_ID=8453` by default
- `LIMITLESS_USDC_TOKEN_ADDRESS` may override the default Base USDC token address
- `LIMITLESS_FUNDING_READINESS_MODE=DISABLED` by default; allowed values are `DISABLED`, `STUB`, and `LIVE_READ`
- `LIMITLESS_FUNDING_READINESS_ENABLED=false` by default
- `LIMITLESS_FUNDING_BALANCE_URL` is optional and must point to a server-side, operator-approved balance read path before enabling Limitless readiness checks
- `LIMITLESS_FUNDING_READ_AUTH_MODE=NONE` by default; use `BEARER` only with server-side operator-approved read credentials
- `LIMITLESS_FUNDING_READ_API_KEY` is server-side only and must never be returned in API responses, artifacts, logs, or receipts
- `LIMITLESS_FUNDING_READ_TIMEOUT_MS=5000`
- `LIMITLESS_FUNDING_MIN_CONFIRMATIONS=0` unless a venue-specific finality policy requires more confirmations
- `OPINION_FUNDING_DESTINATION_ADDRESS`, `MYRIAD_FUNDING_DESTINATION_ADDRESS`, and `PREDICT_FUN_FUNDING_DESTINATION_ADDRESS` are required before those venues can be used for funding quotes
- `OPINION_*`, `MYRIAD_*`, and `PREDICT_FUN_*` readiness envs follow the same disabled-by-default balance-read pattern: `*_FUNDING_READINESS_MODE=DISABLED`, `*_FUNDING_BALANCE_URL`, `*_FUNDING_READ_AUTH_MODE`, `*_FUNDING_READ_API_KEY`, `*_FUNDING_READ_TIMEOUT_MS`, and `*_FUNDING_MIN_CONFIRMATIONS`
- `OPINION_FUNDING_PREFERRED_CHAIN`, `MYRIAD_FUNDING_PREFERRED_CHAIN`, and `PREDICT_FUN_FUNDING_PREFERRED_CHAIN` default to `POLYGON` until operator-approved venue capability data says otherwise
- `SOLANA_USDC_TOKEN_ADDRESS` and `POLYGON_USDC_TOKEN_ADDRESS` may override default token addresses

The implemented user endpoints are:

- `POST /funding/intents`
- `GET /funding/intents/:fundingIntentId`
- `POST /funding/intents/:fundingIntentId/quote`
- `POST /funding/intents/:fundingIntentId/submit`
- `GET /funding/intents/:fundingIntentId/status`
- `GET /funding/venues/capabilities`

The backend only records a user-broadcast transaction hash on submit. It does not custody user funds, sign wallet transactions, internally allocate user funds, or broadcast LI.FI transactions in v0.

Do not let LI.FI status become the final source of truth for trade readiness. LI.FI can say a route completed, but Lotus still needs destination and venue-credit confirmation.

### Internal Polymarket Balance Read Service

Lotus can serve the Polymarket funding readiness read contract from an internal backend route:

```http
GET /internal/polymarket/funding-balance?userId=...&fundingIntentId=...&routeLegId=...
```

Safe response contract:

```json
{
  "usableBalance": "100"
}
```

The route is read-only and uses the Polymarket CLOB SDK balance/allowance read path for collateral. It returns the lesser of balance and allowance as a USDC amount. It must not return raw CLOB responses, API keys, auth headers, private keys, allowances, or provider internals.

Activation rules:

- `POLYMARKET_INTERNAL_BALANCE_READ_ENABLED=true` is required.
- CLOB envs must be complete: `POLYMARKET_CLOB_HOST`, `POLYMARKET_CHAIN_ID`, `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`, and `POLYMARKET_PRIVATE_KEY`.
- If `POLYMARKET_FUNDING_READ_API_KEY` is configured, callers must use `Authorization: Bearer <token>`.
- If no bearer token is configured, local development allows loopback-only access; production must configure bearer auth.
- This service does not mark funding `READY_TO_TRADE`; it only supplies the balance read used by the existing readiness checker.

### Generic Venue Readiness Smoke Tests

Use these read-only commands to validate a venue `LIVE_READ` response contract before any broader route funding enforcement rehearsal:

```bash
npm run funding:limitless-readiness-smoke
npm run funding:opinion-readiness-smoke
npm run funding:myriad-readiness-smoke
npm run funding:predictfun-readiness-smoke
npm run funding:venue-readiness-smoke -- OPINION
```

Required operator config:

- `<VENUE>_FUNDING_READINESS_MODE=LIVE_READ`
- `<VENUE>_FUNDING_BALANCE_URL` must point to an operator-approved server-side balance read service.
- `<VENUE>_FUNDING_READ_AUTH_MODE=BEARER` requires `<VENUE>_FUNDING_READ_API_KEY`.
- `TEST_DATABASE_URL` or `DATABASE_URL` must point to a database with at least one confirmed funding route leg for that venue.

The command:

- selects one safe venue funding route leg with confirmed destination status
- invokes the shared configurable venue readiness checker in read-only mode
- validates parsing for `READY_TO_TRADE`, `VENUE_CREDIT_PENDING`, or `UNKNOWN`
- writes `artifacts/funding/<venue>-readiness-smoke-test.json`
- writes `artifacts/funding/<venue>-readiness-smoke-test.md`
- does not persist readiness
- does not enable funding preflight enforcement
- does not call LI.FI live execution
- does not broadcast transactions

Expected safety fields:

- `readOnly=true`
- `persistedReadinessResult=false`
- `liveLifiExecutionEnabled=false`
- `fundingPreflightEnforcementEnabled=false`
- `redactionVerified=true`

These commands only prove a venue read path can be parsed safely. They do not make pair-route or tri-route funding enforcement production-ready by themselves.

### Opinion Readiness Seed And Reconciliation Rehearsal

Use this sequence to create one confirmed Opinion funding route leg, validate the read-only balance-read mapping, then persist readiness only if the smoke artifact proves `READY_TO_TRADE`:

```bash
npm run funding:seed-opinion-readiness-smoke
npm run funding:opinion-readiness-smoke
npm run funding:opinion-readiness-reconcile
```

Safety rules:

- `funding:seed-opinion-readiness-smoke` creates a sandbox funding intent, target, route leg, fake tx hash, and destination-confirmed reconciliation row.
- The seed command does not call LI.FI, does not broadcast a transaction, and does not mark funds `READY_TO_TRADE`.
- `funding:opinion-readiness-smoke` is read-only and writes `artifacts/funding/opinion-readiness-smoke-test.json`.
- `funding:opinion-readiness-reconcile` refuses to persist unless the smoke artifact is `COMPLETED`, `mappingObserved=READY_TO_TRADE`, `redactionVerified=true`, and safety flags show no live LI.FI execution or funding enforcement.
- The reconciliation command persists readiness through `FundingService.verifyVenueReadiness`, not through admin reads.
- If the smoke maps to `VENUE_CREDIT_PENDING`, `UNKNOWN`, fails redaction, or has no selected row, do not run reconciliation.

### Opinion Route Enforcement Rehearsal Gate

After Opinion readiness is persisted, run a sandbox-only execution preflight rehearsal before treating any Opinion route as funding-enforcement-ready:

```bash
npm run funding:opinion-readiness-sandbox-preflight
npm run funding:opinion-enforcement-gate
```

The rehearsal:

- selects one persisted `READY_TO_TRADE` Opinion funding row from the real funding tables
- builds a sandbox `CRYPTO_BTC_ATH_BY_DATE_SINGLE_OPINION` lane in script scope only
- runs execution preflight with funding enforcement enabled only inside the script
- does not call LI.FI
- does not broadcast transactions
- does not submit venue orders
- writes `artifacts/funding/opinion-funding-readiness-sandbox-preflight.json`
- writes `artifacts/funding/opinion-funding-readiness-sandbox-preflight.md`

The gate refuses enforcement readiness unless:

- the artifact status is `COMPLETED`
- the artifact is fresh, default 24 hours
- every venue in the route path has persisted `READY_TO_TRADE` evidence
- every route leg has `LEG_READY_TO_TRADE`, `destinationStatus=CONFIRMED`, and `venueCreditStatus=CONFIRMED`
- execution preflight returned `ok=true`
- safety flags show default funding enforcement, live LI.FI execution, backend broadcast, and live venue submission are all disabled
- redaction is verified

For pair, tri, or split routes, the same rule applies: every venue in the route must have fresh persisted readiness evidence and a passing route-specific rehearsal gate. A single ready venue does not make a multi-venue route enforcement-ready.

### All-Venue Readiness Gate Summary

Before any sandbox funding-enforcement rollout, run:

```bash
npm run funding:venue-gate-summary
```

This read-only report:

- checks Polymarket, Limitless, Opinion, Myriad, and Predict.fun
- accepts either a single-venue rehearsal artifact or a pair rehearsal artifact that covers the venue
- verifies freshness, default 24 hours
- verifies persisted readiness evidence
- verifies execution preflight passed
- verifies redaction and safety flags
- writes `artifacts/funding/all-venue-readiness-gate-summary.json`
- writes `artifacts/funding/all-venue-readiness-gate-summary.md`

Treat any venue with `FAILED`, `MISSING`, or `STALE` as not enforcement-ready. Do not enable pair, tri, split, or venue-specific enforcement unless every venue required by that route is `PASSED` in this summary and the route-specific gate also passes.

### LI.FI Integration Boundary

The Lotus wrapper around LI.FI should own the product contract. Do not let UI, RFQ, execution, or venue adapters call LI.FI directly.

Suggested internal services:

- `LifiRouteQuoteService`
- `LifiRouteExecutionService`
- `LifiRouteStatusService`
- `FundingRoutePlanner`

LI.FI-facing inputs should come from Lotus objects:

- `FundingIntent`
- `FundingTarget`
- `VenueCapability` or the funding capability snapshot
- `FundingRouteLeg`

LI.FI-facing outputs should be normalized before storage or API response:

- route provider id
- quote id or route id if provided
- source chain/token/amount
- destination chain/token/amount estimate
- estimated fees
- estimated duration
- transaction request payload for the user's wallet
- status snapshots
- provider error code and safe message

Never store or expose raw secrets. Never expose route-provider auth, private keys, or venue credentials in frontend responses.

### LI.FI Status Is Not Venue Readiness

The route lifecycle has three separate confirmations:

1. LI.FI route status says the bridge/swap route moved forward.
2. Destination confirmation says funds arrived on the target chain/address.
3. Venue adapter says funds are credited and `READY_TO_TRADE`.

Only step 3 can unblock trade execution.

If LI.FI reports success but the venue adapter cannot confirm venue credit, the funding leg must remain `LEG_VENUE_CREDIT_PENDING` and execution preflight must block that venue.

### LI.FI MCP Server Usage

The LI.FI MCP server can be useful for developer research, route inspection, and implementation support, but it should not become a hidden production dependency unless explicitly designed and reviewed.

Default implementation posture:

- backend runtime should use the LI.FI API or SDK through a Lotus wrapper
- MCP usage is for developer tooling and diagnostics unless separately approved
- generated route logic must still be audited and covered by tests
- any MCP-assisted output must be checked into code/docs only after review

## 10. Venue Adapter Role

Venue adapters decide whether funds are actually ready for trading.

A bridge completing does not necessarily mean the venue balance is usable.

Venue adapters should eventually expose:

- `confirmDestinationReceived()`
- `finalizeVenueCredit()`
- `fetchVenueFundingStatus()`
- `fetchVenueBalance()`
- `normalizeFundingError()`

Venue adapter output should produce:

- `DESTINATION_RECEIVED`
- `VENUE_CREDIT_PENDING`
- `READY_TO_TRADE`
- `FAILED`

Important:

Execution preflight must not treat a successful bridge as venue-ready unless the adapter confirms readiness.

## 11. Execution Preflight Dependency

Funding status gates trade execution.

Execution requires both:

- operator-approved market lane authority
- venue-ready capital for the exact venue, token, user, and amount

Execution preflight should check:

- Does the user have enough `READY_TO_TRADE` venue-ready balance on the required venue?
- Does the required venue match the approved SOR route?
- Is the funding leg for that venue confirmed?
- Is the balance reserved for this execution?
- Is the funding status stale, failed, or uncertain?

If yes:

- execution can proceed to the normal execution adapter flow

If no:

- execution must be blocked
- preflight should return a deterministic reason
- audit should record the funding failure

Do not let execution use:

- pending bridge funds
- destination-received but uncredited funds
- failed funding legs
- unknown funding capability states
- derived capital view totals that do not exist on the venue required by the route

## 12. Audit Events

Funding must be auditable.

Suggested funding audit events:

- `FUNDING_INTENT_CREATED`
- `FUNDING_ROUTES_QUOTED`
- `FUNDING_USER_SIGNATURE_REQUIRED`
- `FUNDING_USER_SIGNED`
- `FUNDING_ROUTES_SUBMITTED`
- `FUNDING_LEG_SUBMITTED`
- `FUNDING_LEG_BRIDGE_PENDING`
- `FUNDING_LEG_DESTINATION_RECEIVED`
- `FUNDING_LEG_VENUE_CREDIT_PENDING`
- `FUNDING_LEG_READY_TO_TRADE`
- `FUNDING_LEG_FAILED`
- `FUNDING_PARTIALLY_READY_TO_TRADE`
- `FUNDING_READY_TO_TRADE`
- `FUNDING_FAILED`
- `FUNDING_RETRY_REQUESTED`
- `FUNDING_REFUND_REQUIRED`
- `FUNDING_CANCELLED`

Every route leg should have its own audit events.

Audit events should include:

- `fundingIntentId`
- `routeLegId` when applicable
- `targetVenue`
- `sourceChain`
- `sourceToken`
- `destinationChain`
- `destinationToken`
- sanitized route provider status
- user-safe error reason

Never log private keys, signing payload secrets, API keys, or raw credentials.

## 13. Frontend/API State Model

Frontend should eventually display simple status labels.

User-facing statuses:

- preparing route
- route ready
- waiting for wallet signature
- bridging funds
- confirming destination
- crediting venue
- partially ready
- ready to trade
- failed
- retry required
- cancelled

API response should eventually include:

- `fundingIntentId`
- `currentStatus`
- `routePreview`
- `targets[]`
- `routeLegs[]`
- `txHashes`
- `estimatedArrival`
- `totalEstimatedFees`
- `targetVenues`
- `venueCreditStatuses`
- `userSafeMessage`

For split funding, UI must show per-venue status.

Example:

```text
Polymarket: Ready to trade
Limitless: Bridge pending
Opinion: Venue credit pending
```

The UI must not imply that all funds are usable when only one leg is ready.

## 14. Endpoints Needed During The Build

The funding owner should treat these as the practical API surface for Funding v0. Some endpoints may already exist for RFQ/execution; funding-specific endpoints should be added later when implementation starts.

### Existing Execution Endpoints To Understand

```http
POST /rfq
```

Why it matters:

Creates the RFQ intent. Funding should not move money here by default. At most, this can show a funding preview later.

```http
POST /rfq/:id/execution-scope-token
```

Why it matters:

Creates the short-lived execution authority token. Funding does not replace this. A user can have funds and still not be allowed to execute an unapproved lane.

```http
POST /rfq/:id/accept
```

Why it matters:

This is the key connection point. RFQ accept starts execution, so execution preflight must check `READY_TO_TRADE` venue funding before venue submission.

```http
GET /rfq/:id/executions/:executionId/status
```

Why it matters:

Frontend reads final execution status here. Funding state should eventually appear here in a safe summary, such as reservation status and funding failure reason.

### Funding Endpoints To Add

```http
POST /funding/intents
```

Why call it:

Frontend calls this when the user starts funding Lotus.

Example request:

```json
{
  "sourceChain": "SOLANA",
  "sourceToken": "USDC",
  "sourceAmount": "1000",
  "sourceWallet": "user-wallet-address",
  "targets": [
    {
      "targetVenue": "POLYMARKET",
      "targetPercentage": 50
    },
    {
      "targetVenue": "LIMITLESS",
      "targetPercentage": 30
    },
    {
      "targetVenue": "OPINION",
      "targetPercentage": 20
    }
  ]
}
```

Expected response:

```json
{
  "fundingIntentId": "funding-intent-id",
  "currentStatus": "INTENT_CREATED",
  "targets": [],
  "userSafeMessage": "Funding intent created. Route quote is pending."
}
```

```http
POST /funding/intents/:fundingIntentId/quote
```

Why call it:

Quotes the funding route before the user signs anything. This should use the Funding Capability Matrix and LI.FI wrapper to produce route previews.

Expected response:

```json
{
  "fundingIntentId": "funding-intent-id",
  "currentStatus": "ROUTES_QUOTED",
  "routePreview": {
    "totalEstimatedFees": "4.25",
    "totalEstimatedTime": "8-15 minutes"
  },
  "targets": [
    {
      "targetVenue": "POLYMARKET",
      "targetChain": "POLYGON",
      "targetToken": "USDC.e",
      "targetAmount": "500",
      "status": "LEG_QUOTED"
    }
  ]
}
```

```http
POST /funding/intents/:fundingIntentId/submit
```

Why call it:

Submits the user-approved funding route after wallet signature. This is where LI.FI transaction payloads are used. In early v0 this can remain sandbox/stubbed until live routing is reviewed.

Expected response:

```json
{
  "fundingExecutionId": "funding-execution-id",
  "fundingIntentId": "funding-intent-id",
  "currentStatus": "ROUTES_SUBMITTED",
  "routeLegs": [
    {
      "routeLegId": "route-leg-id",
      "targetVenue": "POLYMARKET",
      "status": "LEG_SUBMITTED",
      "txHashes": ["0x..."]
    }
  ]
}
```

```http
GET /funding/intents/:fundingIntentId
```

Why call it:

Frontend polls this to show progress from route quote through `READY_TO_TRADE`.

```http
GET /funding/intents/:fundingIntentId/route-legs
```

Why call it:

Frontend and operators need per-leg status for split funding. Aggregate status is not enough.

```http
GET /funding/status
```

Why call it:

Shows the user's current funding readiness across venues.

Expected response:

```json
{
  "userId": "user-id",
  "venueBalances": [
    {
      "venue": "POLYMARKET",
      "token": "USDC.e",
      "readyToTradeBalance": "500",
      "reservedBalance": "0",
      "status": "READY_TO_TRADE"
    }
  ],
  "derivedCapitalView": [
    {
      "displayToken": "USDC",
      "availableEquivalent": "500",
      "reservedEquivalent": "0"
    }
  ]
}
```

```http
GET /funding/reservations/:reservationId
```

Why call it:

Useful when RFQ accept fails or an execution is waiting on reservation/finalization.

### Admin Funding Endpoints To Add

```http
GET /admin/funding/intents/:fundingIntentId
```

Why call it:

Operator inspects the full funding intent, route quote, split plan, and current lifecycle state.

```http
GET /admin/funding/route-legs/:routeLegId
```

Why call it:

Operator inspects one route leg that is stuck, failed, pending bridge, or pending venue credit.

```http
GET /admin/funding/venue-capabilities
```

Why call it:

Operator verifies what Lotus believes each venue supports before routing funds.

```http
GET /admin/funding/venue-credits?userId=<userId>
```

Why call it:

Operator verifies which venue balances are actually `READY_TO_TRADE`.

```http
GET /admin/funding/ledger?userId=<userId>
```

Why call it:

Operator audits funding lifecycle events.

```http
GET /admin/funding/reconciliation/:reconciliationId
```

Why call it:

Operator checks the proof that funds reached destination and became venue-ready.

### Endpoint Rule

User endpoints should never expose private keys, route-provider secrets, venue credentials, raw auth headers, or signing secrets.

Admin endpoints should be read-only first. Do not add funding mutation endpoints until the status model, audit model, and reconciliation model are proven.

## 15. Failure Rules

Funding must fail closed.

If route quote fails:

- do not ask user to sign
- mark route failed
- show user-safe reason

If user rejects signature:

- mark cancelled
- create no execution side effect

If bridge stalls:

- keep pending or fail depending on timeout policy
- show retry or escalation

If destination receives funds but venue credit is not ready:

- mark `VENUE_CREDIT_PENDING`
- execution remains blocked for that venue

If funding capability is unknown:

- do not route funding

If one split leg fails:

- do not mark the whole intent ready
- preserve ready state for successful legs
- show partial readiness

Recommended deterministic failure reasons:

- `VENUE_CAPABILITY_UNKNOWN`
- `ROUTE_QUOTE_FAILED`
- `USER_SIGNATURE_REJECTED`
- `ROUTE_SUBMISSION_FAILED`
- `BRIDGE_TIMEOUT`
- `DESTINATION_NOT_CONFIRMED`
- `VENUE_CREDIT_NOT_CONFIRMED`
- `PARTIAL_SPLIT_FAILURE`
- `READY_TO_TRADE_NOT_AVAILABLE`

## 16. V0 Implementation Guidance

Build progressively.

Phase 0:

- domain model and handoff clarity
- no live routing

Phase 1:

- single-source, single-target funding path
- source: `USDC` on Solana
- route provider: LI.FI
- target: one venue first
- status tracking
- audit events
- frontend-safe route preview

Phase 2:

- multi-venue split deposits
- one source amount split into multiple target venue legs
- each leg tracked independently
- partial readiness supported

Phase 3:

- withdrawals
- venue-to-wallet flows
- multi-venue withdrawal aggregation

Phase 4:

- funding SOR
- route optimization across providers
- route risk scoring
- fallback providers

Phase 5:

- funding-scope tokens
- operator controls
- advanced automation

Phase 6:

- position abstraction and derived capital view integrations

First implementation should start with:

- domain types
- Funding Capability Matrix
- LI.FI quote wrapper
- one route leg success path
- status lifecycle
- audit events
- frontend-safe output

Then add:

- multi-venue split route execution
- per-leg status tracking
- venue adapter finalization
- withdrawals
- rebalancing

## 17. Out of Scope for First Build

Do not build first:

- internal Lotus custody
- router contract model
- custody/vault model
- smart contracts
- full multi-provider funding SOR
- instant settlement LP product
- full position abstraction
- production-grade route insurance
- complete withdrawal system
- live venue trade execution
- matcher changes
- operator auto-approval
- broad production activation

Warnings:

- Do not design single-target-only funding. Even if implementation starts with one venue, the model must support split funding.
- Do not hardcode one chain per venue. Use venue capabilities.
- Do not confuse Predict.fun with PredictIt. They are different.
- Do not mark funds ready after only a bridge transaction. Venue-ready confirmation is required.
- Do not let execution preflight bypass funding status. Execution requires `READY_TO_TRADE` for the venue it will use.
- Do not treat LI.FI as the whole product. LI.FI is only the route provider.
- Do not blur future models into v0. Router contracts, custody/vaults, instant settlement LPs, and position abstraction are separate future models, not MVP funding behavior.

## 18. Security Rules Before Build

Funding moves user capital, so its first implementation must be security-shaped even if it starts with one route leg.

Required rules:

- Do not let the frontend, RFQ flow, execution flow, or venue adapter call LI.FI directly.
- Do not treat a LI.FI quote as trusted after it becomes stale.
- Do not treat a LI.FI route status as venue readiness.
- Do not route to a destination chain, token, or address unless it matches the Funding Capability Matrix.
- Do not ask the user to sign a route payload unless the UI can show the source, destination, token, amount, estimated fees, and target venue in plain language.
- Do not store or return route-provider credentials, private keys, venue API secrets, or signing secrets.
- Do not mark aggregate funding `READY_TO_TRADE` if any required route leg is pending, failed, stale, or not venue-credited.
- Do not let execution use a venue balance unless the venue-specific leg is `READY_TO_TRADE`.
- Do not make split funding all-or-nothing in the data model. Partial readiness must be explicit and auditable.
- Do not let failed split legs contaminate successful venue-ready legs.

Implementation must create deterministic failure reasons for security-sensitive states:

- `ROUTE_QUOTE_STALE`
- `ROUTE_DESTINATION_MISMATCH`
- `ROUTE_PROVIDER_STATUS_UNTRUSTED`
- `DESTINATION_NOT_CONFIRMED`
- `VENUE_CREDIT_NOT_CONFIRMED`
- `READY_TO_TRADE_NOT_AVAILABLE`
- `FUNDING_ROUTE_REPLAY_BLOCKED`
- `FUNDING_SIGNATURE_REJECTED`

Before runtime implementation starts, read:

- `docs/security/LOTUS_SECURITY_AUDIT.md`
- `docs/security/LOTUS_THREAT_MODEL.md`
- `docs/security/LOTUS_SECURITY_CHECKLIST.md`

## 19. Funding v0 Validation Notes

Current funding v0 validation commands:

- `npm run db:migrate:test`
- `npm run test:funding-flow`
- `npm run test:funding-flow:db`
- `npm run test:execution-system`
- `npx vitest run test/integration/rfq-lifecycle.test.ts --maxWorkers=1`

The DB-backed funding test proves:

- funding tables apply through the migration path
- funding intent, target, route leg, reconciliation, and audit rows persist
- mocked LI.FI quote/status data drives `USER_SIGNATURE_REQUIRED`, `BRIDGING`, and `ROUTES_SUBMITTED`
- destination receipt and venue-credit pending do not become `READY_TO_TRADE`
- venue readiness confirmation is required before execution funding preflight can pass
- funding preflight enforcement remains disabled by default and only blocks execution when explicitly enabled

Known suite caveat:

- `npm run test:unit` currently has unrelated pre-existing failures in non-funding tests. Use the targeted funding, execution-system, and RFQ lifecycle commands above as the funding v0 acceptance suite until that backlog is cleaned up.

## 20. Sandbox Funding-Enforcement Rehearsal

Before enabling any real funding enforcement flag, operators can run a controlled sandbox rehearsal:

```bash
npm run funding:polymarket-readiness-sandbox-preflight
```

This command:

- creates one sandbox funding intent
- uses a mocked LI.FI quote and mocked LI.FI status, with no live LI.FI call
- submits a fake user transaction hash to the funding service, with no broadcast
- reconciles Polymarket readiness through `refreshIntentStatus`
- persists a `READY_TO_TRADE` reconciliation row
- verifies admin readiness can see the persisted row
- runs execution/RFQ accept preflight with funding enforcement enabled only inside the script
- leaves the database row persisted for operator inspection

Safety notes:

- live LI.FI execution remains disabled
- backend transaction broadcast remains false
- default funding preflight enforcement remains false
- script-scoped funding enforcement is temporary and local to the rehearsal
- this does not mean production funding enforcement is enabled
- this does not move real funds

Expected successful output:

- `persistedReadinessResult=true`
- `rfqAcceptPreflight.ok=true`
- `redactionVerified=true`
- `npm run report:funding:readiness` shows the persisted sandbox row

Run this rehearsal:

- before enabling any real funding enforcement flag
- after changes to funding reconciliation
- after changes to venue readiness checker behavior
- after changes to execution preflight funding checks

Sandbox enforcement gate:

- Only rehearse or enable funding enforcement for routes where every venue in the approved RFQ/SOR route has validated readiness coverage.
- A route is not enforcement-ready if one venue can persist `READY_TO_TRADE` but another route venue is still manually seeded, stub-only, or `NOT_CONFIGURED`.
- Pair, tri, and split routes require per-venue readiness evidence for each venue leg before the full route can pass funding preflight.
- If any required venue lacks readiness coverage, execution must fail preflight with `FUNDING_UNAVAILABLE` or remain in sandbox rehearsal only.
- The current Polymarket readiness path is validated first; other route venues must get their own checker or approved evidence path before broad sandbox enforcement.
- `npm run report:funding:readiness` must show the relevant persisted rows before an operator treats the route as enforcement-ready.

### Pair-Route Funding-Enforcement Rehearsal

Run:

```bash
npm run funding:pair-readiness-sandbox-preflight
```

This command rehearses the approved sandbox pair lane:

```text
CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET
```

It:

- creates one split-capable funding intent with `LIMITLESS` and `POLYMARKET` targets
- uses a mocked LI.FI quote/status provider, with no live LI.FI execution
- submits fake user tx hashes, with no backend broadcast
- refreshes funding status and calls the configured venue readiness checkers
- persists readiness reconciliation for both venue legs when evidence supports it
- runs execution preflight for the pair lane with funding enforcement enabled only inside the script
- writes `artifacts/funding/pair-funding-readiness-sandbox-preflight.json`
- writes `artifacts/funding/pair-funding-readiness-sandbox-preflight.md`

Expected successful output:

- `status=COMPLETED`
- `persistedReadinessRows=2`
- `executionPreflight.ok=true`
- `liveLifiExecutionEnabled=false`
- `backendBroadcastedTransaction=false`
- `liveVenueSubmissionEnabled=false`
- `redactionVerified=true`

Required operator config:

- `POLYMARKET_FUNDING_READINESS_MODE=LIVE_READ`
- `POLYMARKET_FUNDING_BALANCE_URL` configured
- `LIMITLESS_FUNDING_READINESS_MODE=LIVE_READ`
- `LIMITLESS_FUNDING_BALANCE_URL` configured
- both venue destination addresses configured

This is still a sandbox rehearsal. It does not enable global funding preflight enforcement and does not make pair-route funding enforcement production-ready by itself.

Operator gate before pair-route enforcement:

- Do not enable pair-route funding enforcement unless `artifacts/funding/pair-funding-readiness-sandbox-preflight.json` exists.
- The artifact must have `status=COMPLETED`.
- The artifact must have `persistedReadinessRows=2`.
- The artifact must have `executionPreflight.ok=true`.
- The artifact must be fresh for the intended deployment window.
- Treat the artifact as stale if it is older than 24 hours, if funding/readiness/preflight code changed after it was generated, or if the venue readiness env/config changed after it was generated.
- If stale or missing, rerun `npm run funding:pair-readiness-sandbox-preflight` and review the artifact before changing any enforcement flag.

Machine-checkable gate:

```bash
npm run funding:pair-enforcement-gate
```

This command reads `artifacts/funding/pair-funding-readiness-sandbox-preflight.json` and exits non-zero if the artifact is missing, stale, not `COMPLETED`, does not have two persisted readiness rows, does not have `executionPreflight.ok=true`, fails redaction, or has unsafe flags such as live LI.FI execution or backend broadcast enabled. The default freshness window is 24 hours. Operators can override it with `FUNDING_PAIR_REHEARSAL_MAX_AGE_HOURS`.

## 21. Decisions Needed Before Build

- Which venue should be the first target path?
- Which chains/tokens are enabled in the first capability matrix?
- Should Phase 1 source funding be limited to `USDC` on Solana only, or include `SOL` immediately?
- Which status source should confirm destination receipt for the first route?
- How does each venue confirm "ready to trade"?
- Which venues require a manual finalization step after destination receipt?
- What venue wallets or deposit addresses are user-specific vs shared?
- What timeout policy should be used for bridge pending, destination pending, and venue-credit pending?
- Should funding reservations be per venue leg, per RFQ execution, or both?
- Which admin read-only funding views are needed first?

## 22. Questions That Can Wait

- How much of LI.FI route status can be trusted directly beyond the first route?
- What frontend screens already exist for deposit status?
- How should failed split legs be retried?
- What user copy should be shown for partial readiness?
- What withdrawal flow should be supported first?
- What rebalancing policy should Lotus eventually use between venues?
- When should funding-scope tokens become mandatory?
- How should funding route risk scores be surfaced to users and operators?
