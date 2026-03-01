import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComboQuoteNormalizer } from "../../src/services/combo-quote-normalizer.js";
import { ComboRFQSession, AcceptancePolicy, LPComboQuoteRequest } from "../../src/core/combo-engine/types.js";
import { pino } from "pino";

// Disable noisy logs during test
const testLogger = pino({ level: "silent" });

describe("ComboQuoteNormalizer", () => {
    let normalizer: ComboQuoteNormalizer;

    const mockSession: ComboRFQSession = {
        id: "combo-123",
        userId: "user-uuid",
        acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
        state: "OPEN",
        expiresAt: new Date(Date.now() + 60000), // Valid for 1 min
        createdAt: new Date(),
        legs: [
            { id: "leg-1", comboSessionId: "combo-123", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "100" },
            { id: "leg-2", comboSessionId: "combo-123", canonicalMarketId: "m2", canonicalOutcomeId: "o2", side: "sell", quantity: "50" }
        ]
    };

    beforeEach(() => {
        normalizer = new ComboQuoteNormalizer(testLogger);
    });

    it("should process a valid whole-combo quote", () => {
        const lpQuote: LPComboQuoteRequest = {
            lpId: "lp-uuid",
            comboSessionId: "combo-123",
            isComboQuote: true,
            comboPrice: "0.85",
            validUntil: new Date(Date.now() + 30000).toISOString() // 30s
        };

        const result = normalizer.normalizeLPQuote(lpQuote, mockSession);

        expect(result.isComboQuote).toBe(true);
        expect(result.comboPrice).toBe("0.85");
        expect(result.isApproximate).toBe(false);
        expect(result.effectiveCost).toBe("0.85");
    });

    it("should process a valid per-leg quote and flag as approximate", () => {
        const lpQuote: LPComboQuoteRequest = {
            lpId: "lp-uuid",
            comboSessionId: "combo-123",
            isComboQuote: false,
            perLegPrices: [
                { legId: "leg-1", price: "0.50", size: "100" },  // 50
                { legId: "leg-2", price: "0.40", size: "-50" }   // -20 (Cost total: 30)
            ],
            validUntil: new Date(Date.now() + 30000).toISOString()
        };

        const result = normalizer.normalizeLPQuote(lpQuote, mockSession);

        expect(result.isComboQuote).toBe(false);
        expect(result.isApproximate).toBe(true); // Flagged because linear fallback is required
        expect(result.effectiveCost).toBe("30");
    });

    it("should reject quotes that are expired", () => {
        const lpQuote: LPComboQuoteRequest = {
            lpId: "lp-uuid",
            comboSessionId: "combo-123",
            isComboQuote: true,
            comboPrice: "0.85",
            validUntil: new Date(Date.now() - 1000).toISOString() // Past
        };

        expect(() => normalizer.normalizeLPQuote(lpQuote, mockSession)).toThrow(/expired/);
    });

    it("should reject per-leg quotes with missing legs", () => {
        const lpQuote: LPComboQuoteRequest = {
            lpId: "lp-uuid",
            comboSessionId: "combo-123",
            isComboQuote: false,
            perLegPrices: [
                { legId: "leg-1", price: "0.50", size: "100" } // Missing leg-2
            ],
            validUntil: new Date(Date.now() + 30000).toISOString()
        };

        expect(() => normalizer.normalizeLPQuote(lpQuote, mockSession)).toThrow(/exactly the number of requested combo legs/);
    });

    it("should reject per-leg quotes with size mismatch", () => {
        const lpQuote: LPComboQuoteRequest = {
            lpId: "lp-uuid",
            comboSessionId: "combo-123",
            isComboQuote: false,
            perLegPrices: [
                { legId: "leg-1", price: "0.50", size: "100" },
                { legId: "leg-2", price: "0.40", size: "10" } // Wrong size (10 != 50)
            ],
            validUntil: new Date(Date.now() + 30000).toISOString()
        };

        expect(() => normalizer.normalizeLPQuote(lpQuote, mockSession)).toThrow(/Size mismatch on leg leg-2/);
    });
});
