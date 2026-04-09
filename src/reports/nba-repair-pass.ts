import { pairLabelRouteEligibility } from "../matching/match-labels.js";
import {
  SportsPocketMatchingPipeline,
  type SportsPocketMatchingPipelineResult,
  type SportsPocketPrefilterEvaluation
} from "../matching/sports/sports-pocket-matching-pipeline.js";
import { extractLegacySportsBoundaryForAudit } from "../matching/sports/sports-normalization.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import type { Pool } from "pg";

const NBA_POCKET = "SPORTS|MATCHUP_WINNER|NBA";
const NBA_VENUE_PAIRS = ["OPINION_POLYMARKET", "POLYMARKET_PREDICT", "OPINION_PREDICT"] as const;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])));

const bestKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const normalizeVenuePairKey = (value: string): string =>
  value.includes("|")
    ? value.split("|").sort((a, b) => a.localeCompare(b)).join("_")
    : value;

const buildAdmissionPocketLookup = (result: SportsPocketMatchingPipelineResult): ReadonlyMap<string, string | null> =>
  new Map(result.admissionEvaluations.map((row) => [row.market.interpretedContractId, row.pocket]));

const isPureNbaAttempt = (
  attempt: SportsPocketPrefilterEvaluation,
  pocketLookup: ReadonlyMap<string, string | null>
): boolean =>
  pocketLookup.get(attempt.leftInterpretedContractId) === NBA_POCKET
  && pocketLookup.get(attempt.rightInterpretedContractId) === NBA_POCKET;

export interface NbaRepairBaseline {
  preRepairBadDateRows: number;
  preRepairCandidatePairsConsidered: number;
  preRepairMatchIdentityRejects: number;
  preRepairDateAlignmentRejects: number;
  preRepairExactSafeEdges: number;
  preRepairRouteableOpportunities: number;
}

export interface NbaRepairCurrentStateAudit {
  observedAt: string;
  nbaRows: readonly {
    interpretedContractId: string;
    venue: string;
    title: string;
    publishedAt: string | null;
    expiresAt: string | null;
    resolvesAt: string | null;
    sourceMetadataVersion: string;
    temporalBasis: string;
    currentDateExtractionSource: string | null;
    currentTeamExtractionSource: string | null;
    currentSideAssignmentSource: string | null;
    legacyBoundary: ReturnType<typeof extractLegacySportsBoundaryForAudit>;
    repairedBoundary: {
      dateKey: string | null;
      cutoffTimestamp: string | null;
      rawDateText: string | null;
      dateStatus: string;
      yearSource: string | null;
      timestampSource: string | null;
    };
    currentRejectionLabels: readonly string[];
  }[];
  currentDateExtractionSources: readonly string[];
  currentTeamExtractionSources: readonly string[];
  unsafeDefaultBehaviors: readonly string[];
  currentRejectionLabels: Record<string, number>;
}

export interface NbaDateRepairSummary {
  observedAt: string;
  rows: readonly {
    interpretedContractId: string;
    venue: string;
    title: string;
    rawDateText: string | null;
    eventDate: string | null;
    cutoffTimestamp: string | null;
    timezoneNormalizedCutoff: string | null;
    dateStatus: string;
    dateSourceProvenance: string | null;
    timestampSource: string | null;
    yearSource: string | null;
    unsafeDefaultReasons: readonly string[];
    blockers: readonly string[];
  }[];
  statusCounts: Record<string, number>;
  pairDateClassificationCounts: Record<string, number>;
  fakeEpochRowsBefore: number;
  fakeEpochRowsAfter: number;
}

export interface NbaMatchIdentityRepairSummary {
  observedAt: string;
  rows: readonly {
    interpretedContractId: string;
    venue: string;
    title: string;
    rawSubjectText: string | null;
    rawOpponentText: string | null;
    normalizedSubject: string | null;
    normalizedOpponent: string | null;
    canonicalSortedTeams: readonly string[];
    matchupKey: string | null;
    sideAssignment: string | null;
    sideAssignmentSource: string | null;
    titleNoiseStripped: boolean;
    labels: readonly string[];
  }[];
  labelCounts: Record<string, number>;
}

export type NbaMatchInstanceProofLabel =
  | "SAME_GAME_PROVEN"
  | "SAME_TEAMS_WRONG_DATE"
  | "SAME_DATE_WRONG_TEAMS"
  | "SAME_TEAMS_DATE_UNCERTAIN"
  | "OPPONENT_IDENTITY_UNRESOLVED"
  | "OUTCOME_STRUCTURE_MISMATCH"
  | "SIDE_ORIENTATION_UNRESOLVED"
  | "POCKET_MISMATCH"
  | "BASIS_MISMATCH";

