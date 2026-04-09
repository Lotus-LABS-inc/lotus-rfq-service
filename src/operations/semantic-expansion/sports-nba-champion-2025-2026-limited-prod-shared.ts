export const SPORTS_NBA_CHAMPION_2025_2026_ROLLOUT_STRATEGY_KEY =
  "sports-nba-champion-2025-2026-rollout-v1" as const;
export const SPORTS_NBA_CHAMPION_2025_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_NBA_CHAMPION_2025_2026_LANE" as const;

export const sportsNbaChampion20252026AllVenueLaneId =
  "SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export const sportsNbaChampion20252026PairPolymarketPredictLaneId =
  "SPORTS_NBA_CHAMPION_2025_2026_PAIR_POLYMARKET_PREDICT" as const;

export const sportsNbaChampion20252026LaneIds = [
  sportsNbaChampion20252026AllVenueLaneId,
  sportsNbaChampion20252026PairPolymarketPredictLaneId
] as const;

export type SportsNbaChampion20252026LaneId =
  typeof sportsNbaChampion20252026LaneIds[number];
