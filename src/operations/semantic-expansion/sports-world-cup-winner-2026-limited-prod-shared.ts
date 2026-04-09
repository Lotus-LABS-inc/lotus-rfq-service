export const SPORTS_WORLD_CUP_WINNER_2026_ROLLOUT_STRATEGY_KEY =
  "sports-world-cup-winner-2026-rollout-v1" as const;
export const SPORTS_WORLD_CUP_WINNER_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_WORLD_CUP_WINNER_2026_LANE" as const;

export const sportsWorldCupWinner2026AllVenueLaneId =
  "SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export const sportsWorldCupWinner2026PairLimitlessPolymarketLaneId =
  "SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsWorldCupWinner2026LaneIds = [
  sportsWorldCupWinner2026AllVenueLaneId,
  sportsWorldCupWinner2026PairLimitlessPolymarketLaneId
] as const;

export type SportsWorldCupWinner2026LaneId =
  typeof sportsWorldCupWinner2026LaneIds[number];
