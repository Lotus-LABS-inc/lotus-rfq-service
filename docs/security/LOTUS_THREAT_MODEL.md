# Lotus Threat Model

Status: BASELINE  
Date: 2026-04-25  
Method: SEAL lifecycle framing plus STRIDE

## 1. Security Model

Lotus is not a venue. Lotus is an execution and intelligence layer above external venues. The core security rule is that evidence and authority are separate:

- Matcher/readiness output is evidence.
- Operator approval is execution authority.
- Execution-scope tokens bind scope but do not grant authority by themselves.
- Funding readiness prepares capital but does not authorize a trade.
- Settlement/finality verification is required before final accounting.

Any ambiguity should fail closed.

## 2. Assets To Protect

| Asset | Why It Matters |
|---|---|
| User identity and JWT claims | Controls RFQ creation and acceptance. |
| Admin JWT claims | Controls lane approval, rollback, simulation, and operational actions. |
| Execution-scope tokens | Bind user/RFQ/quote/lane/candidate/venue authority. |
| Operator-approved lane state | Determines executable market scope. |
| Execution metadata and receipts | User-facing trade status and audit evidence. |
| Venue API credentials/private keys | Could submit/cancel live venue orders. |
| Funding route and reconciliation state | Determines whether capital is venue-ready. |
| Accounting/position records | User financial state. |
| Audit logs | Non-repudiation and operator investigation trail. |

## 3. Trust Boundaries

| Boundary | Trusted Side | Untrusted/External Side | Required Control |
|---|---|---|---|
| Public API to backend | backend handlers | user input | auth, Zod validation, rate limits |
| Admin API to backend | admin service | admin client | admin JWT, audit events |
| RFQ accept to execution | execution-control | user request | approved lane, scope token, idempotency |
| Matcher to execution | execution gate | matcher artifacts | operator approval required |
| Execution to venue | venue adapter | external venue API | feature flags, adapter fail-closed |
| Settlement to accounting | accounting service | venue/off-chain fill status | settlement/finality verification |
| Funding route to execution | execution preflight | LiFi/bridge/venue status | `READY_TO_TRADE` only |
| CI to repo | GitHub Actions | third-party actions/packages | pinning, least privilege, audits |

## 4. STRIDE Matrix

| Component | Spoofing | Tampering | Repudiation | Information Disclosure | Denial of Service | Elevation of Privilege |
|---|---|---|---|---|---|---|
| User RFQ API | forged JWT | malformed RFQ body | missing user audit | execution status leakage | large request load | accept another user's RFQ |
| Admin APIs | forged admin JWT | unauthorized lane changes | weak admin event trail | artifact/status leaks | admin route abuse | user as admin |
| Execution gate | fake lane state | venue/candidate drift | incomplete decision audit | error detail leaks | repeated preflight/replay | matcher-ready executes |
| Scope token | token replay | altered token payload | disputed authorization | token exposure | token flood | token widens scope |
| Venue adapters | fake venue response | order payload drift | missing submit evidence | secret leakage | endpoint retry storm | live submit bypass |
| Settlement/ghost fill | spoofed settlement | off-chain/on-chain mismatch | weak evidence | receipt over-disclosure | stuck polling | premature accounting |
| Funding/LiFi | spoofed route/provider status | route destination tamper | no leg-level audit | wallet/tx leak | bridge stalls | bridge-complete as trade-ready |
| CI/CD | compromised action tag | artifact/script tamper | missing provenance | log secret leak | build dependency outage | broad `GITHUB_TOKEN` |

## 5. Component Threat Notes

### RFQ And SOR

Main risk: accepting or routing a user request without validating topic, quote, risk, scope token, funding readiness, and operator-approved lane state.

Required controls:

- User JWT required.
- Request schema validation.
- Idempotency key binding.
- RFQ ownership checks must remain enforced in service/repository layer.
- Execution can fail closed after RFQ accept.

### Operator Approval And Lanes

Main risk: matcher/readiness artifacts being treated as executable authority.

Required controls:

- Only `OPERATOR_APPROVED_SANDBOX` and `OPERATOR_APPROVED_LIMITED_PROD` execute.
- Held, rolled back, rejected, review-required, and matcher-ready states must block execution.
- Fallback lanes must also be approved.
- Lane state transitions need audit events.

### Execution-Scope Token

Main risk: token reuse or scope widening.

Existing controls:

- HMAC signature.
- Short TTL.
- Principal/session/quote/market binding.
- Venue set and candidate set binding.
- Live authority revalidation.

Required implementation rule:

- Token validation must always be paired with execution-control idempotency/replay persistence.

### Polymarket Execution Adapter

Main risk: accidental live order submission or secret exposure.

Existing controls:

- `POLYMARKET_EXECUTION_MODE=v2` required.
- `POLYMARKET_LIVE_EXECUTION_ENABLED` false by default.
- Missing env returns deterministic blocked behavior.
- Dry-run envelope is Lotus-internal and not a raw `/order` body.
- SDK error/log redaction exists.

Required controls before live:

- Dependency advisory remediation.
- Operator checklist signoff.
- Non-production or tiny-size live harness.
- Settlement and ghost-fill proof.
- No secrets in receipts/status/artifacts.

### Funding And LiFi

Main risk: treating a route provider's status as final venue readiness.

Required controls:

- Quote freshness and integrity checks.
- Route destination validation against venue capability matrix.
- User signature payload display safety.
- Per-leg status and audit.
- Destination confirmation independent from LiFi.
- Venue adapter confirmation before `READY_TO_TRADE`.
- Execution preflight blocks pending, failed, or unknown funding states.

### CI/CD And Supply Chain

Main risk: dependency or action compromise.

Required controls:

- Pin GitHub Actions by commit SHA.
- Add least-privilege workflow permissions.
- Run dependency audits before live activation.
- Treat lockfile changes as review-sensitive.
- Avoid postinstall or runtime codegen surprises.

## 6. Data Classification

| Data | Classification | Storage/Flow | Rule |
|---|---|---|---|
| JWT secret | credential | env only | never commit, rotate on exposure |
| Polymarket private key/API secret | credential | env/server only | never expose in frontend/status/logs |
| User IDs/wallet refs | financial identity | DB/API | return only to owner/admin |
| RFQ/execution records | financial activity | DB/API/audit | user scoped; admin audited |
| Funding route tx hashes | financial activity | DB/API | user scoped; per-leg audit |
| Venue balances | financial state | DB/API | venue-native truth; display unified as derived |
| Matcher artifacts | business-sensitive evidence | artifacts/admin | not executable by itself |

## 7. Production Security Gates

Before funding runtime:

- Funding model supports split targets.
- LiFi wrapper validates route destinations.
- Venue capability matrix exists.
- Funding leg audit events exist.
- Execution preflight checks `READY_TO_TRADE`.

Before Polymarket live execution:

- Live flags remain off by default.
- Dependency P0/P1 advisories remediated or formally risk-accepted.
- Secrets redaction tests pass.
- Live submit harness is operator-controlled.
- Settlement verification and ghost-fill tests pass.

Before public production:

- Metrics exposure restricted.
- Simulation preview disabled and startup-blocked in production.
- WebSocket auth/topic isolation reviewed.
- CI actions pinned and permissions minimized.
- Incident/rollback runbook exists.
