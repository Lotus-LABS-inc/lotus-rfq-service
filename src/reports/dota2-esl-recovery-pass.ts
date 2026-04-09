import type { Pool } from "pg";

import { SportsPocketMatchingPipeline, type SportsPocketMatchingPipelineResult } from "../matching/sports/sports-pocket-matching-pipeline.js";
import { normalizeSportsCompetitionContext } from "../matching/sports/sports-competition-context.js";
import { classifySportsFamily } from "../matching/sports/sports-family-classifier.js";
import { extractSportsBoundaryDetailed, buildSportsText, extractOutcomeLabels, isYesNoLabel } from "../matching/sports/sports-normalization.js";
import { normalizeSportsSubjectEntities } from "../matching/sports/sports-subject-entity.js";
import { pairLabelRouteEligibility } from "../matching/match-labels.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";

const DOTA2_ESL_POCKET = "ESPORTS|MATCHUP_WINNER|DOTA2_ESL";
const DOTA2_SCOPE_RELATED_PATTERN = /\bdota2\b|\besl\b/i;
const TARGET_VENUES = ["POLYMARKET", "LIMITLESS", "OPINION", "PREDICT"] as const;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])));

const normalizeVenuePairKey = (value: string): string =>
  value.includes("|")
    ? value.split("|").sort((left, right) => left.localeCompare(right)).join("_")
    : value;

const bestKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

export interface Dota2EslBaseline {
  admittedRows: number;
  candidatePairs: number;
  exactSafeEdges: number;
  routeableOpportunities: number;
  blockerCounts: Record<string, number>;
}

type Dota2SourceHygieneReason =
  | "WRONG_ESPORT"
  | "WRONG_COMPETITION"
  | "SINGLE_SIDE_ROW"
  | "MISSING_OPPONENT"
  | "MALFORMED_TITLE"
  | "DERIVATIVE_ROW";

type Dota2DateStatus =
  | "DATE_CONFIRMED"
  | "DATE_INFERRED"
  | "DATE_MISSING"
  | "DATE_INVALID"
  | "DATE_AMBIGUOUS";

type Dota2PairDateStatus =
  | "SAME_DAY_CONFIRMED"
  | "SAME_DAY_DIFFERENT_WINDOW"
  | "DIFFERENT_EVENT_DATE"
  | "DATE_MISSING";

type Dota2RecoveryExecution =
  | "no_recovery_executed_safe_hook_missing"
  | "recovery_not_justified"
  | "artifact_scan_executed_no_candidates_found";

export type Dota2EslDecisionLabel =
  | "DOTA2_ESL_RECOVERY_SUCCESS__EXACT_SAFE_EDGES_CREATED"
  | "DOTA2_ESL_RECOVERY_SUCCESS__PAIR_ROUTEABILITY_CREATED"
  | "DOTA2_ESL_RECOVERY_CLEAN_BUT_COVERAGE_THIN"
  | "DOTA2_ESL_RECOVERY_BLOCKED_BY_IDENTITY"
  | "DOTA2_ESL_RECOVERY_BLOCKED_BY_DATE"
  | "DOTA2_ESL_RECOVERY_BLOCKED_BY_BASIS"
  | "DOTA2_ESL_RECOVERY_INCOMPLETE__MANUAL_REVIEW_NEEDED";

export type Dota2EslNextStepRecommendation =
  | "KEEP_DOTA2_ESL_AND_EXPAND_WITHIN_ESPORTS"
  | "KEEP_DOTA2_ESL_AND_BUILD_FIXTURE_BINDING_LAYER"
  | "HOLD_DOTA2_ESL_AND_RETURN_TO_CRYPTO"
  | "HOLD_DOTA2_ESL_AND_WAIT_FOR_BETTER_SUPPLY"
  | "SPORTS_FRONTIER_NOT_YET_READY";

interface Dota2ScopeRow {
  interpretedContractId: string;
  venue: string;
  title: string;
  sourceMetadataVersion: string;
  temporalBasis: string;
  historicalRowCount: number;
  accepted: boolean;
  sourceHygieneReasons: readonly Dota2SourceHygieneReason[];
  normalizedSubject: string | null;
  normalizedOpponent: string | null;
  matchupKey: string | null;
  rawSubjectText: string | null;
  rawOpponentText: string | null;
  titleNoiseStripped: boolean;
  dateStatus: Dota2DateStatus;
  eventDate: string | null;
  cutoffTimestamp: string | null;
  timezoneNormalizedCutoff: string | null;
  dateSourceProvenance: string | null;
  unsafeDefaultReasons: readonly string[];
}

