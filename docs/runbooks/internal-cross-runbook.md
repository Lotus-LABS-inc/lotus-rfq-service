# Internal Cross Runbook

## Purpose
This runbook covers Phase 1 internal crossing operations for single-leg prediction market crosses.

Postgres is authoritative.
Redis is a live book snapshot only.

## Inspect A Crossed Trade
Use:

```bash
GET /admin/internal-cross/trade/:id
```

Expected output:
- trade record
- buyer order state
- seller order state
- exposure journal references
- Redis book presence for both orders

Fail-closed behavior:
- If either side of the trade is not present in `internal_orders`, the endpoint returns `500 INTERNAL_AMBIGUITY`.
- In that case, use reconciliation instead of relying on trade inspection output.

## Inspect An Internally Matched Order
Use:

```bash
GET /admin/internal-cross/order/:id
```

Expected output:
- Postgres order state
- remaining size
- Redis live-book presence
- related trades
- related exposure state

Use this endpoint when an operator needs source-of-truth order status with Redis snapshot context.

## Verify Redis Book vs Postgres Truth
Rules:
- Postgres `internal_orders` is authoritative.
- Redis `book:order:{id}` and `book:{market}:{side}` are live snapshots only.

Verification steps:
1. Load the order from `GET /admin/internal-cross/order/:id`.
2. Compare `status` and `remaining_size` to Redis presence.
3. Treat these conditions as discrepancies:
   - Postgres `FILLED` or `CANCELLED` but Redis still present
   - Postgres `OPEN` or `PARTIAL` but Redis missing
   - Redis payload malformed or market/side mismatched

## Remove Stale Redis Entries Safely
Use:

```bash
POST /admin/internal-cross/order/:id/remove-from-book
```

Requirements:
- ADMIN role
- 2FA token

Behavior:
- removes the Redis book snapshot only
- does not mutate `internal_orders`
- records a structured admin event
- returns a warning if Postgres still says `OPEN`

Operator rule:
- if Postgres still says `OPEN`, do not treat removal as a final fix
- verify whether the order should be rebuilt onto Redis after root-cause analysis

## Run Trade Reconciliation
Use:

```bash
POST /admin/internal-cross/trade/:id/reconcile
```

Request fields:
- `dryRun`
- `force`
- `twoFactorToken`

Phase 1 behavior:
- reconciliation returns a structured discrepancy report
- no auto-fix is performed in this phase, including when `force=true`

Discrepancies checked:
- missing buyer/seller order rows
- market mismatch between trade and order
- missing or incomplete exposure journal references
- Redis presence inconsistent with Postgres state

## Handle Failed Or Partially Corrupted Internal Crosses
Typical indicators:
- trade inspection returns `INTERNAL_AMBIGUITY`
- missing exposure journal entries
- Redis still shows a terminal order
- trade exists but one side is not represented in `internal_orders`

Operator flow:
1. Run trade reconciliation.
2. Inspect related order states.
3. Verify exposure journal rows tied to the trade id.
4. If Redis is stale, remove stale entries only.
5. If unwind is required, create a force-unwind task.

## Trigger Force-Unwind Workflow
Use:

```bash
POST /admin/internal-cross/trade/:id/force-unwind
```

Requirements:
- ADMIN role
- 2FA token

Behavior:
- creates an unwind task record only
- logs a structured admin event with correlation id
- does not directly mutate trade state
- does not mutate order state
- does not mutate exposure

Operator rule:
- treat force-unwind as a queued operational workflow, not an immediate state correction

## Kill Switch
Redis key:

```bash
internal_cross:kill_switch
```

Operational usage:

```bash
redis-cli set internal_cross:kill_switch "true"
redis-cli del internal_cross:kill_switch
```

When enabled:
- internal crossing should be treated as operationally disabled
- external routing paths may continue if broader system policy allows

Verification:
1. Set the key.
2. Submit a sampled/internal-cross-eligible RFQ.
3. Confirm no internal trades are inserted.
4. Confirm `internal_cross_kill_switch_total` increments.

## Rebuild Redis Order Book
Use:

```bash
npm run rebuild:internal-cross-book -- --dry-run
npm run rebuild:internal-cross-book
```

Optional market scope:

```bash
npm run rebuild:internal-cross-book -- --market=<canonical_market_id>
```

Rules:
- rebuild only from Postgres `internal_orders`
- only `OPEN` and `PARTIAL` orders with `remaining_size > 0` are restored
- do not use `FLUSHDB`

## Reservation Verification
Internal crossing happens after RFQ risk reservation.

Verification steps:
1. Inspect `exposure_journal` for `source='pre-exec-reserve'`.
2. If an RFQ fully filled internally, confirm the reservation row is removed after settlement.
3. Confirm `risk:lock:exec:{rfqId}` is no longer present in Redis.
4. If not cleared, use the risk admin path only after confirming the trade/exposure outcome.

## Shadow Mode
Runtime flags:
- `INTERNAL_CROSS_ENABLED=false`
- `INTERNAL_CROSS_SHADOW_ENABLED=true`
- `INTERNAL_CROSS_SHADOW_PERCENT`
- `INTERNAL_CROSS_SHADOW_START_AT`
- `INTERNAL_CROSS_SHADOW_END_AT`

Behavior:
- shadow mode is non-mutating
- it does not insert trades
- it does not mutate exposure
- it does not mutate Redis book state
- it records metrics showing whether internal liquidity would have changed routing

## Rollback Procedure
Fast rollback:
1. Set `internal_cross:kill_switch`.
2. Set `INTERNAL_CROSS_ENABLED=false`.
3. Restart service if env-driven rollout flags changed.
4. Verify `sor_internal_cross_result_total{status="KILL_SWITCH"}` or `status="DISABLED"` increments.
5. Reconcile any in-flight incidents through admin endpoints and rebuild Redis if needed.

## Shadow-to-Canary Rollout
1. Shadow only:
   - `INTERNAL_CROSS_ENABLED=false`
   - `INTERNAL_CROSS_SHADOW_ENABLED=true`
   - start at `1%`
2. Hold for 48h and inspect:
   - no duplicate trades
   - no reservation leakage
   - no rebuild discrepancy spike
   - acceptable divergence rate
3. Increase to `5%`, then `10%`.
4. Only after shadow signoff, consider enabling `INTERNAL_CROSS_ENABLED=true` for limited markets or partner cohorts.

## Post-Incident Checklist
- verify trade journal rows for the affected trade id
- verify `exposure_journal` rows and net/gross transitions
- verify no orphan Redis book entries remain
- rebuild Redis order book if needed from Postgres truth
- confirm no reservation leaks remain in adjacent execution flows
- create or review unwind tasks for unresolved incidents
- capture correlation ids and admin event ids
- notify stakeholders with:
  - affected market ids
  - affected order ids / trade ids
  - exposure impact
  - remediation status
