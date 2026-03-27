import type { CompatibilityEdge } from "./canonicalization-types.js";
import type { InterpretedContract } from "./interpreted-contract-types.js";
import { buildCompatibilityDecisionRecord, type CompatibilityDecision } from "./compatibility-decision.js";
import { compatibilityReasonCodes, type CompatibilityReasonCode } from "./compatibility-reason-codes.js";

export interface CompatibilityDecisionBuilderInput {
    canonicalEventId: string;
    interpretedContractA: InterpretedContract;
    interpretedContractB: InterpretedContract;
    compatibilityEdge: CompatibilityEdge;
    compatibilityVersionId: string;
    replayReference?: string | null;
    reviewerOverrideMetadata?: Readonly<Record<string, unknown>>;
}

const scoreAsNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const readFactorScore = (
    input: CompatibilityDecisionBuilderInput,
    factorKey: string,
    fallback: unknown
): number => {
    const value = input.compatibilityEdge.factorBreakdown[factorKey];
    return scoreAsNumber(value ?? fallback);
};

export class CompatibilityDecisionBuilder {
    public build(input: CompatibilityDecisionBuilderInput): CompatibilityDecision {
        const factorBreakdown = input.compatibilityEdge.factorBreakdown;
        const reasonCodes = this.buildReasonCodes(input);
        const hardBlocks = this.buildHardBlocks(input, reasonCodes);
        const cautionConditions = this.buildCautionConditions(input, reasonCodes);
        const softPenalties = this.buildSoftPenalties(input, reasonCodes);

        return buildCompatibilityDecisionRecord({
            canonicalEventId: input.canonicalEventId,
            interpretedContractAId: input.interpretedContractA.id,
            interpretedContractBId: input.interpretedContractB.id,
            compatibilityVersionId: input.compatibilityVersionId,
            replayReference: input.replayReference ?? null,
            compatibilityClass: input.compatibilityEdge.compatibilityClass,
            reasonCodes,
            hardBlocks,
            cautionConditions,
            softPenalties,
            confidenceScore: input.compatibilityEdge.confidenceScore,
            factorBreakdown,
            supportingReasons: input.compatibilityEdge.reasons,
            ...(input.reviewerOverrideMetadata ? { reviewerOverrideMetadata: input.reviewerOverrideMetadata } : {})
        });
    }