export interface NbaMatchInstanceProofSummary {
  observedAt: string;
  pairAttempts: readonly {
    venuePair: string;
    leftInterpretedContractId: string;
    rightInterpretedContractId: string;
    leftTitle: string;
    rightTitle: string;
    leftMatchupKey: string | null;
    rightMatchupKey: string | null;
    leftDateKey: string | null;
    rightDateKey: string | null;
    leftCutoffTimestamp: string | null;
    rightCutoffTimestamp: string | null;
    proofClass: NbaMatchInstanceProofLabel;
    prefilterAccepted: boolean;
    rawReasons: readonly string[];
  }[];
  proofClassCounts: Record<string, number>;
}

export interface NbaPocketRepairedRouteabilitySummary {
  observedAt: string;
  sourceRowsDiscovered: number;
  admittedRows: number;
  candidatePairsConsidered: number;
  candidatePairsRejectedByReason: Record<string, number>;
  exactSafeApprovedEdges: number;
  exactSafeRouteableOpportunities: number;
  venuePairOutcomes: Record<string, {
    candidatePairsConsidered: number;
    exactSafeApprovedEdges: number;
    proofClassCounts: Record<string, number>;
  }>;
  deltasVsPreRepair: {
    candidatePairsConsidered: number;
    exactSafeApprovedEdges: number;
    exactSafeRouteableOpportunities: number;
  };
}

export type NbaRepairImpactLabel =
  | "MATERIAL_NBA_REPAIR_GAIN"
  | "MODEST_REPAIR_GAIN"
  | "ZERO_REPAIR_GAIN__COVERAGE_LIMIT_REMAINS"
  | "ZERO_REPAIR_GAIN__OUTCOME_STRUCTURE_REMAINS"
  | "REPAIR_INCOMPLETE";

export interface NbaRepairDeltaSummary {
  observedAt: string;
  impactLabel: NbaRepairImpactLabel;
  before: {
    badDateRows: number;
    matchIdentityRejects: number;
    dateAlignmentRejects: number;
    candidatePairsConsidered: number;
    exactSafeEdges: number;
    routeableOpportunities: number;
  };
  after: {
    badDateRows: number;
    matchIdentityRejects: number;
    dateAlignmentRejects: number;
    candidatePairsConsidered: number;
    exactSafeEdges: number;
    routeableOpportunities: number;
  };
  delta: {
    badDateRows: number;
    matchIdentityRejects: number;
    dateAlignmentRejects: number;
    candidatePairsConsidered: number;
    exactSafeEdges: number;
    routeableOpportunities: number;
  };
}

export type NbaRepairDecisionLabel =
  | "NBA_IDENTITY_REPAIRED__EXACT_SAFE_EDGES_CREATED"
  | "NBA_IDENTITY_REPAIRED__DATE_FIXED_BUT_COVERAGE_THIN"
  | "NBA_IDENTITY_REPAIRED__STILL_BLOCKED_BY_OPPONENT_IDENTITY"
  | "NBA_IDENTITY_REPAIRED__OUTCOME_STRUCTURE_STILL_BLOCKING"
  | "NBA_REPAIR_INCOMPLETE__MANUAL_REVIEW_NEEDED";

export type NbaRepairNextStepRecommendation =
  | "KEEP_NBA_AND_EXPAND_WITHIN_SPORTS"
  | "HOLD_NBA_AND_RUN_TARGETED_DOTA2_ESL_RECOVERY"
  | "KEEP_NBA_AND_BUILD_FIXTURE_BINDING_LAYER"
  | "HOLD_SPORTS_AND_RETURN_TO_OTHER_FRONTIER";

export interface NbaRepairFinalDecision {
  observedAt: string;
  decision: NbaRepairDecisionLabel;
  primaryNextStepRecommendation: NbaRepairNextStepRecommendation;
  rationale: string;
  exactSafeApprovedEdges: number;
  dominantProofClass: string | null;
}

export interface NbaRepairArtifacts {
  currentStateAudit: NbaRepairCurrentStateAudit;
  dateRepairSummary: NbaDateRepairSummary;
  matchIdentityRepairSummary: NbaMatchIdentityRepairSummary;
  matchInstanceProofSummary: NbaMatchInstanceProofSummary;
  routeabilitySummary: NbaPocketRepairedRouteabilitySummary;
  deltaSummary: NbaRepairDeltaSummary;
  finalDecision: NbaRepairFinalDecision;
  operatorSummary: string;
}

const isNbaRow = (result: SportsPocketMatchingPipelineResult, interpretedContractId: string): boolean =>
  result.admissionEvaluations.some((row) =>
    row.market.interpretedContractId === interpretedContractId && row.pocket === NBA_POCKET
  );

const classifyNbaDatePair = (attempt: SportsPocketPrefilterEvaluation): string => {
  if (!attempt.leftDateKey || !attempt.rightDateKey) {
    return "MISSING_EVENT_DATE";
  }
  if (attempt.leftDateKey === attempt.rightDateKey && attempt.leftCutoffTimestamp === attempt.rightCutoffTimestamp) {
    return "DATE_WINDOW_CONFIRMED";
  }
  if (attempt.leftDateKey === attempt.rightDateKey) {
    return "SAME_DAY_BUT_DIFFERENT_CUTOFF";
  }
  return "DATE_WINDOW_MISMATCH";
};

