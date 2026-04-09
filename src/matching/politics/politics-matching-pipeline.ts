import { classifyRouteabilityBasis } from "../../inventory/inventory-basis-classifier.js";
import type { CompatibilityDecision } from "../../canonical/compatibility-decision.js";
import type { MatchingVersionRecord } from "../matching-versioning.js";
import { buildMatchingVersionRecord } from "../matching-versioning.js";
import { applyReviewApprovalPolicy } from "../review-approval-policy.js";
import { buildPairGraph } from "../pair-graph.js";
import { deriveTriCandidates, type TriCandidate } from "../tri-deriver.js";
import type { ContractFamilyClassification, MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../matching-types.js";
import { extractPoliticsInventoryRow, isPoliticsCandidateMarket } from "./politics-inventory-extractor.js";
import {
  buildFamilyEligibilityLookup,
  buildPoliticsDerivedFamilyTaxonomy,
  toPoliticsContractFamily
} from "./politics-family-derivation.js";
import type {
  PoliticsDerivedFamilyDefinition,
  PoliticsExtractedRow,
  PoliticsFamilyEligibility,
  PoliticsPairRejection
} from "./politics-types.js";
import { buildPoliticsStructuralFingerprint, buildPoliticsStructuralFingerprintRecord } from "./politics-structural-fingerprint.js";
import { prefilterPoliticsCandidatePair } from "./politics-candidate-prefilter.js";
import { runPoliticsStructuralMatcher } from "./politics-structural-matcher.js";
import { buildPoliticsPairEdgeRecord } from "./politics-pair-edge-builder.js";

const POLITICS_VERSION_DESCRIPTOR = {
  familyClassifierVersion: "politics-family-derivation-v1",
  fingerprintVersion: "politics-structural-fingerprint-v1",
  prefilterVersion: "politics-candidate-prefilter-v1",
  structuralMatcherVersion: "politics-structural-matcher-v1",
  pairClassifierVersion: "politics-exact-only-v1",
  embeddingModelVersion: "politics-embeddings-disabled-v1",
  reviewPolicyVersion: "pair-review-policy-v1"
} as const;

interface PoliticsRepositoryLike {
  upsertMatchingVersion(record: MatchingVersionRecord): Promise<void>;
  listMatchingMarkets(): Promise<readonly MatchingMarketRecord[]>;
  listCompatibilityDecisions(): Promise<readonly CompatibilityDecision[]>;
  upsertMarketClassification(classification: ContractFamilyClassification): Promise<void>;
  upsertStructuralFingerprint(fingerprint: StructuralFingerprint): Promise<void>;
  upsertPairEdge(edge: PairEdgeRecord): Promise<void>;
}

export interface PoliticsPrefilterEvaluation {
  family: string;
  venuePair: string;
  leftInterpretedContractId: string;
  rightInterpretedContractId: string;
  accepted: boolean;
  reasons: readonly PoliticsPairRejection[];
}

export interface PoliticsPairEvaluation {
  family: string;
  venuePair: string;
  edgeId: string;
  finalLabel: PairEdgeRecord["label"];
  approvalState: PairEdgeRecord["approvalState"];
  rejectionReasons: readonly string[];
}

export interface PoliticsMatchingPipelineResult {
  matchingVersion: MatchingVersionRecord;
  sourceMarkets: readonly MatchingMarketRecord[];
  politicsMarkets: readonly MatchingMarketRecord[];
  extractedRows: readonly PoliticsExtractedRow[];
  familyTaxonomy: readonly PoliticsDerivedFamilyDefinition[];
  classifications: readonly ContractFamilyClassification[];
  fingerprints: readonly StructuralFingerprint[];
  fingerprintRecords: readonly ReturnType<typeof buildPoliticsStructuralFingerprintRecord>[];
  pairEdges: readonly PairEdgeRecord[];
  triCandidates: readonly TriCandidate[];
  prefilterEvaluations: readonly PoliticsPrefilterEvaluation[];
  pairEvaluations: readonly PoliticsPairEvaluation[];
  candidateRejectionReasons: readonly string[];
}

const compatibilityKey = (leftId: string, rightId: string): string =>
  leftId.localeCompare(rightId) <= 0 ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;

const buildCompatibilityLookup = (decisions: readonly CompatibilityDecision[]): ReadonlyMap<string, CompatibilityDecision> =>
  new Map(decisions.map((decision) => [
    compatibilityKey(decision.interpretedContractAId, decision.interpretedContractBId),
    decision
  ] as const));

const buildVenuePairKey = (left: MatchingMarketRecord["venue"], right: MatchingMarketRecord["venue"]): string =>
  left.localeCompare(right) <= 0 ? `${left}_${right}` : `${right}_${left}`;

const shouldComparePair = (left: PoliticsExtractedRow, right: PoliticsExtractedRow): boolean =>
  left.venue !== right.venue;

const buildClassification = (
  row: PoliticsExtractedRow,
  eligibility: PoliticsFamilyEligibility
): ContractFamilyClassification => ({
  interpretedContractId: row.interpretedContractId,
  family: toPoliticsContractFamily(row.family),
  familyConfidence: row.extractionConfidence === "HIGH" ? "0.95" : row.extractionConfidence === "MEDIUM" ? "0.7" : "0.4",
  classificationReasons: [
    `politics_family:${row.family.toLowerCase()}`,
    `eligibility:${eligibility.toLowerCase()}`
  ],
  ruleIds: [`politics-family-derivation-v1:${row.family}`],
  ambiguityFlags: [...row.parseFailures],
  weakStructureLane: eligibility !== "MATCHING_ELIGIBLE",
  classifierVersion: "politics-family-derivation-v1",
  metadata: {
    domain: "POLITICS",
    derivedFamily: row.family,
    eligibility,
    jurisdiction: row.jurisdiction,
    office: row.office,
    cycleYear: row.cycleYear
  }
});

export class PoliticsMatchingPipeline {
  public constructor(private readonly repository: PoliticsRepositoryLike) {}

  public async run(): Promise<PoliticsMatchingPipelineResult> {
    const matchingVersion = buildMatchingVersionRecord(POLITICS_VERSION_DESCRIPTOR);
    await this.repository.upsertMatchingVersion(matchingVersion);

    const [sourceMarkets, compatibilityDecisions] = await Promise.all([
      this.repository.listMatchingMarkets(),
      this.repository.listCompatibilityDecisions()
    ]);

    const politicsMarkets = sourceMarkets.filter(isPoliticsCandidateMarket);
    const extractedRows = politicsMarkets.map((market) => extractPoliticsInventoryRow(market));
    const familyTaxonomy = buildPoliticsDerivedFamilyTaxonomy(extractedRows);
    const familyLookup = new Map(familyTaxonomy.map((family) => [family.family, family] as const));
    const eligibilityLookup = buildFamilyEligibilityLookup(familyTaxonomy);
    const classifications = extractedRows.map((row) => buildClassification(row, eligibilityLookup.get(row.family) ?? "OUT_OF_SCOPE"));
    const fingerprints = extractedRows.map((row) => buildPoliticsStructuralFingerprint(row, familyLookup.get(row.family)));
    const fingerprintRecords = extractedRows.map((row) => buildPoliticsStructuralFingerprintRecord(row, familyLookup.get(row.family)));

    await Promise.all(classifications.map((entry) => this.repository.upsertMarketClassification(entry)));
    await Promise.all(fingerprints.map((entry) => this.repository.upsertStructuralFingerprint(entry)));

    const compatibilityLookup = buildCompatibilityLookup(compatibilityDecisions);
    const pairEdges: PairEdgeRecord[] = [];
    const prefilterEvaluations: PoliticsPrefilterEvaluation[] = [];
    const pairEvaluations: PoliticsPairEvaluation[] = [];
    const candidateRejectionReasons: string[] = [];

    for (let index = 0; index < politicsMarkets.length; index += 1) {
      for (let inner = index + 1; inner < politicsMarkets.length; inner += 1) {
        const leftMarket = politicsMarkets[index]!;
        const rightMarket = politicsMarkets[inner]!;
        const leftRow = extractedRows[index]!;
        const rightRow = extractedRows[inner]!;
        if (!shouldComparePair(leftRow, rightRow)) {
          continue;
        }

        const leftEligibility = eligibilityLookup.get(leftRow.family) ?? "OUT_OF_SCOPE";
        const rightEligibility = eligibilityLookup.get(rightRow.family) ?? "OUT_OF_SCOPE";
        const definition = familyLookup.get(leftRow.family);
        const prefilter = prefilterPoliticsCandidatePair({
          leftFingerprint: fingerprints[index]!,
          rightFingerprint: fingerprints[inner]!,
          leftEligibility,
          rightEligibility,
          definition
        });

        prefilterEvaluations.push({
          family: leftRow.family,
          venuePair: buildVenuePairKey(leftRow.venue, rightRow.venue),
          leftInterpretedContractId: leftRow.interpretedContractId,
          rightInterpretedContractId: rightRow.interpretedContractId,
          accepted: prefilter.accepted,
          reasons: prefilter.reasons as readonly PoliticsPairRejection[]
        });

        if (!prefilter.accepted) {
          candidateRejectionReasons.push(...prefilter.reasons);
          continue;
        }

        const structuralMatch = runPoliticsStructuralMatcher({
          leftFingerprint: fingerprints[index]!,
          rightFingerprint: fingerprints[inner]!
        });
        const compatibilityDecision = compatibilityLookup.get(
          compatibilityKey(leftMarket.interpretedContractId, rightMarket.interpretedContractId)
        );
        const approvalDecision = applyReviewApprovalPolicy({
          structuralMatch,
          classifierResult: null
        });
        const edge = buildPoliticsPairEdgeRecord({
          leftMarket,
          rightMarket,
          leftFamily: classifications[index]!,
          rightFamily: classifications[inner]!,
          leftFingerprint: fingerprints[index]!,
          rightFingerprint: fingerprints[inner]!,
          prefilterRuleIds: prefilter.ruleIds,
          structuralMatch,
          approvalDecision,
          temporalBasis: classifyRouteabilityBasis([
            leftMarket.inventoryTemporalBasis,
            rightMarket.inventoryTemporalBasis
          ]),
          matchingVersion,
          compatibilityDecisionId: compatibilityDecision?.id ?? null,
          compatibilityClass: compatibilityDecision?.compatibilityClass ?? null
        });
        await this.repository.upsertPairEdge(edge);
        pairEdges.push(edge);
        pairEvaluations.push({
          family: leftRow.family,
          venuePair: buildVenuePairKey(leftRow.venue, rightRow.venue),
          edgeId: edge.id,
          finalLabel: edge.label,
          approvalState: edge.approvalState,
          rejectionReasons: edge.rejectionReasons
        });
        if (edge.rejectionReasons.length > 0) {
          candidateRejectionReasons.push(...edge.rejectionReasons);
        }
      }
    }

    const pairGraph = buildPairGraph(pairEdges);

    return {
      matchingVersion,
      sourceMarkets,
      politicsMarkets,
      extractedRows,
      familyTaxonomy,
      classifications,
      fingerprints,
      fingerprintRecords,
      pairEdges,
      triCandidates: deriveTriCandidates(pairGraph.edges),
      prefilterEvaluations,
      pairEvaluations,
      candidateRejectionReasons
    };
  }
}
