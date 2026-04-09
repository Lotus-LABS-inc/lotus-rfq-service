export const POLITICS_OFFICE_WINNER_ROLLOUT_STRATEGY_KEY = "politics-office-winner-rollout-v1" as const;
export const POLITICS_OFFICE_WINNER_ROLLOUT_SCOPE_TYPE = "POLITICS_OFFICE_WINNER_LANE" as const;

export const officeWinnerUsPresident2028PairLaneId =
  "POLITICS_OFFICE_WINNER_US_PRESIDENT_2028_PAIR_LIMITLESS_POLYMARKET" as const;

export const officeWinnerBusanMayor2026PairLaneId =
  "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const officeWinnerColombiaPresident2026PairLaneId =
  "POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const officeWinnerSeoulMayor2026TriLaneId =
  "POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_LIMITLESS_OPINION_POLYMARKET" as const;

export const officeWinnerSeoulMayor2026PairFallbackLaneId =
  "POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const politicsOfficeWinnerLaneIds = [
  officeWinnerUsPresident2028PairLaneId,
  officeWinnerBusanMayor2026PairLaneId,
  officeWinnerColombiaPresident2026PairLaneId,
  officeWinnerSeoulMayor2026TriLaneId,
  officeWinnerSeoulMayor2026PairFallbackLaneId
] as const;
export type PoliticsOfficeWinnerLaneId = typeof politicsOfficeWinnerLaneIds[number];
