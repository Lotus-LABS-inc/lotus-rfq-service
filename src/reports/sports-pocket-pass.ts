import { pairLabelRouteEligibility } from "../matching/match-labels.js";
import {
  SportsPocketMatchingPipeline,
  type SportsPocketAdmissionEvaluation,
  type SportsPocketDateEvaluation,
  type SportsPocketEntityEvaluation,
  type SportsPocketMatchingPipelineResult,
  type SportsPocketOutcomeEvaluation
} from "../matching/sports/sports-pocket-matching-pipeline.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import type { Pool } from "pg";
import { detectEvidenceLabel } from "../operations/semantic-expansion/shared.js";

import type {
  CryptoMultiAssetGraphSummary,
  CryptoMultiAssetPairRouteabilitySummary
} from "./crypto-multi-asset-expansion.js";
import type {
  SportsFamilyGraphSummary,
  SportsFamilyPairRouteabilitySummary
} from "./sports-family-pass.js";

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const incrementNested = (target: Record<string, Record<string, number>>, key: string, nestedKey: string): void => {
  target[key] ??= {};
  increment(target[key]!, nestedKey);
};

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])));

const sortNested = (value: Record<string, Record<string, number>>): Record<string, Record<string, number>> =>
  Object.fromEntries(
    Object.entries(value)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, nested]) => [key, sortRecord(nested)])
  );

const subtractRecord = (after: Record<string, number>, before: Record<string, number>): Record<string, number> => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...keys].sort().map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]));
};

const buildVenuePairKey = (value: string): string => value.replace("|", "_");

const bestRecordKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const SPORTS_POCKETS = [
  "SPORTS|MATCHUP_WINNER|NBA",
  "ESPORTS|MATCHUP_WINNER|DOTA2_ESL",
  "ESPORTS|MATCHUP_WINNER|KPL",
  "ESPORTS|MATCHUP_WINNER|LCK"
] as const;

const SPORTS_POCKET_VENUES = ["POLYMARKET", "LIMITLESS", "OPINION", "PREDICT"] as const;

const toBasisBucket = (sourceMetadataVersion: string, historicalRowCount: number): "LIVE" | "HISTORICAL" | "CURRENT_STATE" => {
  const evidenceLabel = detectEvidenceLabel({ sourceMetadataVersion, historicalRowCount });
  return evidenceLabel === "historical" ? "HISTORICAL"
    : evidenceLabel === "current_state" ? "CURRENT_STATE"
    : "LIVE";
};

export interface SportsPocketAdmissionSummary {
  observedAt: string;
  admittedCountsByPocket: Record<string, number>;
  rejectedCountsByReason: Record<string, number>;
  ambiguityFlags: Record<string, number>;
}

export interface SportsPocketEntitySummary {
  observedAt: string;
  admittedEntityCountsByPocket: Record<string, number>;
  blockerCounts: Record<string, number>;
}

export interface SportsPocketDateWindowSummary {
  observedAt: string;
  admittedDateCountsByPocket: Record<string, number>;
  blockerCounts: Record<string, number>;
  provenanceCounts: Record<string, number>;
}

export interface SportsPocketOutcomeStructureSummary {
  observedAt: string;
  acceptedCountsByOutcomeBasis: Record<string, number>;
  blockerCounts: Record<string, number>;
}

export interface SportsPocketPrefilterSummary {
  observedAt: string;
  candidatePairsConsidered: number;
  acceptedPairs: number;
  blockerReasons: Record<string, number>;
  blockerReasonsByPocket: Record<string, Record<string, number>>;
}

export interface SportsPocketEdgeSummary {
  observedAt: string;
  perPocket: Record<string, {
    admittedRows: number;
    candidatePairsConsidered: number;
    exactSafeEdgesPersisted: number;
    exactSafeEdgesApproved: number;
    labels: Record<string, number>;
    dominantBlockers: Record<string, number>;
    venuePairs: Record<string, number>;
  }>;
}

export interface SportsPocketRouteabilitySummary {
  observedAt: string;
  exactSafeApprovedEdges: number;
  pairEdges: number;
  pairRouteableOpportunities: number;
  bestPerformingPocket: string | null;
  bestPerformingVenuePair: string | null;
  exactSafePairsByPocket: Record<string, number>;
  exactSafePairsByVenuePair: Record<string, number>;
}