    private buildReasonCodes(input: CompatibilityDecisionBuilderInput): CompatibilityReasonCode[] {
        const codes = new Set<CompatibilityReasonCode>();
        const outcomeCompatibility = readFactorScore(
            input,
            "outcomeCompatibility",
            input.compatibilityEdge.outcomeSchemaCompatibilityScore
        );
        const structureRisk = readFactorScore(
            input,
            "structureRisk",
            input.compatibilityEdge.structureRiskScore
        );
        const resolutionRisk = readFactorScore(
            input,
            "resolutionRisk",
            input.compatibilityEdge.resolutionRiskScore
        );
        const timingCompatibility = readFactorScore(
            input,
            "timingCompatibility",
            input.compatibilityEdge.timingCompatibilityScore
        );
        const settlementRisk = readFactorScore(
            input,
            "settlementRisk",
            input.compatibilityEdge.settlementRiskScore
        );
        const confidence = readFactorScore(
            input,
            "confidence",
            input.compatibilityEdge.confidenceScore
        );

        if (outcomeCompatibility < 0.75) {
            codes.add(compatibilityReasonCodes.OUTCOME_SCHEMA_MISMATCH);
        }
        if (structureRisk >= 0.8) {
            codes.add(compatibilityReasonCodes.STRUCTURAL_MARKET_MISMATCH);
        }
        if (resolutionRisk >= 0.8) {
            codes.add(compatibilityReasonCodes.RESOLUTION_SOURCE_MISMATCH);
        }
        if (timingCompatibility < 0.4) {
            codes.add(compatibilityReasonCodes.TIME_BOUNDARY_AMBIGUOUS);
        }
        if (settlementRisk >= 0.8) {
            codes.add(compatibilityReasonCodes.SETTLEMENT_TYPE_MISMATCH);
        }
        if (
            confidence < 0.55 ||
            !input.interpretedContractA.isPoolable ||
            !input.interpretedContractB.isPoolable
        ) {
            codes.add(compatibilityReasonCodes.LOW_METADATA_CONFIDENCE);
        }
        if (
            input.compatibilityEdge.requiresConservativeSettlementAnchor &&
            input.compatibilityEdge.compatibilityClass === "EQUIVALENT"
        ) {
            codes.add(compatibilityReasonCodes.CONSERVATIVE_SETTLEMENT_ANCHOR_REQUIRED);
        }
        if (
            input.interpretedContractA.normalizedResolutionSemantics["normalizedResolutionAuthorityType"] !==
            input.interpretedContractB.normalizedResolutionSemantics["normalizedResolutionAuthorityType"]
        ) {
            codes.add(compatibilityReasonCodes.RESOLUTION_AUTHORITY_CONFLICT);
        }
        if (
            input.interpretedContractA.normalizedSettlementSemantics["settlementLagHours"] !==
            input.interpretedContractB.normalizedSettlementSemantics["settlementLagHours"]
        ) {
            codes.add(compatibilityReasonCodes.SETTLEMENT_LAG_HIGH);
        }
        if (
            input.interpretedContractA.normalizedResolutionSemantics["ruleText"] !==
            input.interpretedContractB.normalizedResolutionSemantics["ruleText"]
        ) {
            codes.add(compatibilityReasonCodes.RULE_TEXT_CONFLICT);
        }
        if (
            input.interpretedContractA.normalizedOutcomeSemantics["marketClass"] !==
            input.interpretedContractB.normalizedOutcomeSemantics["marketClass"]
        ) {
            codes.add(compatibilityReasonCodes.STRUCTURAL_MARKET_MISMATCH);
        }

        return [...codes];
    }

    private buildHardBlocks(
        input: CompatibilityDecisionBuilderInput,
        reasonCodes: readonly CompatibilityReasonCode[]
    ): string[] {
        if (input.compatibilityEdge.compatibilityClass === "DO_NOT_POOL") {
            return [...reasonCodes];
        }
        return [];
    }

    private buildCautionConditions(
        input: CompatibilityDecisionBuilderInput,
        reasonCodes: readonly CompatibilityReasonCode[]
    ): string[] {
        if (input.compatibilityEdge.compatibilityClass === "COMPATIBLE_WITH_CAUTION") {
            return [...reasonCodes];
        }
        if (input.compatibilityEdge.compatibilityClass === "EQUIVALENT" && reasonCodes.includes(compatibilityReasonCodes.CONSERVATIVE_SETTLEMENT_ANCHOR_REQUIRED)) {
            return [compatibilityReasonCodes.CONSERVATIVE_SETTLEMENT_ANCHOR_REQUIRED];
        }
        return [];
    }

    private buildSoftPenalties(
        input: CompatibilityDecisionBuilderInput,
        reasonCodes: readonly CompatibilityReasonCode[]
    ): ReadonlyArray<Readonly<Record<string, unknown>>> {
        const penalties: Array<Readonly<Record<string, unknown>>> = [];
        if (input.compatibilityEdge.liquidityCostBps !== null) {
            penalties.push({
                type: "liquidity_cost_bps",
                value: input.compatibilityEdge.liquidityCostBps,
                modelVersion: input.compatibilityEdge.liquidityCostModelVersion
            });
        }
        if (reasonCodes.includes(compatibilityReasonCodes.SETTLEMENT_LAG_HIGH)) {
            penalties.push({
                type: "settlement_lag_hours",
                value: input.compatibilityEdge.maxSettlementDelayHours
            });
        }
        return penalties;
    }
}
