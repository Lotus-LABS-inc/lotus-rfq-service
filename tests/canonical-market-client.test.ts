import { describe, expect, it } from "vitest";
import { createCanonicalMarketClient } from "../src/core/rfq-engine/canonical-market-client.js";

describe("canonical market client", () => {
  it("normalizes flat canonical market responses", async () => {
    const client = createCanonicalMarketClient({
      baseUrl: "https://canonical.test",
      fetchImpl: async () => new Response(JSON.stringify({
        id: "market-1",
        status: "ACTIVE",
        canonicalEventId: "00000000-0000-4000-8000-000000000001"
      }))
    });

    await expect(client.fetchMarketById("market-1")).resolves.toEqual({
      id: "market-1",
      status: "ACTIVE",
      isActive: true,
      canonicalEventId: "00000000-0000-4000-8000-000000000001"
    });
  });

  it("normalizes nested market catalog responses", async () => {
    const client = createCanonicalMarketClient({
      baseUrl: "https://canonical.test",
      fetchImpl: async () => new Response(JSON.stringify({
        market: {
          status: "OPEN",
          canonicalEventId: "00000000-0000-4000-8000-000000000002",
          canonicalMarketIds: ["frontend-market-1"]
        }
      }))
    });

    await expect(client.fetchMarketById("frontend-market-1")).resolves.toEqual({
      id: "frontend-market-1",
      status: "OPEN",
      isActive: true,
      canonicalEventId: "00000000-0000-4000-8000-000000000002"
    });
  });
});
