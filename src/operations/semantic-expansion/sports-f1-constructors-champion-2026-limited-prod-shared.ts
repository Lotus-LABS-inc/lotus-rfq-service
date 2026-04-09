export const SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ROLLOUT_STRATEGY_KEY =
  "sports-f1-constructors-champion-2026-rollout-v1" as const;
export const SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_LANE" as const;

export const sportsF1ConstructorsChampion2026TriLaneId =
  "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_TRI_LIMITLESS_OPINION_POLYMARKET" as const;

export const sportsF1ConstructorsChampion2026PairLimitlessPolymarketLaneId =
  "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsF1ConstructorsChampion2026LaneIds = [
  sportsF1ConstructorsChampion2026TriLaneId,
  sportsF1ConstructorsChampion2026PairLimitlessPolymarketLaneId
] as const;

export type SportsF1ConstructorsChampion2026LaneId =
  typeof sportsF1ConstructorsChampion2026LaneIds[number];
