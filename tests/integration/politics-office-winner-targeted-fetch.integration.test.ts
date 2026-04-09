import { describe, expect, it } from "vitest";

import {
  matchesOfficeWinnerTopicTarget,
  parseLimitlessOfficeWinnerDirectPage,
  parseOpinionOfficeWinnerDirectPage,
  parsePolymarketOfficeWinnerDirectPage
} from "../../src/reports/politics-current-state-refresh.js";
import { extractPoliticsInventoryRow } from "../../src/matching/politics/politics-inventory-extractor.js";

describe("politics office winner targeted fetch", () => {
  it("matches genuine office-winner rows without admitting party-control rows", () => {
    expect(matchesOfficeWinnerTopicTarget({
      title: "Presidential Election Winner 2028",
      rulesText: "Resolves to the candidate who wins the 2028 U.S. presidential election.",
      categoryHints: ["Politics"],
      tags: ["election", "winner"]
    })).toBe(true);

    expect(matchesOfficeWinnerTopicTarget({
      title: "2026 Seoul Mayoral Election Winner",
      rulesText: "Resolves to the candidate who wins the 2026 Seoul mayoral election.",
      categoryHints: ["Politics"],
      tags: ["mayor", "winner"]
    })).toBe(true);

    expect(matchesOfficeWinnerTopicTarget({
      title: "Balance of Power: 2026 Midterms",
      rulesText: "Resolves to which party controls the House and Senate after the 2026 midterms.",
      categoryHints: ["Politics"],
      tags: ["control"]
    })).toBe(false);
  });

  it("parses a generic office-winner Opinion direct page into a fresh politics row", () => {
    const parsed = parseOpinionOfficeWinnerDirectPage({
      url: "https://app.opinion.trade/market/2026-seoul-mayoral-election-winner",
      html: `
        <html>
          <head>
            <title>2026 Seoul Mayoral Election Winner</title>
            <meta name="description" content="Kim Moon-soo: 41% | Oh Se-hoon: 38% | Other: 21%">
            <meta name="twitter:image:src" content="https://app.opinion.trade/og/2026-seoul-mayoral-election-winner/601234">
          </head>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("OPINION");
    expect(parsed?.venueMarketId).toBe("601234");
    expect(parsed?.title).toBe("2026 Seoul Mayoral Election Winner");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Kim Moon-soo",
      "Oh Se-hoon",
      "Other"
    ]);
  });

  it("rejects an Opinion office-winner slug when the page is a no-market placeholder", () => {
    const parsed = parseOpinionOfficeWinnerDirectPage({
      url: "https://app.opinion.trade/market/2026-busan-mayoral-election-winner",
      html: `
        <html>
          <head>
            <title>OPINION</title>
            <meta name="description" content="Trade Tomorrow Now">
            <meta name="x-ssr-debug" content="no-data|errno:10217|errmsg:no market found for slug &quot;2026-busan-mayoral-election-winner&quot;">
          </head>
        </html>
      `
    });

    expect(parsed).toBeNull();
  });

  it("parses a generic office-winner Limitless direct page into a fresh politics row", () => {
    const parsed = parseLimitlessOfficeWinnerDirectPage({
      url: "https://limitless.exchange/markets/2026-seoul-mayoral-election-winner-1763484351054?rv=7Q4JYY4UXP",
      html: `
        <html>
          <head>
            <title>?? 2026 Seoul Mayoral Election Winner | Limitless</title>
            <meta property="og:title" content="?? 2026 Seoul Mayoral Election Winner">
          </head>
          <body>
            "description":"The 2026 Seoul mayoral election is scheduled to take place on June 3, 2026 to elect the next mayor of Seoul."
            "title":"Kim Moon-soo","proxyTitle":null
            "title":"Oh Se-hoon","proxyTitle":null
            "title":"Other","proxyTitle":null
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("LIMITLESS");
    expect(parsed?.venueMarketId).toBe("2026-seoul-mayoral-election-winner-1763484351054");
    expect(parsed?.title).toBe("2026 Seoul Mayoral Election Winner");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Kim Moon-soo",
      "Oh Se-hoon",
      "Other"
    ]);
  });

  it("parses a generic office-winner Polymarket direct page into a fresh politics row", () => {
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url: "https://polymarket.com/event/presidential-election-winner-2028",
      html: `
        <html>
          <head>
            <title>Presidential Election Winner 2028 Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="Presidential Election Winner 2028">
          </head>
          <body>
            <span class="sr-only">
              The 2028 US Presidential Election is scheduled to take place on November 7, 2028.
              This market will resolve to the person who wins the 2028 US Presidential Election.
            </span>
            <p class="font-semibold text-base">Donald Trump</p>
            <button>Buy Yes 23¢</button>
            <p class="font-semibold text-base">Kamala Harris</p>
            <button>Buy Yes 18¢</button>
            <p class="font-semibold text-base">Marco Rubio</p>
            <button>Buy Yes 11¢</button>
            <p class="font-semibold text-base">Other</p>
            <button>Buy Yes 7¢</button>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("POLYMARKET");
    expect(parsed?.venueMarketId).toBe("presidential-election-winner-2028");
    expect(parsed?.title).toBe("Presidential Election Winner 2028");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Donald Trump",
      "Kamala Harris",
      "Marco Rubio",
      "Other"
    ]);
  });

  it("parses a Colombia office-winner Polymarket direct page into a fresh politics row", () => {
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url: "https://polymarket.com/event/colombia-presidential-election",
      html: `
        <html>
          <head>
            <title>Colombia Presidential Election Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="Colombia Presidential Election">
          </head>
          <body>
            <span class="sr-only">
              Colombia's presidential elections are scheduled for May 31, 2026, and a second round (if required) on June 21, 2026.
              This market will resolve according to the listed candidate that wins this election.
              This market includes any potential second round.
              If the result of this election isn't known by December 31, 2026, 11:59 PM ET, the market will resolve to "Other".
            </span>
            <p class="font-semibold text-base">Iván Cepeda Castro</p>
            <p class="font-semibold text-base">Paloma Valencia</p>
            <p class="font-semibold text-base">Vicky Dávila</p>
            <p class="font-semibold text-base">Other</p>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("POLYMARKET");
    expect(parsed?.venueMarketId).toBe("colombia-presidential-election");
    expect(parsed?.title).toBe("Colombia Presidential Election");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Iván Cepeda Castro",
      "Other",
      "Paloma Valencia",
      "Vicky Dávila"
    ]);
  });

  it("parses a Seoul office-winner Polymarket direct page into a fresh politics row", () => {
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url: "https://polymarket.com/event/2026-seoul-mayoral-election-winner",
      html: `
        <html>
          <head>
            <title>2026 Seoul Mayoral Election Winner Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="2026 Seoul Mayoral Election Winner">
          </head>
          <body>
            <span class="sr-only">
              This market will resolve to the candidate who wins the 2026 Seoul mayoral election.
            </span>
            <p class="font-semibold text-base">Oh Se-hoon</p>
            <button>Buy Yes 40¢</button>
            <p class="font-semibold text-base">Na Kyung-won</p>
            <button>Buy Yes 18¢</button>
            <p class="font-semibold text-base">Park Ju-min</p>
            <button>Buy Yes 15¢</button>
            <p class="font-semibold text-base">Other</p>
            <button>Buy Yes 9¢</button>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("POLYMARKET");
    expect(parsed?.venueMarketId).toBe("2026-seoul-mayoral-election-winner");
    expect(parsed?.title).toBe("2026 Seoul Mayoral Election Winner");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Na Kyung-won",
      "Oh Se-hoon",
      "Other",
      "Park Ju-min"
    ]);
  });

  it("parses a Busan office-winner Polymarket direct page into a fresh politics row", () => {
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url: "https://polymarket.com/event/2026-busan-mayoral-election-winner",
      html: `
        <html>
          <head>
            <title>2026 Busan Mayoral Election Winner Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="2026 Busan Mayoral Election Winner">
          </head>
          <body>
            <span class="sr-only">
              The 2026 Busan mayoral election is scheduled to take place on June 3, 2026 to elect the next mayor of Busan.
              This market will resolve according to the listed candidate that wins this election.
            </span>
            <p class="font-semibold text-base">Chun Jae-soo</p>
            <p class="font-semibold text-base">Park Heong-joon</p>
            <p class="font-semibold text-base">Cho Kuk</p>
            <p class="font-semibold text-base">Other</p>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBe("POLYMARKET");
    expect(parsed?.venueMarketId).toBe("2026-busan-mayoral-election-winner");
    expect(parsed?.title).toBe("2026 Busan Mayoral Election Winner");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Cho Kuk",
      "Chun Jae-soo",
      "Other",
      "Park Heong-joon"
    ]);
  });

  it("normalizes the Seoul Polymarket office-winner row to seoul mayor instead of south korea prime minister", () => {
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url: "https://polymarket.com/event/2026-seoul-mayoral-election-winner",
      html: `
        <html>
          <head>
            <title>2026 Seoul Mayoral Election Winner Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="2026 Seoul Mayoral Election Winner">
          </head>
          <body>
            <span class="sr-only">
              The 2026 Seoul mayoral election is scheduled to take place on June 3, 2026 to elect the next mayor of Seoul.
              This market will resolve according to the listed candidate that wins this election.
              If the result of this election isn't known by January 31, 2027, 11:59 PM ET, the market will resolve to "Other".
              This market will resolve based solely on the official results as reported by the South Korean government.
            </span>
            <p class="font-semibold text-base">Chong Won-oh</p>
            <p class="font-semibold text-base">Na Kyung-won</p>
            <p class="font-semibold text-base">Oh Se-hoon</p>
            <p class="font-semibold text-base">Park Ju-min</p>
            <p class="font-semibold text-base">Beware of external links.</p>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    const extracted = extractPoliticsInventoryRow({
      interpretedContractId: "contract_seoul_poly_test",
      venueMarketProfileId: "profile_seoul_poly_test",
      venue: "POLYMARKET",
      venueMarketId: parsed!.venueMarketId,
      canonicalEventId: "event_seoul_poly_test",
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

    expect(extracted.jurisdiction).toBe("seoul");
    expect(extracted.office).toBe("mayor");
    expect(extracted.candidateNames).not.toContain("beware of external links");
  });

  it("keeps the Busan Polymarket candidate set free of related-market leakage", () => {
    const parsed = parsePolymarketOfficeWinnerDirectPage({
      url: "https://polymarket.com/event/2026-busan-mayoral-election-winner",
      html: `
        <html>
          <head>
            <title>2026 Busan Mayoral Election Winner Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="2026 Busan Mayoral Election Winner">
          </head>
          <body>
            <span class="sr-only">
              The 2026 Busan mayoral election is scheduled to take place on June 3, 2026 to elect the next mayor of Busan.
              This market will resolve according to the listed candidate that wins this election.
            </span>
            <p class="font-semibold text-base">Chun Jae-soo</p>
            <p class="font-semibold text-base">Park Heong-joon</p>
            <p class="font-semibold text-base">Cho Kuk</p>
            <p class="font-semibold text-base">Chong Won-oh 2026 Seoul Mayoral</p>
            <p class="font-semibold text-base">Choo Mi-ae 2026 Gyeonggi Province Gubernatorial</p>
            <p class="font-semibold text-base">Park Chan-dae 2026 Incheon Mayoral</p>
            <p class="font-semibold text-base">Other</p>
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    const extracted = extractPoliticsInventoryRow({
      interpretedContractId: "contract_busan_poly_test",
      venueMarketProfileId: "profile_busan_poly_test",
      venue: "POLYMARKET",
      venueMarketId: parsed!.venueMarketId,
      canonicalEventId: "event_busan_poly_test",
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

    expect(extracted.jurisdiction).toBe("busan");
    expect(extracted.office).toBe("mayor");
    expect(extracted.candidateNames).toContain("chun jae soo");
    expect(extracted.candidateNames).toContain("park heong joon");
    expect(extracted.candidateNames).not.toContain("chong won oh 2026 seoul mayoral");
    expect(extracted.candidateNames).not.toContain("choo mi ae 2026 gyeonggi province gubernatorial");
    expect(extracted.candidateNames).not.toContain("park chan dae 2026 incheon mayoral");
  });
});
