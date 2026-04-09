# Crypto Final Canary Operator Summary

- route class: `PAIR_PM_OPINION`
- final decision: `CANARY_PACKAGE_READY_PENDING_APPROVAL`
- approval state: `NOT_APPROVED`
- current stage: `INTERNAL_ONLY`
- next operator action: Record operator approval intent for PAIR_PM_OPINION on btc_exact_slice_only.

## Success Looks Like
- Only PAIR_PM_OPINION on btc_exact_slice_only is active.
- No blocked family or non-BTC slice is promoted.
- Health and evidence signals remain normal for the full live window.

## Abort Looks Like
- Any out-of-scope family becomes active.
- Runtime-health incidents or missing evidence appear in the live window.
- Operator cannot prove the canary remains narrow, auditable, and reversible.

