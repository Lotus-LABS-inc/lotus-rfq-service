import Decimal from "decimal.js";

import type {
    CompatibilityClass,
    CompatibilityEdge,
    PropositionFingerprint,
    ResolutionProfile,
    SettlementProfile,
    VenueMarketProfile
} from "./canonicalization-types.js";
import { buildStableTextId, canonicalizeJsonRecord, clampRatioString, normalizeFreeText } from "./canonicalization-types.js";
import { normalizePropositionTextForSimilarity } from "./proposition-fingerprint.js";

export interface CompatibilityEdgeScoreInput {
    canonicalEventId: string;
    marketA: VenueMarketProfile;
    marketB: VenueMarketProfile;
    fingerprintA: PropositionFingerprint;
    fingerprintB: PropositionFingerprint;
    resolutionProfileA: ResolutionProfile;
    resolutionProfileB: ResolutionProfile;
    settlementProfileA: SettlementProfile;
    settlementProfileB: SettlementProfile;
}

export interface CompatibilityEdgeScorerConfig {
    scoringVersion: string;
    liquidityCostModelVersion: string;
    annualizedCapitalCostRate: string;
}

const defaultConfig: CompatibilityEdgeScorerConfig = {
    scoringVersion: "canonical-compatibility-v1",
    liquidityCostModelVersion: "lotus-liquidity-cost-v1",
    annualizedCapitalCostRate: "0.15"
};

export class CompatibilityEdgeScorer {
    private readonly config: CompatibilityEdgeScorerConfig;

    public constructor(config: Partial<CompatibilityEdgeScorerConfig> = {}) {
        this.config = { ...defaultConfig, ...config };
    }

    public score(input: CompatibilityEdgeScoreInput): CompatibilityEdge {
        const propositionSimilarity = this.scorePropositionSimilarity(input.fingerprintA, input.fingerprintB);
        const outcomeCompatibility = this.scoreOutcomeCompatibility(input.marketA, input.marketB);
        const structureRisk = this.scoreStructureRisk(input.marketA, input.marketB);
        const timingCompatibility = this.scoreTimingCompatibility(input.marketA, input.marketB);
        const resolutionRisk = this.scoreResolutionRisk(input.resolutionProfileA, input.resolutionProfileB);
        const settlementRisk = this.scoreSettlementRisk(input.settlementProfileA, input.settlementProfileB);
        const feeCompatibility = this.scoreFeeCompatibility(input.marketA, input.marketB);
        const confidence = this.scoreConfidence(input);
        const reasons = this.buildReasons({
            propositionSimilarity,
            outcomeCompatibility,
            structureRisk,
            timingCompatibility,
            resolutionRisk,
            settlementRisk,
            feeCompatibility,
            confidence
        });
        const compatibilityClass = this.classify({
            propositionSimilarity,
            outcomeCompatibility,
            structureRisk,
            timingCompatibility,
            resolutionRisk,
            settlementRisk,
            confidence
        });
        const settlementLagMetrics = this.computeSettlementLagMetrics(
            input.settlementProfileA,
            input.settlementProfileB,
            compatibilityClass
        );
        const now = new Date();

        return {
            id: buildStableTextId(
                "edge_",
                `${input.canonicalEventId}|${[input.marketA.id, input.marketB.id].sort().join("|")}|${this.config.scoringVersion}`
            ),
            canonicalEventId: input.canonicalEventId,
            marketAProfileId: input.marketA.id.localeCompare(input.marketB.id) <= 0 ? input.marketA.id : input.marketB.id,
            marketBProfileId: input.marketA.id.localeCompare(input.marketB.id) <= 0 ? input.marketB.id : input.marketA.id,
            compatibilityClass,
            reasons,
            propositionSimilarityScore: clampRatioString(propositionSimilarity),
            outcomeSchemaCompatibilityScore: clampRatioString(outcomeCompatibility),
            timingCompatibilityScore: clampRatioString(timingCompatibility),
            resolutionRiskScore: clampRatioString(resolutionRisk),
            settlementRiskScore: clampRatioString(settlementRisk),
            structureRiskScore: clampRatioString(structureRisk),
            feeCompatibilityScore: clampRatioString(feeCompatibility),
            confidenceScore: clampRatioString(confidence),
            capitalLockHours: settlementLagMetrics.capitalLockHours,
            maxSettlementDelayHours: settlementLagMetrics.maxSettlementDelayHours,
            liquidityCostModelVersion: settlementLagMetrics.liquidityCostBps === null ? null : this.config.liquidityCostModelVersion,
            liquidityCostBps: settlementLagMetrics.liquidityCostBps,
            anchoredFinalityHours: settlementLagMetrics.anchoredFinalityHours,
            requiresConservativeSettlementAnchor: settlementLagMetrics.requiresConservativeSettlementAnchor,
            factorBreakdown: canonicalizeJsonRecord({
                propositionSimilarity,
                outcomeCompatibility,
                structureRisk,
                timingCompatibility,
                resolutionRisk,
                settlementRisk,
                feeCompatibility,
                confidence
            }),
            scoringVersion: this.config.scoringVersion,
            computedAt: now
        };
    }

