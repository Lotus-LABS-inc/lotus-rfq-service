import {
  buildSportsVenueCombinations,
  toSportsCanonicalVenueSet,
  type SportsLaneCardinality
} from "../../matching/sports/sports-lane-cardinality.js";

export type SportsCardinalityRuleStatus =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export interface SportsMatcherInputSummaryArtifactRow {
  venue: string;
  venueMarketId: string;
  title: string;
  canonicalClubId: string | null;
}

export interface SportsMatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: SportsMatcherInputSummaryArtifactRow[];
}

export interface SportsMatcherPairLaneArtifactRow {
  venuePair: string;
  club: string;
  canonicalTopic: string;
  routeabilityDecision: string;
  rulesDecision: SportsCardinalityRuleStatus;
  evidenceNotes?: string[];
}

export interface SportsMatcherPairLanesArtifact {
  canonicalTopicKey: string;
  matcherLanes: SportsMatcherPairLaneArtifactRow[];
}

export interface SportsMatcherStrictAllLaneArtifactRow {
  venueSet: string;
  club: string;
  canonicalTopic: string;
  routeabilityDecision: string;
  rulesDecision: SportsCardinalityRuleStatus;
  evidenceNotes?: string[];
}

export interface SportsMatcherStrictAllLanesArtifact {
  canonicalTopicKey: string;
  canonicalVenueSet: string;
  matcherLanes: SportsMatcherStrictAllLaneArtifactRow[];
}

export interface SportsMatcherFinalDecisionArtifact {
  bestPair: string | null;
  bestAllVenueIfAny: string | null;
  pairMatcherReady: boolean;
  allVenueMatcherReady: boolean;
  operatorCredible: boolean;
  ruleStatus: SportsCardinalityRuleStatus;
}

export interface SportsLaneCatalogTopicConfig {
  topicKey: string;
  laneIdPrefix: string;
  primaryPairVenueSet: string;
  legacyStrictAllLaneId: string;
  legacyPrimaryPairLaneId: string;
  matcherArtifactRefs: readonly string[];
}

export interface SportsLaneCatalogEntry {
  laneId: string;
  topicKey: string;
  laneCardinality: SportsLaneCardinality;
  venueSet: string;
  exactSafeClubs: readonly string[];
  ruleStatus: SportsCardinalityRuleStatus;
  operatorRuleReviewRequired: boolean;
  matcherReady: boolean;
  operatorCredible: boolean;
  currentReadinessDecision:
    | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    | "READY_BUT_MISSING_OPERATOR_REVIEW"
    | "NOT_READY_FOR_LIMITED_PROD";
  finalReadinessLabel:
    | "LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    | "LIMITED_PROD_READY_FOR_REVIEW"
    | "LIMITED_PROD_NOT_APPROVED";
  sourceArtifactRefs: readonly string[];
}

const sortClubs = (clubs: readonly string[]): readonly string[] =>
  [...clubs].sort((left, right) => left.localeCompare(right));

const isPolicySafeSingleClub = (canonicalClubId: string | null): canonicalClubId is string => {
  if (typeof canonicalClubId !== "string") {
    return false;
  }
  const normalized = canonicalClubId.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "other" && normalized !== "unknown";
};

const toLaneId = (config: SportsLaneCatalogTopicConfig, cardinality: SportsLaneCardinality, venueSet: string): string => {
  if (cardinality === "STRICT_ALL") {
    return config.legacyStrictAllLaneId;
  }
  if (cardinality === "PAIR" && venueSet === config.primaryPairVenueSet) {
    return config.legacyPrimaryPairLaneId;
  }
  return `${config.laneIdPrefix}_${cardinality}_${venueSet.replaceAll("|", "_")}`;
};

const toReadinessDecision = (matcherReady: boolean, operatorCredible: boolean) => {
  if (matcherReady && operatorCredible) {
    return "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION" as const;
  }
  if (matcherReady) {
    return "READY_BUT_MISSING_OPERATOR_REVIEW" as const;
  }
  return "NOT_READY_FOR_LIMITED_PROD" as const;
};

