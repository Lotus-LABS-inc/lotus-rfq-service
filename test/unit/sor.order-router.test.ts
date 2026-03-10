import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import { InsufficientLiquidityError } from "../../src/core/sor/splitter.js";
import type {
  CanonicalRFQInput,
  CandidateScore,
  ExecutionPlan,
  RouteCandidate,
  SelectedQuoteInput
} from "../../src/core/sor/types.js";
import {
  metricsRegistry,
  sorAvgSplitsPerLeg,
  sorCandidatesEvaluatedCount,
  sorPlanBuildLatencyMs
} from "../../src/observability/metrics.js";

const rfqInput: CanonicalRFQInput = {
  rfqId: "d39689d9-ac70-4e34-bc07-d3bfb9f4e440",
  idempotencyKey: "idem-d39689d9-ac70-4e34-bc07-d3bfb9f4e440",
  stpMode: "CANCEL_NEWEST",
  canonicalMarketId: "market-1",
  takerId: "2e1f2680-b6aa-43c2-9f35-b17cdd67309f",
  side: "buy",
  quantity: "10",
  metadata: {
    reservation_token: "reservation-token-1"
  }
};

const selectedQuoteInput: SelectedQuoteInput = {
  quoteId: "quote-1",
  price: 1.1,
  quantity: 10,
  feeBps: 0
};

