import Decimal from "decimal.js";
import type {
    CreateResolutionRiskAssessmentInput,
    NormalizedResolutionProfile,
    ResolutionEquivalenceClass,
    ResolutionFactorComparison,
    ResolutionFactorComparisonResult,
    ResolutionRiskAssessment,
    ResolutionRiskScoringInput
} from "./resolution-risk.types.js";

const FACTOR_ORDER = [
    "oracleMismatch",
    "ruleMismatch",
    "wordingAmbiguity",
    "disputeWindowMismatch",
    "settlementLagMismatch",
    "structuralMismatch",
    "historicalDivergence"
] as const;

type FactorName = typeof FACTOR_ORDER[number];
type DecimalValue = InstanceType<typeof Decimal>;

export interface ResolutionRiskScoringWeights {
    oracleMismatch: string;
    ruleMismatch: string;
    wordingAmbiguity: string;
    disputeWindowMismatch: string;
    settlementLagMismatch: string;
    structuralMismatch: string;
    historicalDivergence: string;
}

export interface ResolutionRiskEquivalenceThresholds {
    safeEquivalentMaxRisk: string;
    safeEquivalentMinConfidence: string;
    cautionMaxRisk: string;
    highRiskMaxRisk: string;
    doNotPoolMinRisk: string;
    lowConfidenceThreshold: string;
}

export interface ResolutionRiskScoringConfig {
    weights: ResolutionRiskScoringWeights;
    thresholds: ResolutionRiskEquivalenceThresholds;
    conservativeDowngradeOnLowConfidence: boolean;
}

const DEFAULT_FACTOR_WEIGHTS: Record<FactorName, DecimalValue> = {
    oracleMismatch: new Decimal("0.22"),
    ruleMismatch: new Decimal("0.20"),
    wordingAmbiguity: new Decimal("0.16"),
    disputeWindowMismatch: new Decimal("0.12"),
    settlementLagMismatch: new Decimal("0.10"),
    structuralMismatch: new Decimal("0.10"),
    historicalDivergence: new Decimal("0.10")
};

const DEFAULT_THRESHOLDS: ResolutionRiskEquivalenceThresholds = {
    safeEquivalentMaxRisk: "0.20",
    safeEquivalentMinConfidence: "0.70",
    cautionMaxRisk: "0.45",
    highRiskMaxRisk: "0.75",
    doNotPoolMinRisk: "0.75",
    lowConfidenceThreshold: "0.50"
};

export const DEFAULT_RESOLUTION_RISK_SCORING_CONFIG: ResolutionRiskScoringConfig = {
    weights: {
        oracleMismatch: "0.22",
        ruleMismatch: "0.20",
        wordingAmbiguity: "0.16",
        disputeWindowMismatch: "0.12",
        settlementLagMismatch: "0.10",
        structuralMismatch: "0.10",
        historicalDivergence: "0.10"
    },
    thresholds: DEFAULT_THRESHOLDS,
    conservativeDowngradeOnLowConfidence: true
};

export class ResolutionRiskScoringError extends Error {
    public readonly code: "invalid_factor_comparison" | "invalid_scoring_input";

    public constructor(code: "invalid_factor_comparison" | "invalid_scoring_input") {
        super(code);
        this.name = "ResolutionRiskScoringError";
        this.code = code;
    }
}

export interface IResolutionRiskScoringEngine {
    score(input: ResolutionRiskScoringInput): ResolutionRiskAssessment;
    getReplayWeights(): ResolutionRiskScoringWeights;
    getReplayThresholds(): ResolutionRiskEquivalenceThresholds;
    buildReplayConfidenceInputs(factorComparison: ResolutionFactorComparisonResult): Record<string, unknown>;
}

export class ResolutionRiskScoringEngine implements IResolutionRiskScoringEngine {
    private readonly weights: Record<FactorName, DecimalValue>;
    private readonly thresholds: ResolutionRiskEquivalenceThresholds;
    private readonly conservativeDowngradeOnLowConfidence: boolean;

