import type {
  SportsEplWinnerComparabilityTopicSummary,
  SportsEplWinnerNormalizedTopicRow,
  SportsEplWinnerRuleCompatibilityClass,
  SportsEplWinnerVenue
} from "./sports-epl-winner-family-pass.js";

const TOPIC_KEY = "SPORTS|LEAGUE_WINNER|EPL|2025_2026" as const;
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
  "artifacts/sports/epl-winner-family-pass/sports-epl-winner-fetch-summary.json",
  "artifacts/sports/epl-winner-family-pass/sports-epl-winner-admission-summary.json",
  "artifacts/sports/epl-winner-family-pass/sports-epl-winner-normalized-topics.json",
  "artifacts/sports/epl-winner-family-pass/sports-epl-winner-comparability-summary.json",
  "artifacts/sports/epl-winner-family-pass/sports-epl-winner-basis-fragmentation-summary.json",
  "artifacts/sports/epl-winner-family-pass/sports-epl-winner-final-decision.json"
] as const;

type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface SportsEplWinner20252026PairLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  clubIdentityKey: string;
  normalizedClubName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: SportsEplWinnerRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsEplWinnerVenue;
    venueMarketId: string;
    rawClubLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsEplWinner20252026AllVenueLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  canonicalVenueSet: typeof ALL_VENUE_SET;
  clubIdentityKey: string;
  normalizedClubName: string;
  routeabilityDecision: "ALL_VENUE_EXACT_AUTO_ROUTEABLE" | "ALL_VENUE_REVIEW_REQUIRED" | "ALL_VENUE_REJECTED";
  rulesDecision: SportsEplWinnerRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsEplWinnerVenue;
    venueMarketId: string;
    rawClubLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsEplWinner20252026MatcherRejection {
  scope: "club" | "pair_lane" | "all_venue_lane";
  clubIdentityKey?: string | null;
  normalizedClubName?: string | null;
  venuePair?: string;
  venueSet?: string;
  reason: "NOT_SHARED" | "OTHERS_EXCLUDED" | "PAIR_EDGE_MISSING" | "ALL_VENUE_EDGE_MISSING" | "RULE_MISMATCH";
  notes: string;
}

