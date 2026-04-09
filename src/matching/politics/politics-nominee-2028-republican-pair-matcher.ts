import type {
  PoliticsNomineeOutcomeRouteabilityClass,
  PoliticsNomineeRepublicanPairMatcherFinalDecision,
  PoliticsNomineeRepublicanPairMatcherLane,
  PoliticsNomineeRepublicanPairMatcherRejection,
  PoliticsNomineeTopicKey,
  PoliticsNomineeTriEvalTopicSummary
} from "./politics-types.js";
import type {
  PoliticsNomineePairLaneSummary,
  PoliticsNomineePairMatcherTopicSummary
} from "./politics-nominee-2028-pair-matcher-eval.js";
import type { PoliticsNomineeSharedCoreTopicOutcomeSummary } from "./politics-nominee-2028-shared-core.js";

const TOPIC_KEY = "NOMINEE|US_PRESIDENT|2028|REPUBLICAN" as const satisfies PoliticsNomineeTopicKey;
const EVIDENCE_SOURCES = [
  "artifacts/politics/nominee-2028-shared-core",
  "artifacts/politics/nominee-2028-pair-matcher-eval",
  "artifacts/politics/nominee-2028-tri-eval"
] as const;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const exclusionClassToReason = (
  exclusionClass: PoliticsNomineeOutcomeRouteabilityClass
): PoliticsNomineeRepublicanPairMatcherRejection["reason"] =>
  exclusionClass === "EXCLUDED_OTHER_BUCKET" ? "OTHERS_EXCLUDED"
  : exclusionClass === "EXCLUDED_INCOMPATIBLE" ? "RULE_MISMATCH"
  : exclusionClass === "EXCLUDED_UNKNOWN" ? "UNKNOWN_COMPOSITE"
  : "NOT_SHARED";

const pairDecisionToRouteability = (
  pairDecision: PoliticsNomineePairLaneSummary["pairDecision"]
): PoliticsNomineeRepublicanPairMatcherLane["routeabilityDecision"] =>
  pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE" ? "PAIR_EXACT_AUTO_ROUTEABLE"
  : pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW" ? "PAIR_REVIEW_REQUIRED"
  : "PAIR_REJECTED";

const formatVenueOutcomes = (
  lane: PoliticsNomineePairLaneSummary["candidates"][number]["venueOutcomes"]
): PoliticsNomineeRepublicanPairMatcherLane["evidence"] =>
  lane.map((outcome) => ({
    venue: outcome.venue,
    venueMarketId: outcome.venueMarketId,
    rawOutcomeLabel: outcome.rawOutcomeLabel
  }));

const buildLaneNotes = (input: {
  lane: PoliticsNomineePairLaneSummary;
  isBestPair: boolean;
}): readonly string[] => {
  const notes = [
    input.isBestPair
      ? "Best exact-safe Republican pair lane by current pair-eval evidence."
      : "Secondary exact-safe Republican pair lane from current pair-eval evidence."
  ];
  if (input.lane.sharedNamedCandidateCount <= 1) {
    notes.push("Thin but valid lane.");
  }
  if (input.lane.pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW") {
    notes.push("Rule variance requires operator review before trading.");
  }
  return notes;
};

export interface PoliticsNomineeRepublicanPairMatcherMaterialization {
  topicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  admittedCandidates: readonly string[];
  matcherLanes: readonly PoliticsNomineeRepublicanPairMatcherLane[];
  rejections: readonly PoliticsNomineeRepublicanPairMatcherRejection[];
  finalDecision: PoliticsNomineeRepublicanPairMatcherFinalDecision;
}

