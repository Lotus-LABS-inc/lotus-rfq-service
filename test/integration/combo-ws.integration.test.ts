import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { pino } from "pino";
import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import { comboRoutes } from "../../src/api/combo.routes.js";
import { ComboRFQRequest, AcceptancePolicy, LPComboQuoteRequest } from "../../src/core/combo-engine/types.js";

const mockLogger = pino({ level: "silent" });

describe("WebSocket streaming and REST endpoints", () => {
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

        let seqMap: Record<string, number> = {};
        redisMock = {
            hSet: vi.fn(),
            expireAt: vi.fn(),
            expire: vi.fn(),
            zAdd: vi.fn(),
            incr: vi.fn(async (key: string) => {
                if (!seqMap[key]) seqMap[key] = 0;
                seqMap[key]++;
                return seqMap[key];
            })
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

    it("should emit sequences sequentially starting at 1", async () => {
        const req: ComboRFQRequest = {
            requestId: "req-1",
            takerId: "123e4567-e89b-12d3-a456-426614174000",
            acceptancePolicy: AcceptancePolicy.ALL_OR_NONE,
            legs: [
                { canonicalMarketId: "123e4567-e89b-12d3-a456-426614174001", canonicalOutcomeId: "123e4567-e89b-12d3-a456-426614174001", side: "buy", quantity: "100" },
                { canonicalMarketId: "123e4567-e89b-12d3-a456-426614174002", canonicalOutcomeId: "123e4567-e89b-12d3-a456-426614174002", side: "sell", quantity: "50" }
            ]
        };

        const emittedPayloads: any[] = [];
        engine.events.on("COMBO_STATE_UPDATE", p => emittedPayloads.push(p));
        engine.events.on("COMBO_QUOTE_UPDATE", p => emittedPayloads.push(p));
        engine.events.on("COMBO_EXECUTION_UPDATE", p => emittedPayloads.push(p));

        const session = await engine.createComboRFQ(req);

        // Simulate LP quote
        comboRepoMock.getSession.mockResolvedValue(session);
        const lpQuote: LPComboQuoteRequest = {
            lpId: "lp-uuid",
            comboSessionId: session.id,
            isComboQuote: true,
            comboPrice: "0.85",
            validUntil: new Date(Date.now() + 30000).toISOString()
        };
        normalizerMock.normalizeLPQuote.mockReturnValue({ id: "q1", comboSessionId: session.id, effectiveCost: "0.85" });
        await engine.collectLPQuote(lpQuote);

        // Accept
        quoteRepoMock.getQuotesForSession.mockResolvedValue([{ id: "q1", effectiveCost: "0.85" }]);
        planBuilderMock.buildExecutionPlan.mockResolvedValue({ id: "plan-1" });
        await engine.acceptCombo(session.id, "q1");

        expect(emittedPayloads.length).toBe(3);

        // Assert all events contain combo_id + event_seq ordered strictly sequentially
        expect(emittedPayloads[0].event_seq).toBe(1);
        expect(emittedPayloads[0].combo_id).toBe(session.id);
        expect(emittedPayloads[0].state).toBe("OPEN"); // COMBO_STATE_UPDATE

        expect(emittedPayloads[1].event_seq).toBe(2);
        expect(emittedPayloads[1].quote.id).toBe("q1"); // COMBO_QUOTE_UPDATE

        expect(emittedPayloads[2].event_seq).toBe(3);
        expect(emittedPayloads[2].status).toBe("SETTLED"); // COMBO_EXECUTION_UPDATE 
    });
});
