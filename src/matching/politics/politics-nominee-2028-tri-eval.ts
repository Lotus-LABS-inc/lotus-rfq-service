import type {
  PoliticsNomineeOutcomeRouteabilityClass,
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsNomineeSharedCoreOutcomeRow,
  PoliticsNomineeTopicKey,
  PoliticsNomineeTriEvalFinalDecision,
  PoliticsNomineeTriEvalTopicSummary,
  PoliticsNomineeTriLaneCandidateSummary,
  PoliticsNomineeTriLaneDecision,
  PoliticsNomineeTriLaneSummary,
  PoliticsNomineeTriTopicDecision
} from "./politics-types.js";
import type {
  PoliticsNomineePairMatcherTopicSummary
} from "./politics-nominee-2028-pair-matcher-eval.js";
import type {
  PoliticsNomineeSharedCoreTopicDecisionSummary,
  PoliticsNomineeSharedCoreTopicOutcomeSummary
} from "./politics-nominee-2028-shared-core.js";

const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];
const sortVenues = (venues: readonly string[]): readonly string[] => [...venues].sort((left, right) => left.localeCompare(right));
const toVenueSet = (venues: readonly string[]): string => sortVenues(venues).join("|");

const routeabilityRank = (value: PoliticsNomineeOutcomeRouteabilityClass): number =>
  value === "EXACT_AUTO_ROUTEABLE" ? 2
  : value === "REVIEW_REQUIRED_ROUTEABLE" ? 1
  : 0;

const toTriRuleDecision = (outcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[]): PoliticsNomineeRuleCompatibilityClass =>
  outcomes.some((outcome) => outcome.routeabilityClass === "EXCLUDED_INCOMPATIBLE") ? "RULES_MATERIALLY_INCOMPATIBLE"
  : outcomes.some((outcome) => outcome.routeabilityClass === "EXCLUDED_UNKNOWN") ? "UNKNOWN_RULE_MEANING"
  : outcomes.some((outcome) => outcome.routeabilityClass === "REVIEW_REQUIRED_ROUTEABLE") ? "REVIEW_REQUIRED_RULE_VARIANCE"
  : "EXACT_RULE_COMPATIBLE";

const toTriExclusionReason = (outcome: PoliticsNomineeSharedCoreOutcomeRow): string =>
  outcome.isOthersBucket ? "OTHERS_EXCLUDED"
  : !outcome.isNamedCandidate || !outcome.candidateIdentityKey ? "UNKNOWN_COMPOSITE"
  : outcome.routeabilityClass === "EXCLUDED_INCOMPATIBLE" ? "RULE_MISMATCH"
  : outcome.routeabilityClass === "EXCLUDED_UNKNOWN" ? "UNKNOWN_COMPOSITE"
  : outcome.sharedAcrossVenueCount === 2 ? "PAIR_ONLY"
  : outcome.sharedAcrossVenueCount <= 1 ? "NOT_SHARED"
  : "TRI_EDGE_MISSING";

const toTriCandidateSummary = (rows: readonly PoliticsNomineeSharedCoreOutcomeRow[]): PoliticsNomineeTriLaneCandidateSummary => ({
  candidateIdentityKey: rows[0]!.candidateIdentityKey!,
  normalizedCandidateName: rows.find((row) => row.normalizedCandidateName)?.normalizedCandidateName ?? rows[0]!.candidateIdentityKey!,
  routeabilityClass: rows
    .map((row) => row.routeabilityClass)
    .sort((left, right) => routeabilityRank(right) - routeabilityRank(left))[0] as "EXACT_AUTO_ROUTEABLE" | "REVIEW_REQUIRED_ROUTEABLE",
  venueOutcomes: rows
    .map((row) => ({
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      rawOutcomeLabel: row.rawOutcomeLabel
    }))
    .sort((left, right) =>
      left.venue.localeCompare(right.venue)
      || left.venueMarketId.localeCompare(right.venueMarketId)
      || left.rawOutcomeLabel.localeCompare(right.rawOutcomeLabel)
    )
});

