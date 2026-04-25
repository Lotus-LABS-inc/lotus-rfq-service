# Lotus RFQ Service Rules

This project is institutional-grade execution infrastructure.

## Architecture Rules

1. RFQ service MUST operate only on canonical market objects.
2. RFQ service MUST NOT contain venue-specific normalization logic.
3. RFQ service MUST NOT directly call upstream venue APIs.
4. All execution must go through execution router abstraction.
5. All state transitions must go through RFQ state machine.
6. No implicit state changes allowed.
7. No business logic inside route handlers.
8. Repositories must not contain business logic.
9. Redis is ephemeral only.
10. Postgres is authoritative persistence.

## Repo Architecture Preservation Rules

These rules preserve the current Lotus architecture. Cleanup work MUST clarify these seams, not redesign them.

### Top-Level Ownership

1. `src/api/` is transport and registration only.
   - allowed: route handlers, auth middleware, request/response validation, server wiring, websocket wiring
   - forbidden: domain policy, execution policy, matching logic, persistence decisions
2. `src/core/` is the primary runtime domain layer.
   - allowed: RFQ engine, SOR, routing, risk, state machines, execution-domain logic
3. `src/integrations/` is for venue and external-system adapters only.
   - forbidden: canonical business decisions and route-acceptance policy
4. `src/repositories/` is persistence access only.
   - forbidden: business logic, policy decisions, route qualification logic
5. `src/reports/` is for deterministic artifact and decision builders only.
   - allowed: JSON/MD summaries, diagnostics, readiness artifacts, operator outputs
   - forbidden: runtime mutation flows, rollout activation, ingestion execution
6. `src/operations/` is for operational programs and reusable sync/backfill/batch helpers only.
   - forbidden: becoming a second report-builder surface or a second runtime domain layer
7. `src/simulation/` is for simulation engines, baselines, and simulation-only support code.
8. `src/rollout/`, `src/qualification/`, and `src/shadow/` together form the pair-route rollout control plane.
   - they MUST remain distinct unless a future approved architecture pass explicitly changes that
9. Sports and esports remain on a fixture-backed supply/discovery track, not a broad matcher frontier.
10. Crypto remains the narrow production frontier: pair-first, exact-safe, fail-closed, no tri dependency by default.

### Anti-Regression Placement Rules

1. `src/api/` must not absorb service or domain logic.
2. `src/repositories/` must not absorb policy logic.
3. `src/reports/` must not mutate runtime state.
4. `src/operations/` must not become a dumping ground for report builders.
5. Large composition roots must be split by subsystem when they stop being readable.
6. Cleanup must preserve existing subsystem boundaries unless an architecture pass explicitly approves boundary changes.

### Repo Structure Rules

1. `docs/` must distinguish human docs from generated artifacts.
   - human docs belong under design/runbook/alerts/delivery-style subfolders
   - generated markdown reports and operator companions belong under `docs/generated/<category>/`
   - only stable human docs such as architecture/design/runbooks/alerts/delivery docs should remain flat or in human-doc subfolders
   - canonical generated JSON artifacts belong under `artifacts/<category>/<core|optional>/`
   - flat mixed namespaces in `docs/` are architectural debt and should be reduced, not expanded
2. `artifacts/` is the canonical machine-artifact tree.
   - `artifacts/crypto/`, `artifacts/sports/`, `artifacts/politics/`, and `artifacts/shared/` are the only top-level category buckets
   - each category must split into `core/` and `optional/`
   - `core/` keeps the small operator-facing artifact set
   - `optional/` keeps audits, deltas, diagnostics, deep evidence, and debug-style outputs
   - no loose JSON files may live directly under `artifacts/`; only category folders and support docs such as `artifacts/README.md` belong there
   - legacy `docs/*.json` paths may exist only as compatibility mirrors while readers are migrated
3. New JSON artifact writers must go through the shared artifact helper so canonical `artifacts/` copies are always written.
4. `scripts/` must be grouped by intent.
   - canonical script buckets are `scripts/reports/`, `scripts/sync/`, `scripts/ingest/`, `scripts/backfill/`, `scripts/batch/`, `scripts/db/`, `scripts/stress/`, and `scripts/dev/`
   - new root-level script files should be avoided