const classifyNbaPairProof = (attempt: SportsPocketPrefilterEvaluation): NbaMatchInstanceProofLabel => {
  if (attempt.pocket !== NBA_POCKET) {
    return "POCKET_MISMATCH";
  }
  if (attempt.leftTemporalBasis !== attempt.rightTemporalBasis) {
    return "BASIS_MISMATCH";
  }
  if (attempt.leftOutcomeMappingBasis !== attempt.rightOutcomeMappingBasis) {
    return "OUTCOME_STRUCTURE_MISMATCH";
  }
  if (!attempt.leftMatchupKey || !attempt.rightMatchupKey || !attempt.leftOpponentEntity || !attempt.rightOpponentEntity) {
    return "OPPONENT_IDENTITY_UNRESOLVED";
  }
  if (attempt.leftSideAssignment !== attempt.rightSideAssignment) {
    return "SIDE_ORIENTATION_UNRESOLVED";
  }

  const sameTeams = attempt.leftMatchupKey === attempt.rightMatchupKey;
  if (sameTeams && attempt.leftDateKey && attempt.rightDateKey) {
    if (attempt.leftDateKey === attempt.rightDateKey && attempt.leftCutoffTimestamp === attempt.rightCutoffTimestamp) {
      return "SAME_GAME_PROVEN";
    }
    return "SAME_TEAMS_WRONG_DATE";
  }
  if (sameTeams) {
    return "SAME_TEAMS_DATE_UNCERTAIN";
  }
  if (attempt.leftDateKey && attempt.rightDateKey && attempt.leftDateKey === attempt.rightDateKey) {
    return "SAME_DATE_WRONG_TEAMS";
  }
  return "OPPONENT_IDENTITY_UNRESOLVED";
};

const buildCurrentStateAudit = (input: {
  result: SportsPocketMatchingPipelineResult;
}): NbaRepairCurrentStateAudit => {
  const observedAt = new Date().toISOString();
  const entities = new Map(input.result.entityEvaluations.map((row) => [row.market.interpretedContractId, row]));
  const dates = new Map(input.result.dateEvaluations.map((row) => [row.market.interpretedContractId, row]));
  const prefilterByContractId = new Map<string, string[]>();
  const currentDateExtractionSources = new Set<string>();
  const currentTeamExtractionSources = new Set<string>();
  const unsafeDefaultBehaviors = new Set<string>();
  const currentRejectionLabels: Record<string, number> = {};

  for (const attempt of input.result.prefilterEvaluations.filter((row) => row.pocket === NBA_POCKET)) {
    for (const contractId of [attempt.leftInterpretedContractId, attempt.rightInterpretedContractId]) {
      const reasons = prefilterByContractId.get(contractId) ?? [];
      reasons.push(...attempt.reasons);
      prefilterByContractId.set(contractId, reasons);
    }
    for (const reason of attempt.reasons) increment(currentRejectionLabels, reason);
  }

  const nbaRows = input.result.admissionEvaluations
    .filter((row) => row.pocket === NBA_POCKET)
    .map((row) => {
      const entity = entities.get(row.market.interpretedContractId);
      const date = dates.get(row.market.interpretedContractId);
      const legacyBoundary = extractLegacySportsBoundaryForAudit(row.market);
      if (date?.dateSourceProvenance) currentDateExtractionSources.add(date.dateSourceProvenance);
      if (entity?.sideAssignmentSource) currentTeamExtractionSources.add(entity.sideAssignmentSource);
      for (const reason of legacyBoundary.unsafeDefaultReasons) unsafeDefaultBehaviors.add(reason);
      for (const reason of date?.unsafeDefaultReasons ?? []) unsafeDefaultBehaviors.add(reason);
      return {
        interpretedContractId: row.market.interpretedContractId,
        venue: row.market.venue,
        title: row.market.title,
        publishedAt: row.market.publishedAt?.toISOString() ?? null,
        expiresAt: row.market.expiresAt?.toISOString() ?? null,
        resolvesAt: row.market.resolvesAt?.toISOString() ?? null,
        sourceMetadataVersion: row.market.sourceMetadataVersion,
        temporalBasis: row.market.inventoryTemporalBasis,
        currentDateExtractionSource: date?.dateSourceProvenance ?? null,
        currentTeamExtractionSource: entity?.sideAssignmentSource ?? null,
        currentSideAssignmentSource: entity?.sideAssignmentSource ?? null,
        legacyBoundary,
        repairedBoundary: {
          dateKey: date?.eventDate ?? null,
          cutoffTimestamp: date?.timezoneNormalizedCutoff ?? null,
          rawDateText: date?.rawDateText ?? null,
          dateStatus: date?.dateStatus ?? "DATE_MISSING",
          yearSource: date?.yearSource ?? null,
          timestampSource: date?.timestampSource ?? null
        },
        currentRejectionLabels: [...new Set(prefilterByContractId.get(row.market.interpretedContractId) ?? [])]
      };
    });

  return {
    observedAt,
    nbaRows,
    currentDateExtractionSources: [...currentDateExtractionSources].sort(),
    currentTeamExtractionSources: [...currentTeamExtractionSources].sort(),
    unsafeDefaultBehaviors: [...unsafeDefaultBehaviors].sort(),
    currentRejectionLabels: sortRecord(currentRejectionLabels)
  };
};