export interface SportsEplWinner20252026MatcherFinalDecision {
  overallDecision:
    | "SPORTS_EPL_WINNER_2025_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
    | "SPORTS_EPL_WINNER_2025_2026_MATCHER_NOT_READY";
  bestPair: PairVenueSet | null;
  bestAllVenueIfAny: typeof ALL_VENUE_SET | null;
  pairMatcherReady: boolean;
  allVenueMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeAllVenueCandidateCount: number;
  ruleStatus: SportsEplWinnerRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsEplWinner20252026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly SportsEplWinnerVenue[];
  admittedClubs: readonly string[];
  pairLanes: readonly SportsEplWinner20252026PairLane[];
  allVenueLanes: readonly SportsEplWinner20252026AllVenueLane[];
  rejections: readonly SportsEplWinner20252026MatcherRejection[];
  finalDecision: SportsEplWinner20252026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toClubIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const mapRuleToPairRouteability = (
  ruleStatus: SportsEplWinnerRuleCompatibilityClass
): SportsEplWinner20252026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE" : "PAIR_REVIEW_REQUIRED";

const mapRuleToAllVenueRouteability = (
  ruleStatus: SportsEplWinnerRuleCompatibilityClass
): SportsEplWinner20252026AllVenueLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "ALL_VENUE_EXACT_AUTO_ROUTEABLE" : "ALL_VENUE_REVIEW_REQUIRED";

const buildPairNotes = (
  ruleStatus: SportsEplWinnerRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe shared EPL winner club leg on ${venuePair}.`]
    : [
      `Club leg is shared across ${venuePair}, but venue wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildAllVenueNotes = (ruleStatus: SportsEplWinnerRuleCompatibilityClass): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 4-venue EPL winner club leg on LIMITLESS|OPINION|POLYMARKET|PREDICT."]
    : [
      "Club leg survives the strict 4-venue intersection, but wording is semantically compatible rather than exact.",
      "Operator review is required before treating this all-venue lane as exact-safe."
    ];

export const buildSportsEplWinner20252026MatcherMaterialization = (input: {
  normalizedTopics: readonly SportsEplWinnerNormalizedTopicRow[];
  comparabilitySummary: readonly SportsEplWinnerComparabilityTopicSummary[];
}): SportsEplWinner20252026MatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter((row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null);
  const topicSummary = input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const admittedVenues = [...unique(topicRows.map((row) => row.venue))].sort() as SportsEplWinnerVenue[];
  const admittedClubs = [...unique(
    topicRows.map((row) => row.canonicalClubId).filter((value): value is string => value !== null)
  )].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const allVenueRouteability = mapRuleToAllVenueRouteability(ruleStatus);

  const clubVenueRows = new Map<string, Map<SportsEplWinnerVenue, SportsEplWinnerNormalizedTopicRow>>();
  for (const row of topicRows) {
    const clubId = row.canonicalClubId;
    if (!clubId) {
      continue;
    }
    const venueMap = clubVenueRows.get(clubId) ?? new Map<SportsEplWinnerVenue, SportsEplWinnerNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    clubVenueRows.set(clubId, venueMap);
  }

  const rejections: SportsEplWinner20252026MatcherRejection[] = [];
  for (const outcome of topicSummary?.excludedOutcomes ?? []) {
    rejections.push({
      scope: "club",
      clubIdentityKey: outcome.reason === "OTHERS_EXCLUDED" ? null : toClubIdentityKey(outcome.label),
      normalizedClubName: outcome.label,
      reason: outcome.reason === "OTHERS_EXCLUDED" ? "OTHERS_EXCLUDED" : "NOT_SHARED",
      notes:
        outcome.reason === "OTHERS_EXCLUDED"
          ? `Club leg ${outcome.label} is excluded by shared-core policy.`
          : `Club leg ${outcome.label} is not part of the exact shared EPL winner core.`
    });
  }

  const pairLanes: SportsEplWinner20252026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [SportsEplWinnerVenue, SportsEplWinnerVenue];
    const sharedClubs = [...clubVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([clubId]) => clubId)
      .sort();

    if (sharedClubs.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} does not currently have a shared EPL winner club core.`
      });
      continue;
    }

    for (const clubId of sharedClubs) {
      const leftRow = clubVenueRows.get(clubId)!.get(leftVenue)!;
      const rightRow = clubVenueRows.get(clubId)!.get(rightVenue)!;
      pairLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        venuePair,
        clubIdentityKey: toClubIdentityKey(clubId),
        normalizedClubName: clubId,
        routeabilityDecision: pairRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: [
          { venue: leftVenue, venueMarketId: leftRow.venueMarketId, rawClubLabel: leftRow.title },
          { venue: rightVenue, venueMarketId: rightRow.venueMarketId, rawClubLabel: rightRow.title }
        ],
        notes: buildPairNotes(ruleStatus, venuePair)
      });
    }
  }

  const allVenueLanes: SportsEplWinner20252026AllVenueLane[] = [];
  const allVenueClubs = [...clubVenueRows.entries()]
    .filter(([, venueMap]) => VENUE_PRIORITY.every((venue) => venueMap.has(venue)))
    .map(([clubId]) => clubId)
    .sort();
  if (admittedVenues.length === VENUE_PRIORITY.length && allVenueClubs.length > 0) {
    for (const clubId of allVenueClubs) {
      allVenueLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        canonicalVenueSet: ALL_VENUE_SET,
        clubIdentityKey: toClubIdentityKey(clubId),
        normalizedClubName: clubId,
        routeabilityDecision: allVenueRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: VENUE_PRIORITY.map((venue) => {
          const row = clubVenueRows.get(clubId)!.get(venue)!;
          return { venue, venueMarketId: row.venueMarketId, rawClubLabel: row.title };
        }),
        notes: buildAllVenueNotes(ruleStatus)
      });
    }
  } else {
    rejections.push({
      scope: "all_venue_lane",
      venueSet: ALL_VENUE_SET,
      reason: "ALL_VENUE_EDGE_MISSING",
      notes: `Strict all-venue EPL lane is not justified from admitted venues ${admittedVenues.join("|") || "none"}.`
    });
  }

  for (const [clubId, venueMap] of clubVenueRows.entries()) {
    if (venueMap.size < VENUE_PRIORITY.length) {
      rejections.push({
        scope: "club",
        clubIdentityKey: toClubIdentityKey(clubId),
        normalizedClubName: clubId,
        venueSet: ALL_VENUE_SET,
        reason: "ALL_VENUE_EDGE_MISSING",
        notes: `Club leg ${clubId} is not shared across all of ${ALL_VENUE_SET}.`
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

  const finalDecision: SportsEplWinner20252026MatcherFinalDecision = {
    overallDecision:
      allVenueMatcherReady
        ? "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
        : pairMatcherReady
          ? "SPORTS_EPL_WINNER_2025_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "SPORTS_EPL_WINNER_2025_2026_MATCHER_NOT_READY",
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
          : "Keep EPL winner on the narrow supply/foundation track until a shared core survives matcher construction."
  };

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedClubs,
    pairLanes,
    allVenueLanes,
    rejections,
    finalDecision
  };
};
