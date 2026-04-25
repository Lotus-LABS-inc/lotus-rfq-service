# Lotus Comprehensive Security Audit

Status: BASELINE AUDIT COMPLETE; P0 DEPENDENCY REMEDIATION APPLIED; REMAINING ADVISORIES TRIAGED  
Date: 2026-04-25  
Mode: comprehensive  
Scope: repo-wide backend, API, execution, funding design, venue adapters, CI/CD, dependencies, and docs

## 1. Executive Summary

Lotus has strong safety design in the core trading path: matcher output is treated as evidence, execution requires operator-approved lanes, scope tokens bind execution scope, accounting waits for settlement/finality, and Polymarket live execution is feature-flagged and fail-closed by default.

The main security risks found in this pass are supply-chain and operational-hardening issues, not matcher or execution-authority bypasses.

Highest-priority items found in the baseline audit:

- Critical and high dependency advisories were present in the baseline lockfile, including `fast-jwt`, `protobufjs` via OpenTelemetry, `fastify`, and `drizzle-orm`.
- GitHub Actions use mutable major-version action tags and do not set explicit least-privilege `permissions`.
- Local simulation preview can bypass admin JWT on loopback when `DEV_SIMULATION_PREVIEW_ENABLED=true`; this is acceptable for local development only and must be blocked in production.
- Funding is still planned, so LiFi integration must be implemented with explicit quote, route, destination, and venue-readiness trust boundaries.

P0 dependency remediation was applied after the baseline audit:

- `@opentelemetry/sdk-node` upgraded from `0.212.0` to `0.215.0`.
- `fastify` upgraded from `5.7.4` to `5.8.5`.
- `drizzle-orm` upgraded from `0.44.7` to `0.45.2`.
- `drizzle-kit` upgraded from `0.31.9` to `0.31.10`.
- Transitive `fast-jwt` upgraded from `6.1.0` to `6.2.2`.
- Transitive OpenTelemetry `protobufjs` paths upgraded to fixed `7.5.5` and `8.0.1` versions.

After remediation and remaining-advisory triage, production audit reports zero critical, zero high, and zero moderate advisories. Remaining production advisories are low-severity transitive Polymarket/Ethers SDK issues with no upstream fixed version available in the current SDK line.

No committed `.env` file or obvious committed live secret was found in this pass. Local `.env` was intentionally not printed or staged.

## 2. Verified Stack Summary

| Area | Current State |
|---|---|
| Language | TypeScript on Node.js 22+ |
| API framework | Fastify |
| Auth | `@fastify/jwt`, user/admin JWT middleware |
| Database | PostgreSQL via `pg`; Redis via `ioredis` |
| Execution | `src/execution-system`, `src/execution-control` |
| Venue adapters | Test adapter, NotConfigured adapter, Polymarket V2 dry-run/live contract |
| Funding | Architecture and handoff docs only; no runtime funding flow yet |
| CI | GitHub Actions with Postgres and Redis service containers |
| Docs | Backend map, OpenAPI, runbooks, funding handoff |

## 3. Attack Surface Reviewed

| Entry Point | Auth Boundary | Security Notes |
|---|---|---|
| `GET /health` | public | Low-risk health response. |
| `GET /metrics` | public | Should be reviewed before production exposure because metrics can reveal operational state. |
| `GET /resolution-risk/*` | public | Read-only but can expose market/risk metadata. |
| `POST /rfq` | user JWT | Request body validated with Zod. |
| `POST /rfq/:id/execution-scope-token` | user JWT | Scope token is short-lived and bound to scope metadata. |
| `POST /rfq/:id/accept` | user JWT | Can trigger execution only through execution-control and approved-lane enforcement. |
| `GET /rfq/:id/executions/:executionId/status` | user JWT | Returns execution status; should remain secret-free. |
| `/admin/*` | admin JWT | Mounted admin routes use admin pre-handler. |
| `/admin/simulation*` | admin JWT or loopback preview | Preview bypass only when enabled and loopback detected. Production must keep disabled. |
| `POST /lp/:id/quotes` | LP auth | LP quote intake boundary. |
| `GET /ws` | websocket | Publishes RFQ domain events by topic. Needs production auth review if exposed beyond trusted clients. |
| `src/api/combo.routes.ts` | unregistered | Present route file but not mounted in `buildServer`; should remain documented as unregistered unless mounted later. |

