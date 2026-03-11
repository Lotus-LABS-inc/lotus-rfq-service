# Resolution Risk Dashboard

## Scope
This dashboard tracks canonical resolution-risk freshness, enforcement activity, and shadow-mode rollout behavior.

## Panels

### Canonical Freshness
- assessment freshness by canonical event
- expected pair count vs persisted pair count
- mixed-version event count

### Equivalence-Class Distribution
- assessment volume by `equivalenceClass`
- latest computed version distribution

### RFQ Resolution Policy
- `rfq_resolution_safe_pool_total`
- `rfq_resolution_separated_total`
- `rfq_resolution_blocked_total`

### SOR Resolution Policy
- `resolution_risk_penalty_applied_total`
- `do_not_pool_block_total`
- `caution_route_total`

### Internal Execution Resolution Policy
- `resolution_risk_internal_exclusion_total{domain="internal_execution",equivalence_class=...}`

### Shadow / Rollout
- `resolution_risk_shadow_total{domain,mode}`
- `resolution_risk_shadow_match_total{domain}`
- `resolution_risk_shadow_divergence_total{domain,reason}`
- `resolution_risk_enforcement_disabled_total{domain}`

### Admin / Recompute
- recomputation volume by event/profile target
- recomputation failure count from logs
- kill-switch state for `resolution_risk:kill_switch`

## Required Drill-Downs
- filter by `canonicalEventId`
- filter by `domain` (`rfq`, `sor`, `internal_execution`)
- filter by divergence `reason`
- filter by `equivalenceClass`

## Production Validation Use
- verify no incomplete or stale assessment sets before enabling enforcement
- verify shadow divergences remain within expected bounds
- verify RFQ/SOR/internal counters align with expected market behavior after enforcement is enabled