export const buildNominee2028TriLane = (input: {
  topicKey: PoliticsNomineeTopicKey;
  outcomeCore: PoliticsNomineeSharedCoreTopicOutcomeSummary;
}): PoliticsNomineeTriLaneSummary => {
  const triIncludedRows = [
    ...input.outcomeCore.triSharedNamedOutcomes,
    ...input.outcomeCore.pairSharedNamedOutcomes,
    ...input.outcomeCore.excludedOutcomes.filter((outcome) => outcome.sharedAcrossVenueCount === 3)
  ].filter((outcome) =>
    outcome.sharedAcrossVenueCount === 2 || toVenueSet(outcome.sharedAcrossWhichVenues) === TRI_VENUE_SET
  );

  const triSafeRows = triIncludedRows.filter((outcome) => outcome.sharedAcrossVenueCount === 3);
  const pairOnlyRows = triIncludedRows.filter((outcome) => outcome.sharedAcrossVenueCount === 2);

  const grouped = new Map<string, PoliticsNomineeSharedCoreOutcomeRow[]>();
  for (const outcome of triSafeRows) {
    const candidateKey = outcome.candidateIdentityKey ?? `__excluded__|${outcome.rawOutcomeLabel}`;
    grouped.get(candidateKey)?.push(outcome) ?? grouped.set(candidateKey, [outcome]);
  }

  const safeCandidates: PoliticsNomineeTriLaneCandidateSummary[] = [];
  const excludedCandidates: {
    candidateIdentityKey: string | null;
    normalizedCandidateName: string | null;
    exclusionReasons: readonly string[];
    sharedAcrossWhichVenues: readonly string[];
  }[] = [];

  for (const [candidateKey, rows] of grouped.entries()) {
    const bestRouteability = rows
      .map((row) => row.routeabilityClass)
      .sort((left, right) => routeabilityRank(right) - routeabilityRank(left))[0]!;

    if (bestRouteability === "EXACT_AUTO_ROUTEABLE" || bestRouteability === "REVIEW_REQUIRED_ROUTEABLE") {
      safeCandidates.push(toTriCandidateSummary(rows));
      continue;
    }

    excludedCandidates.push({
      candidateIdentityKey: candidateKey.startsWith("__excluded__|") ? null : candidateKey,
      normalizedCandidateName: rows.find((row) => row.normalizedCandidateName)?.normalizedCandidateName ?? null,
      exclusionReasons: unique(rows.map((row) => toTriExclusionReason(row))),
      sharedAcrossWhichVenues: sortVenues(rows.flatMap((row) => row.sharedAcrossWhichVenues))
    });
  }

  const pairOnlyGrouped = new Map<string, PoliticsNomineeSharedCoreOutcomeRow[]>();
  for (const outcome of pairOnlyRows) {
    const candidateKey = outcome.candidateIdentityKey ?? `__excluded__|${outcome.rawOutcomeLabel}`;
    pairOnlyGrouped.get(candidateKey)?.push(outcome) ?? pairOnlyGrouped.set(candidateKey, [outcome]);
  }
  for (const [candidateKey, rows] of pairOnlyGrouped.entries()) {
    excludedCandidates.push({
      candidateIdentityKey: candidateKey.startsWith("__excluded__|") ? null : candidateKey,
      normalizedCandidateName: rows.find((row) => row.normalizedCandidateName)?.normalizedCandidateName ?? null,
      exclusionReasons: ["PAIR_ONLY"],
      sharedAcrossWhichVenues: sortVenues(rows.flatMap((row) => row.sharedAcrossWhichVenues))
    });
  }

  const ruleDecision = toTriRuleDecision(triSafeRows);
  const triDecision: PoliticsNomineeTriLaneDecision =
    safeCandidates.length <= 0 ? (
      ruleDecision === "RULES_MATERIALLY_INCOMPATIBLE" ? "TRI_BLOCKED_RULE_MISMATCH"
      : ruleDecision === "UNKNOWN_RULE_MEANING" ? "TRI_BLOCKED_UNKNOWN_RULES"
      : "TRI_NO_SHARED_CORE"
    )
    : ruleDecision === "REVIEW_REQUIRED_RULE_VARIANCE" ? "TRI_ROUTEABLE_WITH_REVIEW"
    : "TRI_EXACT_AUTO_ROUTEABLE";

  return {
    topicKey: input.topicKey,
    venueSet: TRI_VENUE_SET,
    triDecision,
    ruleDecision,
    safeCandidates: safeCandidates.sort((left, right) => left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)),
    excludedCandidates,
    matcherEvalJustified: triDecision === "TRI_EXACT_AUTO_ROUTEABLE" || triDecision === "TRI_ROUTEABLE_WITH_REVIEW",
    thinness: safeCandidates.length >= 4 ? "STRONG" : "THIN"
  };
};

