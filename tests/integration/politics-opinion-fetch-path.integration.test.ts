import { describe, expect, it, vi } from "vitest";

import { OpinionCurrentDiscoveryClient } from "../../src/integrations/opinion/opinion-current-discovery-client.js";

describe("opinion current discovery path", () => {
  it("uses the authenticated current-discovery path with documented pagination", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      expect(url).toContain("page=1");
      expect(url).toContain("limit=20");

      return {
        ok: true,
        json: async () => ({
          result: {
            list: [
              {
                marketId: "op-1",
                marketTitle: "Will Jon Ossoff be the Democratic nominee in 2028?",
                status: 2,
                statusEnum: "Activated",
                labels: ["POLITICS"],
                yesLabel: "Yes",
                noLabel: "No"
              }
            ]
          }
        })
      } as Response;
    });

    const client = new OpinionCurrentDiscoveryClient({
      apiKey: "test-key",
      baseUrl: "https://proxy.opinion.trade:8443/openapi",
      fetchImpl
    });

    const result = await client.listCurrentMarkets("test-version");

    expect(result.status).toBe("SUCCESS");
    expect(result.primaryDiscoveryPath).toBe("opinion_clob_sdk_active_markets");
    expect(result.fallbackDiscoveryPathUsed).toBeNull();
    expect(result.rows).toHaveLength(1);
  });
});
