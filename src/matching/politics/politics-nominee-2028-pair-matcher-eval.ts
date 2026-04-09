import type {
  PoliticsNomineeOutcomeRouteabilityClass,
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsNomineeSharedCoreOutcomeRow,
  PoliticsNomineeTopicKey
} from "./politics-types.js";
import type {
  PoliticsNomineeSharedCoreTopicDecisionSummary,
  PoliticsNomineeSharedCoreTopicOutcomeSummary
} from "./politics-nominee-2028-shared-core.js";

export type PoliticsNomineePairLaneDecision =
  | "PAIR_EXACT_AUTO_ROUTEABLE"
  | "PAIR_ROUTEABLE_WITH_REVIEW"
  | "PAIR_SHARED_BUT_MATERIALLY_INCOMPATIBLE"
  | "PAIR_SHARED_BUT_UNKNOWN_RULES"
  | "PAIR_NO_SHARED_CORE";

export interface PoliticsNomineePairLaneCandidateSummary {
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityClass: Extract<PoliticsNomineeOutcomeRouteabilityClass, "EXACT_AUTO_ROUTEABLE" | "REVIEW_REQUIRED_ROUTEABLE">;
  venueOutcomes: readonly {
    venue: PoliticsNomineeSharedCoreOutcomeRow["venue"];
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
}

export interface PoliticsNomineePairLaneSummary {
  topicKey: PoliticsNomineeTopicKey;
  venuePair: string;
  pairDecision: PoliticsNomineePairLaneDecision;
  ruleDecision: PoliticsNomineeRuleCompatibilityClass;
  sharedNamedCandidateCount: number;
  exactRouteableCandidateCount: number;
  reviewRequiredCandidateCount: number;
  matcherEvalJustified: boolean;
  candidates: readonly PoliticsNomineePairLaneCandidateSummary[];
  excludedCandidates: readonly {
    candidateIdentityKey: string | null;
    rawOutcomeLabels: readonly string[];
    exclusionClasses: readonly PoliticsNomineeOutcomeRouteabilityClass[];
  }[];
}

export interface PoliticsNomineePairMatcherTopicSummary {
  topicKey: PoliticsNomineeTopicKey;
  sharedCoreTopicDecision: PoliticsNomineeSharedCoreTopicDecisionSummary["topicDecision"];
  pairLanes: readonly PoliticsNomineePairLaneSummary[];
  routeablePairLaneCount: number;
  matcherEvalJustified: boolean;
  bestPairLane: PoliticsNomineePairLaneSummary | null;
}

export interface PoliticsNomineePairMatcherFinalDecision {
  overallDecision:
    | "NOMINEE_2028_PAIR_MATCHER_READY"
    | "NOMINEE_2028_PAIR_MATCHER_READY_WITH_REVIEW"
    | "NOMINEE_2028_PAIR_MATCHER_NOT_READY";
  matcherEvalJustified: boolean;
  recommendedStartingTopic: PoliticsNomineeTopicKey | null;
  recommendedStartingPair: string | null;
  nextBestAction: string;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const sortVenues = (venues: readonly string[]): readonly string[] =>
  [...venues].sort((left, right) => left.localeCompare(right));

const toPairKey = (venues: readonly string[]): string =>
  sortVenues(venues).join("|");

const routeabilityRank = (value: PoliticsNomineeOutcomeRouteabilityClass): number =>
  value === "EXACT_AUTO_ROUTEABLE" ? 2
  : value === "REVIEW_REQUIRED_ROUTEABLE" ? 1
  : 0;

const toRuleDecision = (
  outcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[]
): PoliticsNomineeRuleCompatibilityClass => {
  const routeabilityClasses = unique(outcomes.map((outcome) => outcome.routeabilityClass));
  if (routeabilityClasses.includes("EXCLUDED_INCOMPATIBLE")) {
    return "RULES_MATERIALLY_INCOMPATIBLE";
  }
  if (routeabilityClasses.includes("EXCLUDED_UNKNOWN")) {
    return "UNKNOWN_RULE_MEANING";
  }
  if (routeabilityClasses.includes("REVIEW_REQUIRED_ROUTEABLE")) {
    return "REVIEW_REQUIRED_RULE_VARIANCE";
  }
  return "EXACT_RULE_COMPATIBLE";
};

const buildPairLaneSummary = (input: {
  topicKey: PoliticsNomineeTopicKey;
  venuePair: string;
  outcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[];
}): PoliticsNomineePairLaneSummary => {
  const byCandidate = new Map<string, PoliticsNomineeSharedCoreOutcomeRow[]>();
  const excludedCandidates: {
    candidateIdentityKey: string | null;
    rawOutcomeLabels: readonly string[];
    exclusionClasses: readonly PoliticsNomineeOutcomeRouteabilityClass[];
  }[] = [];

  for (const outcome of input.outcomes) {
    const candidateKey = outcome.candidateIdentityKey ?? `__excluded__|${outcome.rawOutcomeLabel}`;
    byCandidate.get(candidateKey)?.push(outcome) ?? byCandidate.set(candidateKey, [outcome]);
  }

  const candidates: PoliticsNomineePairLaneCandidateSummary[] = [];
  let exactRouteableCandidateCount = 0;
  let reviewRequiredCandidateCount = 0;

  for (const [candidateKey, grouped] of byCandidate.entries()) {
    const bestRouteability = grouped
      .map((outcome) => outcome.routeabilityClass)
      .sort((left, right) => routeabilityRank(right) - routeabilityRank(left))[0]!;

    if (bestRouteability !== "EXACT_AUTO_ROUTEABLE" && bestRouteability !== "REVIEW_REQUIRED_ROUTEABLE") {
      excludedCandidates.push({
        candidateIdentityKey: candidateKey.startsWith("__excluded__|") ? null : candidateKey,
        rawOutcomeLabels: unique(grouped.map((outcome) => outcome.rawOutcomeLabel)),
        exclusionClasses: unique(grouped.map((outcome) => outcome.routeabilityClass))
      });
      continue;
    }

    if (bestRouteability === "EXACT_AUTO_ROUTEABLE") {
      exactRouteableCandidateCount += 1;
    } else {
      reviewRequiredCandidateCount += 1;
    }

    const normalizedCandidateName = grouped.find((outcome) => outcome.normalizedCandidateName)?.normalizedCandidateName ?? candidateKey;
    candidates.push({
      candidateIdentityKey: candidateKey,
      normalizedCandidateName,
      routeabilityClass: bestRouteability,
      venueOutcomes: grouped
        .map((outcome) => ({
          venue: outcome.venue,
          venueMarketId: outcome.venueMarketId,
          rawOutcomeLabel: outcome.rawOutcomeLabel
        }))
        .sort((left, right) =>
          left.venue.localeCompare(right.venue)
          || left.venueMarketId.localeCompare(right.venueMarketId)
          || left.rawOutcomeLabel.localeCompare(right.rawOutcomeLabel)
        )
    });
  }

  const ruleDecision = toRuleDecision(input.outcomes);
  const pairDecision: PoliticsNomineePairLaneDecision =
    candidates.length <= 0 ? (
      ruleDecision === "RULES_MATERIALLY_INCOMPATIBLE" ? "PAIR_SHARED_BUT_MATERIALLY_INCOMPATIBLE"
      : ruleDecision === "UNKNOWN_RULE_MEANING" ? "PAIR_SHARED_BUT_UNKNOWN_RULES"
      : "PAIR_NO_SHARED_CORE"
    )
    : reviewRequiredCandidateCount > 0 ? "PAIR_ROUTEABLE_WITH_REVIEW"
    : "PAIR_EXACT_AUTO_ROUTEABLE";

  return {
    topicKey: input.topicKey,
    venuePair: input.venuePair,
    pairDecision,
    ruleDecision,
    sharedNamedCandidateCount: candidates.length,
    exactRouteableCandidateCount,
    reviewRequiredCandidateCount,
    matcherEvalJustified: pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE" || pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW",
    candidates: candidates.sort((left, right) => left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)),
    excludedCandidates
  };
};

export const buildNominee2028PairMatcherTopicSummary = (input: {
  topicKey: PoliticsNomineeTopicKey;
  outcomeCore: PoliticsNomineeSharedCoreTopicOutcomeSummary;
  topicDecision: PoliticsNomineeSharedCoreTopicDecisionSummary;
}): PoliticsNomineePairMatcherTopicSummary => {
  const pairOutcomeRows = [
    ...input.outcomeCore.pairSharedNamedOutcomes,
    ...input.outcomeCore.excludedOutcomes.filter((outcome) => outcome.sharedAcrossVenueCount === 2 && outcome.isNamedCandidate)
  ];

  const byPair = new Map<string, PoliticsNomineeSharedCoreOutcomeRow[]>();
  for (const outcome of pairOutcomeRows) {
    const pairKey = toPairKey(outcome.sharedAcrossWhichVenues);
    byPair.get(pairKey)?.push(outcome) ?? byPair.set(pairKey, [outcome]);
  }

  const pairLanes = [...byPair.entries()]
    .map(([venuePair, outcomes]) => buildPairLaneSummary({
      topicKey: input.topicKey,
      venuePair,
      outcomes
    }))
    .sort((left, right) =>
      Number(right.matcherEvalJustified) - Number(left.matcherEvalJustified)
      || right.sharedNamedCandidateCount - left.sharedNamedCandidateCount
      || left.venuePair.localeCompare(right.venuePair)
    );

  return {
    topicKey: input.topicKey,
    sharedCoreTopicDecision: input.topicDecision.topicDecision,
    routeablePairLaneCount: pairLanes.filter((lane) => lane.matcherEvalJustified).length,
    matcherEvalJustified: pairLanes.some((lane) => lane.matcherEvalJustified),
    bestPairLane: pairLanes.find((lane) => lane.matcherEvalJustified) ?? null,
    pairLanes
  };
};

const comparePairLanes = (
  left: PoliticsNomineePairLaneSummary | null,
  right: PoliticsNomineePairLaneSummary | null
): number => {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return Number(right.matcherEvalJustified) - Number(left.matcherEvalJustified)
    || (right.pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE" ? 1 : 0) - (left.pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE" ? 1 : 0)
    || right.sharedNamedCandidateCount - left.sharedNamedCandidateCount
    || left.venuePair.localeCompare(right.venuePair);
};

export const buildNominee2028PairMatcherFinalDecision = (input: {
  republican: PoliticsNomineePairMatcherTopicSummary;
  democratic: PoliticsNomineePairMatcherTopicSummary;
}): PoliticsNomineePairMatcherFinalDecision => {
  const bestLane = [input.republican.bestPairLane, input.democratic.bestPairLane]
    .sort(comparePairLanes)[0] ?? null;

  const anyReviewRequired = [
    ...input.republican.pairLanes,
    ...input.democratic.pairLanes
  ].some((lane) => lane.pairDecision === "PAIR_ROUTEABLE_WITH_REVIEW");

  const matcherEvalJustified = Boolean(bestLane?.matcherEvalJustified);
  return {
    overallDecision:
      !matcherEvalJustified ? "NOMINEE_2028_PAIR_MATCHER_NOT_READY"
      : anyReviewRequired ? "NOMINEE_2028_PAIR_MATCHER_READY_WITH_REVIEW"
      : "NOMINEE_2028_PAIR_MATCHER_READY",
    matcherEvalJustified,
    recommendedStartingTopic:
      bestLane?.topicKey ?? null,
    recommendedStartingPair:
      bestLane?.venuePair ?? null,
    nextBestAction:
      !bestLane ? "Repair cross-venue nominee shared-core supply before matcher work."
      : bestLane.sharedNamedCandidateCount >= 2
        ? `Run the narrow nominee matcher on ${bestLane.topicKey} using the ${bestLane.venuePair} shared named-outcome core first.`
        : `Run a thin-scope nominee matcher check on ${bestLane.topicKey} using the ${bestLane.venuePair} shared named-outcome core, but keep the result secondary because only one shared named candidate survived.`
  };
};
