# Lotus Backend Build Map

Status: engineering map  
Audience: backend engineers, frontend engineers, operators  
Last updated: 2026-04-25

## 1. What Lotus Is

Lotus is not a prediction market venue.

Lotus is an execution and intelligence layer on top of external venues such as Polymarket, Limitless, Opinion, Myriad, Predict.fun, and future venues. It canonicalizes markets, compares venue rules, builds shared-outcome-core routeability, runs RFQ/SOR, and only executes lanes that have explicit operator authority.

The default behavior is fail-closed. Ambiguous market identity, unapproved lanes, degraded rule state, missing execution-scope authority, uncertain settlement, ghost-fill risk, or missing funding readiness must block execution.

## 2. Repo Status Summary

| Area | Status | Summary |
| --- | --- | --- |
| Matcher/family passes | IMPLEMENTED | Report scripts and artifacts exist for politics, sports, crypto, and pair routeability. Matcher output is evidence only. |
| Politics lanes | IMPLEMENTED | Admin lane surfaces exist for nominee, office winner, office exit, party control, and geopolitical lanes. Execution still requires operator approval. |
| Sports lanes | IMPLEMENTED | Admin sports lane surface exists with lane, readiness, rollback, authority, hold, and approval-intent endpoints. |
| Crypto lanes | IMPLEMENTED | Admin crypto lane surface exists for ATH, threshold, first-to-threshold, FDV-after-launch, and token-launch families. |
| Operator review | IMPLEMENTED | Lane admin surfaces support approval intent, hold, rollback, and authority-state views. |
| Execution System v0 | IMPLEMENTED | Domain model, preflight, adapters, settlement, ghost-fill, fallback, accounting hooks, audit sink, status mapping, and RFQ metadata persistence exist. |
| Sandbox execution | IMPLEMENTED | Test adapter supports sandbox execution paths and DB-backed RFQ accept-to-status tests. |
| Polymarket V2 adapter | EXTERNALLY_BLOCKED | Adapter is structurally ready with dry-run/signing harness and readiness surface; live submit remains disabled unless feature flags and external auth/endpoint readiness are proven. |
| Ghost-fill protection | IMPLEMENTED/STUBBED | v0 service and classifier exist. Production-quality venue proofs remain adapter-dependent. |
| Funding Flow v0 | IMPLEMENTED/PARTIAL | DB-backed non-custodial funding preparation exists with LI.FI quote/status wrapper, user APIs, admin readiness/summary, Polymarket readiness, and Limitless readiness scaffolding for pair-lane rehearsal. Live LI.FI execution and funding preflight enforcement remain disabled by default. |
| Monetization hooks | STUB | Execution fee hooks and receipt fee summaries exist; production monetization enforcement is not implemented. |
| Admin surfaces | IMPLEMENTED | Many admin surfaces are mounted under `/admin/*`; see OpenAPI docs for callable routes. |
| Frontend/API readiness | PARTIAL | RFQ accept can return execution ids, execution status can be read, and Funding v0 exposes frontend-safe intent/status/capability APIs. Full frontend deposit polish remains future work. |

## 3. High-Level Backend Architecture

Lotus is layered as follows:

