import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { Splitter } from "../../src/core/sor/splitter.js";
import { PlanComposer } from "../../src/core/sor/plan-composer.js";
import { RouteScout } from "../../src/core/sor/route-scout.js";
import type { CanonicalRFQInput, SelectedQuoteInput, RouteCandidate } from "../../src/core/sor/types.js";

describe("SOR Performance Benchmarks", () => {
    let orderRouter: OrderRouter;
    let mockRouteScout: any;
    let mockCostModel: any;
    let mockLogger: any;

    beforeEach(() => {
        mockRouteScout = {
            discoverCandidates: vi.fn()
        };
        mockCostModel = {
            evaluateCandidates: vi.fn()
        };
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        };

        const mockClient = {
            query: vi.fn().mockImplementation((query) => {
                if (query.includes("INSERT INTO routing_plans")) {
                    return Promise.resolve({
                        rows: [{
                            id: "plan-id",
                            rfq_id: "rfq-id",
                            acceptance_policy: "ALL_OR_NONE",
                            state: "DRAFT",
                            created_at: new Date()
                        }],
                        rowCount: 1
                    });
                }
                if (query.includes("SELECT * FROM routing_plans")) {
                    return Promise.resolve({ rows: [], rowCount: 0 });
                }
                return Promise.resolve({ rows: [{ id: "step-id" }], rowCount: 1 });
            }),
            release: vi.fn().mockResolvedValue(undefined)
        };
        const mockPool = {
            query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            connect: vi.fn().mockResolvedValue(mockClient)
        };
        const splitter = new Splitter();
        const planComposer = new PlanComposer({
            pool: mockPool as any,
            logger: mockLogger
        });

        orderRouter = new OrderRouter({
            routeScout: mockRouteScout,
            costModel: mockCostModel,
            splitter,
            planComposer,
            internalEngine: {
                attemptCross: vi.fn(async (order: { remaining_size: string }) => ({
                    filledSize: 0,
                    remainingSize: Number.parseFloat(order.remaining_size),
                    trades: []
                })),
                previewCross: vi.fn(async (order: { remaining_size: string }) => ({
                    fillableSize: 0,
                    remainingSize: Number.parseFloat(order.remaining_size),
                    matchedOrderIds: [],
                    wouldSelfTrade: false
                }))
            },
            logger: mockLogger
        });
    });

    const generateCandidates = (count: number, legId: string): RouteCandidate[] => {
        return Array.from({ length: count }, (_, i) => ({
            id: `candidate-${legId}-${i}`,
            leg_id: legId,
            provider_type: "LP",
            provider_id: `lp-${i}`,
            available_size: 1000,
            quoted_price: 100 + i * 0.01,
            fees: {},
            latency_ms: 10,
            fill_prob: 1,
            metadata: {}
        }));
    };

    it("should handle 100 candidates across 2 legs within 100ms", async () => {
        const rfq: CanonicalRFQInput = {
            rfqId: "00000000-0000-0000-0000-000000000001",
            idempotencyKey: "bench-key-1",
            canonicalMarketId: "BTC-USD",
            takerId: "00000000-0000-0000-0000-000000000003",
            side: "buy",
            quantity: "10",
            stpMode: "NONE",
            metadata: { reservation_token: "token-1" }
        };
        // Need to bypass Zod if we want to test with slightly 'off' data, but better to be exact

        const selectedQuote: SelectedQuoteInput = {
            quoteId: "q-1",
            lpId: "lp-best",
            price: 100,
            quantity: 10,
            feeBps: 0
        };

        const candidatesLeg1 = generateCandidates(50, "leg-1");
        const candidatesLeg2 = generateCandidates(50, "leg-2");
        const allCandidates = [...candidatesLeg1, ...candidatesLeg2];

        mockRouteScout.discoverCandidates.mockResolvedValue(allCandidates);
        mockCostModel.evaluateCandidates.mockImplementation((_rfq: any, cands: any) => {
            return cands.map((c: RouteCandidate) => ({
                candidateId: c.id,
                providerId: c.provider_id,
                effectiveUnitCost: c.quoted_price,
                totalExpectedCost: c.quoted_price * 10,
                breakdown: {
                    effectiveUnitCost: c.quoted_price,
                    basePrice: c.quoted_price,
                    providerFee: 0,
                    protocolFee: 0,
                    gasCost: 0,
                    latencyPenalty: 0,
                    failurePenalty: 0
                }
            }));
        });

        const start = performance.now();
        const result = await orderRouter.buildPlan(rfq, selectedQuote, "ALL_OR_NONE");
        const duration = performance.now() - start;

        console.log(`[BENCHMARK] Build plan with 100 candidates took ${duration.toFixed(2)}ms`);

        expect(result.kind).toBe("plan_created");
        if (result.kind !== "plan_created") {
            throw new Error("expected external plan");
        }
        expect(result.plan.steps.length).toBeGreaterThan(0);
        expect(duration).toBeLessThan(100);
    });

    it("should handle deep split logic (10 providers per leg) efficiently", async () => {
        const rfq: CanonicalRFQInput = {
            rfqId: "00000000-0000-0000-0000-000000000002",
            idempotencyKey: "bench-key-2",
            canonicalMarketId: "BTC-USD",
            takerId: "00000000-0000-0000-0000-000000000003",
            side: "buy",
            quantity: "100",
            stpMode: "NONE",
            metadata: { reservation_token: "token-2" }
        };

        const selectedQuote: SelectedQuoteInput = {
            quoteId: "q-2",
            lpId: "lp-best",
            price: 100,
            quantity: 100,
            feeBps: 0
        };

        const candidates = generateCandidates(10, "leg-1").map(c => ({
            ...c,
            available_size: 10 // Force splitting
        }));

        mockRouteScout.discoverCandidates.mockResolvedValue(candidates);
        mockCostModel.evaluateCandidates.mockImplementation((_rfq: any, cands: any) => {
            return cands.map((c: RouteCandidate) => ({
                candidateId: c.id,
                providerId: c.provider_id,
                effectiveUnitCost: c.quoted_price,
                totalExpectedCost: c.quoted_price * 100,
                breakdown: {
                    effectiveUnitCost: c.quoted_price,
                    basePrice: c.quoted_price,
                    providerFee: 0,
                    protocolFee: 0,
                    gasCost: 0,
                    latencyPenalty: 0,
                    failurePenalty: 0
                }
            }));
        });

        const start = performance.now();
        const result = await orderRouter.buildPlan(rfq, selectedQuote, "ALL_OR_NONE");
        const duration = performance.now() - start;

        console.log(`[BENCHMARK] Deep split (10 layers) took ${duration.toFixed(2)}ms`);

        expect(result.kind).toBe("plan_created");
        if (result.kind !== "plan_created") {
            throw new Error("expected external plan");
        }
        expect(result.plan.steps.length).toBe(10);
        expect(duration).toBeLessThan(50);
    });
});
