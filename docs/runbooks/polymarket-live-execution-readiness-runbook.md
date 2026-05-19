# Live Execution Readiness and Safe Venue Failure Runbook

## Symptom

A small user-funded order fails on staging or production with a raw provider or venue message like:

```text
not enough balance / allowance: the balance is not enough -> balance: 0, order amount: 1274970
Insufficient collateral allowance for this order.
Conditional token allowance not set.
Predict.fun collateral USDT allowance is less than the total bid amount.
Insufficient shares: token balance is less than the total ask amount.
```

This is not acceptable user-facing behavior. Lotus should block earlier with a safe readiness message when the route is not signed by the user, venue collateral is not spendable, or sell-side shares are not approved. Submit-path normalization is the fallback if a venue still returns a raw provider error.

## Expected Behavior

- Every Polymarket live route requires a Turnkey user-signed CLOB order before submit.
- Unsigned Polymarket submits fail closed with `POLYMARKET_USER_SIGNATURE_REQUIRED`.
- Signed Polymarket submits run CLOB collateral readiness checks before posting.
- Buy-side Polymarket readiness must read the active user deposit wallet through the CLOB balance/allowance path and compare `size * price + fee` against CLOB collateral balance, CLOB allowance, and derived spendable balance.
- When CLOB returns an `allowances` spender map, that spender map is the source of truth for which spenders must be approved. A max approval to the legacy/configured pUSD spender must not mark the wallet ready if the current CLOB spenders are not approved.
- If the server-side CLOB balance cache reports zero but the active deposit wallet has pUSD and on-chain max approvals for every CLOB-discovered spender, portfolio/funding may show `POLYMARKET_CLOB_SYNC_PENDING`. This means pUSD is approved on-chain, but it is not yet trade-ready.
- Polymarket buy submit must force a user-scoped `updateBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })`, then require `getBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })` to return spendable collateral. `ONCHAIN_CLOB_SPENDER_ALLOWANCE`, `ONCHAIN_PUSD_ALLOWANCE`, legacy/config fallback spender approval, USDC.e delivery, or missing fallback evidence must still block submit.
- Portfolio/funding balance sync must also refresh CLOB with the deposit-wallet signature type. For active deposit wallets, use `signature_type: 3` on both `updateBalanceAllowance` and `getBalanceAllowance`; otherwise staging can show on-chain pUSD approval while CLOB spendable balance remains `0`.
- API fields must keep source semantics clear: `clobCollateralBalance` / `clobCollateralAllowance` are CLOB-reported values only. On-chain fallback values belong in `onchainPusdBalance` / `onchainPusdAllowance` and may explain `POLYMARKET_CLOB_SYNC_PENDING`, but they must not be exposed as CLOB-confirmed collateral.
- Lotus market-trade orders must post to Polymarket as `FOK`, not `GTC`. `GTC` orders can rest on the book and reserve collateral, causing later small market orders to fail with CLOB available balance `0` even when the deposit wallet still has pUSD on-chain.
- Lotus market-trade orders must post to Limitless as `FOK` as well. Limitless market flow must not create a resting `GTC` order from the terminal, delegated server-wallet path, or user-signed relay path.
- Predict.fun terminal flow must keep using venue `MARKET` orders with `isFillOrKill: true`; this keeps Lotus market trades aligned with non-resting execution while still relying on Predict.fun's live orderbook amount builder.
- When Polymarket submit is routed through an internal relay, the relay must run the same user-scoped CLOB `updateBalanceAllowance` and `getBalanceAllowance` check. Server-side on-chain fallback evidence is not sufficient to post a live buy order.
- Sell-side Polymarket readiness must read conditional-token balance/allowance for the selected outcome token before submit.
- Raw Polymarket CLOB balance/allowance failures are mapped to `POLYMARKET_CLOB_COLLATERAL_NOT_READY`.
- Raw Polymarket conditional-token/share failures are mapped to `POLYMARKET_CLOB_SHARES_NOT_READY`.
- Raw Limitless collateral failures are mapped to `LIMITLESS_COLLATERAL_NOT_READY`.
- Raw Limitless conditional-token/share failures are mapped to `LIMITLESS_SHARES_NOT_READY`.
- Raw Predict.fun provider auth failures are mapped to `PREDICT_PROVIDER_AUTH_INVALID` or `PREDICT_FUN_AUTH_REFRESH_REQUIRED`.
- Raw Predict.fun collateral/share failures are mapped to `PREDICT_FUN_COLLATERAL_NOT_READY` or `PREDICT_FUN_SHARES_NOT_READY`.
- Opinion live submit stays fail-closed with `OPINION_LIVE_SUBMIT_NOT_ENABLED` unless live submission is explicitly approved and configured.
- Signed-bundle results may include `submittedLegs[].reasonCode`; `submittedLegs[].reason` must stay user-safe.
- The frontend should tell the user to refresh balances, activate, approve venue funds, refresh venue auth, or retry later. It should not show raw provider balance, allowance, JWT, signature, or payload text.

## Common Cause

The staging frontend can point at a Render backend service that tracks `main`, while fixes were pushed only to `staging`. In that case the deployed backend may still run an older path that can submit with operator or incomplete CLOB state and return raw provider errors.

