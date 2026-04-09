# Pair Route Rollout Summary

Observed at: 2026-03-29T20:54:43.784Z

Tri is explicitly non-blocking in this rollout layer.

## PAIR_PM_LIMITLESS
- Route mode: POLYMARKET_LIMITLESS
- Readiness: SHADOW_READY
- Recommendation: SHADOW
- Historical-only routeable markets: 0
- Live-only routeable markets: 0
- Mixed-basis diagnostic markets: 0
- Exact historical qualified: 0
- Exact live only: 0
- Near exact: 0
- Safe subset markets: 2
- Strong where: HISTORICAL_STRONG
- Weak where: No clean live-only pair routeability yet.; Canary must stay on the exact-safe subset only.
- Allowed first families: CRYPTO:ATH_BY_DATE, POLITICS:NOMINATION_WINNER, SPORTS:CHAMPIONSHIP_WINNER, ESPORTS:LEAGUE_WINNER
- Blocked families: CRYPTO:SAME_DAY_DIRECTIONAL, CRYPTO:THRESHOLD_BY_DATE, SPORTS:MATCHUP_WINNER, ESPORTS:MATCHUP_WINNER

## PAIR_PM_OPINION
- Route mode: POLYMARKET_OPINION
- Readiness: SHADOW_READY
- Recommendation: SHADOW
- Historical-only routeable markets: 0
- Live-only routeable markets: 0
- Mixed-basis diagnostic markets: 1
- Exact historical qualified: 0
- Exact live only: 0
- Near exact: 55
- Safe subset markets: 1
- Strong where: HISTORICAL_STRONG
- Weak where: No clean live-only pair routeability yet.; Broader PM+Opinion near-exacts remain blocked outside the exact BTC slice.
- Allowed first families: CRYPTO:SAME_DAY_DIRECTIONAL
- Blocked families: CRYPTO:ATH_BY_DATE, CRYPTO:THRESHOLD_BY_DATE, SPORTS:*, ESPORTS:*, POLITICS:*

