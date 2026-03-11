import type {
    ResolutionEquivalenceClass,
    ResolutionRiskAssessment,
    ResolutionRiskPresentationModel,
    ResolutionRiskRecommendedAction,
} from "./resolution-risk.types.js";

const MAX_SHORT_REASONS = 3;

const LABELS: Record<ResolutionEquivalenceClass, string> = {
    SAFE_EQUIVALENT: "Safe equivalent",
    CAUTION: "Caution",
    HIGH_RISK: "High risk",
    DO_NOT_POOL: "Do not pool",
};

const ACTIONS: Record<ResolutionEquivalenceClass, ResolutionRiskRecommendedAction> = {
    SAFE_EQUIVALENT: "Poolable",
    CAUTION: "Pool with caution",
    HIGH_RISK: "Isolate execution",
    DO_NOT_POOL: "Do not pool",
};

export interface IResolutionRiskPresentationFormatter {
    format(assessment: ResolutionRiskAssessment): ResolutionRiskPresentationModel;
    formatMany(assessments: readonly ResolutionRiskAssessment[]): readonly ResolutionRiskPresentationModel[];
}

export class ResolutionRiskPresentationFormatter implements IResolutionRiskPresentationFormatter {
    format(assessment: ResolutionRiskAssessment): ResolutionRiskPresentationModel {
        validateAssessment(assessment);

        const equivalenceClass = assessment.equivalenceClass;
        const label = LABELS[equivalenceClass];
        const recommendedAction = ACTIONS[equivalenceClass];

        if (!label || !recommendedAction) {
            throw new ResolutionRiskPresentationError("invalid_equivalence_class", "Unknown resolution equivalence class.");
        }

        return {
            label,
            riskScore: assessment.riskScore,
            confidenceScore: assessment.confidenceScore,
            equivalenceClass,
            shortReasons: formatShortReasons(assessment.reasons),
            factorBreakdown: assessment.factorBreakdown,
            recommendedAction,
        };
    }

    formatMany(assessments: readonly ResolutionRiskAssessment[]): readonly ResolutionRiskPresentationModel[] {
        return assessments.map((assessment) => this.format(assessment));
    }
}

export class ResolutionRiskPresentationError extends Error {
    constructor(
        public readonly code: "invalid_equivalence_class" | "invalid_assessment",
        message: string,
    ) {
        super(message);
        this.name = "ResolutionRiskPresentationError";
    }
}

const validateAssessment = (assessment: ResolutionRiskAssessment): void => {
    if (!assessment || typeof assessment !== "object") {
        throw new ResolutionRiskPresentationError("invalid_assessment", "Resolution risk assessment is required.");
    }

    if (typeof assessment.riskScore !== "string" || assessment.riskScore.trim() === "") {
        throw new ResolutionRiskPresentationError("invalid_assessment", "Resolution risk assessment riskScore is required.");
    }

    if (typeof assessment.confidenceScore !== "string" || assessment.confidenceScore.trim() === "") {
        throw new ResolutionRiskPresentationError("invalid_assessment", "Resolution risk assessment confidenceScore is required.");
    }

    if (
        assessment.equivalenceClass !== "SAFE_EQUIVALENT" &&
        assessment.equivalenceClass !== "CAUTION" &&
        assessment.equivalenceClass !== "HIGH_RISK" &&
        assessment.equivalenceClass !== "DO_NOT_POOL"
    ) {
        throw new ResolutionRiskPresentationError("invalid_equivalence_class", "Unknown resolution equivalence class.");
    }

    if (!assessment.factorBreakdown || typeof assessment.factorBreakdown !== "object" || Array.isArray(assessment.factorBreakdown)) {
        throw new ResolutionRiskPresentationError("invalid_assessment", "Resolution risk assessment factorBreakdown must be an object.");
    }

    if (!Array.isArray(assessment.reasons)) {
        throw new ResolutionRiskPresentationError("invalid_assessment", "Resolution risk assessment reasons must be an array.");
    }
}

const formatShortReasons = (reasons: readonly string[]): readonly string[] => {
    const formatted: string[] = [];
    const seen = new Set<string>();

    for (const reason of reasons) {
        if (typeof reason !== "string") {
            throw new ResolutionRiskPresentationError("invalid_assessment", "Resolution risk assessment reasons must contain only strings.");
        }

        const trimmed = reason.trim();
        if (trimmed === "" || seen.has(trimmed)) {
            continue;
        }

        seen.add(trimmed);
        formatted.push(trimmed);

        if (formatted.length >= MAX_SHORT_REASONS) {
            break;
        }
    }

    return formatted;
};
