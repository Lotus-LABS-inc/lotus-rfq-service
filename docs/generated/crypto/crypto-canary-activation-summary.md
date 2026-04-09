# Crypto Canary Activation Summary

- route class: `PAIR_PM_OPINION`
- exact scope: `btc_exact_slice_only` / `CRYPTO:SAME_DAY_DIRECTIONAL`
- final decision: `CANARY_PACKAGE_READY_PENDING_APPROVAL`
- approval state: `NOT_APPROVED`
- current stage: `INTERNAL_ONLY`
- remains shadow-only: PAIR_PM_LIMITLESS, CRYPTO:ATH_BY_DATE, CRYPTO:THRESHOLD_BY_DATE, all sports/esports families
- blocked scope: PAIR_PM_LIMITLESS, CRYPTO:ATH_BY_DATE, CRYPTO:THRESHOLD_BY_DATE, any broader BTC slice, any non-BTC asset, any tri-capable route, SPORTS:*, ESPORTS:*, POLITICS:*, any shadow-only route not explicitly approved here

## Start Path
- Record operator approval intent for PAIR_PM_OPINION on btc_exact_slice_only with ADMIN+2FA.
- Promote PAIR_PM_OPINION to SHADOW using the existing audited shadow promotion path.
- Reconfirm canary readiness remains READY_FOR_CANARY_PENDING_OPERATOR_ACTION.
- Promote PAIR_PM_OPINION to CANARY using the existing audited canary promotion path.
- Do not promote any other route class or family in the same window.

## Abort Triggers
- any out-of-scope family becomes eligible or promoted
- mixed-basis or non-exact routing appears inside the canary slice
- execution-boundary, replay-protection, or reconciliation incidents occur
- evidence logging or decision lineage becomes unavailable
- eligible volume diverges materially from expected baseline
- operator cannot confirm rollback path remains narrow and auditable

