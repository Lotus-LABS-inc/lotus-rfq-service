export const SPORTS_F1_DRIVERS_CHAMPION_2026_ROLLOUT_STRATEGY_KEY =
  "sports-f1-drivers-champion-2026-rollout-v1" as const;
export const SPORTS_F1_DRIVERS_CHAMPION_2026_ROLLOUT_SCOPE_TYPE =
  "SPORTS_F1_DRIVERS_CHAMPION_2026_LANE" as const;

export const sportsF1DriversChampion2026AllVenueLaneId =
  "SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export const sportsF1DriversChampion2026PairLimitlessPolymarketLaneId =
  "SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsF1DriversChampion2026LaneIds = [
  sportsF1DriversChampion2026AllVenueLaneId,
  sportsF1DriversChampion2026PairLimitlessPolymarketLaneId
] as const;

export type SportsF1DriversChampion2026LaneId =
  typeof sportsF1DriversChampion2026LaneIds[number];
