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
- `withdrawalMode`: `USER_SIGNED`, `AUTO_RESOLUTION_ONLY`, `PARTNER_MANAGED_BACKEND`, or `UNSUPPORTED`
- `userSignedWithdrawalSupported`
- `partnerManagedWithdrawal`: disabled backend/partner withdrawal metadata when a venue exposes a non-user-signed server path
- `readinessStatus`
- `notes`

Important:

Predict.fun is not PredictIt. Treat Predict.fun as its own venue.

The Funding Capability Matrix is the source of truth for target chain/token/destination selection.

Known examples from the architecture flow:

- Polymarket: venue-compatible collateral. For CLOB V2 trading readiness this is pUSD collateral, not raw USDC.e. API-only funding flows must account for USDC.e -> pUSD wrapping through Polymarket's Collateral Onramp before execution readiness can be treated as venue-ready.
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

The route is read-only and uses the Polymarket CLOB V2 SDK balance/allowance read path for collateral. Under Polymarket V2, this collateral is pUSD, a standard ERC-20 backed by USDC. The service returns the lesser of balance and allowance as a decimal collateral amount for Lotus readiness comparison. It must not return raw CLOB responses, API keys, auth headers, private keys, allowances, or provider internals.

Activation rules:

- `POLYMARKET_INTERNAL_BALANCE_READ_ENABLED=true` is required.
- CLOB envs must be complete: `POLYMARKET_CLOB_HOST`, `POLYMARKET_CHAIN_ID`, `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`, and `POLYMARKET_PRIVATE_KEY`.
- Polymarket CLOB V2 must use `@polymarket/clob-client-v2`; legacy `@polymarket/clob-client` and `@polymarket/builder-signing-sdk` are not valid for production.
- Before the 2026-04-28 cutover, point `POLYMARKET_CLOB_HOST` at `https://clob-v2.polymarket.com`; after cutover, `https://clob.polymarket.com` serves V2.
- Builder attribution uses `POLYMARKET_BUILDER_CODE` / `builderCode`; old `POLY_BUILDER_*` HMAC builder headers are not used.
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

### Route-Scope Enforcement Readiness Gate

Before turning on sandbox funding enforcement for a specific route or lane, run:

```bash
npm run funding:route-enforcement-ready -- <ROUTE_OR_LANE_ID>
```

For the current Limitless plus Polymarket pair rehearsal, the convenience command is:

```bash
npm run funding:route-enforcement-ready:pair
```

For the current sandbox tri rehearsal:

```bash
npm run funding:tri-readiness-sandbox-preflight
npm run funding:route-enforcement-ready:tri
```

This covers:

- `CRYPTO_BTC_ATH_BY_DATE_TRI_LIMITLESS_OPINION_POLYMARKET`
- `POLYMARKET`
- `LIMITLESS`
- `OPINION`

For the strict-all sandbox rehearsal:

```bash
npm run funding:strict-all-readiness-sandbox-preflight
npm run funding:route-enforcement-ready:strict-all
```

This covers:

- `CRYPTO_BTC_ATH_BY_DATE_STRICT_ALL_LIMITLESS_MYRIAD_OPINION_POLYMARKET_PREDICT_FUN`
- `POLYMARKET`
- `LIMITLESS`
- `OPINION`
- `MYRIAD`
- `PREDICT_FUN`

This read-only validator:

- infers the route venues from the lane id, or uses `FUNDING_ROUTE_REQUIRED_VENUES`
- requires `artifacts/funding/all-venue-readiness-gate-summary.json` to be `PASSED` and fresh
- requires every route venue to be `PASSED` and fresh in the all-venue summary
- requires a route-specific rehearsal artifact to be `COMPLETED` and fresh
- verifies every required venue has persisted readiness evidence
- verifies the rehearsal execution preflight returned `ok=true`
- verifies safety flags show default funding enforcement, live LI.FI execution, backend broadcast, and live venue submission stayed disabled
- writes `artifacts/funding/route-enforcement-readiness-<route-or-lane-id>.json`
- writes `artifacts/funding/route-enforcement-readiness-<route-or-lane-id>.md`

If the lane id is ambiguous, especially anything that says `PREDICT` without `PREDICT_FUN`, set:

```bash
FUNDING_ROUTE_REQUIRED_VENUES=POLYMARKET,LIMITLESS
```

Use the exact venues required by the route. Do not treat Predict.fun as equivalent to PredictIt or any other Predict venue.

For multi-venue routes without a built-in artifact convention, provide the operator-approved route rehearsal artifact explicitly:

```bash
FUNDING_ROUTE_REHEARSAL_ARTIFACT_PATH=artifacts/funding/<approved-route-rehearsal>.json npm run funding:route-enforcement-ready -- <ROUTE_OR_LANE_ID>
```

`PASSED` only means the route is eligible for a sandbox-only enforcement decision. It does not enable enforcement, does not enable live LI.FI execution, does not broadcast transactions, and does not make the route production-ready.

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

### Funding Endpoints

```http
POST /funding/intents
```

Why call it:

Frontend calls this when the user starts non-custodial funding preparation.

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

