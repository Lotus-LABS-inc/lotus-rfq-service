export enum QualificationStage {
    INTERNAL_ONLY = "INTERNAL_ONLY",
    SHADOW = "SHADOW",
    CANARY = "CANARY",
    LIMITED_PROD = "LIMITED_PROD",
    BROAD_PROD = "BROAD_PROD"
}

export enum QualificationRunStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    PAUSED = "PAUSED",
    SUCCEEDED = "SUCCEEDED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}

export enum AutoSafetyActionType {
    DEMOTE_STAGE = "DEMOTE_STAGE",
    DISABLE_PHASE2B = "DISABLE_PHASE2B",
    DISABLE_PHASE2A_AND_2B = "DISABLE_PHASE2A_AND_2B",
    FORCE_SOR_ONLY = "FORCE_SOR_ONLY",
    DISABLE_RESOLUTION_POOLING = "DISABLE_RESOLUTION_POOLING",
    PAUSE_SCOPE = "PAUSE_SCOPE"
}

export interface StrategyQualificationRun {
    id: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    stage: QualificationStage;
    engineVersion: string;
    configVersion: string;
    startedAt: Date;
    endedAt: Date | null;
    status: QualificationRunStatus;
    metadata: Record<string, unknown>;
}

export interface CreateStrategyQualificationRunInput {
    id?: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    stage: QualificationStage;
    engineVersion: string;
    configVersion: string;
    startedAt?: Date;
    endedAt?: Date | null;
    status: QualificationRunStatus;
    metadata?: Record<string, unknown>;
}

export interface StrategyDecisionEvaluation {
    id: string;
    qualificationRunId: string;
    decisionType: string;
    entityId: string;
    replayEnvelopeId: string | null;
    realizedMetrics: Record<string, unknown>;
    counterfactualMetrics: Record<string, unknown>;
    improvementMetrics: Record<string, unknown>;
    createdAt: Date;
}

export interface CreateStrategyDecisionEvaluationInput {
    id?: string;
    qualificationRunId: string;
    decisionType: string;
    entityId: string;
    replayEnvelopeId?: string | null;
    realizedMetrics: Record<string, unknown>;
    counterfactualMetrics: Record<string, unknown>;
    improvementMetrics: Record<string, unknown>;
    createdAt?: Date;
}

export interface PromotionEvent {
    id: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
}

export interface CreatePromotionEventInput {
    id?: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    fromStage: QualificationStage;
    toStage: QualificationStage;
    reason: string;
    createdBy: string;
    createdAt?: Date;
    metadata?: Record<string, unknown>;
}

export interface AutoSafetyAction {
    id: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    actionType: AutoSafetyActionType;
    triggerReason: string;
    createdAt: Date;
    resolvedAt: Date | null;
    metadata: Record<string, unknown>;
}

export interface CreateAutoSafetyActionInput {
    id?: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    actionType: AutoSafetyActionType;
    triggerReason: string;
    createdAt?: Date;
    resolvedAt?: Date | null;
    metadata?: Record<string, unknown>;
}
