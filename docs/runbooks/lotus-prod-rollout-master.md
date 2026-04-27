# Lotus Production Rollout Master Runbook

Status: PRODUCTION ROLLOUT SOURCE OF TRUTH
Audience: engineering, security, infra, operator, market-integration owners
Last updated: 2026-04-27

## 1. Purpose

This runbook is the single production rollout checklist for Lotus RFQ Service across:

- infrastructure and deployment
- auth, admin, security, and observability
- market ingestion and routeability
- RFQ, SOR, and execution-control readiness
- funding readiness and funding preflight enforcement
- withdrawal v0/v1 rollout and completion evidence gates

Detailed subsystem docs still exist, but this file is the master go/no-go checklist. If a subsystem doc conflicts with this file, treat this file as the production gate and update the subsystem doc before rollout.

Reference docs:

| Area | Detailed runbook |
|---|---|
| General ops and JWT rotation | `docs/runbooks/runbook.md` |
| Execution control | `docs/runbooks/execution-control-layer-runbook.md` |
| SOR and routeability | `docs/runbooks/sor-runbook.md` |
| Pair-first rollout | `docs/runbooks/pair-first-rollout-runbook.md` |
| Crypto pair-first prod | `docs/runbooks/crypto-pair-first-prod-runbook.md` |
| Funding flow | `docs/runbooks/funding-flow-v0-handoff.md` |
| Withdrawal adapter design | `docs/runbooks/withdrawal-flow-v1-adapter-design.md` |
| Security checklist | `docs/security/LOTUS_SECURITY_CHECKLIST.md` |
| Threat model | `docs/security/LOTUS_THREAT_MODEL.md` |
| OpenAPI | `docs/api/openapi.yaml` |

## 2. Production Boundary

Lotus production rollout is not one global switch. It is a staged rollout with independent gates for market routeability, execution authority, funding readiness, withdrawal instructions, and withdrawal completion persistence.

Hard production boundaries:

| Boundary | Production rule |
|---|---|
| Custody | Lotus remains Model A non-custodial unless a future security/custody review explicitly approves otherwise. |
| User signing | Users sign or authorize their own wallet actions. Lotus must not hold private keys or signer material. |
| Backend broadcast | Backend transaction broadcasting stays disabled unless explicitly approved for a specific adapter. |
| LI.FI live execution | Live LI.FI execution stays disabled until separately approved. |
| Venue execution | Live venue order submission stays disabled until the execution adapter and lane gates pass. |
| Funding enforcement | Route-level funding enforcement is enabled only for routes where every venue has fresh persisted `READY_TO_TRADE` evidence. |
| Withdrawal completion | Completion persistence is disabled by default and may be enabled only for one controlled venue at a time after fresh evidence gates pass. |
| Limitless withdrawals | Limitless normal user withdrawals are `AUTO_RESOLUTION_ONLY`; partner-managed backend withdrawal remains blocked until explicit custody/security/operator approval. |

## 3. Must-Stay-False Defaults

These flags must remain false in production until the named gate explicitly approves changing them.

