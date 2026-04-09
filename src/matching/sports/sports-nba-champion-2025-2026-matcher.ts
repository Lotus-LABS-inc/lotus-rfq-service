import type {
  SportsNbaChampionComparabilityTopicSummary,
  SportsNbaChampionNormalizedTopicRow,
  SportsNbaChampionRuleCompatibilityClass,
  SportsNbaChampionVenue
} from "./sports-nba-champion-family-pass.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026" as const;
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
  "artifacts/sports/nba-champion-family-pass/sports-nba-champion-fetch-summary.json",
  "artifacts/sports/nba-champion-family-pass/sports-nba-champion-admission-summary.json",
  "artifacts/sports/nba-champion-family-pass/sports-nba-champion-normalized-topics.json",
  "artifacts/sports/nba-champion-family-pass/sports-nba-champion-comparability-summary.json",
  "artifacts/sports/nba-champion-family-pass/sports-nba-champion-basis-fragmentation-summary.json",
  "artifacts/sports/nba-champion-family-pass/sports-nba-champion-final-decision.json"
] as const;

type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface SportsNbaChampion20252026PairLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  teamIdentityKey: string;
  normalizedTeamName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: SportsNbaChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsNbaChampionVenue;
    venueMarketId: string;
    rawTeamLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsNbaChampion20252026StrictAllLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  canonicalVenueSet: typeof ALL_VENUE_SET;
  teamIdentityKey: string;
  normalizedTeamName: string;
  routeabilityDecision: "ALL_VENUE_EXACT_AUTO_ROUTEABLE" | "ALL_VENUE_REVIEW_REQUIRED" | "ALL_VENUE_REJECTED";
  rulesDecision: SportsNbaChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsNbaChampionVenue;
    venueMarketId: string;
    rawTeamLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsNbaChampion20252026MatcherRejection {
  scope: "team" | "pair_lane" | "all_venue_lane";
  teamIdentityKey?: string | null;
  normalizedTeamName?: string | null;
  venuePair?: string;
  venueSet?: string;
  reason: "NOT_SHARED" | "OTHERS_EXCLUDED" | "PAIR_EDGE_MISSING" | "ALL_VENUE_EDGE_MISSING" | "RULE_MISMATCH";
  notes: string;
}

