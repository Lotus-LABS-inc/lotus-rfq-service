export const pairMatchLabelValues = ["EXACT", "EQUIVALENT", "SIMILAR", "DIFFERENT"] as const;
export type PairMatchLabel = typeof pairMatchLabelValues[number];

export const structuralMatchOutcomeValues = [
  "EXACT",
  "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER",
  "REJECTED"
] as const;
export type StructuralMatchOutcome = typeof structuralMatchOutcomeValues[number];

export const pairEdgeApprovalStateValues = [
  "pendingReview",
  "approved",
  "rejected",
  "autoApproved",
  "autoRejected"
] as const;
export type PairEdgeApprovalState = typeof pairEdgeApprovalStateValues[number];

export const pairClassifierPolicyRecommendationValues = ["AUTO_APPROVE", "REVIEW", "REJECT"] as const;
export type PairClassifierPolicyRecommendation = typeof pairClassifierPolicyRecommendationValues[number];

export const pairLabelRouteEligibility = (label: PairMatchLabel, approvalState: PairEdgeApprovalState): boolean =>
  label === "EXACT" && (approvalState === "approved" || approvalState === "autoApproved");

export const pairLabelTriEligibility = (label: PairMatchLabel, approvalState: PairEdgeApprovalState): boolean =>
  pairLabelRouteEligibility(label, approvalState);
