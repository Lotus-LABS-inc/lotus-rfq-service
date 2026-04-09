import type {
  PoliticsNomineeRepublicanTriMatcherFinalDecision,
  PoliticsNomineeRepublicanTriMatcherLane,
  PoliticsNomineeRepublicanTriMatcherRejection,
  PoliticsNomineeTriEvalTopicSummary
} from "./politics-types.js";

const TOPIC_KEY = "NOMINEE|US_PRESIDENT|2028|REPUBLICAN" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const APPROVED_TRI_CANDIDATES = ["jd_vance", "marco_rubio", "ron_desantis"] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/nominee-2028-shared-core",
  "artifacts/politics/nominee-2028-tri-eval",
  "artifacts/politics/nominee-2028-republican-pair-matcher"
] as const;

const APPROVED_TRI_SET = new Set<string>(APPROVED_TRI_CANDIDATES);

export interface PoliticsNomineeRepublicanTriMatcherMaterialization {
  topicKey: typeof TOPIC_KEY;
  venueSet: typeof TRI_VENUE_SET;
  approvedCandidates: readonly string[];
  matcherLanes: readonly PoliticsNomineeRepublicanTriMatcherLane[];
  rejections: readonly PoliticsNomineeRepublicanTriMatcherRejection[];
  finalDecision: PoliticsNomineeRepublicanTriMatcherFinalDecision;
}

export const buildRepublicanTriMatcherMaterialization = (input: {
  triSummary: PoliticsNomineeTriEvalTopicSummary;
}): PoliticsNomineeRepublicanTriMatcherMaterialization => {
  const matcherLanes: PoliticsNomineeRepublicanTriMatcherLane[] = [];
  const rejections: PoliticsNomineeRepublicanTriMatcherRejection[] = [];

  for (const candidate of input.triSummary.triLane.safeCandidates) {
    if (!APPROVED_TRI_SET.has(candidate.candidateIdentityKey)) {
      rejections.push({
        candidateIdentityKey: candidate.candidateIdentityKey,
        rejectionReason: "NOT_APPROVED_CANDIDATE",
        laneReason: "outside_exact_narrow_tri_subset",
        ruleReason: input.triSummary.triLane.ruleDecision,
        notes: `Candidate ${candidate.candidateIdentityKey} is tri-safe in current repo truth but outside the explicitly approved narrow Republican tri matcher subset.`
      });
      continue;
    }

    matcherLanes.push({
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
        "Approved exact narrow Republican tri matcher candidate.",
        input.triSummary.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST"
          ? "Pair remains preferred outside this narrow tri subset."
          : "Tri-safe lane is currently operator-credible."
      ]
    });
  }

  for (const candidateKey of APPROVED_TRI_CANDIDATES) {
    if (matcherLanes.some((lane) => lane.candidateIdentityKey === candidateKey)) {
      continue;
    }
    rejections.push({
      candidateIdentityKey: candidateKey,
      rejectionReason:
        input.triSummary.triLane.ruleDecision === "RULES_MATERIALLY_INCOMPATIBLE" ? "RULE_MISMATCH"
        : input.triSummary.triLane.ruleDecision === "UNKNOWN_RULE_MEANING" ? "TRI_EDGE_MISSING"
        : "TRI_EDGE_MISSING",
      laneReason: input.triSummary.triLane.triDecision,
      ruleReason: input.triSummary.triLane.ruleDecision,
      notes: `Approved tri candidate ${candidateKey} is no longer present as an exact-safe tri lane member in current repo truth.`
    });
  }

  for (const excluded of input.triSummary.triLane.excludedCandidates) {
    rejections.push({
      candidateIdentityKey: excluded.candidateIdentityKey,
      rejectionReason: excluded.exclusionReasons.includes("PAIR_ONLY") ? "PAIR_ONLY_OUTSIDE_SUBSET" : "TRI_EDGE_MISSING",
      laneReason: excluded.exclusionReasons.join("|"),
      ruleReason: input.triSummary.triLane.ruleDecision,
      notes: `Candidate ${excluded.candidateIdentityKey ?? "unknown"} remains out of scope for the narrow Republican tri matcher.`
    });
  }

  const exactTriLaneReady =
    matcherLanes.length === APPROVED_TRI_CANDIDATES.length
    && matcherLanes.every((lane) => lane.routeabilityDecision === "TRI_EXACT_AUTO_ROUTEABLE")
    && input.triSummary.triLane.ruleDecision === "EXACT_RULE_COMPATIBLE";

  const reviewRequired =
    matcherLanes.length > 0
    && matcherLanes.every((lane) => lane.routeabilityDecision === "TRI_REVIEW_REQUIRED");

  const finalDecision: PoliticsNomineeRepublicanTriMatcherFinalDecision = {
    overallDecision:
      matcherLanes.length <= 0 ? "REPUBLICAN_TRI_MATCHER_HELD_ON_RULES"
      : reviewRequired ? "REPUBLICAN_TRI_MATCHER_READY_PENDING_OPERATOR_REVIEW"
      : input.triSummary.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST"
        ? "REPUBLICAN_TRI_MATCHER_READY_NARROW_SUBSET_ONLY"
        : "REPUBLICAN_TRI_MATCHER_READY",
    operatorCredible: matcherLanes.length > 0,
    exactTriLaneReady,
    pairFallbackStillPreferredOutsideSubset: input.triSummary.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST",
    approvedCandidates: matcherLanes.map((lane) => lane.candidateIdentityKey),
    recommendedStartingLane: matcherLanes.length > 0 ? TRI_VENUE_SET : null,
    singleBestNextAction:
      matcherLanes.length <= 0
        ? "Hold the Republican tri matcher until the exact tri-safe subset survives current tri evaluation again."
        : "Start limited-prod operator review on the exact Republican tri lane LIMITLESS|OPINION|POLYMARKET for jd_vance, marco_rubio, and ron_desantis only."
  };

  return {
    topicKey: TOPIC_KEY,
    venueSet: TRI_VENUE_SET,
    approvedCandidates: APPROVED_TRI_CANDIDATES,
    matcherLanes: matcherLanes.sort((left, right) => left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)),
    rejections: rejections.sort((left, right) =>
      (left.candidateIdentityKey ?? "").localeCompare(right.candidateIdentityKey ?? "")
      || left.rejectionReason.localeCompare(right.rejectionReason)
    ),
    finalDecision
  };
};
