# Crypto Pair-First Production Checklist

- [ ] exact-safe scope locked to current machine-readable approved scope
- [ ] latest crypto production-readiness artifacts generated
- [ ] canary gates satisfied for intended route class
- [ ] explicit operator approval required before promotion
- [ ] crypto admin readiness / launch / rollback controls available
- [ ] monitoring signals documented and reviewed
- [ ] rollback steps verified against current route class
- [ ] shadow-only and blocked families explicitly excluded from activation
- [ ] first live window locked to PAIR_PM_OPINION on btc_exact_slice_only
- [ ] PAIR_PM_LIMITLESS explicitly excluded from the first live window
- [ ] short first-window monitoring and rollback checklists reviewed

## PAIR_PM_LIMITLESS
- [ ] current decision = `READY_FOR_CANARY_PENDING_OPERATOR_ACTION`
- [ ] approved scope = `safe_exact_subset_only`
- [ ] allowed families = CRYPTO:ATH_BY_DATE
- [ ] blocker reasons reviewed = none

## PAIR_PM_OPINION
- [ ] current decision = `READY_FOR_CANARY_PENDING_OPERATOR_ACTION`
- [ ] approved scope = `btc_exact_slice_only`
- [ ] allowed families = CRYPTO:SAME_DAY_DIRECTIONAL
- [ ] blocker reasons reviewed = none