5. Tests must converge to one top-level test tree.
   - mixed long-term use of both `test/` and `tests/` is disallowed
6. Docs and artifacts must reflect machine truth, not optimistic intent.
7. Any scope broadening must be explicit, evidence-backed, and operator-readable.

### Change Philosophy

1. Prefer additive, scoped, reversible changes.
2. Fail closed by default.
3. No silent scope widening.
4. No broad heuristics that hide ambiguity.
5. If a future pass wants to change these boundaries, it must be treated as an explicit architecture decision, not folded into incidental cleanup.

# Code Organization and File Creation Rules

Lotus must optimize for code clarity, compactness, and future-engineer readability.

New files must not be created casually. Before adding any new file, the agent or engineer must inspect the existing repo structure and determine whether the logic belongs in an existing module.

## Core Rule

Prefer updating existing modules over creating new files when:

- the responsibility already exists in the repo
- the new logic is small
- the code naturally extends an existing domain, service, type, or controller
- adding a separate file would create unnecessary navigation overhead
- the new file would duplicate a parallel pattern already present elsewhere

## When A New File Is Allowed

A new file is allowed only when at least one of these is true:

- the concern is clearly separate from existing modules
- the existing file would become too large or confusing
- the repo already has a convention for that module type
- the logic introduces a new external provider adapter
- the logic introduces a new domain boundary
- tests or docs would be meaningfully cleaner with a dedicated file
- the file prevents mixing unrelated responsibilities

## What To Avoid

Avoid:

- file explosion
- one-prompt-one-file behavior
- duplicate service, controller, or type files
- parallel modules with overlapping responsibility
- creating new docs when an existing doc should be updated
- creating new route/controller files when an existing route group should be extended
- creating new type files when an existing domain type file should be extended
- creating broad new architecture folders without a clear repo convention

## Required Final Response Behavior

Whenever a task creates new files, the final response must include:

1. files added
2. files updated
3. why each new file was necessary
4. which existing files/modules were reused
5. why the logic could not cleanly live in an existing file
6. whether the change follows existing repo conventions

## Funding-Specific Note

For funding work:

- reuse the existing funding handoff markdown
- do not create duplicate funding docs
- reuse existing API/OpenAPI docs structure
- reuse existing audit/event patterns
- reuse existing execution preflight structure
- reuse existing route/controller conventions
- only create new funding files if the repo has no suitable existing place or the concern is clearly isolated

## Execution-Specific Note

For execution work:

- reuse existing execution metadata and RFQ records for v0 unless dedicated tables are clearly necessary
- do not create broad execution schema files unless the metadata shape has stabilized
- prefer compact extensions over broad rewrites

## Admin/Frontend Note

For admin/frontend work:

- only update the relevant design, category, or module requested
- do not modify unrelated design categories
- inspect actual route and file conventions before creating new routes or files
- proposed route manifests are product/navigation structures, not verified filesystem paths unless confirmed by repo inspection

## Security Rules

1. All LP endpoints require HMAC authentication.
2. All user endpoints require JWT.
3. All requests must support idempotency.
4. Nonce replay protection required.
5. Rate limiting must be applied.

## Reliability Rules

1. Every state transition must be logged.
2. All critical operations must emit events.
3. Lock must be acquired before execution.
4. Failures must not crash service.
5. Use circuit breaker pattern for execution failures.

## Code Quality Rules

1. TypeScript strict mode enabled.
2. No any types.
3. No global mutable state.
4. No circular dependencies.
5. No large functions (>100 lines).
6. All business logic must be testable.
7. Include unit tests for:
   - state machine
   - ranking logic
   - lock handling
# Lotus Pass-Orchestration Rules

## Core principle
Lotus always advances by **fresh repo-backed truth**, not by prior assumptions, screenshots alone, or roadmap optimism.

All pass sequencing must follow this order:

1. family / discovery / admission truth
2. normalization / canonicalization truth
3. shared-core / comparability truth
4. matcher pass
5. limited-prod readiness pass
6. operator review / approval package
7. promotion only after explicit operator action

Never skip forward if the previous layer is not credibly established.