## 4. Findings

### [RESOLVED P0] SEC-001: Critical Dependency Advisories In Baseline Lockfile

**Confidence:** 10/10  
**Category:** OWASP A03 - Software Supply Chain Failures  
**Location:** `package-lock.json`, `package.json`  
**Baseline Evidence:** `npm audit --audit-level=moderate --json` reported 40 total vulnerabilities: 15 critical, 4 high, 9 moderate, 12 low.

Confirmed baseline critical/high packages included:

- `fast-jwt` through `@fastify/jwt`, including critical JWT cache/confusion advisories.
- `protobufjs` through `@opentelemetry/sdk-node`, including arbitrary code execution advisory.
- `fastify`, including body schema validation/content-type bypass advisories.
- `drizzle-orm`, including SQL identifier escaping advisory.

**Exploit Scenario:** An attacker targets an affected parser, JWT verification path, content-type validation boundary, or vulnerable dependency code path exposed through API requests or telemetry processing.

**Remediation Applied:** A controlled dependency upgrade pass was run, not a blind `npm audit fix`.

Updated packages:

- `@opentelemetry/sdk-node@0.215.0`
- `fastify@5.8.5`
- `drizzle-orm@0.45.2`
- `drizzle-kit@0.31.10`
- `fast-jwt@6.2.2`

Verification:

- `npm run typecheck` passed.
- `npm run test:execution-system` passed.
- `npx vitest run test/integration/rfq-lifecycle.test.ts --maxWorkers=1` passed.
- `npx vitest run tests/admin-crypto-routes.test.ts tests/admin-execution-venues-routes.test.ts --maxWorkers=1` passed.
- `npm audit --omit=dev --audit-level=moderate --json` now reports zero critical and zero high advisories.

**Priority:** P0 resolved for auth/runtime dependencies. Remaining moderate production advisories were resolved in the remaining-advisory triage pass below.

### [TRIAGED] SEC-001A: Remaining Dependency Advisories After P0 Remediation

**Confidence:** 10/10  
**Category:** OWASP A03 - Software Supply Chain Failures  
**Location:** `package-lock.json`, `package.json`  
**Triage Date:** 2026-04-25

**Current Audit Result After Triage:**

- `npm audit --omit=dev --audit-level=moderate --json`: zero critical, zero high, zero moderate, 12 low production advisories.
- `npm audit --audit-level=moderate --json`: zero critical, one high, four moderate, 12 low total advisories.
- The remaining high/moderate advisories are dev-tooling only.

**Controlled Upgrade Applied:**

The following transitive packages were refreshed within existing semver ranges:

- `axios` upgraded to `1.15.2`.
- `follow-redirects` upgraded to `1.16.0`.
- `yaml` upgraded to `2.8.3`.
- `flatted` upgraded to `3.4.2`.
- `brace-expansion` upgraded to `1.1.14` / `5.0.5`.
- `postcss` upgraded to `8.5.10`.

No funding runtime, matcher, execution, or API behavior was changed.

**Remaining Advisory Decisions:**

