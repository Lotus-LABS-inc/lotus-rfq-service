# Lotus Production Rollout Master Runbook

Status: PRODUCTION ROLLOUT SOURCE OF TRUTH
Audience: engineering, security, infra, operator, market-integration owners
Last updated: 2026-05-06

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
| Quote mappings | Production quote routing reads venue market IDs only from approved shared-core/Postgres profiles. No venue market IDs or env override maps are allowed. |
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
| `<VENUE>_OPS_FUNDING_BALANCE_MODE` | `DISABLED`, `DIRECT_HTTP`, `MULTI_DIRECT_HTTP`, or `ONCHAIN_ERC20` | Default `DISABLED`; no static/fixture balances in production. |
| `<VENUE>_OPS_FUNDING_BALANCE_BASE_URL` | `https://api.venue.example` | Official/operator-approved venue API host only. |
| `<VENUE>_OPS_FUNDING_BALANCE_PATH` | `/portfolio/balance` | Exact reviewed read-only path. |
| `<VENUE>_OPS_FUNDING_BALANCE_PATH_BY_CHAIN_<CHAIN>` | `/portfolio/balance?chain_id=56` | Required only for `MULTI_DIRECT_HTTP`; chain key is normalized from the route destination chain, for example `BNB` or `SOLANA`. Missing paths fail closed. |
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

Quote source rules:

- Shared-core/Postgres is the production source of venue quote mappings.
- `EXECUTION_QUOTE_VENUE_MARKET_MAP_JSON` must not be configured in production.
- Quote readiness audit and smoke default to `POLYMARKET,LIMITLESS`; no env is required for that default.
- Missing executable quote IDs are blockers, not env TODOs.

Market data envs:

