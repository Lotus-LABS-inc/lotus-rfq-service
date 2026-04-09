import { describe, expect, it } from "vitest";

import { buildPoliticsCurrentAdmissionArtifacts, type FreshPoliticsFetchRow } from "../../src/reports/politics-current-state-refresh.js";

const buildRow = (input: Partial<FreshPoliticsFetchRow> & Pick<FreshPoliticsFetchRow, "venue" | "venueMarketId" | "title">): FreshPoliticsFetchRow => ({
  slug: null,
  rulesText: null,
  categoryHints: [],
  tags: [],
  active: true,
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  outcomes: [{ label: "Yes" }, { label: "No" }],
  sourceUrl: null,
  rawPayload: {},
  fetchTimestamp: new Date().toISOString(),
  discoveryPath: "test",
  ...input
});

describe("politics current admission", () => {
  it("admits politics rows and rejects non-politics contamination", () => {
    const artifacts = buildPoliticsCurrentAdmissionArtifacts([
      buildRow({
        venue: "POLYMARKET",
        venueMarketId: "pol-1",
        title: "Who will be the Democratic nominee for President in 2028?",
        categoryHints: ["POLITICS"]
      }),
      buildRow({
        venue: "OPINION",
        venueMarketId: "sports-1",
        title: "Will Arsenal win the Premier League?",
        categoryHints: ["SPORTS"]
      })
    ]);

    expect(artifacts.summary.labels.POLITICS_ADMITTED).toBe(1);
    expect(artifacts.summary.labels.NON_POLITICS_REJECTED).toBe(1);
    expect(artifacts.admittedRows).toHaveLength(1);
    expect(artifacts.rejections[0]?.label).toBe("NON_POLITICS_REJECTED");
  });
});
