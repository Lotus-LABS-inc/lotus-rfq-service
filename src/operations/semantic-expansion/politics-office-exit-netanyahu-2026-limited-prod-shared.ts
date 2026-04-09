import {
  officeExitTrump2026PairLaneId,
  officeExitTrump2026TriLaneId
} from "./politics-office-exit-trump-2026-limited-prod-shared.js";

export const POLITICS_OFFICE_EXIT_ROLLOUT_STRATEGY_KEY = "politics-office-exit-rollout-v1" as const;
export const POLITICS_OFFICE_EXIT_ROLLOUT_SCOPE_TYPE = "POLITICS_OFFICE_EXIT_LANE" as const;

export const officeExitNetanyahu2026TriLaneId =
  "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT" as const;

export const officeExitNetanyahu2026PairFallbackLaneId =
  "POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const politicsOfficeExitLaneIds = [
  officeExitNetanyahu2026TriLaneId,
  officeExitNetanyahu2026PairFallbackLaneId,
  officeExitTrump2026TriLaneId,
  officeExitTrump2026PairLaneId
] as const;
export type PoliticsOfficeExitLaneId = typeof politicsOfficeExitLaneIds[number];
