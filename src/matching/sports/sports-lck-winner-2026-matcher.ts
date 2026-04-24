import type {
  SportsLckWinnerComparabilityTopicSummary,
  SportsLckWinnerNormalizedTopicRow,
  SportsLckWinnerRuleCompatibilityClass,
  SportsLckWinnerVenue
} from "./sports-lck-winner-family-pass.js";

const TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LCK|2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const VENUE_PRIORITY = ["LIMITLESS", "OPINION", "POLYMARKET"] as const;
const PAIR_PRIORITY = [
  "LIMITLESS|POLYMARKET",
  "LIMITLESS|OPINION",
  "OPINION|POLYMARKET"
] as const;
const EVIDENCE_SOURCES = [
  "artifacts/sports/lck-winner-family-pass/sports-lck-winner-fetch-summary.json",
  "artifacts/sports/lck-winner-family-pass/sports-lck-winner-admission-summary.json",
  "artifacts/sports/lck-winner-family-pass/sports-lck-winner-normalized-topics.json",
  "artifacts/sports/lck-winner-family-pass/sports-lck-winner-comparability-summary.json",
  "artifacts/sports/lck-winner-family-pass/sports-lck-winner-basis-fragmentation-summary.json",
  "artifacts/sports/lck-winner-family-pass/sports-lck-winner-final-decision.json"
] as const;

type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface SportsLckWinner2026PairLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  teamIdentityKey: string;
  normalizedTeamName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: SportsLckWinnerRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsLckWinnerVenue;
    venueMarketId: string;
    rawTeamLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsLckWinner2026MatcherRejection {
  scope: "team" | "pair_lane" | "tri_lane";
  teamIdentityKey?: string | null;
  normalizedTeamName?: string | null;
  venuePair?: string;
  venueSet?: string;
  reason: "NOT_SHARED" | "PAIR_EDGE_MISSING" | "TRI_EDGE_MISSING" | "RULE_MISMATCH";
  notes: string;
}

export interface SportsLckWinner2026MatcherFinalDecision {
  overallDecision:
    | "SPORTS_LCK_WINNER_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST"
    | "SPORTS_LCK_WINNER_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "SPORTS_LCK_WINNER_2026_MATCHER_NOT_READY";
  bestPair: PairVenueSet | null;
  bestTriIfAny: typeof TRI_VENUE_SET | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: SportsLckWinnerRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsLckWinner2026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly SportsLckWinnerVenue[];
  admittedTeams: readonly string[];
  pairLanes: readonly SportsLckWinner2026PairLane[];
  rejections: readonly SportsLckWinner2026MatcherRejection[];
  finalDecision: SportsLckWinner2026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toTeamIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const mapRuleToPairRouteability = (
  ruleStatus: SportsLckWinnerRuleCompatibilityClass
): SportsLckWinner2026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE" : "PAIR_REVIEW_REQUIRED";

const buildPairNotes = (
  ruleStatus: SportsLckWinnerRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe shared LCK winner team leg on ${venuePair}.`]
    : [
      `Team leg is shared across ${venuePair}, but venue wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

export const buildSportsLckWinner2026MatcherMaterialization = (input: {
  normalizedTopics: readonly SportsLckWinnerNormalizedTopicRow[];
  comparabilitySummary: readonly SportsLckWinnerComparabilityTopicSummary[];
}): SportsLckWinner2026MatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter(
    (row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null
  );
  const topicSummary =
    input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const admittedVenues = [...unique(topicRows.map((row) => row.venue))].sort() as SportsLckWinnerVenue[];
  const admittedTeams = [...unique(
    topicRows.map((row) => row.canonicalTeamId).filter((value): value is string => value !== null)
  )].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);

  const teamVenueRows = new Map<
    string,
    Map<SportsLckWinnerVenue, SportsLckWinnerNormalizedTopicRow>
  >();
  for (const row of topicRows) {
    if (!row.canonicalTeamId) {
      continue;
    }
    const venueMap =
      teamVenueRows.get(row.canonicalTeamId) ?? new Map<SportsLckWinnerVenue, SportsLckWinnerNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    teamVenueRows.set(row.canonicalTeamId, venueMap);
  }

  const rejections: SportsLckWinner2026MatcherRejection[] = [];
  for (const outcome of topicSummary?.excludedOutcomes ?? []) {
    rejections.push({
      scope: "team",
      teamIdentityKey: toTeamIdentityKey(outcome.label),
      normalizedTeamName: outcome.label,
      reason: "NOT_SHARED",
      notes: `Team leg ${outcome.label} is not part of the exact shared LCK winner core.`
    });
  }

  const pairLanes: SportsLckWinner2026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [SportsLckWinnerVenue, SportsLckWinnerVenue];
    const sharedTeams = [...teamVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([teamId]) => teamId)
      .sort();

    if (sharedTeams.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} does not currently have a shared LCK winner team core.`
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

  const finalDecision: SportsLckWinner2026MatcherFinalDecision = {
    overallDecision:
      triMatcherReady
        ? "SPORTS_LCK_WINNER_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST"
        : pairMatcherReady
          ? "SPORTS_LCK_WINNER_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "SPORTS_LCK_WINNER_2026_MATCHER_NOT_READY",
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
          ? `Run a narrow readiness pass for ${TOPIC_KEY} on ${bestPair ?? "the best pair lane"} only.`
          : "Keep LCK winner on the narrow supply/foundation track until a shared core survives matcher construction."
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