| Env | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `PREDEXON_BASE_URL` | If Predexon mappings used | `https://api.predexon.com` | No | Approved Predexon API host. |
| `PREDEXON_API_KEY` | If Predexon requires auth | `<server-side key>` | Yes | Secret manager only. |
| `PREDEXON_METADATA_VERSION` | Yes | `predexon-v2` | No | Version tag for current ingestion rows. |
| `PREDICT_MAINNET_BASE_URL` | If Predict.fun used | `https://api.predict.fun/` | No | Mainnet Predict.fun API host. |
| `PREDICT_TESTNET_BASE_URL` | If testnet rehearsals used | `https://api-testnet.predict.fun/` | No | Testnet only; not production runtime target. |
| `PREDICT_API_KEY` | If Predict.fun requires auth | `<server-side key>` | Yes | Secret manager only. |
| `PREDICT_ACCOUNT_AUTH_TIMEOUT_MS` | Optional | `15000` | No | Timeout for Predict.fun auth-message/JWT/account-linking calls. |
| `PREDICT_WS_MAINNET_URL` | If Predict.fun WS used | `wss://ws.predict.fun/` | No | Mainnet WS host. |
| Limitless official API host | Built-in default | `https://api.limitless.exchange` | No | Do not configure env unless a reviewed non-production or emergency override is needed. |
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
| `POLYMARKET_CLOB_HOST` | If Polymarket execution enabled | `https://clob.polymarket.com` | No | Official live V2 host only. |
| `POLYMARKET_CHAIN_ID` | If Polymarket execution enabled | `137` | No | Must match venue chain. |
| `POLYMARKET_API_KEY` | If live Polymarket submit enabled | `<secret>` | Yes | Server-side only. |
| `POLYMARKET_API_SECRET` | If live Polymarket submit enabled | `<secret>` | Yes | Server-side only. |
| `POLYMARKET_API_PASSPHRASE` | If live Polymarket submit enabled | `<secret>` | Yes | Server-side only. |
| `POLYMARKET_BUILDER_CODE` | If Polymarket V2 execution enabled | `<builder-code>` | No | Required for builder attribution; replaces old `POLY_BUILDER_*` auth headers. |
| `POLYMARKET_BUILDER_API_KEY` | If deposit-wallet deployment enabled | `<secret>` | Yes | Builder auth for relayer `WALLET-CREATE`; never expose to frontend. |
| `POLYMARKET_BUILDER_API_SECRET` | If deposit-wallet deployment enabled | `<secret>` | Yes | Builder auth for relayer `WALLET-CREATE`; never expose to frontend. |
| `POLYMARKET_BUILDER_API_PASSPHRASE` | If deposit-wallet deployment enabled | `<secret>` | Yes | Builder auth for relayer `WALLET-CREATE`; never expose to frontend. |
| `POLYMARKET_PRIVATE_KEY` | If live signing approved | `<secret>` | Yes | Must not exist unless signing model is explicitly approved. |
| `POLYMARKET_SIGNATURE_TYPE` | Optional | `POLY_1271` | No | New-user deposit-wallet orders require `POLY_1271`; legacy proxy/Safe users are separate. |
| `POLYMARKET_FUNDER_ADDRESS` | Optional | `0x1234...abcd` | No | Required only when signer and funder differ. |
| `POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED` | Yes | `false` | No | Enables deterministic user deposit-wallet account setup. |
| `POLYMARKET_DEPOSIT_WALLET_DEPLOY_ENABLED` | Yes | `true` | No | Allows relayer `WALLET-CREATE`; derived-only wallets remain pending when false. |
| `POLYMARKET_RELAYER_URL` | If deposit-wallet deployment enabled | `<relayer-url>` | No | Relayer used for `WALLET-CREATE`. |
| `POLYMARKET_DEPOSIT_WALLET_RPC_URL` | Recommended | `https://polygon.drpc.org` | No | Polygon RPC used to verify deployed bytecode when the relayer deployed check is stale. |
| `POLYMARKET_DEPOSIT_WALLET_FACTORY_ADDRESS` | Optional | SDK default | No | Override only if Polymarket changes the active factory. |
| `POLYMARKET_DEPOSIT_WALLET_IMPLEMENTATION_ADDRESS` | Optional | SDK default | No | Override only if Polymarket changes the active implementation. |
| `POLYMARKET_TICK_SIZE` | Optional | `0.01` | No | Must match market tick size when used. |
| `POLYMARKET_NEG_RISK` | Optional | `false` | No | Must match market risk mode. |
| `LIMITLESS_EXECUTION_MODE` | Yes | `disabled` | No | Initial production mode is `user_signed_backend_relay`. `delegated_partner_server_wallet` and `backend_signer` are non-default legacy/operator paths. |
| `LIMITLESS_LIVE_EXECUTION_ENABLED` | Yes | `false` | No | Must remain false until user-signed relay tiny live proof and settlement evidence review pass. |
| `LIMITLESS_PARTNER_ACCOUNT_ENABLED` | If Limitless relay/setup enabled | `true` | No | Required for EOA partner-account setup and user-signed backend relay. |
| `LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID` | If Limitless relay/setup enabled | `<secret>` | Yes | Server-side HMAC token id; never returned to frontend. |
| `LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET` | If Limitless relay/setup enabled | `<secret>` | Yes | Secret manager only; never logged or returned. |
| `LIMITLESS_EXECUTION_PRIVATE_KEY` | Legacy backend signer only | `<secret>` | Yes | Must remain absent for `user_signed_backend_relay`; do not configure before explicit backend-signer custody approval. |
| `OPINION_EXECUTION_MODE` | Yes | `disabled` | No | Set to `user_signed_backend_relay` only for prepare-only relay instructions until submit/status/settlement are reviewed. |
| `OPINION_LIVE_EXECUTION_ENABLED` | Yes | `false` | No | Private beta backend submission remains disabled; user-signed backend relay only after builder-mode relay is implemented and reviewed. |
| `MYRIAD_LIVE_EXECUTION_ENABLED` | Yes | `false` | No | Private beta backend submission remains disabled; user-signed flow only. |
| `PREDICT_FUN_EXECUTION_MODE` | Yes | `disabled` | No | Set to `user_signed_backend_relay` only after the user has an active Predict.fun venue-account binding. |
| `PREDICT_FUN_LIVE_EXECUTION_ENABLED` | Yes | `false` | No | Private beta backend relay remains disabled until signed OAuth relay, status/fill evidence, and settlement semantics are reviewed. |
| `PREDICT_FUN_EXECUTION_ORDER_CREATE_PATH` | Optional | `/v1/oauth/orders/create` | No | Predict.fun OAuth signed-order relay endpoint. |
| `PREDICT_FUN_EXECUTION_TIMEOUT_MS` | Optional | `15000` | No | Bounded timeout for Predict.fun OAuth order relay/status calls. |

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

Turnkey venue account rule for user-signed venues:

