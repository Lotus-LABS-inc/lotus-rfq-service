import { describe, expect, it } from "vitest";

import {
  extractLimitlessOutcomeLabels,
  matchesNominee2028TopicTarget,
  matchesOfficeWinnerTopicTarget
} from "../../src/reports/politics-current-state-refresh.js";
import type { LimitlessLiveMarket } from "../../src/integrations/limitless/limitless-live-market-loader.js";

const market = (overrides: Partial<LimitlessLiveMarket> = {}): LimitlessLiveMarket => ({
  venueMarketId: "slug-1",
  marketId: "1",
  title: "Republican Presidential Nominee 2028",
  description: "Who will win the 2028 Republican presidential nomination?",
  slug: "republican-presidential-nominee-2028",
  status: "open",
  categories: ["Politics"],
  tags: ["republican", "president", "2028"],
  createdAt: null,
  updatedAt: null,
  expiresAt: null,
  openInterest: null,
  volume: null,
  liquidity: null,
  marketType: "group",
  sourceRef: "limitless_public_current_surface_nominee_2028_targeted",
  fetchedAt: new Date("2026-04-03T00:00:00.000Z"),
  canonicalCategory: "POLITICS",
  family: "NOMINEE_WINNER",
  asset: null,
  timeBoundary: null,
  threshold: null,
  raw: {
    outcomes: [
      { title: "Donald Trump" },
      { title: "JD Vance" },
      { title: "Others" }
    ]
  },
  ...overrides
});

describe("politics limitless nominee 2028 targeted fetch", () => {
  it("matches exact nominee topic rows on the targeted fallback surface", () => {
    expect(matchesNominee2028TopicTarget({
      title: market().title,
      rulesText: market().description,
      categoryHints: market().categories,
      tags: market().tags
    })).toBe(true);
  });

  it("matches office-winner targeted fallback rows on the public current surface", () => {
    expect(matchesOfficeWinnerTopicTarget({
      title: "Presidential Election Winner 2028",
      rulesText: "Resolves to the winner of the 2028 U.S. presidential election.",
      categoryHints: ["Politics"],
      tags: ["winner"]
    })).toBe(true);
  });

  it("preserves Others when present in raw outcomes", () => {
    const labels = extractLimitlessOutcomeLabels(market()).map((entry) => entry.label);

    expect(labels).toContain("Donald Trump");
    expect(labels).toContain("JD Vance");
    expect(labels).toContain("Others");
  });
});
