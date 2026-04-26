# Lotus Security Checklist

Status: ACTIVE BASELINE  
Date: 2026-04-25

Use this checklist before continuing funding, monetization, frontend execution polish, or live venue activation.

## 1. Always-On Rules

- Do not commit `.env` or secrets.
- Do not print private keys, API keys, passphrases, JWT secrets, or route-provider credentials.
- Do not treat matcher/readiness output as executable authority.
- Do not execute lanes unless state is `OPERATOR_APPROVED_SANDBOX` or `OPERATOR_APPROVED_LIMITED_PROD`.
- Do not let user consent widen venue, candidate, topic, or lane scope.
- Do not update final accounting before settlement/finality verification.
- Do not treat bridge completion as `READY_TO_TRADE`.
- Do not enable live venue submission without explicit feature flags and operator checklist signoff.

## 2. Funding V0 Security Gate

Before enabling funding runtime beyond local/sandbox:

- Funding domain model supports multiple targets and per-leg route state.
- Venue capability matrix is the source of truth for target chain/token.
- LiFi is wrapped by Lotus services; UI/RFQ/execution do not call LiFi directly.
- Route quote response is normalized before storage or API return.
- Route destination address/chain/token are validated against venue capability.
- User-visible signing payload is clear and cannot hide a changed destination.
- Every funding route leg has an audit trail.
- Aggregate status supports partial readiness.
- `READY_TO_TRADE` requires venue adapter confirmation.
- Execution preflight blocks pending, failed, stale, or unknown funding state.
- Funding API never returns route-provider secrets or venue credentials.
- `FUNDING_LIFI_QUOTES_ENABLED` is intentionally set for the environment.
- `FUNDING_VENUE_READINESS_CHECKS_ENABLED` is intentionally set for the environment.
- `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED` is enabled before any live venue execution depends on funded balances.
- `FUNDING_LIVE_SUBMIT_ENABLED` remains false for v0 because backend does not sign or broadcast user wallet transactions.
- Venue destination envs such as `POLYMARKET_FUNDING_DESTINATION_ADDRESS` and `LIMITLESS_FUNDING_DESTINATION_ADDRESS` are configured and reviewed before quote enablement.
- Venue readiness envs such as `*_FUNDING_READINESS_MODE`, `*_FUNDING_READINESS_ENABLED`, `*_FUNDING_BALANCE_URL`, `*_FUNDING_READ_AUTH_MODE`, and `*_FUNDING_READ_API_KEY` are reviewed before any checker can mark balances `READY_TO_TRADE`.
- Polymarket and Limitless funding readiness default to `DISABLED`; `LIVE_READ` requires an operator-approved read endpoint and server-side-only credentials where needed.
- Internal Polymarket balance reads require `POLYMARKET_INTERNAL_BALANCE_READ_ENABLED=true`, complete CLOB read credentials, and bearer auth outside local loopback testing.
- `/internal/polymarket/funding-balance` returns only `usableBalance`; it must not return raw CLOB responses, allowances, auth headers, API keys, or private keys.
- Sandbox funding enforcement is only allowed for approved routes where every required route venue has validated readiness coverage.
- Do not enable funding preflight enforcement for pair, tri, or split routes if any route venue is manually seeded, stub-only, `NOT_CONFIGURED`, or missing a venue-specific readiness checker.
- A persisted `READY_TO_TRADE` row for one venue does not satisfy funding preflight for a route that also requires another venue.
- Pair-route funding enforcement cannot be enabled unless `artifacts/funding/pair-funding-readiness-sandbox-preflight.json` exists, has `status=COMPLETED`, has `persistedReadinessRows=2`, has `executionPreflight.ok=true`, and is fresh for the intended deployment window.
- Treat pair-route rehearsal artifacts older than 24 hours, generated before the latest funding/readiness/preflight code change, or generated against different venue readiness envs as stale.
- If the pair rehearsal artifact is stale or missing, rerun `npm run funding:pair-readiness-sandbox-preflight` before enabling any pair-route funding enforcement flag.
- Run `npm run funding:pair-enforcement-gate` before changing any pair-route funding enforcement flag; it must pass without overrides unless an operator explicitly documents a shorter or longer freshness window.

