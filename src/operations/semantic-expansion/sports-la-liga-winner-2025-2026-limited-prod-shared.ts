export const SPORTS_LA_LIGA_WINNER_ROLLOUT_STRATEGY_KEY = "sports-la-liga-winner-rollout-v1" as const;
export const SPORTS_LA_LIGA_WINNER_ROLLOUT_SCOPE_TYPE = "SPORTS_LA_LIGA_WINNER_LANE" as const;

export const sportsLaLigaWinner20252026AllVenueLaneId =
  "SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export const sportsLaLigaWinner20252026PairLimitlessPolymarketLaneId =
  "SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsLaLigaWinner20252026LaneIds = [
  sportsLaLigaWinner20252026AllVenueLaneId,
  sportsLaLigaWinner20252026PairLimitlessPolymarketLaneId
] as const;

export type SportsLaLigaWinner20252026LaneId = typeof sportsLaLigaWinner20252026LaneIds[number];