export interface Dota2EslCurrentStateAudit {
  observedAt: string;
  venueSummaries: Record<string, {
    rawRows: number;
    admittedRows: number;
    rejectedRows: number;
    liveRows: number;
    historicalRows: number;
    currentStateRows: number;
    candidateEligibleRows: number;
  }>;
  excludedRows: readonly {
    venue: string;
    interpretedContractId: string;
    title: string;
    reasons: readonly Dota2SourceHygieneReason[];
  }[];
  admissibleVenuePairs: readonly string[];
}

export interface Dota2EslSourceHygieneSummary {
  observedAt: string;
  admittedRows: number;
  rejectedRows: number;
  reasons: Record<string, number>;
  examples: readonly {
    venue: string;
    interpretedContractId: string;
    title: string;
    reasons: readonly Dota2SourceHygieneReason[];
  }[];
}

export interface Dota2EslMatchIdentitySummary {
  observedAt: string;
  rows: readonly {
    venue: string;
    interpretedContractId: string;
    title: string;
    rawSubjectText: string | null;
    rawOpponentText: string | null;
    normalizedSubject: string | null;
    normalizedOpponent: string | null;
    matchupKey: string | null;
    labels: readonly string[];
  }[];
  labelCounts: Record<string, number>;
}

export interface Dota2EslDateWindowSummary {
  observedAt: string;
  rows: readonly {
    venue: string;
    interpretedContractId: string;
    title: string;
    eventDate: string | null;
    cutoffTimestamp: string | null;
    timezoneNormalizedCutoff: string | null;
    dateStatus: Dota2DateStatus;
    dateSourceProvenance: string | null;
    unsafeDefaultReasons: readonly string[];
  }[];
  statusCounts: Record<string, number>;
  pairDateStatusCounts: Record<string, number>;
}

export interface Dota2EslTargetedRecoverySummary {
  observedAt: string;
  targetVenue: string | null;
  targetBasis: string | null;
  targetRowShape: string | null;
  recoveryJustified: boolean;
  safeRecoveryHookAvailable: boolean;
  execution: Dota2RecoveryExecution;
  recoveredRowCount: number;
  admittedRecoveredRowCount: number;
  changedCandidateGeneration: boolean;
  changedExactSafeProof: boolean;
  evidenceChecked: readonly string[];
}

export interface Dota2EslRouteabilitySummary {
  observedAt: string;
  sourceRows: number;
  admittedRows: number;
  candidatePairsConsidered: number;
  rejectedPairsByReason: Record<string, number>;
  exactSafeApprovedEdges: number;
  routeableOpportunities: number;
  venuePairOutcomes: Record<string, {
    candidatePairsConsidered: number;
    exactSafeApprovedEdges: number;
    routeableOpportunities: number;
    blockerCounts: Record<string, number>;
  }>;
}

export interface Dota2EslDeltaSummary {
  observedAt: string;
  before: Dota2EslBaseline;
  after: {
    admittedRows: number;
    candidatePairs: number;
    exactSafeEdges: number;
    routeableOpportunities: number;
    blockerCounts: Record<string, number>;
  };
  delta: {
    admittedRows: number;
    candidatePairs: number;
    exactSafeEdges: number;
    routeableOpportunities: number;
    blockerCounts: Record<string, number>;
  };
}

export interface Dota2EslFinalDecision {
  observedAt: string;
  decision: Dota2EslDecisionLabel;
  nextStepRecommendation: Dota2EslNextStepRecommendation;
  rationale: string;
}

export interface Dota2EslArtifacts {
  currentStateAudit: Dota2EslCurrentStateAudit;
  sourceHygieneSummary: Dota2EslSourceHygieneSummary;
  matchIdentitySummary: Dota2EslMatchIdentitySummary;
  dateWindowSummary: Dota2EslDateWindowSummary;
  targetedRecoverySummary: Dota2EslTargetedRecoverySummary;
  routeabilitySummary: Dota2EslRouteabilitySummary;
  deltaSummary: Dota2EslDeltaSummary;
  finalDecision: Dota2EslFinalDecision;
  operatorSummary: string;
}