- Venue discovery: venue clients and ingest/report scripts under `src/integrations`, `scripts/ingest`, `scripts/sync`, and `scripts/reports`.
- Canonicalization: canonical market/event/profile logic under `src/canonical` and `src/core/rfq-engine`.
- Interpreted inventory: generated and persisted market interpretation artifacts under `artifacts`, `docs/generated`, and matching modules.
- Family classification: crypto, politics, and sports family classifiers under `src/matching/{crypto,politics,sports}`.
- Shared-core/comparability: family-specific shared-core and matcher scripts under `src/matching` and `scripts/reports`.
- Matcher/readiness artifacts: JSON/markdown outputs under `artifacts` and `docs/generated`.
- Lane registry/operator approval: admin services/routes under `src/api/admin` and authority services under `src/execution-control`.
- RFQ: RFQ routes and services under `src/api/routes/rfq.ts` and `src/core/rfq-engine`.
- SOR: routing, scoring, plan composition, and admin controls under `src/core/sor`, `src/routing`, and `src/api/admin/sor.routes.ts`.
- Reserve/liquidity: risk/exposure and SOR reservation seams under `src/core/risk-engine.ts`, `src/repositories`, and RFQ accept flow.
- Execution system: v0 orchestration under `src/execution-system`.
- Execution-scope token: authority token service under `src/execution-control/execution-scope-token.ts`.
- Venue adapters: adapter interface and implementations under `src/execution-system/venue-adapter.ts` and `src/execution-system/polymarket-execution-adapter-v2.ts`.
- Settlement verification: `src/execution-system/settlement.ts`.
- Ghost-fill protection: `src/execution-system/ghost-fill.ts`.
- Accounting/position state: execution accounting hook in `src/execution-system/accounting.ts`; full sell-anywhere position abstraction is not implemented.
- Funding/capital mobility: DB-backed non-custodial funding preparation under `src/core/funding`, `src/api/routes/funding.ts`, `src/repositories/funding.repository.ts`, and `src/integrations/lifi`.
- Monetization/fee hooks: `src/execution-system/fees.ts`.
- Admin APIs/surfaces: `src/api/admin`.
- Audit/logging: execution audit in `src/execution-system/audit.ts` and `src/execution-control/execution-audit-writer.ts`.
- Observability: metrics/tracing under `src/observability`.

## 4. Runtime Flow Maps

### Market ingestion to canonical lane

```text
venue fetch
-> raw market
-> canonical market
-> family classifier
-> shared-core
-> matcher candidate
-> readiness artifact
-> operator-approved lane
```

Matcher evidence is not executable. A lane becomes executable only when operator authority marks it `OPERATOR_APPROVED_SANDBOX` or `OPERATOR_APPROVED_LIMITED_PROD`.

### RFQ to execution

```text
user intent
-> RFQ
-> approved-lane check
-> SOR route
-> preflight
-> execution request
-> venue adapter
-> settlement verification
-> accounting
-> receipt
```

RFQ accept can start execution, but execution must fail closed if lane approval, scope token, venue readiness, funding readiness, or settlement safety fails.

### Ghost-fill flow

```text
venue says filled
-> settlement verification
-> mismatch detected
-> ghost-fill suspected/confirmed
-> approved fallback or fail closed
-> audit + user-safe status
```

Off-chain fill is not final settlement. Ghost-fill suspected/confirmed states must not update final accounting unless recovery/finality is proven.

### Funding flow

```text
funding intent
-> Funding Capability Matrix
-> LI.FI or another route provider quote
-> user signature
-> route tracking
-> destination received
-> venue credit/finalization
-> READY_TO_TRADE
-> execution preflight can proceed
```

Funding v0 uses Model A: non-custodial funding preparation. Lotus generates route instructions, validates capability scope, tracks user-broadcast transactions, and reconciles venue readiness. The user signs with their own wallet. Lotus does not custody, sign, broadcast user wallet transactions, pool funds, or internally allocate user balances in v0.

LI.FI route completion alone is not enough; venue-ready confirmation is required.

### Capital Mobility / Funding Orchestration

Capital mobility is separate from trade execution but gates execution at preflight.

Lotus owns the funding orchestration:

- Funding Capability Matrix selection
- split funding planning
- route-provider validation
- frontend-safe signing instructions
- per-leg status tracking
- destination and venue-credit reconciliation
- admin readiness visibility
- execution preflight readiness checks

LI.FI is one route provider, not the funding brain. Future provider integrations must remain behind the Lotus funding planner.

Market Capability Matrix and Funding Capability Matrix are separate:

- Market Capability Matrix decides whether a market/outcome/lane is routeable and operator-approvable.
- Funding Capability Matrix decides whether capital can safely reach a venue in the right chain/token/destination and become usable.

