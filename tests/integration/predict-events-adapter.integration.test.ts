import { describe, expect, it, vi } from "vitest";

import { PredictEventsAdapter } from "../../src/integrations/predict/predict-events-adapter.js";

describe("PredictEventsAdapter integration", () => {
  it("normalizes orders, matches, and account activity into execution-event records", async () => {
    const adapter = new PredictEventsAdapter({
      environment: "mainnet",
      client: {
        getOrders: vi.fn(async () => [{ hash: "o-1", marketId: "m-1", side: "BUY", price: "0.4", size: "10" }]),
        getOrderMatchEvents: vi.fn(async () => [{ id: "match-1", marketId: "m-1", orderHash: "o-1", price: "0.41", size: "4" }]),
        getAccountActivity: vi.fn(async () => [{ id: "act-1", marketId: "m-1", type: "trade", price: "0.41", size: "4" }])
      }
    });

    const [orders, matches, activity] = await Promise.all([
      adapter.getOrders({ marketId: "m-1" }),
      adapter.getOrderMatchEvents({ marketId: "m-1" }),
      adapter.getAccountActivity()
    ]);

    expect(orders[0]?.kind).toBe("ORDER");
    expect(matches[0]?.kind).toBe("MATCH");
    expect(activity[0]?.kind).toBe("ACCOUNT_ACTIVITY");
  });
});
