import type { ResolutionEquivalenceClass } from "../rfq-engine/resolution-risk.types.js";
import type { RouteCandidate } from "./types.js";

export type ResolutionRiskRoutingMode = "normal" | "penalty" | "isolated_only" | "blocked";

export interface ResolutionRiskRoutingDecision {
  mode: ResolutionRiskRoutingMode;
  penalty: number;
  reason?: string;
  equivalenceClass?: ResolutionEquivalenceClass;
}

export const getResolutionProfileId = (candidate: RouteCandidate): string | null => {
  const value = candidate.metadata?.["resolution_profile_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

export const resolutionRiskCandidatePairKey = (candidateAId: string, candidateBId: string): string =>
  candidateAId.localeCompare(candidateBId) <= 0
    ? `${candidateAId}|${candidateBId}`
    : `${candidateBId}|${candidateAId}`;

export const decisionFromEquivalenceClass = (
  equivalenceClass: ResolutionEquivalenceClass,
  cautionPenalty: number
): ResolutionRiskRoutingDecision => {
  switch (equivalenceClass) {
    case "SAFE_EQUIVALENT":
      return { mode: "normal", penalty: 0, equivalenceClass };
    case "CAUTION":
      return { mode: "penalty", penalty: cautionPenalty, equivalenceClass, reason: "resolution_risk_caution" };
    case "HIGH_RISK":
      return { mode: "isolated_only", penalty: 0, equivalenceClass, reason: "resolution_risk_high_risk" };
    case "DO_NOT_POOL":
      return { mode: "blocked", penalty: 0, equivalenceClass, reason: "resolution_risk_do_not_pool" };
  }
};
