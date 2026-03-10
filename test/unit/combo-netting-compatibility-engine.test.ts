import { describe, expect, it } from "vitest";

import { ComboNettingCompatibilityEngine } from "../../src/core/combo-engine/combo-netting-compatibility-engine.js";

const engine = new ComboNettingCompatibilityEngine();

describe("ComboNettingCompatibilityEngine", () => {
  it("accepts an exact opposite combo and returns full matched leg pairs", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "10",
            priceHint: "0.60"
          },
          {
            id: "in-2",
            canonicalMarketId: "market-2",
            canonicalOutcomeId: "outcome-2",
            side: "sell",
            quantity: "5",
            priceHint: "0.40"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "8",
            priceHint: "0.55"
          },
          {
            id: "cand-2",
            canonicalMarketId: "market-2",
            canonicalOutcomeId: "outcome-2",
            side: "buy",
            quantity: "7",
            priceHint: "0.45"
          }
        ]
      }
    );

    expect(result).toEqual({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-1",
          candidateLegId: "cand-1",
          marketId: "market-1",
          outcomeId: "outcome-1",
          matchedSize: "8"
        },
        {
          incomingLegId: "in-2",
          candidateLegId: "cand-2",
          marketId: "market-2",
          outcomeId: "outcome-2",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
  });

  it("accepts constrained overlap and returns only the matched subset", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "4",
            priceHint: "0.70"
          },
          {
            id: "in-2",
            canonicalMarketId: "market-2",
            canonicalOutcomeId: "outcome-2",
            side: "sell",
            quantity: "9"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "3",
            priceHint: "0.65"
          }
        ]
      }
    );

    expect(result).toEqual({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-1",
          candidateLegId: "cand-1",
          marketId: "market-1",
          outcomeId: "outcome-1",
          matchedSize: "3"
        }
      ],
      maxNettableSize: "3"
    });
  });

  it("rejects same-user combos", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "same-user",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "1"
          }
        ]
      },
      {
        id: "candidate",
        userId: "same-user",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "1"
          }
        ]
      }
    );

    expect(result).toEqual({
      compatible: false,
      reason: "self_trade_forbidden",
      matchedLegPairs: [],
      maxNettableSize: "0"
    });
  });

  it("rejects incompatible outcomes", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "1"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-2",
            side: "sell",
            quantity: "1"
          }
        ]
      }
    );

    expect(result.reason).toBe("outcome_universe_mismatch");
    expect(result.compatible).toBe(false);
  });

  it("rejects incompatible prices", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "5",
            priceHint: "0.40"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "5",
            priceHint: "0.45"
          }
        ]
      }
    );

    expect(result.reason).toBe("price_incompatible");
    expect(result.compatible).toBe(false);
  });

  it("fails closed on price ambiguity when only one side has priceHint", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "5",
            priceHint: "0.30"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "5"
          }
        ]
      }
    );

    expect(result.reason).toBe("price_ambiguity");
    expect(result.compatible).toBe(false);
  });

  it("fails closed on ambiguous duplicate mappings", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "5"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "5"
          },
          {
            id: "cand-2",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "5"
          }
        ]
      }
    );

    expect(result.reason).toBe("ambiguous_leg_mapping");
    expect(result.compatible).toBe(false);
  });

  it("rejects non-exact overlap when universes match but not all legs map one-to-one", () => {
    const result = engine.evaluate(
      {
        id: "incoming",
        userId: "user-a",
        legs: [
          {
            id: "in-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "buy",
            quantity: "5"
          },
          {
            id: "in-2",
            canonicalMarketId: "market-2",
            canonicalOutcomeId: "outcome-2",
            side: "sell",
            quantity: "5"
          }
        ]
      },
      {
        id: "candidate",
        userId: "user-b",
        legs: [
          {
            id: "cand-1",
            canonicalMarketId: "market-1",
            canonicalOutcomeId: "outcome-1",
            side: "sell",
            quantity: "5"
          },
          {
            id: "cand-2",
            canonicalMarketId: "market-2",
            canonicalOutcomeId: "outcome-2",
            side: "sell",
            quantity: "5"
          }
        ]
      }
    );

    expect(result.reason).toBe("non_exact_overlap");
    expect(result.compatible).toBe(false);
  });
});