const toReadinessLabel = (matcherReady: boolean, operatorCredible: boolean, operatorRuleReviewRequired: boolean) => {
  if (!matcherReady || !operatorCredible) {
    return "LIMITED_PROD_NOT_APPROVED" as const;
  }
  if (operatorRuleReviewRequired) {
    return "LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW" as const;
  }
  return "LIMITED_PROD_READY_FOR_REVIEW" as const;
};

export interface SportsDerivedCardinalityLanes {
  singleLanes: readonly { venue: string; venueSet: string; clubs: readonly string[] }[];
  pairLanes: readonly { venueSet: string; clubs: readonly string[] }[];
  triLanes: readonly { venueSet: string; clubs: readonly string[] }[];
  strictAllLanes: readonly { venueSet: string; clubs: readonly string[] }[];
}

export const buildSportsDerivedCardinalityLanes = (input: {
  matcherInputSummary: SportsMatcherInputSummaryArtifact;
  matcherPairLanes: SportsMatcherPairLanesArtifact;
  matcherStrictAllLanes: SportsMatcherStrictAllLanesArtifact;
}): SportsDerivedCardinalityLanes => {
  const venueClubMap = new Map<string, Set<string>>();
  const rows = input.matcherInputSummary.refreshedRowsUsed.filter(
    (row): row is SportsMatcherInputSummaryArtifactRow & { canonicalClubId: string } =>
      isPolicySafeSingleClub(row.canonicalClubId)
  );

  for (const row of rows) {
    const clubSet = venueClubMap.get(row.venue) ?? new Set<string>();
    clubSet.add(row.canonicalClubId);
    venueClubMap.set(row.venue, clubSet);
  }

  const venues = [...venueClubMap.keys()].sort((left, right) => left.localeCompare(right));

  const singleLanes = venues.map((venue) => ({
    venue,
    venueSet: venue,
    clubs: sortClubs([...venueClubMap.get(venue)!])
  }));

  const pairMap = new Map<string, string[]>();
  for (const lane of input.matcherPairLanes.matcherLanes) {
    const clubs = pairMap.get(lane.venuePair) ?? [];
    clubs.push(lane.club);
    pairMap.set(lane.venuePair, clubs);
  }
  const pairLanes = [...pairMap.entries()]
    .map(([venueSet, clubs]) => ({ venueSet, clubs: sortClubs(clubs) }))
    .sort((left, right) => left.venueSet.localeCompare(right.venueSet));

  const triLanes = buildSportsVenueCombinations(venues, 3)
    .map((combo) => {
      const venueSet = toSportsCanonicalVenueSet(combo);
      const clubIntersection = combo.reduce<Set<string> | null>((accumulator, venue) => {
        const clubs = venueClubMap.get(venue)!;
        if (accumulator === null) {
          return new Set(clubs);
        }
        return new Set([...accumulator].filter((club) => clubs.has(club)));
      }, null);
      return {
        venueSet,
        clubs: sortClubs([...(clubIntersection ?? new Set<string>())])
      };
    })
    .filter((lane) => lane.clubs.length > 0)
    .sort((left, right) => left.venueSet.localeCompare(right.venueSet));

  const strictAllLanes = input.matcherStrictAllLanes.matcherLanes.length === 0
    ? []
    : [{
      venueSet: input.matcherStrictAllLanes.canonicalVenueSet,
      clubs: sortClubs(input.matcherStrictAllLanes.matcherLanes.map((lane) => lane.club))
    }];

  return {
    singleLanes,
    pairLanes,
    triLanes,
    strictAllLanes
  };
};