Execution requires both an operator-approved market lane and venue-ready capital for the exact user, venue, token, and amount.

### Admin lane approval flow

```text
matcher evidence
-> readiness review
-> operator approval
-> executable lane state
-> hold/rollback/reject
```

Hold, rollback, reject, review-required, matcher-ready, and readiness-ready states are non-executable.

## 5. Module Map With Actual Repo Paths

| Module | Status | Paths |
| --- | --- | --- |
| API server entrypoint | IMPLEMENTED | `src/index.ts`, `src/api/server.ts` |
| Public routes | IMPLEMENTED | `src/api/routes/health.ts`, `src/api/routes/metrics.ts`, `src/api/routes/rfq.ts`, `src/api/routes/resolution-risk.ts` |
| Admin routes | IMPLEMENTED | `src/api/admin/*.routes.ts` |
| RFQ module | IMPLEMENTED | `src/core/rfq-engine`, `src/api/routes/rfq.ts`, `src/db/repositories/rfq-*` |
| SOR/routing | IMPLEMENTED | `src/core/sor`, `src/routing`, `src/api/admin/sor.routes.ts` |
| Canonicalization | IMPLEMENTED | `src/canonical`, `src/core/rfq-engine/*canonical*` |
| Matcher/family passes | IMPLEMENTED | `src/matching/crypto`, `src/matching/politics`, `src/matching/sports`, `scripts/reports` |
| Readiness artifacts | IMPLEMENTED | `artifacts`, `docs/generated` |
| Lane registry/operator approval | IMPLEMENTED | `src/api/admin/*lanes*.routes.ts`, `src/api/admin/*admin-service.ts`, `src/execution-control/*authority*` |
| Execution system | IMPLEMENTED | `src/execution-system` |
| Execution control | IMPLEMENTED | `src/execution-control` |
| Venue adapters | IMPLEMENTED/STUB | `src/execution-system/venue-adapter.ts`, `src/execution-system/polymarket-execution-adapter-v2.ts` |
| Polymarket adapter | EXTERNALLY_BLOCKED | `src/execution-system/polymarket-execution-adapter-v2.ts`, `tests/polymarket-execution-adapter-v2.test.ts` |
| Settlement verification | IMPLEMENTED | `src/execution-system/settlement.ts` |
| Ghost-fill protection | IMPLEMENTED/STUB | `src/execution-system/ghost-fill.ts` |
| Audit logging | IMPLEMENTED | `src/execution-system/audit.ts`, `src/execution-control/execution-audit-writer.ts` |
| Accounting/position state | PARTIAL | `src/execution-system/accounting.ts`; full position abstraction is planned |
| Funding | IMPLEMENTED/PARTIAL | `src/core/funding`, `src/api/routes/funding.ts`, `src/repositories/funding.repository.ts`, `src/integrations/lifi`, `docs/runbooks/funding-flow-v0-handoff.md` |
| Admin UI/API surfaces | API IMPLEMENTED | Admin APIs exist; dedicated frontend UI status varies by surface |
| Tests | IMPLEMENTED | `tests`, `test/integration`, `test/unit` |
| Scripts/reports | IMPLEMENTED | `scripts/reports`, `scripts/sync`, `scripts/ingest`, `scripts/stress` |
| Docs/runbooks | IMPLEMENTED | `docs/runbooks`, `docs/design`, `docs/delivery`, `docs/generated` |
| Unregistered combo user routes | UNREGISTERED | `src/api/combo.routes.ts` is present but not mounted by `src/api/server.ts` |

## 6. Implemented vs Stubbed vs Planned

