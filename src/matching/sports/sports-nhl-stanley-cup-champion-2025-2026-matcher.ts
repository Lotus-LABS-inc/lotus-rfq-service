import type {
  SportsNhlStanleyCupChampionComparabilityTopicSummary,
  SportsNhlStanleyCupChampionNormalizedTopicRow,
  SportsNhlStanleyCupChampionRuleCompatibilityClass,
  SportsNhlStanleyCupChampionVenue
} from "./sports-nhl-stanley-cup-champion-family-pass.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const VENUE_PRIORITY = ["LIMITLESS", "OPINION", "POLYMARKET"] as const;
const PRIMARY_PAIR_VENUE_SET = "LIMITLESS|POLYMARKET" as const;
const PAIR_PRIORITY = [
  "LIMITLESS|POLYMARKET",
  "LIMITLESS|OPINION",
  "OPINION|POLYMARKET"
] as const;
const EVIDENCE_SOURCES = [
  "artifacts/sports/nhl-stanley-cup-champion-family-pass/sports-nhl-stanley-cup-champion-fetch-summary.json",
  "artifacts/sports/nhl-stanley-cup-champion-family-pass/sports-nhl-stanley-cup-champion-admission-summary.json",
  "artifacts/sports/nhl-stanley-cup-champion-family-pass/sports-nhl-stanley-cup-champion-normalized-topics.json",
  "artifacts/sports/nhl-stanley-cup-champion-family-pass/sports-nhl-stanley-cup-champion-comparability-summary.json",
  "artifacts/sports/nhl-stanley-cup-champion-family-pass/sports-nhl-stanley-cup-champion-basis-fragmentation-summary.json",
  "artifacts/sports/nhl-stanley-cup-champion-family-pass/sports-nhl-stanley-cup-champion-final-decision.json"
] as const;

type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface SportsNhlStanleyCupChampion20252026PairLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  teamIdentityKey: string;
  normalizedTeamName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: SportsNhlStanleyCupChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsNhlStanleyCupChampionVenue;
    venueMarketId: string;
    rawTeamLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsNhlStanleyCupChampion20252026MatcherRejection {
  scope: "team" | "pair_lane" | "tri_lane";
  teamIdentityKey?: string | null;
  normalizedTeamName?: string | null;
  venuePair?: string;
  venueSet?: string;
  reason: "NOT_SHARED" | "PAIR_EDGE_MISSING" | "TRI_EDGE_MISSING" | "RULE_MISMATCH";
  notes: string;
}

export interface SportsNhlStanleyCupChampion20252026MatcherFinalDecision {
  overallDecision:
    | "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST"
    | "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_MATCHER_NOT_READY";
  bestPair: PairVenueSet | null;
  bestTriIfAny: typeof TRI_VENUE_SET | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: true;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: SportsNhlStanleyCupChampionRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsNhlStanleyCupChampion20252026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly SportsNhlStanleyCupChampionVenue[];
  admittedTeams: readonly string[];
  pairLanes: readonly SportsNhlStanleyCupChampion20252026PairLane[];
  rejections: readonly SportsNhlStanleyCupChampion20252026MatcherRejection[];
  finalDecision: SportsNhlStanleyCupChampion20252026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toTeamIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const mapRuleToPairRouteability = (
  ruleStatus: SportsNhlStanleyCupChampionRuleCompatibilityClass
): SportsNhlStanleyCupChampion20252026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE" : "PAIR_REVIEW_REQUIRED";

const buildPairNotes = (
  ruleStatus: SportsNhlStanleyCupChampionRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe shared NHL Stanley Cup champion team leg on ${venuePair}.`]
    : [
      `Team leg is shared across ${venuePair}, but venue wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

export const buildSportsNhlStanleyCupChampion20252026MatcherMaterialization = (input: {
  normalizedTopics: readonly SportsNhlStanleyCupChampionNormalizedTopicRow[];
  comparabilitySummary: readonly SportsNhlStanleyCupChampionComparabilityTopicSummary[];
}): SportsNhlStanleyCupChampion20252026MatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter(
    (row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null
  );
  const topicSummary =
    input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const admittedVenues = [...unique(topicRows.map((row) => row.venue))].sort() as SportsNhlStanleyCupChampionVenue[];
  const admittedTeams = [...unique(
    topicRows.map((row) => row.canonicalTeamId).filter((value): value is string => value !== null)
  )].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);

  const teamVenueRows = new Map<
    string,
    Map<SportsNhlStanleyCupChampionVenue, SportsNhlStanleyCupChampionNormalizedTopicRow>
  >();
  for (const row of topicRows) {
    if (!row.canonicalTeamId) {
      continue;
    }
    const venueMap =
      teamVenueRows.get(row.canonicalTeamId) ?? new Map<SportsNhlStanleyCupChampionVenue, SportsNhlStanleyCupChampionNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    teamVenueRows.set(row.canonicalTeamId, venueMap);
  }

  const rejections: SportsNhlStanleyCupChampion20252026MatcherRejection[] = [];
  for (const outcome of topicSummary?.excludedOutcomes ?? []) {
    rejections.push({
      scope: "team",
      teamIdentityKey: toTeamIdentityKey(outcome.label),
      normalizedTeamName: outcome.label,
      reason: "NOT_SHARED",
      notes: `Team leg ${outcome.label} is not part of the exact shared NHL Stanley Cup champion core.`
    });
  }

  const pairLanes: SportsNhlStanleyCupChampion20252026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [SportsNhlStanleyCupChampionVenue, SportsNhlStanleyCupChampionVenue];
    const sharedTeams = [...teamVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([teamId]) => teamId)
      .sort();

    if (sharedTeams.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} does not currently have a shared NHL Stanley Cup champion team core.`
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

  const triTeams = [...teamVenueRows.entries()]
    .filter(([, venueMap]) => VENUE_PRIORITY.every((venue) => venueMap.has(venue)))
    .map(([teamId]) => teamId)
    .sort();
  if (admittedVenues.length < VENUE_PRIORITY.length || triTeams.length === 0) {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "TRI_EDGE_MISSING",
      notes: `Strict tri lane is not justified from admitted venues ${admittedVenues.join("|") || "none"}.`
    });
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
  const triMatcherReady = admittedVenues.length === VENUE_PRIORITY.length && triTeams.length > 0;

  const finalDecision: SportsNhlStanleyCupChampion20252026MatcherFinalDecision = {
    overallDecision:
      triMatcherReady
        ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST"
        : pairMatcherReady
          ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_MATCHER_NOT_READY",
    bestPair,
    bestTriIfAny: triMatcherReady ? TRI_VENUE_SET : null,
    pairMatcherReady,
    triMatcherReady,
    pairStillPreferred: true,
    exactSafePairCandidateCount: bestPairCandidateCount,
    exactSafeTriCandidateCount: triTeams.length,
    ruleStatus,
    operatorCredible: pairMatcherReady,
    matcherFollowUpJustified: pairMatcherReady,
    singleBestNextAction:
      triMatcherReady
        ? `Run a narrow readiness pass for ${TOPIC_KEY} with ${bestPair ?? "best pair"} explicit and the strict tri lane kept review-gated.`
        : pairMatcherReady
          ? `Run a narrow readiness pass for ${TOPIC_KEY} with ${bestPair ?? "the best pair lane"} explicit.`
          : "Keep NHL Stanley Cup champion on the narrow supply/foundation track until a shared core survives matcher construction."
  };

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedTeams,
    pairLanes,
    rejections,
    finalDecision
  };
};
