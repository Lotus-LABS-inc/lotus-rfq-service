import Decimal from "decimal.js";
import type {
    CreateResolutionRiskAssessmentInput,
    ResolutionEquivalenceClass,
    ResolutionFactorComparison,
    ResolutionFactorComparisonResult,
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

const FACTOR_WEIGHTS: Record<FactorName, DecimalValue> = {
    oracleMismatch: new Decimal("0.22"),
    ruleMismatch: new Decimal("0.20"),
    wordingAmbiguity: new Decimal("0.16"),
    disputeWindowMismatch: new Decimal("0.12"),
    settlementLagMismatch: new Decimal("0.10"),
    structuralMismatch: new Decimal("0.10"),
    historicalDivergence: new Decimal("0.10")
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
    score(input: ResolutionRiskScoringInput): CreateResolutionRiskAssessmentInput;
}

export class ResolutionRiskScoringEngine implements IResolutionRiskScoringEngine {
    public score(input: ResolutionRiskScoringInput): CreateResolutionRiskAssessmentInput {
        this.validateInput(input);

        const riskScore = this.computeWeightedValue(input.factorComparison, "score");
        const confidenceScore = this.computeConfidenceScore(input.factorComparison);
        const equivalenceClass = this.mapEquivalenceClass(riskScore, confidenceScore, input.factorComparison);
        const reasons = this.buildReasons(input.factorComparison);

        return {
            canonicalEventId: input.canonicalEventId,
            marketAProfileId: input.marketAProfileId,
            marketBProfileId: input.marketBProfileId,
            riskScore: this.serializeClampedDecimal(riskScore),
            confidenceScore: this.serializeClampedDecimal(confidenceScore),
            equivalenceClass,
            factorBreakdown: input.factorComparison as unknown as Record<string, unknown>,
            reasons,
            version: input.version
        };
    }

    private validateInput(input: ResolutionRiskScoringInput): void {
        if (
            input.canonicalEventId.trim().length === 0 ||
            input.marketAProfileId.trim().length === 0 ||
            input.marketBProfileId.trim().length === 0 ||
            input.version.trim().length === 0
        ) {
            throw new ResolutionRiskScoringError("invalid_scoring_input");
        }

        if (input.marketAProfileId === input.marketBProfileId) {
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
                acc.plus(FACTOR_WEIGHTS[factorName].times(factorComparison[factorName][field])),
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

        if (
            factorComparison.oracleMismatch.score === 1 ||
            factorComparison.ruleMismatch.score === 1 ||
            factorComparison.structuralMismatch.score === 1 ||
            riskScore.greaterThanOrEqualTo("0.75")
        ) {
            classification = "DO_NOT_POOL";
        } else if (riskScore.greaterThanOrEqualTo("0.45")) {
            classification = "HIGH_RISK";
        } else if (riskScore.greaterThanOrEqualTo("0.20")) {
            classification = "CAUTION";
        } else {
            classification = "SAFE_EQUIVALENT";
        }

        if (confidenceScore.lessThan("0.50")) {
            switch (classification) {
                case "SAFE_EQUIVALENT":
                    return "CAUTION";
                case "CAUTION":
                    return "HIGH_RISK";
                case "HIGH_RISK":
                    return "DO_NOT_POOL";
                default:
                    return classification;
            }
        }

        if (classification === "SAFE_EQUIVALENT" && confidenceScore.lessThan("0.70")) {
            return "CAUTION";
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