    public constructor(config: Partial<ResolutionRiskScoringConfig> = {}) {
        const mergedWeights = {
            ...DEFAULT_RESOLUTION_RISK_SCORING_CONFIG.weights,
            ...(config.weights ?? {})
        };
        this.weights = {
            oracleMismatch: new Decimal(mergedWeights.oracleMismatch),
            ruleMismatch: new Decimal(mergedWeights.ruleMismatch),
            wordingAmbiguity: new Decimal(mergedWeights.wordingAmbiguity),
            disputeWindowMismatch: new Decimal(mergedWeights.disputeWindowMismatch),
            settlementLagMismatch: new Decimal(mergedWeights.settlementLagMismatch),
            structuralMismatch: new Decimal(mergedWeights.structuralMismatch),
            historicalDivergence: new Decimal(mergedWeights.historicalDivergence)
        };
        this.thresholds = {
            ...DEFAULT_THRESHOLDS,
            ...(config.thresholds ?? {})
        };
        this.conservativeDowngradeOnLowConfidence = config.conservativeDowngradeOnLowConfidence
            ?? DEFAULT_RESOLUTION_RISK_SCORING_CONFIG.conservativeDowngradeOnLowConfidence;
    }

    public score(input: ResolutionRiskScoringInput): ResolutionRiskAssessment {
        this.validateInput(input);
        const { canonicalEventId, profileA, profileB, factorComparison, version } = input;
        
        // Ensure we use the correct canonicalMarketId from the profiles
        // (They should be identical as they are linked to the same canonical market)
        const canonicalMarketId = profileA.canonicalMarketId || canonicalEventId;

        const maxSettlementDelayHours = this.calculateMaxSettlementDelay(profileA, profileB);
        
        // Identity Guard: Scoped markets must have matching canonicalMarketId
        if (profileA.canonicalMarketId !== profileB.canonicalMarketId) {
            return {
                id: "",
                canonicalEventId,
                canonicalMarketId: "IDENTITY_MISMATCH",
                marketAProfileId: profileA.id,
                marketBProfileId: profileB.id,
                riskScore: "1.0",
                confidenceScore: "1.0",
                equivalenceClass: "DO_NOT_POOL",
                factorBreakdown: {},
                reasons: [`Market identity mismatch: ${profileA.canonicalMarketId} vs ${profileB.canonicalMarketId}`],
                version,
                computedAt: new Date(),
                liquidityCost: new Decimal(0).toString(),
                maxSettlementDelayHours: 0
            };
        }

        const riskScore = this.computeWeightedValue(factorComparison, "score");
        const confidenceScore = this.computeConfidenceScore(factorComparison);
        const equivalenceClass = this.mapEquivalenceClass(riskScore, confidenceScore, factorComparison);
        const reasons = this.buildReasons(factorComparison);

        // 15% APY Base Liquidity Premium
        const annualRate = new Decimal(0.15); 
        const liquidityCost = maxSettlementDelayHours > 0 
            ? annualRate.times(maxSettlementDelayHours).div(8760) 
            : new Decimal(0);

        return {
            id: "", // Calculated by persistence layer
            canonicalEventId,
            canonicalMarketId,
            marketAProfileId: profileA.id,
            marketBProfileId: profileB.id,
            riskScore: this.serializeClampedDecimal(riskScore),
            confidenceScore: this.serializeClampedDecimal(confidenceScore),
            equivalenceClass,
            factorBreakdown: factorComparison as unknown as Record<string, unknown>,
            reasons,
            version: input.version,
            liquidityCost: this.serializeClampedDecimal(liquidityCost),
            maxSettlementDelayHours,
            computedAt: new Date()
        };
    }

    public getReplayWeights(): ResolutionRiskScoringWeights {
        return {
            oracleMismatch: this.weights.oracleMismatch.toString(),
            ruleMismatch: this.weights.ruleMismatch.toString(),
            wordingAmbiguity: this.weights.wordingAmbiguity.toString(),
            disputeWindowMismatch: this.weights.disputeWindowMismatch.toString(),
            settlementLagMismatch: this.weights.settlementLagMismatch.toString(),
            structuralMismatch: this.weights.structuralMismatch.toString(),
            historicalDivergence: this.weights.historicalDivergence.toString()
        };
    }

