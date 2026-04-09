import type {
  SportsF1DriversChampionComparabilityTopicSummary,
  SportsF1DriversChampionNormalizedTopicRow,
  SportsF1DriversChampionRuleCompatibilityClass,
  SportsF1DriversChampionVenue
} from "./sports-f1-drivers-champion-family-pass.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026" as const;
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
  "artifacts/sports/f1-drivers-champion-family-pass/sports-f1-drivers-champion-fetch-summary.json",
  "artifacts/sports/f1-drivers-champion-family-pass/sports-f1-drivers-champion-admission-summary.json",
  "artifacts/sports/f1-drivers-champion-family-pass/sports-f1-drivers-champion-normalized-topics.json",
  "artifacts/sports/f1-drivers-champion-family-pass/sports-f1-drivers-champion-comparability-summary.json",
  "artifacts/sports/f1-drivers-champion-family-pass/sports-f1-drivers-champion-basis-fragmentation-summary.json",
  "artifacts/sports/f1-drivers-champion-family-pass/sports-f1-drivers-champion-final-decision.json"
] as const;

type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface SportsF1DriversChampion2026PairLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  driverIdentityKey: string;
  normalizedDriverName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: SportsF1DriversChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsF1DriversChampionVenue;
    venueMarketId: string;
    rawDriverLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsF1DriversChampion2026StrictAllLane {
  canonicalTopicKey: typeof TOPIC_KEY;
  canonicalVenueSet: typeof ALL_VENUE_SET;
  driverIdentityKey: string;
  normalizedDriverName: string;
  routeabilityDecision: "ALL_VENUE_EXACT_AUTO_ROUTEABLE" | "ALL_VENUE_REVIEW_REQUIRED" | "ALL_VENUE_REJECTED";
  rulesDecision: SportsF1DriversChampionRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: SportsF1DriversChampionVenue;
    venueMarketId: string;
    rawDriverLabel: string;
  }[];
  notes: readonly string[];
}

export interface SportsF1DriversChampion2026MatcherRejection {
  scope: "driver" | "pair_lane" | "all_venue_lane";
  driverIdentityKey?: string | null;
  normalizedDriverName?: string | null;
  venuePair?: string;
  venueSet?: string;
  reason: "NOT_SHARED" | "OTHERS_EXCLUDED" | "PAIR_EDGE_MISSING" | "ALL_VENUE_EDGE_MISSING" | "RULE_MISMATCH";
  notes: string;
}