export interface SportsPocketDeltaSummary {
  observedAt: string;
  before: {
    exactSafeApprovedEdges: number;
    pairEdges: number;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
  after: {
    exactSafeApprovedEdges: number;
    pairEdges: number;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
  delta: {
    exactSafeApprovedEdges: number;
    pairEdges: number;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
}

export type SportsPocketDecisionLabel =
  | "SPORTS_POCKET_PASS_SUCCESS__STAY_ON_MATCHUP_POCKETS"
  | "SPORTS_POCKET_PASS_MODEST__ONE_MORE_POCKET"
  | "SPORTS_POCKET_PASS_NOISY__TIGHTEN_POCKET_RULES"
  | "SPORTS_POCKET_PASS_FLAT__SPORTS_FRONTIER_EXHAUSTED";

export interface SportsPocketNextStepDecision {
  observedAt: string;
  decision: SportsPocketDecisionLabel;
  rationale: string;
  bestPerformingPocket: string | null;
  bestPerformingVenuePair: string | null;
  sportsNowBeatsCrypto: boolean;
}

export interface SportsPocketSourceHygieneSummary {
  observedAt: string;
  rejectedRows: number;
  reasons: Record<string, number>;
  examples: readonly {
    venue: string;
    venueMarketId: string;
    title: string;
    reasons: readonly string[];
  }[];
}

export type SportsPocketCoverageLabel =
  | "VENUE_ABSENT"
  | "VENUE_PRESENT_BUT_REJECTED"
  | "VENUE_PRESENT_BUT_NON_COMPARABLE_BASIS"
  | "VENUE_PRESENT_BUT_NO_MATCHUP_IDENTITY"
  | "VENUE_PRESENT_BUT_NO_DATE_WINDOW"
  | "VENUE_PRESENT_AND_CANDIDATE_ELIGIBLE";

export interface SportsPocketCoverageMatrix {
  observedAt: string;
  pockets: Record<string, {
    venues: Record<string, {
      rawRowCount: number;
      admittedRowCount: number;
      rejectedRowCount: number;
      liveCount: number;
      historicalCount: number;
      currentStateCount: number;
      mixedBasisCount: number;
      usableSubjectOpponentCount: number;
      usableDateWindowCount: number;
      usableBinarySideMappingCount: number;
      candidateEligibleCount: number;
      coverageLabel: SportsPocketCoverageLabel;
    }>;
  }>;
}

export type SportsPocketBasisLabel =
  | "BASIS_FRAGMENTED"
  | "LIVE_ONLY_WITHOUT_COUNTERPART"
  | "HISTORICAL_ONLY_WITHOUT_COUNTERPART"
  | "CURRENT_STATE_ONLY_WITHOUT_COUNTERPART"
  | "BASIS_COMPARABLE";

export interface SportsPocketBasisSummary {
  observedAt: string;
  pockets: Record<string, {
    venues: Record<string, {
      basisCounts: Record<string, number>;
      comparableCounterpartVenues: readonly string[];
      label: SportsPocketBasisLabel | null;
    }>;
  }>;
}

export interface SportsPocketMatchIdentitySummary {
  observedAt: string;
  perPocket: Record<string, {
    rows: readonly {
      interpretedContractId: string;
      venue: string;
      title: string;
      rawSubjectText: string | null;
      rawOpponentText: string | null;
      normalizedSubject: string | null;
      normalizedOpponent: string | null;
      matchupKey: string | null;
      blockers: readonly string[];
      teamVsTeamDeterministic: boolean;
    }[];
    pairRootCauseCounts: Record<string, number>;
  }>;
}

export interface SportsPocketDateRootCauseSummary {
  observedAt: string;
  perPocket: Record<string, {
    rows: readonly {
      interpretedContractId: string;
      venue: string;
      title: string;
      eventDate: string | null;
      cutoffTimestamp: string | null;
      timezoneNormalizedCutoff: string | null;
      dateWindowBucket: string | null;
      dateSourceProvenance: string | null;
      confidence: string;
      blockers: readonly string[];
    }[];
    pairRootCauseCounts: Record<string, number>;
  }>;
}

export type SportsPocketDominantClass =
  | "COVERAGE_THIN"
  | "BASIS_FRAGMENTED"
  | "MATCH_IDENTITY_NOISY"
  | "DATE_ALIGNMENT_NOISY"
  | "OUTCOME_STRUCTURE_NOISY"
  | "MIXED_BUT_PROMISING"
  | "LOW_SIGNAL_POCKET";

export type SportsPocketRecoveryLabel =
  | "NO_RECOVERY_JUSTIFIED"
  | "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED"
  | "TARGETED_HISTORICAL_BACKFILL_JUSTIFIED"
  | "TARGETED_LIVE_INGESTION_JUSTIFIED"
  | "NORMALIZATION_BEFORE_RECOVERY"
  | "HOLD_PENDING_PARTNER_DATA";

export interface SportsPocketRootCauseClassifier {
  observedAt: string;
  pockets: Record<string, {
    dominantClass: SportsPocketDominantClass;
    secondaryClass: SportsPocketDominantClass | null;
    exactSafePlausibleWithTargetedRecovery: boolean;
    moreIngestionLikelyUseful: boolean;
    tighterNormalizationHigherRoi: boolean;
    rationale: string;
  }>;
}

export interface SportsPocketTargetedRecoveryPlan {
  observedAt: string;
  pockets: Record<string, {
    recommendation: SportsPocketRecoveryLabel;
    missingVenue: string | null;
    missingBasis: string | null;
    missingRowShape: string | null;
    rationale: string;
  }>;
}

export type SportsPocketPriorityLabel =
  | "TIGHTEN_DOTA2_ESL_MATCH_IDENTITY"
  | "TARGETED_RECOVERY_DOTA2_ESL"
  | "TIGHTEN_NBA_MATCH_IDENTITY"
  | "TARGETED_RECOVERY_NBA"
  | "HOLD_KPL_LOW_DEPTH"
  | "HOLD_LCK_ZERO_ADMISSION"
  | "SPORTS_PAUSE_RETURN_TO_OTHER_FRONTIER";

export interface SportsPocketPriorityRecommendation {
  observedAt: string;
  primaryRecommendation: SportsPocketPriorityLabel;
  secondaryRecommendation: SportsPocketPriorityLabel | null;
  rationale: string;
}

export type SportsPocketFinalDecisionLabel =
  | "SPORTS_COVERAGE_GAP_CONFIRMED__TARGETED_RECOVERY_JUSTIFIED"
  | "SPORTS_IDENTITY_GAP_DOMINANT__TIGHTEN_MATCH_INSTANCE_RULES"
  | "SPORTS_MIXED_GAPS__RECOVER_ONE_POCKET_AND_TIGHTEN_ONE_POCKET"
  | "SPORTS_FRONTIER_LOW_ROI__HOLD_AND_RETURN_LATER";

export interface SportsPocketFinalDecision {
  observedAt: string;
  decision: SportsPocketFinalDecisionLabel;
  rationale: string;
  coverageScarcityAssessment: "CONFIRMED" | "PARTIALLY_CONFIRMED" | "NOT_SUPPORTED";
  broadIngestionJustifiedNow: boolean;
  highestRoiNextAction: SportsPocketPriorityLabel;
}

export interface SportsPocketPassArtifacts {
  admissionSummary: SportsPocketAdmissionSummary;
  entitySummary: SportsPocketEntitySummary;
  dateWindowSummary: SportsPocketDateWindowSummary;
  outcomeStructureSummary: SportsPocketOutcomeStructureSummary;
  prefilterSummary: SportsPocketPrefilterSummary;
  edgeSummary: SportsPocketEdgeSummary;
  routeabilitySummary: SportsPocketRouteabilitySummary;
  deltaVsPriorSports: SportsPocketDeltaSummary;
  deltaVsCrypto: SportsPocketDeltaSummary;
  sourceHygieneSummary: SportsPocketSourceHygieneSummary;
  coverageMatrix: SportsPocketCoverageMatrix;
  basisSummary: SportsPocketBasisSummary;
  matchIdentitySummary: SportsPocketMatchIdentitySummary;
  dateRootCauseSummary: SportsPocketDateRootCauseSummary;
  rootCauseClassifier: SportsPocketRootCauseClassifier;
  targetedRecoveryPlan: SportsPocketTargetedRecoveryPlan;
  priorityRecommendation: SportsPocketPriorityRecommendation;
  decision: SportsPocketNextStepDecision;
  finalDecision: SportsPocketFinalDecision;
  operatorSummary: string;
}

const buildAdmissionSummary = (result: SportsPocketMatchingPipelineResult): SportsPocketAdmissionSummary => {
  const admittedCountsByPocket: Record<string, number> = {};
  const rejectedCountsByReason: Record<string, number> = {};
  const ambiguityFlags: Record<string, number> = {};

  for (const entry of result.admissionEvaluations) {
    if (entry.accepted && entry.pocket) {
      increment(admittedCountsByPocket, entry.pocket);
    } else {
      for (const reason of entry.rejectionReasons) {
        increment(rejectedCountsByReason, reason);
      }
    }
    for (const flag of entry.classification.ambiguityFlags) {
      increment(ambiguityFlags, flag);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    admittedCountsByPocket: sortRecord(admittedCountsByPocket),
    rejectedCountsByReason: sortRecord(rejectedCountsByReason),
    ambiguityFlags: sortRecord(ambiguityFlags)
  };
};

const buildEntitySummary = (result: SportsPocketMatchingPipelineResult): SportsPocketEntitySummary => {
  const admittedEntityCountsByPocket: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};

  for (const entry of result.entityEvaluations) {
    if (entry.accepted && entry.pocket) {
      increment(admittedEntityCountsByPocket, entry.pocket);
      continue;
    }
    for (const blocker of entry.blockers) {
      increment(blockerCounts, blocker);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    admittedEntityCountsByPocket: sortRecord(admittedEntityCountsByPocket),
    blockerCounts: sortRecord(blockerCounts)
  };
};

const buildDateWindowSummary = (result: SportsPocketMatchingPipelineResult): SportsPocketDateWindowSummary => {
  const admittedDateCountsByPocket: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};
  const provenanceCounts: Record<string, number> = {};

  for (const entry of result.dateEvaluations) {
    if (entry.accepted && entry.pocket) {
      increment(admittedDateCountsByPocket, entry.pocket);
      if (entry.dateSourceProvenance) {
        increment(provenanceCounts, entry.dateSourceProvenance);
      }
      continue;
    }
    for (const blocker of entry.blockers) {
      increment(blockerCounts, blocker);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    admittedDateCountsByPocket: sortRecord(admittedDateCountsByPocket),
    blockerCounts: sortRecord(blockerCounts),
    provenanceCounts: sortRecord(provenanceCounts)
  };
};

const buildOutcomeStructureSummary = (result: SportsPocketMatchingPipelineResult): SportsPocketOutcomeStructureSummary => {
  const acceptedCountsByOutcomeBasis: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};

  for (const entry of result.outcomeEvaluations) {
    if (entry.accepted && entry.outcomeMappingBasis) {
      increment(acceptedCountsByOutcomeBasis, entry.outcomeMappingBasis);
      continue;
    }
    for (const blocker of entry.blockers) {
      increment(blockerCounts, blocker);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    acceptedCountsByOutcomeBasis: sortRecord(acceptedCountsByOutcomeBasis),
    blockerCounts: sortRecord(blockerCounts)
  };
};

const extractRawMatchSides = (title: string): { subject: string | null; opponent: string | null } => {
  const parts = title.split(/\bvs\.?\b|\bversus\b/i).map((value) => value.trim());
  if (parts.length < 2) {
    return { subject: null, opponent: null };
  }
  return {
    subject: parts[0]?.replace(/^[^:]+:\s*/i, "").trim() || null,
    opponent: parts[1]?.trim() || null
  };
};

const buildCoverageMatrix = (result: SportsPocketMatchingPipelineResult): SportsPocketCoverageMatrix => {
  const readyIds = new Set(result.pocketMarkets.map((market) => market.interpretedContractId));
  const entityAcceptedIds = new Set(
    result.entityEvaluations.filter((entry) => entry.accepted).map((entry) => entry.market.interpretedContractId)
  );
  const dateAcceptedIds = new Set(
    result.dateEvaluations.filter((entry) => entry.accepted).map((entry) => entry.market.interpretedContractId)
  );
  const outcomeAcceptedIds = new Set(
    result.outcomeEvaluations.filter((entry) => entry.accepted).map((entry) => entry.market.interpretedContractId)
  );

  const admissionById = new Map(result.admissionEvaluations.map((entry) => [entry.market.interpretedContractId, entry] as const));
  const pockets: SportsPocketCoverageMatrix["pockets"] = {};

  for (const pocket of SPORTS_POCKETS) {
    pockets[pocket] = { venues: {} };
    for (const venue of SPORTS_POCKET_VENUES) {
      pockets[pocket]!.venues[venue] = {
        rawRowCount: 0,
        admittedRowCount: 0,
        rejectedRowCount: 0,
        liveCount: 0,
        historicalCount: 0,
        currentStateCount: 0,
        mixedBasisCount: 0,
        usableSubjectOpponentCount: 0,
        usableDateWindowCount: 0,
        usableBinarySideMappingCount: 0,
        candidateEligibleCount: 0,
        coverageLabel: "VENUE_ABSENT"
      };
    }
  }

  for (const entry of result.admissionEvaluations) {
    const pocket = entry.pocket;
    if (!pocket || !(SPORTS_POCKETS as readonly string[]).includes(pocket)) {
      continue;
    }
    const venueSummary = pockets[pocket]!.venues[entry.market.venue]!;
    venueSummary.rawRowCount += 1;
    const basisBucket = toBasisBucket(entry.market.sourceMetadataVersion, entry.market.historicalRowCount);
    if (basisBucket === "LIVE") {
      venueSummary.liveCount += 1;
    } else if (basisBucket === "HISTORICAL") {
      venueSummary.historicalCount += 1;
    } else {
      venueSummary.currentStateCount += 1;
      venueSummary.mixedBasisCount += 1;
    }
    if (entry.accepted) {
      venueSummary.admittedRowCount += 1;
    } else {
      venueSummary.rejectedRowCount += 1;
    }
    const contractId = entry.market.interpretedContractId;
    if (entityAcceptedIds.has(contractId)) {
      venueSummary.usableSubjectOpponentCount += 1;
    }
    if (dateAcceptedIds.has(contractId)) {
      venueSummary.usableDateWindowCount += 1;
    }
    if (outcomeAcceptedIds.has(contractId)) {
      venueSummary.usableBinarySideMappingCount += 1;
    }
    if (readyIds.has(contractId)) {
      venueSummary.candidateEligibleCount += 1;
    }
  }

  for (const pocket of SPORTS_POCKETS) {
    const venueEntries = Object.entries(pockets[pocket]!.venues);
    const comparableVenues = venueEntries.filter(([, value]) => value.candidateEligibleCount > 0).map(([venue]) => venue);
    for (const [venue, summary] of venueEntries) {
      summary.coverageLabel =
        summary.rawRowCount === 0 ? "VENUE_ABSENT"
        : summary.candidateEligibleCount > 0 ? "VENUE_PRESENT_AND_CANDIDATE_ELIGIBLE"
        : summary.usableDateWindowCount === 0 && summary.admittedRowCount > 0 ? "VENUE_PRESENT_BUT_NO_DATE_WINDOW"
        : summary.usableSubjectOpponentCount === 0 && summary.admittedRowCount > 0 ? "VENUE_PRESENT_BUT_NO_MATCHUP_IDENTITY"
        : comparableVenues.length === 0 && summary.rawRowCount > 0 ? "VENUE_PRESENT_BUT_NON_COMPARABLE_BASIS"
        : "VENUE_PRESENT_BUT_REJECTED";
      pockets[pocket]!.venues[venue] = summary;
    }
  }

  return {
    observedAt: new Date().toISOString(),
    pockets
  };
};

const buildBasisSummary = (coverageMatrix: SportsPocketCoverageMatrix): SportsPocketBasisSummary => {
  const pockets: SportsPocketBasisSummary["pockets"] = {};

  for (const pocket of SPORTS_POCKETS) {
    pockets[pocket] = { venues: {} };
    const venueSummaries = coverageMatrix.pockets[pocket]?.venues ?? {};
    const candidates = Object.entries(venueSummaries)
      .filter(([, value]) => value.candidateEligibleCount > 0)
      .map(([venue]) => venue);

    for (const venue of SPORTS_POCKET_VENUES) {
      const summary = venueSummaries[venue]!;
      const basisCounts = sortRecord({
        LIVE: summary.liveCount,
        HISTORICAL: summary.historicalCount,
        CURRENT_STATE: summary.currentStateCount
      });
      const comparableCounterpartVenues = candidates.filter((candidateVenue) => candidateVenue !== venue);
      const label: SportsPocketBasisLabel | null =
        summary.rawRowCount === 0 ? null
        : comparableCounterpartVenues.length > 0 ? "BASIS_COMPARABLE"
        : summary.historicalCount > 0 && summary.liveCount === 0 && summary.currentStateCount === 0 ? "HISTORICAL_ONLY_WITHOUT_COUNTERPART"
        : summary.currentStateCount > 0 && summary.liveCount === 0 && summary.historicalCount === 0 ? "CURRENT_STATE_ONLY_WITHOUT_COUNTERPART"
        : summary.liveCount > 0 && summary.historicalCount === 0 && summary.currentStateCount === 0 ? "LIVE_ONLY_WITHOUT_COUNTERPART"
        : "BASIS_FRAGMENTED";
      pockets[pocket]!.venues[venue] = {
        basisCounts,
        comparableCounterpartVenues,
        label
      };
    }
  }

  return {
    observedAt: new Date().toISOString(),
    pockets
  };
};

const buildMatchIdentitySummary = (result: SportsPocketMatchingPipelineResult): SportsPocketMatchIdentitySummary => {
  const perPocket: SportsPocketMatchIdentitySummary["perPocket"] = {};
  const admissionById = new Map(result.admissionEvaluations.map((entry) => [entry.market.interpretedContractId, entry] as const));

  for (const pocket of SPORTS_POCKETS) {
    perPocket[pocket] = { rows: [], pairRootCauseCounts: {} };
  }

  for (const entry of result.entityEvaluations) {
    const admission = admissionById.get(entry.market.interpretedContractId);
    const pocket = admission?.pocket;
    if (!pocket || !(SPORTS_POCKETS as readonly string[]).includes(pocket)) {
      continue;
    }
    const rawSides = extractRawMatchSides(entry.market.title);
    perPocket[pocket]!.rows = [
      ...perPocket[pocket]!.rows,
      {
        interpretedContractId: entry.market.interpretedContractId,
        venue: entry.market.venue,
        title: entry.market.title,
        rawSubjectText: rawSides.subject,
        rawOpponentText: rawSides.opponent,
        normalizedSubject: entry.subjectEntity,
        normalizedOpponent: entry.opponentEntity,
        matchupKey: entry.matchupKey,
        blockers: entry.blockers,
        teamVsTeamDeterministic: entry.accepted && entry.matchupKey !== null
      }
    ];
  }

  for (const entry of result.prefilterEvaluations) {
    if (!(SPORTS_POCKETS as readonly string[]).includes(entry.pocket)) {
      continue;
    }
    const reasons = entry.accepted
      ? ["TEAM_VS_TEAM_CONFIRMED"]
      : entry.reasons.map((reason) =>
        reason === "SUBJECT_ENTITY_MISMATCH" && (!entry.leftSubjectEntity || !entry.rightSubjectEntity) ? "TEAM_ALIAS_UNRESOLVED"
        : reason === "OPPONENT_MISMATCH" && (!entry.leftOpponentEntity || !entry.rightOpponentEntity) ? "OPPONENT_MISSING"
        : reason === "SUBJECT_ENTITY_MISMATCH" || reason === "OPPONENT_MISMATCH" ? reason
        : "MATCH_INSTANCE_AMBIGUOUS"
      );
    for (const reason of reasons) {
      increment(perPocket[entry.pocket]!.pairRootCauseCounts, reason);
    }
  }

  for (const pocket of SPORTS_POCKETS) {
    perPocket[pocket]!.pairRootCauseCounts = sortRecord(perPocket[pocket]!.pairRootCauseCounts);
  }

  return {
    observedAt: new Date().toISOString(),
    perPocket
  };
};

const buildDateRootCauseSummary = (result: SportsPocketMatchingPipelineResult): SportsPocketDateRootCauseSummary => {
  const perPocket: SportsPocketDateRootCauseSummary["perPocket"] = {};
  const admissionById = new Map(result.admissionEvaluations.map((entry) => [entry.market.interpretedContractId, entry] as const));

  for (const pocket of SPORTS_POCKETS) {
    perPocket[pocket] = { rows: [], pairRootCauseCounts: {} };
  }

  for (const entry of result.dateEvaluations) {
    const admission = admissionById.get(entry.market.interpretedContractId);
    const pocket = admission?.pocket;
    if (!pocket || !(SPORTS_POCKETS as readonly string[]).includes(pocket)) {
      continue;
    }
    perPocket[pocket]!.rows = [
      ...perPocket[pocket]!.rows,
      {
        interpretedContractId: entry.market.interpretedContractId,
        venue: entry.market.venue,
        title: entry.market.title,
        eventDate: entry.eventDate,
        cutoffTimestamp: entry.cutoffTimestamp,
        timezoneNormalizedCutoff: entry.timezoneNormalizedCutoff,
        dateWindowBucket: entry.dateWindowBucket,
        dateSourceProvenance: entry.dateSourceProvenance,
        confidence: entry.dateWindowConfidence,
        blockers: entry.blockers
      }
    ];
  }

  for (const entry of result.prefilterEvaluations) {
    if (!(SPORTS_POCKETS as readonly string[]).includes(entry.pocket)) {
      continue;
    }
    const reasons = entry.accepted
      ? ["DATE_WINDOW_CONFIRMED"]
      : entry.reasons.includes("DATE_WINDOW_MISMATCH")
        ? (
          entry.leftDateKey && entry.rightDateKey && entry.leftDateKey === entry.rightDateKey && entry.leftCutoffTimestamp !== entry.rightCutoffTimestamp
            ? ["SAME_DAY_BUT_DIFFERENT_CUTOFF"]
            : !entry.leftDateKey || !entry.rightDateKey
              ? ["MISSING_EVENT_DATE"]
              : (!entry.leftDateSourceProvenance || !entry.rightDateSourceProvenance)
                ? ["DATE_EXTRACTION_AMBIGUOUS"]
                : ["DATE_WINDOW_MISMATCH"]
        )
        : [];
    for (const reason of reasons) {
      increment(perPocket[entry.pocket]!.pairRootCauseCounts, reason);
    }
  }

  for (const pocket of SPORTS_POCKETS) {
    perPocket[pocket]!.pairRootCauseCounts = sortRecord(perPocket[pocket]!.pairRootCauseCounts);
  }

  return {
    observedAt: new Date().toISOString(),
    perPocket
  };
};

const buildPrefilterSummary = (result: SportsPocketMatchingPipelineResult): SportsPocketPrefilterSummary => {
  const blockerReasons: Record<string, number> = {};
  const blockerReasonsByPocket: Record<string, Record<string, number>> = {};

  for (const entry of result.prefilterEvaluations.filter((row) => !row.accepted)) {
    for (const reason of entry.reasons) {
      increment(blockerReasons, reason);
      incrementNested(blockerReasonsByPocket, entry.pocket, reason);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    candidatePairsConsidered: result.prefilterEvaluations.length,
    acceptedPairs: result.prefilterEvaluations.filter((row) => row.accepted).length,
    blockerReasons: sortRecord(blockerReasons),
    blockerReasonsByPocket: sortNested(blockerReasonsByPocket)
  };
};

const buildEdgeSummary = (result: SportsPocketMatchingPipelineResult): SportsPocketEdgeSummary => {
  const perPocket: SportsPocketEdgeSummary["perPocket"] = {};

  for (const entry of result.admissionEvaluations.filter((row) => row.accepted && row.pocket)) {
    const pocket = entry.pocket!;
    perPocket[pocket] ??= {
      admittedRows: 0,
      candidatePairsConsidered: 0,
      exactSafeEdgesPersisted: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantBlockers: {},
      venuePairs: {}
    };
    perPocket[pocket]!.admittedRows += 1;
  }

  for (const entry of result.prefilterEvaluations.filter((row) => row.accepted)) {
    perPocket[entry.pocket] ??= {
      admittedRows: 0,
      candidatePairsConsidered: 0,
      exactSafeEdgesPersisted: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantBlockers: {},
      venuePairs: {}
    };
    perPocket[entry.pocket]!.candidatePairsConsidered += 1;
  }

  for (const entry of result.pairEvaluations) {
    perPocket[entry.pocket] ??= {
      admittedRows: 0,
      candidatePairsConsidered: 0,
      exactSafeEdgesPersisted: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantBlockers: {},
      venuePairs: {}
    };
    if (entry.finalLabel === "EXACT") {
      perPocket[entry.pocket]!.exactSafeEdgesPersisted += 1;
    }
    if (pairLabelRouteEligibility(entry.finalLabel, entry.approvalState)) {
      perPocket[entry.pocket]!.exactSafeEdgesApproved += 1;
    }
    increment(perPocket[entry.pocket]!.labels, entry.finalLabel);
    increment(perPocket[entry.pocket]!.venuePairs, buildVenuePairKey(entry.venuePair));
    for (const reason of entry.rejectionReasons) {
      increment(perPocket[entry.pocket]!.dominantBlockers, reason);
    }
  }

  for (const pocket of Object.keys(perPocket)) {
    perPocket[pocket]!.labels = sortRecord(perPocket[pocket]!.labels);
    perPocket[pocket]!.dominantBlockers = sortRecord(perPocket[pocket]!.dominantBlockers);
    perPocket[pocket]!.venuePairs = sortRecord(perPocket[pocket]!.venuePairs);
  }

  return {
    observedAt: new Date().toISOString(),
    perPocket
  };
};

const buildRouteabilitySummary = (
  result: SportsPocketMatchingPipelineResult,
  edgeSummary: SportsPocketEdgeSummary
): SportsPocketRouteabilitySummary => {
  const exactSafePairsByPocket: Record<string, number> = {};
  const exactSafePairsByVenuePair: Record<string, number> = {};
  const fallbackVenuePairCounts: Record<string, number> = {};

  for (const entry of result.prefilterEvaluations) {
    increment(fallbackVenuePairCounts, buildVenuePairKey(entry.venuePair));
  }

  for (const entry of result.pairEvaluations.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState))) {
    increment(exactSafePairsByPocket, entry.pocket);
    increment(exactSafePairsByVenuePair, buildVenuePairKey(entry.venuePair));
  }

  const acceptedCandidatesByPocket = Object.fromEntries(
    Object.entries(edgeSummary.perPocket).map(([pocket, summary]) => [pocket, summary.candidatePairsConsidered])
  );
  const admittedCountsByPocket = Object.fromEntries(
    Object.entries(edgeSummary.perPocket).map(([pocket, summary]) => [pocket, summary.admittedRows])
  );
  const blockerDensityByPocket = Object.fromEntries(
    Object.entries(edgeSummary.perPocket).map(([pocket, summary]) => [
      pocket,
      Object.values(summary.dominantBlockers).reduce((sum, value) => sum + value, 0)
    ])
  );

  const bestPerformingPocket =
    bestRecordKey(exactSafePairsByPocket)
    ?? bestRecordKey(acceptedCandidatesByPocket)
    ?? Object.entries(admittedCountsByPocket)
      .sort((a, b) => b[1] - a[1] || (blockerDensityByPocket[a[0]] ?? 0) - (blockerDensityByPocket[b[0]] ?? 0) || a[0].localeCompare(b[0]))[0]?.[0]
    ?? null;

  return {
    observedAt: new Date().toISOString(),
    exactSafeApprovedEdges: result.pairEvaluations.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length,
    pairEdges: result.pairEdges.length,
    pairRouteableOpportunities: result.pairEvaluations.filter((row) => pairLabelRouteEligibility(row.finalLabel, row.approvalState)).length,
    bestPerformingPocket,
    bestPerformingVenuePair: bestRecordKey(exactSafePairsByVenuePair) ?? bestRecordKey(fallbackVenuePairCounts),
    exactSafePairsByPocket: sortRecord(exactSafePairsByPocket),
    exactSafePairsByVenuePair: sortRecord(exactSafePairsByVenuePair)
  };
};

const buildGraphBlockers = (result: SportsPocketMatchingPipelineResult): Record<string, number> => {
  const blockers: Record<string, number> = {};
  for (const evaluation of result.admissionEvaluations.filter((row) => !row.accepted)) {
    for (const reason of evaluation.rejectionReasons) {
      increment(blockers, reason);
    }
  }
  for (const evaluation of result.entityEvaluations.filter((row) => !row.accepted)) {
    for (const reason of evaluation.blockers) {
      increment(blockers, reason);
    }
  }
  for (const evaluation of result.dateEvaluations.filter((row) => !row.accepted)) {
    for (const reason of evaluation.blockers) {
      increment(blockers, reason);
    }
  }
  for (const evaluation of result.outcomeEvaluations.filter((row) => !row.accepted)) {
    for (const reason of evaluation.blockers) {
      increment(blockers, reason);
    }
  }
  for (const evaluation of result.prefilterEvaluations.filter((row) => !row.accepted)) {
    for (const reason of evaluation.reasons) {
      increment(blockers, reason);
    }
  }
  for (const evaluation of result.pairEvaluations) {
    for (const reason of evaluation.rejectionReasons) {
      increment(blockers, reason);
    }
  }
  return sortRecord(blockers);
};

const buildDeltaSummary = (input: {
  beforeExactSafeApprovedEdges: number;
  beforePairEdges: number;
  beforePairRouteableOpportunities: number;
  beforeBlockers: Record<string, number>;
  after: SportsPocketRouteabilitySummary;
  afterBlockers: Record<string, number>;
}): SportsPocketDeltaSummary => ({
  observedAt: new Date().toISOString(),
  before: {
    exactSafeApprovedEdges: input.beforeExactSafeApprovedEdges,
    pairEdges: input.beforePairEdges,
    pairRouteableOpportunities: input.beforePairRouteableOpportunities,
    blockerReasons: input.beforeBlockers
  },
  after: {
    exactSafeApprovedEdges: input.after.exactSafeApprovedEdges,
    pairEdges: input.after.pairEdges,
    pairRouteableOpportunities: input.after.pairRouteableOpportunities,
    blockerReasons: input.afterBlockers
  },
  delta: {
    exactSafeApprovedEdges: input.after.exactSafeApprovedEdges - input.beforeExactSafeApprovedEdges,
    pairEdges: input.after.pairEdges - input.beforePairEdges,
    pairRouteableOpportunities: input.after.pairRouteableOpportunities - input.beforePairRouteableOpportunities,
    blockerReasons: subtractRecord(input.afterBlockers, input.beforeBlockers)
  }
});

const buildSourceHygieneSummary = (
  admission: readonly SportsPocketAdmissionEvaluation[],
  entity: readonly SportsPocketEntityEvaluation[],
  date: readonly SportsPocketDateEvaluation[],
  outcome: readonly SportsPocketOutcomeEvaluation[]
): SportsPocketSourceHygieneSummary => {
  const reasons: Record<string, number> = {};
  const rejectedRows = new Map<string, {
    venue: string;
    venueMarketId: string;
    title: string;
    reasons: Set<string>;
  }>();

  const pushRow = (market: SportsPocketAdmissionEvaluation["market"], blockers: readonly string[]): void => {
    const key = market.interpretedContractId;
    const row = rejectedRows.get(key) ?? {
      venue: market.venue,
      venueMarketId: market.venueMarketId,
      title: market.title,
      reasons: new Set<string>()
    };
    for (const blocker of blockers) {
      row.reasons.add(blocker);
      increment(reasons, blocker);
    }
    rejectedRows.set(key, row);
  };

  for (const row of admission.filter((entry) => !entry.accepted)) {
    pushRow(row.market, row.rejectionReasons);
  }
  for (const row of entity.filter((entry) => !entry.accepted)) {
    pushRow(row.market, row.blockers);
  }
  for (const row of date.filter((entry) => !entry.accepted)) {
    pushRow(row.market, row.blockers);
  }
  for (const row of outcome.filter((entry) => !entry.accepted)) {
    pushRow(row.market, row.blockers);
  }

  return {
    observedAt: new Date().toISOString(),
    rejectedRows: rejectedRows.size,
    reasons: sortRecord(reasons),
    examples: [...rejectedRows.values()].slice(0, 10).map((row) => ({
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      reasons: [...row.reasons].sort()
    }))
  };
};

const buildRootCauseClassifier = (input: {
  coverageMatrix: SportsPocketCoverageMatrix;
  basisSummary: SportsPocketBasisSummary;
  identitySummary: SportsPocketMatchIdentitySummary;
  dateSummary: SportsPocketDateRootCauseSummary;
  routeability: SportsPocketRouteabilitySummary;
}): SportsPocketRootCauseClassifier => {
  const pockets: SportsPocketRootCauseClassifier["pockets"] = {};

  for (const pocket of SPORTS_POCKETS) {
    const coverage = input.coverageMatrix.pockets[pocket]!.venues;
    const basis = input.basisSummary.pockets[pocket]!.venues;
    const identityCounts = input.identitySummary.perPocket[pocket]!.pairRootCauseCounts;
    const dateCounts = input.dateSummary.perPocket[pocket]!.pairRootCauseCounts;

    const rawCount = Object.values(coverage).reduce((sum, value) => sum + value.rawRowCount, 0);
    const candidateEligible = Object.values(coverage).reduce((sum, value) => sum + value.candidateEligibleCount, 0);
    const missingVenues = Object.entries(coverage).filter(([, value]) => value.rawRowCount === 0).length;
    const basisComparableVenues = Object.values(basis).filter((value) => value.label === "BASIS_COMPARABLE").length;
    const identityNoise = (identityCounts["SUBJECT_ENTITY_MISMATCH"] ?? 0) + (identityCounts["OPPONENT_MISMATCH"] ?? 0) + (identityCounts["TEAM_ALIAS_UNRESOLVED"] ?? 0);
    const dateNoise = (dateCounts["DATE_WINDOW_MISMATCH"] ?? 0) + (dateCounts["SAME_DAY_BUT_DIFFERENT_CUTOFF"] ?? 0) + (dateCounts["DATE_EXTRACTION_AMBIGUOUS"] ?? 0);

    let dominantClass: SportsPocketDominantClass;
    let secondaryClass: SportsPocketDominantClass | null = null;

    if (rawCount <= 1 || candidateEligible === 0 && missingVenues >= 3) {
      dominantClass = "LOW_SIGNAL_POCKET";
    } else if (missingVenues >= 2 || Object.values(coverage).filter((value) => value.rawRowCount > 0).length <= 1) {
      dominantClass = "COVERAGE_THIN";
    } else if (basisComparableVenues === 0 && rawCount > 0) {
      dominantClass = "BASIS_FRAGMENTED";
    } else if (identityNoise >= dateNoise && identityNoise > 0) {
      dominantClass = "MATCH_IDENTITY_NOISY";
      secondaryClass = dateNoise > 0 ? "DATE_ALIGNMENT_NOISY" : null;
    } else if (dateNoise > 0) {
      dominantClass = "DATE_ALIGNMENT_NOISY";
      secondaryClass = identityNoise > 0 ? "MATCH_IDENTITY_NOISY" : null;
    } else if ((input.routeability.exactSafePairsByPocket[pocket] ?? 0) > 0 || candidateEligible > 1) {
      dominantClass = "MIXED_BUT_PROMISING";
    } else {
      dominantClass = "OUTCOME_STRUCTURE_NOISY";
    }

    const exactSafePlausibleWithTargetedRecovery =
      dominantClass === "COVERAGE_THIN" || dominantClass === "MIXED_BUT_PROMISING";
    const moreIngestionLikelyUseful =
      dominantClass === "COVERAGE_THIN" || dominantClass === "BASIS_FRAGMENTED";
    const tighterNormalizationHigherRoi =
      dominantClass === "MATCH_IDENTITY_NOISY" || dominantClass === "DATE_ALIGNMENT_NOISY" || dominantClass === "OUTCOME_STRUCTURE_NOISY";

    const rationale =
      dominantClass === "LOW_SIGNAL_POCKET"
        ? "The pocket has too little admitted or venue-diverse supply to justify another narrow execution pass."
        : dominantClass === "COVERAGE_THIN"
          ? "At least one required venue is effectively absent or only one venue contributes usable supply."
          : dominantClass === "BASIS_FRAGMENTED"
            ? "Rows exist across venues, but basis availability is not comparable enough to support pair formation."
            : dominantClass === "MATCH_IDENTITY_NOISY"
              ? "Admitted rows exist, but matchup identity and opponent proof dominate failures."
              : dominantClass === "DATE_ALIGNMENT_NOISY"
                ? "Same-match proof is not enough because date/cutoff confirmation still breaks pair attempts."
                : dominantClass === "MIXED_BUT_PROMISING"
                  ? "The pocket has enough structural signal to justify one narrow next step."
                  : "Outcome mapping remains too inconsistent even inside the narrowed pockets.";

    pockets[pocket] = {
      dominantClass,
      secondaryClass,
      exactSafePlausibleWithTargetedRecovery,
      moreIngestionLikelyUseful,
      tighterNormalizationHigherRoi,
      rationale
    };
  }

  return {
    observedAt: new Date().toISOString(),
    pockets
  };
};

const buildTargetedRecoveryPlan = (input: {
  coverageMatrix: SportsPocketCoverageMatrix;
  basisSummary: SportsPocketBasisSummary;
  classifier: SportsPocketRootCauseClassifier;
}): SportsPocketTargetedRecoveryPlan => {
  const pockets: SportsPocketTargetedRecoveryPlan["pockets"] = {};

  for (const pocket of SPORTS_POCKETS) {
    const coverage = input.coverageMatrix.pockets[pocket]!.venues;
    const basis = input.basisSummary.pockets[pocket]!.venues;
    const dominantClass = input.classifier.pockets[pocket]!.dominantClass;
    const missingVenue = Object.entries(coverage).find(([, value]) => value.rawRowCount === 0)?.[0] ?? null;
    const basisBlockedVenue = Object.entries(basis).find(([, value]) => value.label && value.label !== "BASIS_COMPARABLE")?.[0] ?? null;

    const recommendation =
      dominantClass === "COVERAGE_THIN" && missingVenue
        ? "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED"
        : dominantClass === "BASIS_FRAGMENTED" && basisBlockedVenue
          ? "TARGETED_HISTORICAL_BACKFILL_JUSTIFIED"
          : dominantClass === "MATCH_IDENTITY_NOISY" || dominantClass === "DATE_ALIGNMENT_NOISY" || dominantClass === "OUTCOME_STRUCTURE_NOISY"
            ? "NORMALIZATION_BEFORE_RECOVERY"
            : dominantClass === "LOW_SIGNAL_POCKET"
              ? "HOLD_PENDING_PARTNER_DATA"
              : "NO_RECOVERY_JUSTIFIED";

    pockets[pocket] = {
      recommendation,
      missingVenue,
      missingBasis: basisBlockedVenue ? basis[basisBlockedVenue]!.label : null,
      missingRowShape:
        recommendation === "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED" ? "two-sided matchup rows in the same pocket"
        : recommendation === "TARGETED_HISTORICAL_BACKFILL_JUSTIFIED" ? "comparable historical/current-state matchup rows"
        : null,
      rationale:
        recommendation === "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED"
          ? "A venue is effectively absent from the pocket, so a narrow discovery recovery could create the missing counterpart supply."
          : recommendation === "TARGETED_HISTORICAL_BACKFILL_JUSTIFIED"
            ? "Supply exists, but the pocket needs comparable basis coverage rather than more broad rows."
            : recommendation === "NORMALIZATION_BEFORE_RECOVERY"
              ? "More ingestion would likely add the same shape of rows until identity/date proof is tightened first."
              : recommendation === "HOLD_PENDING_PARTNER_DATA"
                ? "The pocket is too thin to justify even targeted recovery without outside supply improvement."
                : "No narrow recovery move is justified from the current evidence."
    };
  }

  return {
    observedAt: new Date().toISOString(),
    pockets
  };
};

const buildPriorityRecommendation = (input: {
  routeability: SportsPocketRouteabilitySummary;
  classifier: SportsPocketRootCauseClassifier;
  recoveryPlan: SportsPocketTargetedRecoveryPlan;
}): SportsPocketPriorityRecommendation => {
  const bestPocket = input.routeability.bestPerformingPocket;
  const primaryRecommendation =
    bestPocket === "ESPORTS|MATCHUP_WINNER|DOTA2_ESL" && input.classifier.pockets[bestPocket]?.dominantClass === "MATCH_IDENTITY_NOISY"
      ? "TIGHTEN_DOTA2_ESL_MATCH_IDENTITY"
      : bestPocket === "ESPORTS|MATCHUP_WINNER|DOTA2_ESL" && input.recoveryPlan.pockets[bestPocket]?.recommendation === "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED"
        ? "TARGETED_RECOVERY_DOTA2_ESL"
        : bestPocket === "SPORTS|MATCHUP_WINNER|NBA" && input.classifier.pockets[bestPocket]?.dominantClass === "MATCH_IDENTITY_NOISY"
          ? "TIGHTEN_NBA_MATCH_IDENTITY"
          : bestPocket === "SPORTS|MATCHUP_WINNER|NBA" && input.recoveryPlan.pockets[bestPocket]?.recommendation === "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED"
            ? "TARGETED_RECOVERY_NBA"
            : input.classifier.pockets["ESPORTS|MATCHUP_WINNER|KPL"]?.dominantClass === "LOW_SIGNAL_POCKET"
              ? "HOLD_KPL_LOW_DEPTH"
              : input.classifier.pockets["ESPORTS|MATCHUP_WINNER|LCK"]?.dominantClass === "LOW_SIGNAL_POCKET"
                ? "HOLD_LCK_ZERO_ADMISSION"
                : "SPORTS_PAUSE_RETURN_TO_OTHER_FRONTIER";

  const secondaryRecommendation =
    primaryRecommendation !== "HOLD_KPL_LOW_DEPTH" && input.classifier.pockets["ESPORTS|MATCHUP_WINNER|KPL"]?.dominantClass === "LOW_SIGNAL_POCKET"
      ? "HOLD_KPL_LOW_DEPTH"
      : primaryRecommendation !== "HOLD_LCK_ZERO_ADMISSION" && input.classifier.pockets["ESPORTS|MATCHUP_WINNER|LCK"]?.dominantClass === "LOW_SIGNAL_POCKET"
        ? "HOLD_LCK_ZERO_ADMISSION"
        : null;

  const rationale =
    primaryRecommendation === "TIGHTEN_DOTA2_ESL_MATCH_IDENTITY"
      ? "DOTA2_ESL remains the best pocket, but its next edge gains depend on proving same-match identity more reliably."
      : primaryRecommendation === "TIGHTEN_NBA_MATCH_IDENTITY"
        ? "NBA has the most admitted supply, but its near-term blocker is still matchup/date proof rather than raw venue count."
        : primaryRecommendation === "TARGETED_RECOVERY_DOTA2_ESL"
          ? "DOTA2_ESL is structurally the strongest pocket and now lacks one narrow venue-side coverage leg."
          : primaryRecommendation === "TARGETED_RECOVERY_NBA"
            ? "NBA is the only sports pocket with multi-venue shape and a concrete missing venue-side supply gap."
            : primaryRecommendation === "HOLD_KPL_LOW_DEPTH"
              ? "KPL remains too shallow to justify another execution pass."
              : primaryRecommendation === "HOLD_LCK_ZERO_ADMISSION"
                ? "LCK still admits zero rows, so the correct action is to hold rather than iterate on matching."
                : "Sports should pause until another frontier offers better near-term routeability ROI.";

  return {
    observedAt: new Date().toISOString(),
    primaryRecommendation,
    secondaryRecommendation,
    rationale
  };
};

const buildFinalDecision = (input: {
  classifier: SportsPocketRootCauseClassifier;
  recoveryPlan: SportsPocketTargetedRecoveryPlan;
  priorityRecommendation: SportsPocketPriorityRecommendation;
}): SportsPocketFinalDecision => {
  const classes = Object.values(input.classifier.pockets);
  const hasCoverage = classes.some((entry) => entry.dominantClass === "COVERAGE_THIN" || entry.dominantClass === "BASIS_FRAGMENTED");
  const hasIdentity = classes.some((entry) => entry.dominantClass === "MATCH_IDENTITY_NOISY" || entry.dominantClass === "DATE_ALIGNMENT_NOISY");
  const hasRecovery = Object.values(input.recoveryPlan.pockets).some((entry) =>
    entry.recommendation === "TARGETED_DISCOVERY_RECOVERY_JUSTIFIED"
    || entry.recommendation === "TARGETED_HISTORICAL_BACKFILL_JUSTIFIED"
    || entry.recommendation === "TARGETED_LIVE_INGESTION_JUSTIFIED"
  );

  const decision: SportsPocketFinalDecisionLabel =
    hasCoverage && hasRecovery && !hasIdentity
      ? "SPORTS_COVERAGE_GAP_CONFIRMED__TARGETED_RECOVERY_JUSTIFIED"
      : hasIdentity && !hasRecovery
        ? "SPORTS_IDENTITY_GAP_DOMINANT__TIGHTEN_MATCH_INSTANCE_RULES"
        : hasCoverage && hasIdentity
          ? "SPORTS_MIXED_GAPS__RECOVER_ONE_POCKET_AND_TIGHTEN_ONE_POCKET"
          : "SPORTS_FRONTIER_LOW_ROI__HOLD_AND_RETURN_LATER";

  const coverageScarcityAssessment =
    hasCoverage && hasIdentity ? "PARTIALLY_CONFIRMED"
    : hasCoverage ? "CONFIRMED"
    : "NOT_SUPPORTED";

  const rationale =
    decision === "SPORTS_COVERAGE_GAP_CONFIRMED__TARGETED_RECOVERY_JUSTIFIED"
      ? "The dominant blocker is missing comparable supply in at least one pocket, and narrow recovery is justified."
      : decision === "SPORTS_IDENTITY_GAP_DOMINANT__TIGHTEN_MATCH_INSTANCE_RULES"
        ? "The best pockets already have enough visible supply; the next blocker is same-match identity and date proof."
        : decision === "SPORTS_MIXED_GAPS__RECOVER_ONE_POCKET_AND_TIGHTEN_ONE_POCKET"
          ? "The pockets split between supply gaps and structural identity/date noise, so one recovery and one tightening move are justified."
          : "No pocket currently shows enough evidence that another sports pass will move exact-safe edge counts materially.";

  return {
    observedAt: new Date().toISOString(),
    decision,
    rationale,
    coverageScarcityAssessment,
    broadIngestionJustifiedNow: false,
    highestRoiNextAction: input.priorityRecommendation.primaryRecommendation
  };
};

const buildDecision = (input: {
  routeability: SportsPocketRouteabilitySummary;
  prefilter: SportsPocketPrefilterSummary;
  deltaVsPriorSports: SportsPocketDeltaSummary;
  deltaVsCrypto: SportsPocketDeltaSummary;
}): SportsPocketNextStepDecision => {
  const exactSafe = input.routeability.exactSafeApprovedEdges;
  const acceptedPairs = input.prefilter.acceptedPairs;
  const blockerTypes = Object.keys(input.prefilter.blockerReasons).length;
  const sportsNowBeatsCrypto = input.routeability.exactSafeApprovedEdges > input.deltaVsCrypto.before.exactSafeApprovedEdges;

  const decision: SportsPocketDecisionLabel =
    exactSafe >= 1 && input.deltaVsPriorSports.delta.exactSafeApprovedEdges > 0
      ? "SPORTS_POCKET_PASS_SUCCESS__STAY_ON_MATCHUP_POCKETS"
      : acceptedPairs > 0 || Object.keys(input.routeability.exactSafePairsByPocket).length > 0
        ? "SPORTS_POCKET_PASS_MODEST__ONE_MORE_POCKET"
        : blockerTypes > 0 && input.prefilter.candidatePairsConsidered > 0
          ? "SPORTS_POCKET_PASS_NOISY__TIGHTEN_POCKET_RULES"
          : "SPORTS_POCKET_PASS_FLAT__SPORTS_FRONTIER_EXHAUSTED";

  const rationale =
    decision === "SPORTS_POCKET_PASS_SUCCESS__STAY_ON_MATCHUP_POCKETS"
      ? "The pocket-first matchup pass produced real exact-safe improvement inside a narrow competition pocket."
      : decision === "SPORTS_POCKET_PASS_MODEST__ONE_MORE_POCKET"
        ? "The narrowed pockets still did not produce broad density, but at least one pocket now looks structurally credible."
        : decision === "SPORTS_POCKET_PASS_NOISY__TIGHTEN_POCKET_RULES"
          ? "Even after pocket tightening, admitted rows still mostly convert into structural blockers rather than exact-safe edges."
          : "The narrowed matchup pockets did not improve exact-safe sports routeability enough to justify further sports investment.";

  return {
    observedAt: new Date().toISOString(),
    decision,
    rationale,
    bestPerformingPocket: input.routeability.bestPerformingPocket,
    bestPerformingVenuePair: input.routeability.bestPerformingVenuePair,
    sportsNowBeatsCrypto
  };
};

export const buildSportsPocketAdmissionMarkdown = (artifact: SportsPocketAdmissionSummary): string => [
  "# Sports Pocket Admission Summary",
  "",
  ...Object.entries(artifact.admittedCountsByPocket).map(([pocket, count]) => `- ${pocket}: ${count}`),
  "",
  `- rejected reasons: ${Object.entries(artifact.rejectedCountsByReason).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsPocketEntityMarkdown = (artifact: SportsPocketEntitySummary): string => [
  "# Sports Pocket Entity Summary",
  "",
  ...Object.entries(artifact.admittedEntityCountsByPocket).map(([pocket, count]) => `- ${pocket}: ${count}`),
  "",
  `- blockers: ${Object.entries(artifact.blockerCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsPocketDateWindowMarkdown = (artifact: SportsPocketDateWindowSummary): string => [
  "# Sports Pocket Date Window Summary",
  "",
  ...Object.entries(artifact.admittedDateCountsByPocket).map(([pocket, count]) => `- ${pocket}: ${count}`),
  "",
  `- blockers: ${Object.entries(artifact.blockerCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  `- provenance: ${Object.entries(artifact.provenanceCounts).map(([source, count]) => `${source}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsPocketPrefilterMarkdown = (artifact: SportsPocketPrefilterSummary): string => [
  "# Sports Pocket Prefilter Summary",
  "",
  `- candidate pairs considered: ${artifact.candidatePairsConsidered}`,
  `- accepted pairs: ${artifact.acceptedPairs}`,
  `- blockers: ${Object.entries(artifact.blockerReasons).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsPocketEdgeMarkdown = (artifact: SportsPocketEdgeSummary): string => [
  "# Sports Pocket Edge Summary",
  "",
  ...Object.entries(artifact.perPocket).map(([pocket, summary]) =>
    `- ${pocket}: admitted=${summary.admittedRows}, candidates=${summary.candidatePairsConsidered}, approved=${summary.exactSafeEdgesApproved}`
  ),
  ""
].join("\n");

export const buildSportsPocketCoverageMatrixMarkdown = (artifact: SportsPocketCoverageMatrix): string => [
  "# Sports Pocket Coverage Matrix",
  "",
  ...Object.entries(artifact.pockets).flatMap(([pocket, summary]) => [
    `## ${pocket}`,
    ...Object.entries(summary.venues).map(([venue, value]) =>
      `- ${venue}: raw=${value.rawRowCount}, admitted=${value.admittedRowCount}, eligible=${value.candidateEligibleCount}, label=${value.coverageLabel}`
    ),
    ""
  ])
].join("\n");

export const buildSportsPocketBasisSummaryMarkdown = (artifact: SportsPocketBasisSummary): string => [
  "# Sports Pocket Basis Summary",
  "",
  ...Object.entries(artifact.pockets).flatMap(([pocket, summary]) => [
    `## ${pocket}`,
    ...Object.entries(summary.venues).map(([venue, value]) =>
      `- ${venue}: label=${value.label ?? "none"}, counterparts=${value.comparableCounterpartVenues.join(", ") || "none"}`
    ),
    ""
  ])
].join("\n");

export const buildSportsPocketMatchIdentityMarkdown = (artifact: SportsPocketMatchIdentitySummary): string => [
  "# Sports Pocket Match Identity Summary",
  "",
  ...Object.entries(artifact.perPocket).map(([pocket, summary]) =>
    `- ${pocket}: ${Object.entries(summary.pairRootCauseCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "no pair attempts"}`
  ),
  ""
].join("\n");

export const buildSportsPocketDateRootCauseMarkdown = (artifact: SportsPocketDateRootCauseSummary): string => [
  "# Sports Pocket Date Root-Cause Summary",
  "",
  ...Object.entries(artifact.perPocket).map(([pocket, summary]) =>
    `- ${pocket}: ${Object.entries(summary.pairRootCauseCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "no pair attempts"}`
  ),
  ""
].join("\n");

export const buildSportsPocketRootCauseClassifierMarkdown = (artifact: SportsPocketRootCauseClassifier): string => [
  "# Sports Pocket Root-Cause Classifier",
  "",
  ...Object.entries(artifact.pockets).map(([pocket, summary]) =>
    `- ${pocket}: dominant=${summary.dominantClass}, secondary=${summary.secondaryClass ?? "none"}`
  ),
  ""
].join("\n");

export const buildSportsPocketTargetedRecoveryPlanMarkdown = (artifact: SportsPocketTargetedRecoveryPlan): string => [
  "# Sports Pocket Targeted Recovery Plan",
  "",
  ...Object.entries(artifact.pockets).map(([pocket, summary]) =>
    `- ${pocket}: ${summary.recommendation}${summary.missingVenue ? `, missingVenue=${summary.missingVenue}` : ""}`
  ),
  ""
].join("\n");

export const buildSportsPocketPriorityRecommendationMarkdown = (artifact: SportsPocketPriorityRecommendation): string => [
  "# Sports Pocket Priority Recommendation",
  "",
  `- primary: ${artifact.primaryRecommendation}`,
  `- secondary: ${artifact.secondaryRecommendation ?? "none"}`,
  "",
  artifact.rationale,
  ""
].join("\n");

export const buildSportsPocketNextStepDecisionMarkdown = (artifact: SportsPocketNextStepDecision): string => [
  "# Sports Pocket Next-Step Decision",
  "",
  `- decision: \`${artifact.decision}\``,
  `- best-performing pocket: ${artifact.bestPerformingPocket ?? "none"}`,
  `- best-performing venue pair: ${artifact.bestPerformingVenuePair ?? "none"}`,
  `- sports now beats crypto: ${artifact.sportsNowBeatsCrypto ? "yes" : "no"}`,
  "",
  artifact.rationale,
  ""
].join("\n");

export const buildSportsPocketFinalDecisionMarkdown = (artifact: SportsPocketFinalDecision): string => [
  "# Sports Pocket Final Decision",
  "",
  `- decision: \`${artifact.decision}\``,
  `- coverage scarcity: ${artifact.coverageScarcityAssessment}`,
  `- broad ingestion justified now: ${artifact.broadIngestionJustifiedNow ? "yes" : "no"}`,
  `- highest-ROI next action: ${artifact.highestRoiNextAction}`,
  "",
  artifact.rationale,
  ""
].join("\n");

export const buildSportsPocketOperatorSummary = (input: {
  decision: SportsPocketFinalDecision;
  priorityRecommendation: SportsPocketPriorityRecommendation;
  rootCauseClassifier: SportsPocketRootCauseClassifier;
  recoveryPlan: SportsPocketTargetedRecoveryPlan;
}): string => [
  "# Sports Pocket Operator Summary",
  "",
  `1. Coverage scarcity as the main blocker: ${input.decision.coverageScarcityAssessment.toLowerCase().replace(/_/g, " ")}.`,
  `2. Non-coverage blockers: ${Object.entries(input.rootCauseClassifier.pockets).filter(([, value]) => value.dominantClass === "MATCH_IDENTITY_NOISY" || value.dominantClass === "DATE_ALIGNMENT_NOISY" || value.dominantClass === "OUTCOME_STRUCTURE_NOISY").map(([pocket, value]) => `${pocket}=${value.dominantClass}`).join(", ") || "none"}.`,
  `3. Best near-term ROI pocket: ${Object.entries(input.rootCauseClassifier.pockets).find(([, value]) => value.dominantClass === "MIXED_BUT_PROMISING" || value.dominantClass === "MATCH_IDENTITY_NOISY")?.[0] ?? "none"}.`,
  `4. Pocket thin because of likely missing venue supply: ${Object.entries(input.rootCauseClassifier.pockets).find(([, value]) => value.dominantClass === "COVERAGE_THIN")?.[0] ?? "none"}.`,
  `5. Pocket noisy because of identity/date alignment: ${Object.entries(input.rootCauseClassifier.pockets).find(([, value]) => value.dominantClass === "MATCH_IDENTITY_NOISY" || value.dominantClass === "DATE_ALIGNMENT_NOISY")?.[0] ?? "none"}.`,
  `6. Broad sports ingestion justified now: ${input.decision.broadIngestionJustifiedNow ? "yes" : "no"}.`,
  `7. Narrow recovery recommendation: ${Object.entries(input.recoveryPlan.pockets).filter(([, value]) => value.recommendation !== "NO_RECOVERY_JUSTIFIED" && value.recommendation !== "NORMALIZATION_BEFORE_RECOVERY" && value.recommendation !== "HOLD_PENDING_PARTNER_DATA").map(([pocket, value]) => `${pocket}=${value.recommendation}`).join(", ") || "none"}.`,
  `8. Tightening-first recommendation: ${Object.entries(input.recoveryPlan.pockets).filter(([, value]) => value.recommendation === "NORMALIZATION_BEFORE_RECOVERY").map(([pocket]) => pocket).join(", ") || "none"}.`,
  `9. Smallest correct next action: ${input.priorityRecommendation.primaryRecommendation}.`,
  ""
].join("\n");

export const buildSportsPocketPassArtifactsFromResult = (input: {
  result: SportsPocketMatchingPipelineResult;
  priorSportsGraph: SportsFamilyGraphSummary;
  priorSportsRouteability: SportsFamilyPairRouteabilitySummary;
  cryptoGraph: CryptoMultiAssetGraphSummary;
  cryptoRouteability: CryptoMultiAssetPairRouteabilitySummary;
}): SportsPocketPassArtifacts => {
  const admissionSummary = buildAdmissionSummary(input.result);
  const entitySummary = buildEntitySummary(input.result);
  const dateWindowSummary = buildDateWindowSummary(input.result);
  const outcomeStructureSummary = buildOutcomeStructureSummary(input.result);
  const prefilterSummary = buildPrefilterSummary(input.result);
  const edgeSummary = buildEdgeSummary(input.result);
  const routeabilitySummary = buildRouteabilitySummary(input.result, edgeSummary);
  const blockerReasons = buildGraphBlockers(input.result);
  const coverageMatrix = buildCoverageMatrix(input.result);
  const basisSummary = buildBasisSummary(coverageMatrix);
  const matchIdentitySummary = buildMatchIdentitySummary(input.result);
  const dateRootCauseSummary = buildDateRootCauseSummary(input.result);
  const deltaVsPriorSports = buildDeltaSummary({
    beforeExactSafeApprovedEdges: input.priorSportsRouteability.exactSafeApprovedCount,
    beforePairEdges: input.priorSportsGraph.pairEdgeCount,
    beforePairRouteableOpportunities: input.priorSportsRouteability.exactSafeApprovedCount,
    beforeBlockers: input.priorSportsGraph.blockerReasons,
    after: routeabilitySummary,
    afterBlockers: blockerReasons
  });
  const deltaVsCrypto = buildDeltaSummary({
    beforeExactSafeApprovedEdges: input.cryptoRouteability.exactSafeApprovedCount,
    beforePairEdges: input.cryptoGraph.pairEdgeCount,
    beforePairRouteableOpportunities: input.cryptoRouteability.exactSafeApprovedCount,
    beforeBlockers: input.cryptoGraph.blockerReasons,
    after: routeabilitySummary,
    afterBlockers: blockerReasons
  });
  const sourceHygieneSummary = buildSourceHygieneSummary(
    input.result.admissionEvaluations,
    input.result.entityEvaluations,
    input.result.dateEvaluations,
    input.result.outcomeEvaluations
  );
  const rootCauseClassifier = buildRootCauseClassifier({
    coverageMatrix,
    basisSummary,
    identitySummary: matchIdentitySummary,
    dateSummary: dateRootCauseSummary,
    routeability: routeabilitySummary
  });
  const targetedRecoveryPlan = buildTargetedRecoveryPlan({
    coverageMatrix,
    basisSummary,
    classifier: rootCauseClassifier
  });
  const priorityRecommendation = buildPriorityRecommendation({
    routeability: routeabilitySummary,
    classifier: rootCauseClassifier,
    recoveryPlan: targetedRecoveryPlan
  });
  const decision = buildDecision({
    routeability: routeabilitySummary,
    prefilter: prefilterSummary,
    deltaVsPriorSports,
    deltaVsCrypto
  });
  const finalDecision = buildFinalDecision({
    classifier: rootCauseClassifier,
    recoveryPlan: targetedRecoveryPlan,
    priorityRecommendation
  });

  return {
    admissionSummary,
    entitySummary,
    dateWindowSummary,
    outcomeStructureSummary,
    prefilterSummary,
    edgeSummary,
    routeabilitySummary,
    deltaVsPriorSports,
    deltaVsCrypto,
    sourceHygieneSummary,
    coverageMatrix,
    basisSummary,
    matchIdentitySummary,
    dateRootCauseSummary,
    rootCauseClassifier,
    targetedRecoveryPlan,
    priorityRecommendation,
    decision,
    finalDecision,
    operatorSummary: buildSportsPocketOperatorSummary({
      decision: finalDecision,
      priorityRecommendation,
      rootCauseClassifier,
      recoveryPlan: targetedRecoveryPlan
    })
  };
};

export const buildSportsPocketPassArtifacts = async (input: {
  pool: Pool;
  priorSportsGraph: SportsFamilyGraphSummary;
  priorSportsRouteability: SportsFamilyPairRouteabilitySummary;
  cryptoGraph: CryptoMultiAssetGraphSummary;
  cryptoRouteability: CryptoMultiAssetPairRouteabilitySummary;
}): Promise<SportsPocketPassArtifacts> => {
  const pipeline = new SportsPocketMatchingPipeline(new PairEdgeRepository(input.pool));
  const result = await pipeline.run();
  return buildSportsPocketPassArtifactsFromResult({
    result,
    priorSportsGraph: input.priorSportsGraph,
    priorSportsRouteability: input.priorSportsRouteability,
    cryptoGraph: input.cryptoGraph,
    cryptoRouteability: input.cryptoRouteability
  });
};
