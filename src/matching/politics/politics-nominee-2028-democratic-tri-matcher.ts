import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeDemocraticTriMatcherFinalDecision,
  PoliticsNomineeDemocraticTriMatcherLane,
  PoliticsNomineeDemocraticTriMatcherRejection,
  PoliticsNomineeTriEvalTopicSummary
} from "./politics-types.js";

const TOPIC_KEY = "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/nominee-2028-shared-core",
  "artifacts/politics/nominee-2028-tri-eval",
  "artifacts/politics/nominee-2028-democratic-pair-matcher"
] as const;

export interface PoliticsNomineeDemocraticTriMatcherMaterialization {
  topicKey: typeof TOPIC_KEY;
  venueSet: typeof TRI_VENUE_SET;
  admittedCandidateUniverse: readonly string[];
  matcherLanes: readonly PoliticsNomineeDemocraticTriMatcherLane[];
  rejections: readonly PoliticsNomineeDemocraticTriMatcherRejection[];
  finalDecision: PoliticsNomineeDemocraticTriMatcherFinalDecision;
}

const toRejectionReason = (input: {
  candidateIdentityKey: string | null;
  exclusionReasons: readonly string[];
}): PoliticsNomineeDemocraticTriMatcherRejection["rejectionReason"] => {
  if (input.exclusionReasons.includes("OTHERS_EXCLUDED")) {
    return "OTHERS_EXCLUDED";
  }
  if (input.exclusionReasons.includes("RULE_MISMATCH")) {
    return "RULE_MISMATCH";
  }
  if (input.exclusionReasons.includes("UNKNOWN_COMPOSITE")) {
    return input.candidateIdentityKey ? "UNKNOWN_COMPOSITE" : "CANDIDATE_IDENTITY_UNRESOLVED";
  }
  if (input.exclusionReasons.includes("NOT_SHARED")) {
    return "NOT_SHARED";
  }
  if (input.exclusionReasons.includes("PAIR_ONLY")) {
    return "PAIR_ONLY";
  }
  return "TRI_EDGE_MISSING";
};