| Advisory Family | Severity | Parent Package(s) | Runtime Exposure | Decision | Rationale / Next Action |
|---|---:|---|---|---|---|
| `@ethersproject/*`, `elliptic` | Low | Direct `@ethersproject/wallet@5.8.0`; `@polymarket/clob-client-v2@1.0.2` | Production dependency, but Polymarket live submit remains feature-flagged and disabled by default | Risk-accept temporarily | `@polymarket/clob-client-v2@1.0.2` is latest and still depends on Ethers v5. Do not fork or override cryptographic dependencies without SDK compatibility proof. Revisit when Polymarket publishes an Ethers v6/fixed SDK or when live mode activation is scheduled. |
| `@polymarket/clob-client-v2` | Low | Direct `@polymarket/clob-client-v2@1.0.2` | Production dependency; live submit disabled by default | Risk-accept temporarily | The advisory is inherited from Ethers v5. Adapter remains fail-closed unless explicit feature flags and complete credentials are present. Live activation remains blocked on operator checklist and SDK readiness. |
| `axios`, `follow-redirects` | Moderate before triage | `@limitless-exchange/sdk`, `@polymarket/clob-client-v2` | Production dependency | Upgrade completed | Lockfile now resolves `axios@1.15.2` and `follow-redirects@1.16.0`; production moderate advisory cleared. |
| `yaml` | Moderate before triage | `@opentelemetry/configuration`, `knip`, `vite` | Production via OpenTelemetry config; dev via Knip/Vite | Upgrade completed | Lockfile now resolves `yaml@2.8.3`; production moderate advisory cleared. |
| `flatted` | High before triage | `eslint -> file-entry-cache -> flat-cache` | Dev-only lint/cache path | Upgrade completed | Lockfile now resolves `flatted@3.4.2`; high advisory cleared from this path. |
| `brace-expansion` | Moderate before triage | ESLint and TypeScript ESLint minimatch paths | Dev-only lint path | Upgrade completed | Lockfile now resolves fixed `brace-expansion` versions; advisory cleared. |
| `postcss` | Moderate before triage | `vite` through `vitest` | Dev-only test/dev-server path | Upgrade completed | Lockfile now resolves `postcss@8.5.10`; advisory cleared. |
| `vite` | High | `vitest@3.2.4` | Dev-only test/dev-server path | Defer upgrade | Fix requires moving the test stack to Vite 8-compatible tooling, likely `vitest@4.x`. Treat as a separate dev-tooling upgrade because it can affect test behavior. Do not expose Vite dev server in production. |
| `drizzle-kit`, `@esbuild-kit/esm-loader`, `@esbuild-kit/core-utils`, nested `esbuild@0.18.20` | Moderate | Direct `drizzle-kit@0.31.10` | Dev-only migration/tooling path | Risk-accept temporarily / replace later | `drizzle-kit@0.31.10` is current in this repo and still carries the deprecated loader chain. Audit's suggested downgrade is not acceptable. Keep migration tooling out of production runtime; revisit if Drizzle removes the dependency or replace the loader path in a separate tooling pass. |

**Funding Readiness Impact:** Production dependency audit is no longer blocked by moderate/high runtime advisories. Before funding runtime code begins, the remaining accepted Polymarket/Ethers low advisories must stay documented as tied to disabled live venue execution, and Vite/Drizzle dev-tooling advisories should be handled separately from funding logic.

### [HIGH] SEC-002: GitHub Actions Are Not Immutable-Pinned And Lack Explicit Permissions

**Confidence:** 9/10  
**Category:** OWASP A03 - Software Supply Chain Failures  
**Location:** `.github/workflows/ci.yml`

**Evidence:** Workflow uses:

- `actions/checkout@v4`
- `actions/setup-node@v4`
- `actions/upload-artifact@v4`

No top-level or job-level `permissions:` block is present.

**Exploit Scenario:** A compromised mutable action tag or overly broad default token permission can increase impact of a CI supply-chain incident.

**Remediation:** Pin Actions to full commit SHAs and add least-privilege permissions, typically `contents: read` for CI unless a job needs more.

**Priority:** P1 before production deployment pipeline hardening.

### [HIGH] SEC-003: Simulation Preview Admin Bypass Must Be Production-Blocked

**Confidence:** 8/10  
**Category:** OWASP A01 - Broken Access Control / A02 - Security Misconfiguration  
**Location:** `src/api/user-auth-middleware.ts`, `src/api/server.ts`, `.env.example`

**Evidence:** `createAdminSimulationPreviewMiddleware` grants an admin preview identity when preview is enabled and the request is loopback. `.env.example` defaults `DEV_SIMULATION_PREVIEW_ENABLED=false`, but local `.env` may enable it for development.

**Exploit Scenario:** If a production deployment enables the flag and loopback trust is weakened by proxy configuration, admin simulation endpoints may become reachable without a real admin JWT.

