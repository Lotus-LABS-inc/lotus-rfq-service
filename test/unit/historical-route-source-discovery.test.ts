import { describe, expect, it } from "vitest";

import {
  buildSourceBackedHistoricalCandidate,
  historicalRouteDiscoverySeeds
} from "../../src/simulation/historical-route-source-discovery.js";

describe("historicalRouteSourceDiscovery", () => {
  it("provides at least one exact PM+Limitless pair seed for each required category", () => {
    const categories = new Set(
      historicalRouteDiscoverySeeds
        .filter((seed) => seed.venueProfiles.some((profile) => profile.venue === "POLYMARKET"))
        .map((seed) => seed.canonicalCategory)
    );

    expect(categories).toEqual(new Set(["POLITICS", "CRYPTO", "SPORTS", "ESPORTS"]));
  });

  it("builds source-backed candidates as unresolved until the curated manifest accepts them", () => {
    const sourceBackedSeed = historicalRouteDiscoverySeeds.find((seed) => seed.historicalCanonicalMarketId.includes("GAVIN-NEWSOM"));
    expect(sourceBackedSeed).toBeDefined();

    const candidate = buildSourceBackedHistoricalCandidate(sourceBackedSeed!);

    expect(candidate.decision).toEqual({
      status: "unresolved",
      reasonCode: "awaiting_curated_approval",
      reason: "Source-backed historical exact match candidate validated against documented venue metadata and requires explicit checked-in approval."
    });
    expect(candidate.acceptedAssessments).toEqual([]);
    expect(candidate.venueProfiles).toHaveLength(2);
  });

  it("can represent a discovered Opinion venue profile without auto-accepting the route", () => {
    const sourceBackedSeed = historicalRouteDiscoverySeeds.find((seed) => seed.historicalCanonicalMarketId.includes("GAVIN-NEWSOM"));
    expect(sourceBackedSeed).toBeDefined();

    const candidate = buildSourceBackedHistoricalCandidate(sourceBackedSeed!, {
      additionalDiscoveredFrom: [
        {
          type: "predexon_validation",
          reference: "https://api.predexon.com/v2/opinion/orderbooks?market_id=1234",
          observation: "Validated exact Opinion historical candidate."
        }
      ],
      additionalVenueProfiles: [
        {
          venue: "OPINION",
          venueMarketId: "1234",
          title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
          historySource: "predexon_opinion",
          historyWindow: {
            start: "2026-03-01T00:00:00.000Z",
            end: "2026-03-20T00:00:00.000Z"
          }
        }
      ]
    });

    expect(candidate.decision.status).toBe("unresolved");
    expect(candidate.venueProfiles.map((profile) => profile.venue)).toEqual(["POLYMARKET", "LIMITLESS", "OPINION"]);
    expect(candidate.discoveredFrom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "predexon_validation"
        })
      ])
    );
  });
});
