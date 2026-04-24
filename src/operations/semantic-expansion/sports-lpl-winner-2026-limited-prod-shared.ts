export const SPORTS_LPL_WINNER_2026_ROLLOUT_STRATEGY_KEY =
  "sports-lpl-winner-2026-rollout-v1" as const;
export const SPORTS_LPL_WINNER_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_LPL_WINNER_2026_LANE" as const;

export const sportsLplWinner2026TriLaneId =
  "SPORTS_LPL_WINNER_2026_TRI_LIMITLESS_OPINION_POLYMARKET" as const;

export const sportsLplWinner2026PairLimitlessPolymarketLaneId =
  "SPORTS_LPL_WINNER_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsLplWinner2026LaneIds = [
  sportsLplWinner2026TriLaneId,
  sportsLplWinner2026PairLimitlessPolymarketLaneId
] as const;

export type SportsLplWinner2026LaneId =
  typeof sportsLplWinner2026LaneIds[number];
