import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionPlanBuilder } from "../../src/core/execution-plan/execution-plan-builder.js";
import { ComboRFQSession, AcceptancePolicy, ComboQuote } from "../../src/core/combo-engine/types.js";
import { pino } from "pino";

const mockLogger = pino({ level: "silent" });

describe("ExecutionPlanBuilder", () => {
    let builder: ExecutionPlanBuilder;
    let repoMock: any;

    const mockSession: ComboRFQSession = {
        id: "combo-123",
        userId: "user-uuid",
        acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
        state: "ACCEPTED",
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        legs: [
            { id: "leg-1", comboSessionId: "combo-123", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "100" },
            { id: "leg-2", comboSessionId: "combo-123", canonicalMarketId: "m2", canonicalOutcomeId: "o2", side: "sell", quantity: "50" }
        ]
    };

    beforeEach(() => {
        repoMock = {
            savePlan: vi.fn().mockResolvedValue(undefined),
            updatePlanStatus: vi.fn().mockResolvedValue(undefined)
        };
        builder = new ExecutionPlanBuilder(repoMock, mockLogger);
    });

    it("should generate a composite routing plan if connector is specified in comboQuote", async () => {
        const mockQuote: ComboQuote = {
            id: "quote-1",
            comboSessionId: "combo-123",
            lpId: "lp-uuid",
            isComboQuote: true,
            effectiveCost: "25.00",
            expiresAt: new Date(),
            createdAt: new Date(),
            rawPayload: { connector: "BINANCE_COMBO_ENDPOINT" } // Explicit connector mapping flag
        };

        const plan = await builder.buildExecutionPlan(mockSession, mockQuote, "token-123", AcceptancePolicy.ALL_OR_NONE);

        expect(plan.id).toBeDefined();
        expect(plan.status).toBe("DRAFT");
        expect(plan.steps.length).toBe(2);

        // Verify composite routing logic
        expect(plan.steps[0]!.connector).toBe("BINANCE_COMBO_ENDPOINT");
        expect(plan.steps[1]!.connector).toBe("BINANCE_COMBO_ENDPOINT");

        // FOK enforcement for composite overrides
        expect(plan.steps[0]!.retryPolicy.maxRetries).toBe(0);

        // Idempotency tests
        expect(plan.steps[0]!.clientOrderId).toBeDefined();
        expect(plan.steps[0]!.idempotencyKey).toBeDefined();
        // Keys must not collide
        expect(plan.steps[0]!.idempotencyKey).not.toBe(plan.steps[1]!.idempotencyKey);

        expect(repoMock.savePlan).toHaveBeenCalledWith(plan);
    });

    it("should generate individual leg step plans when standard per_leg prices are provided", async () => {
        const mockQuote: ComboQuote = {
            id: "quote-1",
            comboSessionId: "combo-123",
            lpId: "lp-uuid",
            isComboQuote: false,
            perLegPrices: [
                { legId: "leg-1", price: "0.50", size: "100" },
                { legId: "leg-2", price: "0.50", size: "50" }
            ],
            effectiveCost: "25.00",
            expiresAt: new Date(),
            createdAt: new Date(),
            rawPayload: {} // No overarching combo connector specified
        };

        const plan = await builder.buildExecutionPlan(mockSession, mockQuote, "token-123", AcceptancePolicy.PARTIAL_ALLOWED);

        expect(plan.steps.length).toBe(2);

        // Without connector defaults to DEFAULT_SOR
        expect(plan.steps[0]!.connector).toBe("DEFAULT_SOR");
        expect(plan.steps[0]!.price).toBe("0.50");
        expect(plan.steps[0]!.unwindStrategy).toBe("MARKET_SELL"); // Mapped to Policy correctly
        expect(plan.steps[0]!.retryPolicy.maxRetries).toBe(2); // Regular SOR legs should allow transparent retry loops
    });

    it("should gracefully finalize DRAFT plans to READY", async () => {
        await builder.finalizePlan("plan-uuid");
        expect(repoMock.updatePlanStatus).toHaveBeenCalledWith("plan-uuid", "READY");
    });
});