export const buildDemocraticTriMatcherMaterialization = (input: {
  triSummary: PoliticsNomineeTriEvalTopicSummary;
  pairMatcherFinalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision;
}): PoliticsNomineeDemocraticTriMatcherMaterialization => {
  const matcherLanes: PoliticsNomineeDemocraticTriMatcherLane[] = input.triSummary.triLane.safeCandidates.map((candidate) => ({
    topicKey: TOPIC_KEY,
    canonicalTriVenueSet: TRI_VENUE_SET,
    candidateIdentityKey: candidate.candidateIdentityKey,
    normalizedCandidateName: candidate.normalizedCandidateName,
    routeabilityDecision:
      input.triSummary.triLane.triDecision === "TRI_ROUTEABLE_WITH_REVIEW"
        ? "TRI_REVIEW_REQUIRED"
        : input.triSummary.triLane.triDecision === "TRI_EXACT_AUTO_ROUTEABLE"
          ? "TRI_EXACT_AUTO_ROUTEABLE"
          : "TRI_REJECTED",
    rulesDecision: input.triSummary.triLane.ruleDecision,
    matcherReady:
      input.triSummary.triLane.triDecision === "TRI_EXACT_AUTO_ROUTEABLE"
      || input.triSummary.triLane.triDecision === "TRI_ROUTEABLE_WITH_REVIEW",
    evidenceSources: EVIDENCE_SOURCES,
    evidence: candidate.venueOutcomes.map((outcome) => ({
      venue: outcome.venue,
      venueMarketId: outcome.venueMarketId,
      rawOutcomeLabel: outcome.rawOutcomeLabel
    })),
    notes: [
      "Strict Democratic tri-safe candidate from current tri evaluation.",
      input.triSummary.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST"
        ? "Pair remains preferred outside the surviving exact tri subset."
        : "Tri survives strict 3-venue intersection."
    ]
  }));

  const rejections: PoliticsNomineeDemocraticTriMatcherRejection[] = input.triSummary.triLane.excludedCandidates.map((excluded) => ({
    candidateIdentityKey: excluded.candidateIdentityKey,
    normalizedCandidateName: excluded.normalizedCandidateName,
    rejectionReason: toRejectionReason({
      candidateIdentityKey: excluded.candidateIdentityKey,
      exclusionReasons: excluded.exclusionReasons
    }),
    laneReason: excluded.exclusionReasons.join("|"),
    ruleReason: input.triSummary.triLane.ruleDecision,
    notes:
      excluded.exclusionReasons.includes("PAIR_ONLY")
        ? `Candidate ${excluded.candidateIdentityKey ?? "unknown"} remains exact-safe on the best pair fallback but does not survive the strict Democratic tri intersection because OPINION is missing the edge.`
        : `Candidate ${excluded.candidateIdentityKey ?? "unknown"} does not survive the strict Democratic tri lane.`
  }));

  const admittedCandidateUniverse = [
    ...new Set([
      ...matcherLanes.map((lane) => lane.candidateIdentityKey),
      ...rejections.flatMap((rejection) => rejection.candidateIdentityKey ? [rejection.candidateIdentityKey] : [])
    ])
  ].sort((left, right) => left.localeCompare(right));

  const exactSafeTriCandidateCount = matcherLanes.filter((lane) => lane.routeabilityDecision === "TRI_EXACT_AUTO_ROUTEABLE").length;
  const reviewRequiredTriCandidateCount = matcherLanes.filter((lane) => lane.routeabilityDecision === "TRI_REVIEW_REQUIRED").length;
  const pairFallback = input.pairMatcherFinalDecision.bestPair
    ? {
        venuePair: input.pairMatcherFinalDecision.bestPair,
        candidates: [...input.pairMatcherFinalDecision.bestStartingCandidates]
      }
    : null;
  const exactSafePairFallbackCandidateCount = pairFallback?.candidates.length ?? 0;

  const overallDecision: PoliticsNomineeDemocraticTriMatcherFinalDecision["overallDecision"] =
    exactSafeTriCandidateCount <= 0 && reviewRequiredTriCandidateCount <= 0
      ? (
          input.triSummary.triLane.ruleDecision === "RULES_MATERIALLY_INCOMPATIBLE"
          || input.triSummary.triLane.ruleDecision === "UNKNOWN_RULE_MEANING"
            ? "DEMOCRATIC_TRI_FAILED_CLOSED"
            : "DEMOCRATIC_TRI_NOT_JUSTIFIED_PAIR_ONLY"
        )
      : input.triSummary.triLane.ruleDecision === "REVIEW_REQUIRED_RULE_VARIANCE"
        ? "DEMOCRATIC_TRI_REVIEW_REQUIRED"
        : exactSafeTriCandidateCount >= exactSafePairFallbackCandidateCount
          ? "DEMOCRATIC_TRI_MATCHER_READY"
          : "DEMOCRATIC_TRI_READY_BUT_PAIR_FIRST";

  const triReady =
    overallDecision === "DEMOCRATIC_TRI_MATCHER_READY"
    || overallDecision === "DEMOCRATIC_TRI_READY_BUT_PAIR_FIRST"
    || overallDecision === "DEMOCRATIC_TRI_REVIEW_REQUIRED";
  const pairStillPreferred =
    overallDecision === "DEMOCRATIC_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    || overallDecision === "DEMOCRATIC_TRI_READY_BUT_PAIR_FIRST"
    || overallDecision === "DEMOCRATIC_TRI_FAILED_CLOSED";
  const readinessReviewJustified =
    overallDecision === "DEMOCRATIC_TRI_MATCHER_READY"
    || overallDecision === "DEMOCRATIC_TRI_READY_BUT_PAIR_FIRST"
    || overallDecision === "DEMOCRATIC_TRI_REVIEW_REQUIRED";

  const finalDecision: PoliticsNomineeDemocraticTriMatcherFinalDecision = {
    overallDecision,
    triReady,
    pairStillPreferred,
    bestTriLaneIfAny: triReady ? TRI_VENUE_SET : null,
    bestPairFallback: pairFallback,
    exactSafeTriCandidateCount,
    exactSafePairFallbackCandidateCount,
    ruleStatus: input.triSummary.triLane.ruleDecision,
    operatorCredible: triReady || Boolean(pairFallback && input.pairMatcherFinalDecision.operatorCredible),
    readinessReviewJustified,
    singleBestNextAction:
      triReady
        ? `Review the strict Democratic tri lane ${TRI_VENUE_SET} before any limited-prod tri work, while keeping ${pairFallback?.venuePair ?? "the pair fallback"} as fallback.`
        : `Keep Democratic on the exact pair fallback ${pairFallback?.venuePair ?? "LIMITLESS|POLYMARKET"} and do not start Democratic tri limited-prod review unless OPINION adds a real strict tri edge.`
  };

  return {
    topicKey: TOPIC_KEY,
    venueSet: TRI_VENUE_SET,
    admittedCandidateUniverse,
    matcherLanes: matcherLanes.sort((left, right) => left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)),
    rejections: rejections.sort((left, right) =>
      (left.candidateIdentityKey ?? "").localeCompare(right.candidateIdentityKey ?? "")
      || left.rejectionReason.localeCompare(right.rejectionReason)
    ),
    finalDecision
  };
};
