import { classifyRouteabilityBasis } from "../../inventory/inventory-basis-classifier.js";
import { PairEdgeRepository } from "../../repositories/pair-edge.repository.js";
import type { CompatibilityDecision } from "../../canonical/compatibility-decision.js";
import { buildMatchingVersionRecord, type MatchingVersionRecord } from "../matching-versioning.js";
import { applyReviewApprovalPolicy } from "../review-approval-policy.js";
import type { ContractFamilyClassification, MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../matching-types.js";
import {
  buildCryptoVenuePairKey,
  cryptoAllowedVenuePairs,
  cryptoContractFamilyValues,
  defaultCryptoTrackedAssets,
  type CryptoContractFamily,
  type CryptoTrackedAsset
} from "./crypto-match-labels.js";
import { prefilterCryptoCandidatePair } from "./crypto-candidate-prefilter.js";
import { buildCryptoPairEdgeRecord } from "./crypto-pair-edge-builder.js";
import { buildCryptoPairGraph, type CryptoPairGraph } from "./crypto-pair-graph.js";
import { classifyCryptoFamily } from "./crypto-family-classifier.js";
import { classifyCryptoPair, type CryptoPairClassifierResult } from "./crypto-pair-classifier.js";
import { runCryptoStructuralMatcher, type CryptoStructuralMatchResult } from "./crypto-structural-matcher.js";
import { buildCryptoStructuralFingerprint } from "./crypto-structural-fingerprint.js";

const CRYPTO_VERSION_DESCRIPTOR = {
  familyClassifierVersion: "crypto-family-classifier-v1",
  fingerprintVersion: "crypto-structural-fingerprint-v1",
  prefilterVersion: "crypto-candidate-prefilter-v1",
  structuralMatcherVersion: "crypto-structural-matcher-v1",
  pairClassifierVersion: "crypto-pair-classifier-v1",
  embeddingModelVersion: "crypto-embeddings-disabled-v1",
  reviewPolicyVersion: "pair-review-policy-v1"
} as const;

interface CryptoRepositoryLike {
  upsertMatchingVersion(record: MatchingVersionRecord): Promise<void>;
  listMatchingMarkets(): Promise<readonly MatchingMarketRecord[]>;
  listCompatibilityDecisions(): Promise<readonly CompatibilityDecision[]>;
  upsertMarketClassification(classification: ContractFamilyClassification): Promise<void>;
  upsertStructuralFingerprint(fingerprint: StructuralFingerprint): Promise<void>;
  upsertPairEdge(edge: PairEdgeRecord): Promise<void>;
}

export interface CryptoMatchingPipelineOptions {
  allowedAssets?: readonly CryptoTrackedAsset[];
  allowedFamilies?: readonly CryptoContractFamily[];
  scopeName?: string;
}

export interface CryptoScopeEvaluation {
  market: MatchingMarketRecord;
  classification: ContractFamilyClassification;
  fingerprint: StructuralFingerprint;
  normalizedAsset: string | null;
  scopeStatus: "ADMITTED" | "NON_TARGET_ASSET" | "BAD_CRYPTO_ROW" | "FAMILY_OUT_OF_SCOPE" | "STRUCTURAL_REJECTED";
  scopeReasons: readonly string[];
}

export interface CryptoPrefilterEvaluation {
  asset: string | null;
  family: string;
  venuePair: string;
  accepted: boolean;
  reasons: readonly string[];
}

export interface CryptoPairEvaluation {
  asset: string | null;
  family: string;
  venuePair: string;
  finalLabel: PairEdgeRecord["label"];
  approvalState: PairEdgeRecord["approvalState"];
  rejectionReasons: readonly string[];
  edgeId: string;
}

export interface CryptoMatchingPipelineResult {
  matchingVersion: MatchingVersionRecord;
  sourceMarkets: readonly MatchingMarketRecord[];
  classifiedMarkets: readonly MatchingMarketRecord[];
  eligibleMarkets: readonly MatchingMarketRecord[];
  btcMarkets: readonly MatchingMarketRecord[];
  classifications: readonly ContractFamilyClassification[];
  fingerprints: readonly StructuralFingerprint[];
  pairEdges: readonly PairEdgeRecord[];
  pairGraph: CryptoPairGraph;
  candidateRejectionReasons: readonly string[];
  structuralLaneRejections: readonly string[];
  scopeEvaluations: readonly CryptoScopeEvaluation[];
  prefilterEvaluations: readonly CryptoPrefilterEvaluation[];
  pairEvaluations: readonly CryptoPairEvaluation[];
  allowedAssets: readonly CryptoTrackedAsset[];
  allowedFamilies: readonly CryptoContractFamily[];
}

const compatibilityKey = (leftId: string, rightId: string): string =>
  leftId.localeCompare(rightId) <= 0 ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;

const isTargetMarket = (market: MatchingMarketRecord): boolean =>
  market.category === "CRYPTO"
  && (market.venue === "POLYMARKET" || market.venue === "LIMITLESS" || market.venue === "OPINION");

const buildCompatibilityLookup = (decisions: readonly CompatibilityDecision[]): ReadonlyMap<string, CompatibilityDecision> =>
  new Map(decisions.map((decision) => [
    compatibilityKey(decision.interpretedContractAId, decision.interpretedContractBId),
    decision
  ] as const));

const shouldComparePair = (
  leftMarket: MatchingMarketRecord,
  rightMarket: MatchingMarketRecord
): boolean =>
  leftMarket.venue !== rightMarket.venue
  && cryptoAllowedVenuePairs.has(
    buildCryptoVenuePairKey(
      leftMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION",
      rightMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION"
    )
  );

interface ComparedPair {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
  structuralMatch: CryptoStructuralMatchResult;
  classifierResult: CryptoPairClassifierResult | null;
  prefilterRuleIds: readonly string[];
}

const buildScopeEvaluation = (input: {
  market: MatchingMarketRecord;
  classification: ContractFamilyClassification;
  fingerprint: StructuralFingerprint;
  allowedAssets: ReadonlySet<string>;
  allowedFamilies: ReadonlySet<string>;
}): CryptoScopeEvaluation => {
  const normalizedAsset = typeof input.classification.metadata["normalizedAsset"] === "string"
    ? input.classification.metadata["normalizedAsset"] as string
    : null;
  const reasons: string[] = [];

  if (input.classification.metadata["sourceHygieneStatus"] === "REJECT") {
    reasons.push("BAD_CRYPTO_ROW");
  }
  if (!normalizedAsset || !input.allowedAssets.has(normalizedAsset)) {
    reasons.push("NON_TARGET_ASSET");
  }
  if (!input.allowedFamilies.has(input.classification.family)) {
    reasons.push("FAMILY_OUT_OF_SCOPE");
  }
  if (input.classification.metadata["structuralLaneEligible"] !== true || input.classification.weakStructureLane) {
    reasons.push("STRUCTURAL_REJECTED");
  }

  const scopeStatus =
    reasons.length === 0 ? "ADMITTED"
    : reasons.includes("BAD_CRYPTO_ROW") ? "BAD_CRYPTO_ROW"
    : reasons.includes("NON_TARGET_ASSET") ? "NON_TARGET_ASSET"
    : reasons.includes("FAMILY_OUT_OF_SCOPE") ? "FAMILY_OUT_OF_SCOPE"
    : "STRUCTURAL_REJECTED";

  return {
    market: input.market,
    classification: input.classification,
    fingerprint: input.fingerprint,
    normalizedAsset,
    scopeStatus,
    scopeReasons: reasons
  };
};

const comparePair = (
  leftMarket: MatchingMarketRecord,
  rightMarket: MatchingMarketRecord,
  leftFamily: ContractFamilyClassification,
  rightFamily: ContractFamilyClassification,
  leftFingerprint: StructuralFingerprint,
  rightFingerprint: StructuralFingerprint
): ComparedPair | { rejectedReasons: readonly string[] } => {
  const prefilter = prefilterCryptoCandidatePair({ leftFingerprint, rightFingerprint });
  if (!prefilter.accepted) {
    return { rejectedReasons: prefilter.reasons };
  }
  const structuralMatch = runCryptoStructuralMatcher({ leftFingerprint, rightFingerprint });
  const classifierResult =
    structuralMatch.outcome === "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER"
      ? classifyCryptoPair({ leftFingerprint, rightFingerprint })
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

export class CryptoMatchingPipeline {
  public constructor(
    private readonly repository: CryptoRepositoryLike,
    private readonly options: CryptoMatchingPipelineOptions = {}
  ) {}

  public async run(): Promise<CryptoMatchingPipelineResult> {
    const matchingVersion = buildMatchingVersionRecord(CRYPTO_VERSION_DESCRIPTOR);
    await this.repository.upsertMatchingVersion(matchingVersion);

    const [sourceMarkets, compatibilityDecisions] = await Promise.all([
      this.repository.listMatchingMarkets(),
      this.repository.listCompatibilityDecisions()
    ]);

    const allowedAssets = this.options.allowedAssets ?? defaultCryptoTrackedAssets;
    const allowedFamilies = this.options.allowedFamilies ?? cryptoContractFamilyValues;
    const allowedAssetSet = new Set<string>(allowedAssets);
    const allowedFamilySet = new Set<string>(allowedFamilies);
    const classifiedMarkets = sourceMarkets.filter(isTargetMarket);
    const classifications = classifiedMarkets.map((market) => classifyCryptoFamily(market));
    const fingerprints = classifiedMarkets.map((market, index) => buildCryptoStructuralFingerprint(market, classifications[index]!));
    await Promise.all(classifications.map((entry) => this.repository.upsertMarketClassification(entry)));
    await Promise.all(fingerprints.map((entry) => this.repository.upsertStructuralFingerprint(entry)));

    const scopeEvaluations = classifiedMarkets.map((market, index) => buildScopeEvaluation({
      market,
      classification: classifications[index]!,
      fingerprint: fingerprints[index]!,
      allowedAssets: allowedAssetSet,
      allowedFamilies: allowedFamilySet
    }));
    const eligibleMarkets = scopeEvaluations
      .filter((entry) => entry.scopeStatus === "ADMITTED")
      .map((entry) => entry.market);
    const btcMarkets = scopeEvaluations
      .filter((entry) => entry.scopeStatus === "ADMITTED" && entry.normalizedAsset === "BTC")
      .map((entry) => entry.market);
    const structuralLaneRejections = scopeEvaluations
      .filter((entry) => entry.scopeStatus !== "ADMITTED")
      .flatMap((entry) => entry.scopeReasons.length > 0 ? entry.scopeReasons : entry.classification.ambiguityFlags);
    const compatibilityLookup = buildCompatibilityLookup(compatibilityDecisions);
    const pairEdges: PairEdgeRecord[] = [];
    const candidateRejectionReasons: string[] = [];
    const prefilterEvaluations: CryptoPrefilterEvaluation[] = [];
    const pairEvaluations: CryptoPairEvaluation[] = [];

    for (let index = 0; index < eligibleMarkets.length; index += 1) {
      for (let inner = index + 1; inner < eligibleMarkets.length; inner += 1) {
        const leftMarket = eligibleMarkets[index]!;
        const rightMarket = eligibleMarkets[inner]!;
        if (!shouldComparePair(leftMarket, rightMarket)) {
          continue;
        }
        const leftIndex = classifiedMarkets.findIndex((market) => market.interpretedContractId === leftMarket.interpretedContractId);
        const rightIndex = classifiedMarkets.findIndex((market) => market.interpretedContractId === rightMarket.interpretedContractId);
        const compared = comparePair(
          leftMarket,
          rightMarket,
          classifications[leftIndex]!,
          classifications[rightIndex]!,
          fingerprints[leftIndex]!,
          fingerprints[rightIndex]!
        );
        if ("rejectedReasons" in compared) {
          const leftAsset = classifications[leftIndex]!.metadata["normalizedAsset"];
          prefilterEvaluations.push({
            asset: typeof leftAsset === "string" ? leftAsset : null,
            family: classifications[leftIndex]!.family,
            venuePair: buildCryptoVenuePairKey(
              leftMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION",
              rightMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION"
            ),
            accepted: false,
            reasons: compared.rejectedReasons
          });
          candidateRejectionReasons.push(...compared.rejectedReasons);
          continue;
        }
        prefilterEvaluations.push({
          asset: compared.leftFamily.metadata["normalizedAsset"] as string | null ?? null,
          family: compared.leftFamily.family,
          venuePair: buildCryptoVenuePairKey(
            leftMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION",
            rightMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION"
          ),
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
        const pairEdge = buildCryptoPairEdgeRecord({
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
          asset: compared.leftFamily.metadata["normalizedAsset"] as string | null ?? null,
          family: compared.leftFamily.family,
          venuePair: buildCryptoVenuePairKey(
            leftMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION",
            rightMarket.venue as "POLYMARKET" | "LIMITLESS" | "OPINION"
          ),
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
      btcMarkets,
      classifications,
      fingerprints,
      pairEdges,
      pairGraph: buildCryptoPairGraph(pairEdges, [...allowedAssets]),
      candidateRejectionReasons,
      structuralLaneRejections,
      scopeEvaluations,
      prefilterEvaluations,
      pairEvaluations,
      allowedAssets,
      allowedFamilies
    };
  }
}

export const createCryptoMatchingPipeline = (repository: PairEdgeRepository): CryptoMatchingPipeline =>
  new CryptoMatchingPipeline(repository);
