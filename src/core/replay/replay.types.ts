export type ReplayDecisionType =
    | "RESOLUTION_RISK_ASSESSMENT"
    | "RFQ_GROUPING"
    | "RFQ_RANKING"
    | "SOR_PLAN"
    | "INTERNAL_CROSS"
    | "NETTING_PHASE2A"
    | "CLEARING_PHASE2B";

export type ReplayMode = "READ_ONLY" | "VERIFY" | "DIFF_ONLY";
export type ReplayWriteMode = "REQUIRED" | "BEST_EFFORT";

export type ReplayResultStatus = "MATCH" | "DIFF" | "FAILED" | "SKIPPED";
export type ExactReplayStatus = "MATCH" | "DIFF" | "ERROR";
export type DiffReplayStatus = "MATCH" | "DIFF" | "ERROR";

export interface ReplayEnvelope {
    id: string;
    decisionType: ReplayDecisionType;
    entityId: string;
    correlationId: string;
    configVersion: string;
    engineVersion: string;
    featureFlags: Record<string, unknown>;
    inputSnapshot: Record<string, unknown>;
    decisionTrace: Record<string, unknown>;
    outputSnapshot: Record<string, unknown>;
    createdAt: Date;
}

export interface CreateReplayEnvelopeInput {
    decisionType: ReplayDecisionType;
    entityId: string;
    correlationId: string;
    configVersion: string;
    engineVersion: string;
    featureFlags: Record<string, unknown>;
    inputSnapshot: Record<string, unknown>;
    decisionTrace: Record<string, unknown>;
    outputSnapshot: Record<string, unknown>;
}

export interface WriteReplayEnvelopeInput {
    decisionType: ReplayDecisionType;
    entityId: string;
    correlationId: string;
    configVersion: string;
    engineVersion: string;
    featureFlags: Record<string, unknown>;
    inputSnapshot: Record<string, unknown>;
    decisionTrace: Record<string, unknown>;
    outputSnapshot: Record<string, unknown>;
}

export interface SerializedReplayEnvelopePayload {
    featureFlags: string;
    inputSnapshot: string;
    decisionTrace: string;
    outputSnapshot: string;
}

export interface ReplayBuilderBaseMetadata {
    correlationId: string;
    configVersion: string;
    engineVersion: string;
    featureFlags: Record<string, unknown>;
}

export interface ReplayCaptureConfig {
    configVersion: string;
    engineVersion: string;
    featureFlags: Record<string, unknown>;
    mode: ReplayWriteMode;
}

export interface ReplayScoreBreakdownSnapshot {
    candidateId: string;
    providerId: string;
    effectiveUnitCost: number;
    totalExpectedCost: number;
    breakdown: Record<string, unknown>;
}

export interface ReplaySplitEligibilitySnapshot {
    candidateId: string;
    allowed: boolean;
    reason: string;
    pairKey?: string;
}

export interface ReplayResolutionEligibilityDecision {
    leftProfileId?: string | null;
    rightProfileId?: string | null;
    allowed: boolean;
    reason: string;
    stableKey?: string;
}

export interface ReplayMatchedLegPairSnapshot {
    incomingLegId: string;
    candidateLegId: string;
    marketId: string;
    outcomeId: string;
    matchedSize?: string;
}

export interface ReplayComboCandidateSnapshot {
    comboId: string;
    userId: string;
    state?: string;
    legs: readonly Record<string, unknown>[];
}

export interface ReplayClearingScoreSnapshot {
    participantIds: readonly string[];
    score: Record<string, unknown>;
}

export interface BuildResolutionRiskReplayEnvelopeInput extends ReplayBuilderBaseMetadata {
    canonicalEventId: string;
    profileA: Record<string, unknown>;
    profileB: Record<string, unknown>;
    factorComparison: Record<string, unknown>;
    scoredAssessment: Record<string, unknown>;
    scoringWeights: Record<string, unknown>;
    confidenceInputs: Record<string, unknown>;
    equivalenceThresholds: Record<string, unknown>;
}

export interface BuildRFQGroupingReplayEnvelopeInput extends ReplayBuilderBaseMetadata {
    rfqId: string;
    canonicalEventId: string;
    orderedCandidateProfiles: readonly Record<string, unknown>[];
    orderedAssessments: readonly Record<string, unknown>[];
    pairGenerationOrder: readonly string[];
    grouping: Record<string, unknown>;
}

