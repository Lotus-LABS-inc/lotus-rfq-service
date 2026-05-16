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
- When CLOB returns an `allowances` spender map, the minimum allowance in that map is the source of truth for live trading readiness. A max approval to the legacy/configured pUSD spender must not mark the wallet ready if CLOB spenders are still zero.
- Direct on-chain pUSD allowance may only be used as a fallback when CLOB does not return a spender map; it is evidence, not an override for CLOB spender readiness.
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

## Verification

1. Request a fresh Polymarket quote.
2. Confirm the route leg has `requiresUserSignature: true`.
3. Confirm the quote has `requiredUserSignatureSteps`.
4. Submit without signed payload in a controlled test and expect `POLYMARKET_USER_SIGNATURE_REQUIRED`.
5. Submit with signed payload but unavailable collateral in a controlled test and expect `POLYMARKET_CLOB_COLLATERAL_NOT_READY`.
6. Confirm a Polymarket buy with pUSD balance, max legacy spender allowance, and zero CLOB spender allowances is blocked before `adapter.submitOrder` is called.
7. Confirm a Polymarket sell with missing conditional-token allowance is blocked before venue submit.
8. Submit or normalize a Limitless collateral failure and expect `LIMITLESS_COLLATERAL_NOT_READY`.
9. Submit or normalize a Predict.fun collateral/share failure and expect a typed `PREDICT_FUN_*_NOT_READY` blocker.
10. Force a Predict.fun quote 401 and confirm quote output keeps `reason: QUOTE_PROVIDER_HTTP_401` with `detailsCode: PREDICT_PROVIDER_AUTH_INVALID`.
11. Confirm no response exposes raw API keys, headers, signatures, JWTs, private payloads, or raw provider balance/allowance text.

## Test Commands

```bash
npm run typecheck
npm run build
npx vitest run tests/polymarket-execution-adapter-v2.test.ts tests/signed-trade-bundle.test.ts tests/limitless-execution-adapter.test.ts tests/extended-venue-quote-readers.test.ts tests/quote-snapshot.test.ts --maxWorkers=1
```

## User Recovery Steps

When this issue happens after a deploy:

1. Refresh the route quote so the frontend receives the latest user-signature requirement.
2. Refresh portfolio and funding balances.
3. If Polymarket pUSD or USDC.e is present but CLOB allowance is not spendable, run the Polymarket activation flow. Lotus prepares max approvals for CLOB-discovered spenders, but the user must sign the activation with Turnkey. A prior activation that only approved the legacy/configured spender is not enough.
4. If Limitless or Predict.fun collateral is present but allowance is not ready, run the relevant venue approval flow.
5. If Predict.fun reports provider auth invalid, check backend Predict.fun credentials and user venue auth state before retrying.
6. Retry only after backend readiness reports spendable collateral and allowance for the selected venue.

## Deployment Guardrail

Before staging or production validation, confirm Render is running the same commit that local tests passed against. A passing local test suite does not protect staging if Render is still deployed from an older `main` commit.
