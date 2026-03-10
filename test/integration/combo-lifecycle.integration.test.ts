import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { ComboQuoteNormalizer } from "../../src/services/combo-quote-normalizer.js";
import { ExecutionPlanBuilder } from "../../src/core/execution-plan/execution-plan-builder.js";
import { ExecutePlanRunner } from "../../src/core/combo-engine/execute-plan-runner.js";
import { AcceptancePolicy, ComboRFQRequest, ComboRFQSession, ComboQuote } from "../../src/core/combo-engine/types.js";
import { pino } from "pino";

const mockLogger = pino({ level: "silent" });

// ─── In-Memory Repositories ───────────────────────────────────────────────────

class InMemoryComboRepo {
    public sessions = new Map<string, ComboRFQSession>();
    async createSession(s: ComboRFQSession, client?: any) { this.sessions.set(s.id, s); }
    async getSession(id: string) { return this.sessions.get(id) || null; }
    async updateSessionState(id: string, state: any, client?: any) {
        const s = this.sessions.get(id);
        if (s) { s.state = state; this.sessions.set(id, s); }
    }
}

class InMemoryQuoteRepo {
    public quotes: ComboQuote[] = [];
    async saveQuote(q: ComboQuote) { this.quotes.push(q); }
    async getQuotesForSession(sid: string) { return this.quotes.filter(q => q.comboSessionId === sid); }
}