**Remediation:** Add a production config guard in a separate code pass: if `NODE_ENV=production`, reject startup when `DEV_SIMULATION_PREVIEW_ENABLED=true`. Document that reverse proxies must not rewrite untrusted traffic into loopback trust.

**Priority:** P1 before exposing simulation routes outside local/dev.

### [HIGH] SEC-004: Funding Flow Needs Explicit Trust Boundaries Before LiFi Runtime Integration

**Confidence:** 8/10  
**Category:** Insecure Design / STRIDE Tampering, Spoofing, Repudiation  
**Location:** `docs/runbooks/funding-flow-v0-handoff.md`

**Evidence:** Funding is planned and will rely on LiFi for route quotes/status, while Lotus remains responsible for venue readiness.

**Exploit Scenario:** If implementation treats a LiFi route success or bridge transaction hash as `READY_TO_TRADE`, execution could submit orders against funds that are not venue-credited, stuck, spoofed, stale, or only partially ready.

**Remediation:** Enforce the three-step readiness model in implementation:

1. LiFi route status.
2. Destination receipt confirmation.
3. Venue adapter confirms `READY_TO_TRADE`.

Execution preflight must only trust step 3.

**Priority:** P1 before funding code begins.

### [MEDIUM] SEC-005: WebSocket Surface Needs Production Auth/Exposure Review

**Confidence:** 6/10  
**Category:** OWASP A01 / A09  
**Location:** `src/ws/plugin.ts`, `src/api/server.ts`

**Evidence:** `/ws` is mounted and domain events are published by topic. This audit did not fully verify subscription authorization and tenant isolation.

**Exploit Scenario:** If WebSocket clients can subscribe to RFQ topics without ownership checks, users could observe other users' RFQ execution events.

**Remediation:** Before production exposure, verify WebSocket connection auth, topic authorization, and event payload redaction. Add tests for cross-user topic subscription denial.

**Priority:** P2 unless the websocket is exposed to untrusted clients now.

### [MEDIUM] SEC-006: Public Metrics Endpoint Can Leak Operational State

**Confidence:** 7/10  
**Category:** Information Disclosure  
**Location:** `src/api/routes/metrics.ts`

**Evidence:** `/metrics` is public in `buildServer`.

**Exploit Scenario:** An attacker can use metrics to infer route activity, failure rates, canary/shadow behavior, or operational instability.

**Remediation:** Put `/metrics` behind network allowlisting, internal ingress, or admin/internal auth before production.

**Priority:** P2.

### [MEDIUM] SEC-007: Execution Scope Tokens Are Short-Lived And Bound, But Single-Use Persistence Must Stay Enforced By Execution Control

**Confidence:** 7/10  
**Category:** Replay Protection  
**Location:** `src/execution-control/execution-scope-token.ts`, `src/execution-control/execution-replay-protector.ts`

**Evidence:** Tokens include `singleUse: true`, HMAC signatures, expiry, principal/session/quote bindings, venue/candidate sets, and live authority revalidation. Replay/idempotency is enforced separately in execution-control repositories.

**Exploit Scenario:** If a future execution path validates the token but bypasses execution-control replay/idempotency persistence, a token could be reused within its TTL.

**Remediation:** Keep all execution acceptance through execution-control. Add regression tests for token replay if not already present around the RFQ accept path.

**Priority:** P2.

### [LOW] SEC-008: `.gitignore` Could Be Broadened For More Secret File Patterns

**Confidence:** 7/10  
**Category:** Secrets Hygiene  
**Location:** `.gitignore`

**Evidence:** `.env` is ignored, but patterns such as `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.secret`, and wallet/keypair files are not currently ignored.

**Exploit Scenario:** A developer could accidentally create and stage non-`.env` credential files.

**Remediation:** Add broader secret-file ignores in a separate cleanup pass.

**Priority:** P3.

## 5. Positive Controls Verified