export const buildNominee2028TriEvalTopicSummary = (input: {
  topicKey: PoliticsNomineeTopicKey;
  topicDecision: PoliticsNomineeSharedCoreTopicDecisionSummary;
  outcomeCore: PoliticsNomineeSharedCoreTopicOutcomeSummary;
  pairSummary: PoliticsNomineePairMatcherTopicSummary;
}): PoliticsNomineeTriEvalTopicSummary => {
  const triLane = buildNominee2028TriLane({
    topicKey: input.topicKey,
    outcomeCore: input.outcomeCore
  });

  const bestPairLane = input.pairSummary.bestPairLane;
  const pairSafeCandidateCount = bestPairLane?.sharedNamedCandidateCount ?? 0;
  const triSafeCandidateCount = triLane.safeCandidates.length;

  const topicFinalDecision: PoliticsNomineeTriTopicDecision =
    triLane.triDecision === "TRI_EXACT_AUTO_ROUTEABLE" && triSafeCandidateCount > 0 && triSafeCandidateCount >= pairSafeCandidateCount
      ? "TRI_EXACT_AUTO_ROUTEABLE"
    : triLane.matcherEvalJustified && triSafeCandidateCount > 0
      ? "TRI_READY_BUT_PAIR_FIRST"
    : input.pairSummary.matcherEvalJustified
      ? "PAIR_ONLY_STILL_BEST"
      : "NOT_TRI_JUSTIFIED";

  return {
    topicKey: input.topicKey,
    sharedCoreTopicDecision: input.topicDecision.topicDecision,
    bestPairLane: bestPairLane
      ? {
          venuePair: bestPairLane.venuePair,
          pairDecision: bestPairLane.pairDecision,
          ruleDecision: bestPairLane.ruleDecision,
          sharedNamedCandidateCount: bestPairLane.sharedNamedCandidateCount,
          exactRouteableCandidateCount: bestPairLane.exactRouteableCandidateCount,
          reviewRequiredCandidateCount: bestPairLane.reviewRequiredCandidateCount,
          matcherEvalJustified: bestPairLane.matcherEvalJustified,
          excludedCandidates: bestPairLane.excludedCandidates
        }
      : null,
    triLane,
    triSafeCandidateCount,
    pairSafeCandidateCount,
    topicFinalDecision,
    operatorCredible: topicFinalDecision !== "NOT_TRI_JUSTIFIED"
  };
};

const startingLaneRank = (input: {
  topicKey: PoliticsNomineeTopicKey;
  laneType: "TRI" | "PAIR";
  exact: boolean;
  safeCandidateCount: number;
}): [number, number, string] =>
  input.laneType === "TRI" && input.exact ? [0, -input.safeCandidateCount, input.topicKey]
  : input.laneType === "PAIR" && input.exact ? [1, -input.safeCandidateCount, input.topicKey]
  : input.laneType === "TRI" ? [2, -input.safeCandidateCount, input.topicKey]
  : [3, -input.safeCandidateCount, input.topicKey];

