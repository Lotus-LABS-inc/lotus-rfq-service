import { z } from "zod";
import type { STPMode } from "../sor/types.js";

/**
 * Valid Acceptance Policies for Combo RFQs.
 */
export enum AcceptancePolicy {
    ALL_OR_NONE = "ALL_OR_NONE",
    PARTIAL_ALLOWED = "PARTIAL_ALLOWED",
    BEST_EFFORT = "BEST_EFFORT"
}

/**
 * Zod Schema for Combo Leg Request Validation.
 */
export const ComboLegRequestSchema = z.object({
    canonicalMarketId: z.string().uuid(),
    canonicalOutcomeId: z.string().uuid(),
    side: z.enum(["buy", "sell"]),
    quantity: z.string() // string to preserve numeric precision
});

/**
 * Zod Schema for Combo RFQ Request Validation.
 */
export const ComboRFQRequestSchema = z.object({
    requestId: z.string(),
    takerId: z.string().uuid(),
    acceptancePolicy: z.nativeEnum(AcceptancePolicy),
    legs: z.array(ComboLegRequestSchema).min(2, "Combo RFQ must have at least 2 legs")
});

export type ComboLegRequest = z.infer<typeof ComboLegRequestSchema>;
export type ComboRFQRequest = z.infer<typeof ComboRFQRequestSchema>;

export interface ComboLeg {
    id: string; // UUID
    comboSessionId: string;
    canonicalMarketId: string;
    canonicalOutcomeId: string;
    side: "buy" | "sell";
    quantity: string;
    remainingSize?: string;
    priceHint?: string;
    metadata?: Record<string, any>;
}

export interface ComboRFQSession {
    id: string; // UUID
    userId: string;
    acceptancePolicy: AcceptancePolicy;
    state: "OPEN" | "ACCEPTED" | "EXECUTED" | "PARTIALLY_EXECUTED" | "FAILED" | "EXPIRED";
    expiresAt: Date;
    metadata?: Record<string, any>;
    createdAt: Date;
    legs: ComboLeg[];
}

/**
 * Zod Schema for incoming Combo Quote from LPs
 */
export const LPComboQuoteSchema = z.object({
    lpId: z.string().uuid(),
    comboSessionId: z.string().uuid(),
    isComboQuote: z.boolean(),
    comboPrice: z.string().optional(),
    perLegPrices: z.array(z.object({
        legId: z.string().uuid(),
        price: z.string(),
        size: z.string()
    })).optional(),
    validUntil: z.string().datetime(),
    rawPayload: z.record(z.string(), z.any()).optional()
}).passthrough();

export type LPComboQuoteRequest = z.infer<typeof LPComboQuoteSchema>;

export interface ComboQuote {
    id: string;
    comboSessionId: string;
    lpId: string;
    isComboQuote: boolean;
    comboPrice?: string;
    perLegPrices?: Array<{ legId: string; price: string; size: string }>;
    effectiveCost: string;
    expiresAt: Date;
    rawPayload: Record<string, any>;
    createdAt: Date;
}

export interface ComboAcceptInternalFilledResult {
    kind: "internal_filled";
    comboId: string;
    nettingGroupIds: readonly string[];
    nettedSize: string;
}

export interface ComboAcceptInternalClearedResult {
    kind: "internal_cleared";
    comboId: string;
    clearingRoundId: string;
    participantSetHash: string;
    matchSignatureHash: string;
    clearedParticipantCount: number;
}

export interface ComboAcceptExternalPlanResult {
    kind: "external_plan";
    plan: import("../execution-plan/execution-plan-builder.js").ExecutionPlan;
    nettedSize: string;
    residualLegCount: number;
}

export type ComboAcceptResult =
    | ComboAcceptInternalFilledResult
    | ComboAcceptInternalClearedResult
    | ComboAcceptExternalPlanResult;

export type ComboNettingGroupState = "PENDING" | "MATCHED" | "SETTLED" | "FAILED" | "UNWOUND";

export interface ComboNettingGroup {
    id: string;
    incomingComboId: string;
    matchedComboId: string;
    state: ComboNettingGroupState;
    matchedSize: string;
    createdAt: Date;
}

export interface CreateComboNettingGroupInput {
    id?: string;
    incomingComboId: string;
    matchedComboId: string;
    state: ComboNettingGroupState;
    matchedSize: string;
    createdAt?: Date;
}

export interface ComboNettingMatchLeg {
    id: string;
    nettingGroupId: string;
    incomingLegId: string;
    matchedLegId: string;
    marketId: string;
    outcomeId: string;
    matchedSize: string;
    price: string;
    createdAt: Date;
}

export interface CreateComboNettingMatchLegInput {
    id?: string;
    nettingGroupId: string;
    incomingLegId: string;
    matchedLegId: string;
    marketId: string;
    outcomeId: string;
    matchedSize: string;
    price: string;
    createdAt?: Date;
}

