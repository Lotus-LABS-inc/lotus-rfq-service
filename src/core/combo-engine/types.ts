import { z } from "zod";

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

export interface ComboAcceptExternalPlanResult {
    kind: "external_plan";
    plan: import("../execution-plan/execution-plan-builder.js").ExecutionPlan;
    nettedSize: string;
    residualLegCount: number;
}

export type ComboAcceptResult = ComboAcceptInternalFilledResult | ComboAcceptExternalPlanResult;

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