Another concrete cause is old Lotus-created Polymarket `GTC` orders. Lotus does not expose limit orders in production, so a market-flow `GTC` order can accidentally remain open and reserve the user deposit wallet's collateral. Polymarket CLOB then reports available collateral as zero even though portfolio reads still see pUSD on-chain.

Check Render service branch and deployed commit before debugging user balances:

```bash
render services list -o json
render deploys list srv-d7nobb3eo5us73ff246g -o json
git log --oneline --decorate -8 --all
```

The deployed backend commit must include:

- `Require user signatures for Polymarket routes`
- `Block unsigned Polymarket live submits`
- `Map Polymarket CLOB balance errors to readiness blockers`
- `Normalize live venue submit failures`
- `Preflight Polymarket CLOB collateral before live submit`
- `Submit Polymarket market trades as FOK`

## Verification

1. Request a fresh Polymarket quote.
2. Confirm the route leg has `requiresUserSignature: true`.
3. Confirm the quote has `requiredUserSignatureSteps`.
4. Submit without signed payload in a controlled test and expect `POLYMARKET_USER_SIGNATURE_REQUIRED`.
5. Submit with signed payload but unavailable collateral in a controlled test and expect `POLYMARKET_CLOB_COLLATERAL_NOT_READY`.
6. Confirm a Polymarket buy with pUSD balance, max legacy spender allowance, and zero CLOB spender allowances is blocked before `adapter.submitOrder` is called.
7. Confirm a Polymarket buy with pUSD balance and max on-chain approvals for every CLOB-discovered spender reports `POLYMARKET_CLOB_SYNC_PENDING` / `ONCHAIN_CLOB_SPENDER_ALLOWANCE` only as a portfolio/funding state, not as trade-ready.
8. Confirm the live submit adapter retries user-scoped `updateBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })` and requires `getBalanceAllowance` spendable collateral before posting a signed Polymarket order.
9. Confirm portfolio/funding balance sync also calls CLOB balance refresh with deposit-wallet `signature_type: 3`.
10. Confirm activation payloads do not report on-chain fallback values as `clobCollateralAllowance`; while CLOB is lagging, CLOB allowance should remain the CLOB-reported value and the state should be `POLYMARKET_CLOB_SYNC_PENDING`.
11. Confirm signed Polymarket market-flow orders are posted with `OrderType.FOK`, not `OrderType.GTC`.
12. Confirm signed and delegated Limitless market-flow orders are posted with `OrderType.FOK`, not `OrderType.GTC`.
13. Confirm Predict.fun signed market-flow payloads use `strategy: MARKET` and `isFillOrKill: true`.
14. Confirm relay-mode Polymarket buy submit does not accept API on-chain readiness attestation alone; the relay must refresh and verify CLOB spendable collateral.
15. Confirm a Polymarket sell with missing conditional-token allowance is blocked before venue submit.
16. Submit or normalize a Limitless collateral failure and expect `LIMITLESS_COLLATERAL_NOT_READY`.
17. Submit or normalize a Predict.fun collateral/share failure and expect a typed `PREDICT_FUN_*_NOT_READY` blocker.
18. Force a Predict.fun quote 401 and confirm quote output keeps `reason: QUOTE_PROVIDER_HTTP_401` with `detailsCode: PREDICT_PROVIDER_AUTH_INVALID`.
19. Confirm no response exposes raw API keys, headers, signatures, JWTs, private payloads, or raw provider balance/allowance text.

## Test Commands

```bash
npm run typecheck
npm run build
npx vitest run tests/polymarket-execution-adapter-v2.test.ts tests/signed-trade-bundle.test.ts tests/limitless-execution-adapter.test.ts tests/user-signed-relay-execution-adapter.test.ts tests/extended-venue-quote-readers.test.ts tests/quote-snapshot.test.ts --maxWorkers=1
```

## User Recovery Steps

When this issue happens after a deploy:

1. Refresh the route quote so the frontend receives the latest user-signature requirement.
2. Refresh portfolio and funding balances.
3. If Polymarket pUSD or USDC.e is present but CLOB allowance is not spendable, run the Polymarket activation flow. Lotus prepares max approvals for CLOB-discovered spenders, but the user must sign the activation with Turnkey. A prior activation that only approved the legacy/configured spender is not enough.
4. If pUSD and all CLOB-discovered approvals are confirmed on-chain but the CLOB cache still reports zero, use a fresh route/signature so the user-scoped submit path can refresh CLOB balance/allowance before post. If CLOB still reports zero after refresh, keep the order blocked and show the user `pUSD approved, CLOB sync pending`.
5. If pUSD is present and approvals are confirmed but CLOB available balance remains zero, inspect Polymarket open orders for the active deposit wallet. Cancel only Lotus-created/stale market-flow orders that are reserving collateral; do not cancel user-created venue orders without explicit user action.
6. If Limitless or Predict.fun collateral is present but allowance is not ready, run the relevant venue approval flow.
7. If Predict.fun reports provider auth invalid, check backend Predict.fun credentials and user venue auth state before retrying.
8. Retry only after backend readiness reports spendable collateral and allowance for the selected venue.

## Deployment Guardrail

Before staging or production validation, confirm Render is running the same commit that local tests passed against. A passing local test suite does not protect staging if Render is still deployed from an older `main` commit.
