import { describe, expect, it } from "vitest";

import { aggregateNettingExposureDeltas } from "../../src/core/combo-engine/combo-netting-exposure-aggregation.js";

describe("aggregateNettingExposureDeltas", () => {
  it("aggregates exact two-leg netting for both users", () => {
    const result = aggregateNettingExposureDeltas({
      matchedLegs: [
        {
          incomingLegId: "in-1",
          incomingSide: "buy",
          candidateLegId: "cand-1",
          candidateSide: "sell",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "10",
          price: "0.4"
        },
        {
          incomingLegId: "in-2",
          incomingSide: "sell",
          candidateLegId: "cand-2",
          candidateSide: "buy",
          marketId: "m2",
          outcomeId: "o2",
          matchedSize: "5",
          price: "0.3"
        }
      ]
    });

    expect(result.userA.maxLossDelta).toBe("7.5");
    expect(result.userA.maxGainDelta).toBe("7.5");
    expect(result.userB.maxLossDelta).toBe("7.5");
    expect(result.userB.maxGainDelta).toBe("7.5");
    expect(result.userA.perLeg).toHaveLength(2);
    expect(result.userB.perLeg).toHaveLength(2);
  });

  it("aggregates partial overlap with one matched leg", () => {
    const result = aggregateNettingExposureDeltas({
      matchedLegs: [
        {
          incomingLegId: "in-1",
          incomingSide: "buy",
          candidateLegId: "cand-1",
          candidateSide: "sell",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "2.5",
          price: "0.62"
        }
      ]
    });

    expect(result.userA).toEqual({
      maxLossDelta: "1.55",
      maxGainDelta: "0.95",
      perLeg: [
        {
          legId: "in-1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.62",
          matchedSize: "2.5",
          maxLossDelta: "1.55",
          maxGainDelta: "0.95"
        }
      ]
    });
  });

  it("uses decimal-safe summation across multiple matched legs", () => {
    const result = aggregateNettingExposureDeltas({
      matchedLegs: [
        {
          incomingLegId: "in-1",
          incomingSide: "buy",
          candidateLegId: "cand-1",
          candidateSide: "sell",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "0.1",
          price: "0.33333333"
        },
        {
          incomingLegId: "in-2",
          incomingSide: "buy",
          candidateLegId: "cand-2",
          candidateSide: "sell",
          marketId: "m2",
          outcomeId: "o2",
          matchedSize: "0.2",
          price: "0.33333333"
        }
      ]
    });

    expect(result.userA.maxLossDelta).toBe("0.1");
    expect(result.userA.maxGainDelta).toBe("0.2");
    expect(result.userB.maxLossDelta).toBe("0.2");
    expect(result.userB.maxGainDelta).toBe("0.1");
  });

  it("preserves per-leg identifiers and values", () => {
    const result = aggregateNettingExposureDeltas({
      matchedLegs: [
        {
          incomingLegId: "incoming-leg-a",
          incomingSide: "sell",
          candidateLegId: "candidate-leg-b",
          candidateSide: "buy",
          marketId: "market-a",
          outcomeId: "outcome-b",
          matchedSize: "4",
          price: "0.25"
        }
      ]
    });

    expect(result.userA.perLeg[0]).toEqual({
      legId: "incoming-leg-a",
      marketId: "market-a",
      outcomeId: "outcome-b",
      side: "sell",
      price: "0.25",
      matchedSize: "4",
      maxLossDelta: "3",
      maxGainDelta: "1"
    });
    expect(result.userB.perLeg[0]).toEqual({
      legId: "candidate-leg-b",
      marketId: "market-a",
      outcomeId: "outcome-b",
      side: "buy",
      price: "0.25",
      matchedSize: "4",
      maxLossDelta: "1",
      maxGainDelta: "3"
    });
  });

  it("returns zero totals for zero matched legs", () => {
    const result = aggregateNettingExposureDeltas({ matchedLegs: [] });

    expect(result).toEqual({
      userA: { maxLossDelta: "0", maxGainDelta: "0", perLeg: [] },
      userB: { maxLossDelta: "0", maxGainDelta: "0", perLeg: [] }
    });
  });
});