    private scorePropositionSimilarity(
        left: PropositionFingerprint,
        right: PropositionFingerprint
    ): number {
        if (left.strictFingerprintKey === right.strictFingerprintKey) {
            return 1;
        }
        if (left.broadFingerprintKey !== right.broadFingerprintKey) {
            return 0;
        }
        const leftTokens = new Set(normalizePropositionTextForSimilarity(left.normalizedPropositionText).split(" ").filter(Boolean));
        const rightTokens = new Set(normalizePropositionTextForSimilarity(right.normalizedPropositionText).split(" ").filter(Boolean));
        const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
        const union = new Set([...leftTokens, ...rightTokens]).size;
        return union === 0 ? 0 : intersection / union;
    }

    private readStringMetadata(
        metadata: Readonly<Record<string, unknown>>,
        key: string
    ): string | null {
        const value = metadata[key];
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    private readStringArrayMetadata(
        metadata: Readonly<Record<string, unknown>>,
        key: string
    ): readonly string[] {
        const value = metadata[key];
        if (!Array.isArray(value)) {
            return [];
        }
        return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }

    private scoreOutcomeCompatibility(left: VenueMarketProfile, right: VenueMarketProfile): number {
        if (JSON.stringify(canonicalizeJsonRecord(left.outcomeSchema)) === JSON.stringify(canonicalizeJsonRecord(right.outcomeSchema))) {
            return 1;
        }
        if (left.outcomes.length === 0 || right.outcomes.length === 0) {
            return 0.25;
        }
        const leftLabels = new Set(left.outcomes.map((outcome) => normalizeFreeText(outcome.label)));
        const rightLabels = new Set(right.outcomes.map((outcome) => normalizeFreeText(outcome.label)));
        const intersection = [...leftLabels].filter((token) => rightLabels.has(token)).length;
        const union = new Set([...leftLabels, ...rightLabels]).size;
        return union === 0 ? 0 : intersection / union;
    }

    private scoreStructureRisk(left: VenueMarketProfile, right: VenueMarketProfile): number {
        if (left.marketClass !== right.marketClass) {
            return 1;
        }
        if ((left.marketType ?? "").toLowerCase() === (right.marketType ?? "").toLowerCase()) {
            return 0;
        }
        return 0.35;
    }

    private scoreTimingCompatibility(left: VenueMarketProfile, right: VenueMarketProfile): number {
        const leftBoundary = left.resolvesAt?.getTime() ?? left.expiresAt?.getTime() ?? null;
        const rightBoundary = right.resolvesAt?.getTime() ?? right.expiresAt?.getTime() ?? null;
        if (leftBoundary === null || rightBoundary === null) {
            return 0.5;
        }
        const differenceHours = Math.abs(leftBoundary - rightBoundary) / 3600000;
        if (differenceHours <= 1) {
            return 1;
        }
        if (differenceHours <= 24) {
            return 0.7;
        }
        return 0.2;
    }

    private scoreResolutionRisk(left: ResolutionProfile, right: ResolutionProfile): number {
        if (
            left.normalizedResolutionAuthorityType !== null &&
            right.normalizedResolutionAuthorityType !== null &&
            left.normalizedResolutionAuthorityType !== right.normalizedResolutionAuthorityType
        ) {
            return 1;
        }
        const leftAuthorityIdentity = this.readStringMetadata(left.metadata, "normalizedAuthorityIdentity");
        const rightAuthorityIdentity = this.readStringMetadata(right.metadata, "normalizedAuthorityIdentity");
        const leftAuthorityPhrases = this.readStringArrayMetadata(left.metadata, "normalizedAuthorityPhrases");
        const rightAuthorityPhrases = this.readStringArrayMetadata(right.metadata, "normalizedAuthorityPhrases");
        const authorityAligned = (
            leftAuthorityIdentity !== null
            && rightAuthorityIdentity !== null
            && leftAuthorityIdentity === rightAuthorityIdentity
            && leftAuthorityPhrases.length > 0
            && rightAuthorityPhrases.length > 0
            && left.ruleText !== null
            && right.ruleText !== null
            && normalizeFreeText(left.ruleText) === normalizeFreeText(right.ruleText)
        );
        if (
            left.resolutionSource !== null &&
            right.resolutionSource !== null &&
            normalizeFreeText(left.resolutionSource) !== normalizeFreeText(right.resolutionSource)
        ) {
            if (authorityAligned) {
                return 0.15;
            }
            return 0.8;
        }
        if (left.ruleText === null || right.ruleText === null) {
            return 0.4;
        }
        if (normalizeFreeText(left.ruleText) === normalizeFreeText(right.ruleText)) {
            return 0;
        }
        return 0.55;
    }

    private scoreSettlementRisk(left: SettlementProfile, right: SettlementProfile): number {
        if (left.settlementType !== "unknown" && right.settlementType !== "unknown" && left.settlementType !== right.settlementType) {
            return 0.9;
        }
        if (left.finalityLagHours === null || right.finalityLagHours === null) {
            return 0.45;
        }
        const difference = Math.abs(Number(left.finalityLagHours) - Number(right.finalityLagHours));
        if (difference === 0) {
            return 0;
        }
        if (difference <= 24) {
            return 0.25;
        }
        return 0.65;
    }

    private scoreFeeCompatibility(left: VenueMarketProfile, right: VenueMarketProfile): number {
        if ((left.feeModel ?? "unknown") === (right.feeModel ?? "unknown")) {
            return 1;
        }
        return 0.5;
    }

    private scoreConfidence(input: CompatibilityEdgeScoreInput): number {
        const values = [
            Number(input.marketA.confidenceScore),
            Number(input.marketB.confidenceScore),
            Number(input.fingerprintA.confidenceScore),
            Number(input.fingerprintB.confidenceScore),
            Number(input.resolutionProfileA.metadataCompletenessScore),
            Number(input.resolutionProfileB.metadataCompletenessScore),
            Number(input.settlementProfileA.metadataCompletenessScore),
            Number(input.settlementProfileB.metadataCompletenessScore)
        ].filter((value) => Number.isFinite(value));

        if (values.length === 0) {
            return 0;
        }

        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    private classify(input: {
        propositionSimilarity: number;
        outcomeCompatibility: number;
        structureRisk: number;
        timingCompatibility: number;
        resolutionRisk: number;
        settlementRisk: number;
        confidence: number;
    }): CompatibilityClass {
        if (input.outcomeCompatibility < 0.75 || input.structureRisk >= 0.8) {
            return "DO_NOT_POOL";
        }
        if (input.resolutionRisk >= 0.8) {
            return "DO_NOT_POOL";
        }
        if (input.settlementRisk >= 0.8) {
            return "DO_NOT_POOL";
        }
        if (input.confidence < 0.55) {
            return "DO_NOT_POOL";
        }
        if (input.propositionSimilarity < 0.75) {
            return "DISTINCT";
        }
        if (
            input.timingCompatibility < 0.4 ||
            input.resolutionRisk >= 0.4 ||
            input.settlementRisk >= 0.7
        ) {
            return "COMPATIBLE_WITH_CAUTION";
        }
        return "EQUIVALENT";
    }

    private computeSettlementLagMetrics(
        left: SettlementProfile,
        right: SettlementProfile,
        compatibilityClass: CompatibilityClass
    ): {
        capitalLockHours: string | null;
        maxSettlementDelayHours: string | null;
        liquidityCostBps: string | null;
        anchoredFinalityHours: string | null;
        requiresConservativeSettlementAnchor: boolean;
    } {
        const leftLag = this.totalFinalityHours(left);
        const rightLag = this.totalFinalityHours(right);
        const capitalLockHours = leftLag === null || rightLag === null
            ? null
            : new Decimal(leftLag).minus(rightLag).abs();
        const anchoredFinalityHours = leftLag === null && rightLag === null
            ? null
            : Decimal.max(
                new Decimal(leftLag ?? 0),
                new Decimal(rightLag ?? 0)
            );
        const requiresAnchor = capitalLockHours !== null && capitalLockHours.greaterThan(0);

        if (compatibilityClass !== "EQUIVALENT") {
            return {
                capitalLockHours: capitalLockHours?.toString() ?? null,
                maxSettlementDelayHours: capitalLockHours?.toString() ?? null,
                liquidityCostBps: null,
                anchoredFinalityHours: anchoredFinalityHours?.toString() ?? null,
                requiresConservativeSettlementAnchor: requiresAnchor
            };
        }

        if (capitalLockHours === null) {
            return {
                capitalLockHours: null,
                maxSettlementDelayHours: null,
                liquidityCostBps: null,
                anchoredFinalityHours: anchoredFinalityHours?.toString() ?? null,
                requiresConservativeSettlementAnchor: requiresAnchor
            };
        }

        const annualRate = new Decimal(this.config.annualizedCapitalCostRate);
        const liquidityCostBps = annualRate
            .times(capitalLockHours)
            .div(8760)
            .times(10000);

        return {
            capitalLockHours: capitalLockHours.toString(),
            maxSettlementDelayHours: capitalLockHours.toString(),
            liquidityCostBps: liquidityCostBps.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""),
            anchoredFinalityHours: anchoredFinalityHours?.toString() ?? null,
            requiresConservativeSettlementAnchor: requiresAnchor
        };
    }

    private totalFinalityHours(profile: SettlementProfile): InstanceType<typeof Decimal> | null {
        if (profile.finalityLagHours !== null) {
            return new Decimal(profile.finalityLagHours);
        }
        if (profile.disputeWindowHours === null && profile.settlementLagHours === null) {
            return null;
        }
        return new Decimal(profile.disputeWindowHours ?? 0).plus(profile.settlementLagHours ?? 0);
    }

    private buildReasons(input: {
        propositionSimilarity: number;
        outcomeCompatibility: number;
        structureRisk: number;
        timingCompatibility: number;
        resolutionRisk: number;
        settlementRisk: number;
        feeCompatibility: number;
        confidence: number;
    }): readonly string[] {
        const reasons: string[] = [];
        if (input.propositionSimilarity < 1) {
            reasons.push("proposition_similarity_below_exact_match");
        }
        if (input.outcomeCompatibility < 1) {
            reasons.push("outcome_schema_not_identical");
        }
        if (input.structureRisk > 0) {
            reasons.push("market_structure_differs");
        }
        if (input.timingCompatibility < 1) {
            reasons.push("timing_semantics_require_review");
        }
        if (input.resolutionRisk > 0) {
            reasons.push("resolution_semantics_not_identical");
        }
        if (input.settlementRisk > 0) {
            reasons.push("settlement_or_finality_differs");
        }
        if (input.feeCompatibility < 1) {
            reasons.push("fee_model_differs");
        }
        if (input.confidence < 0.75) {
            reasons.push("metadata_confidence_reduced");
        }
        return reasons;
    }
}
