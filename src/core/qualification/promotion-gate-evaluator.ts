import { QualificationStage } from "./qualification.types.js";

export type PromotionGateId =
    | "REPLAY_STABILITY"
    | "RECONCILIATION_HEALTH"
    | "PLANNER_LATENCY"
    | "ECONOMIC_QUALITY"
    | "INCIDENT_COUNT"
    | "ADVERSE_SELECTION";

export interface ReplayStabilityThresholds {
    minMatchRate: number;
    maxDiffRate: number;
    maxErrorRate: number;
    minConsecutiveStableRuns: number;
}

export interface ReconciliationHealthThresholds {
    maxMismatchCount: number;
    maxMismatchRate: number;
    maxInfraErrorCount: number;
    maxLockConflictCount: number;
}

export interface PlannerLatencyThresholds {
    maxP95Ms: number;
    maxP99Ms: number;
}

export interface EconomicQualityThresholds {
    minPriceImprovement: string;
    minSlippageSaved: string;
    minFeeSaved: string;
    minExternalNotionalAvoided: string;
    minInternalizationGain: string;
    minCompressionGain: string;
}

export interface IncidentCountThresholds {
    maxIncidents: number;
    maxUnresolvedIncidents: number;
}

export interface AdverseSelectionThresholds {
    maxAdverseFillRate: number;
    maxPostTradeMarkoutLoss: string;
    maxLossRate: number;
}

export interface PromotionTransition {
    fromStage: QualificationStage;
    toStage: QualificationStage;
    replayStability: ReplayStabilityThresholds;
    reconciliationHealth: ReconciliationHealthThresholds;
    plannerLatency: PlannerLatencyThresholds;
    economicQuality: EconomicQualityThresholds;
    incidentCount: IncidentCountThresholds;
    adverseSelection: AdverseSelectionThresholds;
}

export interface PromotionGateConfig {
    version: string;
    transitions: {
        INTERNAL_ONLY_TO_SHADOW: PromotionTransition;
        SHADOW_TO_CANARY: PromotionTransition;
        CANARY_TO_LIMITED_PROD: PromotionTransition;
        LIMITED_PROD_TO_BROAD_PROD: PromotionTransition;
    };
}

export interface ReplayStabilitySignals {
    matchRate: number;
    diffRate: number;
    errorRate: number;
    consecutiveStableRuns: number;
}

export interface ReconciliationHealthSignals {
    mismatchCount: number;
    mismatchRate: number;
    infraErrorCount: number;
    lockConflictCount: number;
}

export interface PlannerLatencySignals {
    p95Ms: number;
    p99Ms: number;
}

export interface EconomicQualitySignals {
    priceImprovement: string;
    slippageSaved: string;
    feeSaved: string;
    externalNotionalAvoided: string;
    internalizationGain: string;
    compressionGain: string;
}

export interface IncidentCountSignals {
    incidents: number;
    unresolvedIncidents: number;
}

export interface AdverseSelectionSignals {
    adverseFillRate: number;
    postTradeMarkoutLoss: string;
    lossRate: number;
}

export interface PromotionGateEvaluationInput {
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    currentStage: QualificationStage;
    qualificationRunId?: string | null;
    replayStability: ReplayStabilitySignals;
    reconciliationHealth: ReconciliationHealthSignals;
    plannerLatency: PlannerLatencySignals;
    economicQuality: EconomicQualitySignals;
    incidentCount: IncidentCountSignals;
    adverseSelection: AdverseSelectionSignals;
    metadata?: Record<string, unknown>;
}

export interface FailedPromotionGate {
    gate: PromotionGateId;
    reason: string;
    observed: Record<string, unknown>;
    threshold: Record<string, unknown>;
}

export interface PromotionGateEvaluationResult {
    promotable: boolean;
    reasons: string[];
    failedGates: FailedPromotionGate[];
    recommendedStage?: QualificationStage;
}

export class PromotionGateEvaluatorError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "PromotionGateEvaluatorError";
    }
}

const STAGE_ORDER: readonly QualificationStage[] = [
    QualificationStage.INTERNAL_ONLY,
    QualificationStage.SHADOW,
    QualificationStage.CANARY,
    QualificationStage.LIMITED_PROD,
    QualificationStage.BROAD_PROD
];

const ensureFiniteNumber = (value: number, fieldName: string): void => {
    if (!Number.isFinite(value)) {
        throw new PromotionGateEvaluatorError(`${fieldName} must be a finite number.`);
    }
};

const parseDecimalLike = (value: string, fieldName: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new PromotionGateEvaluatorError(`${fieldName} must be a finite decimal string.`);
    }
    return parsed;
};

const toRecord = (value: object): Record<string, unknown> => {
    const record = value as Record<string, unknown>;
    return { ...record };
};