const buildDateRepairSummary = (input: {
  result: SportsPocketMatchingPipelineResult;
  baseline: NbaRepairBaseline;
}): NbaDateRepairSummary => {
  const observedAt = new Date().toISOString();
  const pocketLookup = buildAdmissionPocketLookup(input.result);
  const rows = input.result.dateEvaluations
    .filter((row) => row.pocket === NBA_POCKET)
    .map((row) => ({
      interpretedContractId: row.market.interpretedContractId,
      venue: row.market.venue,
      title: row.market.title,
      rawDateText: row.rawDateText,
      eventDate: row.eventDate,
      cutoffTimestamp: row.cutoffTimestamp,
      timezoneNormalizedCutoff: row.timezoneNormalizedCutoff,
      dateStatus: row.dateStatus,
      dateSourceProvenance: row.dateSourceProvenance,
      timestampSource: row.timestampSource,
      yearSource: row.yearSource,
      unsafeDefaultReasons: row.unsafeDefaultReasons,
      blockers: row.blockers
    }));
  const statusCounts: Record<string, number> = {};
  for (const row of rows) increment(statusCounts, row.dateStatus);
  const pairDateClassificationCounts: Record<string, number> = {};
  for (const attempt of input.result.prefilterEvaluations.filter((row) => isPureNbaAttempt(row, pocketLookup))) {
    increment(pairDateClassificationCounts, classifyNbaDatePair(attempt));
  }
  return {
    observedAt,
    rows,
    statusCounts: sortRecord(statusCounts),
    pairDateClassificationCounts: sortRecord(pairDateClassificationCounts),
    fakeEpochRowsBefore: input.baseline.preRepairBadDateRows,
    fakeEpochRowsAfter: rows.filter((row) => (row.eventDate ?? "").startsWith("1970-")).length
  };
};

const buildMatchIdentityRepairSummary = (input: {
  result: SportsPocketMatchingPipelineResult;
}): NbaMatchIdentityRepairSummary => {
  const observedAt = new Date().toISOString();
  const rows = input.result.entityEvaluations
    .filter((row) => row.pocket === NBA_POCKET)
    .map((row) => {
      const labels: string[] = [];
      if (row.titleNoiseStripped) labels.push("TITLE_NOISE_STRIPPED");
      if (row.subjectEntity && row.rawSubjectText && row.subjectEntity !== row.rawSubjectText.toLowerCase()) labels.push("TEAM_ALIAS_NORMALIZED");
      if (row.blockers.includes("UNRESOLVED_ALIAS")) labels.push("TEAM_ALIAS_UNRESOLVED");
      if (row.opponentEntity) labels.push("OPPONENT_CONFIRMED");
      if (row.blockers.includes("MISSING_OPPONENT")) labels.push("OPPONENT_MISSING");
      if (row.matchupKey) labels.push("MATCHUP_KEY_CONFIRMED");
      if (!row.matchupKey) labels.push("MATCHUP_KEY_AMBIGUOUS");
      return {
        interpretedContractId: row.market.interpretedContractId,
        venue: row.market.venue,
        title: row.market.title,
        rawSubjectText: row.rawSubjectText,
        rawOpponentText: row.rawOpponentText,
        normalizedSubject: row.subjectEntity,
        normalizedOpponent: row.opponentEntity,
        canonicalSortedTeams: row.canonicalSortedTeams,
        matchupKey: row.matchupKey,
        sideAssignment: row.sideAssignment,
        sideAssignmentSource: row.sideAssignmentSource,
        titleNoiseStripped: row.titleNoiseStripped,
        labels
      };
    });
  const labelCounts: Record<string, number> = {};
  for (const row of rows) for (const label of row.labels) increment(labelCounts, label);
  return { observedAt, rows, labelCounts: sortRecord(labelCounts) };
};

