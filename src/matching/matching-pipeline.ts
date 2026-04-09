import { classifyRouteabilityBasis } from "../inventory/inventory-basis-classifier.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { prefilterCandidatePair } from "./candidate-prefilter.js";
import { classifyContractFamily } from "./contract-family-classifier.js";
import { TokenJaccardEmbeddingCandidateGenerator, type EmbeddingCandidateGenerator } from "./embedding-candidate-generator.js";
import { OfflineHeuristicPairClassifier, type PairClassifier } from "./pair-classifier.js";
import { buildPairEdgeRecord } from "./pair-edge-builder.js";
import { buildPairGraph } from "./pair-graph.js";
import { applyReviewApprovalPolicy } from "./review-approval-policy.js";
import { runStructuralMatcher } from "./structural-matcher.js";
import { buildStructuralFingerprint } from "./structural-fingerprint.js";
import { deriveTriCandidates, type TriCandidate } from "./tri-deriver.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairEdgeRecord,
  StructuralFingerprint
} from "./matching-types.js";
import {
  buildMatchingVersionRecord,
  DEFAULT_MATCHING_VERSION_DESCRIPTOR,
  type MatchingVersionDescriptor,
  type MatchingVersionRecord
} from "./matching-versioning.js";

export interface MatchingPipelineResult {
  matchingVersion: MatchingVersionRecord;
  markets: readonly MatchingMarketRecord[];
  classifications: readonly ContractFamilyClassification[];
  fingerprints: readonly StructuralFingerprint[];
  pairEdges: readonly PairEdgeRecord[];
  triCandidates: readonly TriCandidate[];
  candidateRejectionReasons: readonly string[];
}

const shouldUseEmbeddingLane = (left: ContractFamilyClassification, right: ContractFamilyClassification): boolean =>
  left.weakStructureLane || right.weakStructureLane;

const compatibilityKey = (left: string, right: string): string =>
  left.localeCompare(right) <= 0 ? `${left}|${right}` : `${right}|${left}`;

export class MatchingPipeline {
  private readonly pairClassifier: PairClassifier;
  private readonly embeddingGenerator: EmbeddingCandidateGenerator;

  public constructor(
    private readonly repository: PairEdgeRepository,
    private readonly versionDescriptor: MatchingVersionDescriptor = DEFAULT_MATCHING_VERSION_DESCRIPTOR
  ) {
    this.pairClassifier = new OfflineHeuristicPairClassifier();
    this.embeddingGenerator = new TokenJaccardEmbeddingCandidateGenerator();
  }

  public async run(): Promise<MatchingPipelineResult> {
    const matchingVersion = buildMatchingVersionRecord(this.versionDescriptor);
    await this.repository.upsertMatchingVersion(matchingVersion);

    const [markets, compatibilityDecisions] = await Promise.all([
      this.repository.listMatchingMarkets(),
      this.repository.listCompatibilityDecisions()
    ]);

    const classifications = markets.map((market) => classifyContractFamily(market));
    const fingerprints = markets.map((market, index) => buildStructuralFingerprint(market, classifications[index]!));
    await Promise.all(classifications.map((entry) => this.repository.upsertMarketClassification(entry)));
    await Promise.all(fingerprints.map((entry) => this.repository.upsertStructuralFingerprint(entry)));

    const compatibilityLookup = new Map(
      compatibilityDecisions.map((decision) => [
        compatibilityKey(decision.interpretedContractAId, decision.interpretedContractBId),
        decision
      ] as const)
    );

    const pairEdges: PairEdgeRecord[] = [];
    const candidateRejectionReasons: string[] = [];
    for (let index = 0; index < markets.length; index += 1) {
      for (let inner = index + 1; inner < markets.length; inner += 1) {
        const leftMarket = markets[index]!;
        const rightMarket = markets[inner]!;
        const leftFamily = classifications[index]!;
        const rightFamily = classifications[inner]!;
        const leftFingerprint = fingerprints[index]!;
        const rightFingerprint = fingerprints[inner]!;
        const prefilter = prefilterCandidatePair({
          leftMarket,
          rightMarket,
          leftFamily,
          rightFamily,
          leftFingerprint,
          rightFingerprint
        });
        if (!prefilter.accepted) {
          candidateRejectionReasons.push(...prefilter.reasons);
          continue;
        }

        const structuralMatch = runStructuralMatcher({
          leftMarket,
          rightMarket,
          leftFamily,
          rightFamily,
          leftFingerprint,
          rightFingerprint
        });

        const classifierResult =
          structuralMatch.outcome === "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER"
            ? shouldUseEmbeddingLane(leftFamily, rightFamily)
              ? (() => {
                  const shortlist = this.embeddingGenerator.shortlist({
                  leftMarket,
                  rightMarket,
                  leftFamily,
                  rightFamily
                });
                  if (!shortlist.shortlisted) {
                    candidateRejectionReasons.push(...shortlist.shortlistReasons);
                    return null;
                  }
                  return this.pairClassifier.classify({
                    leftMarket,
                    rightMarket,
                    leftFamily,
                    rightFamily,
                    leftFingerprint,
                    rightFingerprint
                  });
                })()
              : this.pairClassifier.classify({
                  leftMarket,
                  rightMarket,
                  leftFamily,
                  rightFamily,
                  leftFingerprint,
                  rightFingerprint
                })
            : null;

        const approvalDecision = applyReviewApprovalPolicy({
          structuralMatch,
          classifierResult
        });
        const compatibilityDecision = compatibilityLookup.get(
          compatibilityKey(leftMarket.interpretedContractId, rightMarket.interpretedContractId)
        );
        const pairEdge = buildPairEdgeRecord({
          leftMarket,
          rightMarket,
          leftFamily,
          rightFamily,
          structuralMatch,
          classifierResult,
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
        if (pairEdge.rejectionReasons.length > 0) {
          candidateRejectionReasons.push(...pairEdge.rejectionReasons);
        }
      }
    }

    const pairGraph = buildPairGraph(pairEdges);
    const triCandidates = deriveTriCandidates(pairGraph.edges);

    return {
      matchingVersion,
      markets,
      classifications,
      fingerprints,
      pairEdges,
      triCandidates,
      candidateRejectionReasons
    };
  }
}
