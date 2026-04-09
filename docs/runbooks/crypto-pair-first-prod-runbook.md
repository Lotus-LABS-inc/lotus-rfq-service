# Crypto Pair-First Production Runbook

## Scope Definition
- Crypto only.
- Pair-first only.
- Exact-safe only.
- No tri dependency.
- No mixed-basis activation.
- First live crypto canary is PAIR_PM_OPINION on btc_exact_slice_only only.
- PAIR_PM_LIMITLESS remains out of scope for the first live window.
- Sports remains secondary and non-blocking for crypto canary activation.

## Preflight Checks
- Refresh pair-route rollout, pair canary readiness, and crypto production-readiness artifacts.
- Confirm current approved crypto scope matches the latest machine-readable artifact.
- Confirm promotion remains explicit operator action and no broad route defaults are enabled.

## Canary Entry Criteria
- Route decision is `READY_FOR_CANARY_PENDING_OPERATOR_ACTION`.
- Current approved scope is non-empty and crypto-only.
- Runtime-health blockers are empty.
- Operator approval intent has been recorded.

## Operator Approval Flow
- Review crypto production-readiness summary.
- Review route-specific launch and rollback plans.
- Review the first-window canary activation, monitoring, and rollback package artifacts.
- Record operator approval intent with ADMIN+2FA.
- Promote to canary only through the audited pair-route canary promotion endpoint.
- Approval intent is required but is not activation.

## Stage Meanings
- `INTERNAL_ONLY`: blocked from rollout.
- `SHADOW`: evidence collection only.
- `CANARY`: explicitly approved narrow crypto slice.
- `LIMITED_PROD`: not activated by this pass.

## Monitoring Signals
- `expectedNetExecutionImprovement`
- `staleDataRate`
- `mixedBasisRate`
- `executionBoundaryIncidentCount`
- `replayProtectionIncidentCount`
- `reconciliationIncidentCount`
- `venueHealthFailureRate`

## Failure Conditions
- Any execution-boundary incident.
- Any replay-protection incident.
- Any reconciliation incident.
- Mixed-basis evidence detected in the active slice.
- Venue health degradation above threshold.

## Rollback Steps
- Generate the route-specific rollback plan artifact.
- Follow the short first-window rollback checklist for PAIR_PM_OPINION.
- Demote the affected route class back to `SHADOW` or `INTERNAL_ONLY`.
- Preserve shadow evidence and promotion-decision history.
- Regenerate readiness artifacts after rollback.

## Post-Launch Review
- Reconfirm canary metrics remain inside thresholds.
- Reconfirm no blocked family or shadow-only slice was activated.
- Reconfirm the current approved scope remains the exact promoted scope.

## PAIR_PM_LIMITLESS
- Current stage: `INTERNAL_ONLY`
- Current readiness: `READY_FOR_CANARY_PENDING_OPERATOR_ACTION`
- Approved scope: `safe_exact_subset_only`
- Allowed families: CRYPTO:ATH_BY_DATE
- Blocked families: CRYPTO:SAME_DAY_DIRECTIONAL, CRYPTO:THRESHOLD_BY_DATE, SPORTS:MATCHUP_WINNER, ESPORTS:MATCHUP_WINNER
- Basis restrictions: LIVE_ONLY, EXACT_SAFE_ONLY, NO_MIXED_BASIS, NO_TRI_DEPENDENCY
- Canary blockers: none

## PAIR_PM_OPINION
- Current stage: `INTERNAL_ONLY`
- Current readiness: `READY_FOR_CANARY_PENDING_OPERATOR_ACTION`
- Approved scope: `btc_exact_slice_only`
- Allowed families: CRYPTO:SAME_DAY_DIRECTIONAL
- Blocked families: CRYPTO:ATH_BY_DATE, CRYPTO:THRESHOLD_BY_DATE, SPORTS:*, ESPORTS:*, POLITICS:*
- Basis restrictions: LIVE_ONLY, EXACT_SAFE_ONLY, NO_MIXED_BASIS, NO_TRI_DEPENDENCY
- Canary blockers: none

