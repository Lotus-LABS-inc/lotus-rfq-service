export const SPORTS_LCK_WINNER_2026_ROLLOUT_STRATEGY_KEY =
  "sports-lck-winner-2026-rollout-v1" as const;
export const SPORTS_LCK_WINNER_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_LCK_WINNER_2026_LANE" as const;

export const sportsLckWinner2026TriLaneId =
  "SPORTS_LCK_WINNER_2026_TRI_LIMITLESS_OPINION_POLYMARKET" as const;

export const sportsLckWinner2026PairLimitlessPolymarketLaneId =
  "SPORTS_LCK_WINNER_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsLckWinner2026LaneIds = [
  sportsLckWinner2026TriLaneId,
  sportsLckWinner2026PairLimitlessPolymarketLaneId
] as const;

export type SportsLckWinner2026LaneId =
  typeof sportsLckWinner2026LaneIds[number];
