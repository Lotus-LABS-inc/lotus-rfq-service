# Pair Canary Launch Plan

Observed at: 2026-03-30T15:40:30.165Z

## PAIR_PM_LIMITLESS
- Scope promoted: safe_exact_subset_only
- Allowed families: CRYPTO:ATH_BY_DATE, POLITICS:NOMINATION_WINNER
- Blocked families: CRYPTO:SAME_DAY_DIRECTIONAL, CRYPTO:THRESHOLD_BY_DATE, SPORTS:MATCHUP_WINNER, ESPORTS:MATCHUP_WINNER
- Traffic slice: staging-shadow-slice:1%
- Rollback triggers: any execution-boundary incident, any replay-protection incident, venue health degradation, mixed-basis evidence detected

## PAIR_PM_OPINION
- Scope promoted: btc_exact_slice_only
- Allowed families: CRYPTO:SAME_DAY_DIRECTIONAL
- Blocked families: CRYPTO:ATH_BY_DATE, CRYPTO:THRESHOLD_BY_DATE, SPORTS:*, ESPORTS:*, POLITICS:*
- Traffic slice: staging-shadow-slice:1%
- Rollback triggers: any execution-boundary incident, any replay-protection incident, venue health degradation, mixed-basis evidence detected