export const buildNominee2028TriEvalFinalDecision = (input: {
  republican: PoliticsNomineeTriEvalTopicSummary;
  democratic: PoliticsNomineeTriEvalTopicSummary;
}): PoliticsNomineeTriEvalFinalDecision => {
  const candidateLanes = [
    input.republican.triLane.matcherEvalJustified ? {
      topicKey: input.republican.topicKey,
      laneType: "TRI" as const,
      venueSet: input.republican.triLane.venueSet,
      safeCandidateCount: input.republican.triSafeCandidateCount,
      exact: input.republican.triLane.triDecision === "TRI_EXACT_AUTO_ROUTEABLE"
    } : null,
    input.republican.bestPairLane?.matcherEvalJustified ? {
      topicKey: input.republican.topicKey,
      laneType: "PAIR" as const,
      venueSet: input.republican.bestPairLane.venuePair,
      safeCandidateCount: input.republican.bestPairLane.sharedNamedCandidateCount,
      exact: input.republican.bestPairLane.pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE"
    } : null,
    input.democratic.triLane.matcherEvalJustified ? {
      topicKey: input.democratic.topicKey,
      laneType: "TRI" as const,
      venueSet: input.democratic.triLane.venueSet,
      safeCandidateCount: input.democratic.triSafeCandidateCount,
      exact: input.democratic.triLane.triDecision === "TRI_EXACT_AUTO_ROUTEABLE"
    } : null,
    input.democratic.bestPairLane?.matcherEvalJustified ? {
      topicKey: input.democratic.topicKey,
      laneType: "PAIR" as const,
      venueSet: input.democratic.bestPairLane.venuePair,
      safeCandidateCount: input.democratic.bestPairLane.sharedNamedCandidateCount,
      exact: input.democratic.bestPairLane.pairDecision === "PAIR_EXACT_AUTO_ROUTEABLE"
    } : null
  ].filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) =>
      startingLaneRank(left)[0] - startingLaneRank(right)[0]
      || startingLaneRank(left)[1] - startingLaneRank(right)[1]
      || startingLaneRank(left)[2].localeCompare(startingLaneRank(right)[2])
    );

  const recommendedStartingLane = candidateLanes[0] ?? null;
  const triOperatorCredible = input.republican.operatorCredible || input.democratic.operatorCredible;
  const pairStillPreferred =
    input.republican.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST"
    || input.republican.topicFinalDecision === "PAIR_ONLY_STILL_BEST"
    || input.democratic.topicFinalDecision === "TRI_READY_BUT_PAIR_FIRST"
    || input.democratic.topicFinalDecision === "PAIR_ONLY_STILL_BEST";

  return {
    overallTriDecision:
      input.republican.topicFinalDecision === "TRI_EXACT_AUTO_ROUTEABLE" || input.democratic.topicFinalDecision === "TRI_EXACT_AUTO_ROUTEABLE"
        ? "NOMINEE_2028_TRI_APPROVED"
      : triOperatorCredible
        ? "NOMINEE_2028_TRI_PARTIAL_PAIR_PREFERRED"
        : "NOMINEE_2028_TRI_NOT_JUSTIFIED",
    republicanDecision: input.republican.topicFinalDecision,
    democraticDecision: input.democratic.topicFinalDecision,
    recommendedStartingLane,
    triOperatorCredible,
    pairStillPreferred,
    nextBestAction:
      !recommendedStartingLane ? "Repair nominee shared-core evidence before tri or pair matcher work."
      : recommendedStartingLane.laneType === "TRI"
        ? `Run the nominee matcher on ${recommendedStartingLane.topicKey} using the exact tri lane ${recommendedStartingLane.venueSet}.`
        : `Run the nominee matcher on ${recommendedStartingLane.topicKey} using the best exact pair lane ${recommendedStartingLane.venueSet}.`
  };
};