export const buildRepublicanPairMatcherMaterialization = (input: {
  pairSummary: PoliticsNomineePairMatcherTopicSummary;
  outcomeCore: PoliticsNomineeSharedCoreTopicOutcomeSummary;
  triSummary: PoliticsNomineeTriEvalTopicSummary;
}): PoliticsNomineeRepublicanPairMatcherMaterialization => {
  const materializedLanes: PoliticsNomineeRepublicanPairMatcherLane[] = [];

  for (const lane of input.pairSummary.pairLanes) {
    if (!lane.matcherEvalJustified) {
      continue;
    }
    for (const candidate of lane.candidates) {
      materializedLanes.push({
        topicKey: TOPIC_KEY,
        venuePair: lane.venuePair,
        candidateIdentityKey: candidate.candidateIdentityKey,
        normalizedCandidateName: candidate.normalizedCandidateName,
        routeabilityDecision: pairDecisionToRouteability(lane.pairDecision),
        rulesDecision: lane.ruleDecision,
        matcherReady: lane.pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE" || lane.pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW",
        evidenceSources: EVIDENCE_SOURCES,
        evidence: formatVenueOutcomes(candidate.venueOutcomes),
        notes: buildLaneNotes({
          lane,
          isBestPair: input.pairSummary.bestPairLane?.venuePair === lane.venuePair
        })
      });
    }
  }

  const admittedCandidates = [...unique(materializedLanes.map((lane) => lane.candidateIdentityKey))].sort((left, right) =>
    left.localeCompare(right)
  );
  const admittedVenues = [...unique(materializedLanes.flatMap((lane) => lane.evidence.map((evidence) => evidence.venue)))].sort((left, right) =>
    left.localeCompare(right)
  );
  const materializedCandidateKeys = new Set(admittedCandidates);

  const rejections: PoliticsNomineeRepublicanPairMatcherRejection[] = [];

  for (const lane of input.pairSummary.pairLanes) {
    if (lane.matcherEvalJustified) {
      continue;
    }
    rejections.push({
      scope: "lane",
      venuePair: lane.venuePair,
      reason:
        lane.pairDecision === "PAIR_SHARED_BUT_MATERIALLY_INCOMPATIBLE" ? "RULE_MISMATCH"
        : lane.sharedNamedCandidateCount <= 1 ? "THIN_LANE"
        : "PAIR_EDGE_MISSING",
      notes: `Lane ${lane.venuePair} was not materialized because current pair-eval marked it ${lane.pairDecision}.`
    });
  }

  for (const outcome of input.outcomeCore.excludedOutcomes) {
    rejections.push({
      scope: "candidate",
      candidateIdentityKey: outcome.candidateIdentityKey,
      normalizedCandidateName: outcome.normalizedCandidateName,
      venuePair: null,
      reason: exclusionClassToReason(outcome.routeabilityClass),
      notes:
        outcome.isOthersBucket
          ? "Others is always excluded from Republican pair matcher construction."
          : outcome.routeabilityClass === "EXCLUDED_UNKNOWN"
            ? `Outcome ${outcome.rawOutcomeLabel} is unknown/composite and cannot be promoted into a pair lane.`
            : `Candidate ${outcome.candidateIdentityKey ?? outcome.rawOutcomeLabel} is not part of the exact-safe Republican pair intersection.`
    });
  }

  for (const triCandidate of input.triSummary.triLane.safeCandidates) {
    if (materializedCandidateKeys.has(triCandidate.candidateIdentityKey)) {
      continue;
    }
    rejections.push({
      scope: "candidate",
      candidateIdentityKey: triCandidate.candidateIdentityKey,
      normalizedCandidateName: triCandidate.normalizedCandidateName,
      venuePair: null,
      reason: "PAIR_EDGE_MISSING",
      notes: `Candidate ${triCandidate.candidateIdentityKey} survives the Republican tri lane but is not authorized by the current exact-safe pair-eval source, so it is held out of pair matcher construction.`
    });
  }

  const bestPair = input.pairSummary.bestPairLane;
  const exactReadyLaneCount = input.pairSummary.pairLanes.filter((lane) => lane.pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE").length;
  const reviewOnly = materializedLanes.length > 0 && materializedLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED");
  const thinBestLane = (bestPair?.sharedNamedCandidateCount ?? 0) <= 1;

  const finalDecision: PoliticsNomineeRepublicanPairMatcherFinalDecision = {
    overallDecision:
      materializedLanes.length <= 0 ? "REPUBLICAN_PAIR_MATCHER_HELD_ON_RULES"
      : reviewOnly ? "REPUBLICAN_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
      : thinBestLane ? "REPUBLICAN_PAIR_MATCHER_THIN_BUT_VALID"
      : "REPUBLICAN_PAIR_MATCHER_READY",
    bestPair: bestPair?.venuePair ?? null,
    bestStartingCandidates: bestPair?.candidates.map((candidate) => candidate.candidateIdentityKey) ?? [],
    pairMatcherReady: materializedLanes.length > 0,
    operatorCredible: materializedLanes.length > 0,
    pairFallbackStillPreferred: input.triSummary.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST",
    singleBestNextAction:
      !bestPair
        ? "Hold Republican pair matcher construction until an exact-safe pair lane exists."
        : exactReadyLaneCount > 0
          ? `Start limited-prod operator review on the Republican pair lane ${bestPair.venuePair} with candidates ${bestPair.candidates.map((candidate) => candidate.candidateIdentityKey).join(", ")}.`
          : `Review Republican pair lane ${bestPair.venuePair} before any matcher promotion because only review-required evidence survived.`
  };

  return {
    topicKey: TOPIC_KEY,
    admittedVenues,
    admittedCandidates,
    matcherLanes: materializedLanes.sort((left, right) =>
      left.venuePair.localeCompare(right.venuePair)
      || left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)
    ),
    rejections: rejections.sort((left, right) =>
      (left.scope ?? "").localeCompare(right.scope ?? "")
      || (left.venuePair ?? "").localeCompare(right.venuePair ?? "")
      || (left.candidateIdentityKey ?? "").localeCompare(right.candidateIdentityKey ?? "")
      || left.reason.localeCompare(right.reason)
    ),
    finalDecision
  };
};