const nextStageFor = (stage: QualificationStage): QualificationStage | undefined => {
    const index = STAGE_ORDER.indexOf(stage);
    if (index === -1 || index === STAGE_ORDER.length - 1) {
        return undefined;
    }

    return STAGE_ORDER[index + 1];
};

const transitionKeyFor = (stage: QualificationStage): keyof PromotionGateConfig["transitions"] | undefined => {
    switch (stage) {
        case QualificationStage.INTERNAL_ONLY:
            return "INTERNAL_ONLY_TO_SHADOW";
        case QualificationStage.SHADOW:
            return "SHADOW_TO_CANARY";
        case QualificationStage.CANARY:
            return "CANARY_TO_LIMITED_PROD";
        case QualificationStage.LIMITED_PROD:
            return "LIMITED_PROD_TO_BROAD_PROD";
        default:
            return undefined;
    }
};

export class PromotionGateEvaluator {
    public constructor(private readonly config: PromotionGateConfig) {}

    public evaluate(input: PromotionGateEvaluationInput): PromotionGateEvaluationResult {
        this.validateInput(input);

        const transitionKey = transitionKeyFor(input.currentStage);
        const recommendedStage = nextStageFor(input.currentStage);

        if (!transitionKey || !recommendedStage) {
            return {
                promotable: false,
                reasons: ["already_at_highest_stage"],
                failedGates: []
            };
        }

        const transition = this.config.transitions[transitionKey];
        const failedGates = [
            this.evaluateReplayStability(input.replayStability, transition.replayStability),
            this.evaluateReconciliationHealth(input.reconciliationHealth, transition.reconciliationHealth),
            this.evaluatePlannerLatency(input.plannerLatency, transition.plannerLatency),
            this.evaluateEconomicQuality(input.economicQuality, transition.economicQuality),
            this.evaluateIncidentCount(input.incidentCount, transition.incidentCount),
            this.evaluateAdverseSelection(input.adverseSelection, transition.adverseSelection)
        ].filter((gate): gate is FailedPromotionGate => gate !== null);

        if (failedGates.length > 0) {
            return {
                promotable: false,
                reasons: failedGates.map((gate) => gate.reason),
                failedGates
            };
        }

        return {
            promotable: true,
            reasons: ["all promotion gates passed"],
            failedGates: [],
            recommendedStage
        };
    }

    private validateInput(input: PromotionGateEvaluationInput): void {
        if (input.strategyKey.trim().length === 0) {
            throw new PromotionGateEvaluatorError("strategyKey must be a non-empty string.");
        }
        if (input.scopeType.trim().length === 0) {
            throw new PromotionGateEvaluatorError("scopeType must be a non-empty string.");
        }
        if (input.scopeId.trim().length === 0) {
            throw new PromotionGateEvaluatorError("scopeId must be a non-empty string.");
        }
        if (!STAGE_ORDER.includes(input.currentStage)) {
            throw new PromotionGateEvaluatorError(`Unsupported currentStage ${input.currentStage}.`);
        }

        ensureFiniteNumber(input.replayStability.matchRate, "replayStability.matchRate");
        ensureFiniteNumber(input.replayStability.diffRate, "replayStability.diffRate");
        ensureFiniteNumber(input.replayStability.errorRate, "replayStability.errorRate");
        ensureFiniteNumber(input.replayStability.consecutiveStableRuns, "replayStability.consecutiveStableRuns");

        ensureFiniteNumber(input.reconciliationHealth.mismatchCount, "reconciliationHealth.mismatchCount");
        ensureFiniteNumber(input.reconciliationHealth.mismatchRate, "reconciliationHealth.mismatchRate");
        ensureFiniteNumber(input.reconciliationHealth.infraErrorCount, "reconciliationHealth.infraErrorCount");
        ensureFiniteNumber(input.reconciliationHealth.lockConflictCount, "reconciliationHealth.lockConflictCount");

        ensureFiniteNumber(input.plannerLatency.p95Ms, "plannerLatency.p95Ms");
        ensureFiniteNumber(input.plannerLatency.p99Ms, "plannerLatency.p99Ms");

        parseDecimalLike(input.economicQuality.priceImprovement, "economicQuality.priceImprovement");
        parseDecimalLike(input.economicQuality.slippageSaved, "economicQuality.slippageSaved");
        parseDecimalLike(input.economicQuality.feeSaved, "economicQuality.feeSaved");
        parseDecimalLike(input.economicQuality.externalNotionalAvoided, "economicQuality.externalNotionalAvoided");
        parseDecimalLike(input.economicQuality.internalizationGain, "economicQuality.internalizationGain");
        parseDecimalLike(input.economicQuality.compressionGain, "economicQuality.compressionGain");

        ensureFiniteNumber(input.incidentCount.incidents, "incidentCount.incidents");
        ensureFiniteNumber(input.incidentCount.unresolvedIncidents, "incidentCount.unresolvedIncidents");

        ensureFiniteNumber(input.adverseSelection.adverseFillRate, "adverseSelection.adverseFillRate");
        parseDecimalLike(input.adverseSelection.postTradeMarkoutLoss, "adverseSelection.postTradeMarkoutLoss");
        ensureFiniteNumber(input.adverseSelection.lossRate, "adverseSelection.lossRate");
    }

