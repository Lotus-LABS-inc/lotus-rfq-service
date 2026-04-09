import type {
  SportsF1ConstructorsChampionComparabilityTopicSummary,
  SportsF1ConstructorsChampionNormalizedTopicRow,
  SportsF1ConstructorsChampionRuleCompatibilityClass,
  SportsF1ConstructorsChampionVenue
} from "./sports-f1-constructors-champion-family-pass.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026" as const;
const ALL_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const VENUE_PRIORITY = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;
const PAIR_PRIORITY = [
  "LIMITLESS|POLYMARKET",
  "LIMITLESS|OPINION",
  "LIMITLESS|PREDICT",
  "OPINION|POLYMARKET",
  "OPINION|PREDICT",
  "POLYMARKET|PREDICT"
] as const;
const EVIDENCE_SOURCES = [
  "artifacts/sports/f1-constructors-champion-family-pass/sports-f1-constructors-champion-fetch-summary.json",
  "artifacts/sports/f1-constructors-champion-family-pass/sports-f1-constructors-champion-admission-summary.json",
  "artifacts/sports/f1-constructors-champion-family-pass/sports-f1-constructors-champion-normalized-topics.json",
  "artifacts/sports/f1-constructors-champion-family-pass/sports-f1-constructors-champion-comparability-summary.json",
  "artifacts/sports/f1-constructors-champion-family-pass/sports-f1-constructors-champion-basis-fragmentation-summary.json",
  "artifacts/sports/f1-constructors-champion-family-pass/sports-f1-constructors-champion-final-decision.json"
] as const;

type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface SportsF1ConstructorsChampion2026PairLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  constructorIdentityKey: string;
  normalizedConstructorName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: SportsF1ConstructorsChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsF1ConstructorsChampionVenue;
    venueMarketId: string;
    rawConstructorLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsF1ConstructorsChampion2026AllVenueLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  canonicalVenueSet: typeof ALL_VENUE_SET;
  constructorIdentityKey: string;
  normalizedConstructorName: string;
  routeabilityDecision: "ALL_VENUE_EXACT_AUTO_ROUTEABLE" | "ALL_VENUE_REVIEW_REQUIRED" | "ALL_VENUE_REJECTED";
  rulesDecision: SportsF1ConstructorsChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsF1ConstructorsChampionVenue;
    venueMarketId: string;
    rawConstructorLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsF1ConstructorsChampion2026MatcherRejection {
  scope: "constructor" | "pair_lane" | "all_venue_lane";
  constructorIdentityKey?: string | null;
  normalizedConstructorName?: string | null;
  venuePair?: string;
  venueSet?: string;
  reason: "NOT_SHARED" | "OTHERS_EXCLUDED" | "PAIR_EDGE_MISSING" | "ALL_VENUE_EDGE_MISSING" | "RULE_MISMATCH";
  notes: string;
}