export const buildSportsLaneCatalog = (input: {
  config: SportsLaneCatalogTopicConfig;
  matcherInputSummary: SportsMatcherInputSummaryArtifact;
  matcherPairLanes: SportsMatcherPairLanesArtifact;
  matcherStrictAllLanes: SportsMatcherStrictAllLanesArtifact;
  matcherFinalDecision: SportsMatcherFinalDecisionArtifact;
}): readonly SportsLaneCatalogEntry[] => {
  const operatorRuleReviewRequired = input.matcherFinalDecision.ruleStatus !== "EXACT_RULE_COMPATIBLE";
  const operatorCredible = input.matcherFinalDecision.operatorCredible;
  const derived = buildSportsDerivedCardinalityLanes({
    matcherInputSummary: input.matcherInputSummary,
    matcherPairLanes: input.matcherPairLanes,
    matcherStrictAllLanes: input.matcherStrictAllLanes
  });

  const lanes: SportsLaneCatalogEntry[] = [];

  for (const singleLane of derived.singleLanes) {
    lanes.push({
      laneId: toLaneId(input.config, "SINGLE", singleLane.venueSet),
      topicKey: input.config.topicKey,
      laneCardinality: "SINGLE",
      venueSet: singleLane.venueSet,
      exactSafeClubs: singleLane.clubs,
      ruleStatus: input.matcherFinalDecision.ruleStatus,
      operatorRuleReviewRequired,
      matcherReady: singleLane.clubs.length > 0,
      operatorCredible,
      currentReadinessDecision: toReadinessDecision(singleLane.clubs.length > 0, operatorCredible),
      finalReadinessLabel: toReadinessLabel(singleLane.clubs.length > 0, operatorCredible, operatorRuleReviewRequired),
      sourceArtifactRefs: input.config.matcherArtifactRefs
    });
  }

  for (const pairLane of derived.pairLanes) {
    lanes.push({
      laneId: toLaneId(input.config, "PAIR", pairLane.venueSet),
      topicKey: input.config.topicKey,
      laneCardinality: "PAIR",
      venueSet: pairLane.venueSet,
      exactSafeClubs: pairLane.clubs,
      ruleStatus: input.matcherFinalDecision.ruleStatus,
      operatorRuleReviewRequired,
      matcherReady: pairLane.clubs.length > 0,
      operatorCredible,
      currentReadinessDecision: toReadinessDecision(pairLane.clubs.length > 0, operatorCredible),
      finalReadinessLabel: toReadinessLabel(pairLane.clubs.length > 0, operatorCredible, operatorRuleReviewRequired),
      sourceArtifactRefs: input.config.matcherArtifactRefs
    });
  }

  for (const triLane of derived.triLanes) {
    lanes.push({
      laneId: toLaneId(input.config, "TRI", triLane.venueSet),
      topicKey: input.config.topicKey,
      laneCardinality: "TRI",
      venueSet: triLane.venueSet,
      exactSafeClubs: triLane.clubs,
      ruleStatus: input.matcherFinalDecision.ruleStatus,
      operatorRuleReviewRequired,
      matcherReady: triLane.clubs.length > 0,
      operatorCredible,
      currentReadinessDecision: toReadinessDecision(triLane.clubs.length > 0, operatorCredible),
      finalReadinessLabel: toReadinessLabel(triLane.clubs.length > 0, operatorCredible, operatorRuleReviewRequired),
      sourceArtifactRefs: input.config.matcherArtifactRefs
    });
  }

  for (const strictAllLane of derived.strictAllLanes) {
    lanes.push({
      laneId: toLaneId(input.config, "STRICT_ALL", strictAllLane.venueSet),
      topicKey: input.config.topicKey,
      laneCardinality: "STRICT_ALL",
      venueSet: strictAllLane.venueSet,
      exactSafeClubs: strictAllLane.clubs,
      ruleStatus: input.matcherFinalDecision.ruleStatus,
      operatorRuleReviewRequired,
      matcherReady: strictAllLane.clubs.length > 0,
      operatorCredible,
      currentReadinessDecision: toReadinessDecision(strictAllLane.clubs.length > 0, operatorCredible),
      finalReadinessLabel: toReadinessLabel(strictAllLane.clubs.length > 0, operatorCredible, operatorRuleReviewRequired),
      sourceArtifactRefs: input.config.matcherArtifactRefs
    });
  }

  return lanes;
};
