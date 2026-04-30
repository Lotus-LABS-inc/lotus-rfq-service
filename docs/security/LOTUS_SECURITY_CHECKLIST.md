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
- Polymarket, Limitless, Opinion, Myriad, and Predict.fun funding readiness default to `DISABLED`; `LIVE_READ` requires an operator-approved read endpoint and server-side-only credentials where needed.
- Before a new venue is used in funding enforcement, run its read-only smoke command and confirm the artifact is redacted, read-only, and either `COMPLETED` with expected mapping or fail-closed with a documented blocker.
- Internal Polymarket balance reads require `POLYMARKET_INTERNAL_BALANCE_READ_ENABLED=true`, complete CLOB V2 read credentials, and bearer auth outside local loopback testing.
- `/internal/polymarket/funding-balance` returns only `usableBalance`; it must not return raw CLOB responses, allowances, auth headers, API keys, or private keys.
- Polymarket V2 funding readiness must treat CLOB collateral as pUSD. API-only funding flows must account for USDC.e -> pUSD wrapping before marking capital execution-ready.
- Sandbox funding enforcement is only allowed for approved routes where every required route venue has validated readiness coverage.
- Do not enable funding preflight enforcement for pair, tri, or split routes if any route venue is manually seeded, stub-only, `NOT_CONFIGURED`, or missing a venue-specific readiness checker.
- A persisted `READY_TO_TRADE` row for one venue does not satisfy funding preflight for a route that also requires another venue.
- Pair-route funding enforcement cannot be enabled unless `artifacts/funding/pair-funding-readiness-sandbox-preflight.json` exists, has `status=COMPLETED`, has `persistedReadinessRows=2`, has `executionPreflight.ok=true`, and is fresh for the intended deployment window.
- Treat pair-route rehearsal artifacts older than 24 hours, generated before the latest funding/readiness/preflight code change, or generated against different venue readiness envs as stale.
- If the pair rehearsal artifact is stale or missing, rerun `npm run funding:pair-readiness-sandbox-preflight` before enabling any pair-route funding enforcement flag.
- Run `npm run funding:pair-enforcement-gate` before changing any pair-route funding enforcement flag; it must pass without overrides unless an operator explicitly documents a shorter or longer freshness window.
- Run the route-specific gate, such as `npm run funding:opinion-enforcement-gate`, before changing any single-venue funding enforcement setting for that venue; every venue in the route path must have fresh persisted `READY_TO_TRADE` evidence.
- Run `npm run funding:venue-gate-summary` before any sandbox funding-enforcement rollout; every venue required by the route must be `PASSED` and fresh in the summary.
- Run `npm run funding:route-enforcement-ready -- <ROUTE_OR_LANE_ID>` before enabling sandbox funding enforcement for a specific route scope; it must pass using the all-venue summary plus a route-specific rehearsal artifact.
- For tri-route funding enforcement, run `npm run funding:tri-readiness-sandbox-preflight` and `npm run funding:route-enforcement-ready:tri`; both must pass and remain fresh.
- For strict-all funding enforcement, run `npm run funding:strict-all-readiness-sandbox-preflight` and `npm run funding:route-enforcement-ready:strict-all`; both must pass and remain fresh.
- If the route/lane id is ambiguous or includes `PREDICT` without `PREDICT_FUN`, set `FUNDING_ROUTE_REQUIRED_VENUES` explicitly; do not treat Predict.fun as interchangeable with any other Predict venue.

Withdrawal v0 gate:

- Withdrawal v0 is Model A non-custodial: Lotus creates withdrawal records, route previews, and user-broadcast tx hash records only.
- Do not add or enable backend signing, backend broadcast, live venue withdrawal API calls, or custody/vault behavior without a separate security review.
- Withdrawal quote must require persisted venue-ready balance for the exact user, venue, token, and amount.
- Withdrawal quote must fail closed when `supportsWithdrawal=false`, venue capability is unknown, balance is insufficient, destination wallet is invalid, or the quote is stale.
- Multi-source withdrawals must preserve per-source/leg state; do not treat partial withdrawal success as aggregate completion.
- Withdrawal responses must not return API keys, auth headers, private keys, raw provider payloads, LI.FI `transactionRequest` internals, or venue withdrawal internals.
- Withdrawal endpoints must not mutate funding readiness records directly.
- Run `npm run funding:withdrawal-sandbox-rehearsal` before considering live withdrawal execution; the artifact must be `COMPLETED`, fresh for the intended deployment window, redacted, and explicitly reviewed by an operator.
- Live withdrawal execution remains blocked if `artifacts/funding/withdrawal-sandbox-rehearsal.json` is missing, stale, failed, or shows any safety flag inconsistent with Model A non-custodial behavior.
- Run `npm run funding:withdrawal-completion-sandbox-rehearsal` before building a live withdrawal adapter; the artifact must be `COMPLETED`, fresh, redacted, and show `venueReleased=true`, `destinationReceived=true`, and `completed=true`.
- Withdrawal completion must require explicit venue-release and destination-receipt evidence. A user tx hash, venue release alone, or ambiguous provider response must not mark a withdrawal complete.
- Completed withdrawals must continue reducing available venue-ready balance unless the withdrawal is failed or cancelled; otherwise users could withdraw the same venue-ready capital twice.
- The first real withdrawal evidence adapter should be Polymarket-only, read-only, disabled by default, and fail-closed. It must consume a normalized operator-approved evidence read service, not raw venue internals.
- Polymarket on-chain evidence mode may verify the submitted Polygon USDC Bridge transfer and read Bridge status, but venue-release/source-transfer evidence or Bridge status without exact destination wallet evidence must not persist withdrawal completion.
- Polymarket Bridge aggregate completions caused by late/expired sends must be marked recovery-review only; they must not auto-complete individual withdrawal rows without an exact per-withdrawal scope match.
- Run `npm run funding:polymarket-bridge-withdrawal-recovery-review` after a Polymarket aggregate recovery smoke. The artifact is read-only and review-only; it must not be treated as persistence approval unless a separate explicit operator approval command exists and passes.
- Withdrawal evidence env vars must stay disabled by default. Incomplete config must not persist completion.
- Do not persist `WITHDRAWAL_LEG_COMPLETED` unless the evidence matches the submitted withdrawal tx hash, exact destination wallet, exact chain, exact token, sufficient amount, and minimum confirmations.
- Before enabling any venue withdrawal evidence checker for persistence, run the matching read-only smoke command and review the fresh artifact: `funding:polymarket-withdrawal-evidence-smoke`, `funding:limitless-withdrawal-evidence-smoke`, `funding:opinion-withdrawal-evidence-smoke`, `funding:myriad-withdrawal-evidence-smoke`, or `funding:predictfun-withdrawal-evidence-smoke`.
- Smoke artifacts must show `readOnly=true`, `persistedCompletionResult=false`, `redactionVerified=true`, and unchanged reconciliation counts for real DB rows. Synthetic-row smoke results are useful for parser/read-service validation but are not enough to approve persistence for real user withdrawals.
- `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_GATE_ENABLED` must remain true for any environment where a withdrawal evidence checker can persist completion.
- `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED` must remain false until one venue is explicitly selected for a controlled persistence test.
- Completion persistence must also be scoped to the selected venue by `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES=<VENUE>` or `<VENUE>_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=true`; do not enable all venues at once.
- Before allowing `WITHDRAWAL_LEG_COMPLETED` persistence for a venue, run `npm run funding:withdrawal-completion-gate -- <VENUE>` or the venue alias. The gate must pass using a fresh, `COMPLETED`, redacted, non-synthetic smoke artifact from an operator-approved evidence host.
- Before broader withdrawal completion rollout, run `npm run funding:withdrawal-completion-gate-summary`; every venue row must be `PASSED`, fresh, redacted, non-synthetic, and backed by an operator-approved evidence host.
- Configure `<VENUE>_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` or `FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` before considering live completion persistence; an unapproved evidence host must block persistence.
- Live withdrawal adapter work cannot begin until `docs/runbooks/withdrawal-flow-v1-adapter-design.md`, the per-venue adapter checklist, and the evidence-gated completion requirements are reviewed. The design spec does not authorize custody, backend signing, backend broadcasting, or live venue mutation.
- Polymarket Bridge user-endpoint wiring cannot begin until `npm run funding:polymarket-bridge-withdrawal-dry-run` produces a fresh `COMPLETED`, redacted artifact and an operator reviews it. The dry-run must show no backend signing, no backend broadcast, no live venue withdrawal execution, and no completion persistence.
- A Polymarket Bridge dry-run artifact validates prepare/read/status compatibility only. It must not be treated as proof of real withdrawal completion unless a separate controlled user-transfer rehearsal is approved and evidence-gated.
- Polymarket Bridge sandbox wiring must remain disabled by default. If enabled for sandbox, it may only return frontend-safe quote/action metadata and sanitized provider status for a single-source Polymarket withdrawal; it must not create completion reconciliation records, mark `WITHDRAWAL_LEG_COMPLETED`, sign, broadcast, or move funds.
- No live Bridge completion or user-transfer rehearsal may proceed until sandbox wiring tests, the dry-run artifact, OpenAPI/docs, redaction review, and operator approval are complete.
- The Polymarket Bridge user-transfer rehearsal start command must require explicit operator enablement, a configured operator-approved destination address, `POLYMARKET_BRIDGE_DRY_RUN_ONLY=true`, and a bounded rehearsal amount. Its artifact may contain the Bridge address needed for manual transfer, but it must not contain API keys, auth headers, DB URLs, private keys, raw provider payloads, or completion evidence.
- Limitless withdrawal adapter work must start as dry-run/read-status only. `npm run funding:limitless-withdrawal-dry-run` must produce a fresh `COMPLETED`, redacted artifact before any sandbox wiring is considered.
- Limitless Programmatic API validation must prefer the SDK-backed HMAC read diagnostic first. `npm run funding:limitless-sdk-auth-dry-run` must produce a fresh `COMPLETED`, redacted, read-only artifact before live Limitless withdrawal adapter work continues.
- The Limitless dry-run must not call `POST /portfolio/withdraw`; it may only prepare review-safe metadata and read portfolio history/status. Live Limitless withdrawal execution requires a separate security review, scoped credentials, operator signoff, and explicit default-off feature flags.
- Limitless account/sub-account readiness must be reviewed before withdrawal validation continues. Operators must confirm the user-controlled EOA, account/profile type, numeric profile id requirement, Programmatic API token scope, `x-on-behalf-of` authorization if used, and that Lotus stores no user private key or signing secret.
- Do not treat a Limitless managed/server-wallet account as Lotus custody. Lotus may store only references and sanitized evidence unless a future custody model is separately approved.
- Limitless EOA/user-wallet withdrawal mode is `AUTO_RESOLUTION_ONLY`; normal user-signed withdrawal intents are unsupported and resolved-market payouts settle automatically on-chain through native Limitless mechanics.
- Limitless `POST /portfolio/withdraw` and `POST /portfolio/redeem` are classified as disabled `PARTNER_MANAGED_BACKEND` paths, not `USER_AUTHORIZED_ACTION`; they must remain blocked from user endpoint wiring and completion persistence unless explicit security/custody approval authorizes Lotus-initiated server-wallet withdrawals or Limitless provides a documented user-authorized flow.
- `npm run funding:limitless-partner-managed-withdrawal-gate` must remain `BLOCKED` by default. It may pass only with `LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED=true`, `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE=LIMITLESS`, a fresh approval id, a security/custody review id, an operator approver, and non-expired approval timestamps.
- Passing the Limitless partner-managed approval gate is approval evidence only. It does not authorize user endpoint wiring, does not call `POST /portfolio/withdraw` or `POST /portfolio/redeem`, and does not change custody assumptions without a separate implementation review.
- Static safety tests must prove user-facing funding routes and `FundingService` cannot trigger Limitless `POST /portfolio/withdraw` or `POST /portfolio/redeem`, even when read-only HMAC diagnostics are configured.
- Predict.fun withdrawal work must remain frontend/user-wallet authorized. Lotus must not store, import, export, request, or log user private keys, wallet seeds, Privy secrets, ZeroDev signer material, session cookies, or user JWTs as withdrawal authority.
- Predict.fun withdrawal adapters must default off and must not perform backend ZeroDev signing, Privy user impersonation, backend transaction broadcasting, or live withdrawal mutation until a reviewed user-authorized flow and controlled rehearsal artifact exist.
- Before wiring Predict.fun withdrawal instructions into any frontend rollout, run `npm run funding:predictfun-withdrawal-dry-run` and review a fresh, `COMPLETED`, redacted artifact. The artifact must show no backend signing, no backend broadcast, no private-key handling, no backend ZeroDev signing, no Privy impersonation, no live venue mutation, and no completion persistence.
- Predict.fun BSC USDT withdrawals require a user-controlled EVM-compatible receive wallet. The frontend must require the user to add or confirm an EVM withdrawal wallet before creating a Predict.fun withdrawal intent.
- User withdrawal wallet storage may contain only public receive metadata: address, chain family, label, verification timestamp, and created/updated timestamps. It must not contain private keys, seed phrases, wallet auth tokens, Privy secrets, ZeroDev signer material, session cookies, or user JWTs.
- Predict.fun real completion evidence must use exact BSC USDT evidence: submitted tx hash, BSC chain, configured USDT contract, destination wallet, amount greater than or equal to the withdrawal amount, and required confirmations.
- Before allowing Predict.fun completion persistence, run `npm run funding:predictfun-withdrawal-evidence-smoke` and `npm run funding:predictfun-withdrawal-completion-gate`; both must pass with a fresh, non-synthetic, redacted artifact backed by an operator-approved BSC evidence host and `persistedCompletionResult=false`.
- Predict.fun completion persistence must remain disabled by default and must only be enabled for a controlled one-venue test with `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES=PREDICT_FUN` or `PREDICT_FUN_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=true`.
- Run `npm run funding:predictfun-withdrawal-prod-readiness` before any Predict.fun withdrawal rollout decision. It must pass with exact BSC USDT evidence, a passed completion gate artifact, no fixture-backed evidence, no synthetic row, no stale artifact, and no unapproved evidence host.
- Production withdrawal completion persistence must reject localhost or loopback evidence hosts. Localhost evidence hosts are allowed only for controlled local/sandbox validation and only when explicitly approved in non-production envs.
- Opinion withdrawal work must remain user Safe-authorized. Do not handle user private keys, do not sign as a Safe owner, and do not broadcast from the backend. Opinion dry-run wiring is limited to BNB Smart Chain `USDT`; no rollout is allowed until `npm run funding:opinion-withdrawal-dry-run`, `npm run funding:opinion-withdrawal-evidence-smoke`, and `npm run funding:opinion-withdrawal-completion-gate` pass with fresh, non-synthetic, redacted evidence.
- Myriad withdrawal work must remain user wallet-authorized. Do not handle ThirdWeb/private-key export material, do not sign for users, and do not broadcast from the backend. Myriad dry-run wiring is limited to BNB Smart Chain `USD1`; no rollout is allowed until `npm run funding:myriad-withdrawal-dry-run`, `npm run funding:myriad-withdrawal-evidence-smoke`, and `npm run funding:myriad-withdrawal-completion-gate` pass with fresh, non-synthetic, redacted evidence.
- Run `npm run funding:withdrawal-rollout-status` before a broader withdrawal rollout review; it must show Limitless as `AUTO_RESOLUTION_ONLY` for EOA/user mode with disabled `PARTNER_MANAGED_BACKEND`, Predict.fun gated behind EVM wallet/BSC USDT readiness, Opinion gated behind user-signed Gnosis Safe adapter design, and Myriad gated behind user-wallet adapter design.

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
- `POLYMARKET_CLOB_HOST` uses the live V2 host `https://clob.polymarket.com`.
- The repo uses `@polymarket/clob-client-v2` and does not depend on legacy `@polymarket/clob-client` or `@polymarket/builder-signing-sdk`.
- V2 order creation uses `builderCode` and does not send legacy `nonce`, `feeRateBps`, or `taker` fields from Lotus.
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