describe("SOR OrderRouter", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("orchestrates discover -> score -> split -> compose", async () => {
    const candidates: RouteCandidate[] = [
      {
        id: "e7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        leg_id: "a0111111-1111-4111-8111-111111111111",
        provider_type: "LP",
        provider_id: "lp-1",
        available_size: 10,
        quoted_price: 1.1,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.9
      }
    ];
    const scores: CandidateScore[] = [
      {
        candidateId: "e7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        providerId: "lp-1",
        effectiveUnitCost: 1.11,
        totalExpectedCost: 11.1,
        breakdown: {
          effectiveUnitCost: 1.11,
          basePrice: 1.1,
          providerFee: 0,
          protocolFee: 0,
          gasCost: 0,
          latencyPenalty: 0,
          failurePenalty: 0
        }
      }
    ];
    const composedPlan: ExecutionPlan = {
      id: "b0111111-1111-4111-8111-111111111111",
      rfqId: rfqInput.rfqId,
      acceptancePolicy: "ALL_OR_NONE",
      steps: [],
      createdAt: new Date("2026-03-04T00:00:00.000Z")
    };

    const discoverCandidates = vi.fn(async () => candidates);
    const evaluateCandidates = vi.fn(async () => scores);
    const split = vi.fn(async () => [
      {
        candidateId: "e7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        providerId: "lp-1",
        targetSize: 10,
        roundedSize: 10,
        targetPrice: 1.11
      }
    ]);
    const composePlan = vi.fn(async (rfq: CanonicalRFQInput) => {
      expect(rfq.metadata?.reservation_token).toBe("reservation-token-1");
      expect(rfq.takerId).toBe(rfqInput.takerId);
      return composedPlan;
    });
    const internalEngine = {
      attemptCross: vi.fn(async () => ({
        filledSize: 0,
        remainingSize: 10,
        trades: []
      })),
      previewCross: vi.fn(async () => ({
        fillableSize: 0,
        remainingSize: 10,
        matchedOrderIds: [],
        wouldSelfTrade: false
      }))
    };

    const router = new OrderRouter({
      routeScout: { discoverCandidates } as never,
      costModel: { evaluateCandidates } as never,
      splitter: { split } as never,
      planComposer: { composePlan } as never,
      internalEngine,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      internalCrossingEnabled: true
    });

    const result = await router.buildPlan(rfqInput, selectedQuoteInput, "ALL_OR_NONE");

    expect(result.kind).toBe("plan_created");
    if (result.kind !== "plan_created") {
      throw new Error("expected external plan build result");
    }
    expect(result.plan.id).toBe(composedPlan.id);
    expect(internalEngine.attemptCross).toHaveBeenCalledTimes(1);
    expect(discoverCandidates).toHaveBeenCalledTimes(1);
    expect(evaluateCandidates).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledTimes(1);
    expect(composePlan).toHaveBeenCalledTimes(1);

    const latencyMetric = await sorPlanBuildLatencyMs.get();
    const latencyCount = latencyMetric.values.find(
      (value) =>
        value.labels.acceptance_policy === "ALL_OR_NONE" &&
        !("le" in value.labels)
    );
    expect(latencyCount?.value).toBeGreaterThan(0);

    const candidateGauge = await sorCandidatesEvaluatedCount.get();
    const candidateValue = candidateGauge.values.find(
      (value) => value.labels.rfq_id === rfqInput.rfqId
    );
    expect(candidateValue?.value).toBe(scores.length);

    const splitsGauge = await sorAvgSplitsPerLeg.get();
    const splitValue = splitsGauge.values.find(
      (value) => value.labels.rfq_id === rfqInput.rfqId
    );
    expect(splitValue?.value).toBe(1);
  });

  it("throws insufficient liquidity for AON when split does not cover target size", async () => {
    const candidates: RouteCandidate[] = [
      {
        id: "f7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        leg_id: "c0111111-1111-4111-8111-111111111111",
        provider_type: "LP",
        provider_id: "lp-1",
        available_size: 5,
        quoted_price: 1.1,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.9
      }
    ];
    const scores: CandidateScore[] = [
      {
        candidateId: "f7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        providerId: "lp-1",
        effectiveUnitCost: 1.11,
        totalExpectedCost: 5.55,
        breakdown: {
          effectiveUnitCost: 1.11,
          basePrice: 1.1,
          providerFee: 0,
          protocolFee: 0,
          gasCost: 0,
          latencyPenalty: 0,
          failurePenalty: 0
        }
      }
    ];

    const router = new OrderRouter({
      routeScout: { discoverCandidates: vi.fn(async () => candidates) } as never,
      costModel: { evaluateCandidates: vi.fn(async () => scores) } as never,
      splitter: {
        split: vi.fn(async () => [
          {
            candidateId: "f7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
            providerId: "lp-1",
            targetSize: 4,
            roundedSize: 4,
            targetPrice: 1.11
          }
        ])
      } as never,
      planComposer: { composePlan: vi.fn() } as never,
      internalEngine: {
        attemptCross: vi.fn(async () => ({
          filledSize: 0,
          remainingSize: 10,
          trades: []
        })),
        previewCross: vi.fn(async () => ({
          fillableSize: 0,
          remainingSize: 10,
          matchedOrderIds: [],
          wouldSelfTrade: false
        }))
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      internalCrossingEnabled: true
    });

    await expect(router.buildPlan(rfqInput, selectedQuoteInput, "ALL_OR_NONE")).rejects.toBeInstanceOf(
      InsufficientLiquidityError
    );
  });

  it("returns internal_filled when crossing fully fills before routing", async () => {
    const discoverCandidates = vi.fn();
    const evaluateCandidates = vi.fn();
    const split = vi.fn();
    const composePlan = vi.fn();
    const router = new OrderRouter({
      routeScout: { discoverCandidates } as never,
      costModel: { evaluateCandidates } as never,
      splitter: { split } as never,
      planComposer: { composePlan } as never,
      internalEngine: {
        attemptCross: vi.fn(async () => ({
          filledSize: 10,
          remainingSize: 0,
          trades: []
        })),
        previewCross: vi.fn(async () => ({
          fillableSize: 10,
          remainingSize: 0,
          matchedOrderIds: [],
          wouldSelfTrade: false
        }))
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      internalCrossingEnabled: true
    });

    const result = await router.buildPlan(rfqInput, selectedQuoteInput, "ALL_OR_NONE");

    expect(result).toMatchObject({
      kind: "internal_filled",
      filledSize: "10"
    });
    expect(discoverCandidates).not.toHaveBeenCalled();
    expect(evaluateCandidates).not.toHaveBeenCalled();
    expect(split).not.toHaveBeenCalled();
    expect(composePlan).not.toHaveBeenCalled();
  });

  it("skips authoritative internal crossing when disabled and records shadow divergence", async () => {
    const discoverCandidates = vi.fn(async () => [
      {
        id: "b7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        leg_id: "d0111111-1111-4111-8111-111111111111",
        provider_type: "LP" as const,
        provider_id: "lp-1",
        available_size: 10,
        quoted_price: 1.1,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.9
      }
    ]);
    const evaluateCandidates = vi.fn(async () => [
      {
        candidateId: "b7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        providerId: "lp-1",
        effectiveUnitCost: 1.11,
        totalExpectedCost: 11.1,
        breakdown: {
          effectiveUnitCost: 1.11,
          basePrice: 1.1,
          providerFee: 0,
          protocolFee: 0,
          gasCost: 0,
          latencyPenalty: 0,
          failurePenalty: 0
        }
      }
    ]);
    const split = vi.fn(async () => [
      {
        candidateId: "b7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        providerId: "lp-1",
        targetSize: 10,
        roundedSize: 10,
        targetPrice: 1.11
      }
    ]);
    const composePlan = vi.fn(async () => ({
      id: "c0111111-1111-4111-8111-111111111111",
      rfqId: rfqInput.rfqId,
      acceptancePolicy: "ALL_OR_NONE" as const,
      steps: [],
      createdAt: new Date("2026-03-10T00:00:00.000Z")
    }));
    const internalEngine = {
      attemptCross: vi.fn(),
      previewCross: vi.fn(async () => ({
        fillableSize: 5,
        remainingSize: 5,
        matchedOrderIds: ["maker-1"],
        wouldSelfTrade: false
      }))
    };

    const router = new OrderRouter({
      routeScout: { discoverCandidates } as never,
      costModel: { evaluateCandidates } as never,
      splitter: { split } as never,
      planComposer: { composePlan } as never,
      internalEngine,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      internalCrossingEnabled: false,
      internalCrossingShadowEnabled: true,
      internalCrossingShadowPercent: 1,
      now: () => new Date("2026-03-10T12:00:00.000Z")
    });

    const result = await router.buildPlan(rfqInput, selectedQuoteInput, "ALL_OR_NONE");

    expect(result.kind).toBe("plan_created");
    expect(internalEngine.attemptCross).not.toHaveBeenCalled();
    expect(internalEngine.previewCross).toHaveBeenCalledTimes(1);
  });

  it("skips internal crossing when kill switch is active", async () => {
    const discoverCandidates = vi.fn(async () => [
      {
        id: "a7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
        leg_id: "e0111111-1111-4111-8111-111111111111",
        provider_type: "LP" as const,
        provider_id: "lp-1",
        available_size: 10,
        quoted_price: 1.1,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.9
      }
    ]);
    const router = new OrderRouter({
      routeScout: { discoverCandidates } as never,
      costModel: {
        evaluateCandidates: vi.fn(async () => [
          {
            candidateId: "a7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
            providerId: "lp-1",
            effectiveUnitCost: 1.11,
            totalExpectedCost: 11.1,
            breakdown: {
              effectiveUnitCost: 1.11,
              basePrice: 1.1,
              providerFee: 0,
              protocolFee: 0,
              gasCost: 0,
              latencyPenalty: 0,
              failurePenalty: 0
            }
          }
        ])
      } as never,
      splitter: {
        split: vi.fn(async () => [
          {
            candidateId: "a7d5f67d-8f9c-4138-a7a7-5950d8b18f4f",
            providerId: "lp-1",
            targetSize: 10,
            roundedSize: 10,
            targetPrice: 1.11
          }
        ])
      } as never,
      planComposer: {
        composePlan: vi.fn(async () => ({
          id: "f0111111-1111-4111-8111-111111111111",
          rfqId: rfqInput.rfqId,
          acceptancePolicy: "ALL_OR_NONE" as const,
          steps: [],
          createdAt: new Date("2026-03-10T00:00:00.000Z")
        }))
      } as never,
      internalEngine: {
        attemptCross: vi.fn(),
        previewCross: vi.fn(async () => ({
          fillableSize: 0,
          remainingSize: 10,
          matchedOrderIds: [],
          wouldSelfTrade: false
        }))
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      internalCrossingEnabled: true,
      isKillSwitchActive: async () => true
    });

    const result = await router.buildPlan(rfqInput, selectedQuoteInput, "ALL_OR_NONE");
    expect(result.kind).toBe("plan_created");
    expect(discoverCandidates).toHaveBeenCalledTimes(1);
  });
});
