import { describe, expect, it } from "vitest";

import { buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization } from "../../src/matching/politics/politics-geopolitical-trump-acquire-greenland-2026-12-31-matcher.js";
import type { PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary } from "../../src/matching/politics/politics-geopolitical-trump-acquire-greenland-family-pass.js";

const topicSummary = (overrides: Partial<PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary> = {}): PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary => ({
  topicKey: overrides.topicKey ?? "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
  topicLabel: overrides.topicLabel ?? "Trump acquire Greenland by 2026-12-31",
  deadlineDate: overrides.deadlineDate ?? "2026-12-31",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET", "PREDICT"],
  routeabilityCandidate: overrides.routeabilityCandidate ?? "TRI",
  matcherCandidate: overrides.matcherCandidate ?? true,
  comparabilityLabel: overrides.comparabilityLabel ?? "EXACT_COMPARABLE",
  sourceRows: overrides.sourceRows ?? [
    { venue: "LIMITLESS", venueMarketId: "limitless:greenland", title: "Will Trump acquire Greenland before 2027?" },
    { venue: "POLYMARKET", venueMarketId: "poly:greenland", title: "Will Trump acquire Greenland before 2027?" },
    { venue: "PREDICT", venueMarketId: "2107", title: "Will Trump acquire Greenland before 2027?" }
  ]
});

describe("geopolitical trump acquire greenland 2026-12-31 tri policy", () => {
  it("fails closed on missing tri edge while preserving the available pair lanes", () => {
    const materialized = buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization({
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.triLanes).toHaveLength(0);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual([
      "LIMITLESS|POLYMARKET",
      "LIMITLESS|PREDICT",
      "POLYMARKET|PREDICT"
    ]);
    expect(materialized.finalDecision.triMatcherReady).toBe(false);
    expect(materialized.finalDecision.overallDecision).toBe("GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_MATCHER_READY");
    expect(materialized.rejections.some((rejection) => rejection.reason === "PAIR_EDGE_MISSING" && rejection.venuePair === "LIMITLESS|OPINION")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "TRI_EDGE_MISSING")).toBe(true);
  });
});
