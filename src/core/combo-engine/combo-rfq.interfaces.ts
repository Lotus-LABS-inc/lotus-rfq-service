export type AcceptancePolicy = "ALL_OR_NONE" | "PARTIAL_ALLOWED" | "BEST_EFFORT";

export interface ComboLegRequest {
    canonicalMarketId: string;
    side: "buy" | "sell";
    quantity: string;
}

export interface ComboRFQRequest {
    requestId: string;
    takerId: string;
    acceptancePolicy: AcceptancePolicy;
    legs: ComboLegRequest[];
}

export interface ComboRFQSession {
    id: string; // UUID
    requestId: string;
    takerId: string;
    acceptancePolicy: AcceptancePolicy;
    status: "OPEN" | "ACCEPTED" | "EXECUTED" | "PARTIALLY_EXECUTED" | "FAILED" | "EXPIRED";
    expiresAt: Date;
    legs: ComboLegSession[];
}

export interface ComboLegSession {
    id: string; // UUID
    comboSessionId: string;
    canonicalMarketId: string;
    side: "buy" | "sell";
    quantity: string;
}

export interface ComboQuote {
    id: string;
    lpId: string;
    comboSessionId: string;
    isComboQuote: boolean; // True if it's a single price for the whole combo
    price: string; // Aggregate price if combo quote, or individual price if leg quote
    quantities: Record<string, string>; // Map of Leg ID -> Quantity offered
    validUntil: Date;
}

export interface RankedComboQuote {
    rank: number;
    costBasis: string; // Payout-vector calculated cost basis or linear sum
    pricingMethod: "PAYOUT_VECTOR" | "LINEAR_SUM";
    quoteIds: string[]; // List of quote IDs that make up this ranked option (could be 1 combo quote, or N single-leg quotes)
}

export interface ExecutionLegPlan {
    legId: string;
    quoteId: string;
    lpId: string;
    quantityToExecute: string;
    price: string;
}

export interface ExecutionPlan {
    id: string;
    comboSessionId: string;
    takerId: string;
    policy: AcceptancePolicy;
    legs: ExecutionLegPlan[];
    totalCostBasis: string;
}

/**
 * Normalizes and ranks quotes, handling Payout-Vector math vs Linear-Sum.
 */
export interface IComboQuoteNormalizer {
    rankQuotes(session: ComboRFQSession, quotes: ComboQuote[]): Promise<RankedComboQuote[]>;
}

/**
 * Translates ranked quotes into an actionable execution plan respecting AON/Partial rules.
 */
export interface IExecutionPlanBuilder {
    buildExecutionPlan(session: ComboRFQSession, rankedQuotes: RankedComboQuote[], requestedQuotes: ComboQuote[]): Promise<ExecutionPlan>;
}

/**
 * Handles database operations for combo RFQs.
 */
export interface IComboRepository {
    createComboSession(session: ComboRFQSession): Promise<void>;
    getComboSession(sessionId: string): Promise<ComboRFQSession | null>;
    saveComboQuote(quote: ComboQuote): Promise<void>;
    getQuotesForCombo(sessionId: string): Promise<ComboQuote[]>;
    saveExecutionPlan(plan: ExecutionPlan): Promise<void>;
    updateComboStatus(sessionId: string, status: ComboRFQSession["status"]): Promise<void>;
}

/**
 * Core Combo Engine orchestrator.
 */
export interface IComboEngine {
    createComboRFQ(req: ComboRFQRequest): Promise<ComboRFQSession>;
    collectQuote(quote: ComboQuote): Promise<void>;
    rankQuotes(sessionId: string): Promise<RankedComboQuote[]>;
    acceptCombo(sessionId: string, selectedRankIndex: number): Promise<ExecutionPlan>;
    buildExecutionPlan(sessionId: string, rankedQuotes: RankedComboQuote[]): Promise<ExecutionPlan>;
    executePlan(planId: string): Promise<void>;
}
