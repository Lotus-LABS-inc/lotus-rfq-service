import { describe, expect, it } from "vitest";

import {
  buildPoliticsCurrentStorageRefreshSummary,
  type FreshPoliticsFetchRow,
  type PoliticsCurrentInterpretationRow
} from "../../src/reports/politics-current-state-refresh.js";

describe("politics current storage refresh summary", () => {
  it("captures before/after politics inventory deltas by venue", () => {
    const admittedRows: FreshPoliticsFetchRow[] = [
      {
        venue: "POLYMARKET",
        venueMarketId: "pm-1",
        slug: "pm-1",
        title: "Who will be the Democratic nominee for President in 2028?",
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
        discoveryPath: "test"
      }
    ];
    const refreshedRows: PoliticsCurrentInterpretationRow[] = [
      {
        interpretedContractId: "pm-1",
        venue: "POLYMARKET",
        venueMarketId: "pm-1",
        title: "Who will be the Democratic nominee for President in 2028?",
        familyCandidateSignals: ["NOMINEE_WINNER"],
        jurisdiction: "usa",
        office: "president",
        cycleYear: "2028",
        candidateNames: ["gavin newsom"],
        outcomeStructureType: "MULTI_CANDIDATE",
        activeCurrentStatus: true,
        interpretationConfidence: "HIGH",
        interpretationFailures: [],
        sourceMetadataVersion: "polymarket-current-politics-refresh-v1"
      }
    ];

    const summary = buildPoliticsCurrentStorageRefreshSummary({
      beforeCounts: { POLYMARKET: 0, OPINION: 1 },
      afterCounts: { POLYMARKET: 1, OPINION: 1 },
      admittedRows,
      rejectedCount: 2,
      refreshedRows
    });

    expect(summary.summary.totalPoliticsRowsBefore).toBe(1);
    expect(summary.summary.totalPoliticsRowsAfter).toBe(2);
    expect((summary.delta.POLYMARKET as { inserted: number }).inserted).toBe(1);
  });
});