const buildMatchInstanceProofSummary = (input: {
  result: SportsPocketMatchingPipelineResult;
}): NbaMatchInstanceProofSummary => {
  const observedAt = new Date().toISOString();
  const pocketLookup = buildAdmissionPocketLookup(input.result);
  const pairAttempts = input.result.prefilterEvaluations
    .filter((row) => isPureNbaAttempt(row, pocketLookup))
    .map((row) => ({
      venuePair: normalizeVenuePairKey(row.venuePair),
      leftInterpretedContractId: row.leftInterpretedContractId,
      rightInterpretedContractId: row.rightInterpretedContractId,
      leftTitle: row.leftTitle,
      rightTitle: row.rightTitle,
      leftMatchupKey: row.leftMatchupKey,
      rightMatchupKey: row.rightMatchupKey,
      leftDateKey: row.leftDateKey,
      rightDateKey: row.rightDateKey,
      leftCutoffTimestamp: row.leftCutoffTimestamp,
      rightCutoffTimestamp: row.rightCutoffTimestamp,
      proofClass: classifyNbaPairProof(row),
      prefilterAccepted: row.accepted,
      rawReasons: row.reasons
    }));
  const proofClassCounts: Record<string, number> = {};
  for (const attempt of pairAttempts) increment(proofClassCounts, attempt.proofClass);
  return {
    observedAt,
    pairAttempts,
    proofClassCounts: sortRecord(proofClassCounts)
  };
};

const buildRouteabilitySummary = (input: {
  result: SportsPocketMatchingPipelineResult;
  proofSummary: NbaMatchInstanceProofSummary;
  baseline: NbaRepairBaseline;
}): NbaPocketRepairedRouteabilitySummary => {
  const nbaAdmissions = input.result.admissionEvaluations.filter((row) => row.pocket === NBA_POCKET);
  const nbaPairEdges = input.result.pairEvaluations.filter((row) => row.pocket === NBA_POCKET);
  const venuePairOutcomes = Object.fromEntries(
    NBA_VENUE_PAIRS.map((key) => [key, {
      candidatePairsConsidered: 0,
      exactSafeApprovedEdges: 0,
      proofClassCounts: {} as Record<string, number>
    }])
  );

  for (const attempt of input.proofSummary.pairAttempts) {
    const venueEntry = venuePairOutcomes[attempt.venuePair] ??= {
      candidatePairsConsidered: 0,
      exactSafeApprovedEdges: 0,
      proofClassCounts: {}
    };
    venueEntry.candidatePairsConsidered += 1;
    increment(venueEntry.proofClassCounts, attempt.proofClass);
  }

  const exactSafeApprovedEdges = nbaPairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length;
  for (const edge of nbaPairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState))) {
    const venueKey = normalizeVenuePairKey(edge.venuePair);
    const venueEntry = venuePairOutcomes[venueKey] ??= {
      candidatePairsConsidered: 0,
      exactSafeApprovedEdges: 0,
      proofClassCounts: {}
    };
    venueEntry.exactSafeApprovedEdges += 1;
  }

  const candidatePairsRejectedByReason: Record<string, number> = {};
  for (const attempt of input.proofSummary.pairAttempts) {
    if (attempt.proofClass !== "SAME_GAME_PROVEN") {
      increment(candidatePairsRejectedByReason, attempt.proofClass);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    sourceRowsDiscovered: nbaAdmissions.length,
    admittedRows: input.result.pocketMarkets.filter((market) => isNbaRow(input.result, market.interpretedContractId)).length,
    candidatePairsConsidered: input.proofSummary.pairAttempts.length,
    candidatePairsRejectedByReason: sortRecord(candidatePairsRejectedByReason),
    exactSafeApprovedEdges,
    exactSafeRouteableOpportunities: nbaPairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length,
    venuePairOutcomes: Object.fromEntries(
      Object.entries(venuePairOutcomes).map(([key, value]) => [key, {
        candidatePairsConsidered: value.candidatePairsConsidered,
        exactSafeApprovedEdges: value.exactSafeApprovedEdges,
        proofClassCounts: sortRecord(value.proofClassCounts)
      }])
    ),
    deltasVsPreRepair: {
      candidatePairsConsidered: input.proofSummary.pairAttempts.length - input.baseline.preRepairCandidatePairsConsidered,
      exactSafeApprovedEdges: exactSafeApprovedEdges - input.baseline.preRepairExactSafeEdges,
      exactSafeRouteableOpportunities:
        nbaPairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length
        - input.baseline.preRepairRouteableOpportunities
    }
  };
};