---

## Global operating posture

### Non-negotiable policies
- fail closed
- narrow-first
- exact topic scope
- exact venue scope
- exact outcome/candidate scope
- excludel closed
-- exclude venue-only tails
- exclude unknown/composite outcomes
- different wording is not automatically bad
- materially same implied rule meaning may pass as semantic-compatible
- materially different rule meaning blocks exact-safe routing
- operator authority remains absolute
- user consent cannot widen scope
- pair-first unless strict tri evidence is repo-backed

### Shared-core routing standard
For political markets, route on they after explicit operator action

Neof the same canonical topic.

This means:
- keep only outcomes shared across venues
- do not require full menu parity
- do not route venue-only outcomes
- do not route unknown/composite outcomes
- tri requires strict 3-venue shared-core evidence
- pair fallback must remain explicit when tri is review-gated or thinner

---

## Pass types

### 1. Family pass
Purpose:
- refresh fresh venue supply
- classify rows into the correct family
- derive canonical topics
- show admissible venue truth
- show strongest matcher candidate if one exists

Typical outputs:
- fetch summary
- admission summary
- normalized topics
- comparability summary
- basis fragmentation summary
- family final decision
- operator summary

A family pass never implies readiness or rollout.

---

### 2. Matcher pass
Purpose:
- build exact-safe pair lanes from family/comparability truth
- optionally evaluate strict tri if actual venue truth for the same exact topic supports it
- derive exact-safe candidate/outcome scope
- preserve exclusions and rule gates
- decide whether matcher follow-up is justified

Matcher outputs must answer:
- best pair lane
- strict tri lane if any
- exact-safe candidates
- rule state
- exclusions
- whether readiness follow-up is justified

Matcher pass does not promote or enable production.

---

### 3. Limited-prod readiness pass
Purpose:
- consume matcher truth
- create narrow readiness package
- keep lane-aware rollback / hold / promote semantics
- preserve exact topic / venue / candidate scope
- keep operator review gates explicit
- update admin/operator surface as needed

Readiness pass must never:
- widen scope
- widen venues
- widen candidates
- remove rule review gates
- silently promote
- imply broader category activation

---

### 4. Operator review / approval package
Purpose:
- prepare exact lane for human/operator action
- expose inspect / hold / promote / rollback controls
- preserve lane lock
- preserve candidate scope lock
- preserve rule-review requirement if present

Operator approval is always:
- exact topic scoped
- exact venue-set scoped
- exact candidate-set scoped

---

## Canonical next-step sorter

When deciding the next pass, always use this decision logic.

### If current state is a family pass result
- follow-up is justified

Matcher output
  - run matcher pass on the strongest exact topic candidate
- otherwise:
  - run a narrow repair pass if fragmentation looks fixable
  - else move to the next roadmap family

### If current state is a matcher pass result
- if matcher state is:
  -ion truth
2. normalization  lotus Pass-Orchestration Rules

## Core principle  -otus Pass-Orchestration R  -otus Pass-Orchestration Rules
  -otus Pass-Orchestration Ru  
  then:
  - run limited-prod readiness pass for the exact lane
  - if tri exists and is repo-backed, include explicit pair fallback

- if matcher state is:
  -optimism.
All Lotus Pass-Orchestration  
  then:
  - do not run readiness
  - either run rule/normalization repair or move to another topic

### If current state is a readiness pass result
- if final readiness label is:
  -uencing must follow this order:

1.  Lotus Pass-Orchestration Rules

## Core principle
Lotu  -otus Pass-Orchestration Rules

## Core principle
L  
  then:
  - generate operator review package / admin summary
  - await explicit operator action
  - do not broaden scope while waiting

### If operator action is intentionally deferred
- note the lane as pending operator action
- then move engineering to the next roadmap family/topic
- do not reopen already-proven passes unless repo truth changed materially

---

## Tri policy

Tri is allowed only when all are true:
- exact canonical topic matches across all 3 venues
- strict 3-venue shared-core exists
- exclusions have already removed Others / tails / unknowns
- rule state is not materially incompatible
- candidate identity is resolved across all 3 venues

