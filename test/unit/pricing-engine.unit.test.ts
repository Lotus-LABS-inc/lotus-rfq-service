import { describe, it, expect } from "vitest";
import { computePayoutVector, computeLinearApproxPrice, computeEffectiveCostFromLPQuote } from "../../src/core/combo-engine/pricing-engine.js";
import { ComboRFQSession, AcceptancePolicy } from "../../src/core/combo-engine/types.js";

describe("Combo RFQ Pricing Engine", () => {
    // Mock Session: Buy Yes on Market A, Sell Yes on Market B
    const mockCombo: ComboRFQSession = {
        id: "combo-123",
        userId: "user-uuid",
        acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
        state: "OPEN",
        expiresAt: new Date(),
        createdAt: new Date(),
        legs: [
            {
                id: "leg-1",
                comboSessionId: "combo-123",
                canonicalMarketId: "market-A",
                canonicalOutcomeId: "outcome-YES",
                side: "buy",
                quantity: "100"
            },
            {
                id: "leg-2",
                comboSessionId: "combo-123",
                canonicalMarketId: "market-B",
                canonicalOutcomeId: "outcome-YES",
                side: "sell",
                quantity: "100"
            }
        ]
    };

    it("should compute linear approximation price correctly", () => {
        const midPrices = new Map<string, number>();
        midPrices.set("leg-1", 0.60); // Cost -60
        midPrices.set("leg-2", 0.40); // Receive +40 (Short selling implies selling at bid, but we use mid for theory)

        const linearSum = computeLinearApproxPrice(mockCombo, midPrices);
        // Buy 100 * 0.60 = +60 outflow
        // Sell 100 * 0.40 = -40 inflow 
        // Net theoretical position value: (100 * 0.60 * 1) + (100 * 0.40 * -1) = 60 - 40 = 20
        expect(linearSum).toBe(20);
    });

    it("should compute payout vector correctly for independent states", async () => {
        const probMap = new Map();
        probMap.set("market-A", { outcomeProbMap: new Map([["outcome-YES", 0.6]]) });
        probMap.set("market-B", { outcomeProbMap: new Map([["outcome-YES", 0.4]]) });

        const result = await computePayoutVector(mockCombo, probMap);

        // Payout vector should contain payouts for the unified states
        expect(result.payoffVector).toBeDefined();
        // Since we evaluate YES outcome in the simplified universe construction, 
        // payout for hitting YES on both is 100 (from buy) - 100 (from sell) = 0.
        expect(result.payoffVector).toContain(0);
        expect(result.theoreticalPrice).toBeDefined();
    });

    it("should compute effective cost from LP quote including fees", () => {
        const mockQuote = {
            id: "quote-1",
            comboSessionId: "combo-123",
            lpId: "lp-uuid",
            isComboQuote: true,
            comboPrice: "21.50",
            effectiveCost: "0",
            expiresAt: new Date(),
            createdAt: new Date(),
            rawPayload: { impliedGasCostUsd: "1.00" }
        };

        // 21.50 + 10bps fee (0.0215) + 1.00 gas = 22.5215
        const cost = computeEffectiveCostFromLPQuote(mockQuote, 10);
        expect(cost).toBeCloseTo(22.5215, 3);
    });

    it("should aggregate per-leg prices in effective cost safely", () => {
        const mockQuote = {
            id: "quote-2",
            comboSessionId: "combo-123",
            lpId: "lp-uuid",
            isComboQuote: false,
            perLegPrices: [
                { legId: "leg-1", price: "0.65", size: "100" }, // 65
                { legId: "leg-2", price: "0.35", size: "-100" } // -35 (Net: 30)
            ],
            effectiveCost: "0",
            expiresAt: new Date(),
            createdAt: new Date(),
            rawPayload: {}
        };

        const cost = computeEffectiveCostFromLPQuote(mockQuote, 0);
        expect(cost).toBe(30);
    });
});