    private evaluateReplayStability(
        observed: ReplayStabilitySignals,
        threshold: ReplayStabilityThresholds
    ): FailedPromotionGate | null {
        if (
            observed.matchRate >= threshold.minMatchRate &&
            observed.diffRate <= threshold.maxDiffRate &&
            observed.errorRate <= threshold.maxErrorRate &&
            observed.consecutiveStableRuns >= threshold.minConsecutiveStableRuns
        ) {
            return null;
        }

        return {
            gate: "REPLAY_STABILITY",
            reason: "replay stability gate failed",
            observed: toRecord(observed),
            threshold: toRecord(threshold)
        };
    }

    private evaluateReconciliationHealth(
        observed: ReconciliationHealthSignals,
        threshold: ReconciliationHealthThresholds
    ): FailedPromotionGate | null {
        if (
            observed.mismatchCount <= threshold.maxMismatchCount &&
            observed.mismatchRate <= threshold.maxMismatchRate &&
            observed.infraErrorCount <= threshold.maxInfraErrorCount &&
            observed.lockConflictCount <= threshold.maxLockConflictCount
        ) {
            return null;
        }

        return {
            gate: "RECONCILIATION_HEALTH",
            reason: "reconciliation health gate failed",
            observed: toRecord(observed),
            threshold: toRecord(threshold)
        };
    }

    private evaluatePlannerLatency(
        observed: PlannerLatencySignals,
        threshold: PlannerLatencyThresholds
    ): FailedPromotionGate | null {
        if (observed.p95Ms <= threshold.maxP95Ms && observed.p99Ms <= threshold.maxP99Ms) {
            return null;
        }

        return {
            gate: "PLANNER_LATENCY",
            reason: "planner latency gate failed",
            observed: toRecord(observed),
            threshold: toRecord(threshold)
        };
    }

    private evaluateEconomicQuality(
        observed: EconomicQualitySignals,
        threshold: EconomicQualityThresholds
    ): FailedPromotionGate | null {
        if (
            parseDecimalLike(observed.priceImprovement, "economicQuality.priceImprovement") >= parseDecimalLike(threshold.minPriceImprovement, "threshold.minPriceImprovement") &&
            parseDecimalLike(observed.slippageSaved, "economicQuality.slippageSaved") >= parseDecimalLike(threshold.minSlippageSaved, "threshold.minSlippageSaved") &&
            parseDecimalLike(observed.feeSaved, "economicQuality.feeSaved") >= parseDecimalLike(threshold.minFeeSaved, "threshold.minFeeSaved") &&
            parseDecimalLike(observed.externalNotionalAvoided, "economicQuality.externalNotionalAvoided") >= parseDecimalLike(threshold.minExternalNotionalAvoided, "threshold.minExternalNotionalAvoided") &&
            parseDecimalLike(observed.internalizationGain, "economicQuality.internalizationGain") >= parseDecimalLike(threshold.minInternalizationGain, "threshold.minInternalizationGain") &&
            parseDecimalLike(observed.compressionGain, "economicQuality.compressionGain") >= parseDecimalLike(threshold.minCompressionGain, "threshold.minCompressionGain")
        ) {
            return null;
        }

        return {
            gate: "ECONOMIC_QUALITY",
            reason: "economic quality gate failed",
            observed: toRecord(observed),
            threshold: toRecord(threshold)
        };
    }

    private evaluateIncidentCount(
        observed: IncidentCountSignals,
        threshold: IncidentCountThresholds
    ): FailedPromotionGate | null {
        if (
            observed.incidents <= threshold.maxIncidents &&
            observed.unresolvedIncidents <= threshold.maxUnresolvedIncidents
        ) {
            return null;
        }

        return {
            gate: "INCIDENT_COUNT",
            reason: "incident count gate failed",
            observed: toRecord(observed),
            threshold: toRecord(threshold)
        };
    }

    private evaluateAdverseSelection(
        observed: AdverseSelectionSignals,
        threshold: AdverseSelectionThresholds
    ): FailedPromotionGate | null {
        if (
            observed.adverseFillRate <= threshold.maxAdverseFillRate &&
            parseDecimalLike(observed.postTradeMarkoutLoss, "adverseSelection.postTradeMarkoutLoss") <= parseDecimalLike(threshold.maxPostTradeMarkoutLoss, "threshold.maxPostTradeMarkoutLoss") &&
            observed.lossRate <= threshold.maxLossRate
        ) {
            return null;
        }

        return {
            gate: "ADVERSE_SELECTION",
            reason: "adverse selection gate failed",
            observed: toRecord(observed),
            threshold: toRecord(threshold)
        };
    }
}
