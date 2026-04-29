# Lotus Monetization Architecture

Status: private beta draft  
Audience: operators, backend engineers, product  
Last updated: 2026-04-29

## Private Beta Decision

Private beta does not ship smart fee router capture, settlement cuts, user balance deduction, custody, backend wallet movement for fees, LP/MM quote-netting, or fake captured improvement for venue-only routes.

Private beta revenue is split into:

- Collected revenue: Polymarket V2 builder fees where `POLYMARKET_BUILDER_CODE` is attached and matched/settled venue evidence confirms the builder fee amount or rate.
- Shadow opportunity: target Lotus price-improvement share on venue-only routes, labeled `SHADOW_ONLY` and not counted as collected revenue.
- Future tracks: smart fee router, LP/MM netting, invoice-first partner settlement, and later capture systems after security review.

Operator-visible labels:

- Builder collected: `Lotus builder fee collected by venue where supported.`
- Shadow only: `Estimated Lotus improvement share, not collected.`

Capture modes:

- `DISABLED`
- `SHADOW`
- `BUILDER_FEE_ONLY`
- `SHADOW_PLUS_BUILDER_FEE`
- `SMART_FEE_ROUTER_PLANNED`

Revenue source labels:

- `POLYMARKET_BUILDER_FEE`
- `VENUE_BUILDER_FEE`
- `SHADOW_PRICE_IMPROVEMENT`
- `MANUAL_INVOICE_PLANNED`
- `SMART_FEE_ROUTER_PLANNED`

## 1. Goal

Lotus should monetize execution without weakening the safety model.

The core rule is:

```text
quote fees early
reserve/authorize fees before submission
finalize fees only after settlement/finality
never account revenue from ghost fills, failed executions, or unverified venue states
```

Monetization must plug into the existing RFQ, SOR, execution, settlement, accounting, and receipt flow. It must not become a separate path that can bypass funding readiness, operator-approved lanes, execution-scope tokens, or settlement verification.

## 2. Current Repo State

Existing hooks:

- `src/execution-system/fees.ts` previews and realizes execution fees.
- `src/execution-system/accounting.ts` builds post-settlement accounting records.
- `src/execution-system/types.ts` includes fee summaries and receipts.
- RFQ accept/status already carries execution metadata and receipt fields.

Current gap:

- Fee hooks are not production enforcement.
- There is no persistent revenue ledger.
- There is no policy/version layer for fee rules.
- There is no settlement-safe charge/capture lifecycle.
- There is no operator report for gross revenue, rebates, refunds, or failed-charge exposure.

## 3. Monetization Models

Lotus should support four fee types, each separately toggleable.

### Price Improvement Share

Lotus shares in user price improvement versus the quoted expected price.

```text
expected execution cost - realized execution cost = improvement
lotus fee = improvement * share_bps
```

Use when Lotus routes better than a baseline venue or route.

Safety:

- Never charge if realized execution is worse than expected.
- Must be calculated from settled fills, not submitted orders.
- Must be disclosed in quote preview.

### Explicit Execution Fee

A direct fee in bps or fixed units on filled notional.

```text
filled_notional * execution_fee_bps / 10_000
```

Use when Lotus acts as an execution service.

Safety:

- Must be capped.
- Must be shown before user acceptance.
- Must be charged only on filled and settlement-verified size.

### Feature Fees

Optional fixed or bps fees for premium execution features:

- fast lane
- ghost-fill protection
- future settlement protection
- cross-venue route optimization

Safety:

- Feature must be enabled in the accepted RFQ.
- Feature fee must be included in quote preview.
- If a feature fails closed before execution, do not charge it.

### Venue/Provider Fee Pass-Through

External venue, bridge, gas, route-provider, or withdrawal fees.

Safety:

- Treat as pass-through, not Lotus revenue.
- Show separately from Lotus fees.
- Do not mix venue fees with Lotus revenue accounting.

## 4. Fee Lifecycle

### Preview

Runs during RFQ/quote construction.

Output:

```json
{
  "lotusFeePreview": {
    "policyVersion": "lotus-fees-v1",
    "priceImprovementShareBps": 1000,
    "executionFeeBps": 0,
    "featureFees": {},
    "estimatedLotusFee": "0.00",
    "estimatedPassThroughFees": "0.00",
    "maxFee": "0.00"
  }
}
```

Preview is not revenue.

### Authorization

Runs when the RFQ is accepted.

The accepted quote must bind:

- `feePolicyVersion`
- `maxLotusFee`
- `maxPassThroughFee`
- `feeCurrency`
- `feeDisclosureHash`
- `executionScopeToken`
- `idempotencyKey`

Authorization is not revenue.

### Reservation

Runs before venue submission.

The system checks that fee payment is possible through one of:

- deducted from received proceeds
- included in execution settlement accounting
- charged via external billing account
- waived for sandbox/internal lanes

Reservation is not revenue.

### Realization

Runs after fills and settlement verification.

Inputs:

- accepted fee policy
- expected price
- settlement-verified fill price
- settlement-verified fill size
- pass-through venue fees
- feature flags actually active

Output:

```json
{
  "lotusFees": {
    "priceImprovementFee": "0.00",
    "executionFee": "0.00",
    "featureFees": "0.00",
    "totalLotusFee": "0.00"
  },
  "passThroughFees": {
    "venueFees": "0.00",
    "gasFees": "0.00",
    "bridgeFees": "0.00",
    "totalPassThroughFee": "0.00"
  }
}
```

Realized fees become chargeable only after settlement/finality.