export interface BuildSORReplayEnvelopeInput extends ReplayBuilderBaseMetadata {
    rfqId: string;
    rfq: Record<string, unknown>;
    selectedQuote: Record<string, unknown>;
    policy: string;
    routeCandidates: readonly Record<string, unknown>[];
    scoredCandidates: readonly ReplayScoreBreakdownSnapshot[];
    allocations: readonly Record<string, unknown>[];
    resolutionRiskPairPolicies: readonly Record<string, unknown>[];
    candidateOrdering: readonly string[];
    splitEligibilityDecisions: readonly ReplaySplitEligibilitySnapshot[];
    buildResult: Record<string, unknown>;
}

export interface BuildInternalCrossReplayEnvelopeInput extends ReplayBuilderBaseMetadata {
    incomingOrderId: string;
    incomingOrder: Record<string, unknown>;
    orderedCandidates: readonly Record<string, unknown>[];
    selfTradeChecks: readonly Record<string, unknown>[];
    resolutionEligibilityDecisions: readonly ReplayResolutionEligibilityDecision[];
    makerIterationOrder: readonly string[];
    lockOrder: readonly string[];
    matchDecisions: readonly Record<string, unknown>[];
    result: Record<string, unknown>;
}

export interface BuildNettingPhase2AReplayEnvelopeInput extends ReplayBuilderBaseMetadata {
    incomingComboId: string;
    incomingCombo: Record<string, unknown>;
    candidateCombos: readonly ReplayComboCandidateSnapshot[];
    candidateOrder: readonly string[];
    compatibilityInputs: readonly Record<string, unknown>[];
    matchedLegPairOrder: readonly ReplayMatchedLegPairSnapshot[];
    resolutionEligibilityDecisions: readonly ReplayResolutionEligibilityDecision[];
    lockResourceIds: readonly string[];
    attemptSnapshots: readonly Record<string, unknown>[];
    result: Record<string, unknown>;
}

export interface BuildClearingPhase2BReplayEnvelopeInput extends ReplayBuilderBaseMetadata {
    bucketId: string;
    plannerConfig: Record<string, unknown>;
    candidateSnapshots: readonly Record<string, unknown>[];
    bucketEntityOrder: readonly string[];
    overlapGraph: Record<string, unknown>;
    enumeratedGroups: readonly Record<string, unknown>[];
    scoreSnapshots: readonly ReplayClearingScoreSnapshot[];
    resolutionEligibilityExclusions: readonly ReplayResolutionEligibilityDecision[];
    selectedPlan: Record<string, unknown> | null;
}

export interface ReplayRun {
    id: string;
    replayEnvelopeId: string;
    mode: ReplayMode;
    requestedBy: string;
    resultStatus: ReplayResultStatus;
    diffSummary?: Record<string, unknown> | null;
    createdAt: Date;
}

export interface CreateReplayRunInput {
    replayEnvelopeId: string;
    mode: ReplayMode;
    requestedBy: string;
    resultStatus: ReplayResultStatus;
    diffSummary?: Record<string, unknown> | null;
}

export interface ExactReplayDiffEntry {
    path: string;
    expected: unknown;
    actual: unknown;
}

export interface ExactReplayDiffSummary {
    reason?: string;
    diffCount: number;
    diffs: readonly ExactReplayDiffEntry[];
}

export interface ExactReplayResult {
    status: ExactReplayStatus;
    diffSummary: ExactReplayDiffSummary | null;
    replayOutput: Record<string, unknown> | null;
}

export interface DiffReplayField {
    path: string;
    original: unknown;
    replayed: unknown;
}

export interface DiffReplaySummary {
    decisionType: ReplayDecisionType;
    diffCount: number;
    changedRouteChoices: readonly Record<string, unknown>[];
    changedRanking: readonly Record<string, unknown>[];
    changedClearingSelection: readonly Record<string, unknown>[];
    changedPenaltiesOrGates: readonly Record<string, unknown>[];
    changedEquivalenceClass: Record<string, unknown> | null;
    fieldDiffs: readonly DiffReplayField[];
    reason?: string;
}

export interface DiffReplayResult {
    status: DiffReplayStatus;
    originalOutput: Record<string, unknown> | null;
    replayOutput: Record<string, unknown> | null;
    diffSummary: DiffReplaySummary | null;
    originalConfigVersion: string | null;
    originalEngineVersion: string | null;
    replayConfigVersion: string | null;
    replayEngineVersion: string | null;
}

export interface ReplayVersionedEvaluatorBundle {
    evaluate?: (
        inputSnapshot: Record<string, unknown>,
        decisionTrace: Record<string, unknown>
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
    config?: Record<string, unknown>;
    description?: string;
}

export type ReplayConfigRegistry = Partial<Record<ReplayDecisionType, Record<string, ReplayVersionedEvaluatorBundle>>>;
export type ReplayEngineRegistry = Partial<Record<ReplayDecisionType, Record<string, ReplayVersionedEvaluatorBundle>>>;