| Component | Status | Path | What It Does | Safe To Touch? | Notes |
| --- | --- | --- | --- | --- | --- |
| RFQ | IMPLEMENTED | `src/api/routes/rfq.ts`, `src/core/rfq-engine` | Creates RFQs, scope tokens, accepts RFQs, reads execution status | Medium | Do not bypass scope-token or risk checks. |
| SOR | IMPLEMENTED | `src/core/sor`, `src/api/admin/sor.routes.ts` | Selects/routes quote execution plans | Medium | Avoid broad behavior changes before deadline. |
| Matcher passes | IMPLEMENTED | `src/matching`, `scripts/reports` | Builds family/matcher/readiness artifacts | Low for docs/tests, high for policy | Do not reopen unless fixing failing tests. |
| Lane approval | IMPLEMENTED | `src/api/admin/*lanes*.routes.ts` | Operator approval/hold/rollback surfaces | High | Authority semantics are security-critical. |
| Execution v0 | IMPLEMENTED | `src/execution-system` | Orchestrates sandbox execution lifecycle | Medium | Maintain fail-closed behavior. |
| Sandbox adapter | IMPLEMENTED | `src/execution-system/venue-adapter.ts` | Test execution adapter | Low/Medium | Safe place for tests and simulations. |
| Polymarket V2 adapter | EXTERNALLY_BLOCKED | `src/execution-system/polymarket-execution-adapter-v2.ts` | Dry-run/signing readiness; live disabled by flags | High | Do not enable live submit casually. |
| Settlement verification | IMPLEMENTED | `src/execution-system/settlement.ts` | Verifies/fetches settlement states | Medium | Final accounting depends on it. |
| Ghost-fill protection | IMPLEMENTED/STUB | `src/execution-system/ghost-fill.ts` | Classifies settlement mismatch risk | Medium | Venue-specific proofs still maturing. |
| Funding | IMPLEMENTED/PARTIAL | `src/core/funding`, `src/api/routes/funding.ts`, `src/repositories/funding.repository.ts`, `src/integrations/lifi` | Non-custodial funding preparation, LI.FI quote/status wrapper, funding status, admin readiness | Medium | Live LI.FI execution and funding preflight enforcement remain disabled by default. |
| Monetization | STUB | `src/execution-system/fees.ts` | Fee preview/receipt hooks | Medium | No production monetization enforcement. |
| Admin APIs | IMPLEMENTED | `src/api/admin` | Operator/admin read and mutation surfaces | Medium/High | Admin mutations can affect runtime. |
| Audit | IMPLEMENTED | `src/execution-system/audit.ts`, `src/execution-control` | Records execution/control events | Medium | Do not remove evidence. |
| Frontend status output | PARTIAL | `src/execution-system/status.ts`, RFQ status endpoint | User-safe execution status | Low/Medium | Funding status is planned. |

## 7. API Surface Overview

See `docs/api/openapi.yaml` for contract details.

- Public/user RFQ APIs: implemented under `/rfq`; require user JWT.
- Execution APIs: execution status is implemented as `/rfq/{id}/executions/{executionId}/status`; direct execution submit endpoints are not public.
- Admin/operator APIs: implemented under `/admin/*`; require admin JWT except simulation preview can allow loopback preview when enabled.
- Venue readiness APIs: implemented under `/admin/execution-venues`.
- Funding APIs: implemented for non-custodial intent, quote, submit-tx-hash, status, and capability reads; live LI.FI execution remains disabled by default.
- Audit/log APIs: execution-control admin reads exist; no broad public audit endpoint.
- Health/debug APIs: `/health`, `/metrics`, and public resolution-risk reads exist.
- Planned APIs: funding endpoints are marked `x-lotus-callable: false`.

## 8. What Is Safe To Touch

- Documentation under `docs`.
- Tests under `tests`, `test/unit`, and `test/integration`.
- Static OpenAPI docs under `docs/api`.
- Sandbox/test adapters.
- Frontend-safe status mapping, if tests protect behavior.
- Funding docs/contracts and read-only status surfaces, as long as live funding and preflight enforcement remain explicitly scoped.
- Report scripts when adding new report docs and not changing matcher policy.

## 9. What Not To Touch Before Deadline