If tri exists but rules areate scope
- exclude `Others`
- exclud then:
- tri may be admitted as review-gated
- tri must not silently become exact auto-routeable
- pair fallback must remain explicit

If tri is weak, ambiguous, or not freshly admitted:
- mark pair-only
- do not force tri optimism

---

## Rule-state handling

### EXACT_RULE_COMPATIBLE
- exact-safe routeability may be allowed

### SEMANTICALLY_COMPATIBLE_REWORDING
- routeability is review-gated unless current repo policy explicitly permits auto-routing at this layer
- never silently treat this as exact wording parity
- operator rule review remains required for readiness/promotion

### REVIEW_REQUIRED_RULE_VARIANCE
- no auto-routeability
- no silent readiness promotion

### RULES_MATERIALLY_INCOMPATIBLE
- lane blocked

### UNKNOWN_RULE_MEANING
- fail closed

---

## Pair fallback policy

Whenever a tri lane survives but is review-gated or thinner than a pair lane:
- keep explicit pair fallback
- record which pair is the safer fallback
- do not discard the stronger pair lane just because a tri lane exists

Preferred expression:
- tri under review
- pair fallback explicit
- no broad tri optimism

---

## Sports lane-cardinality policy

Sports route construction is cardinality-aware.

Allowed lane cardinalities:
- `SINGLE`
- `PAIR`
- `TRI`
- `STRICT_ALL`

Definitions:
- `SINGLE` means one exact venue only
- `PAIR` means exact shared-core intersection across exactly 2 venues
- `TRI` means exact shared-core intersection across exactly 3 venues
- `STRICT_ALL` means exact shared-core intersection across every admitted venue for the exact topic

Sports sequencing rules:
- sports still starts with family / venue truth first
- sports must not widen from one cardinality to another implicitly
- every admitted lane must remain exact topic scoped
- every admitted lane must remain exact venue-set scoped
- every admitted lane must remain exact club / outcome scoped

Sports recommendation order:
- prefer `STRICT_ALL` over `TRI` over `PAIR` over `SINGLE` for narrowness and safety
- still allow lower-cardinality lanes as explicit first-class routes when repo truth supports them
- do not suppress `PAIR` just because `TRI` or `STRICT_ALL` exists
- do not suppress `TRI` just because `STRICT_ALL` exists
- `SINGLE` is allowed only when it is explicitly materialized and lane-scoped; it never widens user consent beyond one venue

Sports exclusion policy:
- exclude `Others`
- exclude unknown/composite outcomes
- exclude venue-only tails from `PAIR`, `TRI`, and `STRICT_ALL`
- `SINGLE` may preserve venue-local exact outcomes for that one venue, but must still exclude `Others` and unknown/composite outcomes

Sports readiness/admin policy:
- each cardinality lane is its own first-class lane
- approval intent, hold, promote, and rollback remain lane-scoped
- rollback must not silently widen from `STRICT_ALL` to `TRI`, `PAIR`, or `SINGLE`
- rollback targets must be explicit per lane

---

## Operator-review triggers

Operator review is justified when:
- matcher or readiness output is narrow
- exact topic is stable
- venue set is stable
- candidate scope is stable
- exclusions are stable
- rule state is understood
- action can be lane-scoped

Operator review is not justified when:
- venue truth is still unstable
- canonical topic is still unstable
- candidate identity is unresolved
- rule meaning is unknown
- lane scope is drifting

---

## Promotion rules

Promotion is never automatic.

Promotion requires:
- exact lane readiness artifact
- explicit operator rule review if needed
- exact candidate scope lock
- exact venue-set lock
- admin/operator approval intent recorded

Promotion must remain:
- lane-aware
- rollback-aware
- hold-aware
- scope-locked

---

## Repair-pass trigger rules

Run a repair pass only if one of these is true:
- a venue is visibly present but not freshly admitted
- a row normalized into the wrong canonical topic
- candidate identity extraction is missing or wrong
- rule-semantic classifier is too weak
- direct-page or targeted fetch can realistically fix the issue

Do not run repairs just because a family is thin.
Thin supply alone is not a bug.

---

## Roadmap progression rules

Politics roadmap order:
1. nominee
2. office winner / election winner
3. local office winners
4. office exit by date
5. geopolitical event by date

