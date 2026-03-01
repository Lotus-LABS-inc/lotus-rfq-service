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