### Capture

Capture is the actual revenue event.

It must be idempotent by:

- execution id
- settlement id
- fee policy version
- fee line id

Capture can be:

- internal ledger entry
- invoice entry
- settlement deduction
- partner revenue share entry

### Refund/Reversal

If settlement later proves invalid, ghost-fill confirmed, or reconciliation finds an overcharge:

- create reversal rows
- never mutate/delete original rows
- emit operator alert
- expose user-safe refund status

## 5. Ledger Model

Recommended tables:

### `fee_policies`

Stores versioned fee rules.

Fields:

- `id`
- `version`
- `enabled`
- `scope_kind`: global, venue, lane, user, partner
- `scope_id`
- `price_improvement_share_bps`
- `execution_fee_bps`
- `fixed_execution_fee`
- `feature_fee_config`
- `max_fee_bps`
- `currency`
- `effective_from`
- `effective_to`
- `created_by`
- `created_at`

### `execution_fee_authorizations`

Records the fee terms accepted by the user/RFQ.

Fields:

- `id`
- `rfq_id`
- `execution_id`
- `user_id`
- `fee_policy_version`
- `fee_disclosure_hash`
- `max_lotus_fee`
- `max_pass_through_fee`
- `currency`
- `accepted_at`
- `idempotency_key`

### `execution_fee_ledger`

Append-only fee accounting.

Fields:

- `id`
- `execution_id`
- `user_id`
- `venue`
- `lane_id`
- `fee_policy_version`
- `fee_type`
- `amount`
- `currency`
- `status`: previewed, authorized, realized, captured, waived, refunded, reversed
- `settlement_status`
- `source_event_id`
- `idempotency_key`
- `created_at`

### `revenue_share_ledger`

Tracks partner/operator splits.

Fields:

- `id`
- `execution_fee_ledger_id`
- `recipient_type`
- `recipient_id`
- `amount`
- `currency`
- `status`
- `created_at`

## 6. Runtime Placement

```text
RFQ create
-> fee preview
-> quote returned to user
-> RFQ accept
-> fee authorization persisted
-> execution preflight
-> fee reservation check
-> venue submit
-> settlement verification
-> fee realization
-> accounting update
-> fee capture
-> receipt
```

Receipt must show:

- total filled size
- average filled price
- pass-through fees
- Lotus fees
- total paid/received
- fee policy version

Receipt must not expose:

- API keys
- venue secrets
- private wallet metadata
- internal margin policy
- operator-only risk scores

## 7. Enforcement Rules

Fail closed if:

- no fee policy applies and monetization enforcement is required
- accepted fee policy version no longer matches execution policy
- fee exceeds accepted max fee
- settlement is not verified
- ghost-fill status is suspected or confirmed
- execution is partial and policy does not define partial-fill charging
- fee capture idempotency key already exists with different amount

Do not block sandbox if:

- `MONETIZATION_MODE=SHADOW`
- policy says fees are preview-only
- operator explicitly marks the lane fee-waived

## 8. Config

Recommended envs:

```env
MONETIZATION_MODE=DISABLED|SHADOW|ENFORCED
MONETIZATION_POLICY_VERSION=lotus-fees-v1
MONETIZATION_DEFAULT_CURRENCY=USDC
MONETIZATION_PRICE_IMPROVEMENT_SHARE_BPS=1000
MONETIZATION_EXECUTION_FEE_BPS=0
MONETIZATION_MAX_TOTAL_FEE_BPS=100
MONETIZATION_CAPTURE_MODE=DISABLED|SHADOW|BUILDER_FEE_ONLY|SHADOW_PLUS_BUILDER_FEE|SMART_FEE_ROUTER_PLANNED
MONETIZATION_RECEIPTS_ENABLED=true
MONETIZATION_OPERATOR_REPORTS_ENABLED=true
```

Initial production recommendation:

```env
MONETIZATION_MODE=SHADOW
MONETIZATION_CAPTURE_MODE=SHADOW_PLUS_BUILDER_FEE
```

Private beta should collect only evidence-confirmed venue-native builder fees and report price-improvement share as uncollected shadow opportunity.

## 9. Rollout Plan

### Phase 1: Shadow Ledger

- Add fee policy config/parser.
- Add fee authorization and fee ledger tables.
- Persist fee preview at RFQ creation/quote time.
- Persist accepted fee authorization at RFQ accept.
- Generate operator revenue reports.
- Do not charge.

### Phase 2: Settlement-Safe Realization

- Calculate realized fees only from settlement-verified fills.
- Add partial-fill rules.
- Add refund/reversal rows.
- Add receipt fee breakdown.
- Add tests for ghost-fill and failed execution no-charge behavior.

### Phase 3: Controlled Capture

- Enable `LEDGER_ONLY` capture for sandbox/limited-prod.
- Add idempotency and reconciliation reports.
- Add admin endpoint to review fee ledger.
- Add manual waive/refund controls.

### Phase 4: Production Capture

- Choose capture mode:
  - invoice
  - settlement deduction
  - partner account debit
- Add user-facing receipt polish.
- Add daily revenue close report.
- Add partner revenue-share settlement report.

## 10. Immediate Next Build

The next backend change should be narrow:

1. Add `monetization` policy types.
2. Add env parser with `DISABLED` default.
3. Add shadow fee ledger schema/migration.
4. Extend `ExecutionFeeService` to return policy version and fee lines.
5. Persist fee authorization on RFQ accept.
6. Add report script:

```text
npm run report:monetization:shadow
```

Do not implement live capture in the first pass.
