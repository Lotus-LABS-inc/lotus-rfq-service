import type { PairEdgeApprovalState } from "./match-labels.js";
import type {
  PairClassifierResult,
  StructuralMatchResult
} from "./matching-types.js";

export interface ReviewApprovalDecision {
  approvalState: PairEdgeApprovalState;
  reviewReason: string | null;
}

const hasAmbiguity = (flags: readonly string[]): boolean => flags.length > 0;

export const applyReviewApprovalPolicy = (input: {
  structuralMatch: StructuralMatchResult;
  classifierResult: PairClassifierResult | null;
  triCritical?: boolean;
}): ReviewApprovalDecision => {
  if (input.structuralMatch.outcome === "EXACT") {
    return {
      approvalState: "autoApproved",
      reviewReason: "structural_exact_auto_approved"
    };
  }

  if (!input.classifierResult) {
    return {
      approvalState: "autoRejected",
      reviewReason: "classifier_not_reached"
    };
  }

  if (input.classifierResult.finalLabel === "DIFFERENT") {
    return {
      approvalState: "autoRejected",
      reviewReason: "classifier_different"
    };
  }

  if (
    input.classifierResult.finalLabel === "EXACT"
    && input.classifierResult.policyRecommendation === "AUTO_APPROVE"
    && !hasAmbiguity(input.classifierResult.ambiguityFlags)
    && !input.triCritical
  ) {
    return {
      approvalState: "autoApproved",
      reviewReason: "classifier_exact_high_confidence"
    };
  }

  if (input.classifierResult.finalLabel === "SIMILAR") {
    return {
      approvalState: "autoRejected",
      reviewReason: "similar_discovery_only"
    };
  }

  return {
    approvalState: "pendingReview",
    reviewReason:
      input.classifierResult.finalLabel === "EQUIVALENT" ? "equivalent_requires_review"
      : input.triCritical ? "tri_critical_requires_review"
      : "exact_borderline_requires_review"
  };
};