- The user's active Turnkey EVM wallet is the canonical identity wallet for Opinion, Predict.fun, and Limitless EOA partner-account setup.
- `POST /user/venue-accounts/{venue}/ensure` must be completed before any signed relay submit path is enabled for that venue.
- Opinion account bindings store safe public metadata for the Opinion Safe/multisig account; Predict.fun bindings store safe OAuth/connected-wallet account metadata; Limitless EOA partner-account bindings store only public wallet address, `profileId`, and account status metadata. Myriad is not account-linking for beta and remains wallet-call/user-signed.
- Batch setup uses `POST /user/venue-accounts/setup-batch` and `POST /user/venue-accounts/complete-batch`. The frontend may sign every returned setup request sequentially in one UX session, but each signature request must still name the venue, signer, request type, and exact message/payload.
- Predict.fun account linking uses `POST /user/venue-accounts/predict_fun/auth-message`, frontend Turnkey signing, then `POST /user/venue-accounts/predict_fun/complete-auth`. Lotus may exchange the signature for a temporary Predict JWT server-side, but it must not store or return that JWT.
- Limitless initial production setup is EOA/user-signed: `setup-batch` returns a Limitless ownership-message signature request for the user's Turnkey EVM wallet, and `complete-batch` creates/stores only public `profileId/account` metadata. `delegated_partner_server_wallet` remains a non-default operator path and must not be selected for the first user-owned-wallet rollout.
- Signed relay submit must reject any payload whose signer/account does not match the user's active Turnkey EVM wallet and active `user_venue_accounts` binding.
- Lotus must not backend-sign user orders, export keys, broadcast user transactions, store raw signatures as secrets, or mix Polymarket operator signer/proxy wallet state with user Turnkey venue-account bindings.
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
| `FUNDING_DIRECT_TRANSFER_QUOTES_ENABLED` | Yes | `true` | No | Allows same-chain ERC20 transfer routes when source and venue destination chain/token match; does not bypass venue readiness. |
| `FUNDING_DIRECT_TRANSFER_QUOTE_TTL_SECONDS` | Yes | `300` | No | Quote TTL policy for direct transfer routes. |
| `FUNDING_LIVE_SUBMIT_ENABLED` | Yes | `false` | No | Must stay false until live submit approval. |
| `FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED` | Yes | `false` | No | Must stay false until exact route gates pass. |
| `FUNDING_VENUE_READINESS_CHECKS_ENABLED` | Yes | `true` | No | Enable only after all configured venue read services are approved. |

Generic venue funding env pattern:

