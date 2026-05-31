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
- `POLYMARKET_CLOB_SYNC_PENDING` must not be returned as activation `READY`. It is an auth-readiness state: pUSD and on-chain approvals exist, but the CLOB balance/allowance endpoint has not confirmed spendable collateral.
- When the frontend sees `POLYMARKET_CLOB_SYNC_PENDING`, it should run the CLOB readiness sync flow: call `POST /funding/venue-activations/polymarket/clob-sync/prepare`, collect the user Turnkey EIP-712 `ClobAuth` signature, then call `POST /funding/venue-activations/polymarket/clob-sync/submit`. The backend derives/creates user-scoped CLOB API credentials, calls `updateBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })`, then reads `getBalanceAllowance`.
- When CLOB sync submit returns `READY`, Lotus records a user-scoped `POLYMARKET_CLOB_READINESS_SYNC_CONFIRMED` audit event for the active deposit wallet. Portfolio, funding balances, activation status, and signed-submit readiness may then use `USER_CLOB_SYNC_CONFIRMED`, bounded by the live on-chain pUSD/CLOB-spender allowance read, while the server-side CLOB cache catches up.
- Polymarket buy submit must force a user-scoped `updateBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })`, then require `getBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })` to return spendable collateral. If the CLOB cache still lags, final submit may use `USER_CLOB_SYNC_CONFIRMED` from the active user/deposit-wallet record as a bounded fallback. In that fallback state, `usableBalance` is the server-bounded spendable amount; `clobCollateralBalance` / `clobCollateralAllowance` may still show stale CLOB zeroes until the provider cache catches up. `ONCHAIN_CLOB_SPENDER_ALLOWANCE`, `ONCHAIN_PUSD_ALLOWANCE`, legacy/config fallback spender approval, USDC.e delivery, or missing fallback evidence must still block submit.
- Portfolio/funding balance sync must also refresh CLOB with the deposit-wallet signature type. For active deposit wallets, use `signature_type: 3` on both `updateBalanceAllowance` and `getBalanceAllowance`; otherwise staging can show on-chain pUSD approval while CLOB spendable balance remains `0`.
- The Polymarket TypeScript SDK currently overwrites per-call `signature_type` balance params with the `ClobClient` constructor's `signatureType` / OrderBuilder signature type. For user deposit-wallet balance reads, construct the CLOB client itself with `signatureType: POLY_1271`; passing `signature_type: 3` only to `getBalanceAllowance` or `updateBalanceAllowance` is not sufficient.
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

Current blocker diagnosis:

1. Wrong CLOB auth context/API credentials can cause server-side portfolio reads to see on-chain pUSD approvals but not CLOB spendable collateral. The Polymarket SDK signs balance refresh headers as the SDK signer address and does not pass the deposit wallet as an explicit `funderAddress` query param for `getBalanceAllowance` / `updateBalanceAllowance`.
2. The deposit wallet can remain unsynced in CLOB even when pUSD and spender approvals are visible on-chain. Lotus must keep this as `POLYMARKET_CLOB_SYNC_PENDING` until the user signs the CLOB auth payload and the user-scoped CLOB refresh confirms spendable collateral.
3. The CLOB spender addresses currently used by Lotus are the Polymarket CLOB V2 spender set returned by the SDK (`exchangeV2`, `negRiskAdapter`, `negRiskExchangeV2`). Do not replace them with collateral ramp contracts; those contracts are pUSD/bridge plumbing, not the live order spenders.
4. Server-side portfolio sync is not enough to unlock live trading. Submit readiness must be proven through the user-scoped CLOB context that signs the order, then CLOB must return spendable collateral before `postOrder`.

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
8. Confirm the `/funding/venue-activations/polymarket/clob-sync/*` flow accepts only the authenticated user's linked Turnkey signer and deposit wallet, then returns `READY` only after CLOB balance/allowance is nonzero.
9. Confirm a successful CLOB sync writes `POLYMARKET_CLOB_READINESS_SYNC_CONFIRMED` and subsequent `/funding/venue-balances` reports `POLYMARKET_CLOB_COLLATERAL_CONFIRMED` / `USER_CLOB_SYNC_CONFIRMED` instead of downgrading back to `POLYMARKET_CLOB_SYNC_PENDING`.
10. Confirm the live submit adapter retries user-scoped `updateBalanceAllowance({ asset_type: COLLATERAL, signature_type: 3 })` and requires `getBalanceAllowance` spendable collateral before posting a signed Polymarket order.
   - If live CLOB still reports zero after a successful CLOB sync, confirm submit may proceed only through `USER_CLOB_SYNC_CONFIRMED` for the authenticated user and active deposit wallet, using the bounded `usableBalance` value. Raw on-chain approval-only states must still block.
11. Confirm portfolio/funding balance sync also calls CLOB balance refresh with deposit-wallet `signature_type: 3`.
   - Confirm this at the client-construction level, not only the method-params level.
