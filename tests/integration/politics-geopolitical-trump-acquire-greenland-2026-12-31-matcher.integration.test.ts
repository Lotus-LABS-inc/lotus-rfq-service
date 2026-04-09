import { describe, expect, it } from "vitest";

import { buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization } from "../../src/matching/politics/politics-geopolitical-trump-acquire-greenland-2026-12-31-matcher.js";
import type { PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary } from "../../src/matching/politics/politics-geopolitical-trump-acquire-greenland-family-pass.js";

const topicSummary = (overrides: Partial<PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary> = {}): PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary => ({
  topicKey: overrides.topicKey ?? "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
  topicLabel: overrides.topicLabel ?? "Trump acquire Greenland by 2026-12-31",
  deadlineDate: overrides.deadlineDate ?? "2026-12-31",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  routeabilityCandidate: overrides.routeabilityCandidate ?? "TRI",
  matcherCandidate: overrides.matcherCandidate ?? true,
  comparabilityLabel: overrides.comparabilityLabel ?? "NARROW_COMPARABLE",
  sourceRows: overrides.sourceRows ?? [
    { venue: "LIMITLESS", venueMarketId: "limitless:greenland", title: "Will Trump acquire Greenland before 2027?" },
    { venue: "OPINION", venueMarketId: "op:greenland", title: "Will the US acquire part of Greenland in 2026?" },
    { venue: "POLYMARKET", venueMarketId: "poly:greenland", title: "Will Trump acquire Greenland before 2027?" },
    { venue: "PREDICT", venueMarketId: "2107", title: "Will Trump acquire Greenland before 2027?" }
  ]
});

describe("geopolitical trump acquire greenland 2026-12-31 matcher", () => {
  it("materializes all pair lanes and the strict tri lane with review gating", () => {
    const materialized = buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization({
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual([
      "LIMITLESS|OPINION",
      "LIMITLESS|POLYMARKET",
      "LIMITLESS|PREDICT",
      "OPINION|POLYMARKET",
      "OPINION|PREDICT",
      "POLYMARKET|PREDICT"
    ]);
    expect(materialized.triLanes).toHaveLength(1);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.bestTriIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.ruleStatus).toBe("SEMANTICALLY_COMPATIBLE_REWORDING");
    expect(materialized.finalDecision.overallDecision).toBe("GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_REVIEW_REQUIRED");
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "MYRIAD")).toBe(true);
  });
});