const buildDeltaSummary = (input: {
  baseline: NbaRepairBaseline;
  dateRepairSummary: NbaDateRepairSummary;
  proofSummary: NbaMatchInstanceProofSummary;
  routeabilitySummary: NbaPocketRepairedRouteabilitySummary;
}): NbaRepairDeltaSummary => {
  const afterMatchIdentityRejects =
    (input.proofSummary.proofClassCounts["OPPONENT_IDENTITY_UNRESOLVED"] ?? 0)
    + (input.proofSummary.proofClassCounts["SAME_DATE_WRONG_TEAMS"] ?? 0)
    + (input.proofSummary.proofClassCounts["SIDE_ORIENTATION_UNRESOLVED"] ?? 0);
  const afterDateAlignmentRejects =
    (input.proofSummary.proofClassCounts["SAME_TEAMS_WRONG_DATE"] ?? 0)
    + (input.proofSummary.proofClassCounts["SAME_TEAMS_DATE_UNCERTAIN"] ?? 0);
  const afterBadDateRows = input.dateRepairSummary.fakeEpochRowsAfter;
  const exactSafeEdges = input.routeabilitySummary.exactSafeApprovedEdges;
  const routeable = input.routeabilitySummary.exactSafeRouteableOpportunities;

  const impactLabel: NbaRepairImpactLabel =
    afterBadDateRows > 0 ? "REPAIR_INCOMPLETE"
      : exactSafeEdges - input.baseline.preRepairExactSafeEdges >= 2 ? "MATERIAL_NBA_REPAIR_GAIN"
      : exactSafeEdges - input.baseline.preRepairExactSafeEdges === 1 ? "MODEST_REPAIR_GAIN"
      : (input.proofSummary.proofClassCounts["OUTCOME_STRUCTURE_MISMATCH"] ?? 0) > 0 ? "ZERO_REPAIR_GAIN__OUTCOME_STRUCTURE_REMAINS"
      : "ZERO_REPAIR_GAIN__COVERAGE_LIMIT_REMAINS";

  return {
    observedAt: new Date().toISOString(),
    impactLabel,
    before: {
      badDateRows: input.baseline.preRepairBadDateRows,
      matchIdentityRejects: input.baseline.preRepairMatchIdentityRejects,
      dateAlignmentRejects: input.baseline.preRepairDateAlignmentRejects,
      candidatePairsConsidered: input.baseline.preRepairCandidatePairsConsidered,
      exactSafeEdges: input.baseline.preRepairExactSafeEdges,
      routeableOpportunities: input.baseline.preRepairRouteableOpportunities
    },
    after: {
      badDateRows: afterBadDateRows,
      matchIdentityRejects: afterMatchIdentityRejects,
      dateAlignmentRejects: afterDateAlignmentRejects,
      candidatePairsConsidered: input.routeabilitySummary.candidatePairsConsidered,
      exactSafeEdges,
      routeableOpportunities: routeable
    },
    delta: {
      badDateRows: afterBadDateRows - input.baseline.preRepairBadDateRows,
      matchIdentityRejects: afterMatchIdentityRejects - input.baseline.preRepairMatchIdentityRejects,
      dateAlignmentRejects: afterDateAlignmentRejects - input.baseline.preRepairDateAlignmentRejects,
      candidatePairsConsidered: input.routeabilitySummary.candidatePairsConsidered - input.baseline.preRepairCandidatePairsConsidered,
      exactSafeEdges: exactSafeEdges - input.baseline.preRepairExactSafeEdges,
      routeableOpportunities: routeable - input.baseline.preRepairRouteableOpportunities
    }
  };
};

