export const SPORTS_EPL_WINNER_ROLLOUT_STRATEGY_KEY = "sports-epl-winner-rollout-v1" as const;
export const SPORTS_EPL_WINNER_ROLLOUT_SCOPE_TYPE = "SPORTS_EPL_WINNER_LANE" as const;

export const sportsEplWinner20252026AllVenueLaneId =
  "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export const sportsEplWinner20252026PairLimitlessPolymarketLaneId =
  "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsEplWinner20252026LaneIds = [
  sportsEplWinner20252026AllVenueLaneId,
  sportsEplWinner20252026PairLimitlessPolymarketLaneId
] as const;

export type SportsEplWinner20252026LaneId = typeof sportsEplWinner20252026LaneIds[number];
