import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeDemocraticPairMatcherLane,
  PoliticsNomineeDemocraticPairMatcherRejection,
  PoliticsNomineeOutcomeRouteabilityClass,
  PoliticsNomineeTopicKey,
  PoliticsNomineeTriEvalTopicSummary
} from "./politics-types.js";
import type {
  PoliticsNomineePairLaneSummary,
  PoliticsNomineePairMatcherTopicSummary
} from "./politics-nominee-2028-pair-matcher-eval.js";
import type { PoliticsNomineeSharedCoreTopicOutcomeSummary } from "./politics-nominee-2028-shared-core.js";

const TOPIC_KEY = "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC" as const satisfies PoliticsNomineeTopicKey;
const EVIDENCE_SOURCES = [
  "artifacts/politics/nominee-2028-shared-core",
  "artifacts/politics/nominee-2028-pair-matcher-eval",
  "artifacts/politics/nominee-2028-tri-eval"
] as const;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const exclusionClassToReason = (
  exclusionClass: PoliticsNomineeOutcomeRouteabilityClass,
  candidateIdentityKey: string | null
): PoliticsNomineeDemocraticPairMatcherRejection["reason"] =>
  exclusionClass === "EXCLUDED_OTHER_BUCKET" ? "OTHERS_EXCLUDED"
  : exclusionClass === "EXCLUDED_INCOMPATIBLE" ? "RULE_MISMATCH"
  : exclusionClass === "EXCLUDED_UNKNOWN" ? candidateIdentityKey ? "UNKNOWN_COMPOSITE" : "CANDIDATE_IDENTITY_UNRESOLVED"
  : "NOT_SHARED";

const pairDecisionToRouteability = (
  pairDecision: PoliticsNomineePairLaneSummary["pairDecision"]
): PoliticsNomineeDemocraticPairMatcherLane["routeabilityDecision"] =>
  pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE" ? "PAIR_EXACT_AUTO_ROUTEABLE"
  : pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW" ? "PAIR_REVIEW_REQUIRED"
  : "PAIR_REJECTED";

const formatVenueOutcomes = (
  lane: PoliticsNomineePairLaneSummary["candidates"][number]["venueOutcomes"]
): PoliticsNomineeDemocraticPairMatcherLane["evidence"] =>
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
      ? "Best exact-safe Democratic pair lane by current pair-eval evidence."
      : "Secondary exact-safe Democratic pair lane from current pair-eval evidence."
  ];
  if (input.lane.sharedNamedCandidateCount <= 1) {
    notes.push("Thin but valid lane.");
  }
  if (input.lane.pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW") {
    notes.push("Rule variance requires operator review before trading.");
  }
  return notes;
};

export interface PoliticsNomineeDemocraticPairMatcherMaterialization {
  topicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  admittedCandidates: readonly string[];
  matcherLanes: readonly PoliticsNomineeDemocraticPairMatcherLane[];
  rejections: readonly PoliticsNomineeDemocraticPairMatcherRejection[];
  finalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision;
}

export const buildDemocraticPairMatcherMaterialization = (input: {
  pairSummary: PoliticsNomineePairMatcherTopicSummary;
  outcomeCore: PoliticsNomineeSharedCoreTopicOutcomeSummary;
  triSummary?: PoliticsNomineeTriEvalTopicSummary | null;
}): PoliticsNomineeDemocraticPairMatcherMaterialization => {
  const materializedLanes: PoliticsNomineeDemocraticPairMatcherLane[] = [];

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

  const rejections: PoliticsNomineeDemocraticPairMatcherRejection[] = [];

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
      reason: exclusionClassToReason(outcome.routeabilityClass, outcome.candidateIdentityKey),
      notes:
        outcome.isOthersBucket
          ? "Others is always excluded from Democratic pair matcher construction."
          : outcome.candidateIdentityKey === null
            ? `Outcome ${outcome.rawOutcomeLabel} could not be resolved to a stable candidate identity and is excluded.`
            : `Candidate ${outcome.candidateIdentityKey} is not part of the exact-safe Democratic pair intersection.`
    });
  }

  const bestPair = input.pairSummary.bestPairLane;
  const reviewOnly = materializedLanes.length > 0 && materializedLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED");
  const thinBestLane = (bestPair?.sharedNamedCandidateCount ?? 0) <= 1;
  const exactSafeCandidateCount = bestPair?.candidates.length ?? 0;

  const finalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision = {
    overallDecision:
      materializedLanes.length <= 0 ? "DEMOCRATIC_PAIR_MATCHER_NOT_LIMITED_PROD_READY"
      : reviewOnly ? "DEMOCRATIC_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
      : thinBestLane ? "DEMOCRATIC_PAIR_MATCHER_THIN_BUT_VALID"
      : "DEMOCRATIC_PAIR_MATCHER_READY",
    bestPair: bestPair?.venuePair ?? null,
    bestStartingCandidates: bestPair?.candidates.map((candidate) => candidate.candidateIdentityKey) ?? [],
    pairMatcherReady: materializedLanes.length > 0,
    operatorCredible: materializedLanes.length > 0,
    pairPreferred: true,
    triNotYetPreferred: true,
    exactSafeCandidateCount,
    singleBestNextAction:
      !bestPair
        ? "Hold Democratic pair matcher construction until an exact-safe pair lane exists."
        : reviewOnly
          ? `Review Democratic pair lane ${bestPair.venuePair} before any limited-prod readiness work because only review-required evidence survived.`
          : `Start limited-prod readiness review on the Democratic pair lane ${bestPair.venuePair} with candidates ${bestPair.candidates.map((candidate) => candidate.candidateIdentityKey).join(", ")}.`
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
      left.scope.localeCompare(right.scope)
      || (left.venuePair ?? "").localeCompare(right.venuePair ?? "")
      || (left.candidateIdentityKey ?? "").localeCompare(right.candidateIdentityKey ?? "")
      || left.reason.localeCompare(right.reason)
    ),
    finalDecision
  };
};