export interface SportsF1DriversChampion2026MatcherFinalDecision {
  overallDecision:
    | "SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
    | "SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "SPORTS_F1_DRIVERS_CHAMPION_2026_MATCHER_NOT_READY";
  bestPair: PairVenueSet | null;
  bestAllVenueIfAny: typeof ALL_VENUE_SET | null;
  pairMatcherReady: boolean;
  allVenueMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeAllVenueCandidateCount: number;
  ruleStatus: SportsF1DriversChampionRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsF1DriversChampion2026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly SportsF1DriversChampionVenue[];
  admittedDrivers: readonly string[];
  pairLanes: readonly SportsF1DriversChampion2026PairLane[];
  strictAllLanes: readonly SportsF1DriversChampion2026StrictAllLane[];
  rejections: readonly SportsF1DriversChampion2026MatcherRejection[];
  finalDecision: SportsF1DriversChampion2026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toDriverIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const mapRuleToPairRouteability = (
  ruleStatus: SportsF1DriversChampionRuleCompatibilityClass
): SportsF1DriversChampion2026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE" : "PAIR_REVIEW_REQUIRED";

const mapRuleToStrictAllRouteability = (
  ruleStatus: SportsF1DriversChampionRuleCompatibilityClass
): SportsF1DriversChampion2026StrictAllLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "ALL_VENUE_EXACT_AUTO_ROUTEABLE" : "ALL_VENUE_REVIEW_REQUIRED";

const buildPairNotes = (
  ruleStatus: SportsF1DriversChampionRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe shared F1 drivers champion leg on ${venuePair}.`]
    : [
      `Driver leg is shared across ${venuePair}, but venue wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildStrictAllNotes = (
  ruleStatus: SportsF1DriversChampionRuleCompatibilityClass
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 4-venue F1 drivers champion leg on LIMITLESS|OPINION|POLYMARKET|PREDICT."]
    : [
      "Driver leg survives the strict 4-venue intersection, but wording is semantically compatible rather than exact.",
      "Operator review is required before treating this strict-all lane as exact-safe."
    ];

export const buildSportsF1DriversChampion2026MatcherMaterialization = (input: {
  normalizedTopics: readonly SportsF1DriversChampionNormalizedTopicRow[];
  comparabilitySummary: readonly SportsF1DriversChampionComparabilityTopicSummary[];
}): SportsF1DriversChampion2026MatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter(
    (row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null
  );
  const topicSummary =
    input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const admittedVenues = [...unique(topicRows.map((row) => row.venue))].sort() as SportsF1DriversChampionVenue[];
  const admittedDrivers = [...unique(
    topicRows.map((row) => row.canonicalDriverId).filter((value): value is string => value !== null)
  )].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const strictAllRouteability = mapRuleToStrictAllRouteability(ruleStatus);

  const driverVenueRows = new Map<
    string,
    Map<SportsF1DriversChampionVenue, SportsF1DriversChampionNormalizedTopicRow>
  >();
  for (const row of topicRows) {
    const driverId = row.canonicalDriverId;
    if (!driverId) {
      continue;
    }
    const venueMap =
      driverVenueRows.get(driverId) ?? new Map<SportsF1DriversChampionVenue, SportsF1DriversChampionNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    driverVenueRows.set(driverId, venueMap);
  }

  const rejections: SportsF1DriversChampion2026MatcherRejection[] = [];
  for (const outcome of topicSummary?.excludedOutcomes ?? []) {
    rejections.push({
      scope: "driver",
      driverIdentityKey: outcome.reason === "OTHERS_EXCLUDED" ? null : toDriverIdentityKey(outcome.label),
      normalizedDriverName: outcome.label,
      reason: outcome.reason === "OTHERS_EXCLUDED" ? "OTHERS_EXCLUDED" : "NOT_SHARED",
      notes:
        outcome.reason === "OTHERS_EXCLUDED"
          ? `Driver leg ${outcome.label} is excluded by shared-core policy.`
          : `Driver leg ${outcome.label} is not part of the exact shared F1 drivers champion core.`
    });
  }

  const pairLanes: SportsF1DriversChampion2026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [
      SportsF1DriversChampionVenue,
      SportsF1DriversChampionVenue
    ];
    const sharedDrivers = [...driverVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([driverId]) => driverId)
      .sort();

    if (sharedDrivers.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} does not currently have a shared F1 drivers champion core.`
      });
      continue;
    }

    for (const driverId of sharedDrivers) {
      const leftRow = driverVenueRows.get(driverId)!.get(leftVenue)!;
      const rightRow = driverVenueRows.get(driverId)!.get(rightVenue)!;
      pairLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        venuePair,
        driverIdentityKey: toDriverIdentityKey(driverId),
        normalizedDriverName: driverId,
        routeabilityDecision: pairRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: [
          { venue: leftVenue, venueMarketId: leftRow.venueMarketId, rawDriverLabel: leftRow.title },
          { venue: rightVenue, venueMarketId: rightRow.venueMarketId, rawDriverLabel: rightRow.title }
        ],
        notes: buildPairNotes(ruleStatus, venuePair)
      });
    }
  }

  const strictAllLanes: SportsF1DriversChampion2026StrictAllLane[] = [];
  const strictAllDrivers = [...driverVenueRows.entries()]
    .filter(([, venueMap]) => VENUE_PRIORITY.every((venue) => venueMap.has(venue)))
    .map(([driverId]) => driverId)
    .sort();
  if (admittedVenues.length === VENUE_PRIORITY.length && strictAllDrivers.length > 0) {
    for (const driverId of strictAllDrivers) {
      strictAllLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        canonicalVenueSet: ALL_VENUE_SET,
        driverIdentityKey: toDriverIdentityKey(driverId),
        normalizedDriverName: driverId,
        routeabilityDecision: strictAllRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: VENUE_PRIORITY.map((venue) => {
          const row = driverVenueRows.get(driverId)!.get(venue)!;
          return { venue, venueMarketId: row.venueMarketId, rawDriverLabel: row.title };
        }),
        notes: buildStrictAllNotes(ruleStatus)
      });
    }
  } else {
    rejections.push({
      scope: "all_venue_lane",
      venueSet: ALL_VENUE_SET,
      reason: "ALL_VENUE_EDGE_MISSING",
      notes: `Strict all-venue F1 drivers champion lane is not justified from admitted venues ${admittedVenues.join("|") || "none"}.`
    });
  }

  for (const [driverId, venueMap] of driverVenueRows.entries()) {
    if (venueMap.size < VENUE_PRIORITY.length) {
      rejections.push({
        scope: "driver",
        driverIdentityKey: toDriverIdentityKey(driverId),
        normalizedDriverName: driverId,
        venueSet: ALL_VENUE_SET,
        reason: "ALL_VENUE_EDGE_MISSING",
        notes: `${driverId} is excluded from the strict all-venue lane because it is missing from ${VENUE_PRIORITY.filter((venue) => !venueMap.has(venue)).join("|")}.`
      });
    }
  }

  const bestPair = PAIR_PRIORITY.find((venuePair) =>
    pairLanes.some((lane) => lane.venuePair === venuePair)
  ) ?? null;
  const exactSafePairCandidateCount = bestPair === null
    ? 0
    : pairLanes.filter((lane) => lane.venuePair === bestPair).length;
  const exactSafeAllVenueCandidateCount = strictAllLanes.length;
  const pairMatcherReady = pairLanes.length > 0;
  const allVenueMatcherReady = strictAllLanes.length > 0;

  const finalDecision: SportsF1DriversChampion2026MatcherFinalDecision = {
    overallDecision:
      allVenueMatcherReady
        ? "SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST"
        : pairMatcherReady
          ? "SPORTS_F1_DRIVERS_CHAMPION_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "SPORTS_F1_DRIVERS_CHAMPION_2026_MATCHER_NOT_READY",
    bestPair,
    bestAllVenueIfAny: allVenueMatcherReady ? ALL_VENUE_SET : null,
    pairMatcherReady,
    allVenueMatcherReady,
    pairStillPreferred: pairMatcherReady,
    exactSafePairCandidateCount,
    exactSafeAllVenueCandidateCount,
    ruleStatus,
    operatorCredible: pairMatcherReady || allVenueMatcherReady,
    matcherFollowUpJustified: pairMatcherReady || allVenueMatcherReady,
    singleBestNextAction:
      pairMatcherReady || allVenueMatcherReady
        ? "run a narrow readiness pass for SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026 with the preferred pair explicit and the strict all-venue lane kept review-gated."
        : "continue targeted F1 drivers champion venue reconciliation until a shared driver core survives matcher materialization."
  };

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedDrivers,
    pairLanes,
    strictAllLanes,
    rejections,
    finalDecision
  };
};
