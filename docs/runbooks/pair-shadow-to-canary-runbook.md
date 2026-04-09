# Pair Shadow To Canary Runbook

## Purpose

This runbook defines how Lotus moves a pair route class from `SHADOW` to `CANARY` using measured shadow evidence.

Tri remains non-blocking. This process applies only to:
- `PAIR_PM_LIMITLESS`
- `PAIR_PM_OPINION`

## What Shadow Means

Shadow means Lotus evaluates the pair route class live, records route-class observations, computes promotion evidence, and does not use that route class for user-facing canary execution.

Shadow observations are used to answer:
- did the route class behave consistently enough in live evaluation?
- was the evidence basis clean enough?
- did execution-control or venue-health incidents appear?

## Current Scope

- `PAIR_PM_LIMITLESS`
  - broad class may be observed in shadow
  - canary is restricted to the exact-safe subset only
- `PAIR_PM_OPINION`
  - shadow may observe the exact BTC PM+Opinion slice
  - broader near-exact inventory remains shadow-only or blocked

## Evidence Sources

Pair canary evidence uses a hybrid source model:
- bootstrap evidence from current routeability and pair-route artifacts
- runtime observations stored in `pair_shadow_observations`

Bootstrap evidence is useful for immediate visibility, but runtime observations are the long-term source of truth for canary eligibility.

Mixed-basis evidence is diagnostic only and cannot unlock canary.

## How Shadow Observations Are Collected

Each observation records:
- route class and route mode
- scope kind:
  - `SAFE_EXACT_SUBSET`
  - `SHADOW_ONLY_SUBSET`
  - `BLOCKED_FAMILY`
- canonical event / market references
- basis mode
- decision timestamp
- candidate venues and chosen shadow route
- confidence and compatibility state
- expected net price, cost, slippage, and fillability
- stale / mixed / insufficient evidence flags
- execution-boundary and venue-health status
- reproducibility hash and replay lineage

## How Metrics Are Computed

Metrics are computed over a time window for:
- route overall
- exact-safe subset
- shadow-only subset

Key metric groups:
- sample and coverage
- stability
- quality
- safety and control
- data quality

Artifacts:
- `docs/pair-shadow-evidence-summary.json`
- `docs/pair-canary-readiness-summary.json`
- `docs/pair-canary-readiness-summary.md`

## How Canary Thresholds Are Evaluated

`PAIR_PM_LIMITLESS`
- evaluates only the exact-safe subset
- requires minimum exact-safe sample count and family coverage
- requires low stale-data, mixed-basis, override, and policy-block rates
- requires positive expected net execution improvement
- requires zero serious execution-boundary, replay-protection, and reconciliation incidents

`PAIR_PM_OPINION`
- evaluates only the exact BTC PM+Opinion slice
- requires BTC-slice sample sufficiency
- requires strong confidence and compatibility stability
- requires low stale-data, mixed-basis, and override rates
- requires positive execution-quality signal
- requires zero serious execution-boundary incidents

Thresholds are conservative and fail closed.

## How To Read Blocker Reasons

Common blocker reasons:
- insufficient exact-safe observations
- insufficient family coverage
- mixed-basis dependence
- stale-data rate too high
- low confidence or compatibility stability
- execution-boundary or reconciliation incidents
- venue-health degradation
- no runtime observation evidence yet

If blockers remain, route class stays in shadow.

## When Operators May Promote

Operators may promote to canary only when:
- route class is already in `SHADOW`
- `GET /admin/pair-routes/:routeClass/canary-readiness` shows passing thresholds
- recommendation is `CANARY_APPROVED_PENDING_OPERATOR_ACTION`
- mutation is performed by `ADMIN + 2FA`
- evidence snapshot is recorded at promotion time

## When Operators Must Not Promote

Do not promote when:
- recommendation is `REMAIN_SHADOW` or `BLOCKED`
- evidence is stale, missing, contradictory, or mixed-basis
- route class is outside its canary-safe scope
- serious execution-boundary, replay-protection, or reconciliation incidents are present

## Promotion And Rollback

Promotion:
- `POST /admin/pair-routes/:routeClass/promote-canary`

Rollback to shadow-only:
- `POST /admin/pair-routes/:routeClass/revert-shadow-only`

Every promotion decision stores:
- evidence window
- metric snapshot
- thresholds evaluated
- pass/fail result
- operator identity
- previous and new rollout states
- rollback reference

## Operational Rule

If evidence is insufficient, stale, contradictory, or outside the allowed scope, Lotus must remain in shadow.

