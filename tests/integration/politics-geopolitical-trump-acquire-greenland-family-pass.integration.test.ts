import { describe, expect, it } from "vitest";

import { extractPoliticsInventoryRow } from "../../src/matching/politics/politics-inventory-extractor.js";
import { buildPoliticsGeopoliticalTrumpAcquireGreenlandFamilyArtifacts } from "../../src/matching/politics/politics-geopolitical-trump-acquire-greenland-family-pass.js";
import type { MatchingMarketRecord } from "../../src/matching/matching-types.js";

const makeRecord = (input: {
  venue: "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";
  venueMarketId: string;
  title: string;
}): MatchingMarketRecord => ({
  interpretedContractId: `${input.venue}:${input.venueMarketId}`,
  venueMarketProfileId: `${input.venue}:${input.venueMarketId}`,
  canonicalEventId: "evt:2026-12-31",
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: input.title,
  description: null,
  rulesText: `This market resolves Yes if the United States officially announces Greenland will come under US sovereignty by December 31, 2026, 11:59 PM ET.`,
  category: "POLITICS",
  marketClass: "BINARY",
  sourceMetadataVersion: "test",
  confidenceScore: "1",
  propositionSemantics: {},
  outcomeSemantics: {},
  timingSemantics: {},
  resolutionSemantics: {},
  settlementSemantics: {},
  ambiguityFlags: {},
  rawLineageReferences: {},
  publishedAt: null,
  expiresAt: new Date("2026-12-31T23:59:59Z"),
  resolvesAt: new Date("2026-12-31T23:59:59Z"),
  outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  outcomeSchema: {
    marketShape: "binary",
    outcomeLabels: ["Yes", "No"]
  },
  historicalRowCount: 0,
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics geopolitical trump acquire greenland family pass", () => {
  it("materializes the exact 2026-12-31 topic and marks opinion wording as narrow comparable", () => {
    const rows = [
      makeRecord({ venue: "LIMITLESS", venueMarketId: "limitless:greenland", title: "Will Trump acquire Greenland before 2027?" }),
      makeRecord({ venue: "POLYMARKET", venueMarketId: "poly:greenland", title: "Will Trump acquire Greenland before 2027?" }),
      makeRecord({ venue: "PREDICT", venueMarketId: "2107", title: "Will Trump acquire Greenland before 2027?" }),
      makeRecord({ venue: "OPINION", venueMarketId: "op:greenland", title: "Will the US acquire part of Greenland in 2026?" })
    ].map((record) => extractPoliticsInventoryRow(record));

    const artifacts = buildPoliticsGeopoliticalTrumpAcquireGreenlandFamilyArtifacts(rows, new Date("2026-04-08T00:00:00Z"));

    expect(artifacts.comparabilitySummary).toEqual([
      {
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
        topicLabel: "Trump acquire Greenland by 2026-12-31",
        deadlineDate: "2026-12-31",
        venuesPresent: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        routeabilityCandidate: "TRI",
        matcherCandidate: true,
        comparabilityLabel: "NARROW_COMPARABLE",
        sourceRows: [
          { venue: "LIMITLESS", venueMarketId: "limitless:greenland", title: "Will Trump acquire Greenland before 2027?" },
          { venue: "POLYMARKET", venueMarketId: "poly:greenland", title: "Will Trump acquire Greenland before 2027?" },
          { venue: "PREDICT", venueMarketId: "2107", title: "Will Trump acquire Greenland before 2027?" },
          { venue: "OPINION", venueMarketId: "op:greenland", title: "Will the US acquire part of Greenland in 2026?" }
        ]
      }
    ]);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND");
  });
});