After politics:
1. sports
2. crypto
3. finance
4. funding router + venue adapter

Do not move to the next family until the current family has either:
- produced a credible ready/pending-operator lane
- or honestly failed / fragmented with no justified immediate repair

---

## Current practical shorthand commands

When asked to proceed with minimal prompting, interpret these commands as follows.

### “advance current lane”
- inspect latest artifacts
- determine whether current lane needs matcher, readiness, or operator-review package
- run only the next valid stage
- do not widen scope

### “close current lane properly”
- if matcher exists but no readiness: run readiness
- if readiness exists but no operator package: prepare operator package
- if operator package exists: summarize next human action only

### “move to next politics family”
- inspect latest completed family state
- if current family has no justified next pass, advance to next roadmap family
- start with family pass, not matcher

### “run tri only if justified”
- only evaluate tri if actual venue truth shows the exact topic is freshly admitted on 3 venues
- otherwise keep pair-only

### “use safer fallback”
- preserve stronger exact-safe pair fallback beside any review-gated tri lane

---

## Documentation update rule
Whenever a readiness or operator-surface pass materially changes repo truth, update only the relevant docs:
-  - run limited- Lotus Pass-Or- Lotus Pass-Orchestration- runbook section
- admin API docs if touched


Do not do broad doc rewrites unless explicitly requested.

## Scaling Rules

1. No in-memory state for sessions.
2. All session data must be in Redis.
3. Service must be horizontally scalable.
4. No sticky-session assumptions.

Violation of these rules is considered architectural regression.

---

# Execution System Orchestration Rules

## 1. Core Principle

Execution is allowed only after both conditions are true:

1. A lane has matcher/readiness evidence.
2. The lane has explicit operator approval.

Matcher output is evidence.
Operator approval is executable authority.

The execution system must never treat any of the following as executable by themselves:
- `MATCHER_READY`
- `READINESS_READY_FOR_REVIEW`
- `OPERATOR_REVIEW_REQUIRED`
- `REVIEW_REQUIRED`
- `FAMILY_MATCHER_CANDIDATE_FOUND`
- `TRI_REVIEW_REQUIRED`
- `PAIR_REVIEW_REQUIRED`

Only these states are executable:
- `OPERATOR_APPROVED_SANDBOX`
- `OPERATOR_APPROVED_LIMITED_PROD`

All other states must fail closed at execution time.

## 2. Execution Lifecycle

The canonical execution lifecycle is:

1. User submits intent.
2. API creates or loads RFQ.
3. Canonical layer confirms topic/outcome identity.
4. SOR selects route only from operator-approved lanes.
5. Reserve/liquidity layer validates balances and availability.
6. Execution preflight revalidates lane, venue, outcome, price, and liquidity.
7. Venue adapter submits order.
8. Settlement verification begins.
9. Ghost-fill protection runs where relevant.
10. Fallback or fail-closed if execution/settlement is unsafe.
11. Accounting updates per-venue and unified display state.
12. Audit log records all critical events.
13. User receives final receipt/status.

## 3. Execution States

Use or support these execution states:

- `CREATED`
- `PREFLIGHT_CHECKING`
- `PREFLIGHT_FAILED`
- `READY_TO_SUBMIT`
- `SUBMITTED`
- `PARTIAL_FILL`
- `FILLED_PENDING_SETTLEMENT`
- `SETTLEMENT_VERIFIED`
- `GHOST_FILL_SUSPECTED`
- `GHOST_FILL_CONFIRMED`
- `REROUTING`
- `REROUTED`
- `FAILED_CLOSED`
- `COMPLETED`
- `CANCELLED`

Rules:
- No execution can skip `PREFLIGHT_CHECKING`.
- No execution can become `COMPLETED` without settlement verification or a venue-specific finality equivalent.
- No ghost-fill suspected or confirmed execution can update final user position without recovery, reroute, or explicit fail-closed resolution.
- `FAILED_CLOSED` must preserve audit evidence and user-safe accounting.

## 4. Approved-Lane Enforcement

Before execution, the system must confirm:

- `laneId` exists.
- lane state is `OPERATOR_APPROVED_SANDBOX` or `OPERATOR_APPROVED_LIMITED_PROD`.
- `topicKey` matches RFQ topic.
- venue set matches approved lane.
- outcome/candidate set is inside approved scope.
- rule state has not degraded.
- lane has not been `HELD`, `ROLLED_BACK`, or `REJECTED`.
- fallback lane, if used, is also approved.

If any check fails:
- do not execute.
- return `PREFLIGHT_FAILED` or `FAILED_CLOSED`.
- write audit event.
- surface clear operator/user reason.

Matcher-ready is not enough.

## 5. ExecutionRequest Object Policy

Execution must use a canonical `ExecutionRequest` object.

Required fields:
- `executionId`
- `rfqId`
- `userId`
- `canonicalTopicKey`
- `canonicalOutcomeId` or `candidateId`
- `side`
- `size`
- `selectedLaneId`
- `venuePath`
- `executionMode`
- `approvedScopeHash`
- `maxSlippage`
- `fastLaneEnabled`
- `ghostFillProtectionEnabled`
- `expectedPrice`
- `expectedFees`
- `idempotencyKey`
- `createdAt`

Allowed `executionMode` values:
- `SINGLE_VENUE`
- `PAIR`
- `TRI`
- `SPLIT`

The `ExecutionRequest` is the only object passed into venue execution adapters.

## 6. ExecutionLeg Policy

Multi-venue or split executions must be represented as child `ExecutionLeg` records.

Required fields:
- `executionLegId`
- `parentExecutionId`
- `venue`
- `venueMarketId`
- `venueOutcomeId`
- `side`
- `size`
- `price`
- `status`
- `submittedAt`
- `filledAt`
- `settlementStatus`
- `fillId` or `venueOrderId`
- `errorCode` if any

Rules:
- Parent execution status must derive from child leg statuses.
- Partial success must not be marked complete until settlement and accounting are reconciled.
- Failed legs must trigger fallback or fail-closed logic.
- Legs cannot execute on venues outside the approved lane/scope.

## 7. Preflight Revalidation Rules

Every execution must revalidate immediately before order submission:

- approved lane state
- venue health
- market open status
- outcome/candidate still present
- price within slippage
- liquidity available
- user balance/funding availability
- scope token if required
- fallback availability if route is fragile
- ghost-fill protection setting if venue requires it

Preflight failures must be deterministic and auditable.

## 8. Execution-Scope Token Rules

For sensitive or advanced lanes, especially tri lanes, execution may require an `executionScopeToken`.

Token rules:
- token does not grant authority by itself.
- token must bind exact topic.
- token must bind exact venue set.
- token must bind exact outcome/candidate set.
- token must bind RFQ/execution context where applicable.
- token must be short-lived.
- token must be single-use or replay-protected.
- token must be revalidated against live lane authority before execution.

If the operator-approved lane has changed since token issuance:
- reject token.
- fallback only to an approved fallback lane.
- otherwise fail closed.

User consent can never widen scope.

## 9. Venue Adapter Rules

Venue execution must be adapter-based.

Adapters may include:
- `PolymarketExecutionAdapter`
- `LimitlessExecutionAdapter`
- `OpinionExecutionAdapter`
- `MyriadExecutionAdapter`
- `PredictFunExecutionAdapter`
- `GenericTestExecutionAdapter`

Each adapter must handle:
- venue market id mapping
- venue outcome id mapping
- price format
- size format
- side mapping
- order submission
- fill state fetching
- cancel if supported
- settlement check if supported
- error normalization

Do not scatter venue-specific execution logic throughout SOR.

SOR chooses the route.
Adapters execute the route.

## 10. Settlement Verification Rules

After venue execution, settlement verification must begin.

Settlement verification must classify:
- `SETTLEMENT_VERIFIED`
- `SETTLEMENT_PENDING`
- `SETTLEMENT_TIMEOUT`
- `SETTLEMENT_UNKNOWN`
- `GHOST_FILL_SUSPECTED`
- `GHOST_FILL_CONFIRMED`

For venues with known off-chain fill vs on-chain settlement mismatch risk, especially Polymarket:
- off-chain fill confirmation is not final settlement.
- on-chain settlement or venue-specific finality proof must be verified.
- if no settlement appears within configured timeout, classify according to ghost-fill rules.

