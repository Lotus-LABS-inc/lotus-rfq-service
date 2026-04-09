export const POLITICS_OFFICE_EXIT_ROLLOUT_STRATEGY_KEY = "politics-office-exit-rollout-v1" as const;
export const POLITICS_OFFICE_EXIT_ROLLOUT_SCOPE_TYPE = "POLITICS_OFFICE_EXIT_LANE" as const;

export const officeExitTrump2026TriLaneId =
  "POLITICS_OFFICE_EXIT_TRUMP_2026_TRI_LIMITLESS_OPINION_POLYMARKET" as const;

export const officeExitTrump2026PairLaneId =
  "POLITICS_OFFICE_EXIT_TRUMP_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const politicsOfficeExitTrumpLaneIds = [
  officeExitTrump2026TriLaneId,
  officeExitTrump2026PairLaneId
] as const;
export type PoliticsOfficeExitTrumpLaneId = typeof politicsOfficeExitTrumpLaneIds[number];


