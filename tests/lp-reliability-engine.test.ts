import { describe, expect, it } from "vitest";
import { computeReliabilityScore } from "../src/core/lp-reliability-engine.js";

describe("lp reliability engine", () => {
  it("applies bounded bonuses and penalties to effective price", () => {
    const scored = computeReliabilityScore({
      effectivePrice: 100,
      profile: {
        lpId: "lp-1",
        avgResponseTimeMs: 50,
        quoteHitRate: 0.9,
        rejectRate: 0.05,
        executionFailRate: 0.1,
        competitivenessScore: 0.85,
        totalQuotes: 100,
        totalExecutions: 40
      },
      weights: {
        reliabilityWeight: 0.1,
        latencyWeight: 0.1,
        failureWeight: 0.1
      }
    });

    expect(scored.reliabilityBonus).toBeGreaterThan(0);
    expect(scored.latencyBonus).toBeGreaterThan(0);
    expect(scored.failurePenalty).toBeGreaterThan(0);
    expect(scored.score).toBeGreaterThan(0);
  });

  it("does not allow reliability adjustment to dominate price", () => {
    const lowPrice = computeReliabilityScore({
      effectivePrice: 100,
      profile: {
        lpId: "lp-low",
        avgResponseTimeMs: 300,
        quoteHitRate: 0.6,
        rejectRate: 0.1,
        executionFailRate: 0.05,
        competitivenessScore: 0.6,
        totalQuotes: 100,
        totalExecutions: 50
      },
      weights: {
        reliabilityWeight: 0.2,
        latencyWeight: 0.2,
        failureWeight: 0
      }
    });

    const highPrice = computeReliabilityScore({
      effectivePrice: 115,
      profile: {
        lpId: "lp-high",
        avgResponseTimeMs: 1,
        quoteHitRate: 1,
        rejectRate: 0,
        executionFailRate: 0,
        competitivenessScore: 1,
        totalQuotes: 100,
        totalExecutions: 50
      },
      weights: {
        reliabilityWeight: 0.2,
        latencyWeight: 0.2,
        failureWeight: 0
      }
    });

    expect(highPrice.score).toBeGreaterThan(lowPrice.score);
  });
});