export interface ComboNettingEvent {
    id: string;
    nettingGroupId: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: Date;
}

export interface ComboNettingAttempt {
    attemptId: string;
    incomingComboId: string;
    matchedComboId: string;
    nettingGroupId?: string | null;
    status: "APPLIED";
    createdAt: Date;
}

export interface CreateComboNettingEventInput {
    id?: string;
    nettingGroupId: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt?: Date;
}

export interface ResidualComboLeg {
    id: string;
    canonicalMarketId: string;
    canonicalOutcomeId: string;
    side: "buy" | "sell";
    remainingSize: string;
    priceHint?: string;
}

export interface MultiLegInternalNettingInput {
    id: string;
    userId: string;
    state?: ComboRFQSession["state"];
    legs: readonly ResidualComboLeg[];
}

export interface NettingAttemptSnapshot {
    incomingComboId: string;
    candidateComboId: string;
    matchedLegPairs: ReadonlyArray<{
        incomingLegId: string;
        candidateLegId: string;
        matchedSize: string;
    }>;
    maxNettableSize: string;
    attemptId: string;
}

export interface MultiLegInternalNettingResult {
    nettedSize: string;
    residualLegs: readonly ResidualComboLeg[];
    residualRemaining: boolean;
    nettingGroupIds: readonly string[];
    eventsWritten: number;
}

export interface ComboNettingExposureAggregationLeg {
    incomingLegId: string;
    incomingSide: "buy" | "sell";
    candidateLegId: string;
    candidateSide: "buy" | "sell";
    marketId: string;
    outcomeId: string;
    matchedSize: string;
    price: string;
}

export interface ComboNettingExposureAggregationInput {
    matchedLegs: readonly ComboNettingExposureAggregationLeg[];
}

export interface ComboNettingPerLegExposureDelta {
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    price: string;
    matchedSize: string;
    maxLossDelta: string;
    maxGainDelta: string;
}

export interface ComboNettingUserExposureAggregate {
    maxLossDelta: string;
    maxGainDelta: string;
    perLeg: readonly ComboNettingPerLegExposureDelta[];
}

export interface ComboNettingExposureAggregationResult {
    userA: ComboNettingUserExposureAggregate;
    userB: ComboNettingUserExposureAggregate;
}

export type ClearingRoundState = "PENDING" | "MATCHED" | "SETTLED" | "FAILED" | "UNWOUND";

export type ClearingParticipantRole = "INCOMING" | "MATCHED" | "RESIDUAL";

export interface ClearingRound {
    id: string;
    compatibilityBucket: string;
    state: ClearingRoundState;
    participantCount: number;
    uniqueLegCount: number;
    compressionScore: string;
    participantSetHash: string;
    matchSignatureHash: string;
    createdAt: Date;
}

export interface CreateClearingRoundInput {
    id?: string;
    compatibilityBucket: string;
    state: ClearingRoundState;
    participantCount: number;
    uniqueLegCount: number;
    compressionScore: string;
    participantSetHash: string;
    matchSignatureHash: string;
    createdAt?: Date;
}

export interface ClearingRoundParticipant {
    id: string;
    clearingRoundId: string;
    comboOrOrderId: string;
    participantUserId: string;
    role: ClearingParticipantRole;
    originalRemaining: Record<string, unknown>;
    matchedRemaining: Record<string, unknown>;
    createdAt: Date;
}

export interface CreateClearingRoundParticipantInput {
    id?: string;
    clearingRoundId: string;
    comboOrOrderId: string;
    participantUserId: string;
    role: ClearingParticipantRole;
    originalRemaining: Record<string, unknown>;
    matchedRemaining: Record<string, unknown>;
    createdAt?: Date;
}

export interface ClearingRoundLegMatch {
    id: string;
    clearingRoundId: string;
    marketId: string;
    outcomeId: string;
    participantId: string;
    signedMatchedSize: string;
    price: string | null;
    createdAt: Date;
}

export interface CreateClearingRoundLegMatchInput {
    id?: string;
    clearingRoundId: string;
    marketId: string;
    outcomeId: string;
    participantId: string;
    signedMatchedSize: string;
    price?: string | null;
    createdAt?: Date;
}

export interface ClearingRoundEvent {
    id: string;
    clearingRoundId: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: Date;
}

export interface CreateClearingRoundEventInput {
    id?: string;
    clearingRoundId: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt?: Date;
}

export interface ResidualVectorLeg {
    id: string;
    canonicalMarketId: string;
    canonicalOutcomeId: string;
    side: "buy" | "sell";
    remainingSize: string;
    metadata?: Record<string, unknown>;
}

