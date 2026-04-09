import { canonicalizeJsonRecord } from "../../canonical/canonicalization-types.js";
import { classifyRouteabilityBasis } from "../../inventory/inventory-basis-classifier.js";
import { PairEdgeRepository } from "../../repositories/pair-edge.repository.js";
import type { CompatibilityDecision } from "../../canonical/compatibility-decision.js";
import { buildMatchingVersionRecord, type MatchingVersionRecord } from "../matching-versioning.js";
import { applyReviewApprovalPolicy } from "../review-approval-policy.js";
import type { MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../matching-types.js";
import type { SportsFamilyTaxonomyClassification } from "./sports-family-classifier.js";
import { classifySportsFamily } from "./sports-family-classifier.js";
import { buildSportsVenuePairKey, sportsAllowedVenuePairs, sportsTargetVenueValues, type SportsTargetVenue } from "./sports-match-labels.js";
import type { SportsCompetitionContext } from "./sports-competition-context.js";
import { normalizeSportsCompetitionContext } from "./sports-competition-context.js";
import type { SportsSubjectNormalization } from "./sports-subject-entity.js";
import { normalizeSportsSubjectEntities } from "./sports-subject-entity.js";
import {
  buildSortedMatchupKey,
  buildSportsText,
  extractOutcomeLabels,
  extractSportsBoundaryDetailed,
  isYesNoLabel,
  normalizeSportsEntity
} from "./sports-normalization.js";
import type { SportsPairClassifierResult } from "./sports-pair-classifier.js";
import { classifySportsPair } from "./sports-pair-classifier.js";
import { buildSportsPairEdgeRecord } from "./sports-pair-edge-builder.js";
import { buildSportsPairGraph, type SportsPairGraph } from "./sports-pair-graph.js";
import type { SportsStructuralMatchResult } from "./sports-structural-matcher.js";
import {
  sportsPocketValues,
  type SportsPocket,
  type SportsPocketAdmissionRejection
} from "./sports-pocket-match-labels.js";

const SPORTS_POCKET_VERSION_DESCRIPTOR = {
  familyClassifierVersion: "sports-family-classifier-v1",
  fingerprintVersion: "sports-pocket-structural-fingerprint-v1",
  prefilterVersion: "sports-pocket-prefilter-v1",
  structuralMatcherVersion: "sports-pocket-structural-matcher-v1",
  pairClassifierVersion: "sports-pair-classifier-v1",
  embeddingModelVersion: "sports-embeddings-disabled-v1",
  reviewPolicyVersion: "pair-review-policy-v1"
} as const;

interface SportsPocketRepositoryLike {
  upsertMatchingVersion(record: MatchingVersionRecord): Promise<void>;
  listMatchingMarkets(): Promise<readonly MatchingMarketRecord[]>;
  listCompatibilityDecisions(): Promise<readonly CompatibilityDecision[]>;
  upsertMarketClassification(classification: SportsFamilyTaxonomyClassification): Promise<void>;
  upsertStructuralFingerprint(fingerprint: StructuralFingerprint): Promise<void>;
  upsertPairEdge(edge: PairEdgeRecord): Promise<void>;
}

export interface SportsPocketAdmissionEvaluation {
  market: MatchingMarketRecord;
  classification: SportsFamilyTaxonomyClassification;
  pocket: SportsPocket | null;
  pocketConfidence: string;
  pocketReasons: readonly string[];
  accepted: boolean;
  rejectionReasons: readonly SportsPocketAdmissionRejection[];
}

export interface SportsPocketEntityEvaluation {
  market: MatchingMarketRecord;
  pocket: SportsPocket | null;
  accepted: boolean;
  rawSubjectText: string | null;
  rawOpponentText: string | null;
  subjectEntity: string | null;
  opponentEntity: string | null;
  matchupKey: string | null;
  canonicalSortedTeams: readonly string[];
  sideAssignment: string | null;
  sideAssignmentSource: string | null;
  outcomeMappingBasis: string | null;
  titleNoiseStripped: boolean;
  blockers: readonly string[];
}

export interface SportsPocketDateEvaluation {
  market: MatchingMarketRecord;
  pocket: SportsPocket | null;
  accepted: boolean;
  eventDate: string | null;
  cutoffTimestamp: string | null;
  timezoneNormalizedCutoff: string | null;
  dateWindowBucket: string | null;
  dateWindowConfidence: string;
  dateSourceProvenance: string | null;
  rawDateText: string | null;
  parsedTimestamp: string | null;
  dateStatus: "DATE_CONFIRMED" | "DATE_INFERRED" | "DATE_MISSING" | "DATE_INVALID" | "DATE_AMBIGUOUS";
  timestampSource: string | null;
  yearSource: string | null;
  unsafeDefaultReasons: readonly string[];
  blockers: readonly string[];
}

export interface SportsPocketOutcomeEvaluation {
  market: MatchingMarketRecord;
  pocket: SportsPocket | null;
  accepted: boolean;
  outcomeMappingBasis: string | null;
  blockers: readonly string[];
}

export interface SportsPocketPrefilterEvaluation {
  pocket: SportsPocket;
  venuePair: string;
  leftInterpretedContractId: string;
  rightInterpretedContractId: string;
  leftVenue: MatchingMarketRecord["venue"];
  rightVenue: MatchingMarketRecord["venue"];
  leftTitle: string;
  rightTitle: string;
  leftTemporalBasis: MatchingMarketRecord["inventoryTemporalBasis"];
  rightTemporalBasis: MatchingMarketRecord["inventoryTemporalBasis"];
  leftSourceMetadataVersion: string;
  rightSourceMetadataVersion: string;
  leftHistoricalRowCount: number;
  rightHistoricalRowCount: number;
  leftSubjectEntity: string | null;
  rightSubjectEntity: string | null;
  leftOpponentEntity: string | null;
  rightOpponentEntity: string | null;
  leftMatchupKey: string | null;
  rightMatchupKey: string | null;
  leftDateKey: string | null;
  rightDateKey: string | null;
  leftCutoffTimestamp: string | null;
  rightCutoffTimestamp: string | null;
  leftDateSourceProvenance: string | null;
  rightDateSourceProvenance: string | null;
  leftOutcomeMappingBasis: string | null;
  rightOutcomeMappingBasis: string | null;
  leftSideAssignment: string | null;
  rightSideAssignment: string | null;
  accepted: boolean;
  reasons: readonly string[];
}

export interface SportsPocketPairEvaluation {
  pocket: SportsPocket;
  venuePair: string;
  finalLabel: PairEdgeRecord["label"];
  approvalState: PairEdgeRecord["approvalState"];
  rejectionReasons: readonly string[];
  edgeId: string;
}

export interface SportsPocketMatchingPipelineResult {
  matchingVersion: MatchingVersionRecord;
  sourceMarkets: readonly MatchingMarketRecord[];
  pocketMarkets: readonly MatchingMarketRecord[];
  pairEdges: readonly PairEdgeRecord[];
  pairGraph: SportsPairGraph;
  admissionEvaluations: readonly SportsPocketAdmissionEvaluation[];
  entityEvaluations: readonly SportsPocketEntityEvaluation[];
  dateEvaluations: readonly SportsPocketDateEvaluation[];
  outcomeEvaluations: readonly SportsPocketOutcomeEvaluation[];
  prefilterEvaluations: readonly SportsPocketPrefilterEvaluation[];
  pairEvaluations: readonly SportsPocketPairEvaluation[];
  candidateRejectionReasons: readonly string[];
}

interface PocketReadyMarket {
  market: MatchingMarketRecord;
  classification: SportsFamilyTaxonomyClassification;
  pocket: SportsPocket;
  competitionContext: SportsCompetitionContext;
  subjectNormalization: SportsSubjectNormalization;
  entityEvaluation: SportsPocketEntityEvaluation;
  dateEvaluation: SportsPocketDateEvaluation;
  outcomeEvaluation: SportsPocketOutcomeEvaluation;
  fingerprint: StructuralFingerprint;
}

const compatibilityKey = (leftId: string, rightId: string): string =>
  leftId.localeCompare(rightId) <= 0 ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;

const buildCompatibilityLookup = (decisions: readonly CompatibilityDecision[]): ReadonlyMap<string, CompatibilityDecision> =>
  new Map(decisions.map((decision) => [
    compatibilityKey(decision.interpretedContractAId, decision.interpretedContractBId),
    decision
  ] as const));

const isTargetMarket = (market: MatchingMarketRecord): boolean =>
  (market.category === "SPORTS" || market.category === "ESPORTS")
  && sportsTargetVenueValues.includes(market.venue as SportsTargetVenue);

const shouldComparePair = (leftMarket: MatchingMarketRecord, rightMarket: MatchingMarketRecord): boolean =>
  leftMarket.venue !== rightMarket.venue
  && sportsAllowedVenuePairs.has(
    buildSportsVenuePairKey(leftMarket.venue as SportsTargetVenue, rightMarket.venue as SportsTargetVenue)
  );

const resolvePocket = (classification: SportsFamilyTaxonomyClassification, competitionContext: SportsCompetitionContext | null): SportsPocket | null => {
  if (classification.metadata["taxonomyStatus"] !== "ADMITTED" || classification.family !== "MATCHUP_WINNER") {
    return null;
  }
  const domain = classification.metadata["domain"];
  if (typeof domain !== "string" || competitionContext?.competitionKey === null || competitionContext === null) {
    return null;
  }
  const key = `${domain}|MATCHUP_WINNER|${String(competitionContext.competitionKey).toUpperCase()}`;
  return sportsPocketValues.includes(key as SportsPocket) ? key as SportsPocket : null;
};

const buildPocketAdmissionEvaluation = (
  market: MatchingMarketRecord,
  classification: SportsFamilyTaxonomyClassification,
  competitionContext: SportsCompetitionContext | null
): SportsPocketAdmissionEvaluation => {
  const rejectionReasons: SportsPocketAdmissionRejection[] = [];
  const pocket = resolvePocket(classification, competitionContext);

  if (classification.family !== "MATCHUP_WINNER" || classification.metadata["taxonomyStatus"] !== "ADMITTED") {
    rejectionReasons.push("NON_MATCHUP_ROW");
  }
  if (market.marketClass !== "BINARY") {
    rejectionReasons.push("NON_BINARY_ROW");
  }
  if (competitionContext === null || competitionContext.competitionKey === null) {
    rejectionReasons.push("MISSING_POCKET_CONTEXT");
  } else if (pocket === null) {
    rejectionReasons.push("POCKET_OUT_OF_SCOPE");
  }
  if (competitionContext?.competitionKey === "cs2_blast" || competitionContext?.competitionKey === "nhl") {
    rejectionReasons.push("POCKET_OUT_OF_SCOPE");
  }

  const participants = buildSportsText(market).match(/\bvs\.?\b|\bversus\b/i);
  if (!participants && classification.family === "MATCHUP_WINNER") {
    rejectionReasons.push("MISSING_OPPONENT");
  }

  const dedupedReasons = [...new Set(rejectionReasons)];
  return {
    market,
    classification,
    pocket,
    pocketConfidence: dedupedReasons.length === 0 ? "1" : pocket ? "0.6" : "0.2",
    pocketReasons: pocket ? [`pocket:${pocket.toLowerCase()}`] : ["pocket:rejected"],
    accepted: dedupedReasons.length === 0 && pocket !== null,
    rejectionReasons: dedupedReasons
  };
};

const buildEntityEvaluation = (
  market: MatchingMarketRecord,
  pocket: SportsPocket | null,
  subjectNormalization: SportsSubjectNormalization | null
): SportsPocketEntityEvaluation => {
  const blockers: string[] = [];
  if (!subjectNormalization?.normalizedSubjectEntity) {
    blockers.push("UNRESOLVED_ALIAS");
  }
  if (!subjectNormalization?.normalizedOpponentEntity) {
    blockers.push("MISSING_OPPONENT");
    blockers.push("OPPONENT_MISMATCH");
  }
  if (subjectNormalization?.outcomeMappingBasis === "YES_NO_SINGLE_SIDE") {
    blockers.push("SINGLE_SIDE_ROW");
  }
  if (subjectNormalization?.sideAssignment === "UNKNOWN") {
    blockers.push("SIDE_ASSIGNMENT_MISMATCH");
  }
  if (subjectNormalization?.normalizedSubjectEntity === "draw") {
    blockers.push("NON_TEAM_SUBJECT");
  }

  return {
    market,
    pocket,
    accepted: blockers.length === 0 && pocket !== null,
    rawSubjectText: subjectNormalization?.subjectEntityRaw ?? null,
    rawOpponentText: subjectNormalization?.opponentEntityRaw ?? null,
    subjectEntity: subjectNormalization?.normalizedSubjectEntity ?? null,
    opponentEntity: subjectNormalization?.normalizedOpponentEntity ?? null,
    matchupKey: subjectNormalization?.matchupKey ?? null,
    canonicalSortedTeams: subjectNormalization?.canonicalSortedTeams ?? [],
    sideAssignment: subjectNormalization?.sideAssignment ?? null,
    sideAssignmentSource: subjectNormalization?.sideAssignmentSource ?? null,
    outcomeMappingBasis: subjectNormalization?.outcomeMappingBasis ?? null,
    titleNoiseStripped: subjectNormalization?.titleNoiseStripped ?? false,
    blockers
  };
};

const buildDateEvaluation = (market: MatchingMarketRecord, pocket: SportsPocket | null): SportsPocketDateEvaluation => {
  const boundary = extractSportsBoundaryDetailed(market);
  const blockers: string[] = [];
  const cutoffTimestamp =
    boundary.scheduledBoundaryKey
    ?? (market.resolvesAt && market.resolvesAt.getUTCFullYear() > 1971 ? market.resolvesAt.toISOString() : null)
    ?? (market.expiresAt && market.expiresAt.getUTCFullYear() > 1971 ? market.expiresAt.toISOString() : null)
    ?? null;

  if (!boundary.dateKey) {
    blockers.push("MISSING_EVENT_DATE");
  }
  if (!cutoffTimestamp) {
    blockers.push("MISSING_CUTOFF");
  }
  if (boundary.status === "DATE_AMBIGUOUS") {
    blockers.push("DATE_BUCKET_AMBIGUOUS");
  }
  if ((boundary.status === "DATE_MISSING" || boundary.status === "DATE_INVALID") && !cutoffTimestamp) {
    blockers.push("TIMEZONE_UNCERTAIN");
  }

  return {
    market,
    pocket,
    accepted: blockers.length === 0 && pocket !== null,
    eventDate: boundary.dateKey,
    cutoffTimestamp,
    timezoneNormalizedCutoff: boundary.scheduledBoundaryKey ?? cutoffTimestamp,
    dateWindowBucket: boundary.dateKey,
    dateWindowConfidence:
      boundary.status === "DATE_CONFIRMED" ? "1"
      : boundary.status === "DATE_INFERRED" ? "0.7"
      : boundary.dateKey ? "0.4"
      : "0.2",
    dateSourceProvenance: boundary.dateSourceProvenance,
    rawDateText: boundary.rawDateText,
    parsedTimestamp: boundary.parsedTimestamp,
    dateStatus: boundary.status,
    timestampSource: boundary.timestampSource,
    yearSource: boundary.yearSource,
    unsafeDefaultReasons: boundary.unsafeDefaultReasons,
    blockers
  };
};

const buildOutcomeEvaluation = (
  market: MatchingMarketRecord,
  pocket: SportsPocket | null,
  entityEvaluation: SportsPocketEntityEvaluation
): SportsPocketOutcomeEvaluation => {
  const labels = extractOutcomeLabels(market);
  const nonYesNoLabels = labels.filter((label) => !isYesNoLabel(label));
  const blockers: string[] = [];
  if (market.marketClass !== "BINARY") {
    blockers.push("NON_COMPARABLE_BINARY_SHAPE");
  }
  if (entityEvaluation.outcomeMappingBasis === "YES_NO_SINGLE_SIDE") {
    blockers.push("NON_COMPARABLE_BINARY_SHAPE");
    blockers.push("SIDE_MAPPING_MISMATCH");
  }
  if (nonYesNoLabels.length !== 2 && entityEvaluation.outcomeMappingBasis !== "DIRECT_MATCH_WINNER") {
    blockers.push("OUTCOME_STRUCTURE_MISMATCH");
  }
  if (
    nonYesNoLabels.length === 2
    && entityEvaluation.subjectEntity
    && entityEvaluation.opponentEntity
  ) {
    const left = normalizeSportsEntity(nonYesNoLabels[0] ?? null);
    const right = normalizeSportsEntity(nonYesNoLabels[1] ?? null);
    if (buildSortedMatchupKey(left, right) !== entityEvaluation.matchupKey) {
      blockers.push("SIDE_MAPPING_MISMATCH");
    }
  }

  return {
    market,
    pocket,
    accepted: blockers.length === 0 && pocket !== null,
    outcomeMappingBasis: entityEvaluation.outcomeMappingBasis,
    blockers: [...new Set(blockers)]
  };
};

const buildPocketFingerprint = (input: {
  market: MatchingMarketRecord;
  pocket: SportsPocket;
  competitionContext: SportsCompetitionContext;
  entityEvaluation: SportsPocketEntityEvaluation;
  dateEvaluation: SportsPocketDateEvaluation;
  outcomeEvaluation: SportsPocketOutcomeEvaluation;
}): StructuralFingerprint => {
  const fingerprint = canonicalizeJsonRecord({
    venue: input.market.venue,
    venueMarketId: input.market.venueMarketId,
    domain: input.competitionContext.domain,
    family: "MATCHUP_WINNER",
    pocket: input.pocket,
    competitionKey: input.competitionContext.competitionKey,
    competitionScope: "MATCH",
    subjectEntity: input.entityEvaluation.subjectEntity,
    opponentEntity: input.entityEvaluation.opponentEntity,
    matchupKey: input.entityEvaluation.matchupKey,
    dateKey: input.dateEvaluation.eventDate,
    scheduledBoundaryKey: input.dateEvaluation.timezoneNormalizedCutoff,
    cutoffTimestamp: input.dateEvaluation.cutoffTimestamp,
    timezoneNormalizedCutoffKey: input.dateEvaluation.timezoneNormalizedCutoff,
    dateWindowBucket: input.dateEvaluation.dateWindowBucket,
    binaryStructure: input.market.marketClass.toLowerCase(),
    outcomeMappingBasis: input.outcomeEvaluation.outcomeMappingBasis,
    sideAssignment: input.entityEvaluation.sideAssignment,
    winnerSemantics: "winner"
  });

  return {
    interpretedContractId: input.market.interpretedContractId,
    fingerprintHash: JSON.stringify(fingerprint),
    fingerprint,
    normalizedValues: canonicalizeJsonRecord({
      title: input.market.title,
      rules: input.market.rulesText ?? ""
    }),
    unresolvedDimensions: Object.entries(fingerprint)
      .filter((entry) => entry[1] === null || entry[1] === "")
      .map(([key]) => key),
    provenance: canonicalizeJsonRecord({
      fingerprintVersion: "sports-pocket-structural-fingerprint-v1",
      pocket: input.pocket,
      dateSourceProvenance: input.dateEvaluation.dateSourceProvenance
    }),
    fingerprintVersion: "sports-pocket-structural-fingerprint-v1"
  };
};

const prefilterPocketPair = (left: PocketReadyMarket, right: PocketReadyMarket): { accepted: boolean; reasons: readonly string[]; ruleIds: readonly string[] } => {
  const reasons: string[] = [];
  if (left.pocket !== right.pocket) reasons.push("POCKET_MISMATCH");
  if (left.fingerprint.fingerprint["competitionScope"] !== right.fingerprint.fingerprint["competitionScope"]) reasons.push("NON_COMPARABLE_MATCH_SCOPE");
  if (left.entityEvaluation.matchupKey !== right.entityEvaluation.matchupKey) reasons.push("SUBJECT_ENTITY_MISMATCH");
  if (
    left.entityEvaluation.matchupKey === null
    || right.entityEvaluation.matchupKey === null
    || left.entityEvaluation.matchupKey !== right.entityEvaluation.matchupKey
  ) {
    if (left.entityEvaluation.opponentEntity !== right.entityEvaluation.opponentEntity) reasons.push("OPPONENT_MISMATCH");
  }
  if (left.dateEvaluation.eventDate !== right.dateEvaluation.eventDate || left.dateEvaluation.timezoneNormalizedCutoff !== right.dateEvaluation.timezoneNormalizedCutoff) reasons.push("DATE_WINDOW_MISMATCH");
  if (left.outcomeEvaluation.outcomeMappingBasis !== right.outcomeEvaluation.outcomeMappingBasis) reasons.push("OUTCOME_STRUCTURE_MISMATCH");
  if (left.entityEvaluation.sideAssignment !== right.entityEvaluation.sideAssignment) reasons.push("SIDE_ASSIGNMENT_MISMATCH");
  return {
    accepted: reasons.length === 0,
    reasons,
    ruleIds: ["sports-pocket-prefilter-v1"]
  };
};

const runPocketStructuralMatcher = (left: PocketReadyMarket, right: PocketReadyMarket): SportsStructuralMatchResult => {
  const mismatched: string[] = [];
  const matched: string[] = [];
  const compare = (name: string, condition: boolean): void => {
    if (condition) matched.push(name);
    else mismatched.push(name);
  };
  compare("pocket", left.pocket === right.pocket);
  compare("matchupKey", left.entityEvaluation.matchupKey === right.entityEvaluation.matchupKey);
  compare("eventDate", left.dateEvaluation.eventDate === right.dateEvaluation.eventDate);
  compare("cutoffTimestamp", left.dateEvaluation.timezoneNormalizedCutoff === right.dateEvaluation.timezoneNormalizedCutoff);
  compare("outcomeMappingBasis", left.outcomeEvaluation.outcomeMappingBasis === right.outcomeEvaluation.outcomeMappingBasis);
  compare("binaryStructure", left.fingerprint.fingerprint["binaryStructure"] === right.fingerprint.fingerprint["binaryStructure"]);
  compare("sideAssignment", left.entityEvaluation.sideAssignment === right.entityEvaluation.sideAssignment);

  if (mismatched.length === 0) {
    return {
      outcome: "EXACT",
      reasons: ["sports_pocket_structural_exact"],
      matchedDimensions: matched,
      mismatchedDimensions: mismatched,
      ruleIds: ["sports-pocket-structural-matcher-v1"]
    };
  }

  const classifierCompatible = mismatched.every((value) => value === "cutoffTimestamp");
  if (classifierCompatible) {
    return {
      outcome: "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER",
      reasons: mismatched.map((value) => `structural:${value}_mismatch`),
      matchedDimensions: matched,
      mismatchedDimensions: mismatched,
      ruleIds: ["sports-pocket-structural-matcher-v1", "compatible_for_pocket_classifier"]
    };
  }

  return {
    outcome: "REJECTED",
    reasons: mismatched.map((value) => `structural:${value}_mismatch`),
    matchedDimensions: matched,
    mismatchedDimensions: mismatched,
    ruleIds: ["sports-pocket-structural-matcher-v1", "structural_rejected"]
  };
};

export class SportsPocketMatchingPipeline {
  public constructor(private readonly repository: SportsPocketRepositoryLike) {}

  public async run(): Promise<SportsPocketMatchingPipelineResult> {
    const matchingVersion = buildMatchingVersionRecord(SPORTS_POCKET_VERSION_DESCRIPTOR);
    await this.repository.upsertMatchingVersion(matchingVersion);

    const [sourceMarkets, compatibilityDecisions] = await Promise.all([
      this.repository.listMatchingMarkets(),
      this.repository.listCompatibilityDecisions()
    ]);
    const classifiedMarkets = sourceMarkets.filter(isTargetMarket);
    const classifications = classifiedMarkets.map((market) => classifySportsFamily(market));
    const competitionContexts = classifications.map((classification, index) =>
      classification.metadata["taxonomyStatus"] === "ADMITTED" && classification.family === "MATCHUP_WINNER" && typeof classification.metadata["domain"] === "string"
        ? normalizeSportsCompetitionContext({
          market: classifiedMarkets[index]!,
          domain: classification.metadata["domain"] as SportsCompetitionContext["domain"],
          family: "MATCHUP_WINNER"
        })
        : null
    );

    const admissionEvaluations = classifiedMarkets.map((market, index) =>
      buildPocketAdmissionEvaluation(market, classifications[index]!, competitionContexts[index] ?? null)
    );
    const subjectNormalizations = classifications.map((classification, index) =>
      classification.metadata["taxonomyStatus"] === "ADMITTED" && classification.family === "MATCHUP_WINNER"
        ? normalizeSportsSubjectEntities({
          market: classifiedMarkets[index]!,
          family: "MATCHUP_WINNER"
        })
        : null
    );
    const entityEvaluations = classifiedMarkets.map((market, index) =>
      buildEntityEvaluation(market, admissionEvaluations[index]!.pocket, subjectNormalizations[index] ?? null)
    );
    const dateEvaluations = classifiedMarkets.map((market, index) =>
      buildDateEvaluation(market, admissionEvaluations[index]!.pocket)
    );
    const outcomeEvaluations = classifiedMarkets.map((market, index) =>
      buildOutcomeEvaluation(market, admissionEvaluations[index]!.pocket, entityEvaluations[index]!)
    );

    const readyMarkets: PocketReadyMarket[] = [];
    const fingerprints: StructuralFingerprint[] = [];

    for (let index = 0; index < classifiedMarkets.length; index += 1) {
      const admission = admissionEvaluations[index]!;
      const entity = entityEvaluations[index]!;
      const date = dateEvaluations[index]!;
      const outcome = outcomeEvaluations[index]!;
      const classification = classifications[index]!;
      const competitionContext = competitionContexts[index];
      if (!admission.accepted || !entity.accepted || !date.accepted || !outcome.accepted || !competitionContext || !admission.pocket) {
        continue;
      }
      const fingerprint = buildPocketFingerprint({
        market: classifiedMarkets[index]!,
        pocket: admission.pocket,
        competitionContext,
        entityEvaluation: entity,
        dateEvaluation: date,
        outcomeEvaluation: outcome
      });
      readyMarkets.push({
        market: classifiedMarkets[index]!,
        classification,
        pocket: admission.pocket,
        competitionContext,
        subjectNormalization: subjectNormalizations[index]!,
        entityEvaluation: entity,
        dateEvaluation: date,
        outcomeEvaluation: outcome,
        fingerprint
      });
      fingerprints.push(fingerprint);
      await this.repository.upsertMarketClassification(classification);
      await this.repository.upsertStructuralFingerprint(fingerprint);
    }

    const compatibilityLookup = buildCompatibilityLookup(compatibilityDecisions);
    const pairEdges: PairEdgeRecord[] = [];
    const prefilterEvaluations: SportsPocketPrefilterEvaluation[] = [];
    const pairEvaluations: SportsPocketPairEvaluation[] = [];
    const candidateRejectionReasons: string[] = [];

    for (let index = 0; index < readyMarkets.length; index += 1) {
      for (let inner = index + 1; inner < readyMarkets.length; inner += 1) {
        const left = readyMarkets[index]!;
        const right = readyMarkets[inner]!;
        if (!shouldComparePair(left.market, right.market)) {
          continue;
        }
        const prefilter = prefilterPocketPair(left, right);
        const venuePair = buildSportsVenuePairKey(left.market.venue as SportsTargetVenue, right.market.venue as SportsTargetVenue);
        if (!prefilter.accepted) {
          prefilterEvaluations.push({
            pocket: left.pocket,
            venuePair,
            leftInterpretedContractId: left.market.interpretedContractId,
            rightInterpretedContractId: right.market.interpretedContractId,
            leftVenue: left.market.venue,
            rightVenue: right.market.venue,
            leftTitle: left.market.title,
            rightTitle: right.market.title,
            leftTemporalBasis: left.market.inventoryTemporalBasis,
            rightTemporalBasis: right.market.inventoryTemporalBasis,
            leftSourceMetadataVersion: left.market.sourceMetadataVersion,
            rightSourceMetadataVersion: right.market.sourceMetadataVersion,
            leftHistoricalRowCount: left.market.historicalRowCount,
            rightHistoricalRowCount: right.market.historicalRowCount,
            leftSubjectEntity: left.entityEvaluation.subjectEntity,
            rightSubjectEntity: right.entityEvaluation.subjectEntity,
            leftOpponentEntity: left.entityEvaluation.opponentEntity,
            rightOpponentEntity: right.entityEvaluation.opponentEntity,
            leftMatchupKey: left.entityEvaluation.matchupKey,
            rightMatchupKey: right.entityEvaluation.matchupKey,
            leftDateKey: left.dateEvaluation.eventDate,
            rightDateKey: right.dateEvaluation.eventDate,
            leftCutoffTimestamp: left.dateEvaluation.timezoneNormalizedCutoff,
            rightCutoffTimestamp: right.dateEvaluation.timezoneNormalizedCutoff,
            leftDateSourceProvenance: left.dateEvaluation.dateSourceProvenance,
            rightDateSourceProvenance: right.dateEvaluation.dateSourceProvenance,
            leftOutcomeMappingBasis: left.outcomeEvaluation.outcomeMappingBasis,
            rightOutcomeMappingBasis: right.outcomeEvaluation.outcomeMappingBasis,
            leftSideAssignment: left.entityEvaluation.sideAssignment,
            rightSideAssignment: right.entityEvaluation.sideAssignment,
            accepted: false,
            reasons: prefilter.reasons
          });
          candidateRejectionReasons.push(...prefilter.reasons);
          continue;
        }
        prefilterEvaluations.push({
          pocket: left.pocket,
          venuePair,
          leftInterpretedContractId: left.market.interpretedContractId,
          rightInterpretedContractId: right.market.interpretedContractId,
          leftVenue: left.market.venue,
          rightVenue: right.market.venue,
          leftTitle: left.market.title,
          rightTitle: right.market.title,
          leftTemporalBasis: left.market.inventoryTemporalBasis,
          rightTemporalBasis: right.market.inventoryTemporalBasis,
          leftSourceMetadataVersion: left.market.sourceMetadataVersion,
          rightSourceMetadataVersion: right.market.sourceMetadataVersion,
          leftHistoricalRowCount: left.market.historicalRowCount,
          rightHistoricalRowCount: right.market.historicalRowCount,
          leftSubjectEntity: left.entityEvaluation.subjectEntity,
          rightSubjectEntity: right.entityEvaluation.subjectEntity,
          leftOpponentEntity: left.entityEvaluation.opponentEntity,
          rightOpponentEntity: right.entityEvaluation.opponentEntity,
          leftMatchupKey: left.entityEvaluation.matchupKey,
          rightMatchupKey: right.entityEvaluation.matchupKey,
          leftDateKey: left.dateEvaluation.eventDate,
          rightDateKey: right.dateEvaluation.eventDate,
          leftCutoffTimestamp: left.dateEvaluation.timezoneNormalizedCutoff,
          rightCutoffTimestamp: right.dateEvaluation.timezoneNormalizedCutoff,
          leftDateSourceProvenance: left.dateEvaluation.dateSourceProvenance,
          rightDateSourceProvenance: right.dateEvaluation.dateSourceProvenance,
          leftOutcomeMappingBasis: left.outcomeEvaluation.outcomeMappingBasis,
          rightOutcomeMappingBasis: right.outcomeEvaluation.outcomeMappingBasis,
          leftSideAssignment: left.entityEvaluation.sideAssignment,
          rightSideAssignment: right.entityEvaluation.sideAssignment,
          accepted: true,
          reasons: []
        });
        const structuralMatch = runPocketStructuralMatcher(left, right);
        const classifierResult: SportsPairClassifierResult | null =
          structuralMatch.outcome === "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER"
            ? classifySportsPair({ leftFingerprint: left.fingerprint, rightFingerprint: right.fingerprint })
            : null;
        const approvalDecision = applyReviewApprovalPolicy({
          structuralMatch,
          classifierResult
        });
        const compatibilityDecision = compatibilityLookup.get(
          compatibilityKey(left.market.interpretedContractId, right.market.interpretedContractId)
        );
        const pairEdge = buildSportsPairEdgeRecord({
          leftMarket: left.market,
          rightMarket: right.market,
          leftFamily: left.classification,
          rightFamily: right.classification,
          leftFingerprint: left.fingerprint,
          rightFingerprint: right.fingerprint,
          prefilterRuleIds: prefilter.ruleIds,
          structuralMatch,
          classifierResult,
          approvalDecision,
          temporalBasis: classifyRouteabilityBasis([
            left.market.inventoryTemporalBasis,
            right.market.inventoryTemporalBasis
          ]),
          matchingVersion,
          compatibilityDecisionId: compatibilityDecision?.id ?? null,
          compatibilityClass: compatibilityDecision?.compatibilityClass ?? null
        });
        await this.repository.upsertPairEdge(pairEdge);
        pairEdges.push(pairEdge);
        pairEvaluations.push({
          pocket: left.pocket,
          venuePair,
          finalLabel: pairEdge.label,
          approvalState: pairEdge.approvalState,
          rejectionReasons: pairEdge.rejectionReasons,
          edgeId: pairEdge.id
        });
        if (pairEdge.rejectionReasons.length > 0) {
          candidateRejectionReasons.push(...pairEdge.rejectionReasons);
        }
      }
    }

    return {
      matchingVersion,
      sourceMarkets,
      pocketMarkets: readyMarkets.map((entry) => entry.market),
      pairEdges,
      pairGraph: buildSportsPairGraph(pairEdges),
      admissionEvaluations,
      entityEvaluations,
      dateEvaluations,
      outcomeEvaluations,
      prefilterEvaluations,
      pairEvaluations,
      candidateRejectionReasons
    };
  }
}

export const createSportsPocketMatchingPipeline = (repository: PairEdgeRepository): SportsPocketMatchingPipeline =>
  new SportsPocketMatchingPipeline(repository);