export interface SportsNbaChampion20252026MatcherFinalDecision {
  overallDecision:
    | "SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
    | "SPORTS_NBA_CHAMPION_2025_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "SPORTS_NBA_CHAMPION_2025_2026_MATCHER_NOT_READY";
  bestPair: PairVenueSet | null;
  bestAllVenueIfAny: typeof ALL_VENUE_SET | null;
  pairMatcherReady: boolean;
  allVenueMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeAllVenueCandidateCount: number;
  ruleStatus: SportsNbaChampionRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsNbaChampion20252026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly SportsNbaChampionVenue[];
  admittedTeams: readonly string[];
  pairLanes: readonly SportsNbaChampion20252026PairLane[];
  strictAllLanes: readonly SportsNbaChampion20252026StrictAllLane[];
  rejections: readonly SportsNbaChampion20252026MatcherRejection[];
  finalDecision: SportsNbaChampion20252026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toTeamIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const mapRuleToPairRouteability = (
  ruleStatus: SportsNbaChampionRuleCompatibilityClass
): SportsNbaChampion20252026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE" : "PAIR_REVIEW_REQUIRED";

const mapRuleToStrictAllRouteability = (
  ruleStatus: SportsNbaChampionRuleCompatibilityClass
): SportsNbaChampion20252026StrictAllLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "ALL_VENUE_EXACT_AUTO_ROUTEABLE" : "ALL_VENUE_REVIEW_REQUIRED";

const buildPairNotes = (
  ruleStatus: SportsNbaChampionRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe shared NBA champion team leg on ${venuePair}.`]
    : [
      `Team leg is shared across ${venuePair}, but venue wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildStrictAllNotes = (
  ruleStatus: SportsNbaChampionRuleCompatibilityClass
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 4-venue NBA champion team leg on LIMITLESS|OPINION|POLYMARKET|PREDICT."]
    : [
      "Team leg survives the strict 4-venue intersection, but wording is semantically compatible rather than exact.",
      "Operator review is required before treating this strict-all lane as exact-safe."
    ];

export const buildSportsNbaChampion20252026MatcherMaterialization = (input: {
  normalizedTopics: readonly SportsNbaChampionNormalizedTopicRow[];
  comparabilitySummary: readonly SportsNbaChampionComparabilityTopicSummary[];
}): SportsNbaChampion20252026MatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter(
    (row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null
  );
  const topicSummary =
    input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const admittedVenues = [...unique(topicRows.map((row) => row.venue))].sort() as SportsNbaChampionVenue[];
  const admittedTeams = [...unique(
    topicRows.map((row) => row.canonicalTeamId).filter((value): value is string => value !== null)
  )].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const strictAllRouteability = mapRuleToStrictAllRouteability(ruleStatus);

  const teamVenueRows = new Map<
    string,
    Map<SportsNbaChampionVenue, SportsNbaChampionNormalizedTopicRow>
  >();
  for (const row of topicRows) {
    const teamId = row.canonicalTeamId;
    if (!teamId) {
      continue;
    }
    const venueMap =
      teamVenueRows.get(teamId) ?? new Map<SportsNbaChampionVenue, SportsNbaChampionNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    teamVenueRows.set(teamId, venueMap);
  }

  const rejections: SportsNbaChampion20252026MatcherRejection[] = [];
  for (const outcome of topicSummary?.excludedOutcomes ?? []) {
    rejections.push({
      scope: "team",
      teamIdentityKey: outcome.reason === "OTHERS_EXCLUDED" ? null : toTeamIdentityKey(outcome.label),
      normalizedTeamName: outcome.label,
      reason: outcome.reason === "OTHERS_EXCLUDED" ? "OTHERS_EXCLUDED" : "NOT_SHARED",
      notes:
        outcome.reason === "OTHERS_EXCLUDED"
          ? `Team leg ${outcome.label} is excluded by shared-core policy.`
          : `Team leg ${outcome.label} is not part of the exact shared NBA champion core.`
    });
  }

  const pairLanes: SportsNbaChampion20252026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [
      SportsNbaChampionVenue,
      SportsNbaChampionVenue
    ];
    const sharedTeams = [...teamVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([teamId]) => teamId)
      .sort();

    if (sharedTeams.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} does not currently have a shared NBA champion team core.`
      });
      continue;
    }

    for (const teamId of sharedTeams) {
      const leftRow = teamVenueRows.get(teamId)!.get(leftVenue)!;
      const rightRow = teamVenueRows.get(teamId)!.get(rightVenue)!;
      pairLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        venuePair,
        teamIdentityKey: toTeamIdentityKey(teamId),
        normalizedTeamName: teamId,
        routeabilityDecision: pairRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: [
          { venue: leftVenue, venueMarketId: leftRow.venueMarketId, rawTeamLabel: leftRow.title },
          { venue: rightVenue, venueMarketId: rightRow.venueMarketId, rawTeamLabel: rightRow.title }
        ],
        notes: buildPairNotes(ruleStatus, venuePair)
      });
    }
  }

  const strictAllLanes: SportsNbaChampion20252026StrictAllLane[] = [];
  const strictAllTeams = [...teamVenueRows.entries()]
    .filter(([, venueMap]) => VENUE_PRIORITY.every((venue) => venueMap.has(venue)))
    .map(([teamId]) => teamId)
    .sort();
  if (admittedVenues.length === VENUE_PRIORITY.length && strictAllTeams.length > 0) {
    for (const teamId of strictAllTeams) {
      strictAllLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        canonicalVenueSet: ALL_VENUE_SET,
        teamIdentityKey: toTeamIdentityKey(teamId),
        normalizedTeamName: teamId,
        routeabilityDecision: strictAllRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: VENUE_PRIORITY.map((venue) => {
          const row = teamVenueRows.get(teamId)!.get(venue)!;
          return { venue, venueMarketId: row.venueMarketId, rawTeamLabel: row.title };
        }),
        notes: buildStrictAllNotes(ruleStatus)
      });
    }
  } else {
    rejections.push({
      scope: "all_venue_lane",
      venueSet: ALL_VENUE_SET,
      reason: "ALL_VENUE_EDGE_MISSING",
      notes: `Strict all-venue NBA champion lane is not justified from admitted venues ${admittedVenues.join("|") || "none"}.`
    });
  }

  for (const [teamId, venueMap] of teamVenueRows.entries()) {
    if (venueMap.size < VENUE_PRIORITY.length) {
      rejections.push({
        scope: "team",
        teamIdentityKey: toTeamIdentityKey(teamId),
        normalizedTeamName: teamId,
        venueSet: ALL_VENUE_SET,
        reason: "ALL_VENUE_EDGE_MISSING",
        notes: `Team leg ${teamId} is not shared across all of ${ALL_VENUE_SET}.`
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
  const allVenueMatcherReady = strictAllLanes.length > 0;

  const finalDecision: SportsNbaChampion20252026MatcherFinalDecision = {
    overallDecision:
      allVenueMatcherReady
        ? "SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
        : pairMatcherReady
          ? "SPORTS_NBA_CHAMPION_2025_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "SPORTS_NBA_CHAMPION_2025_2026_MATCHER_NOT_READY",
    bestPair,
    bestAllVenueIfAny: allVenueMatcherReady ? ALL_VENUE_SET : null,
    pairMatcherReady,
    allVenueMatcherReady,
    pairStillPreferred: true,
    exactSafePairCandidateCount: bestPairCandidateCount,
    exactSafeAllVenueCandidateCount: strictAllLanes.length,
    ruleStatus,
    operatorCredible: pairMatcherReady,
    matcherFollowUpJustified: pairMatcherReady,
    singleBestNextAction:
      allVenueMatcherReady
        ? `Run a narrow readiness pass for ${TOPIC_KEY} with ${bestPair ?? "best pair"} kept explicit and the strict all-venue lane review-gated.`
        : pairMatcherReady
          ? `Run a narrow readiness pass for ${TOPIC_KEY} on ${bestPair ?? "the best pair lane"} only.`
          : "Keep NBA champion on the narrow supply/foundation track until a shared core survives matcher construction."
  };

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedTeams,
    pairLanes,
    strictAllLanes,
    rejections,
    finalDecision
  };
};