    public getReplayThresholds(): ResolutionRiskEquivalenceThresholds {
        return { ...this.thresholds };
    }

    public buildReplayConfidenceInputs(factorComparison: ResolutionFactorComparisonResult): Record<string, unknown> {
        const baseFactorConfidence = this.computeWeightedValue(factorComparison, "confidence");
        const nonHistoricalFactors = FACTOR_ORDER
            .filter((factorName) => factorName !== "historicalDivergence")
            .map((factorName) => factorComparison[factorName].confidence);

        const metadataCompletenessScore = nonHistoricalFactors.some((confidence) => confidence <= 0.4)
            ? new Decimal("0.3")
            : nonHistoricalFactors.every((confidence) => confidence >= 1)
                ? new Decimal("1")
                : nonHistoricalFactors.every((confidence) => confidence >= 0.75)
                    ? new Decimal("0.75")
                    : new Decimal("0.5");

        const historicalCoverageScore = new Decimal(factorComparison.historicalDivergence.confidence);
        const finalConfidence = this.computeConfidenceScore(factorComparison);

        return {
            baseFactorConfidence: baseFactorConfidence.toString(),
            metadataCompletenessScore: metadataCompletenessScore.toString(),
            historicalCoverageScore: historicalCoverageScore.toString(),
            finalConfidenceScore: finalConfidence.toString()
        };
    }

    private validateInput(input: ResolutionRiskScoringInput): void {
        if (
            input.canonicalEventId.trim().length === 0 ||
            input.profileA.id.trim().length === 0 ||
            input.profileB.id.trim().length === 0 ||
            input.version.trim().length === 0
        ) {
            throw new ResolutionRiskScoringError("invalid_scoring_input");
        }

        if (input.profileA.id === input.profileB.id) {
            throw new ResolutionRiskScoringError("invalid_scoring_input");
        }

        for (const factorName of FACTOR_ORDER) {
            const factor = input.factorComparison[factorName];
            this.validateFactor(factor);
        }
    }

    private validateFactor(factor: ResolutionFactorComparison | undefined): void {
        if (!factor) {
            throw new ResolutionRiskScoringError("invalid_factor_comparison");
        }

        if (!Number.isFinite(factor.score) || factor.score < 0 || factor.score > 1) {
            throw new ResolutionRiskScoringError("invalid_factor_comparison");
        }

        if (!Number.isFinite(factor.confidence) || factor.confidence < 0 || factor.confidence > 1) {
            throw new ResolutionRiskScoringError("invalid_factor_comparison");
        }
    }

    private computeWeightedValue(
        factorComparison: ResolutionFactorComparisonResult,
        field: "score" | "confidence"
    ): DecimalValue {
        return FACTOR_ORDER.reduce(
            (acc, factorName) =>
                acc.plus(this.weights[factorName].times(factorComparison[factorName][field])),
            new Decimal(0)
        );
    }

    private computeConfidenceScore(factorComparison: ResolutionFactorComparisonResult): DecimalValue {
        const baseFactorConfidence = this.computeWeightedValue(factorComparison, "confidence");
        const nonHistoricalFactors = FACTOR_ORDER
            .filter((factorName) => factorName !== "historicalDivergence")
            .map((factorName) => factorComparison[factorName].confidence);

        const metadataCompletenessScore = nonHistoricalFactors.some((confidence) => confidence <= 0.4)
            ? new Decimal("0.3")
            : nonHistoricalFactors.every((confidence) => confidence >= 1)
                ? new Decimal("1")
                : nonHistoricalFactors.every((confidence) => confidence >= 0.75)
                    ? new Decimal("0.75")
                    : new Decimal("0.5");

        const historicalCoverageScore = new Decimal(factorComparison.historicalDivergence.confidence);

        return this.clampDecimal(
            baseFactorConfidence.times("0.7")
                .plus(metadataCompletenessScore.times("0.2"))
                .plus(historicalCoverageScore.times("0.1"))
        );
    }