- Matcher logic unless fixing a failing test.
- Lane approval semantics.
- Execution authority rules.
- Accounting-after-settlement rule.
- Execution-scope token authority logic.
- Live venue submission without explicit feature flags and operator review.
- Secrets handling and production config.
- Broad DB schema rewrites.
- Smart contracts.
- Full position abstraction.
- Full solver network.
- Funding runtime changes unless explicitly scoped.
- Any change that turns Model A non-custodial funding preparation into custody, pooled balances, or internal fund allocation.

## 10. Security-Critical Boundaries

- Matcher evidence is not executable authority.
- Only `OPERATOR_APPROVED_SANDBOX` and `OPERATOR_APPROVED_LIMITED_PROD` can execute.
- Execution-scope token does not grant authority alone.
- User consent cannot widen scope.
- Accounting updates only after settlement/finality.
- Ghost-fill failures fail closed.
- Venue adapters must fail closed.
- Secrets stay server-side and must not appear in logs, metadata, receipts, status responses, or artifacts.
- Funding v0 is Model A non-custodial funding preparation: Lotus generates and validates route instructions, but users sign/broadcast and Lotus does not custody or internally allocate funds.
- LI.FI is a route provider, not executable funding authority or the funding brain.
- Derived capital views must not be presented as custodial or pooled balances.

## 11. How To Run The Repo

Commands from `package.json`:

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Start built service | `npm run start` |
| Typecheck | `npm run typecheck` |
| All tests | `npm run test` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm run test:integration` |
| Execution system tests | `npm run test:execution-system` |
| Repo audit | `npm run repo:audit` |
| Execution report | `npm run report:execution-system:v0` |
| Funding readiness report | `npm run report:funding:readiness` |
| Funding sandbox preflight rehearsal | `npm run funding:polymarket-readiness-sandbox-preflight` |
| Pair funding sandbox preflight rehearsal | `npm run funding:pair-readiness-sandbox-preflight` |
| Pair funding enforcement gate | `npm run funding:pair-enforcement-gate` |
| Limitless readiness smoke test | `npm run funding:limitless-readiness-smoke` |
| Polymarket harness | `npm run execution:polymarket-live-submit-harness` |

OpenAPI validation command: missing. Use Swagger Editor manually for now.

Major report script patterns:

- `npm run report:crypto:*`
- `npm run report:sports:*`
- `npm run report:politics:*`
- `npm run report:pair-*`

## 12. Current Top Workstreams

- Operator review queue and lane approval.
- Execution system hardening.
- Ghost-fill validation.
- Funding Flow v0 hardening, venue readiness validation, and eventual controlled enforcement.
- Monetization skeleton.
- Frontend/admin integration.
- Polymarket V2 external readiness.

## 13. Glossary

- Canonical topic: Lotus-normalized topic identity across venues.
- Family: Market type/category such as sports tournament winner or crypto threshold.
- Shared outcome core: Outcomes that are comparable across venues.
- Lane: Approved routeable market scope across one or more venues.
- Matcher evidence: Artifact showing markets appear comparable; not executable authority.
- Readiness artifact: Review package for lane/operator decisioning.
- Operator approval: Explicit admin approval that can make a lane executable.
- RFQ: Request for quote from a user.
- SOR: Smart order router / route selection layer.
- Execution request: Canonical request passed to execution adapters.
- Execution leg: One venue-specific child of an execution.
- Settlement verification: Finality check after fill.
- Ghost fill: Venue/off-chain fill indication without matching settlement/finality.
- Venue adapter: Isolated venue-specific execution/funding interface.
- Execution-scope token: Short-lived token binding user consent to exact scope.
- Funding intent: User request to prepare capital for one or more venue targets without Lotus custody.
- Market Capability Matrix: Source of truth for market/outcome/lane routeability and operator approval.
- Funding Capability Matrix: Source of truth for what chains/tokens/destinations each venue can receive for funding.
- Ready to trade: Funding state where a specific venue-ready balance is confirmed usable for execution.
- Execution-ready capital: Capital confirmed available for the exact venue/user/token/amount required by execution preflight.
