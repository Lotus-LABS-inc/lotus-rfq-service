import { describe, expect, it } from "vitest";

import { OpinionCurrentDiscoveryClient } from "../../src/integrations/opinion/opinion-current-discovery-client.js";

describe("OpinionCurrentDiscoveryClient", () => {
  it("retries transient fetch failures before returning activated markets", async () => {
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("fetch failed: upstream timeout");
      }
      return new Response(JSON.stringify({
        data: {
          items: [
            {
              marketId: "opinion-market-one",
              title: "Will Gamma launch a token by 2027?",
              status: 2,
              marketType: 2,
              yesTokenId: "yes-token",
              noTokenId: "no-token",
              cutoffAt: "2027-01-01T00:00:00.000Z"
            }
          ]
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const result = await new OpinionCurrentDiscoveryClient({
      apiKey: "test-key",
      baseUrl: "https://opinion.test/openapi",
      fallbackBaseUrl: null,
      pageSize: 20,
      maxPages: 1,
      requestTimeoutMs: 5_000,
      retryAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      fetchImpl
    }).listCurrentMarkets("test-metadata-version");

    expect(attempts).toBe(3);
    expect(result.status).toBe("SUCCESS");
    expect(result.rows.map((row) => row.venueMarketId)).toEqual(["opinion-market-one"]);
  });
});