| Env pattern | Required | Example | Secret | Production expectation |
|---|---:|---|---:|---|
| `<VENUE>_FUNDING_DESTINATION_ADDRESS` | Yes per venue | `0x1234...abcd` | No | Operator-approved venue deposit/credit address. |
| `<VENUE>_FUNDING_DESTINATION_MODE` | Yes per venue | `VENUE_DEPOSIT_ENV` | No | Use `USER_VENUE_DEPOSIT_WALLET` only when Lotus has an active per-user `user_wallets` `VENUE_TARGET` row for the venue. |
| `<VENUE>_FUNDING_READINESS_MODE` | Yes per venue | `LIVE_READ` | No | Must not be `DISABLED` for production readiness. |
| `<VENUE>_FUNDING_READINESS_ENABLED` | Yes per venue | `true` | No | Enabled only for approved read service. |
| `<VENUE>_FUNDING_BALANCE_URL` | Yes per venue | `https://ops.example.com/lotus/polymarket/balance` | No | Operator-approved read endpoint. |
| `<VENUE>_FUNDING_READ_AUTH_MODE` | Yes per venue | `BEARER` | No | `NONE` only if service is otherwise protected. |
| `<VENUE>_FUNDING_READ_API_KEY` | If auth enabled | `<server-side key>` | Yes | Server-side only. |
| `<VENUE>_FUNDING_READ_TIMEOUT_MS` | Yes per venue | `5000` | No | Production timeout. |
| `<VENUE>_FUNDING_BALANCE_TOLERANCE` | Yes per venue | `0.000001` | No | Atomic-unit rounding tolerance only; must not cover material underfunding. |
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
| `POLYMARKET_CLOB_HOST` | `https://clob.polymarket.com` | Live V2 production host. |
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
| Official Limitless API host | `https://api.limitless.exchange` | Built-in code default; do not set env unless a reviewed override is needed. |
| `LIMITLESS_EXECUTION_MODE` | `user_signed_backend_relay` | Preferred initial production mode. Users sign with their Turnkey EVM wallets; Lotus only verifies and relays signed payloads with HMAC. |
| `LIMITLESS_LIVE_EXECUTION_ENABLED` | `false` | Must remain false until the user-signed relay harness and settlement evidence pass. |
| `LIMITLESS_PARTNER_ACCOUNT_ENABLED` | `true` | Required for EOA partner-account setup and user-signed relay. |
| `LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID` | `<secret>` | Server-side HMAC token id with account creation/relay scopes. |
| `LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET` | `<secret>` | Secret manager only; never logged or returned. |
| `LIMITLESS_LIVE_SUBMIT_PROFILE_ID` | `1291576` | Optional operator harness profile id. Normal user execution resolves this from `user_venue_accounts`. |
| `LIMITLESS_LIVE_SUBMIT_SIGNER_ADDRESS` | `0x...` | Harness-only expected Turnkey EVM signer address for a tiny user-signed relay test. |
| `LIMITLESS_LIVE_SUBMIT_ACCOUNT_ADDRESS` | `0x...` | Harness-only expected Limitless account address for a tiny user-signed relay test. |
| `LIMITLESS_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON` | `<signed order json>` | Harness-only user-signed Limitless order payload; never commit or store in long-lived artifacts. |
| `LIMITLESS_DELEGATED_PROFILE_ID` | `1291576` | Optional only for delegated/server-wallet operator harnesses; not the initial user-owned-wallet path. |
| `LIMITLESS_EXECUTION_PRIVATE_KEY` | empty unless legacy reviewed | Required only for `LIMITLESS_EXECUTION_MODE=backend_signer`; must stay absent for user-signed relay. |
| `LIMITLESS_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved funding destination. |
| `LIMITLESS_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `LIMITLESS_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/limitless/balance` | Approved balance read service. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_ENABLED` | `false` or diagnostic-only | Must not imply execution support. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY` | `<secret>` | Read-only/diagnostic HMAC token only. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET` | `<secret>` | Secret manager only. |
| `LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID` | `1291576` | Optional authorized profile id for diagnostics. |
| `LIMITLESS_FUNDING_WITHDRAWALS_ENABLED` | `true` | Required only for beta bridge-back route support. Does not enable partner-managed backend withdrawals. |
| `LIMITLESS_WITHDRAWAL_BRIDGE_BACK_ENABLED` | `true` | Enables single-source user-signed Base USDC -> Solana USDC bridge-back quote path. |
| `LIMITLESS_WITHDRAWAL_BRIDGE_BACK_SOURCE_CHAIN` | `BASE` | Source chain for user-signed bridge-back. |
| `LIMITLESS_WITHDRAWAL_BRIDGE_BACK_SOURCE_TOKEN_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base USDC token. |
| `LIMITLESS_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_ADDRESS` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Solana USDC mint. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED` | `false` | Must remain false until custody/security approval. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE` | `LIMITLESS` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID` | `SEC-2026-001` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_SECURITY_REVIEW_ID` | `CUSTODY-2026-001` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_OPERATOR_APPROVED_BY` | `ops-lead@example.com` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVED_AT` | `2026-04-27T10:00:00Z` | Required only for future approval gate. |
| `LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT` | `2026-05-27T10:00:00Z` | Required only for future approval gate. |

Limitless production rule: do not expose normal user withdrawal through Limitless partner-managed APIs. EOA/user mode is automatic market-resolution payout only. For beta, the user-facing withdrawal path is only the bridge-back quote from available Base USDC to Solana USDC, signed by the user. `POST /portfolio/withdraw` and `POST /portfolio/redeem` must not be callable from user paths.

### Opinion