## 3. LiFi Integration Checklist

- Use LiFi API/SDK through `LifiRouteQuoteService`, `LifiRouteExecutionService`, and `LifiRouteStatusService` or equivalent wrappers.
- Store provider route IDs and status snapshots, not raw secret-bearing provider internals.
- Validate route quote freshness before asking the user to sign.
- Validate source chain/token/amount against the user's funding intent.
- Validate destination chain/token/address against `VenueCapability`.
- Normalize provider errors to user-safe messages.
- Treat route success as only one signal, not final readiness.
- Require destination confirmation and venue credit confirmation after LiFi status.
- Add timeout and retry policy for bridge pending, destination pending, and venue-credit pending.
- Treat LiFi MCP as developer tooling unless explicitly reviewed as a production dependency.

## 4. Execution Adapter Activation Gate

Before activating any live adapter:

- Adapter defaults to `NOT_CONFIGURED` or `LIVE_DISABLED`.
- Required env keys are documented and validated.
- Live mode requires an explicit feature flag.
- Missing env cannot trigger external calls.
- Dry-run output cannot mutate accounting.
- Prepared order metadata contains no secrets.
- SDK/client error messages are redacted.
- Settlement verification exists for the venue.
- Ghost-fill behavior is tested where applicable.
- Admin `/admin/execution-venues` reports adapter readiness accurately.

## 5. Polymarket V2 Live Gate

Do not enable live Polymarket submission until:

- `POLYMARKET_EXECUTION_MODE=v2` is set intentionally.
- `POLYMARKET_LIVE_EXECUTION_ENABLED=true` is set intentionally.
- All required `POLYMARKET_*` env keys are present server-side only.
- Dependency critical/high advisories are remediated or formally risk-accepted.
- SDK payload tests prove `builderCode`, `tokenID`, `price`, `size`, and `side` mapping.
- Live harness is run only with operator-controlled tiny-size/non-production-safe configuration.
- Settlement/fill status mapping is verified.
- Ghost-fill timeout behavior is verified.
- Accounting remains blocked until settlement/finality.

## 6. CI/CD Gate

Before production CI is trusted:

- Pin GitHub Actions to full commit SHAs.
- Add workflow `permissions:` with least privilege.
- Keep `npm ci` as the install path.
- Treat `package-lock.json` changes as security-sensitive.
- Run `npm audit --audit-level=moderate`.
- Run `npm run typecheck`.
- Run critical execution/funding tests.
- Do not upload artifacts that contain secrets.

## 7. API Exposure Gate

Before exposing externally:

- Confirm OpenAPI labels match mounted routes.
- Public endpoints are intentionally public.
- Admin endpoints require admin JWT.
- Admin JWTs are short-lived, signed with the active `JWT_SECRET`, and include `role=ADMIN`.
- `JWT_SECRET` rotation has a rollback value stored in the operator secret manager before deployment.
- Simulation preview is disabled in production.
- `/metrics` is internal, allowlisted, or admin-protected.
- WebSocket subscription auth and topic ownership are verified.
- Error responses are user-safe and do not leak credentials.

## 8. Incident Response Minimum

If a secret is suspected exposed:

- Stop live adapters.
- Rotate the affected key immediately.
- If `JWT_SECRET` is exposed, rotate it and restart the backend; all existing user/admin JWTs must be treated as invalid.
- Check git history and CI artifacts.
- Audit recent admin and execution events.
- Mark impacted lanes held if execution authority may be affected.
- Record remediation in a security report.

If a ghost-fill or settlement mismatch occurs:

- Do not update final accounting.
- Preserve venue/off-chain/on-chain evidence.
- Reroute only to approved fallback lanes.
- Otherwise fail closed.
- Surface user-safe status.

If funding route or bridge behavior is suspicious:

- Mark affected route leg pending or failed.
- Do not mark venue balance `READY_TO_TRADE`.
- Block execution preflight for that venue.
- Preserve tx hashes and provider status snapshots.
