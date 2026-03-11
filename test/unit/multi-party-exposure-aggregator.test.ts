import { describe, expect, it } from "vitest";

import { MultiPartyExposureAggregator } from "../../src/core/combo-engine/multi-party-exposure-aggregator.js";

describe("MultiPartyExposureAggregator", () => {
  const aggregator = new MultiPartyExposureAggregator();

  it("aggregates a 3-party cycle deterministically", () => {
    const result = aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.40",
          matchedSize: "2"
        },
        {
          participantId: "combo-b",
          userId: "user-b",
          legId: "leg-b1",
          marketId: "m1",
          outcomeId: "o1",
          side: "sell",
          price: "0.40",
          matchedSize: "2"
        },
        {
          participantId: "combo-c",
          userId: "user-c",
          legId: "leg-c1",
          marketId: "m2",
          outcomeId: "o2",
          side: "buy",
          price: "0.55",
          matchedSize: "1.5"
        }
      ]
    });

    expect(result.participantExposureDeltas.map((entry) => entry.participantId)).toEqual([
      "combo-a",
      "combo-b",
      "combo-c"
    ]);
    expect(result.participantExposureDeltas).toEqual([
      {
        participantId: "combo-a",
        userId: "user-a",
        maxLossDelta: "0.8",
        maxGainDelta: "1.2",
        perLegDeltas: [
          {
            legId: "leg-a1",
            marketId: "m1",
            outcomeId: "o1",
            side: "buy",
            price: "0.40",
            matchedSize: "2",
            maxLossDelta: "0.8",
            maxGainDelta: "1.2"
          }
        ]
      },
      {
        participantId: "combo-b",
        userId: "user-b",
        maxLossDelta: "1.2",
        maxGainDelta: "0.8",
        perLegDeltas: [
          {
            legId: "leg-b1",
            marketId: "m1",
            outcomeId: "o1",
            side: "sell",
            price: "0.40",
            matchedSize: "2",
            maxLossDelta: "1.2",
            maxGainDelta: "0.8"
          }
        ]
      },
      {
        participantId: "combo-c",
        userId: "user-c",
        maxLossDelta: "0.825",
        maxGainDelta: "0.675",
        perLegDeltas: [
          {
            legId: "leg-c1",
            marketId: "m2",
            outcomeId: "o2",
            side: "buy",
            price: "0.55",
            matchedSize: "1.5",
            maxLossDelta: "0.825",
            maxGainDelta: "0.675"
          }
        ]
      }
    ]);
  });

  it("aggregates partial residual clearing across multiple matched legs per participant", () => {
    const result = aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a2",
          marketId: "m2",
          outcomeId: "o2",
          side: "buy",
          price: "0.35",
          matchedSize: "1.25"
        },
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.40",
          matchedSize: "0.5"
        },
        {
          participantId: "combo-b",
          userId: "user-b",
          legId: "leg-b1",
          marketId: "m1",
          outcomeId: "o1",
          side: "sell",
          price: "0.40",
          matchedSize: "0.5"
        }
      ]
    });

    expect(result.participantExposureDeltas[0]).toEqual({
      participantId: "combo-a",
      userId: "user-a",
      maxLossDelta: "0.6375",
      maxGainDelta: "1.1125",
      perLegDeltas: [
        {
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.40",
          matchedSize: "0.5",
          maxLossDelta: "0.2",
          maxGainDelta: "0.3"
        },
        {
          legId: "leg-a2",
          marketId: "m2",
          outcomeId: "o2",
          side: "buy",
          price: "0.35",
          matchedSize: "1.25",
          maxLossDelta: "0.4375",
          maxGainDelta: "0.8125"
        }
      ]
    });
    expect(result.participantExposureDeltas[1]).toEqual({
      participantId: "combo-b",
      userId: "user-b",
      maxLossDelta: "0.3",
      maxGainDelta: "0.2",
      perLegDeltas: [
        {
          legId: "leg-b1",
          marketId: "m1",
          outcomeId: "o1",
          side: "sell",
          price: "0.40",
          matchedSize: "0.5",
          maxLossDelta: "0.3",
          maxGainDelta: "0.2"
        }
      ]
    });
  });

  it("returns an empty result when there are no matched allocations", () => {
    expect(aggregator.aggregate({ matchedLegAllocations: [] })).toEqual({
      participantExposureDeltas: []
    });
  });

  it("fails closed on malformed price", () => {
    expect(() => aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "bad",
          matchedSize: "1"
        }
      ]
    })).toThrow("invalid_price");
  });

  it("fails closed on malformed matched size", () => {
    expect(() => aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.4",
          matchedSize: "bad"
        }
      ]
    })).toThrow("invalid_matched_size");
  });

  it("fails closed on negative matched size", () => {
    expect(() => aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.4",
          matchedSize: "-1"
        }
      ]
    })).toThrow("negative_matched_size");
  });

  it("fails closed on inconsistent participant and user mapping", () => {
    expect(() => aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.4",
          matchedSize: "1"
        },
        {
          participantId: "combo-a",
          userId: "user-b",
          legId: "leg-a2",
          marketId: "m2",
          outcomeId: "o2",
          side: "buy",
          price: "0.5",
          matchedSize: "1"
        }
      ]
    })).toThrow("participant_user_mismatch");
  });

  it("fails closed on duplicate ambiguous leg allocations", () => {
    expect(() => aggregator.aggregate({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.4",
          matchedSize: "1"
        },
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a1",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.4",
          matchedSize: "0.5"
        }
      ]
    })).toThrow("duplicate_participant_leg_allocation");
  });
});