## 11. Ghost-Fill Protection Rules

Ghost-fill protection must sit after order submission and before final accounting.

A ghost fill may be suspected when:
- venue/off-chain API says filled.
- settlement does not appear within configured timeout.
- counterparty/order nonce cancellation evidence indicates fill may not settle.

On ghost-fill suspected/confirmed:
- do not update final position as settled.
- write immutable audit event.
- notify execution/fallback engine.
- reroute only to approved fallback lanes.
- otherwise fail closed.
- surface user-safe status.
- preserve all evidence for operator review.

Ghost-fill protection is mandatory for Polymarket-routed trades in protected modes.

## 12. Fallback and Reroute Rules

Fallback logic must obey lane authority.

Allowed fallback:
- approved pair fallback
- approved single venue fallback
- approved alternate lane within exact same topic/outcome scope

Not allowed:
- fallback to matcher-ready but unapproved lane
- fallback to venue outside approved scope
- fallback to candidate/outcome outside approved shared core
- fallback that bypasses rule review requirement

If no approved fallback exists:
- fail closed.

## 13. Accounting and Position Update Rules

Accounting updates happen only after settlement is verified or venue-specific finality is confirmed.

For v0:
- maintain venue-native positions.
- display unified position view only as a derived view.
- do not claim sell-anywhere position abstraction unless explicitly implemented.
- sells must respect where inventory actually exists unless a future approved abstraction layer exists.

Accounting must update:
- per-venue position
- per-venue balance
- unified display position
- execution receipt
- fee entries if applicable
- audit log

## 14. Fee Hook Rules

Execution system may compute monetization, but fees must not be silently invented.

Fee hooks may include:
- price improvement share
- fast lane fee
- ghost-fill protection fee
- future instant settlement fee

For v0:
- fee preview
- deterministic fee calculation
- receipt display
- internal fee ledger

No smart-contract enforcement is assumed in v0.

## 15. Audit Event Rules

Execution must write immutable audit events for:

- `EXECUTION_CREATED`
- `PREFLIGHT_STARTED`
- `PREFLIGHT_PASSED`
- `PREFLIGHT_FAILED`
- `ROUTE_SELECTED`
- `LIQUIDITY_RESERVED`
- `ORDER_SUBMITTED`
- `PARTIAL_FILL_RECEIVED`
- `FILL_RECEIVED`
- `SETTLEMENT_CHECK_STARTED`
- `SETTLEMENT_VERIFIED`
- `GHOST_FILL_SUSPECTED`
- `GHOST_FILL_CONFIRMED`
- `REROUTE_STARTED`
- `REROUTE_COMPLETED`
- `FAILED_CLOSED`
- `ACCOUNTING_UPDATED`
- `USER_RECEIPT_EMITTED`

Every critical state transition must be auditable.

## 16. Frontend State Rules

Frontend execution UI must consume execution states from backend.

User-facing states should include:
- preparing route
- checking lane approval
- reserving liquidity
- submitting order
- partially filled
- filled pending settlement
- settlement verified
- ghost fill detected
- rerouting safely
- failed closed
- completed

The UI must not imply a trade is final before settlement/finality verification.

## 17. Non-Goals for Execution v0

Execution v0 must not attempt:
- full solver network
- full smart contract settlement layer
- full sell-anywhere position abstraction
- internal clearinghouse
- full funding SOR
- instant settlement LP product
- broad auto-approval of matcher lanes

These are later phases.

## 18. Current Next-Step Rule

After matcher passes are complete but operator approvals are pending, the next valid work is:

1. Create/update minimal lane approval enforcement. Current status: done for the bootstrap pass.
2. Approve only small sandbox lane set. Current status: done for the current local/bootstrap pass; future approvals must move to the frontend/admin surface.
3. Implement RFQ to SOR to execution v0.
4. Implement settlement verification.
5. Implement ghost-fill protection v0.
6. Implement audit and receipt states.
7. Only then expand funding/monetization/frontend depth.

Do not run new matcher passes unless an execution test reveals a matcher defect.