Records the user-broadcast funding transaction hash after wallet signature. Backend v0 does not sign, broadcast, custody, or submit LI.FI execution on behalf of the user.

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
GET /funding/intents/:fundingIntentId/status
```

Why call it:

Frontend and operators need aggregate and per-leg status for split funding. Aggregate status is not enough.

```http
GET /funding/venue-balances
```

Why call it:

Shows the user's current venue-ready balances across venues. This is a derived capital view from persisted `READY_TO_TRADE` records and active withdrawal reservations; it is not a Lotus custodial or pooled balance.

Expected response:

```json
{
  "userId": "user-id",
  "balances": [
    {
      "venue": "POLYMARKET",
      "token": "USDC",
      "readyAmount": "500",
      "pendingWithdrawalAmount": "0",
      "availableAmount": "500"
    }
  ]
}
```

```http
GET /funding/reservations/:reservationId
```

Why call it:

Useful when RFQ accept fails or an execution is waiting on reservation/finalization.

### Withdrawal V0 Endpoints

Withdrawal v0 is a DB-backed non-custodial skeleton. It lets the frontend build the withdrawal screen and lets operators validate lifecycle state, but it does not call live venue withdrawal APIs, does not sign, does not broadcast, and does not custody funds.

```http
POST /funding/withdrawals
```

Why call it:

Creates a single-source or multi-source withdrawal intent from persisted venue-ready balances.

Example request:

```json
{
  "token": "USDC",
  "amount": "1000",
  "destinationChain": "POLYGON",
  "destinationWalletAddress": "0x1111111111111111111111111111111111111111",
  "idempotencyKey": "withdrawal-idempotency-key",
  "sources": [
    {
      "sourceVenue": "POLYMARKET",
      "sourcePercentage": 100
    }
  ]
}
```

```http
GET /funding/withdrawals/:withdrawalIntentId
POST /funding/withdrawals/:withdrawalIntentId/quote
POST /funding/withdrawals/:withdrawalIntentId/submit
GET /funding/withdrawals/:withdrawalIntentId/status
```

Rules:

- `quote` fails closed when a source venue has `supportsWithdrawal=false`, unknown capability, insufficient venue-ready balance, or invalid destination wallet.
- `submit` records a user-broadcast tx hash only. It does not broadcast or call a live venue withdrawal endpoint.
- Withdrawal route legs keep their own lifecycle state so multi-source withdrawal can be partially completed or partially failed.
- Withdrawal endpoints must not mutate funding readiness records directly.
- Withdrawal responses must not expose API keys, auth headers, private keys, raw provider payloads, or live venue internals.

```http
GET /user/withdrawal-wallets
PUT /user/withdrawal-wallets/evm
```

Why call it:

Predict.fun withdrawals currently require a user-controlled EVM-compatible receive wallet because the supported withdrawal target for this phase is BSC USDT. These endpoints let the frontend list and set the user's public EVM receive wallet metadata before creating a Predict.fun withdrawal intent.

Rules:

- Store only public wallet metadata: EVM address, chain family, label, verification timestamp, and created/updated timestamps.
- Do not store or request private keys, seed phrases, wallet auth tokens, Privy secrets, ZeroDev signer material, session cookies, or user JWTs.
- Scope reads and writes to the authenticated user.
- Frontend copy should say: "Add an EVM-compatible wallet to receive BSC USDT withdrawals."

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

- live venue withdrawal execution after venue-specific review
- venue-to-wallet confirmation flows
- production multi-venue withdrawal aggregation

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
- live withdrawal execution and venue-specific withdrawal adapters
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

### Withdrawal Sandbox Rehearsal

Before considering live withdrawal execution, operators can run a controlled withdrawal v0 rehearsal:

```bash
npm run funding:withdrawal-sandbox-rehearsal
```

This command:

- applies funding and withdrawal migrations idempotently
- creates one sandbox funding intent for a test user
- uses mocked LI.FI quote/status behavior, with no live LI.FI execution
- reconciles Polymarket venue readiness through the existing funding readiness checker
- persists one `READY_TO_TRADE` funding row
- starts an in-process authenticated funding API app
- calls `GET /funding/venue-balances`
- creates a withdrawal intent through `POST /funding/withdrawals`
- quotes the withdrawal route through `POST /funding/withdrawals/:id/quote`
- records a fake sandbox user tx hash through `POST /funding/withdrawals/:id/submit`
- reads `GET /funding/withdrawals/:id/status`
- verifies cross-user read blocking, insufficient balance blocking, duplicate source venue blocking, and withdrawal audit events
- writes `artifacts/funding/withdrawal-sandbox-rehearsal.json`
- writes `artifacts/funding/withdrawal-sandbox-rehearsal.md`
- leaves sandbox DB rows persisted for operator inspection

Expected successful artifact fields:

- `status=COMPLETED`
- `withdrawalStatus=WITHDRAWING`
- `routeLegStatus=VENUE_RELEASE_PENDING`
- `crossUserReadBlocked=true`
- `insufficientBalanceBlocked=true`
- `duplicateSourceVenueBlocked=true`
- `redactionVerified=true`
- `safety.liveLifiExecutionEnabled=false`
- `safety.liveVenueWithdrawalExecutionEnabled=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.backendSignedTransaction=false`
- `safety.custodyModel=MODEL_A_NON_CUSTODIAL`

Safety notes:

- this command does not move real funds
- this command does not call a live venue withdrawal API
- this command does not broadcast or sign a transaction
- this command does not enable funding preflight enforcement
- this command does not mutate production config
- the fake tx hash is only a lifecycle marker for sandbox API validation

### Withdrawal Completion Sandbox Rehearsal

Before any live withdrawal adapter work, operators must prove withdrawal completion can be reconciled from explicit evidence without custody, signing, broadcasting, or live venue mutation:

```bash
npm run funding:withdrawal-completion-sandbox-rehearsal
```

This command:

- applies funding and withdrawal migrations idempotently
- creates one sandbox funding intent and persists one `READY_TO_TRADE` funding row
- creates and submits one sandbox withdrawal intent with a fake user-broadcast tx hash
- injects mocked withdrawal completion evidence through `refreshWithdrawalStatus`
- persists `funding_withdrawal_reconciliation_records`
- verifies route status moves through venue release and destination receipt before completion
- writes `artifacts/funding/withdrawal-completion-sandbox-rehearsal.json`
- writes `artifacts/funding/withdrawal-completion-sandbox-rehearsal.md`

Expected successful artifact fields:

- `status=COMPLETED`
- `venueReleased=true`
- `destinationReceived=true`
- `completed=true`
- `withdrawalStatus=COMPLETED`
- `routeLegStatus=WITHDRAWAL_LEG_COMPLETED`
- `redactionVerified=true`
- `safety.liveLifiExecutionEnabled=false`
- `safety.liveVenueWithdrawalExecutionEnabled=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.backendSignedTransaction=false`
- `safety.custodyModel=MODEL_A_NON_CUSTODIAL`

Safety notes:

- this command uses mocked completion evidence only
- this command does not call real venue withdrawal APIs
- this command does not prove a production withdrawal adapter is safe
- live withdrawal adapter work still requires venue-specific security review, exact destination evidence, and operator approval

### First Real Withdrawal Evidence Adapter Design

The first real withdrawal evidence adapter should be `PolymarketWithdrawalEvidenceChecker`. It must be read-only and fail-closed. It is not a live withdrawal executor and must not call a venue withdrawal mutation endpoint.

The live withdrawal adapter design for v1 lives in `docs/runbooks/withdrawal-flow-v1-adapter-design.md`. That spec is the canonical boundary for future venue-specific live withdrawal adapter work. It preserves Model A non-custodial semantics and does not authorize backend signing, backend broadcasting, custody, or live venue mutation.

For Polymarket, the first Bridge adapter validation is operator-only and dry-run:

```bash
npm run funding:polymarket-bridge-withdrawal-dry-run
```

This command validates supported-assets parsing, quote preparation, user-action instructions, status parsing, evidence normalization, and redaction without wiring Polymarket Bridge into user withdrawal endpoints.

A real HTTP `COMPLETED` dry-run means Bridge prepare/read/status compatibility only. It does not prove completion because no real user transfer is sent. Completion evidence should remain not completed until a separate controlled transfer rehearsal is explicitly approved.

Polymarket Bridge sandbox wiring is disabled by default. When `POLYMARKET_BRIDGE_WITHDRAWALS_ENABLED=true`, `POLYMARKET_BRIDGE_DRY_RUN_ONLY=true`, and the adapter is configured, `POST /funding/withdrawals/:id/quote` may return frontend-safe `routePreview.polymarketBridge` metadata for a single-source Polymarket withdrawal. `GET /funding/withdrawals/:id/status` may refresh sanitized Bridge provider status for the recorded bridge address/reference. This wiring still does not sign, broadcast, move funds, call LI.FI execution, persist completion, or enable live withdrawal execution.

For Limitless, the first adapter validation is operator-only and dry-run/read-status:

```bash
npm run funding:limitless-sdk-auth-dry-run
npm run funding:limitless-withdrawal-dry-run
```

Limitless is not treated as a Polymarket Bridge clone. Official Limitless docs and team confirmation describe normal EOA/user-wallet payouts as native market-resolution settlement, not an explicit user-signed withdrawal API. Lotus models this as `withdrawalMode=AUTO_RESOLUTION_ONLY` and `userSignedWithdrawalSupported=false`.

Limitless `POST /portfolio/withdraw` is represented separately as disabled `PARTNER_MANAGED_BACKEND`: partner-only, backend-initiated, HMAC-authenticated, withdrawal-scope gated, and withdrawing managed server-wallet sub-account funds to the partner address. `POST /portfolio/redeem` is also backend-initiated for redeeming winning positions after resolution. The SDK auth dry-run should be used only to validate HMAC portfolio reads through the official SDK. The manual dry-run may read portfolio history/status only. Neither command may call `POST /portfolio/withdraw`, `POST /portfolio/redeem`, sign, broadcast, move funds, call LI.FI execution, persist completion, or enable live venue withdrawal execution.

Boundary decision: Limitless user mode is `AUTO_RESOLUTION_ONLY`, not `USER_AUTHORIZED_ACTION`. Partner-managed backend withdrawal must remain blocked from Lotus user endpoint wiring unless a future security/custody review explicitly approves Lotus-initiated server-wallet withdrawals or Limitless provides a documented user-authorized withdrawal flow.

Partner-managed Limitless withdrawal is not approved by capability config or read-only HMAC diagnostics. The explicit approval gate is:

```bash
npm run funding:limitless-partner-managed-withdrawal-gate
```

The gate is blocked by default and emits `artifacts/funding/limitless-partner-managed-withdrawal-gate.json` and `.md`. It requires `LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED=true`, `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE=LIMITLESS`, an approval id, a security/custody review id, an operator approver, and fresh approval timestamps. It does not call `POST /portfolio/withdraw`, does not call `POST /portfolio/redeem`, does not sign, does not broadcast, does not persist completion, and does not change the custody model.

User-facing withdrawal routes must remain unable to trigger Limitless `POST /portfolio/withdraw` or `POST /portfolio/redeem` even if read-only Limitless HMAC config is present. A static test enforces this boundary.

If the installed SDK `PortfolioFetcher.getUserHistory(1, 25)` sends a `page` query rejected by the live API, the SDK auth dry-run may fall back to the SDK `HttpClient.get('/portfolio/history?limit=25')` read. This remains an SDK-backed, HMAC-authenticated, read-only diagnostic.

For Limitless Programmatic API reads, use `LIMITLESS_WITHDRAWAL_ADAPTER_AUTH_MODE=HMAC` with the programmatic API key and base64 secret. If reading a managed wallet profile, set `LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID`; Lotus sends it as `x-on-behalf-of`. The dry-run still only reads status/history and never calls the live withdrawal endpoint.

If profile lookup is required for the SDK diagnostic, set:

```env
LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS=<profile wallet address>
```

If Limitless expects millisecond timestamps, set:

```env
LIMITLESS_WITHDRAWAL_ADAPTER_TIMESTAMP_FORMAT=UNIX_MS
```

Limitless account/sub-account readiness must be completed before continuing withdrawal validation. Operators must confirm:

- whether the Limitless account is normal, managed wallet, delegated, or sub-account
- the user-controlled EOA that owns or authorized the account
- whether a numeric `profileId` is required
- whether the Programmatic API token is authorized for that exact account/profile
- whether `x-on-behalf-of` is required and authorized
- that Lotus stores no user EOA private key, session cookie, or signing secret
- that the dry-run targets only history/status reads and not `POST /portfolio/withdraw`

This preserves Model A non-custodial semantics. A Limitless server-wallet API must not be treated as Lotus custody or user-authorized withdrawal execution until the account model is explicitly reviewed.

If Limitless changes the portfolio history/status request shape, use the dry-run-only diagnostics:

```env
LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_PATH=/portfolio/history
LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_QUERY=limit=25
```

Limitless portfolio history uses cursor pagination, so do not send `page=1`. Add `cursor=<value>` only when continuing a documented page. These controls must only target read/status endpoints. They must not point to `POST /portfolio/withdraw` or any other mutation path.

Expected successful Limitless dry-run fields:

- SDK auth dry-run: `status=COMPLETED`, `positionsRead=true`, `historyRead=true`, `redactionVerified=true`, and all live execution/signing/broadcast/persistence safety flags false.
- `status=COMPLETED`
- `quotePrepared=true`
- `userActionPrepared=true`
- `statusFetched=true`
- `evidenceNormalized=true`
- `redactionVerified=true`
- `safety.liveVenueWithdrawalEndpointCalled=false`
- `safety.completionPersisted=false`

Live Limitless withdrawal execution remains blocked until the dry-run artifact is reviewed and a separate venue-specific execution adapter gate explicitly approves scoped live withdrawal calls.

Predict.fun withdrawal design is separate from Limitless. Predict.fun is classified as `USER_WALLET_AUTHORIZED_ACTION_CANDIDATE` because its wallet model is based on Privy/ZeroDev user wallets, but Lotus must only prepare frontend-safe instructions. Backend private-key handling, ZeroDev server-side signing, Privy user impersonation, backend broadcasting, and live withdrawal mutation remain blocked until a dedicated Predict.fun adapter review validates the exact user-wallet action and evidence path.

Predict.fun has a disabled-by-default instruction dry-run:

```bash
npm run funding:opinion-withdrawal-dry-run
npm run funding:predictfun-withdrawal-dry-run
npm run funding:myriad-withdrawal-dry-run
```

The command emits `artifacts/funding/predictfun-withdrawal-dry-run.json` and `.md` with `status=COMPLETED`, `quotePrepared=true`, `userActionPrepared=true`, and `redactionVerified=true` when the safe instruction path is valid. It does not call Predict.fun, Privy, ZeroDev, a live withdrawal endpoint, LI.FI execution, or any venue mutation path. If explicitly enabled with `PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED=true`, `PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE=USER_WALLET_DRY_RUN`, and `PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY=true`, a single-source `PREDICT_FUN` withdrawal quote may include `routePreview.predictFunUserWallet` and sanitized `providerStatus` metadata only. Users still submit their own tx hash/reference through the existing submit endpoint after completing any wallet action outside Lotus.

`funding:opinion-withdrawal-dry-run` emits `artifacts/funding/opinion-withdrawal-dry-run.json` and `.md` for the first Opinion rail: BNB Smart Chain `USDT`. It does not call Opinion, does not sign as a Gnosis Safe owner, does not broadcast, and does not persist completion. If explicitly enabled with `OPINION_WITHDRAWAL_ADAPTER_ENABLED=true`, `OPINION_WITHDRAWAL_ADAPTER_MODE=USER_SAFE_DRY_RUN`, and `OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY=true`, a single-source `OPINION` withdrawal quote may include `routePreview.opinionSafeUserAction` and sanitized `providerStatus` metadata only.

`funding:myriad-withdrawal-dry-run` emits `artifacts/funding/myriad-withdrawal-dry-run.json` and `.md` for the first Myriad rail: BNB Smart Chain `USD1`. It does not call Myriad or ThirdWeb, does not sign, does not broadcast, and does not persist completion. If explicitly enabled with `MYRIAD_WITHDRAWAL_ADAPTER_ENABLED=true`, `MYRIAD_WITHDRAWAL_ADAPTER_MODE=USER_WALLET_DRY_RUN`, and `MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY=true`, a single-source `MYRIAD` withdrawal quote may include `routePreview.myriadUserWallet` and sanitized `providerStatus` metadata only. Abstract `USDC.e` is deferred to a later adapter pass.

To start a controlled user-transfer rehearsal, operators can run:

```bash
npm run funding:polymarket-bridge-user-transfer-rehearsal:start
```

This command only prepares an operator action artifact. It refuses to run unless `POLYMARKET_BRIDGE_USER_TRANSFER_REHEARSAL_ENABLED=true`, Polymarket Bridge config is complete, `POLYMARKET_BRIDGE_DRY_RUN_ONLY=true`, an operator-approved destination address is configured, and the rehearsal amount is within the configured maximum. Success writes `artifacts/funding/polymarket-bridge-user-transfer-rehearsal-start.json` and `.md` with `status=ACTION_REQUIRED`.

The Bridge service controls the action expiry. Lotus must not extend or fake the expiry locally. The rehearsal command records `usableTtlSeconds` and refuses actions below `POLYMARKET_BRIDGE_REHEARSAL_MIN_TTL_SECONDS` so operators do not act on an already stale instruction.

Safety notes:

- the command does not sign or broadcast
- the command does not persist completion
- the command does not call LI.FI execution
- the command does not enable live venue withdrawal execution
- the operator must manually verify the Bridge address, destination wallet, token, amount, and expiry before sending from the Polymarket wallet
- after the manual transfer, record the user-broadcast tx hash/reference through the existing withdrawal submit/status path and run evidence smoke/gate checks before any completion persistence

Adapter purpose:

- consume evidence for a withdrawal route leg that already has a user-broadcast tx hash
- prove whether funds have left the source venue
- prove whether funds reached the exact destination wallet, chain, token, and amount
- return a `WithdrawalCompletionEvidenceResult` to `refreshWithdrawalStatus`
- allow `refreshWithdrawalStatus` to persist reconciliation only after exact evidence checks pass

Required evidence contract from the operator-approved Polymarket read service:

```json
{
  "sourceVenue": "POLYMARKET",
  "withdrawalTxHash": "0x...",
  "status": "PENDING|VENUE_RELEASED|DESTINATION_RECEIVED|COMPLETED|FAILED|UNKNOWN",
  "venueReleased": true,
  "destinationReceived": true,
  "completed": true,
  "destinationChain": "POLYGON",
  "destinationWalletAddress": "0x1111111111111111111111111111111111111111",
  "token": "USDC",
  "amount": "40",
  "confirmations": 1,
  "observedAt": "2026-04-26T00:00:00.000Z",
  "reason": "POLYMARKET_WITHDRAWAL_DESTINATION_CONFIRMED"
}
```

Fields that must not be returned by the read service, logs, API responses, or artifacts:

- API keys
- auth headers
- private keys
- session cookies
- raw venue account internals
- raw provider payloads
- unsigned transaction internals
- backend signing material

Fail-closed mapping:

- missing checker or disabled mode -> no state change
- service unavailable, timeout, malformed JSON, missing fields, unsupported token, or unsupported chain -> `UNKNOWN` / retry required
- tx hash mismatch -> retry required
- user, withdrawal intent, or route-leg scope mismatch when returned by the read service -> retry required
- destination wallet mismatch -> retry required
- destination chain mismatch -> retry required
- token mismatch -> retry required
- observed amount below withdrawal route leg amount -> retry required
- venue released but destination not received -> `DESTINATION_PENDING`
- exact destination receipt but `completed=false` -> `DESTINATION_RECEIVED`
- exact venue release and exact destination receipt with `completed=true` -> `WITHDRAWAL_LEG_COMPLETED`

Implemented config names. Defaults must stay disabled:

```env
POLYMARKET_WITHDRAWAL_EVIDENCE_MODE=DISABLED
POLYMARKET_WITHDRAWAL_EVIDENCE_ENABLED=false
POLYMARKET_WITHDRAWAL_EVIDENCE_URL=
POLYMARKET_WITHDRAWAL_EVIDENCE_AUTH_MODE=NONE
POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY=
POLYMARKET_WITHDRAWAL_EVIDENCE_TIMEOUT_MS=5000
POLYMARKET_WITHDRAWAL_MIN_CONFIRMATIONS=1
```

Activation gates before any real adapter is allowed to persist completion:

- `npm run funding:withdrawal-sandbox-rehearsal` passes with a fresh `COMPLETED` artifact
- `npm run funding:withdrawal-completion-sandbox-rehearsal` passes with a fresh `COMPLETED` artifact
- the relevant read-only withdrawal evidence smoke command passes with a fresh artifact:
  - `npm run funding:polymarket-withdrawal-evidence-smoke`
  - `npm run funding:limitless-withdrawal-evidence-smoke`
  - `npm run funding:opinion-withdrawal-evidence-smoke`
  - `npm run funding:myriad-withdrawal-evidence-smoke`
  - `npm run funding:predictfun-withdrawal-evidence-smoke`
- the operator-approved Polymarket evidence read service is documented and reviewed
- the read service returns normalized fields only, not raw provider internals
- adapter tests prove malformed/unavailable/mismatched evidence fails closed
- adapter tests prove exact venue release plus exact destination receipt is the only path to `WITHDRAWAL_LEG_COMPLETED`
- OpenAPI and admin docs are updated only if user/admin response shapes change

This adapter design still does not make live withdrawals available. It only proves completion for user-broadcast withdrawals through read-only evidence.

### Multi-Venue Withdrawal Evidence Smoke Tests

Withdrawal evidence smoke commands are read-only. They call the operator-approved evidence read service, map the normalized response, verify redaction, write `artifacts/funding/<venue>-withdrawal-evidence-smoke-test.json`, and do not persist `funding_withdrawal_reconciliation_records`.

Run the generic command for any supported venue:

```bash
npm run funding:withdrawal-evidence-smoke -- POLYMARKET
npm run funding:withdrawal-evidence-smoke -- LIMITLESS
npm run funding:withdrawal-evidence-smoke -- OPINION
npm run funding:withdrawal-evidence-smoke -- MYRIAD
npm run funding:withdrawal-evidence-smoke -- PREDICT_FUN
```

Convenience aliases:

```bash
npm run funding:polymarket-withdrawal-evidence-smoke
npm run funding:limitless-withdrawal-evidence-smoke
npm run funding:opinion-withdrawal-evidence-smoke
npm run funding:myriad-withdrawal-evidence-smoke
npm run funding:predictfun-withdrawal-evidence-smoke
```

Per-venue config follows the same pattern:

```env
FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_GATE_ENABLED=true
FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=false
FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES=
FUNDING_WITHDRAWAL_COMPLETION_SMOKE_MAX_AGE_HOURS=24
FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS=
<VENUE>_WITHDRAWAL_EVIDENCE_MODE=DISABLED
<VENUE>_WITHDRAWAL_EVIDENCE_ENABLED=false
<VENUE>_WITHDRAWAL_EVIDENCE_URL=
<VENUE>_WITHDRAWAL_EVIDENCE_AUTH_MODE=NONE
<VENUE>_WITHDRAWAL_EVIDENCE_API_KEY=
<VENUE>_WITHDRAWAL_EVIDENCE_TIMEOUT_MS=5000
<VENUE>_WITHDRAWAL_MIN_CONFIRMATIONS=1
<VENUE>_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS=
<VENUE>_WITHDRAWAL_EVIDENCE_SMOKE_ARTIFACT_PATH=
<VENUE>_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=false
```

Use uppercase venue prefixes: `POLYMARKET`, `LIMITLESS`, `OPINION`, `MYRIAD`, and `PREDICT_FUN`.

For local smoke testing, Lotus can serve the normalized evidence contract through a disabled-by-default internal route:

```text
GET /internal/funding/:venue/withdrawal-evidence
```

Local operator fixture env:

```env
<VENUE>_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED=false
<VENUE>_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE=FIXTURE
<VENUE>_INTERNAL_WITHDRAWAL_EVIDENCE_FIXTURE_PATH=
```

When enabled locally, this route reads a sanitized operator fixture file and returns only the normalized evidence contract. It does not call a live venue withdrawal API, does not sign, does not broadcast, does not move funds, and does not persist completion. Keep it disabled unless running a controlled smoke test.

Predict.fun supports a fail-closed BSC USDT on-chain read mode for replacing fixture-backed proof during user-wallet withdrawal validation:

```env
PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED=true
PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE=BSC_ONCHAIN
PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL=https://...
PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955
PREDICT_FUN_WITHDRAWAL_MIN_CONFIRMATIONS=1
```

This mode reads BSC transaction receipts and verifies a USDT `Transfer` log against the submitted tx hash, destination wallet, `BSC` chain, `USDT` token, expected amount, and confirmation policy. Wrong wallet, wrong token, wrong chain, insufficient amount, missing receipt, failed transaction, malformed RPC response, or unavailable RPC must fail closed.

For a controlled real Predict.fun rehearsal, seed the submitted row after the user/operator has already completed the Predict.fun/Privy/ZeroDev wallet action:

```bash
FUNDING_WITHDRAWAL_EVIDENCE_SEED_WITHDRAWAL_TX_HASH=0x...
FUNDING_WITHDRAWAL_EVIDENCE_SEED_AMOUNT=2.99
FUNDING_WITHDRAWAL_EVIDENCE_SEED_TOKEN=USDT
FUNDING_WITHDRAWAL_EVIDENCE_SEED_DESTINATION_CHAIN=BSC
FUNDING_WITHDRAWAL_EVIDENCE_SEED_DESTINATION_ADDRESS=0x...
npm run funding:seed-withdrawal-evidence-smoke -- PREDICT_FUN
npm run funding:predictfun-withdrawal-evidence-smoke
npm run funding:predictfun-withdrawal-completion-gate
```

The smoke artifact must be `COMPLETED`, non-synthetic, redacted, read-only, backed by an operator-approved evidence host, and show `persistedCompletionResult=false` before any controlled persistence test is considered. Completion persistence remains disabled by default and must be explicitly scoped to `PREDICT_FUN` for a one-venue controlled test.

After the smoke and completion gate pass, operators can run the Predict.fun production-readiness report:

```bash
npm run funding:predictfun-withdrawal-prod-readiness
```

This report writes:

- `artifacts/funding/predict-fun-withdrawal-prod-readiness.json`
- `artifacts/funding/predict-fun-withdrawal-prod-readiness.md`

It is read-only. It requires the latest Predict.fun smoke artifact to be fresh, non-synthetic, exact BSC USDT, redacted, read-only, unchanged in reconciliation count, and backed by an operator-approved evidence host. It also requires the Predict.fun completion gate artifact to be `PASSED`. If a controlled persistence artifact exists, it must be scoped to `PREDICT_FUN` only.

Polymarket also supports a fail-closed on-chain read mode for replacing the local fixture during Bridge transfer validation:

```env
POLYMARKET_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED=true
POLYMARKET_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE=POLYGON_ONCHAIN
POLYMARKET_INTERNAL_WITHDRAWAL_EVIDENCE_POLYGON_RPC_URL=https://...
POLYMARKET_INTERNAL_WITHDRAWAL_EVIDENCE_BRIDGE_STATUS_BASE_URL=https://bridge.polymarket.com
POLYMARKET_INTERNAL_WITHDRAWAL_EVIDENCE_USDC_ADDRESS=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
```

This mode reads Polygon transaction receipts and the Polymarket Bridge status endpoint for the observed Bridge address. It can prove venue-release/source-transfer evidence, but it must not mark withdrawal completion by itself. A Bridge `COMPLETED` status without exact destination wallet evidence is treated as destination-scope-unverified and still cannot persist completion. `COMPLETED` persistence requires explicit destination receipt evidence that matches the expected wallet, chain, token, amount, withdrawal intent, and route leg.

Late or expired Polymarket Bridge transfers may be recovered by the Bridge provider as an aggregate completion that includes multiple sends to the same Bridge address. Lotus treats that as a recovery-review case, not as normal completion evidence. The evidence checker should return `UNKNOWN` with `recoveryReviewRequired=true`, `bridgeStatus=COMPLETED`, and the aggregate `bridgeAmount` when Bridge status shows completion but cannot prove the exact destination wallet and exact per-withdrawal amount. Operators may use this to investigate recovered funds, but `refreshWithdrawalStatus` must not persist `WITHDRAWAL_LEG_COMPLETED` from aggregate Bridge evidence.

Operators can generate a read-only recovery proposal from the latest Polymarket withdrawal evidence smoke artifact:

```bash
npm run funding:polymarket-bridge-withdrawal-recovery-review
```

The command reads `artifacts/funding/polymarket-withdrawal-evidence-smoke-test.json`, finds submitted Polymarket withdrawal rows for the same destination wallet and review window, compares their expected total to the aggregate Bridge amount, and writes:

- `artifacts/funding/polymarket-bridge-withdrawal-recovery-review.json`
- `artifacts/funding/polymarket-bridge-withdrawal-recovery-review.md`

This is an operator review artifact only. It does not approve completion, does not persist reconciliation records, does not sign, does not broadcast, and does not move funds. A separate future approval command must require explicit operator input and should remain disabled until this report can produce an exact aggregate match with no already-completed candidate ambiguity.

Expected smoke artifact safety fields:

- `status=COMPLETED`
- `readOnly=true`
- `persistedCompletionResult=false`
- `redactionVerified=true`
- `safety.liveVenueWithdrawalExecutionEnabled=false`
- `safety.backendBroadcastedTransaction=false`
- `safety.backendSignedTransaction=false`
- `safety.custodyModel=MODEL_A_NON_CUSTODIAL`

If a submitted withdrawal route leg exists for the venue, the smoke command must show unchanged reconciliation counts before and after the read. If no submitted withdrawal route leg exists for a venue, the command uses synthetic sandbox identifiers and should fail closed rather than reporting completion. Synthetic-row smoke results are useful for validating read-service shape, parser behavior, redaction, and fail-closed behavior, but they are not enough to approve persistence for real withdrawals.

Before a venue-specific evidence checker is allowed to persist real withdrawal completion, operators must have a fresh DB-backed smoke artifact for that venue with a real submitted withdrawal route leg, exact evidence, `persistedCompletionResult=false`, unchanged reconciliation counts, and manual review approval.

The runtime persistence gate is enabled by default with `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_GATE_ENABLED=true`, but live completion persistence itself stays disabled by default with `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=false`. Passing smoke gates is necessary but not sufficient. To persist completion for a controlled venue, operators must explicitly set both:

- `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=true`
- either `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES=<VENUE>` or `<VENUE>_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=true`

When the checker attempts to persist `WITHDRAWAL_LEG_COMPLETED`, the gate refuses persistence unless runtime persistence is explicitly enabled for that venue and the latest venue smoke artifact is:

- `status=COMPLETED`
- `mappingObserved=COMPLETED`
- `readOnly=true`
- `persistedCompletionResult=false`
- `redactionVerified=true`
- non-synthetic: `selectedWithdrawal.synthetic=false`
- unchanged reconciliation counts before and after the smoke
- generated within `FUNDING_WITHDRAWAL_COMPLETION_SMOKE_MAX_AGE_HOURS`
- produced by `LIVE_READ`
- produced by a host listed in `<VENUE>_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` or `FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS`

Operators can validate the same gate explicitly before enabling persistence:

```bash
npm run funding:withdrawal-completion-gate -- POLYMARKET
npm run funding:polymarket-withdrawal-completion-gate
npm run funding:limitless-withdrawal-completion-gate
npm run funding:opinion-withdrawal-completion-gate
npm run funding:myriad-withdrawal-completion-gate
npm run funding:predictfun-withdrawal-completion-gate
```

To inspect every venue in one operator-safe report before broader rollout, run:

```bash
npm run funding:withdrawal-completion-gate-summary
npm run funding:withdrawal-rollout-status
```

The summary writes:

```text
artifacts/funding/all-venue-withdrawal-completion-gate-summary.json
artifacts/funding/all-venue-withdrawal-completion-gate-summary.md
artifacts/funding/withdrawal-rollout-status.json
artifacts/funding/withdrawal-rollout-status.md
```

This summary is read-only. It does not enable persistence, call LI.FI execution, call venue withdrawal execution, sign, or broadcast. Broader rollout should not proceed unless every venue row is `PASSED`, fresh, redacted, non-synthetic, and backed by an operator-approved evidence host.

`funding:withdrawal-rollout-status` is also read-only and does not call evidence services, venue APIs, LI.FI, or the database. It records the current operator classification:

- Polymarket: Bridge user-transfer validated; recovery-review edge case exists; not broad live execution.
- Predict.fun: user-wallet BSC USDT path validated; requires EVM receive wallet; production-readiness gate required.
- Limitless: EOA/user mode is `AUTO_RESOLUTION_ONLY`; partner-managed backend withdrawal is disabled and blocked pending custody/security/operator approval.
- Opinion: classified as `USER_SAFE_AUTHORIZED_ACTION_CANDIDATE`; requires `OpinionSafeWithdrawalAdapter` design, user-signed Gnosis Safe rehearsal, and exact completion evidence before any rollout.
- Myriad: classified as `USER_WALLET_AUTHORIZED_ACTION_CANDIDATE`; requires `MyriadWalletWithdrawalAdapter` design, user-wallet rehearsal, and exact USD1/USDC.e completion evidence before any rollout.

The validator writes:

```text
artifacts/funding/<venue>-withdrawal-completion-persistence-gate.json
artifacts/funding/<venue>-withdrawal-completion-persistence-gate.md
```

If this gate fails, `refreshWithdrawalStatus` must not persist `completed=true` for that venue even if the evidence checker returns `COMPLETED`.

If this gate passes but runtime persistence is still disabled for the venue, `refreshWithdrawalStatus` must still refuse to persist `completed=true`. This is intentional: operators can validate readiness gates without turning on live completion persistence.

To create a DB-backed submitted withdrawal route leg for a venue-specific evidence smoke test, run:

```bash
npm run funding:seed-withdrawal-evidence-smoke -- LIMITLESS
npm run funding:seed-limitless-withdrawal-evidence-smoke
```

For controlled real-transfer rehearsals, the seed command can record an operator-provided user-broadcast reference without signing or broadcasting:

```bash
FUNDING_WITHDRAWAL_EVIDENCE_SEED_WITHDRAWAL_TX_HASH=0x...
FUNDING_WITHDRAWAL_EVIDENCE_SEED_AMOUNT=1
FUNDING_WITHDRAWAL_EVIDENCE_SEED_DESTINATION_CHAIN=POLYGON
FUNDING_WITHDRAWAL_EVIDENCE_SEED_DESTINATION_ADDRESS=0x...
npm run funding:seed-withdrawal-evidence-smoke -- POLYMARKET
```

Use these overrides only after a manual user/operator transfer has already been sent. The seed still creates records only; it does not call live withdrawal execution, sign, broadcast, or persist completion evidence.

The seed command:

- applies funding and withdrawal migrations idempotently
- creates sandbox venue-ready funding through the funding service
- creates a withdrawal intent through the withdrawal service
- quotes and submits a fake sandbox user-broadcast tx hash
- leaves the withdrawal leg in `VENUE_RELEASE_PENDING`
- writes `artifacts/funding/<venue>-withdrawal-evidence-smoke-row-seed.json`
- does not call the withdrawal evidence checker
- does not persist withdrawal completion evidence
- does not sign, broadcast, custody, or call live venue withdrawal execution

After seeding, rerun the venue smoke command. If the smoke artifact still maps to `UNKNOWN`, `FAILED`, or any non-completed status, do not enable persistence for that venue. Persistence is only eligible for a later controlled pass when the read-only smoke maps exact venue-release and destination-receipt evidence to completion while preserving `persistedCompletionResult=false` and unchanged reconciliation counts.

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
