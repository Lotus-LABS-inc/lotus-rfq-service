import { classifyRouteabilityBasis } from "../../inventory/inventory-basis-classifier.js";
import { PairEdgeRepository } from "../../repositories/pair-edge.repository.js";
import type { CompatibilityDecision } from "../../canonical/compatibility-decision.js";
import { buildMatchingVersionRecord, type MatchingVersionRecord } from "../matching-versioning.js";
import { applyReviewApprovalPolicy } from "../review-approval-policy.js";
import type { ContractFamilyClassification, MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../matching-types.js";
import {
  buildSportsVenuePairKey,
  sportsAllowedVenuePairs,
  sportsTargetVenueValues,
  type SportsScopedDomain,
  type SportsScopedFamily,
  type SportsTargetVenue,
  type SportsTaxonomyStatus
} from "./sports-match-labels.js";
import { buildSportsPairEdgeRecord } from "./sports-pair-edge-builder.js";
import { buildSportsPairGraph, type SportsPairGraph } from "./sports-pair-graph.js";
import { classifySportsFamily, isSportsFamilyInScope, type SportsFamilyTaxonomyClassification } from "./sports-family-classifier.js";
import { normalizeSportsCompetitionContext, type SportsCompetitionContext } from "./sports-competition-context.js";
import { normalizeSportsSubjectEntities, type SportsSubjectNormalization } from "./sports-subject-entity.js";
import { buildSportsStructuralFingerprint } from "./sports-structural-fingerprint.js";
import { prefilterSportsCandidatePair } from "./sports-candidate-prefilter.js";
import { runSportsStructuralMatcher, type SportsStructuralMatchResult } from "./sports-structural-matcher.js";
import { classifySportsPair, type SportsPairClassifierResult } from "./sports-pair-classifier.js";

const SPORTS_VERSION_DESCRIPTOR = {
  familyClassifierVersion: "sports-family-classifier-v1",
  fingerprintVersion: "sports-structural-fingerprint-v1",
  prefilterVersion: "sports-candidate-prefilter-v1",
  structuralMatcherVersion: "sports-structural-matcher-v1",
  pairClassifierVersion: "sports-pair-classifier-v1",
  embeddingModelVersion: "sports-embeddings-disabled-v1",
  reviewPolicyVersion: "pair-review-policy-v1"
} as const;

interface SportsRepositoryLike {
  upsertMatchingVersion(record: MatchingVersionRecord): Promise<void>;
  listMatchingMarkets(): Promise<readonly MatchingMarketRecord[]>;
  listCompatibilityDecisions(): Promise<readonly CompatibilityDecision[]>;
  upsertMarketClassification(classification: ContractFamilyClassification): Promise<void>;
  upsertStructuralFingerprint(fingerprint: StructuralFingerprint): Promise<void>;
  upsertPairEdge(edge: PairEdgeRecord): Promise<void>;
}

export interface SportsTaxonomyEvaluation {
  market: MatchingMarketRecord;
  classification: SportsFamilyTaxonomyClassification;
  domain: SportsScopedDomain | null;
  taxonomyStatus: SportsTaxonomyStatus;
  scopeReasons: readonly string[];
}

export interface SportsCompetitionEvaluation {
  market: MatchingMarketRecord;
  family: SportsScopedFamily | null;
  context: SportsCompetitionContext | null;
  accepted: boolean;
  blockers: readonly string[];
}

export interface SportsSubjectEvaluation {
  market: MatchingMarketRecord;
  family: SportsScopedFamily | null;
  normalization: SportsSubjectNormalization | null;
  accepted: boolean;
  blockers: readonly string[];
}

export interface SportsPrefilterEvaluation {
  domain: string;
  family: string;
  venuePair: string;
  accepted: boolean;
  reasons: readonly string[];
}

export interface SportsPairEvaluation {
  domain: string;
  family: string;
  venuePair: string;
  finalLabel: PairEdgeRecord["label"];
  approvalState: PairEdgeRecord["approvalState"];
  rejectionReasons: readonly string[];
  edgeId: string;
}

export interface SportsMatchingPipelineResult {
  matchingVersion: MatchingVersionRecord;
  sourceMarkets: readonly MatchingMarketRecord[];
  classifiedMarkets: readonly MatchingMarketRecord[];
  eligibleMarkets: readonly MatchingMarketRecord[];
  classifications: readonly SportsFamilyTaxonomyClassification[];
  competitionContexts: readonly (SportsCompetitionContext | null)[];
  subjectNormalizations: readonly (SportsSubjectNormalization | null)[];
  fingerprints: readonly StructuralFingerprint[];
  pairEdges: readonly PairEdgeRecord[];
  pairGraph: SportsPairGraph;
  candidateRejectionReasons: readonly string[];
  structuralLaneRejections: readonly string[];
  taxonomyEvaluations: readonly SportsTaxonomyEvaluation[];
  competitionEvaluations: readonly SportsCompetitionEvaluation[];
  subjectEvaluations: readonly SportsSubjectEvaluation[];
  prefilterEvaluations: readonly SportsPrefilterEvaluation[];
  pairEvaluations: readonly SportsPairEvaluation[];
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

interface ComparedPair {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: SportsFamilyTaxonomyClassification;
  rightFamily: SportsFamilyTaxonomyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
  structuralMatch: SportsStructuralMatchResult;
  classifierResult: SportsPairClassifierResult | null;
  prefilterRuleIds: readonly string[];
}

const comparePair = (
  leftMarket: MatchingMarketRecord,
  rightMarket: MatchingMarketRecord,
  leftFamily: SportsFamilyTaxonomyClassification,
  rightFamily: SportsFamilyTaxonomyClassification,
  leftFingerprint: StructuralFingerprint,
  rightFingerprint: StructuralFingerprint
): ComparedPair | { rejectedReasons: readonly string[] } => {
  const prefilter = prefilterSportsCandidatePair({ leftFingerprint, rightFingerprint });
  if (!prefilter.accepted) {
    return { rejectedReasons: prefilter.reasons };
  }
  const structuralMatch = runSportsStructuralMatcher({ leftFingerprint, rightFingerprint });
  const classifierResult =
    structuralMatch.outcome === "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER"
      ? classifySportsPair({ leftFingerprint, rightFingerprint })
      : null;
  return {
    leftMarket,
    rightMarket,
    leftFamily,
    rightFamily,
    leftFingerprint,
    rightFingerprint,
    structuralMatch,
    classifierResult,
    prefilterRuleIds: prefilter.ruleIds
  };
};

const buildFallbackFingerprint = (
  market: MatchingMarketRecord,
  classification: SportsFamilyTaxonomyClassification
): StructuralFingerprint =>
  buildSportsStructuralFingerprint({
    market,
    domain: (typeof classification.metadata["domain"] === "string"
      ? classification.metadata["domain"]
      : (market.category === "ESPORTS" ? "ESPORTS" : "SPORTS")) as SportsScopedDomain,
    family: "MATCHUP_WINNER",
    competitionContext: {
      domain: (typeof classification.metadata["domain"] === "string"
        ? classification.metadata["domain"]
        : (market.category === "ESPORTS" ? "ESPORTS" : "SPORTS")) as SportsScopedDomain,
      family: "MATCHUP_WINNER",
      sportOrEsport: null,
      competitionKey: null,
      competitionLabel: null,
      competitionScope: "MATCH",
      stageOrRound: null,
      confidence: "0",
      blockers: ["COMPETITION_SCOPE_MISSING"]
    },
    subjectNormalization: {
      family: "MATCHUP_WINNER",
      subjectEntityRaw: null,
      opponentEntityRaw: null,
      normalizedSubjectEntity: null,
      normalizedOpponentEntity: null,
      matchupKey: null,
      canonicalSortedTeams: [],
      aliasSet: [],
      entityType: "OTHER",
      sideAssignment: "UNKNOWN",
      sideAssignmentSource: "UNKNOWN",
      outcomeMappingBasis: "UNKNOWN",
      confidence: "0",
      titleNoiseStripped: false,
      blockers: ["UNRESOLVED_ALIAS"]
    }
  });

export class SportsMatchingPipeline {
  public constructor(private readonly repository: SportsRepositoryLike) {}

  public async run(): Promise<SportsMatchingPipelineResult> {
    const matchingVersion = buildMatchingVersionRecord(SPORTS_VERSION_DESCRIPTOR);
    await this.repository.upsertMatchingVersion(matchingVersion);

    const [sourceMarkets, compatibilityDecisions] = await Promise.all([
      this.repository.listMatchingMarkets(),
      this.repository.listCompatibilityDecisions()
    ]);

    const classifiedMarkets = sourceMarkets.filter(isTargetMarket);
    const classifications = classifiedMarkets.map((market) => classifySportsFamily(market));
    const competitionContexts = classifications.map((classification, index) => {
      const domain = classification.metadata["domain"];
      if (classification.metadata["taxonomyStatus"] !== "ADMITTED" || typeof domain !== "string" || !isSportsFamilyInScope(classification.family)) {
        return null;
      }
      return normalizeSportsCompetitionContext({
        market: classifiedMarkets[index]!,
        domain: domain as SportsScopedDomain,
        family: classification.family
      });
    });
    const subjectNormalizations = classifications.map((classification, index) => {
      if (classification.metadata["taxonomyStatus"] !== "ADMITTED" || !isSportsFamilyInScope(classification.family)) {
        return null;
      }
      return normalizeSportsSubjectEntities({
        market: classifiedMarkets[index]!,
        family: classification.family
      });
    });
    const fingerprints = classifications.map((classification, index) => {
      const market = classifiedMarkets[index]!;
      const domain = classification.metadata["domain"];
      const context = competitionContexts[index];
      const subject = subjectNormalizations[index];
      if (typeof domain === "string" && context && subject && isSportsFamilyInScope(classification.family)) {
        return buildSportsStructuralFingerprint({
          market,
          domain: domain as SportsScopedDomain,
          family: classification.family,
          competitionContext: context,
          subjectNormalization: subject
        });
      }
      return buildFallbackFingerprint(market, classification);
    });

    await Promise.all(classifications.map((entry) => this.repository.upsertMarketClassification(entry)));
    await Promise.all(fingerprints.map((entry) => this.repository.upsertStructuralFingerprint(entry)));

    const taxonomyEvaluations = classifications.map((classification, index) => ({
      market: classifiedMarkets[index]!,
      classification,
      domain: (typeof classification.metadata["domain"] === "string" ? classification.metadata["domain"] : null) as SportsScopedDomain | null,
      taxonomyStatus: classification.metadata["taxonomyStatus"] as SportsTaxonomyStatus,
      scopeReasons: classification.metadata["scopeRejectionReasons"] as readonly string[]
    }));

    const competitionEvaluations = classifiedMarkets.map((market, index) => ({
      market,
      family: isSportsFamilyInScope(classifications[index]!.family) ? classifications[index]!.family : null,
      context: competitionContexts[index] ?? null,
      accepted: competitionContexts[index] !== null && competitionContexts[index] !== undefined && competitionContexts[index]!.blockers.length === 0,
      blockers: competitionContexts[index]?.blockers ?? ["COMPETITION_SCOPE_MISSING"]
    }));

    const subjectEvaluations = classifiedMarkets.map((market, index) => ({
      market,
      family: isSportsFamilyInScope(classifications[index]!.family) ? classifications[index]!.family : null,
      normalization: subjectNormalizations[index] ?? null,
      accepted: subjectNormalizations[index] !== null && subjectNormalizations[index] !== undefined && subjectNormalizations[index]!.blockers.length === 0,
      blockers: subjectNormalizations[index]?.blockers ?? ["UNRESOLVED_ALIAS"]
    }));

    const eligibleIndexes = classifications
      .map((classification, index) => ({ classification, index }))
      .filter(({ classification, index }) =>
        classification.metadata["taxonomyStatus"] === "ADMITTED"
        && isSportsFamilyInScope(classification.family)
        && competitionContexts[index] !== null
        && competitionContexts[index]!.blockers.length === 0
        && subjectNormalizations[index] !== null
        && subjectNormalizations[index]!.blockers.length === 0
      )
      .map(({ index }) => index);

    const eligibleMarkets = eligibleIndexes.map((index) => classifiedMarkets[index]!);
    const structuralLaneRejections = [
      ...taxonomyEvaluations.filter((entry) => entry.taxonomyStatus !== "ADMITTED").flatMap((entry) => entry.scopeReasons),
      ...competitionEvaluations.filter((entry) => !entry.accepted).flatMap((entry) => entry.blockers),
      ...subjectEvaluations.filter((entry) => !entry.accepted).flatMap((entry) => entry.blockers)
    ];

    const compatibilityLookup = buildCompatibilityLookup(compatibilityDecisions);
    const pairEdges: PairEdgeRecord[] = [];
    const candidateRejectionReasons: string[] = [];
    const prefilterEvaluations: SportsPrefilterEvaluation[] = [];
    const pairEvaluations: SportsPairEvaluation[] = [];

    for (let index = 0; index < eligibleIndexes.length; index += 1) {
      for (let inner = index + 1; inner < eligibleIndexes.length; inner += 1) {
        const leftIndex = eligibleIndexes[index]!;
        const rightIndex = eligibleIndexes[inner]!;
        const leftMarket = classifiedMarkets[leftIndex]!;
        const rightMarket = classifiedMarkets[rightIndex]!;
        if (!shouldComparePair(leftMarket, rightMarket)) {
          continue;
        }

        const compared = comparePair(
          leftMarket,
          rightMarket,
          classifications[leftIndex]!,
          classifications[rightIndex]!,
          fingerprints[leftIndex]!,
          fingerprints[rightIndex]!
        );

        const venuePair = buildSportsVenuePairKey(leftMarket.venue as SportsTargetVenue, rightMarket.venue as SportsTargetVenue);
        const domain = typeof classifications[leftIndex]!.metadata["domain"] === "string"
          ? classifications[leftIndex]!.metadata["domain"] as string
          : leftMarket.category;

        if ("rejectedReasons" in compared) {
          prefilterEvaluations.push({
            domain,
            family: classifications[leftIndex]!.family,
            venuePair,
            accepted: false,
            reasons: compared.rejectedReasons
          });
          candidateRejectionReasons.push(...compared.rejectedReasons);
          continue;
        }

        prefilterEvaluations.push({
          domain,
          family: compared.leftFamily.family,
          venuePair,
          accepted: true,
          reasons: []
        });

        const compatibilityDecision = compatibilityLookup.get(
          compatibilityKey(leftMarket.interpretedContractId, rightMarket.interpretedContractId)
        );
        const approvalDecision = applyReviewApprovalPolicy({
          structuralMatch: compared.structuralMatch,
          classifierResult: compared.classifierResult
        });
        const pairEdge = buildSportsPairEdgeRecord({
          ...compared,
          approvalDecision,
          temporalBasis: classifyRouteabilityBasis([
            leftMarket.inventoryTemporalBasis,
            rightMarket.inventoryTemporalBasis
          ]),
          matchingVersion,
          compatibilityDecisionId: compatibilityDecision?.id ?? null,
          compatibilityClass: compatibilityDecision?.compatibilityClass ?? null
        });
        await this.repository.upsertPairEdge(pairEdge);
        pairEdges.push(pairEdge);
        pairEvaluations.push({
          domain,
          family: compared.leftFamily.family,
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
      classifiedMarkets,
      eligibleMarkets,
      classifications,
      competitionContexts,
      subjectNormalizations,
      fingerprints,
      pairEdges,
      pairGraph: buildSportsPairGraph(pairEdges),
      candidateRejectionReasons,
      structuralLaneRejections,
      taxonomyEvaluations,
      competitionEvaluations,
      subjectEvaluations,
      prefilterEvaluations,
      pairEvaluations
    };
  }
}

export const createSportsMatchingPipeline = (repository: PairEdgeRepository): SportsMatchingPipeline =>
  new SportsMatchingPipeline(repository);
