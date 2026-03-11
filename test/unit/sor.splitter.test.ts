import { describe, expect, it } from "vitest";
import { InsufficientLiquidityError, Splitter } from "../../src/core/sor/splitter.js";
import type { RouteCandidate } from "../../src/core/sor/types.js";
import { metricsRegistry } from "../../src/observability/metrics.js";
import { resolutionRiskCandidatePairKey } from "../../src/core/sor/resolution-risk-routing-policy.js";

const makeCandidate = (
  id: string,
  availableSize: number,
  price: number,
  fillProb: number
): RouteCandidate => ({
  id,
  leg_id: "11111111-1111-1111-8111-111111111111",
  provider_type: "LP",
  provider_id: `provider-${id}`,
  available_size: availableSize,
  quoted_price: price,
  fees: { provider_fee: 0, protocol_fee: 0, gas_cost: 0 },
  latency_ms: 1,
  fill_prob: fillProb
});

describe("SOR Splitter", () => {
  const pairPolicies = (leftId: string, rightId: string, mode: "normal" | "penalty" | "isolated_only" | "blocked", penalty = 0) =>
    new Map([[resolutionRiskCandidatePairKey(leftId, rightId), { mode, penalty }]]);

  it("allows SAFE_EQUIVALENT pooled routing with no penalty", async () => {
    metricsRegistry.resetMetrics();
    const splitter = new Splitter();
    const result = await splitter.split(
      10,
      [
        {
          candidateId: "a",
          providerId: "provider-a",
          effectiveUnitCost: 1,
          totalExpectedCost: 10,
          breakdown: {
            effectiveUnitCost: 1,
            basePrice: 1,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        },
        {
          candidateId: "b",
          providerId: "provider-b",
          effectiveUnitCost: 1.01,
          totalExpectedCost: 10.1,
          breakdown: {
            effectiveUnitCost: 1.01,
            basePrice: 1.01,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        }
      ],
      {
        minChunkSize: 1,
        tickSize: 1,
        perProviderCapacity: { "provider-a": 5, "provider-b": 5 },
        resolutionRisk: { pairPolicies: pairPolicies("a", "b", "normal") }
      }
    );

    expect(result).toHaveLength(2);
    expect(result.map((allocation) => allocation.candidateId)).toEqual(["a", "b"]);
  });

  it("allows CAUTION pooled routing with additive penalty", async () => {
    metricsRegistry.resetMetrics();
    const splitter = new Splitter();
    const result = await splitter.split(
      10,
      [
        {
          candidateId: "a",
          providerId: "provider-a",
          effectiveUnitCost: 1,
          totalExpectedCost: 10,
          breakdown: {
            effectiveUnitCost: 1,
            basePrice: 1,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        },
        {
          candidateId: "b",
          providerId: "provider-b",
          effectiveUnitCost: 1.01,
          totalExpectedCost: 10.1,
          breakdown: {
            effectiveUnitCost: 1.01,
            basePrice: 1.01,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        }
      ],
      {
        minChunkSize: 1,
        tickSize: 1,
        perProviderCapacity: { "provider-a": 5, "provider-b": 5 },
        resolutionRisk: { pairPolicies: pairPolicies("a", "b", "penalty", 0.2) }
      }
    );

    expect(result).toHaveLength(2);
    expect(result[1]?.targetPrice).toBeCloseTo(1.21, 10);
  });

  it("blocks pooled routing for HIGH_RISK isolated-only pairs", async () => {
    metricsRegistry.resetMetrics();
    const splitter = new Splitter();
    const result = await splitter.split(
      10,
      [
        {
          candidateId: "a",
          providerId: "provider-a",
          effectiveUnitCost: 1,
          totalExpectedCost: 10,
          breakdown: {
            effectiveUnitCost: 1,
            basePrice: 1,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        },
        {
          candidateId: "b",
          providerId: "provider-b",
          effectiveUnitCost: 1.01,
          totalExpectedCost: 10.1,
          breakdown: {
            effectiveUnitCost: 1.01,
            basePrice: 1.01,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        }
      ],
      {
        minChunkSize: 1,
        tickSize: 1,
        perProviderCapacity: { "provider-a": 5, "provider-b": 5 },
        resolutionRisk: { pairPolicies: pairPolicies("a", "b", "isolated_only") }
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.candidateId).toBe("a");
  });

  it("blocks pooled routing for DO_NOT_POOL pairs", async () => {
    metricsRegistry.resetMetrics();
    const splitter = new Splitter();
    const result = await splitter.split(
      10,
      [
        {
          candidateId: "a",
          providerId: "provider-a",
          effectiveUnitCost: 1,
          totalExpectedCost: 10,
          breakdown: {
            effectiveUnitCost: 1,
            basePrice: 1,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        },
        {
          candidateId: "b",
          providerId: "provider-b",
          effectiveUnitCost: 1.01,
          totalExpectedCost: 10.1,
          breakdown: {
            effectiveUnitCost: 1.01,
            basePrice: 1.01,
            providerFee: 0,
            protocolFee: 0,
            gasCost: 0,
            latencyPenalty: 0,
            failurePenalty: 0,
            resolutionRiskPenalty: 0
          }
        }
      ],
      {
        minChunkSize: 1,
        tickSize: 1,
        perProviderCapacity: { "provider-a": 5, "provider-b": 5 },
        resolutionRisk: { pairPolicies: pairPolicies("a", "b", "blocked") }
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.candidateId).toBe("a");
  });

  it("splits across 3 candidates using greedy score ordering", () => {
    const splitter = new Splitter({
      slippageAlpha: 0.001,
      slippageBeta: 1
    });

    const candidates: RouteCandidate[] = [
      makeCandidate("a", 4, 1.0, 0.95),
      makeCandidate("b", 4, 1.01, 0.9),
      makeCandidate("c", 4, 1.02, 0.85)
    ];

    const result = splitter.splitLeg(
      { leg_id: "11111111-1111-1111-8111-111111111111", target_size: 10 },
      candidates,
      "PARTIAL_ALLOWED",
      {
        min_chunk_size: 1,
        tick_size: 1,
        per_provider_capacity: {}
      }
    );

    expect(result.splits).toEqual([
      { candidateId: "a", size: 4 },
      { candidateId: "b", size: 4 },
      { candidateId: "c", size: 2 }
    ]);
    expect(result.remainingSize).toBe(0);
    expect(result.fallbackCandidateIds).toEqual([]);
  });

  it("rejects ALL_OR_NONE when total liquidity is insufficient", () => {
    const splitter = new Splitter();
    const candidates: RouteCandidate[] = [
      makeCandidate("a", 2, 1.0, 0.9),
      makeCandidate("b", 2, 1.01, 0.9),
      makeCandidate("c", 2, 1.02, 0.9)
    ];

    expect(() =>
      splitter.splitLeg(
        { leg_id: "11111111-1111-1111-8111-111111111111", target_size: 10 },
        candidates,
        "ALL_OR_NONE",
        {
          min_chunk_size: 1,
          tick_size: 1,
          per_provider_capacity: {}
        }
      )
    ).toThrowError(InsufficientLiquidityError);

    try {
      splitter.splitLeg(
        { leg_id: "11111111-1111-1111-8111-111111111111", target_size: 10 },
        candidates,
        "ALL_OR_NONE",
        {
          min_chunk_size: 1,
          tick_size: 1,
          per_provider_capacity: {}
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientLiquidityError);
      expect((error as InsufficientLiquidityError).reason).toBe("insufficient_liquidity");
    }
  });

  it("enforces tick rounding and min chunk size", () => {
    const splitter = new Splitter({
      slippageAlpha: 0.0000000001,
      slippageBeta: 1
    });
    const candidates: RouteCandidate[] = [
      makeCandidate("a", 1.3, 1.0, 0.99),
      makeCandidate("b", 2.2, 1.01, 0.98),
      makeCandidate("c", 0.4, 1.02, 0.97)
    ];

    const result = splitter.splitLeg(
      { leg_id: "11111111-1111-1111-8111-111111111111", target_size: 2.0 },
      candidates,
      "PARTIAL_ALLOWED",
      {
        min_chunk_size: 0.5,
        tick_size: 0.5,
        per_provider_capacity: {}
      }
    );

    expect(result.splits).toEqual([
      { candidateId: "a", size: 1 },
      { candidateId: "b", size: 1 }
    ]);
    expect(result.remainingSize).toBeCloseTo(0, 10);
    expect(result.fallbackCandidateIds).toContain("c");
  });

  it("returns fallback candidate ids for providers not used during allocation", () => {
    const splitter = new Splitter();
    const candidates: RouteCandidate[] = [
      makeCandidate("a", 5, 1.0, 0.95),
      makeCandidate("b", 5, 1.01, 0.9),
      makeCandidate("c", 5, 1.02, 0.85)
    ];

    const result = splitter.splitLeg(
      { leg_id: "11111111-1111-1111-8111-111111111111", target_size: 4 },
      candidates,
      "BEST_EFFORT",
      {
        min_chunk_size: 1,
        tick_size: 1,
        per_provider_capacity: {}
      }
    );

    expect(result.splits).toEqual([{ candidateId: "a", size: 4 }]);
    expect(result.fallbackCandidateIds).toEqual(["b", "c"]);
  });
});
