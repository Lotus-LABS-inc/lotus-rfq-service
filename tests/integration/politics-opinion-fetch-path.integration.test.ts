import { describe, expect, it, vi } from "vitest";

import { OpinionCurrentDiscoveryClient } from "../../src/integrations/opinion/opinion-current-discovery-client.js";

describe("opinion current discovery path", () => {
  it("uses the authenticated current-discovery path with documented pagination", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      expect(url).toContain("page=1");
      expect(url).toContain("limit=20");
      expect(url).toContain("status=activated");
      expect(url).toContain("marketType=2");

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

  it("returns partial rows when a later Opinion discovery page times out", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("page=2")) {
        throw new Error("timeout");
      }

      return {
        ok: true,
        json: async () => ({
          result: {
            list: [
              {
                marketId: "op-page-1",
                marketTitle: "Will Bayern Munich win the Champions League?",
                status: 2,
                statusEnum: "Activated",
                labels: ["SPORTS"],
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
      pageSize: 1,
      maxPages: 3,
      fetchImpl
    });

    const result = await client.listCurrentMarkets("test-version");

    expect(result.status).toBe("DEGRADED");
    expect(result.rows.map((row) => row.venueMarketId)).toEqual(["op-page-1"]);
    expect(result.warnings.join(" ")).toContain("page 2 failed");
  });

  it("tries the next configured Opinion API key when the first key fails", async () => {
    const seenKeys: string[] = [];
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const apiKey = init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
        ? String((init.headers as Record<string, string>).apikey)
        : "";
      seenKeys.push(apiKey);
      if (apiKey === "bad-key") {
        return {
          ok: false,
          status: 403,
          json: async () => ({})
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          result: {
            list: [
              {
                marketId: "op-good-key",
                marketTitle: "Will Real Madrid win La Liga?",
                status: 2,
                statusEnum: "Activated",
                labels: ["SPORTS"],
                yesLabel: "Yes",
                noLabel: "No"
              }
            ]
          }
        })
      } as Response;
    });

    const client = new OpinionCurrentDiscoveryClient({
      apiKey: "bad-key",
      apiKeys: ["bad-key", "good-key"],
      baseUrl: "https://proxy.opinion.trade:8443/openapi",
      fallbackBaseUrl: "",
      fetchImpl
    });

    const result = await client.listCurrentMarkets("test-version");

    expect(seenKeys).toEqual(["bad-key", "good-key"]);
    expect(result.status).toBe("SUCCESS");
    expect(result.rows.map((row) => row.venueMarketId)).toEqual(["op-good-key"]);
  });
});