export interface ResidualVectorEntity {
    entityId: string;
    userId: string;
    legs: readonly ResidualVectorLeg[];
}

export interface ResidualVector {
    entityId: string;
    userId: string;
    compatibilityBucket: string;
    vector: Record<string, string>;
    legCount: number;
    grossAbsSize: string;
}

export interface OverlapGraphNode {
    entityId: string;
    userId: string;
    compatibilityBucket: string;
    vector: Record<string, string>;
    legCount: number;
    grossAbsSize: string;
}

export interface OverlapGraphOverlapLeg {
    key: string;
    signedSizeA: string;
    signedSizeB: string;
    offsetSize: string;
}

export interface OverlapGraphEdge {
    from: string;
    to: string;
    overlapLegs: readonly OverlapGraphOverlapLeg[];
    compressionPotential: string;
    exactOppositionScore: string;
    partialOverlapScore: string;
}

export interface OverlapGraph {
    nodes: readonly OverlapGraphNode[];
    edges: readonly OverlapGraphEdge[];
}

export interface CandidateGroupEnumeratorConfig {
    maxParticipants: number;
    maxUniqueLegs: number;
    stpMode: STPMode;
}

export interface CandidateGroupResidual {
    key: string;
    signedResidual: string;
}

export interface CandidateGroup {
    participantIds: readonly string[];
    uniqueLegs: readonly string[];
    estimatedCompressionScore: string;
    residualAfterNetting: readonly CandidateGroupResidual[];
    exactnessScore: string;
}

export interface ScorableResidualVector extends ResidualVector {
    createdAt: Date | string;
}

export interface ParticipantResidualVector {
    entityId: string;
    vector: Record<string, string>;
}

export interface ClearingCompressionTieBreak {
    smallestResidual: string;
    oldestParticipantAt: string;
    participantCount: number;
}

export interface ClearingCompressionScore {
    compressionScore: string;
    preNetAbsExposure: string;
    postNetAbsResidual: string;
    residualVectorByParticipant: Record<string, ParticipantResidualVector>;
    rankingPenalty: string;
    finalScore: string;
    tieBreak: ClearingCompressionTieBreak;
}

export interface ClearingRoundPlannerConfig {
    bucketWindowLimit: number;
    bucketCursor?: string;
    maxParticipants: number;
    maxUniqueLegs: number;
    stpMode: STPMode;
}

export interface ClearingRoundPlan {
    compatibilityBucket: string;
    selectedGroup: CandidateGroup;
    score: ClearingCompressionScore;
    residuals: readonly CandidateGroupResidual[];
    participantLockOrder: readonly string[];
}

export interface ClearingExecutionResidual {
    key: string;
    signedResidual: string;
}

export interface ClearingExecutionParticipant {
    entityId: string;
    userId: string;
    state: "EXECUTED" | "PARTIALLY_EXECUTED";
    originalRemaining: Record<string, string>;
    matchedRemaining: Record<string, string>;
    residualRemaining: Record<string, string>;
}

export interface ClearingMatchSignature {
    participantSetHash: string;
    matchSignatureHash: string;
}

export interface ClearingRoundReplayResult extends ClearingMatchSignature {
    replayed: true;
    applied: false;
    clearingRoundId: string;
    compatibilityBucket: string;
    residuals: readonly ClearingExecutionResidual[];
    participantLockOrder: readonly string[];
    updatedParticipantIds: readonly string[];
    participants: readonly ClearingExecutionParticipant[];
    eventCount: number;
}

export interface ClearingRoundExecutionAppliedResult extends ClearingMatchSignature {
    replayed: false;
    applied: true;
    clearingRoundId: string;
    compatibilityBucket: string;
    residuals: readonly ClearingExecutionResidual[];
    participantLockOrder: readonly string[];
    updatedParticipantIds: readonly string[];
    participants: readonly ClearingExecutionParticipant[];
    eventCount: number;
}

export type ClearingRoundExecutionResult =
    | ClearingRoundReplayResult
    | ClearingRoundExecutionAppliedResult;

export interface MultiPartyExposureAggregationLeg {
    participantId: string;
    userId: string;
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    price: string;
    matchedSize: string;
}

export interface MultiPartyExposureAggregationInput {
    matchedLegAllocations: readonly MultiPartyExposureAggregationLeg[];
}

export interface MultiPartyPerLegExposureDelta {
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    price: string;
    matchedSize: string;
    maxLossDelta: string;
    maxGainDelta: string;
}

export interface MultiPartyParticipantExposureDelta {
    participantId: string;
    userId: string;
    maxLossDelta: string;
    maxGainDelta: string;
    perLegDeltas: readonly MultiPartyPerLegExposureDelta[];
}

export interface MultiPartyExposureAggregationResult {
    participantExposureDeltas: readonly MultiPartyParticipantExposureDelta[];
}