| Env | Example | Production expectation |
|---|---|---|
| `OPINION_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Approved funding destination. |
| `OPINION_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `OPINION_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/opinion/balance` | Approved balance read service. |
| `OPINION_FUNDING_READ_API_KEY` | `<secret>` | Secret manager only. |
| `OPINION_FUNDING_PREFERRED_CHAIN` | `BNB` | Opinion beta funding rail. |
| `OPINION_FUNDING_PREFERRED_CHAIN_ID` | `56` | BNB Chain id. |
| `OPINION_FUNDING_PREFERRED_TOKEN` | `USDT` | Opinion spot account token. |
| `OPINION_OPS_FUNDING_BALANCE_MODE` | `DIRECT_HTTP` | Reads Opinion internal spot balance. |
| `OPINION_OPS_FUNDING_BALANCE_BASE_URL` | `https://openapi.opinion.trade/openapi` | Opinion OpenAPI host. |
| `OPINION_OPS_FUNDING_BALANCE_PATH` | `user/balance?chain_id=56` | Required `chain_id` query; keep relative so `/openapi` remains in the base URL. |
| `OPINION_OPS_FUNDING_BALANCE_PATH_BY_CHAIN_BNB` | `user/balance?chain_id=56` | Required for chain-aware `MULTI_DIRECT_HTTP` mode. Add a Solana path only after Opinion confirms the exact Solana chain id and that returned funds are usable trading balance. |
| `OPINION_OPS_FUNDING_BALANCE_AUTH_MODE` | `API_KEY` | Server-side OpenAPI key only. |
| `OPINION_OPS_FUNDING_BALANCE_API_KEY_HEADER` | `apikey` | Opinion OpenAPI header. |
| `OPINION_OPS_FUNDING_BALANCE_RESPONSE_FIELD` | `result.balances.0.availableBalance` | Internal available spot balance. |
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
| `MYRIAD_FUNDING_DESTINATION_ADDRESS` | `0x1234...abcd` | Fallback approved funding destination. Prefer the chain-specific vars below when Myriad exposes multiple deposit rails. |
| `MYRIAD_FUNDING_DESTINATION_ADDRESS_BSC` | `0x965D...b576` | Approved Myriad BSC deposit wallet for USDT. Must be copied from the Myriad account deposit UI/API. |
| `MYRIAD_FUNDING_DESTINATION_ADDRESS_POLYGON` | `0x965D...b576` | Approved Myriad Polygon deposit wallet for USDC when Myriad confirms the same EVM wallet is valid on Polygon. |
| `MYRIAD_FUNDING_DESTINATION_ADDRESS_SOLANA` | `9Nkk...t2i` | Approved Myriad Solana deposit wallet for USDC. |
| `MYRIAD_FUNDING_DESTINATION_MODE` | `VENUE_DEPOSIT_ENV` | Current beta path uses operator-approved venue deposit wallet, not user Turnkey destination mode. |
| `MYRIAD_FUNDING_PREFERRED_CHAIN` | `BSC` | Myriad beta direct-transfer funding rail. Myriad may also expose USDC/Solana and USDC/Polygon venue deposit options, but each rail requires explicit operator env alignment. |
| `MYRIAD_FUNDING_PREFERRED_CHAIN_ID` | `56` | BNB Smart Chain id. |
| `MYRIAD_FUNDING_PREFERRED_TOKEN` | `USDT` | Current beta funding token. Myriad venue accounting normalizes ready USDT/USDC/USD1 deposits to USD1 for withdrawals because Myriad internally converts the balance. |
| `MYRIAD_USDT_TOKEN_ADDRESS` | `0x55d398326f99059fF775485246999027B3197955` | BSC USDT contract for beta direct transfer. |
| `MYRIAD_FUNDING_READINESS_MODE` | `LIVE_READ` | Live/operator read mode. |
| `MYRIAD_FUNDING_BALANCE_URL` | `https://ops.example.com/lotus/myriad/balance` | Approved balance read service. |
| `MYRIAD_FUNDING_READ_API_KEY` | `<secret>` | Secret manager only. |
| `MYRIAD_OPS_FUNDING_BALANCE_MODE` | `ONCHAIN_ERC20` | Current beta readiness read for the Myriad account balance wallet. For withdrawal readiness, read the BSC USD1 balance on the exported Myriad EVM wallet. |
| `MYRIAD_OPS_FUNDING_BALANCE_RPC_URL` | `https://bsc.example.com/rpc` | Approved BSC RPC. |
| `MYRIAD_OPS_FUNDING_BALANCE_WALLET_ADDRESS` | `0x1234...abcd` | Must match the Myriad account/exported wallet that reflects venue-available funds for the active readiness read. |
| `MYRIAD_OPS_FUNDING_BALANCE_TOKEN_ADDRESS` | `0x8d0D...f08B0d` | BSC USD1 contract for Myriad withdrawal readiness. |
| `MYRIAD_OPS_FUNDING_BALANCE_TOKEN_DECIMALS` | `18` | BSC USD1 decimals. |
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
| `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_ENABLED` | `true` | Enables the user-signed BSC USDT -> Solana bridge-back leg after the Predict.fun venue exit reaches the user EVM wallet. |
| `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_SOURCE_CHAIN` | `BSC` | Predict.fun first-hop withdrawal rail. |
| `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_SOURCE_TOKEN_ADDRESS` | `0x55d398326f99059fF775485246999027B3197955` | BSC USDT contract. |
| `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_SYMBOL` | `USDC` | Solana bridge-back output token; LI.FI rejected Solana USDT in the controlled beta rehearsal. |
| `PREDICT_FUN_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_ADDRESS` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Solana USDC mint. |
| `PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE` | `BSC_ONCHAIN` | BSC USDT rail evidence. |
| `PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL` | `https://bsc.example.com/rpc` | Approved BSC RPC or wrapper. |
| `PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS` | `0x55d398326f99059fF775485246999027B3197955` | BSC USDT contract. |

