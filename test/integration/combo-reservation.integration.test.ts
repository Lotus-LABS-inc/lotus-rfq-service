import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { ComboQuoteNormalizer } from "../../src/services/combo-quote-normalizer.js";
import { ExecutionPlanBuilder } from "../../src/core/execution-plan/execution-plan-builder.js";
import { AcceptancePolicy, ComboRFQRequest, ComboRFQSession, ComboQuote } from "../../src/core/combo-engine/types.js";
import { pino } from "pino";

const mockLogger = pino({ level: "silent" });

// Thread-safe Async Lock implementation simulating Redis Lock blocking
class ConcurrencyRiskEngine {
    private inFlightLocks = new Set<string>();

    async validateRFQCreation() { return; }

    // Simulates strict lock acquisition block returning a reservation token.
    async validateBeforeExecution(session: ComboRFQSession, quote: ComboQuote): Promise<string> {
        const lockId = session.userId + quote.id;
        if (this.inFlightLocks.has(lockId)) {
            // Emulate failure to obtain collateral
            throw new Error("Overlapping exposure reservation lock");
        }
        this.inFlightLocks.add(lockId);

        // Emulate DB read/write IO pause holding the lock state open
        await new Promise(resolve => setTimeout(resolve, 50));
        return "token-" + lockId;
    }

    async updateExposureAfterExecution(_exec: Record<string, unknown>, _isInternal = false) { return; }
    async rollbackReservation(token: string) {
        const lockId = token.replace("token-", "");
        this.inFlightLocks.delete(lockId);
    }
}

describe("Combo Reservation Concurrency Analysis", () => {
    let engine: ComboEngine;
    let comboRepoMock: any;
    let quoteRepoMock: any;
    let planBuilderMock: any;
    let executionRouterMock: any;
    let concurrencyRiskEngine: ConcurrencyRiskEngine;

    beforeEach(() => {
        comboRepoMock = {
            createSession: vi.fn(),
            getSession: vi.fn(),
            updateSessionState: vi.fn()
        };
        quoteRepoMock = {
            saveQuote: vi.fn(),
            getQuotesForSession: vi.fn()
        };
        const normalizer = new ComboQuoteNormalizer(mockLogger);
        planBuilderMock = {
            buildExecutionPlan: vi.fn().mockResolvedValue({
                id: "plan-1",
                comboId: "c1",
                policy: AcceptancePolicy.ALL_OR_NONE,
                reservationToken: "token-t1q1",
                status: "DRAFT",
                steps: [
                    {
                        id: "step-1",
                        legId: "l1",
                        connector: "DEFAULT_SOR",
                        price: "0.2",
                        targetSize: "10",
                        idempotencyKey: "idem-1",
                        timeoutMs: 5000,
                        unwindStrategy: "REVERT_FILL",
                        fallbackProviders: []
                    }
                ]
            })
        };
        executionRouterMock = {
            executePlan: vi.fn().mockResolvedValue({ status: "COMPLETED" })
        };

        const canonicalClientMock = {
            getMarketOutcomeProbabilities: vi.fn().mockResolvedValue(new Map([
                ["market1", { outcomeProbMap: new Map([["yes", 0.5]]) }]
            ]))
        };

        const redisMock = { incr: vi.fn().mockResolvedValue(1), expire: vi.fn(), hSet: vi.fn(), expireAt: vi.fn() };

        concurrencyRiskEngine = new ConcurrencyRiskEngine();

        engine = new ComboEngine(
            comboRepoMock,
            quoteRepoMock,
            normalizer as any,
            planBuilderMock,
            concurrencyRiskEngine as any,
            canonicalClientMock as any,
            executionRouterMock,
            redisMock as any,
            mockLogger
        );
    });

    it("Concurrent accept attempts produce only 1 reservation/execution against simulated locks", async () => {
        const session: ComboRFQSession = {
            id: crypto.randomUUID(),
            userId: "t1",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            state: "OPEN",
            expiresAt: new Date(Date.now() + 60 * 1000),
            legs: [{ id: "l1", comboSessionId: "c1", canonicalMarketId: "market1", canonicalOutcomeId: "yes", side: "buy", quantity: "10" }],
            createdAt: new Date(),
            metadata: {}
        };

        comboRepoMock.getSession.mockResolvedValue(session);
        quoteRepoMock.getQuotesForSession.mockResolvedValue([{ id: "q1", comboSessionId: session.id, effectiveCost: "0.2" }]);

        // Send two parallel accept requests rapidly
        const p1 = engine.acceptCombo(session.id, "q1");
        const p2 = engine.acceptCombo(session.id, "q1");

        const results = await Promise.allSettled([p1, p2]);

        const successes = results.filter(r => r.status === "fulfilled");
        const errors = results.filter(r => r.status === "rejected");

        expect(successes.length).toBe(1);
        expect(errors.length).toBe(1);

        expect((errors[0] as any).reason.message).toBe("Overlapping exposure reservation lock");
        expect(executionRouterMock.executePlan).toHaveBeenCalledTimes(1);
    });
});
