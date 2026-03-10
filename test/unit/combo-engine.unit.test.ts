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
    let multiLegInternalNettingEngineMock: any;
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
        multiLegInternalNettingEngineMock = {
            attemptNet: vi.fn(async (incoming: any) => ({
                nettedSize: "0",
                residualLegs: incoming.legs,
                residualRemaining: true,
                nettingGroupIds: [],
                eventsWritten: 0
            })),
            previewNet: vi.fn(async (incoming: any) => ({
                nettedSize: "0",
                residualLegs: incoming.legs,
                residualRemaining: true,
                nettingGroupIds: [],
                eventsWritten: 0
            }))
        };
        riskEngineMock = {
            validateRFQCreation: vi.fn().mockResolvedValue(true),
            validateBeforeExecution: vi.fn().mockResolvedValue("reservation-token-123"),
            updateExposureAfterExecution: vi.fn(async (_exec, _isInternal = false) => true),
            rollbackReservation: vi.fn().mockResolvedValue(true)
        };
        canonicalClientMock = {
            getMarketOutcomeProbabilities: vi.fn().mockResolvedValue(new Map())
        };
        executionRouterMock = {
            executePlan: vi.fn().mockResolvedValue({ status: "COMPLETED" })
        };
        redisMock = {
            get: vi.fn().mockResolvedValue(null),
            hset: vi.fn(),
            expireat: vi.fn(),
            expire: vi.fn(),
            zadd: vi.fn(),
            incr: vi.fn().mockResolvedValue(1)
        };

        engine = new ComboEngine(
            comboRepoMock,
            quoteRepoMock,
            normalizerMock,
            planBuilderMock,
            multiLegInternalNettingEngineMock,
            riskEngineMock,
            canonicalClientMock,
            executionRouterMock,
            redisMock,
            mockLogger,
            { internalNettingEnabled: true }
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
        engine.events.on("COMBO_STATE_UPDATE", eventSpy);

        const session = await engine.createComboRFQ(req);

        expect(session).toBeDefined();
        expect(session.state).toBe("OPEN");
        expect(comboRepoMock.createSession).toHaveBeenCalledWith(session);
        expect(redisMock.hset).toHaveBeenCalled();
        expect(eventSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                combo_id: session.id,
                state: "OPEN"
            })
        );
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
        engine.events.on("COMBO_QUOTE_UPDATE", eventSpy);

        await engine.collectLPQuote(lpReq);

        expect(normalizerMock.normalizeLPQuote).toHaveBeenCalled();
        expect(redisMock.zadd).toHaveBeenCalledWith("combo:session-1:quotes", 50, JSON.stringify(mockNormalized));
        expect(quoteRepoMock.saveQuote).toHaveBeenCalledWith(mockNormalized);
        expect(eventSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                combo_id: "session-1",
                quoteId: "quote-1"
            })
        );
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

        const mockPlan = { id: "plan-1", steps: [] };
        planBuilderMock.buildExecutionPlan.mockResolvedValue(mockPlan);

        const execEventSpy = vi.fn();
        engine.events.on("COMBO_EXECUTION_UPDATE", execEventSpy);

        const result = await engine.acceptCombo("session-1", "quote-1");

        expect(riskEngineMock.validateBeforeExecution).toHaveBeenCalledWith(mockSession, mockQuote);
        expect(multiLegInternalNettingEngineMock.attemptNet).toHaveBeenCalled();
        expect(planBuilderMock.buildExecutionPlan).toHaveBeenCalled();
        expect(executionRouterMock.executePlan).toHaveBeenCalledWith(mockPlan);
        expect(riskEngineMock.updateExposureAfterExecution).toHaveBeenCalled();
        expect(result).toEqual({
            kind: "external_plan",
            plan: mockPlan,
            nettedSize: "0",
            residualLegCount: 1
        });
        expect(execEventSpy).toHaveBeenCalledWith(
            expect.objectContaining({ combo_id: "session-1", status: "SETTLED" })
        );
        expect(comboRepoMock.updateSessionState).toHaveBeenCalledWith("session-1", "EXECUTED");
    });

    it("should complete internally when combo is fully netted", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            userId: "user-1",
            legs: [{ id: "leg-1", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "10" }],
            createdAt: new Date()
        };
        comboRepoMock.getSession
            .mockResolvedValueOnce(mockSession)
            .mockResolvedValueOnce({
                ...mockSession,
                state: "EXECUTED",
                legs: [{ ...mockSession.legs[0], remainingSize: "0" }]
            });
        const mockQuote = { id: "quote-1", effectiveCost: "50" };
        quoteRepoMock.getQuotesForSession.mockResolvedValue([mockQuote]);
        multiLegInternalNettingEngineMock.attemptNet.mockResolvedValue({
            nettedSize: "10",
            residualLegs: [],
            residualRemaining: false,
            nettingGroupIds: ["group-1"],
            eventsWritten: 1
        });

        const result = await engine.acceptCombo("session-1", "quote-1");

        expect(planBuilderMock.buildExecutionPlan).not.toHaveBeenCalled();
        expect(executionRouterMock.executePlan).not.toHaveBeenCalled();
        expect(riskEngineMock.rollbackReservation).toHaveBeenCalledWith("reservation-token-123");
        expect(result).toEqual({
            kind: "internal_filled",
            comboId: "session-1",
            nettingGroupIds: ["group-1"],
            nettedSize: "10"
        });
    });

    it("should skip internal netting when kill switch is active and continue external routing", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            userId: "user-1",
            legs: [{ id: "leg-1", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "10" }],
            createdAt: new Date()
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);
        quoteRepoMock.getQuotesForSession.mockResolvedValue([{ id: "quote-1", effectiveCost: "50" }]);
        redisMock.get.mockResolvedValue("true");
        const mockPlan = { id: "plan-1", steps: [] };
        planBuilderMock.buildExecutionPlan.mockResolvedValue(mockPlan);

        const result = await engine.acceptCombo("session-1", "quote-1");

        expect(multiLegInternalNettingEngineMock.attemptNet).not.toHaveBeenCalled();
        expect(planBuilderMock.buildExecutionPlan).toHaveBeenCalled();
        expect(executionRouterMock.executePlan).toHaveBeenCalledWith(mockPlan);
        expect(result).toEqual({
            kind: "external_plan",
            plan: mockPlan,
            nettedSize: "0",
            residualLegCount: 1
        });
    });

    it("should skip authoritative internal netting when disabled and continue external routing", async () => {
        const mockSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            userId: "user-1",
            legs: [{ id: "leg-1", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "10" }],
            createdAt: new Date()
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);
        quoteRepoMock.getQuotesForSession.mockResolvedValue([{ id: "quote-1", effectiveCost: "50" }]);
        const mockPlan = { id: "plan-disabled", steps: [] };
        planBuilderMock.buildExecutionPlan.mockResolvedValue(mockPlan);

        engine = new ComboEngine(
            comboRepoMock,
            quoteRepoMock,
            normalizerMock,
            planBuilderMock,
            multiLegInternalNettingEngineMock,
            riskEngineMock,
            canonicalClientMock,
            executionRouterMock,
            redisMock,
            mockLogger,
            { internalNettingEnabled: false }
        );

        const result = await engine.acceptCombo("session-1", "quote-1");

        expect(multiLegInternalNettingEngineMock.attemptNet).not.toHaveBeenCalled();
        expect(planBuilderMock.buildExecutionPlan).toHaveBeenCalledWith(
            expect.objectContaining({ legs: [expect.objectContaining({ id: "leg-1" })] }),
            expect.objectContaining({ id: "quote-1" }),
            "reservation-token-123",
            AcceptancePolicy.ALL_OR_NONE
        );
        expect(result).toEqual({
            kind: "external_plan",
            plan: mockPlan,
            nettedSize: "0",
            residualLegCount: 1
        });
    });

    it("runs shadow preview without mutation when sampled", async () => {
        const mockSession = {
            id: "session-shadow",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            userId: "user-1",
            legs: [{ id: "leg-1", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "10" }],
            createdAt: new Date()
        };
        comboRepoMock.getSession.mockResolvedValue(mockSession);
        quoteRepoMock.getQuotesForSession.mockResolvedValue([{ id: "quote-1", effectiveCost: "50" }]);
        planBuilderMock.buildExecutionPlan.mockResolvedValue({ id: "plan-shadow", steps: [] });
        multiLegInternalNettingEngineMock.previewNet.mockResolvedValue({
            nettedSize: "10",
            residualLegs: [],
            residualRemaining: false,
            nettingGroupIds: ["group-shadow"],
            eventsWritten: 0
        });

        engine = new ComboEngine(
            comboRepoMock,
            quoteRepoMock,
            normalizerMock,
            planBuilderMock,
            multiLegInternalNettingEngineMock,
            riskEngineMock,
            canonicalClientMock,
            executionRouterMock,
            redisMock,
            mockLogger,
            {
                internalNettingEnabled: false,
                internalNettingShadowEnabled: true,
                internalNettingShadowPercent: 1,
                now: () => new Date("2026-03-10T12:00:00.000Z")
            }
        );

        await engine.acceptCombo("session-shadow", "quote-1");

        expect(multiLegInternalNettingEngineMock.previewNet).toHaveBeenCalledTimes(1);
        expect(multiLegInternalNettingEngineMock.attemptNet).not.toHaveBeenCalled();
        expect(planBuilderMock.buildExecutionPlan).toHaveBeenCalled();
    });

    it("uses canary sampled internal netting authoritatively", async () => {
        const mockSession = {
            id: "session-canary",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            userId: "user-1",
            legs: [{ id: "leg-1", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "10" }],
            createdAt: new Date()
        };
        comboRepoMock.getSession
            .mockResolvedValueOnce(mockSession)
            .mockResolvedValueOnce({ ...mockSession, state: "EXECUTED", legs: [] });
        quoteRepoMock.getQuotesForSession.mockResolvedValue([{ id: "quote-1", effectiveCost: "50" }]);
        multiLegInternalNettingEngineMock.attemptNet.mockResolvedValue({
            nettedSize: "10",
            residualLegs: [],
            residualRemaining: false,
            nettingGroupIds: ["group-canary"],
            eventsWritten: 1
        });

        engine = new ComboEngine(
            comboRepoMock,
            quoteRepoMock,
            normalizerMock,
            planBuilderMock,
            multiLegInternalNettingEngineMock,
            riskEngineMock,
            canonicalClientMock,
            executionRouterMock,
            redisMock,
            mockLogger,
            {
                internalNettingEnabled: false,
                internalNettingCanaryEnabled: true,
                internalNettingCanaryPercent: 1,
                now: () => new Date("2026-03-10T12:00:00.000Z")
            }
        );

        const result = await engine.acceptCombo("session-canary", "quote-1");

        expect(multiLegInternalNettingEngineMock.attemptNet).toHaveBeenCalledTimes(1);
        expect(planBuilderMock.buildExecutionPlan).not.toHaveBeenCalled();
        expect(result).toEqual({
            kind: "internal_filled",
            comboId: "session-canary",
            nettingGroupIds: ["group-canary"],
            nettedSize: "10"
        });
    });

    it("should use residual legs only after partial internal netting", async () => {
        const initialSession = {
            id: "session-1",
            expiresAt: new Date(Date.now() + 60000),
            state: "OPEN",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            userId: "user-1",
            legs: [
                { id: "leg-1", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", quantity: "10" },
                { id: "leg-2", canonicalMarketId: "m2", canonicalOutcomeId: "o2", side: "sell", quantity: "5" }
            ],
            createdAt: new Date()
        };
        const residualSession = {
            ...initialSession,
            state: "PARTIALLY_EXECUTED",
            legs: [
                { ...initialSession.legs[0], remainingSize: "4" },
                { ...initialSession.legs[1], remainingSize: "0" }
            ]
        };
        comboRepoMock.getSession
            .mockResolvedValueOnce(initialSession)
            .mockResolvedValueOnce(residualSession);
        const mockQuote = { id: "quote-1", effectiveCost: "50" };
        quoteRepoMock.getQuotesForSession.mockResolvedValue([mockQuote]);
        const mockPlan = { id: "plan-1", steps: [{ legId: "leg-1", targetSize: "4" }] };
        multiLegInternalNettingEngineMock.attemptNet.mockResolvedValue({
            nettedSize: "6",
            residualLegs: [
                {
                    id: "leg-1",
                    canonicalMarketId: "m1",
                    canonicalOutcomeId: "o1",
                    side: "buy",
                    remainingSize: "4"
                }
            ],
            residualRemaining: true,
            nettingGroupIds: ["group-1"],
            eventsWritten: 1
        });
        planBuilderMock.buildExecutionPlan.mockResolvedValue(mockPlan);

        const result = await engine.acceptCombo("session-1", "quote-1");

        expect(planBuilderMock.buildExecutionPlan).toHaveBeenCalledWith(
            expect.objectContaining({
                legs: [
                    expect.objectContaining({
                        id: "leg-1",
                        remainingSize: "4"
                    })
                ]
            }),
            mockQuote,
            "reservation-token-123",
            AcceptancePolicy.ALL_OR_NONE
        );
        expect(riskEngineMock.updateExposureAfterExecution).toHaveBeenCalledWith(
            "reservation-token-123",
            "m1",
            "buy",
            4
        );
        expect(result).toEqual({
            kind: "external_plan",
            plan: mockPlan,
            nettedSize: "6",
            residualLegCount: 1
        });
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

        planBuilderMock.buildExecutionPlan.mockResolvedValue({ id: "plan-1", steps: [] });

        const req1 = engine.acceptCombo("session-1", "quote-1");
        const req2 = engine.acceptCombo("session-1", "quote-1");

        const results = await Promise.allSettled([req1, req2]);

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result) => result.status === "rejected");

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect((rejected[0] as PromiseRejectedResult).reason.message).toContain("Overlapping exposure");
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