Predict.fun production rule: user must have an EVM-compatible receiving wallet before starting BSC USDT withdrawal. In beta, the default withdrawal UX is Predict.fun -> user Turnkey EVM wallet on BSC USDT, then a user-signed LI.FI bridge-back to the user's Solana USDC wallet. Lotus does not sign, broadcast, custody, or impersonate Privy/ZeroDev users.

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

Beta withdrawal routing rule:

- Limitless is treated separately from proxy venues. Because beta funding lands as Base USDC and is available in the Limitless account, the Lotus withdrawal intent should prepare bridge-back from the user's available Base USDC path to the user's Solana wallet after evidence confirms funds are available. Do not wire user-facing routes to `POST /portfolio/withdraw` unless the partner-managed approval gate and custody/security review explicitly pass.
- Proxy/account venues must release funds from the venue proxy, Safe, embedded wallet, or venue-managed account to the user's EVM receive wallet first. When `<VENUE>_WITHDRAWAL_BRIDGE_BACK_ENABLED=true` and the user requests a Solana destination, Lotus prepares two legs: the venue release to the configured EVM receive wallet, then a user-signed LI.FI bridge-back leg from that EVM wallet to the final Solana wallet. The source can be the user's Turnkey EVM wallet or, for venues such as Myriad that release to an exported venue wallet, an explicitly configured external EVM source wallet. Lotus still does not sign, broadcast, custody, or move funds.
- No withdrawal flow may mark completion from a Solana destination request alone when funds are still inside a venue proxy/account.
- When a LI.FI bridge-back leg for a proxy/account venue is confirmed and it originates from the configured EVM source wallet, that bridge-back completion can satisfy the paired source-wallet exit leg. This avoids leaving full-exit withdrawals stuck in `PARTIALLY_COMPLETED` when the executable bridge transaction is the actual EVM source-wallet exit proof.
- The bridge-back leg may be shown before the venue release is complete, but frontend signing should wait until the first-hop EVM receipt is confirmed. LI.FI quote expiry remains enforced for bridge-back transaction submissions; stale manual venue-release references may still be recorded because they are evidence references, not executable bridge quotes.

Bridge-back env pattern for proxy/account venues:

| Env | Example | Meaning |
|---|---|---|
| `<VENUE>_WITHDRAWAL_BRIDGE_BACK_ENABLED` | `true` | Adds the automatic EVM-to-Solana bridge-back leg for Solana-destination withdrawals. |
| `<VENUE>_WITHDRAWAL_BRIDGE_BACK_SOURCE_CHAIN` | `BSC` or `POLYGON` | Chain where the venue first releases funds to the user's EVM wallet. |
| `<VENUE>_WITHDRAWAL_BRIDGE_BACK_SOURCE_TOKEN_ADDRESS` | `0x55d398...` | Token contract released by the venue on the source chain. |
| `<VENUE>_WITHDRAWAL_BRIDGE_BACK_SOURCE_WALLET_ADDRESS` | `0x4EE6...ab3B` | Optional external/exported EVM source wallet for the bridge-back leg. If unset, Lotus uses the user's active Turnkey EVM wallet metadata. |
| `<VENUE>_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_SYMBOL` | `USDT` or `USDC` | User-facing Solana token symbol for the bridge-back leg. |
| `<VENUE>_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_ADDRESS` | `Es9v...` or `EPjF...` | Solana token mint used by LI.FI. |

## 14. Artifact Freshness And Storage

Operator artifacts are deployment evidence. They must be generated fresh for production rollout and reviewed before signoff.

| Artifact family | Command | Required result |
|---|---|---|
| Funding readiness | `npm run funding:venue-gate-summary` | All production venues pass or are explicitly out of scope. |
| Funding readiness operator summary | `npm run report:funding:readiness` | Active rows show no blockers. Abandoned test intents must be `CANCELLED`, not left as active blocker rows. |
| Abandoned funding cleanup | `npm run admin:cancel-abandoned-funding-intents` | Dry-run first. Confirmed writes require `CANCEL_ABANDONED_FUNDING_CONFIRM=YES`; the script refuses ready-to-trade rows and ready reconciliation evidence. |
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