    private mapEquivalenceClass(
        riskScore: DecimalValue,
        confidenceScore: DecimalValue,
        factorComparison: ResolutionFactorComparisonResult
    ): ResolutionEquivalenceClass {
        let classification: ResolutionEquivalenceClass;
        const safeEquivalentMaxRisk = new Decimal(this.thresholds.safeEquivalentMaxRisk);
        const cautionMaxRisk = new Decimal(this.thresholds.cautionMaxRisk);
        const doNotPoolMinRisk = new Decimal(this.thresholds.doNotPoolMinRisk);
        const lowConfidenceThreshold = new Decimal(this.thresholds.lowConfidenceThreshold);
        const safeEquivalentMinConfidence = new Decimal(this.thresholds.safeEquivalentMinConfidence);

        // Define structural risk markers (mismatch here is a hard blocker)
        const isOutcomeSymmetric = 
            factorComparison.oracleMismatch.score === 0 &&
            factorComparison.ruleMismatch.score === 0 &&
            factorComparison.structuralMismatch.score === 0 &&
            factorComparison.wordingAmbiguity.score === 0;

        if (
            factorComparison.oracleMismatch.score === 1 ||
            factorComparison.ruleMismatch.score === 1 ||
            factorComparison.structuralMismatch.score === 1 ||
            riskScore.greaterThanOrEqualTo(doNotPoolMinRisk)
        ) {
            classification = "DO_NOT_POOL";
        } else if (riskScore.greaterThanOrEqualTo(cautionMaxRisk)) {
            classification = isOutcomeSymmetric ? "EQUIVALENT_WITH_LAG" : "HIGH_RISK";
        } else if (riskScore.greaterThanOrEqualTo(safeEquivalentMaxRisk)) {
            classification = isOutcomeSymmetric ? "EQUIVALENT_WITH_LAG" : "CAUTION";
        } else {
            classification = "SAFE_EQUIVALENT";
        }

        if (this.conservativeDowngradeOnLowConfidence && confidenceScore.lessThan(lowConfidenceThreshold)) {
            switch (classification) {
                case "SAFE_EQUIVALENT":
                case "EQUIVALENT_WITH_LAG":
                    return "CAUTION";
                case "CAUTION":
                    return "HIGH_RISK";
                case "HIGH_RISK":
                    return "DO_NOT_POOL";
                default:
                    return classification;
            }
        }

        if (classification === "SAFE_EQUIVALENT" && confidenceScore.lessThan(safeEquivalentMinConfidence)) {
            return isOutcomeSymmetric ? "EQUIVALENT_WITH_LAG" : "CAUTION";
        }

        return classification;
    }

    private buildReasons(factorComparison: ResolutionFactorComparisonResult): readonly string[] {
        const reasons = FACTOR_ORDER.flatMap((factorName) => {
            const factor = factorComparison[factorName];
            if (factor.reason === undefined) {
                return factor.score > 0 || factor.confidence < 1
                    ? [`${factorName}: comparison indicates non-zero risk or reduced confidence`]
                    : [];
            }

            return factor.score > 0 || factor.confidence < 1
                ? [`${factorName}: ${factor.reason}`]
                : [];
        });

        return [...new Set(reasons)];
    }

    private calculateMaxSettlementDelay(profileA: NormalizedResolutionProfile, profileB: NormalizedResolutionProfile): number {
        const profileAMaxDelay = Number(profileA.disputeWindowHours ?? 0) + Number(profileA.settlementLagHours ?? 0);
        const profileBMaxDelay = Number(profileB.disputeWindowHours ?? 0) + Number(profileB.settlementLagHours ?? 0);
        return Math.abs(profileAMaxDelay - profileBMaxDelay);
    }

    private serializeClampedDecimal(value: DecimalValue): string {
        return this.clampDecimal(value).toString();
    }

    private clampDecimal(value: DecimalValue): DecimalValue {
        if (value.lessThan(0)) {
            return new Decimal(0);
        }

        if (value.greaterThan(1)) {
            return new Decimal(1);
        }

        return value;
    }
}
