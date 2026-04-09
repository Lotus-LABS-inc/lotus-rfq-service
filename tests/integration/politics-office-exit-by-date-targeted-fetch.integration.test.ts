import { describe, expect, it } from "vitest";

import {
  classifyPoliticsCurrentAdmission,
  fetchPredictTargetedOfficeExitApiRows,
  matchesOfficeExitTopicTarget,
  parseLimitlessOfficeExitDirectPage,
  parseOpinionOfficeExitDirectPage,
  parsePolymarketOfficeExitDirectPage
} from "../../src/reports/politics-current-state-refresh.js";
import { extractPoliticsInventoryRow } from "../../src/matching/politics/politics-inventory-extractor.js";

describe("politics office-exit targeted fetch", () => {
  it("matches the narrow office-exit targets", () => {
    expect(matchesOfficeExitTopicTarget({
      title: "Trump out as President before 2027?",
      rulesText: "Resolves yes if Donald Trump ceases to be President of the United States for any period of time by December 31, 2026."
    })).toBe(true);

    expect(matchesOfficeExitTopicTarget({
      title: "2026 Seoul Mayoral Election Winner",
      rulesText: "Resolves to the candidate who wins the election."
    })).toBe(false);
  });

  it("parses the Opinion Trump office-exit page", () => {
    const parsed = parseOpinionOfficeExitDirectPage({
      url: "https://app.opinion.trade/market/trump-out-as-president-before-2027",
      html: `
        <html>
          <head>
            <title>Trump out as President before 2027?</title>
            <meta name="description" content="Donald Trump ceases to be President of the United States for any period of time by December 31, 2026.">
            <meta name="twitter:image:src" content="https://app.opinion.trade/og/trump-out-as-president-before-2027/734991">
          </head>
        </html>
      `
    });

    expect(parsed?.venue).toBe("OPINION");
    expect(parsed?.venueMarketId).toBe("734991");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual(["Yes", "No"]);
    expect(classifyPoliticsCurrentAdmission(parsed!)).toBe("POLITICS_ADMITTED");
  });

  it("parses the Limitless Netanyahu office-exit page", () => {
    const parsed = parseLimitlessOfficeExitDirectPage({
      url: "https://limitless.exchange/markets/netanyahu-out-by-end-of-2026-1768997302182?rv=7Q4JYY4UXP",
      html: `
        <html>
          <head>
            <title>Netanyahu out by end of 2026 | Limitless</title>
            <meta name="description" content="Benjamin Netanyahu ceases to be Prime Minister of Israel for any period of time by December 31, 2026.">
          </head>
        </html>
      `
    });

    expect(parsed?.venue).toBe("LIMITLESS");
    expect(parsed?.title).toBe("Netanyahu out before 2027?");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual(["Yes", "No"]);
  });

  it("parses and normalizes the Limitless Trump office-exit page", () => {
    const parsed = parseLimitlessOfficeExitDirectPage({
      url: "https://limitless.exchange/markets/trump-out-as-president-before-2027-1768933068297?rv=7Q4JYY4UXP",
      html: `
        <html>
          <head>
            <title>Trump out as President before 2027? | Limitless</title>
            <meta name="description" content="This market will resolve to Yes if Donald Trump resigns or is removed as President or otherwise ceases to be the President of the United States for any period of time by December 31, 2026.">
          </head>
          <body>
            <script>
              self.__next_f.push([1,"description":"<p>This market will resolve to “Yes” if Donald Trump resigns or is removed as President or otherwise ceases to be the President of the United States for any period of time by December 31, 2026, 11:59 PM ET.</p>"]);
            </script>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();

    const extracted = extractPoliticsInventoryRow({
      interpretedContractId: "contract_office_exit_limitless_trump_test",
      venueMarketProfileId: "profile_office_exit_limitless_trump_test",
      venue: "LIMITLESS",
      venueMarketId: parsed!.venueMarketId,
      canonicalEventId: "event_office_exit_limitless_trump_test",
      title: parsed!.title,
      description: null,
      rulesText: parsed!.rulesText,
      category: "POLITICS",
      marketClass: "BINARY",
      sourceMetadataVersion: "limitless-current-politics-refresh-v1",
      confidenceScore: "1.0",
      propositionSemantics: {},
      outcomeSemantics: {},
      timingSemantics: {},
      resolutionSemantics: {},
      settlementSemantics: {},
      ambiguityFlags: {},
      outcomes: parsed!.outcomes,
      outcomeSchema: {},
      historicalRowCount: 0,
      publishedAt: null,
      expiresAt: null,
      resolvesAt: null,
      rawLineageReferences: { slug: parsed!.slug ?? parsed!.venueMarketId },
      inventoryTemporalBasis: "LIVE_CURRENT_STATE"
    });

    expect(extracted.family).toBe("OFFICE_EXIT_BY_DATE");
    expect(extracted.jurisdiction).toBe("usa");
    expect(extracted.office).toBe("president");
    expect(extracted.candidateNames).toContain("donald trump");
  });

  it("parses and normalizes the Limitless Netanyahu office-exit page", () => {
    const parsed = parseLimitlessOfficeExitDirectPage({
      url: "https://limitless.exchange/markets/netanyahu-out-by-end-of-2026-1768997302182?rv=7Q4JYY4UXP",
      html: `
        <html>
          <head>
            <title>Netanyahu out by end of 2026? | Limitless</title>
            <meta name="description" content="This market will resolve to Yes if Benjamin Netanyahu announces that he will resign as Prime Minister of Israel, or otherwise steps down from/is removed from this position by December 31, 2026.">
          </head>
          <body>
            <script>
              self.__next_f.push([1,"description":"<p>This market will resolve to \\"Yes\\" if Benjamin Netanyahu announces that he will resign as Prime Minister of Israel, or otherwise steps down from/is removed from this position by December 31, 2026, 11:59 PM ET.</p>"]);
            </script>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();

    const extracted = extractPoliticsInventoryRow({
      interpretedContractId: "contract_office_exit_limitless_netanyahu_test",
      venueMarketProfileId: "profile_office_exit_limitless_netanyahu_test",
      venue: "LIMITLESS",
      venueMarketId: parsed!.venueMarketId,
      canonicalEventId: "event_office_exit_limitless_netanyahu_test",
      title: parsed!.title,
      description: null,
      rulesText: parsed!.rulesText,
      category: "POLITICS",
      marketClass: "BINARY",
      sourceMetadataVersion: "limitless-current-politics-refresh-v1",
      confidenceScore: "1.0",
      propositionSemantics: {},
      outcomeSemantics: {},
      timingSemantics: {},
      resolutionSemantics: {},
      settlementSemantics: {},
      ambiguityFlags: {},
      outcomes: parsed!.outcomes,
      outcomeSchema: {},
      historicalRowCount: 0,
      publishedAt: null,
      expiresAt: null,
      resolvesAt: null,
      rawLineageReferences: { slug: parsed!.slug ?? parsed!.venueMarketId },
      inventoryTemporalBasis: "LIVE_CURRENT_STATE"
    });

    expect(extracted.family).toBe("OFFICE_EXIT_BY_DATE");
    expect(extracted.jurisdiction).toBe("israel");
    expect(extracted.office).toBe("prime_minister");
    expect(extracted.candidateNames).toContain("benjamin netanyahu");
  });

  it("parses and normalizes the Polymarket Trump office-exit page", () => {
    const parsed = parsePolymarketOfficeExitDirectPage({
      url: "https://polymarket.com/event/trump-out-as-president-before-2027",
      html: `
        <html>
          <head>
            <title>Trump out as President before 2027? Trading Odds &amp; Predictions | Polymarket</title>
            <meta property="og:title" content="Trump out as President before 2027?">
          </head>
          <body>
            <span class="sr-only">
              This market will resolve to “Yes” if Donald Trump resigns or is removed as President or otherwise ceases to be the President of the United States for any period of time by December 31, 2026, 11:59 PM ET.
            </span>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Trump out as President before 2027?");

    const extracted = extractPoliticsInventoryRow({
      interpretedContractId: "contract_office_exit_poly_test",
      venueMarketProfileId: "profile_office_exit_poly_test",
      venue: "POLYMARKET",
      venueMarketId: parsed!.venueMarketId,
      canonicalEventId: "event_office_exit_poly_test",
      title: parsed!.title,
      description: null,
      rulesText: parsed!.rulesText,
      category: "POLITICS",
      marketClass: "BINARY",
      sourceMetadataVersion: "polymarket-current-politics-refresh-v1",
      confidenceScore: "1.0",
      propositionSemantics: {},
      outcomeSemantics: {},
      timingSemantics: {},
      resolutionSemantics: {},
      settlementSemantics: {},
      ambiguityFlags: {},
      outcomes: parsed!.outcomes,
      outcomeSchema: {},
      historicalRowCount: 0,
      publishedAt: null,
      expiresAt: null,
      resolvesAt: null,
      rawLineageReferences: { slug: parsed!.slug ?? parsed!.venueMarketId },
      inventoryTemporalBasis: "LIVE_CURRENT_STATE"
    });

    expect(extracted.family).toBe("OFFICE_EXIT_BY_DATE");
    expect(extracted.jurisdiction).toBe("usa");
    expect(extracted.office).toBe("president");
    expect(extracted.candidateNames).toContain("donald trump");
  });

  it("rescues Predict office-exit rows through exact API targeting", async () => {
    const rows = await fetchPredictTargetedOfficeExitApiRows({
      client: {
        getMarkets: async ({ search }: { search?: string }) => {
          if (search?.includes("trump")) {
            return [{ id: "7001", title: "Trump out as President before 2027?", description: "Donald Trump ceases to be President of the United States by December 31, 2026.", categories: ["Politics"], tags: ["Politics"] }] as never[];
          }
          if (search?.includes("netanyahu")) {
            return [{ id: "7002", title: "Netanyahu out before 2027", description: "Benjamin Netanyahu ceases to be Prime Minister of Israel by December 31, 2026.", categories: ["Politics"], tags: ["Politics"] }] as never[];
          }
          return [] as never[];
        }
      } as never,
      adapter: {
        getMarketById: async (marketId: string) => marketId === "7001"
          ? {
              venueMarketId: "7001",
              title: "Trump out as President before 2027?",
              description: "Donald Trump ceases to be President of the United States for any period of time by December 31, 2026.",
              categories: ["Politics"],
              tags: ["Politics"],
              createdAt: null,
              closesAt: null,
              resolvesAt: null,
              outcomes: [{ id: "yes", label: "Yes", tokenId: null, outcomeType: null, raw: {} }, { id: "no", label: "No", tokenId: null, outcomeType: null, raw: {} }],
              raw: { id: "7001" }
            }
          : {
              venueMarketId: "7002",
              title: "Netanyahu out before 2027",
              description: "Benjamin Netanyahu ceases to be Prime Minister of Israel for any period of time by December 31, 2026.",
              categories: ["Politics"],
              tags: ["Politics"],
              createdAt: null,
              closesAt: null,
              resolvesAt: null,
              outcomes: [{ id: "yes", label: "Yes", tokenId: null, outcomeType: null, raw: {} }, { id: "no", label: "No", tokenId: null, outcomeType: null, raw: {} }],
              raw: { id: "7002" }
            }
      } as never
    });

    expect(rows.map((row) => row.title).sort()).toEqual([
      "Netanyahu out before 2027?",
      "Trump out as President before 2027?"
    ]);
    expect(rows.every((row) => row.discoveryPath === "predict_exact_market_api_office_exit_targeted")).toBe(true);
  });
});
