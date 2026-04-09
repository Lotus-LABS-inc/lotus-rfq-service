import type { TimeBasisRouteabilitySummary } from "./time-basis-routeability-summary.js";

export type TimeBasisDualTrackDecision =
  | "LIVE_LIMITLESS_RECOVERY_WORKED__USE_LIVE_ROUTEABILITY"
  | "HISTORICAL_OPINION_RECOVERY_WORKED__USE_HISTORICAL_SIMULATION_VIEW"
  | "BOTH_TRACKS_WORKED__LIMITLESS_OPINION_REEVALUATE"
  | "TIME_BASIS_MISMATCH_FIXED_BUT_OVERLAP_STILL_ZERO"
  | "MORE_HISTORICAL_OPINION_BACKFILL_NEEDED"
  | "MORE_LIVE_LIMITLESS_RECOVERY_NEEDED"
  | "PARTNER_ACCESS_NEEDED"
  | "TRI_NOT_CURRENTLY_REALISTIC_ON_AVAILABLE_DATA";

export interface DualTrackDecisionInputs {
  timeBasisSummary: TimeBasisRouteabilitySummary;
  limitlessLiveSummary?: {
    selectedMarkets: number;
    insertedStates: number;
  } | null;
  opinionHistoricalSummary?: {
    targetedMarkets: number;
    recoveredHistoricalMarkets: number;
    insertedStates: number;
    missingHistory: readonly unknown[];
  } | null;
}

export const decideTimeBasisDualTrackNextStep = (
  input: DualTrackDecisionInputs
): {
  decision: TimeBasisDualTrackDecision;
  rationale: readonly string[];
} => {
  const historical = input.timeBasisSummary.routeabilityByBasis.find((slice) => slice.basis === "HISTORICAL_ONLY");
  const live = input.timeBasisSummary.routeabilityByBasis.find((slice) => slice.basis === "LIVE_ONLY");
  const historicalLimitlessOpinion = historical?.routeModes.find((row) => row.routeMode === "LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  const liveLimitlessOpinion = live?.routeModes.find((row) => row.routeMode === "LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  const historicalTri = historical?.routeModes.find((row) => row.routeMode === "POLYMARKET_LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  const liveTri = live?.routeModes.find((row) => row.routeMode === "POLYMARKET_LIMITLESS_OPINION")?.routeableMarketCount ?? 0;

  if (liveLimitlessOpinion > 0 && liveTri > 0 && historicalLimitlessOpinion > 0) {
    return {
      decision: "BOTH_TRACKS_WORKED__LIMITLESS_OPINION_REEVALUATE",
      rationale: ["Both clean temporal views now show non-zero Limitless+Opinion overlap."]
    };
  }

  if (liveLimitlessOpinion > 0 || liveTri > 0) {
    return {
      decision: "LIVE_LIMITLESS_RECOVERY_WORKED__USE_LIVE_ROUTEABILITY",
      rationale: ["Live-only routeability improved after Limitless live recovery."]
    };
  }

  if (historicalLimitlessOpinion > 0 || historicalTri > 0) {
    return {
      decision: "HISTORICAL_OPINION_RECOVERY_WORKED__USE_HISTORICAL_SIMULATION_VIEW",
      rationale: ["Historical-only routeability improved after Opinion historical recovery."]
    };
  }

  if ((input.limitlessLiveSummary?.selectedMarkets ?? 0) === 0) {
    return {
      decision: "MORE_LIVE_LIMITLESS_RECOVERY_NEEDED",
      rationale: ["No live Limitless markets were recovered into inventory."]
    };
  }

  if ((input.opinionHistoricalSummary?.recoveredHistoricalMarkets ?? 0) === 0) {
    return {
      decision: "MORE_HISTORICAL_OPINION_BACKFILL_NEEDED",
      rationale: ["Historical Opinion recovery did not recover any targeted crypto markets."]
    };
  }

  if (((input.timeBasisSummary.routeModeBasisBreakdown.LIMITLESS_OPINION ?? { MIXED_BASIS: 0 }).MIXED_BASIS ?? 0) > 0) {
    return {
      decision: "TIME_BASIS_MISMATCH_FIXED_BUT_OVERLAP_STILL_ZERO",
      rationale: ["Mixed-basis contamination exists diagnostically, but clean basis views still show zero overlap."]
    };
  }

  if ((input.limitlessLiveSummary?.insertedStates ?? 0) > 0 && (input.opinionHistoricalSummary?.insertedStates ?? 0) > 0) {
    return {
      decision: "TRI_NOT_CURRENTLY_REALISTIC_ON_AVAILABLE_DATA",
      rationale: ["Both recovery tracks landed data, but clean historical and live views still have zero Limitless+Opinion and tri overlap."]
    };
  }

  return {
    decision: "PARTNER_ACCESS_NEEDED",
    rationale: ["Available recovery surfaces remain insufficient to establish clean overlapping Limitless+Opinion inventory."]
  };
};