const buildFinalDecision = (input: {
  routeabilitySummary: NbaPocketRepairedRouteabilitySummary;
  deltaSummary: NbaRepairDeltaSummary;
  proofSummary: NbaMatchInstanceProofSummary;
}): NbaRepairFinalDecision => {
  const dominantProofClass = bestKey(input.proofSummary.proofClassCounts);

  if (input.routeabilitySummary.exactSafeApprovedEdges > 0) {
    return {
      observedAt: new Date().toISOString(),
      decision: "NBA_IDENTITY_REPAIRED__EXACT_SAFE_EDGES_CREATED",
      primaryNextStepRecommendation: "KEEP_NBA_AND_EXPAND_WITHIN_SPORTS",
      rationale: "Repaired NBA proof now creates at least one approved exact-safe pair edge.",
      exactSafeApprovedEdges: input.routeabilitySummary.exactSafeApprovedEdges,
      dominantProofClass
    };
  }

  if (input.deltaSummary.impactLabel === "REPAIR_INCOMPLETE") {
    return {
      observedAt: new Date().toISOString(),
      decision: "NBA_REPAIR_INCOMPLETE__MANUAL_REVIEW_NEEDED",
      primaryNextStepRecommendation: "KEEP_NBA_AND_BUILD_FIXTURE_BINDING_LAYER",
      rationale: "Unsafe date normalization or proof coverage remains incomplete after the repair.",
      exactSafeApprovedEdges: input.routeabilitySummary.exactSafeApprovedEdges,
      dominantProofClass
    };
  }

  if ((input.proofSummary.proofClassCounts["BASIS_MISMATCH"] ?? 0) >= Math.max(
    input.proofSummary.proofClassCounts["OPPONENT_IDENTITY_UNRESOLVED"] ?? 0,
    input.proofSummary.proofClassCounts["OUTCOME_STRUCTURE_MISMATCH"] ?? 0,
    input.proofSummary.proofClassCounts["SAME_TEAMS_WRONG_DATE"] ?? 0
  )) {
    return {
      observedAt: new Date().toISOString(),
      decision: "NBA_IDENTITY_REPAIRED__DATE_FIXED_BUT_COVERAGE_THIN",
      primaryNextStepRecommendation: "HOLD_NBA_AND_RUN_TARGETED_DOTA2_ESL_RECOVERY",
      rationale: "Date repair is complete, but comparable NBA counterparts are thin because the remaining multi-venue comparisons are basis-fragmented rather than same-game exact-safe candidates.",
      exactSafeApprovedEdges: input.routeabilitySummary.exactSafeApprovedEdges,
      dominantProofClass
    };
  }

  if ((input.proofSummary.proofClassCounts["OUTCOME_STRUCTURE_MISMATCH"] ?? 0) > 0) {
    return {
      observedAt: new Date().toISOString(),
      decision: "NBA_IDENTITY_REPAIRED__OUTCOME_STRUCTURE_STILL_BLOCKING",
      primaryNextStepRecommendation: "HOLD_NBA_AND_RUN_TARGETED_DOTA2_ESL_RECOVERY",
      rationale: "Same-pocket NBA supply exists, but outcome structure still blocks exact-safe matching.",
      exactSafeApprovedEdges: input.routeabilitySummary.exactSafeApprovedEdges,
      dominantProofClass
    };
  }

  if (
    (input.proofSummary.proofClassCounts["OPPONENT_IDENTITY_UNRESOLVED"] ?? 0)
    + (input.proofSummary.proofClassCounts["SAME_DATE_WRONG_TEAMS"] ?? 0)
    >= (input.proofSummary.proofClassCounts["SAME_TEAMS_WRONG_DATE"] ?? 0)
  ) {
    return {
      observedAt: new Date().toISOString(),
      decision: "NBA_IDENTITY_REPAIRED__STILL_BLOCKED_BY_OPPONENT_IDENTITY",
      primaryNextStepRecommendation: "KEEP_NBA_AND_BUILD_FIXTURE_BINDING_LAYER",
      rationale: "Date repair is in place, but the dominant remaining blocker is proving the same NBA game instance across venues.",
      exactSafeApprovedEdges: input.routeabilitySummary.exactSafeApprovedEdges,
      dominantProofClass
    };
  }

  return {
    observedAt: new Date().toISOString(),
    decision: "NBA_IDENTITY_REPAIRED__DATE_FIXED_BUT_COVERAGE_THIN",
    primaryNextStepRecommendation: "HOLD_NBA_AND_RUN_TARGETED_DOTA2_ESL_RECOVERY",
    rationale: "Fake date paths are removed, and the remaining NBA failures are mostly missing same-game venue counterparts.",
    exactSafeApprovedEdges: input.routeabilitySummary.exactSafeApprovedEdges,
    dominantProofClass
  };
};

const buildOperatorSummary = (input: {
  dateRepairSummary: NbaDateRepairSummary;
  routeabilitySummary: NbaPocketRepairedRouteabilitySummary;
  finalDecision: NbaRepairFinalDecision;
}): string => {
  const bestVenuePair = bestKey(
    Object.fromEntries(
      Object.entries(input.routeabilitySummary.venuePairOutcomes)
        .map(([key, value]) => [key, value.exactSafeApprovedEdges || value.candidatePairsConsidered])
    )
  ) ?? "none";
  return [
    "# NBA Repair Operator Summary",
    "",
    `1. Fake 1970 date normalization eliminated: ${input.dateRepairSummary.fakeEpochRowsAfter === 0 ? "yes" : "no"}.`,
    `2. Exact-safe NBA edges after repair: ${input.routeabilitySummary.exactSafeApprovedEdges}.`,
    `3. Candidate pairs considered after repair: ${input.routeabilitySummary.candidatePairsConsidered}.`,
    `4. Best venue pair after repair: ${bestVenuePair}.`,
    `5. Primary remaining blocker: ${bestKey(input.routeabilitySummary.candidatePairsRejectedByReason) ?? "none"}.`,
    `6. Final decision: ${input.finalDecision.decision}.`,
    `7. Smallest correct next action: ${input.finalDecision.primaryNextStepRecommendation}.`,
    ""
  ].join("\n");
};

