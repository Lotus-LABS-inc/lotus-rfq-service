import { describe, expect, it } from "vitest";

import { buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization } from "../../src/matching/politics/politics-geopolitical-trump-visit-china-2026-04-30-matcher.js";
import type { PoliticsGeopoliticalTrumpVisitChinaTopicSummary } from "../../src/matching/politics/politics-geopolitical-trump-visit-china-family-pass.js";

const topicSummary = (overrides: Partial<PoliticsGeopoliticalTrumpVisitChinaTopicSummary> = {}): PoliticsGeopoliticalTrumpVisitChinaTopicSummary => ({
  topicKey: overrides.topicKey ?? "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
  topicLabel: overrides.topicLabel ?? "Trump visit China by 2026-04-30",
  deadlineDate: overrides.deadlineDate ?? "2026-04-30",
  venuesPresent: overrides.venuesPresent ?? ["OPINION", "POLYMARKET", "PREDICT"],
  routeabilityCandidate: overrides.routeabilityCandidate ?? "TRI",
  matcherCandidate: overrides.matcherCandidate ?? true,
  comparabilityLabel: overrides.comparabilityLabel ?? "EXACT_COMPARABLE",
  sourceRows: overrides.sourceRows ?? [
    { venue: "OPINION", venueMarketId: "493244:april-30-2026", title: "Will Trump visit China by April 30, 2026?" },
    { venue: "POLYMARKET", venueMarketId: "will-trump-visit-china-by:april-30-2026", title: "Will Trump visit China by April 30, 2026?" },
    { venue: "PREDICT", venueMarketId: "16780", title: "Will Trump visit China by April 30, 2026?" }
  ]
});

describe("geopolitical trump visit china 2026-04-30 matcher", () => {
  it("materializes all exact pair lanes and the strict tri lane", () => {
    const materialized = buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization({
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual([
      "OPINION|POLYMARKET",
      "OPINION|PREDICT",
      "POLYMARKET|PREDICT"
    ]);
    expect(materialized.triLanes).toHaveLength(1);
    expect(materialized.finalDecision.bestPair).toBe("OPINION|POLYMARKET");
    expect(materialized.finalDecision.bestTriIfAny).toBe("OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.ruleStatus).toBe("EXACT_RULE_COMPATIBLE");
    expect(materialized.finalDecision.overallDecision).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_READY_BUT_PAIR_FIRST");
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "LIMITLESS")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "MYRIAD")).toBe(true);
  });
});
