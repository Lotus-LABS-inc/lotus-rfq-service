# Resolution Risk Alerts

## Scope
These alerts cover canonical resolution-risk freshness, enforcement behavior, and shadow-mode divergence.

## Required Alerts

### Assessment Freshness / Completeness
- alert when a canonical event has incomplete pair coverage:
  - trigger when `persistedPairCount < expectedPairCount`
  - severity: high
- alert when assessment freshness is stale:
  - trigger when `latestProfileUpdatedAt > lastComputedAt`
  - severity: high
- alert when one canonical event has mixed scoring versions:
  - trigger when `hasMixedVersions=true`
  - severity: medium

### RFQ Enforcement
- alert on blocked-profile spike:
  - metric: `rfq_resolution_blocked_total`
  - trigger: sustained rate above baseline
  - severity: medium
- alert on separation spike:
  - metric: `rfq_resolution_separated_total`
  - trigger: sustained rate above baseline
  - severity: medium

### SOR Enforcement
- alert on pooled-route penalty spike:
  - metric: `resolution_risk_penalty_applied_total`
  - trigger: sustained rate above baseline
  - severity: medium
- alert on do-not-pool routing blocks:
  - metric: `do_not_pool_block_total`
  - trigger: sustained rate above baseline
  - severity: high

### Internal Execution
- alert on internal exclusion spike:
  - metric: `resolution_risk_internal_exclusion_total`
  - labels: `domain`, `equivalence_class`
  - trigger: sustained non-zero growth outside expected markets
  - severity: high

### Shadow / Rollout
- alert on shadow divergence spike:
  - metric: `resolution_risk_shadow_divergence_total`
  - labels: `domain`, `reason`
  - trigger: sustained divergence above threshold after shadow is enabled
  - severity: high
- alert when enforcement is disabled unexpectedly:
  - metric: `resolution_risk_enforcement_disabled_total`
  - labels: `domain`
  - trigger: non-zero growth outside approved rollout windows
  - severity: high

### Admin / Recompute
- alert on recomputation failures:
  - source: admin service error logs for resolution-risk recompute operations
  - severity: high
- alert on kill-switch activation:
  - key: `resolution_risk:kill_switch`
  - trigger: key present for longer than the approved maintenance window
  - severity: critical

## Operational Notes
- `resolution_risk:kill_switch` freezes recomputation only. It does not disable read-path enforcement.
- Shadow mode is decision-only. Divergence alerts should be reviewed before enabling enforcement in production.
