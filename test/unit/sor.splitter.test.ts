import { describe, expect, it } from "vitest";
import { InsufficientLiquidityError, Splitter } from "../../src/core/sor/splitter.js";
import type { RouteCandidate } from "../../src/core/sor/types.js";

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