export const buildNbaRepairArtifactsFromResult = (input: {
  result: SportsPocketMatchingPipelineResult;
  baseline: NbaRepairBaseline;
}): NbaRepairArtifacts => {
  const currentStateAudit = buildCurrentStateAudit({ result: input.result });
  const dateRepairSummary = buildDateRepairSummary({
    result: input.result,
    baseline: input.baseline
  });
  const matchIdentityRepairSummary = buildMatchIdentityRepairSummary({ result: input.result });
  const matchInstanceProofSummary = buildMatchInstanceProofSummary({ result: input.result });
  const routeabilitySummary = buildRouteabilitySummary({
    result: input.result,
    proofSummary: matchInstanceProofSummary,
    baseline: input.baseline
  });
  const deltaSummary = buildDeltaSummary({
    baseline: input.baseline,
    dateRepairSummary,
    proofSummary: matchInstanceProofSummary,
    routeabilitySummary
  });
  const finalDecision = buildFinalDecision({
    routeabilitySummary,
    deltaSummary,
    proofSummary: matchInstanceProofSummary
  });

  return {
    currentStateAudit,
    dateRepairSummary,
    matchIdentityRepairSummary,
    matchInstanceProofSummary,
    routeabilitySummary,
    deltaSummary,
    finalDecision,
    operatorSummary: buildOperatorSummary({
      dateRepairSummary,
      routeabilitySummary,
      finalDecision
    })
  };
};

export const buildNbaRepairArtifacts = async (input: {
  pool: Pool;
  baseline: NbaRepairBaseline;
}): Promise<NbaRepairArtifacts> => {
  const pipeline = new SportsPocketMatchingPipeline(new PairEdgeRepository(input.pool));
  const result = await pipeline.run();
  return buildNbaRepairArtifactsFromResult({
    result,
    baseline: input.baseline
  });
};

const buildListMarkdown = (title: string, lines: readonly string[]): string => [
  `# ${title}`,
  "",
  ...lines,
  ""
].join("\n");

export const buildNbaRepairCurrentStateAuditMarkdown = (artifact: NbaRepairCurrentStateAudit): string =>
  buildListMarkdown("NBA Repair Current-State Audit", [
    `- current date extraction sources: ${artifact.currentDateExtractionSources.join(", ") || "none"}`,
    `- current team extraction sources: ${artifact.currentTeamExtractionSources.join(", ") || "none"}`,
    `- unsafe defaults found: ${artifact.unsafeDefaultBehaviors.join(", ") || "none"}`,
    `- current rejection labels: ${Object.entries(artifact.currentRejectionLabels).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildNbaDateRepairSummaryMarkdown = (artifact: NbaDateRepairSummary): string =>
  buildListMarkdown("NBA Date Repair Summary", [
    `- fake epoch rows before -> after: ${artifact.fakeEpochRowsBefore} -> ${artifact.fakeEpochRowsAfter}`,
    `- status counts: ${Object.entries(artifact.statusCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    `- pair date classifications: ${Object.entries(artifact.pairDateClassificationCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildNbaMatchIdentityRepairSummaryMarkdown = (artifact: NbaMatchIdentityRepairSummary): string =>
  buildListMarkdown("NBA Match Identity Repair Summary", [
    `- label counts: ${Object.entries(artifact.labelCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildNbaMatchInstanceProofSummaryMarkdown = (artifact: NbaMatchInstanceProofSummary): string =>
  buildListMarkdown("NBA Match-Instance Proof Summary", [
    `- proof classes: ${Object.entries(artifact.proofClassCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildNbaPocketRepairedRouteabilitySummaryMarkdown = (artifact: NbaPocketRepairedRouteabilitySummary): string =>
  buildListMarkdown("NBA Pocket Repaired Routeability Summary", [
    `- source rows discovered: ${artifact.sourceRowsDiscovered}`,
    `- admitted rows: ${artifact.admittedRows}`,
    `- candidate pairs considered: ${artifact.candidatePairsConsidered}`,
    `- exact-safe approved edges: ${artifact.exactSafeApprovedEdges}`,
    `- exact-safe routeable opportunities: ${artifact.exactSafeRouteableOpportunities}`,
    `- candidate rejects: ${Object.entries(artifact.candidatePairsRejectedByReason).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildNbaRepairDeltaSummaryMarkdown = (artifact: NbaRepairDeltaSummary): string =>
  buildListMarkdown("NBA Repair Delta Summary", [
    `- impact: ${artifact.impactLabel}`,
    `- bad-date rows before -> after: ${artifact.before.badDateRows} -> ${artifact.after.badDateRows}`,
    `- match-identity rejects before -> after: ${artifact.before.matchIdentityRejects} -> ${artifact.after.matchIdentityRejects}`,
    `- date rejects before -> after: ${artifact.before.dateAlignmentRejects} -> ${artifact.after.dateAlignmentRejects}`,
    `- exact-safe edges before -> after: ${artifact.before.exactSafeEdges} -> ${artifact.after.exactSafeEdges}`
  ]);

export const buildNbaRepairFinalDecisionMarkdown = (artifact: NbaRepairFinalDecision): string =>
  buildListMarkdown("NBA Repair Final Decision", [
    `- decision: ${artifact.decision}`,
    `- exact-safe approved edges: ${artifact.exactSafeApprovedEdges}`,
    `- dominant proof class: ${artifact.dominantProofClass ?? "none"}`,
    `- primary next step: ${artifact.primaryNextStepRecommendation}`,
    "",
    artifact.rationale
  ]);