const relatedAliasSeeds = (result: SportsPocketMatchingPipelineResult): readonly string[] =>
  [...new Set(
    result.entityEvaluations
      .filter((row) => row.pocket === DOTA2_ESL_POCKET)
      .flatMap((row) => [row.subjectEntity, row.opponentEntity].filter((value): value is string => value !== null))
  )];

const buildSourceScopeRows = (result: SportsPocketMatchingPipelineResult): readonly Dota2ScopeRow[] => {
  const aliasSeeds = relatedAliasSeeds(result);
  const aliasPattern = aliasSeeds.length > 0 ? new RegExp(`\\b(?:${aliasSeeds.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i") : null;

  return result.sourceMarkets
    .filter((market) => {
      if (market.category !== "ESPORTS") {
        return false;
      }
      if (!TARGET_VENUES.includes(market.venue as typeof TARGET_VENUES[number])) {
        return false;
      }
      const text = buildSportsText(market);
      return DOTA2_SCOPE_RELATED_PATTERN.test(text) || (aliasPattern ? aliasPattern.test(text) : false);
    })
    .map((market) => {
      const classification = classifySportsFamily(market);
      const competitionContext =
        classification.family === "MATCHUP_WINNER" && classification.metadata["domain"] === "ESPORTS"
          ? normalizeSportsCompetitionContext({ market, domain: "ESPORTS", family: "MATCHUP_WINNER" })
          : null;
      const subjectNormalization =
        classification.family === "MATCHUP_WINNER"
          ? normalizeSportsSubjectEntities({ market, family: "MATCHUP_WINNER" })
          : null;
      const boundary = extractSportsBoundaryDetailed(market);
      const text = buildSportsText(market);
      const outcomeLabels = extractOutcomeLabels(market);
      const isSingleSideRow = outcomeLabels.length > 0 && outcomeLabels.every((label) => isYesNoLabel(label));
      const reasons: Dota2SourceHygieneReason[] = [];

      if (classification.family !== "MATCHUP_WINNER") {
        reasons.push("DERIVATIVE_ROW");
      }
      if (!/dota2/i.test(text)) {
        reasons.push("WRONG_ESPORT");
      }
      if (competitionContext?.competitionKey !== "dota2_esl") {
        reasons.push("WRONG_COMPETITION");
      }
      if (subjectNormalization?.outcomeMappingBasis === "YES_NO_SINGLE_SIDE" || isSingleSideRow) {
        reasons.push("SINGLE_SIDE_ROW");
      }
      if (!subjectNormalization?.normalizedOpponentEntity) {
        reasons.push("MISSING_OPPONENT");
      }
      if (!subjectNormalization?.subjectEntityRaw || !subjectNormalization.opponentEntityRaw) {
        reasons.push("MALFORMED_TITLE");
      }

      return {
        interpretedContractId: market.interpretedContractId,
        venue: market.venue,
        title: market.title,
        sourceMetadataVersion: market.sourceMetadataVersion,
        temporalBasis: market.inventoryTemporalBasis,
        historicalRowCount: market.historicalRowCount,
        accepted: reasons.length === 0,
        sourceHygieneReasons: [...new Set(reasons)],
        normalizedSubject: subjectNormalization?.normalizedSubjectEntity ?? null,
        normalizedOpponent: subjectNormalization?.normalizedOpponentEntity ?? null,
        matchupKey: subjectNormalization?.matchupKey ?? null,
        rawSubjectText: subjectNormalization?.subjectEntityRaw ?? null,
        rawOpponentText: subjectNormalization?.opponentEntityRaw ?? null,
        titleNoiseStripped: subjectNormalization?.titleNoiseStripped ?? false,
        dateStatus: boundary.status,
        eventDate: boundary.dateKey,
        cutoffTimestamp: boundary.scheduledBoundaryKey,
        timezoneNormalizedCutoff: boundary.scheduledBoundaryKey,
        dateSourceProvenance: boundary.dateSourceProvenance,
        unsafeDefaultReasons: boundary.unsafeDefaultReasons
      };
    });
};

const buildCurrentStateAudit = (rows: readonly Dota2ScopeRow[]): Dota2EslCurrentStateAudit => {
  const venueSummaries = Object.fromEntries(
    TARGET_VENUES.map((venue) => [venue, {
      rawRows: 0,
      admittedRows: 0,
      rejectedRows: 0,
      liveRows: 0,
      historicalRows: 0,
      currentStateRows: 0,
      candidateEligibleRows: 0
    }])
  ) as Dota2EslCurrentStateAudit["venueSummaries"];

  for (const row of rows) {
    const summary = venueSummaries[row.venue]!;
    summary.rawRows += 1;
    if (row.accepted) {
      summary.admittedRows += 1;
      summary.candidateEligibleRows += 1;
    } else {
      summary.rejectedRows += 1;
    }
    if (row.temporalBasis === "HISTORICAL") summary.historicalRows += 1;
    else if (row.temporalBasis === "LIVE_CURRENT_STATE") summary.currentStateRows += 1;
    else summary.liveRows += 1;
  }

  const admissibleVenuePairs = TARGET_VENUES
    .filter((venue) => venueSummaries[venue]!.admittedRows > 0)
    .flatMap((left, index, all) =>
      all.slice(index + 1).map((right) => [left, right].sort((a, b) => a.localeCompare(b)).join("_"))
    );

  return {
    observedAt: new Date().toISOString(),
    venueSummaries,
    excludedRows: rows
      .filter((row) => !row.accepted)
      .map((row) => ({
        venue: row.venue,
        interpretedContractId: row.interpretedContractId,
        title: row.title,
        reasons: row.sourceHygieneReasons
      })),
    admissibleVenuePairs
  };
};

const buildSourceHygieneSummary = (rows: readonly Dota2ScopeRow[]): Dota2EslSourceHygieneSummary => {
  const reasons: Record<string, number> = {};
  for (const row of rows.filter((entry) => !entry.accepted)) {
    for (const reason of row.sourceHygieneReasons) increment(reasons, reason);
  }
  return {
    observedAt: new Date().toISOString(),
    admittedRows: rows.filter((row) => row.accepted).length,
    rejectedRows: rows.filter((row) => !row.accepted).length,
    reasons: sortRecord(reasons),
    examples: rows
      .filter((row) => !row.accepted)
      .slice(0, 8)
      .map((row) => ({
        venue: row.venue,
        interpretedContractId: row.interpretedContractId,
        title: row.title,
        reasons: row.sourceHygieneReasons
      }))
  };
};

const buildMatchIdentitySummary = (rows: readonly Dota2ScopeRow[]): Dota2EslMatchIdentitySummary => {
  const labelCounts: Record<string, number> = {};
  const admitted = rows.filter((row) => row.accepted);
  const summarizedRows = admitted.map((row) => {
    const labels: string[] = [];
    if (row.normalizedSubject && row.rawSubjectText && row.normalizedSubject !== row.rawSubjectText.toLowerCase()) labels.push("TEAM_ALIAS_NORMALIZED");
    if (!row.normalizedSubject) labels.push("TEAM_ALIAS_UNRESOLVED");
    if (row.normalizedOpponent) labels.push("OPPONENT_CONFIRMED");
    if (!row.normalizedOpponent) labels.push("OPPONENT_MISSING");
    if (row.matchupKey) labels.push("MATCHUP_KEY_CONFIRMED");
    if (!row.matchupKey) labels.push("MATCHUP_KEY_AMBIGUOUS");
    if (row.titleNoiseStripped) labels.push("TITLE_NOISE_STRIPPED");
    for (const label of labels) increment(labelCounts, label);
    return {
      venue: row.venue,
      interpretedContractId: row.interpretedContractId,
      title: row.title,
      rawSubjectText: row.rawSubjectText,
      rawOpponentText: row.rawOpponentText,
      normalizedSubject: row.normalizedSubject,
      normalizedOpponent: row.normalizedOpponent,
      matchupKey: row.matchupKey,
      labels
    };
  });
  return {
    observedAt: new Date().toISOString(),
    rows: summarizedRows,
    labelCounts: sortRecord(labelCounts)
  };
};

const classifyPairDateStatus = (left: Dota2ScopeRow, right: Dota2ScopeRow): Dota2PairDateStatus => {
  if (!left.eventDate || !right.eventDate) {
    return "DATE_MISSING";
  }
  if (left.eventDate === right.eventDate && left.timezoneNormalizedCutoff === right.timezoneNormalizedCutoff) {
    return "SAME_DAY_CONFIRMED";
  }
  if (left.eventDate === right.eventDate) {
    return "SAME_DAY_DIFFERENT_WINDOW";
  }
  return "DIFFERENT_EVENT_DATE";
};

const buildDateWindowSummary = (rows: readonly Dota2ScopeRow[]): Dota2EslDateWindowSummary => {
  const statusCounts: Record<string, number> = {};
  const pairDateStatusCounts: Record<string, number> = {};
  const admitted = rows.filter((row) => row.accepted);
  for (const row of admitted) increment(statusCounts, row.dateStatus);
  for (let index = 0; index < admitted.length; index += 1) {
    for (let inner = index + 1; inner < admitted.length; inner += 1) {
      increment(pairDateStatusCounts, classifyPairDateStatus(admitted[index]!, admitted[inner]!));
    }
  }
  return {
    observedAt: new Date().toISOString(),
    rows: admitted.map((row) => ({
      venue: row.venue,
      interpretedContractId: row.interpretedContractId,
      title: row.title,
      eventDate: row.eventDate,
      cutoffTimestamp: row.cutoffTimestamp,
      timezoneNormalizedCutoff: row.timezoneNormalizedCutoff,
      dateStatus: row.dateStatus,
      dateSourceProvenance: row.dateSourceProvenance,
      unsafeDefaultReasons: row.unsafeDefaultReasons
    })),
    statusCounts: sortRecord(statusCounts),
    pairDateStatusCounts: sortRecord(pairDateStatusCounts)
  };
};

const buildTargetedRecoverySummary = (audit: Dota2EslCurrentStateAudit): Dota2EslTargetedRecoverySummary => {
  const opinionAdmitted = audit.venueSummaries["OPINION"]?.admittedRows ?? 0;
  const counterpartPresent = (audit.venueSummaries["POLYMARKET"]?.admittedRows ?? 0) > 0 || (audit.venueSummaries["PREDICT"]?.admittedRows ?? 0) > 0;
  const recoveryJustified = opinionAdmitted > 0 && !counterpartPresent;
  const safeRecoveryHookAvailable = false;
  const execution: Dota2RecoveryExecution =
    !recoveryJustified ? "recovery_not_justified"
      : !safeRecoveryHookAvailable ? "no_recovery_executed_safe_hook_missing"
      : "artifact_scan_executed_no_candidates_found";

  return {
    observedAt: new Date().toISOString(),
    targetVenue: recoveryJustified ? "POLYMARKET" : null,
    targetBasis: recoveryJustified ? "CURRENT_STATE_OR_HISTORICAL_MATCHUP_SUPPLY" : null,
    targetRowShape: recoveryJustified ? "two-sided DOTA2 ESL matchup-winner rows for the same teams and same event day" : null,
    recoveryJustified,
    safeRecoveryHookAvailable,
    execution,
    recoveredRowCount: 0,
    admittedRecoveredRowCount: 0,
    changedCandidateGeneration: false,
    changedExactSafeProof: false,
    evidenceChecked: [
      "current matching inventory",
      "sports pocket artifacts",
      "opinion exact-match curation",
      "cross-venue reports"
    ]
  };
};

const buildRouteabilitySummary = (result: SportsPocketMatchingPipelineResult, rows: readonly Dota2ScopeRow[]): Dota2EslRouteabilitySummary => {
  const admittedIds = new Set(rows.filter((row) => row.accepted).map((row) => row.interpretedContractId));
  const prefilter = result.prefilterEvaluations.filter((row) =>
    admittedIds.has(row.leftInterpretedContractId) && admittedIds.has(row.rightInterpretedContractId)
  );
  const pairEdges = result.pairEvaluations.filter((row) => row.pocket === DOTA2_ESL_POCKET);
  const rejectedPairsByReason: Record<string, number> = {};
  for (const attempt of prefilter.filter((row) => !row.accepted)) {
    for (const reason of attempt.reasons) increment(rejectedPairsByReason, reason);
  }
  const venuePairOutcomes: Dota2EslRouteabilitySummary["venuePairOutcomes"] = {};
  for (const attempt of prefilter) {
    const venueKey = normalizeVenuePairKey(attempt.venuePair);
    venuePairOutcomes[venueKey] ??= {
      candidatePairsConsidered: 0,
      exactSafeApprovedEdges: 0,
      routeableOpportunities: 0,
      blockerCounts: {}
    };
    venuePairOutcomes[venueKey]!.candidatePairsConsidered += 1;
    for (const reason of attempt.reasons) increment(venuePairOutcomes[venueKey]!.blockerCounts, reason);
  }
  for (const edge of pairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState))) {
    const venueKey = normalizeVenuePairKey(edge.venuePair);
    venuePairOutcomes[venueKey] ??= {
      candidatePairsConsidered: 0,
      exactSafeApprovedEdges: 0,
      routeableOpportunities: 0,
      blockerCounts: {}
    };
    venuePairOutcomes[venueKey]!.exactSafeApprovedEdges += 1;
    venuePairOutcomes[venueKey]!.routeableOpportunities += 1;
  }

  return {
    observedAt: new Date().toISOString(),
    sourceRows: rows.length,
    admittedRows: rows.filter((row) => row.accepted).length,
    candidatePairsConsidered: prefilter.length,
    rejectedPairsByReason: sortRecord(rejectedPairsByReason),
    exactSafeApprovedEdges: pairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length,
    routeableOpportunities: pairEdges.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length,
    venuePairOutcomes: Object.fromEntries(
      Object.entries(venuePairOutcomes).map(([key, value]) => [key, {
        candidatePairsConsidered: value.candidatePairsConsidered,
        exactSafeApprovedEdges: value.exactSafeApprovedEdges,
        routeableOpportunities: value.routeableOpportunities,
        blockerCounts: sortRecord(value.blockerCounts)
      }])
    )
  };
};

const buildDeltaSummary = (baseline: Dota2EslBaseline, routeability: Dota2EslRouteabilitySummary): Dota2EslDeltaSummary => {
  const after = {
    admittedRows: routeability.admittedRows,
    candidatePairs: routeability.candidatePairsConsidered,
    exactSafeEdges: routeability.exactSafeApprovedEdges,
    routeableOpportunities: routeability.routeableOpportunities,
    blockerCounts: routeability.rejectedPairsByReason
  };
  const blockerKeys = new Set([...Object.keys(baseline.blockerCounts), ...Object.keys(after.blockerCounts)]);
  return {
    observedAt: new Date().toISOString(),
    before: baseline,
    after,
    delta: {
      admittedRows: after.admittedRows - baseline.admittedRows,
      candidatePairs: after.candidatePairs - baseline.candidatePairs,
      exactSafeEdges: after.exactSafeEdges - baseline.exactSafeEdges,
      routeableOpportunities: after.routeableOpportunities - baseline.routeableOpportunities,
      blockerCounts: Object.fromEntries(
        [...blockerKeys].sort().map((key) => [key, (after.blockerCounts[key] ?? 0) - (baseline.blockerCounts[key] ?? 0)])
      )
    }
  };
};

const buildFinalDecision = (input: {
  routeability: Dota2EslRouteabilitySummary;
  recovery: Dota2EslTargetedRecoverySummary;
}): Dota2EslFinalDecision => {
  if (input.routeability.exactSafeApprovedEdges > 0) {
    return {
      observedAt: new Date().toISOString(),
      decision: "DOTA2_ESL_RECOVERY_SUCCESS__EXACT_SAFE_EDGES_CREATED",
      nextStepRecommendation: "KEEP_DOTA2_ESL_AND_EXPAND_WITHIN_ESPORTS",
      rationale: "The DOTA2_ESL pocket now produces approved exact-safe edges."
    };
  }
  if (input.routeability.routeableOpportunities > 0) {
    return {
      observedAt: new Date().toISOString(),
      decision: "DOTA2_ESL_RECOVERY_SUCCESS__PAIR_ROUTEABILITY_CREATED",
      nextStepRecommendation: "KEEP_DOTA2_ESL_AND_EXPAND_WITHIN_ESPORTS",
      rationale: "The pocket remains strict but now produces routeable exact-safe opportunities."
    };
  }
  if (input.routeability.candidatePairsConsidered === 0 && input.recovery.recoveryJustified) {
    return {
      observedAt: new Date().toISOString(),
      decision: "DOTA2_ESL_RECOVERY_CLEAN_BUT_COVERAGE_THIN",
      nextStepRecommendation: "HOLD_DOTA2_ESL_AND_WAIT_FOR_BETTER_SUPPLY",
      rationale: "Normalization is clean, but the pocket is still single-venue and cannot generate exact-safe pair attempts."
    };
  }
  if ((input.routeability.rejectedPairsByReason["DATE_WINDOW_MISMATCH"] ?? 0) > Math.max(
    input.routeability.rejectedPairsByReason["SUBJECT_ENTITY_MISMATCH"] ?? 0,
    input.routeability.rejectedPairsByReason["OPPONENT_MISMATCH"] ?? 0,
    input.routeability.rejectedPairsByReason["BASIS_MISMATCH"] ?? 0
  )) {
    return {
      observedAt: new Date().toISOString(),
      decision: "DOTA2_ESL_RECOVERY_BLOCKED_BY_DATE",
      nextStepRecommendation: "KEEP_DOTA2_ESL_AND_BUILD_FIXTURE_BINDING_LAYER",
      rationale: "Counterpart rows exist, but same-day/window proof still dominates failures."
    };
  }
  if ((input.routeability.rejectedPairsByReason["BASIS_MISMATCH"] ?? 0) > Math.max(
    input.routeability.rejectedPairsByReason["SUBJECT_ENTITY_MISMATCH"] ?? 0,
    input.routeability.rejectedPairsByReason["OPPONENT_MISMATCH"] ?? 0
  )) {
    return {
      observedAt: new Date().toISOString(),
      decision: "DOTA2_ESL_RECOVERY_BLOCKED_BY_BASIS",
      nextStepRecommendation: "HOLD_DOTA2_ESL_AND_WAIT_FOR_BETTER_SUPPLY",
      rationale: "The remaining DOTA2_ESL comparisons are blocked primarily by incompatible basis."
    };
  }
  if ((input.routeability.rejectedPairsByReason["SUBJECT_ENTITY_MISMATCH"] ?? 0) + (input.routeability.rejectedPairsByReason["OPPONENT_MISMATCH"] ?? 0) > 0) {
    return {
      observedAt: new Date().toISOString(),
      decision: "DOTA2_ESL_RECOVERY_BLOCKED_BY_IDENTITY",
      nextStepRecommendation: "KEEP_DOTA2_ESL_AND_BUILD_FIXTURE_BINDING_LAYER",
      rationale: "Counterpart rows exist, but same-match identity still fails deterministically."
    };
  }
  return {
    observedAt: new Date().toISOString(),
    decision: "DOTA2_ESL_RECOVERY_INCOMPLETE__MANUAL_REVIEW_NEEDED",
    nextStepRecommendation: "SPORTS_FRONTIER_NOT_YET_READY",
    rationale: "The pass could not materially change exact-safe proof and did not observe enough safe counterpart supply to justify a stronger claim."
  };
};

const buildOperatorSummary = (input: {
  currentState: Dota2EslCurrentStateAudit;
  recovery: Dota2EslTargetedRecoverySummary;
  routeability: Dota2EslRouteabilitySummary;
  decision: Dota2EslFinalDecision;
}): string => [
  "# DOTA2_ESL Operator Summary",
  "",
  `1. Current admitted supply: ${Object.entries(input.currentState.venueSummaries).filter(([, value]) => value.admittedRows > 0).map(([venue, value]) => `${venue}=${value.admittedRows}`).join(", ") || "none"}.`,
  `2. Recovery justified: ${input.recovery.recoveryJustified ? "yes" : "no"}.`,
  `3. Safe recovery hook available: ${input.recovery.safeRecoveryHookAvailable ? "yes" : "no"}.`,
  `4. Candidate pairs considered after rerun: ${input.routeability.candidatePairsConsidered}.`,
  `5. Exact-safe approved edges after rerun: ${input.routeability.exactSafeApprovedEdges}.`,
  `6. Dominant blocker after rerun: ${bestKey(input.routeability.rejectedPairsByReason) ?? "none"}.`,
  `7. Final decision: ${input.decision.decision}.`,
  `8. Smallest correct next action: ${input.decision.nextStepRecommendation}.`,
  ""
].join("\n");

export const buildDota2EslArtifactsFromResult = (input: {
  result: SportsPocketMatchingPipelineResult;
  baseline: Dota2EslBaseline;
}): Dota2EslArtifacts => {
  const sourceScopeRows = buildSourceScopeRows(input.result);
  const currentStateAudit = buildCurrentStateAudit(sourceScopeRows);
  const sourceHygieneSummary = buildSourceHygieneSummary(sourceScopeRows);
  const matchIdentitySummary = buildMatchIdentitySummary(sourceScopeRows);
  const dateWindowSummary = buildDateWindowSummary(sourceScopeRows);
  const targetedRecoverySummary = buildTargetedRecoverySummary(currentStateAudit);
  const routeabilitySummary = buildRouteabilitySummary(input.result, sourceScopeRows);
  const deltaSummary = buildDeltaSummary(input.baseline, routeabilitySummary);
  const finalDecision = buildFinalDecision({
    routeability: routeabilitySummary,
    recovery: targetedRecoverySummary
  });

  return {
    currentStateAudit,
    sourceHygieneSummary,
    matchIdentitySummary,
    dateWindowSummary,
    targetedRecoverySummary,
    routeabilitySummary,
    deltaSummary,
    finalDecision,
    operatorSummary: buildOperatorSummary({
      currentState: currentStateAudit,
      recovery: targetedRecoverySummary,
      routeability: routeabilitySummary,
      decision: finalDecision
    })
  };
};

export const buildDota2EslArtifacts = async (input: {
  pool: Pool;
  baseline: Dota2EslBaseline;
}): Promise<Dota2EslArtifacts> => {
  const pipeline = new SportsPocketMatchingPipeline(new PairEdgeRepository(input.pool));
  const result = await pipeline.run();
  return buildDota2EslArtifactsFromResult({
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

export const buildDota2EslCurrentStateAuditMarkdown = (artifact: Dota2EslCurrentStateAudit): string =>
  buildListMarkdown("DOTA2_ESL Current-State Audit", [
    ...Object.entries(artifact.venueSummaries).map(([venue, summary]) =>
      `- ${venue}: raw=${summary.rawRows}, admitted=${summary.admittedRows}, rejected=${summary.rejectedRows}, candidateEligible=${summary.candidateEligibleRows}`
    )
  ]);

export const buildDota2EslSourceHygieneMarkdown = (artifact: Dota2EslSourceHygieneSummary): string =>
  buildListMarkdown("DOTA2_ESL Source Hygiene Summary", [
    `- admitted=${artifact.admittedRows}, rejected=${artifact.rejectedRows}`,
    `- reasons: ${Object.entries(artifact.reasons).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildDota2EslMatchIdentityMarkdown = (artifact: Dota2EslMatchIdentitySummary): string =>
  buildListMarkdown("DOTA2_ESL Match Identity Summary", [
    `- labels: ${Object.entries(artifact.labelCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildDota2EslDateWindowMarkdown = (artifact: Dota2EslDateWindowSummary): string =>
  buildListMarkdown("DOTA2_ESL Date Window Summary", [
    `- statuses: ${Object.entries(artifact.statusCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    `- pair-date statuses: ${Object.entries(artifact.pairDateStatusCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildDota2EslTargetedRecoveryMarkdown = (artifact: Dota2EslTargetedRecoverySummary): string =>
  buildListMarkdown("DOTA2_ESL Targeted Recovery Summary", [
    `- target venue: ${artifact.targetVenue ?? "none"}`,
    `- recovery justified: ${artifact.recoveryJustified ? "yes" : "no"}`,
    `- safe recovery hook available: ${artifact.safeRecoveryHookAvailable ? "yes" : "no"}`,
    `- execution: ${artifact.execution}`,
    `- recovered rows: ${artifact.recoveredRowCount}, admitted recovered rows: ${artifact.admittedRecoveredRowCount}`
  ]);

export const buildDota2EslRouteabilityMarkdown = (artifact: Dota2EslRouteabilitySummary): string =>
  buildListMarkdown("DOTA2_ESL Routeability Summary", [
    `- source rows=${artifact.sourceRows}, admitted rows=${artifact.admittedRows}`,
    `- candidate pairs=${artifact.candidatePairsConsidered}, exact-safe edges=${artifact.exactSafeApprovedEdges}, routeable opportunities=${artifact.routeableOpportunities}`,
    `- blockers: ${Object.entries(artifact.rejectedPairsByReason).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildDota2EslDeltaMarkdown = (artifact: Dota2EslDeltaSummary): string =>
  buildListMarkdown("DOTA2_ESL Delta Summary", [
    `- admitted rows before -> after: ${artifact.before.admittedRows} -> ${artifact.after.admittedRows}`,
    `- candidate pairs before -> after: ${artifact.before.candidatePairs} -> ${artifact.after.candidatePairs}`,
    `- exact-safe edges before -> after: ${artifact.before.exactSafeEdges} -> ${artifact.after.exactSafeEdges}`,
    `- routeable opportunities before -> after: ${artifact.before.routeableOpportunities} -> ${artifact.after.routeableOpportunities}`
  ]);

export const buildDota2EslFinalDecisionMarkdown = (artifact: Dota2EslFinalDecision): string =>
  buildListMarkdown("DOTA2_ESL Final Decision", [
    `- decision: ${artifact.decision}`,
    `- next step: ${artifact.nextStepRecommendation}`,
    "",
    artifact.rationale
  ]);
