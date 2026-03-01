import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { ComboRFQRequest, AcceptancePolicy, LPComboQuoteRequest } from "../../src/core/combo-engine/types.js";
import { pino } from "pino";

const mockLogger = pino({ level: "silent" });

describe("ComboEngine Core Behaviors", () => {
    let engine: ComboEngine;
    let comboRepoMock: any;
    let quoteRepoMock: any;
    let normalizerMock: any;
    let planBuilderMock: any;
    let riskEngineMock: any;
    let canonicalClientMock: any;
    let executionRouterMock: any;
    let redisMock: any;

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
        normalizerMock = {
            normalizeLPQuote: vi.fn()
        };
        planBuilderMock = {
            buildExecutionPlan: vi.fn()
        };
        riskEngineMock = {
            validateRFQCreation: vi.fn().mockResolvedValue(true),
            validateBeforeExecution: vi.fn().mockResolvedValue("reservation-token-123"),
            updateExposureAfterExecution: vi.fn().mockResolvedValue(true),
            rollbackReservation: vi.fn().mockResolvedValue(true)
        };
        canonicalClientMock = {
            getMarketOutcomeProbabilities: vi.fn().mockResolvedValue(new Map())
        };
        executionRouterMock = {
            executePlan: vi.fn().mockResolvedValue({ status: "COMPLETED" })
        };
        redisMock = {
            hSet: vi.fn(),
            expireAt: vi.fn(),
            zAdd: vi.fn()
        };

        engine = new ComboEngine(
            comboRepoMock,
            quoteRepoMock,
            normalizerMock,
            planBuilderMock,
            riskEngineMock,
            canonicalClientMock,
            executionRouterMock,
            redisMock,
            mockLogger
        );
    });

    it("should successfully create a Combo RFQ and emit event", async () => {
        const req: ComboRFQRequest = {
            requestId: "req-1",
            takerId: "123e4567-e89b-12d3-a456-426614174000",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            legs: [
                { canonicalMarketId: "123e4567-e89b-12d3-a456-426614174001", canonicalOutcomeId: "123e4567-e89b-12d3-a456-426614174002", side: "buy", quantity: "100" },
                { canonicalMarketId: "123e4567-e89b-12d3-a456-426614174003", canonicalOutcomeId: "123e4567-e89b-12d3-a456-426614174004", side: "sell", quantity: "100" }
            ]
        };

        const eventSpy = vi.fn();
        engine.events.on("COMBO_CREATED", eventSpy);

        const session = await engine.createComboRFQ(req);

        expect(session).toBeDefined();
        expect(session.state).toBe("OPEN");
        expect(comboRepoMock.createSession).toHaveBeenCalledWith(session);
        expect(redisMock.hSet).toHaveBeenCalled();
        expect(eventSpy).toHaveBeenCalledWith(session);
        expect(riskEngineMock.validateRFQCreation).toHaveBeenCalled();
    });

    it("should process an LP quote successfully", async () => {
        const mockSession = { id: "session-1", expiresAt: new Date(Date.now() + 60000), legs: [] };
        comboRepoMock.getSession.mockResolvedValue(mockSession);

        const mockNormalized = { id: "quote-1", effectiveCost: "50" };
        normalizerMock.normalizeLPQuote.mockReturnValue(mockNormalized);

        const lpReq: LPComboQuoteRequest = {
            lpId: "00000000-0000-0000-0000-000000000000",
            comboSessionId: "session-1",
            isComboQuote: true,
            comboPrice: "50",
            validUntil: new Date(Date.now() + 10000).toISOString()
        };

        const eventSpy = vi.fn();
        engine.events.on("COMBO_QUOTE_RECEIVED", eventSpy);

        await engine.collectLPQuote(lpReq);

        expect(normalizerMock.normalizeLPQuote).toHaveBeenCalled();
        expect(redisMock.zAdd).toHaveBeenCalledWith("combo:session-1:quotes", { score: 50, value: JSON.stringify(mockNormalized) });
        expect(quoteRepoMock.saveQuote).toHaveBeenCalledWith(mockNormalized);
        expect(eventSpy).toHaveBeenCalledWith(mockNormalized);
    });

    it("should accept combo, reserve risk, and execute execution plan", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            legs: [{ canonicalMarketId: "m1", side: "buy", quantity: "10" }]
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);

        const mockQuote = { id: "quote-1", effectiveCost: "50" };
        quoteRepoMock.getQuotesForSession.mockResolvedValue([mockQuote]);

        const mockPlan = { id: "plan-1" };
        planBuilderMock.buildExecutionPlan.mockResolvedValue(mockPlan);

        const execEventSpy = vi.fn();
        engine.events.on("COMBO_EXECUTION_UPDATE", execEventSpy);

        await engine.acceptCombo("session-1", "quote-1");

        expect(riskEngineMock.validateBeforeExecution).toHaveBeenCalledWith(mockSession, mockQuote);
        expect(planBuilderMock.buildExecutionPlan).toHaveBeenCalled();
        expect(executionRouterMock.executePlan).toHaveBeenCalledWith(mockPlan);
        expect(riskEngineMock.updateExposureAfterExecution).toHaveBeenCalled();
        expect(execEventSpy).toHaveBeenCalledWith({ sessionId: "session-1", status: "SETTLED" });
        expect(comboRepoMock.updateSessionState).toHaveBeenCalledWith("session-1", "EXECUTED");
    });

    it("should reject accept if reservation cannot be obtained", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            legs: [{ canonicalMarketId: "m1", side: "buy", quantity: "10" }]
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);

        const mockQuote = { id: "quote-1", effectiveCost: "50" };
        quoteRepoMock.getQuotesForSession.mockResolvedValue([mockQuote]);

        riskEngineMock.validateBeforeExecution.mockRejectedValue(new Error("Insufficient capital/exposure collision"));

        await expect(engine.acceptCombo("session-1", "quote-1")).rejects.toThrow("Insufficient capital/exposure collision");
        expect(planBuilderMock.buildExecutionPlan).not.toHaveBeenCalled();
    });

    it("should prevent concurrent accepts for overlapping exposures via reservation lock", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            legs: [{ canonicalMarketId: "m1", side: "buy", quantity: "10" }]
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);

        const mockQuote = { id: "quote-1", effectiveCost: "50" };
        quoteRepoMock.getQuotesForSession.mockResolvedValue([mockQuote]);

        let callCount = 0;
        riskEngineMock.validateBeforeExecution.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                // First call simulates realistic execution delay taking the lock
                await new Promise(resolve => setTimeout(resolve, 50));
                return "res-token-1";
            } else {
                // Second concurrent request hits locked resource
                throw new Error("Overlapping exposure reservation lock");
            }
        });

        planBuilderMock.buildExecutionPlan.mockResolvedValue({ id: "plan-1" });

        const req1 = engine.acceptCombo("session-1", "quote-1");
        const req2 = engine.acceptCombo("session-1", "quote-1");

        const results = await Promise.allSettled([req1, req2]);

        expect(results[0].status).toBe("fulfilled");
        expect(results[1].status).toBe("rejected");
        expect((results[1] as any).reason.message).toContain("Overlapping exposure");
    });

    it("should rollback reservation when execution fails downstream", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            legs: [{ canonicalMarketId: "m1", side: "buy", quantity: "10" }]
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);

        const mockQuote = { id: "quote-1", effectiveCost: "50" };
        quoteRepoMock.getQuotesForSession.mockResolvedValue([mockQuote]);

        riskEngineMock.validateBeforeExecution.mockResolvedValue("res-token-1");

        // Downstream builder failure
        planBuilderMock.buildExecutionPlan.mockRejectedValue(new Error("Routing failure"));

        await expect(engine.acceptCombo("session-1", "quote-1")).rejects.toThrow("Routing failure");

        expect(riskEngineMock.rollbackReservation).toHaveBeenCalledWith("res-token-1");
        expect(comboRepoMock.updateSessionState).toHaveBeenCalledWith("session-1", "FAILED");
    });

    it("should fail gracefully if session instantly expires", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() - 1000), // Past
            state: "OPEN",
            legs: []
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);

        await expect(engine.acceptCombo("session-1", "quote-1")).rejects.toThrow("Combo has expired");
        expect(comboRepoMock.updateSessionState).toHaveBeenCalledWith("session-1", "EXPIRED");
    });
});