| Env | Production default | May change only when |
|---|---:|---|
| `DEV_SIMULATION_PREVIEW_ENABLED` | `false` | Never for production. |
| `FUNDING_LIVE_SUBMIT_ENABLED` | `false` | Live LI.FI submit review passes and operator approves. |
| `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED` | `false` | Exact route readiness gate passes for every venue in the execution route. |
| `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED` | `false` | One-venue controlled completion persistence test is approved. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED` | `false` | Custody/security/operator approval explicitly accepts partner-managed backend withdrawals. |
| `POLYMARKET_BRIDGE_DRY_RUN_ONLY` | `true` | Future Bridge live execution review approves a different mode. |
| `PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY` | `true` | Predict.fun user-wallet rollout gate approves production behavior. |
| `MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY` | `true` | Myriad user-wallet rollout gate approves production behavior. |
| `OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY` | `true` | Opinion user-action rollout gate approves production behavior. |

## 4. Phase 0: Repository And Release Candidate

Before configuring production, create a release candidate from a clean commit.

| Check | Command or evidence | Required result |
|---|---|---|
| Working tree review | `git status --short` | Only intended durable changes. No `.env`; no generated `artifacts/funding/*` unless explicitly approved. |
| Typecheck | `npm run typecheck` | Pass. |
| Funding tests | `npm run test:funding-flow` | Pass. |
| Funding DB tests | `npm run test:funding-flow:db` | Pass. |
| Execution tests | `npm run test:execution-system` | Pass. |
| OpenAPI parse | Parse `docs/api/openapi.yaml` when edited. | Pass. |
| Diff hygiene | `git diff --check` | Pass. Line-ending warnings should be understood before merge. |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` | No moderate or higher unresolved finding. |

## 5. Infrastructure Environment

Production infra values must be stored in the deployment secret manager. Do not commit `.env` or print secrets in operator artifacts.

| Env | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `NODE_ENV` | Yes | `production` | No | Must be `production`. |
| `LOTUS_ENV` | Yes | `production` | No | Must be `production` for production-only gate behavior. |
| `HOST` | Yes | `0.0.0.0` | No | Bind address controlled by deployment platform. |
| `PORT` | Yes | `3000` | No | Bound by process manager or platform. |
| `LOG_LEVEL` | Yes | `info` | No | Use `info` or stricter in production; no debug secrets. |
| `REDIS_URL` | If queues/cache enabled | `redis://redis.internal:6379` | Yes | Internal Redis only when used by deployment. |
| `CANONICAL_SERVICE_BASE_URL` | If canonical service is externalized | `https://canonical.internal` | No | Internal/operator-approved service URL. |
| `DATABASE_URL` | Yes | `postgresql://lotus_app:<password>@db.example.com:5432/lotus` | Yes | Production database only. |
| `TEST_DATABASE_URL` | No | `postgresql://lotus_test:<password>@db.example.com:5432/lotus_test` | Yes | Test/CI only; not used by prod runtime. |
| `SUPABASE_DB_URL` | If using Supabase migrations | `postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require` | Yes | Product migration/verification target only. |
| `JWT_SECRET` | Yes | `<64+ char random secret>` | Yes | Rotate through secret manager; never reuse local value. |
| `ADMIN_JWT_USER_ID` | Yes | `admin-operator-prod` | No | Operator identifier used for admin JWT generation. |
| `DEV_SIMULATION_PREVIEW_ENABLED` | Yes | `false` | No | Must be false in production. |

Database rollout commands:

```powershell
npm run db:migrate:supabase
npm run db:verify:supabase
npm run db:schema:validate
```

### Dedicated Ops Read Service

Deploy a second Render Web Service for operator-approved funding balance and withdrawal evidence reads. This service uses the same repo but a separate entrypoint and must not expose user APIs, RFQ routes, admin routes, metrics, WebSockets, signing, broadcasting, LI.FI execution, or live withdrawal execution.

| Setting | Value |
|---|---|
| Render service name | `lotus-ops-read-service` |
| Root directory | `lotus-rfq-service` |
| Build command | `npm ci && npm run build` |
| Start command | `npm run start:ops-read` |
| Health check path | `/health` |
| Custom domain | `ops.uselotus.xyz` |

Ops read service routes:

| Route | Auth env | Response contract |
|---|---|---|
| `GET /health` | None | `{ status, service }` |
| `GET /lotus/polymarket/funding-balance` | `POLYMARKET_FUNDING_READ_API_KEY` | `{ usableBalance }` |
| `GET /lotus/limitless/funding-balance` | `LIMITLESS_FUNDING_READ_API_KEY` | `{ usableBalance }` |
| `GET /lotus/opinion/funding-balance` | `OPINION_FUNDING_READ_API_KEY` | `{ usableBalance }` |
| `GET /lotus/myriad/funding-balance` | `MYRIAD_FUNDING_READ_API_KEY` | `{ usableBalance }` |
| `GET /lotus/predictfun/funding-balance` | `PREDICT_FUN_FUNDING_READ_API_KEY` | `{ usableBalance }` |
| `GET /lotus/:venue/withdrawal-evidence` | `<VENUE>_WITHDRAWAL_EVIDENCE_API_KEY` | Normalized evidence object only |

Main backend URLs should point to `ops.uselotus.xyz` after deployment:

| Backend env | Production value |
|---|---|
| `POLYMARKET_FUNDING_BALANCE_URL` | `https://ops.uselotus.xyz/lotus/polymarket/funding-balance` |
| `LIMITLESS_FUNDING_BALANCE_URL` | `https://ops.uselotus.xyz/lotus/limitless/funding-balance` |
| `OPINION_FUNDING_BALANCE_URL` | `https://ops.uselotus.xyz/lotus/opinion/funding-balance` |
| `MYRIAD_FUNDING_BALANCE_URL` | `https://ops.uselotus.xyz/lotus/myriad/funding-balance` |
| `PREDICT_FUN_FUNDING_BALANCE_URL` | `https://ops.uselotus.xyz/lotus/predictfun/funding-balance` |
| `POLYMARKET_WITHDRAWAL_EVIDENCE_URL` | `https://ops.uselotus.xyz/lotus/polymarket/withdrawal-evidence` |
| `OPINION_WITHDRAWAL_EVIDENCE_URL` | `https://ops.uselotus.xyz/lotus/opinion/withdrawal-evidence` |
| `MYRIAD_WITHDRAWAL_EVIDENCE_URL` | `https://ops.uselotus.xyz/lotus/myriad/withdrawal-evidence` |
| `PREDICT_FUN_WITHDRAWAL_EVIDENCE_URL` | `https://ops.uselotus.xyz/lotus/predictfun/withdrawal-evidence` |
| `FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` | `ops.uselotus.xyz` |

Non-Polymarket ops funding balance routes must stay `DISABLED` until an operator-approved direct venue/API read path exists. Do not deploy a third read service unless a venue requires one; `ops.uselotus.xyz` should call the official venue/API read endpoint directly.

| Env pattern | Example | Production expectation |
|---|---|---|
| `<VENUE>_OPS_FUNDING_BALANCE_MODE` | `DISABLED`, `DIRECT_HTTP`, or `ONCHAIN_ERC20` | Default `DISABLED`; no static/fixture balances in production. |
| `<VENUE>_OPS_FUNDING_BALANCE_BASE_URL` | `https://api.venue.example` | Official/operator-approved venue API host only. |
| `<VENUE>_OPS_FUNDING_BALANCE_PATH` | `/portfolio/balance` | Exact reviewed read-only path. |
| `<VENUE>_OPS_FUNDING_BALANCE_AUTH_MODE` | `NONE`, `BEARER`, `API_KEY`, or `HMAC` | Use the least-privileged read-only auth supported by the venue. |
| `<VENUE>_OPS_FUNDING_BALANCE_API_KEY` | `<secret>` | Secret manager only. |
| `<VENUE>_OPS_FUNDING_BALANCE_API_KEY_HEADER` | `x-api-key` | Required only for `API_KEY` mode. |
| `<VENUE>_OPS_FUNDING_BALANCE_HMAC_SECRET` | `<secret>` | Required only for `HMAC` mode. |
| `<VENUE>_OPS_FUNDING_BALANCE_ON_BEHALF_OF_PROFILE_ID` | `<profile-id>` | Optional venue-specific delegated read scope. |
| `<VENUE>_OPS_FUNDING_BALANCE_RESPONSE_FIELD` | `account.usableBalance` | Optional dot path when venue response does not return top-level `usableBalance`, `availableBalance`, or `balance`. |
| `<VENUE>_OPS_FUNDING_BALANCE_RPC_URL` | `https://rpc.example` | Required only for `ONCHAIN_ERC20`; may contain provider credentials if the RPC provider requires them. |
| `<VENUE>_OPS_FUNDING_BALANCE_TOKEN_ADDRESS` | `0x...` | Required only for `ONCHAIN_ERC20`; ERC-20 token contract checked with `balanceOf`. |
| `<VENUE>_OPS_FUNDING_BALANCE_WALLET_ADDRESS` | `0x...` | Required only for `ONCHAIN_ERC20`; operator-approved funding/trading wallet to check. |
| `<VENUE>_OPS_FUNDING_BALANCE_TOKEN_DECIMALS` | `6` | Required only for `ONCHAIN_ERC20` when not six decimals. |

`ONCHAIN_ERC20` may be used only when the checked wallet balance is operator-approved as equivalent to usable venue trading balance. If the venue has an internal crediting step after on-chain receipt, keep the route disabled or pending until a venue/API credit confirmation exists.

## 6. Security And Admin Surface

Admin endpoints are production-sensitive and must use short-lived admin JWTs signed by the production `JWT_SECRET`.

| Area | Production requirement |
|---|---|
| Admin JWTs | Generate per operation; keep TTL short; never store in artifacts. |
| User JWTs | Must be signed by production `JWT_SECRET`; cross-user reads must remain blocked. |
| Metrics | `/metrics` must be internal-network only or protected by infrastructure controls. |
| Logs | No API keys, auth headers, DB URLs, private keys, raw provider payloads, or transaction internals. |
| Artifacts | Operator artifacts must be sanitized and treated as deployment evidence, not secrets storage. |
| Rollback | Keep previous `JWT_SECRET` and deployment image in secret/release manager for emergency rollback. |

## 7. Market And Routeability Rollout

Production market enablement must prove exact market identity, venue coverage, routeability, and operator lane approval.

| Step | Command or evidence | Required result |
|---|---|---|
| Refresh venue market state | `npm run batch:venues:refresh` | Completes without unresolved ingestion errors. |
| Sync current venue state | `npm run sync:limitless:live-current-state`, `npm run sync:opinion:current-state`, `npm run sync:predict:current-state` | Completes for venues used by production lanes. |
| Pair graph sync | `npm run sync:matching:pair-graph` | Pair graph is current. |
| Matching quality | `npm run report:matching:quality` | No blocking exactness issue for launch lanes. |
| Pair routeability | `npm run report:pair-graph:routeability` | Launch lanes routeable. |
| Crypto prod readiness | `npm run report:crypto:prod-readiness` | Pass or explicit operator waiver. |
| Admin lane approval | Admin lane approval artifact or DB evidence | Only reviewed lanes are approved. |

Market approval rules:

| Rule | Requirement |
|---|---|
| Exact market identity | Required before route approval. |
| Pair/tri compatibility | Required before pair or tri execution lanes. |
| Strict-all route | Requires every included venue to be covered by market and funding gates. |
| Stale evidence | Any stale market evidence blocks launch unless refreshed. |
| Operator approval | Required for every production market lane. |

Market data envs:

| Env | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `PREDEXON_BASE_URL` | If Predexon mappings used | `https://api.predexon.com` | No | Approved Predexon API host. |
| `PREDEXON_API_KEY` | If Predexon requires auth | `<server-side key>` | Yes | Secret manager only. |
| `PREDEXON_METADATA_VERSION` | Yes | `predexon-v2` | No | Version tag for current ingestion rows. |
| `PREDICT_MAINNET_BASE_URL` | If Predict.fun used | `https://api.predict.fun/` | No | Mainnet Predict.fun API host. |
| `PREDICT_TESTNET_BASE_URL` | If testnet rehearsals used | `https://api-testnet.predict.fun/` | No | Testnet only; not production runtime target. |
| `PREDICT_API_KEY` | If Predict.fun requires auth | `<server-side key>` | Yes | Secret manager only. |
| `PREDICT_WS_MAINNET_URL` | If Predict.fun WS used | `wss://ws.predict.fun/` | No | Mainnet WS host. |
| `LIMITLESS_BASE_URL` | If Limitless used | `https://api.limitless.exchange` | No | Official Limitless API host. |
| `LIMITLESS_API_KEY` | If Limitless read APIs require auth | `<server-side key>` | Yes | Secret manager only. |
| `OPINION_CLOB_BASE_URL` | If Opinion CLOB used | `https://proxy.opinion.trade:8443/openapi` | No | Approved Opinion CLOB API host. |
| `OPINION_OPENAPI_BASE_URL` | If Opinion metadata used | `https://openapi.opinion.trade/openapi` | No | Approved Opinion OpenAPI host. |
| `OPINION_API_KEY` | If Opinion requires auth | `<server-side key>` | Yes | Secret manager only. |
| `MYRIAD_BASE_URL` | If Myriad used | `https://api-v2.myriadprotocol.com/` | No | Approved Myriad API host. |
| `MYRIAD_API_KEY` | If Myriad requires auth | `<server-side key>` | Yes | Secret manager only. |
| `MYRIAD_METADATA_VERSION` | Yes if Myriad used | `myriad-v1` | No | Version tag for Myriad rows. |

## 8. Execution And RFQ Rollout

Execution readiness is separate from funding and withdrawal readiness.

| Env | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `POLYMARKET_EXECUTION_MODE` | Yes | `disabled` | No | Set to `v2` only for reviewed Polymarket V2 dry-run/live path. |
| `POLYMARKET_LIVE_EXECUTION_ENABLED` | Yes | `false` | No | Must remain false until live submit approval. |
| `POLYMARKET_CLOB_HOST` | If Polymarket execution enabled | `https://clob-v2.polymarket.com` before cutover; `https://clob.polymarket.com` after cutover | No | Official V2 host only. |
| `POLYMARKET_CHAIN_ID` | If Polymarket execution enabled | `137` | No | Must match venue chain. |
| `POLYMARKET_API_KEY` | If live Polymarket submit enabled | `<secret>` | Yes | Server-side only. |
| `POLYMARKET_API_SECRET` | If live Polymarket submit enabled | `<secret>` | Yes | Server-side only. |
| `POLYMARKET_API_PASSPHRASE` | If live Polymarket submit enabled | `<secret>` | Yes | Server-side only. |
| `POLYMARKET_BUILDER_CODE` | If Polymarket V2 execution enabled | `<builder-code>` | No | Required for builder attribution; replaces old `POLY_BUILDER_*` auth headers. |
| `POLYMARKET_PRIVATE_KEY` | If live signing approved | `<secret>` | Yes | Must not exist unless signing model is explicitly approved. |
| `POLYMARKET_SIGNATURE_TYPE` | Optional | `POLY_PROXY` | No | Must match account model. |
| `POLYMARKET_FUNDER_ADDRESS` | Optional | `0x1234...abcd` | No | Required only when signer and funder differ. |
| `POLYMARKET_TICK_SIZE` | Optional | `0.01` | No | Must match market tick size when used. |
| `POLYMARKET_NEG_RISK` | Optional | `false` | No | Must match market risk mode. |

Polymarket V2 migration notes:

| Item | Production requirement |
|---|---|
| Cutover | V2 go-live is April 28, 2026 around 11:00 UTC with expected downtime and open-order wipe. Do not rely on pre-cutover open orders. |
| SDK | Use `@polymarket/clob-client-v2`; legacy `@polymarket/clob-client` and `@polymarket/builder-signing-sdk` must not be dependencies. |
| Order fields | V2 order creation must use `builderCode` and must not send legacy `nonce`, `feeRateBps`, or `taker` fields from Lotus. |
| Collateral | Trading collateral is pUSD. API-only funding flows must account for USDC.e -> pUSD wrapping through Polymarket's Collateral Onramp. |
| Withdrawals | Polymarket Bridge withdrawals are separate from CLOB trading and must stay user-transfer/read-status oriented until separately approved. |

Execution go/no-go:

| Check | Command or evidence | Required result |
|---|---|---|
| Execution tests | `npm run test:execution-system` | Pass. |
| Execution system report | `npm run report:execution-system:v0` | No unresolved blocker for enabled lanes. |
| Live submit harness | `npm run execution:polymarket-live-submit-harness` | Only run when live submit review explicitly approves. |
| RFQ lifecycle | `npx vitest run test/integration/rfq-lifecycle.test.ts --maxWorkers=1` | Pass before production RFQ accept changes. |
| Funding preflight | Funding route gates below | Required before enabling enforcement for any route. |

## 9. Funding Production Rollout

Funding prepares venue-ready capital. It does not execute trades.

| Env | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `LIFI_API_BASE_URL` | If LI.FI quotes used | `https://li.quest/v1` | No | Official or approved LI.FI base URL. |
| `LIFI_API_KEY` | If LI.FI requires key | `<server-side key>` | Yes | Server-side only. |
| `LIFI_QUOTE_TIMEOUT_MS` | Yes | `10000` | No | Production timeout. |
| `LIFI_QUOTE_TTL_SECONDS` | Yes | `60` | No | Quote TTL policy. |
| `FUNDING_LIFI_QUOTES_ENABLED` | Yes | `true` | No | Quote-only can be enabled after review. |
| `FUNDING_LIVE_SUBMIT_ENABLED` | Yes | `false` | No | Must stay false until live submit approval. |
| `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED` | Yes | `false` | No | Must stay false until exact route gates pass. |
| `FUNDING_VENUE_READINESS_CHECKS_ENABLED` | Yes | `true` | No | Enable only after all configured venue read services are approved. |

Generic venue funding env pattern:

| Env pattern | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `<VENUE>_FUNDING_DESTINATION_ADDRESS` | Yes per venue | `0x1234...abcd` | No | Operator-approved venue deposit/credit address. |
| `<VENUE>_FUNDING_READINESS_MODE` | Yes per venue | `LIVE_READ` | No | Must not be `DISABLED` for production readiness. |
| `<VENUE>_FUNDING_READINESS_ENABLED` | Yes per venue | `true` | No | Enabled only for approved read service. |
| `<VENUE>_FUNDING_BALANCE_URL` | Yes per venue | `https://ops.example.com/lotus/polymarket/balance` | No | Operator-approved read endpoint. |
| `<VENUE>_FUNDING_READ_AUTH_MODE` | Yes per venue | `BEARER` | No | `NONE` only if service is otherwise protected. |
| `<VENUE>_FUNDING_READ_API_KEY` | If auth enabled | `<server-side key>` | Yes | Server-side only. |
| `<VENUE>_FUNDING_READ_TIMEOUT_MS` | Yes per venue | `5000` | No | Production timeout. |
| `<VENUE>_FUNDING_MIN_CONFIRMATIONS` | Yes per venue | `1` | No | Chain/venue-specific finality policy. |

Funding gate commands:

```powershell
npm run funding:polymarket-readiness-smoke
npm run funding:limitless-readiness-smoke
npm run funding:opinion-readiness-smoke
npm run funding:myriad-readiness-smoke
npm run funding:predictfun-readiness-smoke
npm run funding:venue-gate-summary
npm run funding:route-enforcement-ready:pair
npm run funding:route-enforcement-ready:tri
npm run funding:route-enforcement-ready:strict-all
```

Funding enforcement may be enabled only after:

| Gate | Required result |
|---|---|
| Every venue readiness smoke | `COMPLETED`, fresh, redacted, non-synthetic where required. |
| Route enforcement gate | Passes for the exact route being enabled. |
| Pair/tri/strict-all rehearsal | Completed for the exact route family being enabled. |
| Admin/operator review | Artifact reviewed and signed off. |
| Default safety | `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED=false` until rollout moment. |

## 10. Withdrawal Production Rollout

Withdrawal v0/v1 is non-custodial. Users create withdrawal intents, receive safe instructions, complete venue/user-wallet action themselves, submit a transaction hash/reference, and Lotus reads evidence before completion persistence.

Global withdrawal envs:

| Env | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_GATE_ENABLED` | Yes | `true` | No | Must be enabled. |
| `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED` | Yes | `false` | No | Default false; one-venue controlled tests only. |
| `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES` | Controlled only | `PREDICT_FUN` | No | Empty by default; exactly one venue during controlled persistence. |
| `FUNDING_WITHDRAWAL_COMPLETION_SMOKE_MAX_AGE_HOURS` | Yes | `24` | No | Freshness window for smoke artifacts. |
| `FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` | Yes | `ops.example.com,bsc-mainnet.example.com` | No | Production-approved evidence hosts only. |

Generic withdrawal evidence env pattern:

| Env pattern | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `<VENUE>_WITHDRAWAL_EVIDENCE_MODE` | Yes per venue | `LIVE_READ` | No | Must not be fixture-backed for production. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_ENABLED` | Yes per venue | `true` | No | Enabled only after read service review. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_URL` | If service-backed | `https://ops.example.com/lotus/polymarket/withdrawal-evidence` | No | Operator-approved read endpoint. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_AUTH_MODE` | Yes per venue | `BEARER` | No | `NONE` only if service is otherwise protected. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_API_KEY` | If auth enabled | `<server-side key>` | Yes | Server-side only. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_TIMEOUT_MS` | Yes per venue | `5000` | No | Production timeout. |
| `<VENUE>_WITHDRAWAL_MIN_CONFIRMATIONS` | Yes per venue | `1` | No | Chain/venue-specific finality. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` | Yes per venue | `ops.example.com` | No | Must not be localhost in production. |
| `<VENUE>_WITHDRAWAL_EVIDENCE_SMOKE_ARTIFACT_PATH` | Recommended | `artifacts/funding/polymarket-withdrawal-evidence-smoke-test.json` | No | Latest reviewed smoke artifact path. |

Withdrawal gate commands:

```powershell
npm run funding:withdrawal-rollout-status
npm run funding:withdrawal-completion-gate-summary
npm run funding:polymarket-withdrawal-evidence-smoke
npm run funding:polymarket-withdrawal-completion-gate
npm run funding:opinion-withdrawal-evidence-smoke
npm run funding:opinion-withdrawal-completion-gate
npm run funding:myriad-withdrawal-evidence-smoke
npm run funding:myriad-withdrawal-completion-gate
npm run funding:predictfun-withdrawal-evidence-smoke
npm run funding:predictfun-withdrawal-completion-gate
npm run funding:limitless-partner-managed-withdrawal-gate
```

Withdrawal completion persistence may be enabled only after:

| Gate | Required result |
|---|---|
| Evidence smoke | `COMPLETED`, fresh, redacted, non-synthetic, approved-host backed. |
| Completion gate | `PASSED` for the exact venue. |
| Controlled persistence scope | `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES` contains exactly one venue. |
| Production host check | No localhost, loopback, fixture, or stub evidence in production. |
| Exact evidence | Venue, tx hash, destination wallet, chain, token, amount, and confirmations match. |
| Funding records | Completion persistence must not mutate funding readiness records directly. |

## 11. Venue Rollout Matrix

| Venue | Funding readiness | Withdrawal mode | Production withdrawal status | Main blocker |
|---|---|---|---|---|
| `POLYMARKET` | Generic balance-read readiness with route gates. | Bridge user-transfer/user action. | Bridge dry-run and manual transfer rehearsal exist; not broad live execution. | Real Bridge completion evidence and recovery policy must remain reviewed. |
| `LIMITLESS` | Generic balance-read readiness and diagnostics. | `AUTO_RESOLUTION_ONLY` for EOA; disabled `PARTNER_MANAGED_BACKEND` for HMAC withdrawal. | Normal user withdrawal unsupported. | Partner-managed backend withdrawal needs explicit custody/security/operator approval. |
| `OPINION` | Generic balance-read readiness. | User-authorized Safe/EOA candidate. | BSC USDT dry-run/evidence path implemented. | Broader multi-chain/stable support needs separate rail review. |
| `MYRIAD` | Generic balance-read readiness. | User-wallet candidate. | BSC USD1 dry-run/evidence path implemented. | USD1 address and production BSC evidence host must be operator approved. |
| `PREDICT_FUN` | Generic balance-read readiness. | User-wallet Privy/ZeroDev candidate. | BSC USDT dry-run/evidence path implemented. | User must provide EVM receiving wallet; production gate must pass. |

## 12. Venue-Specific Production Env Tables

### Polymarket

| Env | Example | Production expectation |
|---|---|---|
| `POLYMARKET_EXECUTION_MODE` | `disabled` | Set to `v2` only after V2 readiness review. |
| `POLYMARKET_LIVE_EXECUTION_ENABLED` | `false` | Must remain false until live submit approval. |
| `POLYMARKET_CLOB_HOST` | `https://clob-v2.polymarket.com` or `https://clob.polymarket.com` | Use pre-cutover V2 host before 2026-04-28; post-cutover production host after V2 takes over. |
| `POLYMARKET_CHAIN_ID` | `137` | Polygon mainnet. |
| `POLYMARKET_BUILDER_CODE` | `<builder-code>` | Required for V2 builder attribution. |
| `POLYMARKET_API_KEY` | `<secret>` | Secret manager only. |
| `POLYMARKET_API_SECRET` | `<secret>` | Secret manager only. |
| `POLYMARKET_API_PASSPHRASE` | `<secret>` | Secret manager only. |
| `POLYMARKET_PRIVATE_KEY` | `<secret>` | Secret manager only; live signing requires explicit approval. |
| `POLYMARKET_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved Polymarket funding destination. |
| `POLYMARKET_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `POLYMARKET_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/polymarket/balance` | Approved balance read service. |
| `POLYMARKET_FUNDING_READ_AUTH_MODE` | `BEARER` | Auth mode for read service. |
| `POLYMARKET_FUNDING_READ_API_KEY` | `<secret>` | Secret manager only. |
| `POLYMARKET_BRIDGE_WITHDRAWALS_ENABLED` | `true` | Only after Bridge dry-run artifact review. |
| `POLYMARKET_BRIDGE_API_BASE_URL` | `https://bridge.polymarket.com` | Verified official/operator-approved Bridge base URL. |
| `POLYMARKET_BRIDGE_AUTH_MODE` | `NONE` or `BEARER` | Match Bridge/operator service auth. |
| `POLYMARKET_BRIDGE_API_KEY` | `<secret>` | Secret manager only when required. |
| `POLYMARKET_BRIDGE_DRY_RUN_ONLY` | `true` | Keep true until live Bridge wiring review. |
| `POLYMARKET_WITHDRAWAL_EVIDENCE_MODE` | `LIVE_READ` | Non-fixture production evidence. |
| `POLYMARKET_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS` | `bridge.polymarket.com,ops.example.com` | No localhost in production. |

### Limitless

| Env | Example | Production expectation |
|---|---|---|
| `LIMITLESS_BASE_URL` | `https://api.limitless.exchange` | Official Limitless base URL. |
| `LIMITLESS_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved funding destination. |
| `LIMITLESS_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `LIMITLESS_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/limitless/balance` | Approved balance read service. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_ENABLED` | `false` or diagnostic-only | Must not imply execution support. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY` | `<secret>` | Read-only/diagnostic HMAC token only. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET` | `<secret>` | Secret manager only. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID` | `1291576` | Optional authorized profile id for diagnostics. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED` | `false` | Must remain false until custody/security approval. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE` | `LIMITLESS` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID` | `SEC-2026-001` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_SECURITY_REVIEW_ID` | `CUSTODY-2026-001` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_OPERATOR_APPROVED_BY` | `ops-lead@example.com` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVED_AT` | `2026-04-27T10:00:00Z` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT` | `2026-05-27T10:00:00Z` | Required only for future approval gate. |

Limitless production rule: do not expose normal user withdrawal. EOA/user mode is automatic market-resolution payout only. `POST /portfolio/withdraw` and `POST /portfolio/redeem` must not be callable from user paths.

### Opinion

| Env | Example | Production expectation |
|---|---|---|
| `OPINION_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved funding destination. |
| `OPINION_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `OPINION_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/opinion/balance` | Approved balance read service. |
| `OPINION_FUNDING_READ_API_KEY` | `<secret>` | Secret manager only. |
| `OPINION_FUNDING_WITHDRAWALS_ENABLED` | `true` | Only after user-action gate review. |
| `OPINION_WITHDRAWAL_ADAPTER_ENABLED` | `true` | Only for approved dry-run/user-action flow. |
| `OPINION_WITHDRAWAL_ADAPTER_MODE` | `USER_SAFE_DRY_RUN` | No backend Safe signing. |
| `OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY` | `true` | Keep true until live review. |
| `OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE` | `BSC_ONCHAIN` | BSC USDT rail evidence. |
| `OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL` | `https://bsc.example.com/rpc` | Approved BSC RPC or wrapper. |
| `OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS` | `0x55d398326f99059fF775485246999027B3197955` | BSC USDT contract. |

### Myriad

| Env | Example | Production expectation |
|---|---|---|
| `MYRIAD_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved funding destination. |
| `MYRIAD_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `MYRIAD_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/myriad/balance` | Approved balance read service. |
| `MYRIAD_FUNDING_READ_API_KEY` | `<secret>` | Secret manager only. |
| `MYRIAD_FUNDING_WITHDRAWALS_ENABLED` | `true` | Only after user-wallet gate review. |
| `MYRIAD_WITHDRAWAL_ADAPTER_ENABLED` | `true` | Only for approved dry-run/user-wallet flow. |
| `MYRIAD_WITHDRAWAL_ADAPTER_MODE` | `USER_WALLET_DRY_RUN` | No backend ThirdWeb signing. |
| `MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY` | `true` | Keep true until live review. |
| `MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE` | `BSC_ONCHAIN` | BSC USD1 rail evidence. |
| `MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL` | `https://bsc.example.com/rpc` | Approved BSC RPC or wrapper. |
| `MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_USD1_ADDRESS` | `<BSC USD1 contract>` | Must be operator verified before prod. |

### Predict.fun

| Env | Example | Production expectation |
|---|---|---|
| `PREDICT_FUN_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved funding destination. |
| `PREDICT_FUN_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `PREDICT_FUN_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/predictfun/balance` | Approved balance read service. |
| `PREDICT_FUN_FUNDING_READ_API_KEY` | `<secret>` | Secret manager only. |
| `PREDICT_FUN_FUNDING_WITHDRAWALS_ENABLED` | `true` | Only after user-wallet gate review. |
| `PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED` | `true` | Only for approved user-wallet flow. |
| `PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE` | `USER_WALLET_DRY_RUN` | No backend Privy/ZeroDev signing. |
| `PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY` | `true` | Keep true until live review. |
| `PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE` | `BSC_ONCHAIN` | BSC USDT rail evidence. |
| `PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL` | `https://bsc.example.com/rpc` | Approved BSC RPC or wrapper. |
| `PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS` | `0x55d398326f99059fF775485246999027B3197955` | BSC USDT contract. |

Predict.fun production rule: user must have an EVM-compatible receiving wallet before starting BSC USDT withdrawal.

## 13. User Withdrawal Wallet Requirement

For user-wallet venues, the frontend should require or strongly prompt a saved EVM receiving wallet before withdrawal intent creation.

| Venue | Required receive wallet | Token/chain |
|---|---|---|
| `PREDICT_FUN` | EVM-compatible wallet | BSC USDT |
| `MYRIAD` | EVM-compatible wallet | BSC USD1 |
| `OPINION` | EVM-compatible wallet or Safe-compatible destination | BSC USDT for first rail |
| `POLYMARKET` | Destination compatible with Bridge quote | Polymarket Bridge-supported asset/chain |
| `LIMITLESS` | Not applicable for normal user withdrawal | Automatic resolution payout only |

Stored wallet metadata must be public receive metadata only. Never store private keys, seed phrases, Privy secrets, ZeroDev signer material, ThirdWeb signer material, Safe owner keys, session cookies, or user JWTs.

## 14. Artifact Freshness And Storage

Operator artifacts are deployment evidence. They must be generated fresh for production rollout and reviewed before signoff.

| Artifact family | Command | Required result |
|---|---|---|
| Funding readiness | `npm run funding:venue-gate-summary` | All production venues pass or are explicitly out of scope. |
| Route enforcement | `npm run funding:route-enforcement-ready -- <ROUTE_OR_LANE_ID>` or one of the pair/tri/strict-all convenience scripts | Exact production route passes. |
| Withdrawal rollout | `npm run funding:withdrawal-rollout-status` | No unreviewed blocker for enabled venues. |
| Withdrawal completion | `npm run funding:withdrawal-completion-gate-summary` | Enabled venues pass. |
| Predict.fun prod readiness | `npm run funding:predictfun-withdrawal-prod-readiness` | Pass before Predict.fun production withdrawal completion. |
| Limitless partner gate | `npm run funding:limitless-partner-managed-withdrawal-gate` | Expected `BLOCKED` unless custody/security approval exists. |

Generated `artifacts/funding/*` should normally remain out of source control. Commit artifacts only when an operator explicitly requests a permanent audit artifact.

## 15. Go/No-Go Checklist

Production is go only when every required row is signed off.

| Area | Go condition | Owner | Signoff |
|---|---|---|---|
| Infra | Production envs set in secret manager; DB migrations verified. | Infra | Pending |
| Security | Security checklist reviewed; no secret leakage; admin JWT process tested. | Security | Pending |
| Markets | Exact market lanes approved; routeability artifacts fresh. | Market ops | Pending |
| Execution | Execution tests pass; live submit flags match approval state. | Execution | Pending |
| Funding | Venue readiness and route enforcement artifacts pass. | Funding ops | Pending |
| Withdrawals | Rollout status and completion gates pass for enabled venues. | Funding ops | Pending |
| Limitless | Partner-managed backend remains blocked unless explicit approval exists. | Security | Pending |
| Observability | Metrics/logs/alerts configured without secrets. | Infra | Pending |
| Rollback | Previous image/env rollback documented. | Release owner | Pending |

No-go conditions:

| Condition | Action |
|---|---|
| `.env` or secrets staged | Stop rollout; unstage and rotate if exposed. |
| Generated artifacts accidentally staged | Stop rollout; intentionally decide whether they are audit artifacts. |
| Funding route missing one venue readiness gate | Keep funding enforcement disabled for that route. |
| Withdrawal evidence is fixture-backed or localhost in production | Block completion persistence. |
| Limitless partner-managed gate missing approval fields | Keep blocked. |
| Any live submit/broadcast flag enabled without approval | Stop rollout. |

## 16. Rollback Plan

Rollback must be prepared before production enablement.

| Rollback item | Required action |
|---|---|
| Service image | Keep previous deployable image/tag. |
| Database | Migrations must be backwards-safe or have documented rollback SQL. |
| JWT | Keep previous `JWT_SECRET` in secret manager until rollout is stable. |
| Funding enforcement | Set `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED=false`. |
| LI.FI live submit | Set `FUNDING_LIVE_SUBMIT_ENABLED=false`. |
| Withdrawal completion persistence | Set `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED=false` and clear `FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES`. |
| Venue adapters | Set per-venue withdrawal adapter flags to false. |
| Market lanes | Disable lane approval through admin/operator process. |

## 17. Final Production Command Pack

Run this pack for a release candidate unless a step is explicitly out of scope for the rollout.

```powershell
npm run typecheck
npm run test:funding-flow
npm run test:funding-flow:db
npm run test:execution-system
npm run db:migrate:supabase
npm run db:verify:supabase
npm run db:schema:validate
npm run funding:venue-gate-summary
npm run funding:withdrawal-rollout-status
npm run funding:withdrawal-completion-gate-summary
npm run funding:limitless-partner-managed-withdrawal-gate
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Additional route-specific commands:

```powershell
npm run funding:route-enforcement-ready:pair
npm run funding:route-enforcement-ready:tri
npm run funding:route-enforcement-ready:strict-all
```

Additional venue-specific withdrawal commands:

```powershell
npm run funding:polymarket-withdrawal-evidence-smoke
npm run funding:polymarket-withdrawal-completion-gate
npm run funding:opinion-withdrawal-evidence-smoke
npm run funding:opinion-withdrawal-completion-gate
npm run funding:myriad-withdrawal-evidence-smoke
npm run funding:myriad-withdrawal-completion-gate
npm run funding:predictfun-withdrawal-evidence-smoke
npm run funding:predictfun-withdrawal-completion-gate
npm run funding:predictfun-withdrawal-prod-readiness
```

## 18. Production Rollout Decision

Use this table for the final release decision.

| Decision item | Value |
|---|---|
| Release commit | `<git sha>` |
| Deployment target | `<prod environment>` |
| Enabled market lanes | `<lane ids>` |
| Funding enforcement enabled | `false` or `<exact route ids>` |
| Live LI.FI submit enabled | `false` |
| Live venue submit enabled | `false` or `<approved adapter>` |
| Withdrawal venues enabled | `<venue list>` |
| Withdrawal completion persistence enabled | `false` or `<one approved venue>` |
| Limitless partner-managed backend enabled | `false` unless explicit custody/security approval exists |
| Security approver | `<name/ref>` |
| Operator approver | `<name/ref>` |
| Rollback owner | `<name/ref>` |

Do not proceed if any value is unknown, stale, or inconsistent with the safety boundaries above.
