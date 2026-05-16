# Polymarket Live Execution Readiness Runbook

## Symptom

A small user-funded Polymarket order fails on staging or production with a raw provider message like:

```text
not enough balance / allowance: the balance is not enough -> balance: 0, order amount: 1274970
```

This is not acceptable user-facing behavior. Lotus should block earlier with a safe readiness message when the route is not signed by the user or when CLOB collateral is not spendable.

## Expected Behavior

- Every Polymarket live route requires a Turnkey user-signed CLOB order before submit.
- Unsigned Polymarket submits fail closed with `POLYMARKET_USER_SIGNATURE_REQUIRED`.
- Signed Polymarket submits run CLOB collateral readiness checks before posting.
- Raw CLOB balance/allowance failures are mapped to `POLYMARKET_CLOB_COLLATERAL_NOT_READY`.
- The frontend should tell the user to refresh balances, activate, or approve Polymarket funds. It should not show raw provider balance text.

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

## Verification

1. Request a fresh Polymarket quote.
2. Confirm the route leg has `requiresUserSignature: true`.
3. Confirm the quote has `requiredUserSignatureSteps`.
4. Submit without signed payload in a controlled test and expect `POLYMARKET_USER_SIGNATURE_REQUIRED`.
5. Submit with signed payload but unavailable collateral in a controlled test and expect `POLYMARKET_CLOB_COLLATERAL_NOT_READY`.
6. Confirm no response exposes raw API keys, headers, signatures, or provider payloads.

## Test Commands

```bash
npm run typecheck
npm run build
npx vitest run tests/executable-routing.test.ts tests/signed-trade-bundle.test.ts tests/polymarket-execution-adapter-v2.test.ts --maxWorkers=1
```

## User Recovery Steps

When this issue happens after a deploy:

1. Refresh the route quote so the frontend receives the latest user-signature requirement.
2. Refresh portfolio and funding balances.
3. If Polymarket pUSD or USDC.e is present but CLOB allowance is not spendable, run the Polymarket activation flow.
4. Retry only after backend readiness reports spendable CLOB collateral and allowance.

## Deployment Guardrail

Before staging or production validation, confirm Render is running the same commit that local tests passed against. A passing local test suite does not protect staging if Render is still deployed from an older `main` commit.