- `.env` is ignored and was not printed or staged.
- `.env.example` uses placeholders or local/test values, with production-looking secrets left blank.
- `JWT_SECRET` is validated with minimum length in env schema.
- Admin routes mounted in `buildServer` use admin middleware.
- RFQ routes use user auth middleware.
- Execution gate permits only `OPERATOR_APPROVED_SANDBOX` and `OPERATOR_APPROVED_LIMITED_PROD`.
- Held, rolled back, rejected, review-required, and matcher-ready lanes fail closed.
- Scope tokens bind principal, RFQ session, quote, market, topic, venue set, candidate set, and live authority snapshot.
- Accounting v0 builds updates only from `SETTLEMENT_VERIFIED` legs.
- Polymarket live execution is disabled by default and returns deterministic not-configured/live-disabled behavior when flags/env are incomplete.
- Polymarket SDK logs/errors have redaction hooks for API key, secret, passphrase, signature, and private key values.

## 6. Security Gaps Requiring Follow-Up

| Priority | Item | Recommended Owner |
|---|---|---|
| P0 | Controlled dependency upgrade for critical/high advisories | Backend - completed for auth/runtime |
| P0 | Remaining production moderate advisory triage | Backend - completed; production audit now has only low Polymarket/Ethers advisories |
| P1 | Pin GitHub Actions and add least-privilege workflow permissions | DevOps/backend |
| P1 | Production guard for `DEV_SIMULATION_PREVIEW_ENABLED` | Backend |
| P1 | Funding LiFi trust-boundary tests before runtime implementation | Funding owner |
| P2 | WebSocket auth/topic isolation review | Backend |
| P2 | Protect `/metrics` in production | DevOps/backend |
| P2 | Replay regression tests around RFQ accept and execution scope token reuse | Backend |
| P3 | Broaden `.gitignore` for secret file patterns | Backend |

## 7. Commands Run

```bash
git status --short
npm audit --audit-level=moderate --json
npm audit --omit=dev --audit-level=moderate --json
npm run repo:audit
npm run typecheck
npm run test:execution-system
npx vitest run test/integration/rfq-lifecycle.test.ts --maxWorkers=1
npx vitest run tests/admin-crypto-routes.test.ts tests/admin-execution-venues-routes.test.ts --maxWorkers=1
```

Additional non-mutating inspections:

- `package.json`
- `.gitignore`
- `.github/workflows/ci.yml`
- `src/api/server.ts`
- `src/api/user-auth-middleware.ts`
- `src/utils/env.ts`
- `src/api/routes/rfq.ts`
- `src/execution-system/*`
- `src/execution-control/*`
- `docs/runbooks/funding-flow-v0-handoff.md`

## 8. Validation Result

- Baseline `npm audit --audit-level=moderate --json`: failed as expected because advisories existed.
- Post-P0 `npm audit --audit-level=moderate --json`: failed with 23 remaining total advisories, zero critical.
- Post-P0 `npm audit --omit=dev --audit-level=moderate --json`: failed with 15 remaining production advisories, zero critical and zero high.
- Post-triage `npm audit --omit=dev --audit-level=moderate --json`: passed the moderate threshold with zero critical, zero high, zero moderate, and 12 low production advisories.
- Post-triage `npm audit --audit-level=moderate --json`: still reports 17 total advisories: 12 low production Polymarket/Ethers advisories, one high dev-only Vite advisory, and four moderate dev-only Drizzle/esbuild-kit advisories.
- `npm run repo:audit`: completed and reported unused exports/files; this is repo hygiene signal, not a direct security failure.
- `npm run typecheck`: passed.
- `npm run test:execution-system`: passed, 7 files and 41 tests.
- RFQ lifecycle integration: passed, 1 file and 9 tests.
- Admin crypto/execution venue route tests: passed, 2 files and 2 tests.

## 9. Confidence Calibration

| Severity | Count | Average Confidence |
|---|---:|---:|
| Critical | 0 open after remediation | n/a |
| High | 3 non-dependency findings plus 1 dev-only Vite advisory | 8/10 |
| Medium | 3 security findings plus 4 dev-only Drizzle/esbuild-kit advisories | 6.7/10 |
| Low | 1 security finding plus 12 production Polymarket/Ethers advisories | 7/10 |
| Informational | 0 | n/a |

Mode: comprehensive, with low-confidence items labeled as such rather than treated as confirmed exploits. The original P0 dependency finding is retained as resolved evidence because it drove package changes.
