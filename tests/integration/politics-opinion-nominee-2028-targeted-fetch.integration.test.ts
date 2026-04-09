import { describe, expect, it } from "vitest";

import { OpinionCurrentDiscoveryClient } from "../../src/integrations/opinion/opinion-current-discovery-client.js";

const buildMarket = (id: string, title: string) => ({
  marketId: id,
  marketTitle: title,
  slug: id,
  status: 2,
  statusEnum: "ACTIVATED",
  labels: ["POLITICS"],
  rules: `This market resolves YES if ${title}.`,
  yesLabel: "Yes",
  noLabel: "No"
});

describe("politics opinion nominee 2028 targeted fetch", () => {
  it("finds exact nominee topic rows beyond a sparse broad front page and de-dupes by market id", async () => {
    const responses = new Map<string, unknown>([
      ["1", { items: [buildMarket("1", "Will the US confirm that aliens exist before 2027?")] }],
      ["2", { items: [buildMarket("3055", "Will Gavin Newsom win the 2028 Democratic presidential nomination?")] }],
      ["3", { items: [buildMarket("3055", "Will Gavin Newsom win the 2028 Democratic presidential nomination?")] }],
      ["4", { items: [] }]
    ]);

    const client = new OpinionCurrentDiscoveryClient({
      apiKey: "test",
      pageSize: 1,
      maxPages: 4,
      fetchImpl: async (url) => {
        const page = new URL(String(url)).searchParams.get("page") ?? "1";
        return new Response(JSON.stringify(responses.get(page) ?? { items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const result = await client.listTargetedMarkets({
      metadataVersion: "test",
      matcher: (market) => /2028 democratic presidential nomination/i.test(market.title),
      maxPages: 4,
      pageSize: 1
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toContain("2028 Democratic presidential nomination");
    expect(result.scannedRowCount).toBe(2);
  });
});
