import { describe, expect, it } from "vitest";

import { buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization } from "../../src/matching/politics/politics-geopolitical-trump-visit-china-2026-04-30-matcher.js";
import type { PoliticsGeopoliticalTrumpVisitChinaTopicSummary } from "../../src/matching/politics/politics-geopolitical-trump-visit-china-family-pass.js";

const topicSummary = (overrides: Partial<PoliticsGeopoliticalTrumpVisitChinaTopicSummary> = {}): PoliticsGeopoliticalTrumpVisitChinaTopicSummary => ({
  topicKey: overrides.topicKey ?? "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
  topicLabel: overrides.topicLabel ?? "Trump visit China by 2026-04-30",
  deadlineDate: overrides.deadlineDate ?? "2026-04-30",
  venuesPresent: overrides.venuesPresent ?? ["POLYMARKET", "PREDICT"],
  routeabilityCandidate: overrides.routeabilityCandidate ?? "PAIR",
  matcherCandidate: overrides.matcherCandidate ?? true,
  comparabilityLabel: overrides.comparabilityLabel ?? "EXACT_COMPARABLE",
  sourceRows: overrides.sourceRows ?? [
    { venue: "POLYMARKET", venueMarketId: "will-trump-visit-china-by:april-30-2026", title: "Will Trump visit China by April 30, 2026?" },
    { venue: "PREDICT", venueMarketId: "16780", title: "Will Trump visit China by April 30, 2026?" }
  ]
});

describe("geopolitical trump visit china 2026-04-30 tri policy", () => {
  it("fails closed on missing tri edge while preserving the available pair lane", () => {
    const materialized = buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization({
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.triLanes).toHaveLength(0);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual(["POLYMARKET|PREDICT"]);
    expect(materialized.finalDecision.triMatcherReady).toBe(false);
    expect(materialized.finalDecision.overallDecision).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_MATCHER_READY");
    expect(materialized.rejections.some((rejection) => rejection.reason === "PAIR_EDGE_MISSING" && rejection.venuePair === "OPINION|POLYMARKET")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "TRI_EDGE_MISSING")).toBe(true);
  });
});
