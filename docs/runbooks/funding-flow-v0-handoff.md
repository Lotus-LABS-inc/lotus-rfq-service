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

In plain terms:

1. A user chooses a source wallet, source chain, source token, and amount.
2. Lotus creates a funding intent.
3. Lotus checks which venues need funding and what each venue accepts.
4. Lotus plans the route, including direct transfer, swap, bridge, or split funding.
5. Lotus uses a route provider such as LiFi to produce route quotes and transaction payloads.
6. Lotus tracks every route leg.
7. Lotus confirms destination receipt.
8. Lotus confirms venue credit.
9. Lotus marks funds `READY_TO_TRADE` only after venue readiness is confirmed.
10. Execution preflight can then allow trades that require that venue balance.

Funding does not execute trades. Funding only prepares usable venue capital.

## 3. Core Architecture

The full funding architecture is:

```text
Funding intent
-> venue capability matrix
-> funding route planner
-> route legs
-> LiFi bridge/swap execution
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

A LiFi transaction hash is not enough.

A bridge-complete status is not enough.

Only venue-ready confirmation is enough.

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

The exact token and chain must come from the venue capability matrix, not hardcoded assumptions.

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

Represents what a venue can accept.

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

The capability matrix is the source of truth for target chain/token selection.

Known examples from the architecture flow:

- Polymarket: venue-compatible USDC, commonly represented as `USDC.e` in the current diagram
- Limitless: `USDC` / `ETH`
- Myriad: `SOL` / `ETH`
- Opinion, Predict.fun, and future venues: confirm through venue capability config before routing

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

## 9. LiFi Role

LiFi is the first route provider for Funding v0.

Primary docs:

- LiFi MCP server overview: https://docs.li.fi/mcp-server/overview
- LiFi introduction: https://docs.li.fi/introduction/introduction
- LiFi API reference: https://docs.li.fi/api-reference/introduction
- LiFi SDK overview: https://docs.li.fi/sdk/overview

LiFi should handle:

- route quote
- bridge/swap plan
- transaction payload
- route status where available

Lotus should wrap LiFi with its own planner.

Lotus remains responsible for:

- venue capability lookup
- route validation
- status normalization
- per-leg lifecycle
- destination confirmation
- venue-ready confirmation
- audit trail
- frontend-safe messaging
- execution preflight integration

LiFi is a route provider, not the entire funding product.

Do not let LiFi status become the final source of truth for trade readiness. LiFi can say a route completed, but Lotus still needs destination and venue-credit confirmation.

### LiFi Integration Boundary

The Lotus wrapper around LiFi should own the product contract. Do not let UI, RFQ, execution, or venue adapters call LiFi directly.

Suggested internal services:

- `LifiRouteQuoteService`
- `LifiRouteExecutionService`
- `LifiRouteStatusService`
- `FundingRoutePlanner`

LiFi-facing inputs should come from Lotus objects:

- `FundingIntent`
- `FundingTarget`
- `VenueCapability`
- `FundingRouteLeg`

LiFi-facing outputs should be normalized before storage or API response:

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

### LiFi Status Is Not Venue Readiness

The route lifecycle has three separate confirmations:

1. LiFi route status says the bridge/swap route moved forward.
2. Destination confirmation says funds arrived on the target chain/address.
3. Venue adapter says funds are credited and `READY_TO_TRADE`.

Only step 3 can unblock trade execution.

If LiFi reports success but the venue adapter cannot confirm venue credit, the funding leg must remain `LEG_VENUE_CREDIT_PENDING` and execution preflight must block that venue.

### LiFi MCP Server Usage

The LiFi MCP server can be useful for developer research, route inspection, and implementation support, but it should not become a hidden production dependency unless explicitly designed and reviewed.

Default implementation posture:

- backend runtime should use the LiFi API or SDK through a Lotus wrapper
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

Execution preflight should check:

- Does the user have enough `READY_TO_TRADE` balance on the required venue?
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
- unknown venue capability states
- aggregate balance that does not exist on the venue required by the route

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

Quotes the funding route before the user signs anything. This should use the venue capability matrix and LiFi wrapper to produce route previews.

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

Submits the user-approved funding route after wallet signature. This is where LiFi transaction payloads are used. In early v0 this can remain sandbox/stubbed until live routing is reviewed.

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
  "unifiedDisplayBalance": [
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

If venue capability is unknown:

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
- route provider: LiFi
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

- position abstraction and unified balance integrations

First implementation should start with:

- domain types
- venue capability matrix
- LiFi quote wrapper
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
- Do not treat LiFi as the whole product. LiFi is only the route provider.

## 18. Security Rules Before Build

Funding moves user capital, so its first implementation must be security-shaped even if it starts with one route leg.

Required rules:

- Do not let the frontend, RFQ flow, execution flow, or venue adapter call LiFi directly.
- Do not treat a LiFi quote as trusted after it becomes stale.
- Do not treat a LiFi route status as venue readiness.
- Do not route to a destination chain, token, or address unless it matches the venue capability matrix.
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

## 19. Decisions Needed Before Build

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

## 20. Questions That Can Wait

- How much of LiFi route status can be trusted directly beyond the first route?
- What frontend screens already exist for deposit status?
- How should failed split legs be retried?
- What user copy should be shown for partial readiness?
- What withdrawal flow should be supported first?
- What rebalancing policy should Lotus eventually use between venues?
- When should funding-scope tokens become mandatory?
- How should funding route risk scores be surfaced to users and operators?
