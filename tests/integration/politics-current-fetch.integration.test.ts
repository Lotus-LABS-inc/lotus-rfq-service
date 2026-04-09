import { describe, expect, it } from "vitest";

import {
  buildPoliticsCurrentFetchArtifacts,
  buildFetchStatus,
  type PoliticsCurrentFetchResult
} from "../../src/reports/politics-current-state-refresh.js";

describe("politics current fetch artifacts", () => {
  it("preserves per-venue fetch truth and row counts", () => {
    const results: PoliticsCurrentFetchResult[] = [
      {
        venue: "POLYMARKET",
        status: buildFetchStatus({ configured: true, rows: 3, warnings: [] }),
        rows: [
          {
            venue: "POLYMARKET",
            venueMarketId: "pm-1",
            slug: "pm-1",
            title: "Who will win the 2028 Democratic nomination?",
            rulesText: null,
            categoryHints: ["POLITICS"],
            tags: [],
            active: true,
            publishedAt: null,
            expiresAt: null,
            resolvesAt: null,
            outcomes: [{ label: "Gavin Newsom" }, { label: "Other" }],
            sourceUrl: null,
            rawPayload: {},
            fetchTimestamp: new Date().toISOString(),
            discoveryPath: "predexon_polymarket_current_events"
          }
        ],
        discoveryPath: "predexon_polymarket_current_events",
        warnings: []
      },
      {
        venue: "LIMITLESS",
        status: buildFetchStatus({ configured: true, rows: 0, warnings: [], degraded: true }),
        rows: [],
        discoveryPath: "limitless_public_current_surface",
        warnings: ["snapshot fallback"]
      }
    ];

    const artifacts = buildPoliticsCurrentFetchArtifacts(results);

    expect(artifacts.fetchSummary.rowsByVenue.POLYMARKET).toBe(1);
    expect(artifacts.fetchSummary.statuses.LIMITLESS).toBe("DEGRADED");
    expect((artifacts.fetchStatus.POLYMARKET as { fetchStatus: string }).fetchStatus).toBe("SUCCESS");
  });
});