export interface SportsF1ConstructorsChampion2026MatcherFinalDecision {
  overallDecision:
    | "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
    | "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_MATCHER_NOT_READY";
  bestPair: PairVenueSet | null;
  bestAllVenueIfAny: typeof ALL_VENUE_SET | null;
  pairMatcherReady: boolean;
  allVenueMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeAllVenueCandidateCount: number;
  ruleStatus: SportsF1ConstructorsChampionRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsF1ConstructorsChampion2026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly SportsF1ConstructorsChampionVenue[];
  admittedConstructors: readonly string[];
  pairLanes: readonly SportsF1ConstructorsChampion2026PairLane[];
  allVenueLanes: readonly SportsF1ConstructorsChampion2026AllVenueLane[];
  rejections: readonly SportsF1ConstructorsChampion2026MatcherRejection[];
  finalDecision: SportsF1ConstructorsChampion2026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toConstructorIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const mapRuleToPairRouteability = (
  ruleStatus: SportsF1ConstructorsChampionRuleCompatibilityClass
): SportsF1ConstructorsChampion2026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE" : "PAIR_REVIEW_REQUIRED";

const mapRuleToAllVenueRouteability = (
  ruleStatus: SportsF1ConstructorsChampionRuleCompatibilityClass
): SportsF1ConstructorsChampion2026AllVenueLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "ALL_VENUE_EXACT_AUTO_ROUTEABLE" : "ALL_VENUE_REVIEW_REQUIRED";

const buildPairNotes = (
  ruleStatus: SportsF1ConstructorsChampionRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe shared F1 constructors champion leg on ${venuePair}.`]
    : [
      `Constructor leg is shared across ${venuePair}, but venue wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildAllVenueNotes = (
  ruleStatus: SportsF1ConstructorsChampionRuleCompatibilityClass
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 4-venue F1 constructors champion leg on LIMITLESS|OPINION|POLYMARKET|PREDICT."]
    : [
      "Constructor leg survives the strict 4-venue intersection, but wording is semantically compatible rather than exact.",
      "Operator review is required before treating this strict-all lane as exact-safe."
    ];

export const buildSportsF1ConstructorsChampion2026MatcherMaterialization = (input: {
  normalizedTopics: readonly SportsF1ConstructorsChampionNormalizedTopicRow[];
  comparabilitySummary: readonly SportsF1ConstructorsChampionComparabilityTopicSummary[];
}): SportsF1ConstructorsChampion2026MatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter(
    (row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null
  );
  const topicSummary =
    input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const admittedVenues = [...unique(topicRows.map((row) => row.venue))].sort() as SportsF1ConstructorsChampionVenue[];
  const admittedConstructors = [...unique(
    topicRows.map((row) => row.canonicalConstructorId).filter((value): value is string => value !== null)
  )].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const allVenueRouteability = mapRuleToAllVenueRouteability(ruleStatus);

  const constructorVenueRows = new Map<
    string,
    Map<SportsF1ConstructorsChampionVenue, SportsF1ConstructorsChampionNormalizedTopicRow>
  >();
  for (const row of topicRows) {
    const constructorId = row.canonicalConstructorId;
    if (!constructorId) {
      continue;
    }
    const venueMap =
      constructorVenueRows.get(constructorId) ?? new Map<SportsF1ConstructorsChampionVenue, SportsF1ConstructorsChampionNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    constructorVenueRows.set(constructorId, venueMap);
  }

  const rejections: SportsF1ConstructorsChampion2026MatcherRejection[] = [];
  for (const outcome of topicSummary?.excludedOutcomes ?? []) {
    rejections.push({
      scope: "constructor",
      constructorIdentityKey: outcome.reason === "OTHERS_EXCLUDED" ? null : toConstructorIdentityKey(outcome.label),
      normalizedConstructorName: outcome.label,
      reason: outcome.reason === "OTHERS_EXCLUDED" ? "OTHERS_EXCLUDED" : "NOT_SHARED",
      notes:
        outcome.reason === "OTHERS_EXCLUDED"
          ? `Constructor leg ${outcome.label} is excluded by shared-core policy.`
          : `Constructor leg ${outcome.label} is not part of the exact shared F1 constructors champion core.`
    });
  }

  const pairLanes: SportsF1ConstructorsChampion2026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [
      SportsF1ConstructorsChampionVenue,
      SportsF1ConstructorsChampionVenue
    ];
    const sharedConstructors = [...constructorVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([constructorId]) => constructorId)
      .sort();

    if (sharedConstructors.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} does not currently have a shared F1 constructors champion core.`
      });
      continue;
    }

    for (const constructorId of sharedConstructors) {
      const leftRow = constructorVenueRows.get(constructorId)!.get(leftVenue)!;
      const rightRow = constructorVenueRows.get(constructorId)!.get(rightVenue)!;
      pairLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        venuePair,
        constructorIdentityKey: toConstructorIdentityKey(constructorId),
        normalizedConstructorName: constructorId,
        routeabilityDecision: pairRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: [
          { venue: leftVenue, venueMarketId: leftRow.venueMarketId, rawConstructorLabel: leftRow.title },
          { venue: rightVenue, venueMarketId: rightRow.venueMarketId, rawConstructorLabel: rightRow.title }
        ],
        notes: buildPairNotes(ruleStatus, venuePair)
      });
    }
  }

  const allVenueLanes: SportsF1ConstructorsChampion2026AllVenueLane[] = [];
  const allVenueConstructors = [...constructorVenueRows.entries()]
    .filter(([, venueMap]) => VENUE_PRIORITY.every((venue) => venueMap.has(venue)))
    .map(([constructorId]) => constructorId)
    .sort();
  if (admittedVenues.length === VENUE_PRIORITY.length && allVenueConstructors.length > 0) {
    for (const constructorId of allVenueConstructors) {
      allVenueLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        canonicalVenueSet: ALL_VENUE_SET,
        constructorIdentityKey: toConstructorIdentityKey(constructorId),
        normalizedConstructorName: constructorId,
        routeabilityDecision: allVenueRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: VENUE_PRIORITY.map((venue) => {
          const row = constructorVenueRows.get(constructorId)!.get(venue)!;
          return { venue, venueMarketId: row.venueMarketId, rawConstructorLabel: row.title };
        }),
        notes: buildAllVenueNotes(ruleStatus)
      });
    }
  } else {
    rejections.push({
      scope: "all_venue_lane",
      venueSet: ALL_VENUE_SET,
      reason: "ALL_VENUE_EDGE_MISSING",
      notes: `Strict all-venue F1 constructors champion lane is not justified from admitted venues ${admittedVenues.join("|") || "none"}.`
    });
  }

  for (const [constructorId, venueMap] of constructorVenueRows.entries()) {
    if (venueMap.size < VENUE_PRIORITY.length) {
      rejections.push({
        scope: "constructor",
        constructorIdentityKey: toConstructorIdentityKey(constructorId),
        normalizedConstructorName: constructorId,
        venueSet: ALL_VENUE_SET,
        reason: "ALL_VENUE_EDGE_MISSING",
        notes: `Constructor leg ${constructorId} is not shared across all of ${ALL_VENUE_SET}.`
      });
    }
  }

  const pairCounts = new Map<PairVenueSet, number>();
  for (const lane of pairLanes) {
    pairCounts.set(lane.venuePair, (pairCounts.get(lane.venuePair) ?? 0) + 1);
  }
  const bestPair =
    [...pairCounts.entries()]
      .sort((left, right) =>
        (right[1] - left[1]) || (PAIR_PRIORITY.indexOf(left[0]) - PAIR_PRIORITY.indexOf(right[0]))
      )[0]?.[0] ?? null;
  const bestPairCandidateCount = bestPair ? (pairCounts.get(bestPair) ?? 0) : 0;
  const pairMatcherReady = pairLanes.length > 0;
  const allVenueMatcherReady = allVenueLanes.length > 0;

  const finalDecision: SportsF1ConstructorsChampion2026MatcherFinalDecision = {
    overallDecision:
      allVenueMatcherReady
        ? "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
        : pairMatcherReady
          ? "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_MATCHER_NOT_READY",
    bestPair,
    bestAllVenueIfAny: allVenueMatcherReady ? ALL_VENUE_SET : null,
    pairMatcherReady,
    allVenueMatcherReady,
    pairStillPreferred: true,
    exactSafePairCandidateCount: bestPairCandidateCount,
    exactSafeAllVenueCandidateCount: allVenueLanes.length,
    ruleStatus,
    operatorCredible: pairMatcherReady,
    matcherFollowUpJustified: pairMatcherReady,
    singleBestNextAction:
      allVenueMatcherReady
        ? `Run a narrow readiness pass for ${TOPIC_KEY} with ${bestPair ?? "best pair"} kept explicit and the strict all-venue lane review-gated.`
        : pairMatcherReady
          ? `Run a narrow readiness pass for ${TOPIC_KEY} on ${bestPair ?? "the best pair lane"} only.`
          : "Keep F1 constructors champion on the narrow supply/foundation track until a shared core survives matcher construction."
  };

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedConstructors,
    pairLanes,
    allVenueLanes,
    rejections,
    finalDecision
  };
};
