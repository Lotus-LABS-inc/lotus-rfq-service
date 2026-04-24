export const SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_ROLLOUT_STRATEGY_KEY =
  "sports-nhl-stanley-cup-champion-2025-2026-rollout-v1" as const;
export const SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LANE" as const;

export const sportsNhlStanleyCupChampion20252026TriLaneId =
  "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET" as const;

export const sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId =
  "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsNhlStanleyCupChampion20252026LaneIds = [
  sportsNhlStanleyCupChampion20252026TriLaneId,
  sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId
] as const;

export type SportsNhlStanleyCupChampion20252026LaneId =
  typeof sportsNhlStanleyCupChampion20252026LaneIds[number];