class InMemoryExecRepo {
    public fills = new Map<string, string[]>();
    public failures = new Map<string, string[]>();
    async getFilledSteps(id: string) { return this.fills.get(id) || []; }
    async recordFill(pid: string, lid: string) {
        this.fills.set(pid, [...(this.fills.get(pid) || []), lid]);
    }
    async recordFailure(pid: string, lid: string) {
        this.failures.set(pid, [...(this.failures.get(pid) || []), lid]);
    }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Fixed UUIDs for deterministic tests
const USER_UUID = "123e4567-e89b-12d3-a456-426614174000";
const MKT1_UUID = "123e4567-e89b-12d3-a456-426614174001";
const MKT2_UUID = "123e4567-e89b-12d3-a456-426614174002";
const OUT1_UUID = "123e4567-e89b-12d3-a456-426614174003";
const OUT2_UUID = "123e4567-e89b-12d3-a456-426614174004";

describe("Combo Lifecycle Integration Tests", () => {
    let comboRepo: InMemoryComboRepo;
    let quoteRepo: InMemoryQuoteRepo;
    let execRepo: InMemoryExecRepo;
    let riskEngineMock: any;
    let executionClientMock: any;
    let multiLegInternalNettingEngineMock: any;
    let engine: ComboEngine;

    /**
     * Configure a fresh set of mocks for each test.
     * executionClientMock.executeTrade can be overridden per test.
     */
    beforeEach(() => {
        comboRepo = new InMemoryComboRepo();
        quoteRepo = new InMemoryQuoteRepo();
        execRepo = new InMemoryExecRepo();

        executionClientMock = {
            executeTrade: vi.fn().mockResolvedValue({ status: "FILLED", filledQuantity: "100" }),
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
            validateRFQCreation: vi.fn().mockResolvedValue(undefined),
            validateBeforeExecution: vi.fn().mockResolvedValue("resv-token-abc"),
            updateExposureAfterExecution: vi.fn(async (_exec, _isInternal = false) => undefined),
            rollbackReservation: vi.fn().mockResolvedValue(undefined)
        };

        const canonicalClientMock = {
            getMarketOutcomeProbabilities: vi.fn().mockResolvedValue(new Map([
                [MKT1_UUID, { outcomeProbMap: new Map([[OUT1_UUID, 0.5]]) }],
                [MKT2_UUID, { outcomeProbMap: new Map([[OUT2_UUID, 0.5]]) }]
            ]))
        };

        const planRepoMock = {
            savePlan: vi.fn(),
            updatePlanStatus: vi.fn()
        };

        const normalizer = new ComboQuoteNormalizer(mockLogger);
        const planBuilder = new ExecutionPlanBuilder(planRepoMock as any, mockLogger);
        const runner = new ExecutePlanRunner(executionClientMock, execRepo, riskEngineMock, mockLogger);

        const executionRouterMock = {
            executePlan: vi.fn().mockImplementation(async (plan: any) => await runner.runPlan(plan))
        };

        const redisMock = {
            hset: vi.fn(),
            expireat: vi.fn(),
            zadd: vi.fn(),
            incr: vi.fn().mockResolvedValue(1),
            expire: vi.fn()
        };

        engine = new ComboEngine(
            comboRepo as any,
            quoteRepo as any,
            normalizer as any,
            planBuilder as any,
            multiLegInternalNettingEngineMock as any,
            riskEngineMock,
            canonicalClientMock as any,
            executionRouterMock,
            redisMock as any,
            mockLogger,
            { internalNettingEnabled: true }
        );
    });

    // ─── Helpers ──────────────────────────────────────────────────────────────

    const createSession = async (policy: AcceptancePolicy) => {
        const req: ComboRFQRequest = {
            requestId: crypto.randomUUID(),
            takerId: USER_UUID,
            acceptancePolicy: policy,
            legs: [
                { canonicalMarketId: MKT1_UUID, canonicalOutcomeId: OUT1_UUID, side: "buy", quantity: "100" },
                { canonicalMarketId: MKT2_UUID, canonicalOutcomeId: OUT2_UUID, side: "sell", quantity: "50" }
            ]
        };
        return engine.createComboRFQ(req);
    };

    const submitQuotes = async (session: ComboRFQSession) => {
        // LP1 submits a per-leg quote (tightly priced, preferred)
        await engine.collectLPQuote({
            lpId: "00000000-0000-0000-0000-000000000001",
            comboSessionId: session.id,
            isComboQuote: false,
            perLegPrices: [
                { legId: session.legs[0]!.id, price: "0.12", size: "100" },
                { legId: session.legs[1]!.id, price: "0.13", size: "50" }
            ],
            validUntil: new Date(Date.now() + 60_000).toISOString()
        });

        // LP2 submits a looser per-leg quote
        await engine.collectLPQuote({
            lpId: "00000000-0000-0000-0000-000000000002",
            comboSessionId: session.id,
            isComboQuote: false,
            perLegPrices: [
                { legId: session.legs[0]!.id, price: "0.50", size: "100" },
                { legId: session.legs[1]!.id, price: "0.60", size: "50" }
            ],
            validUntil: new Date(Date.now() + 60_000).toISOString()
        });
    };

    // ─── Tests ────────────────────────────────────────────────────────────────

    it("Happy path: create combo, 2 LPs quote (per-leg), accept best quote, execution success", async () => {
        const session = await createSession(AcceptancePolicy.ALL_OR_NONE);
        await submitQuotes(session);

        const quotes = await quoteRepo.getQuotesForSession(session.id);
        // LP1 is cheaper so its the best quote
        const bestQuote = quotes.find(q => q.lpId === "00000000-0000-0000-0000-000000000001")!;
        expect(bestQuote).toBeDefined();

        // executionClientMock already returns FILLED for all legs
        const result = await engine.acceptCombo(session.id, bestQuote.id);

        expect(result.kind).toBe("external_plan");
        if (result.kind === "external_plan") {
            expect(result.plan.status).toBe("DRAFT");
        }
        const finalSession = await comboRepo.getSession(session.id);
        expect(finalSession!.state).toBe("EXECUTED");
        // updateExposureAfterExecution is called once per filled step (2 legs per quote submitted)
        expect(riskEngineMock.updateExposureAfterExecution).toHaveBeenCalled();
    });

    it("Partial: ALL_OR_NONE accept; one leg fails -> session transitions to FAILED", async () => {
        const session = await createSession(AcceptancePolicy.ALL_OR_NONE);
        await submitQuotes(session);

        const quotes = await quoteRepo.getQuotesForSession(session.id);
        const bestQuote = quotes.find(q => q.lpId === "00000000-0000-0000-0000-000000000001")!;

        // Make leg[0] fail
        executionClientMock.executeTrade.mockImplementation(async (step: any) => {
            if (step.legId === session.legs[0]!.id) return { status: "REJECTED", filledQuantity: "0" };
            return { status: "FILLED", filledQuantity: "50" };
        });

        await engine.acceptCombo(session.id, bestQuote.id);

        const finalSession = await comboRepo.getSession(session.id);
        expect(finalSession!.state).toBe("FAILED");
        // Under ALL_OR_NONE, no exposure is committed on failure
        expect(riskEngineMock.updateExposureAfterExecution).toHaveBeenCalledTimes(0);
    });

    it("PARTIAL_ALLOWED: one leg fails, partial fill accepted -> session FAILED (partial state)", async () => {
        const session = await createSession(AcceptancePolicy.PARTIAL_ALLOWED);
        await submitQuotes(session);

        const quotes = await quoteRepo.getQuotesForSession(session.id);
        const bestQuote = quotes.find(q => q.lpId === "00000000-0000-0000-0000-000000000001")!;

        // leg[0] rejected, leg[1] filled
        executionClientMock.executeTrade.mockImplementation(async (step: any) => {
            if (step.legId === session.legs[0]!.id) return { status: "REJECTED", filledQuantity: "0" };
            return { status: "FILLED", filledQuantity: "50" };
        });

        await engine.acceptCombo(session.id, bestQuote.id);

        const finalSession = await comboRepo.getSession(session.id);
        // PARTIAL_ALLOWED yields "PARTIAL" from runner, which maps to FAILED in ComboEngine
        expect(finalSession!.state).toBe("FAILED");
        // Exactly one successful leg's exposure was updated
        expect(riskEngineMock.updateExposureAfterExecution).toHaveBeenCalledTimes(1);
    });
});
