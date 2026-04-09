# EPL Winner 2025-2026 Limited-Prod Readiness

- exact topic: SPORTS|LEAGUE_WINNER|EPL|2025_2026
- exact all-venue set: LIMITLESS|OPINION|POLYMARKET|PREDICT
- exact-safe all-venue clubs: arsenal, liverpool, manchester_city
- peer pair route: LIMITLESS|POLYMARKET -> arsenal, aston_villa, chelsea, liverpool, manchester_city, manchester_united
- rule state: SEMANTICALLY_COMPATIBLE_REWORDING
- operator rule review required: yes
- readiness label: SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW
- recommended operator action: keep the all-venue lane review-gated and preserve LIMITLESS|POLYMARKET as a separate pair route.
- rollback boundary: lane-scoped rollback to pair route SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET
- exclusions still mandatory: Other, venue-only tails, and any widening beyond the strict 3-club all-venue core.

# EPL Winner 2025-2026 Pair Limited-Prod Readiness

- exact topic: SPORTS|LEAGUE_WINNER|EPL|2025_2026
- exact pair venue: LIMITLESS|POLYMARKET
- exact-safe pair clubs: arsenal, aston_villa, chelsea, liverpool, manchester_city, manchester_united
- rule state: SEMANTICALLY_COMPATIBLE_REWORDING
- operator rule review required: yes
- readiness label: SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW
- recommended operator action: keep the pair lane separately available for users who do not want the all-venue route.
- rollback boundary: lane-scoped rollback to disabled/internal-only.
