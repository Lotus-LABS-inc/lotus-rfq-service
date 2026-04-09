import { describe, expect, it, vi } from "vitest";

vi.mock("@limitless-exchange/sdk", () => {
  class HttpClient {
    public constructor(_: unknown) {}
  }

  class MarketFetcher {
    public constructor(_: unknown) {}

    public async getActiveMarkets(): Promise<{ data: Array<Record<string, unknown>> }> {
      return {
        data: [
          {
            id: 1,
            slug: "us-election-2028-democratic-nominee",
            title: "Who will be the Democratic nominee for U.S. President in 2028?",
            proxyTitle: null,
            description: "Nominee market",
            expirationTimestamp: Date.now() + 10_000,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            categories: ["Politics"],
            tags: ["Democratic", "Nominee"],
            status: "active",
            creator: {},
            tradeType: "clob",
            marketType: "single"
          }
        ]
      };
    }
  }

  return {
    HttpClient,
    MarketFetcher
  };
});

import { LimitlessCurrentDiscoveryClient } from "../../src/integrations/limitless/limitless-current-discovery-client.js";

describe("limitless current discovery path", () => {
  it("uses the sdk active-markets discovery path", async () => {
    const client = new LimitlessCurrentDiscoveryClient({
      baseUrl: "https://api.limitless.exchange"
    });

    const result = await client.listCurrentMarkets();

    expect(result.status).toBe("SUCCESS");
    expect(result.primaryDiscoveryPath).toBe("limitless_sdk_active_markets");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.canonicalCategory).toBe("POLITICS");
  });
});