12. Confirm activation payloads do not report on-chain fallback values as `clobCollateralAllowance`; while CLOB is lagging, CLOB allowance should remain the CLOB-reported value and the state should be `POLYMARKET_CLOB_SYNC_PENDING`.
13. Confirm signed Polymarket market-flow orders are posted with `OrderType.FOK`, not `OrderType.GTC`.
14. Confirm signed and delegated Limitless market-flow orders are posted with `OrderType.FOK`, not `OrderType.GTC`.
15. Confirm Predict.fun signed market-flow payloads use `strategy: MARKET` and `isFillOrKill: true`.
16. Confirm relay-mode Polymarket buy submit does not accept API on-chain readiness attestation alone; the relay must refresh and verify CLOB spendable collateral.
17. Confirm a Polymarket sell with missing conditional-token allowance is blocked before venue submit.
18. Submit or normalize a Limitless collateral failure and expect `LIMITLESS_COLLATERAL_NOT_READY`.
19. Submit or normalize a Predict.fun collateral/share failure and expect a typed `PREDICT_FUN_*_NOT_READY` blocker.
20. Force a Predict.fun quote 401 and confirm quote output keeps `reason: QUOTE_PROVIDER_HTTP_401` with `detailsCode: PREDICT_PROVIDER_AUTH_INVALID`.
21. Confirm no response exposes raw API keys, headers, signatures, JWTs, private payloads, or raw provider balance/allowance text.

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
4. If pUSD and all CLOB-discovered approvals are confirmed on-chain but the CLOB cache still reports zero, run the CLOB readiness sync action from the frontend. The user signs the `ClobAuth` typed data through Turnkey; Lotus derives user-scoped CLOB credentials and forces `updateBalanceAllowance` before reading CLOB spendable collateral.
5. If CLOB still reports zero after auth sync, keep the order blocked and show the user `pUSD approved, CLOB sync pending`.
6. If pUSD is present and approvals are confirmed but CLOB available balance remains zero, inspect Polymarket open orders for the active deposit wallet. Cancel only Lotus-created/stale market-flow orders that are reserving collateral; do not cancel user-created venue orders without explicit user action.
7. If Limitless or Predict.fun collateral is present but allowance is not ready, run the relevant venue approval flow.
8. If Predict.fun reports provider auth invalid, check backend Predict.fun credentials and user venue auth state before retrying.
9. Retry only after backend readiness reports spendable collateral and allowance for the selected venue.

## Deployment Guardrail

Before staging or production validation, confirm Render is running the same commit that local tests passed against. A passing local test suite does not protect staging if Render is still deployed from an older `main` commit.

Polymarket relay-mode submit has an additional guardrail: the external execution relay is part of the execution surface. If `POLYMARKET_EXECUTION_SUBMIT_MODE=relay`, the configured `POLYMARKET_EXECUTION_RELAY_URL` must be deployed from the same commit as the backend execution fix, or a later commit that includes the same relay changes. Do not validate user submit against an old relay.

Required checks after any Polymarket execution-relay change:

```bash
render deploys list srv-d7nobb3eo5us73ff246g -o json
aws elasticbeanstalk describe-environments --region eu-west-1 --environment-name lotus-polymarket-relay-euw1c --output json
aws elasticbeanstalk describe-application-versions --region eu-west-1 --application-name lotus-polymarket-execution-relay --output json
curl -s http://lotus-polymarket-relay-euw1c.eu-west-1.elasticbeanstalk.com/health
```

When packaging the Elastic Beanstalk relay from Windows, do not use PowerShell `Compress-Archive`. EB deploys the bundle on Linux and can fail `StageApplication` if the ZIP entries contain Windows `\` path separators. Build the package with a POSIX-path ZIP tool, for example:

```bash
npm run build
tar -a -cf eb-polymarket-relay-<commit>-<timestamp>.zip -C <staging-dir> .
tar -tf eb-polymarket-relay-<commit>-<timestamp>.zip | head
```

The archive listing must show `/` paths such as `dist/src/polymarket-execution-relay.js`, not `dist\src\polymarket-execution-relay.js`. If an EB deploy fails with `app_source_bundle appears to use backslashes as path separators`, rebuild the ZIP with POSIX paths and deploy a new app version.

The EB `VersionLabel` should include the tested commit short SHA, and the relay `/health` endpoint must respond. If main points at a different relay URL, inspect that relay instead.

Failure mode this guardrail prevents:

```text
main backend: user-signed POLY_1271 deposit-wallet order
stale relay: rebuilds/submits static POLY_PROXY order
Polymarket: not enough balance / allowance -> balance: 0
```

Relay log evidence of this drift is any submit to `https://clob.polymarket.com/order` where a Turnkey deposit-wallet terminal order is posted as `signatureType: 1` / `POLY_PROXY`, with a static maker/funder, or as `OrderType.GTC`. Current user terminal market orders must preserve the signed `POLY_1271` order and post as `FOK`.
