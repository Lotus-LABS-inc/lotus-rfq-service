import { describe, expect, it } from "vitest";

import {
  classifyPoliticsCurrentAdmission,
  matchesPartyControlTopicTarget,
  parseOpinionPartyControlDirectPage,
  parsePolymarketPartyControlDirectPage,
  parsePredictPartyControlDirectPage
} from "../../src/reports/politics-current-state-refresh.js";
import { extractPoliticsInventoryRow } from "../../src/matching/politics/politics-inventory-extractor.js";

describe("politics party-control targeted fetch", () => {
  it("matches the balance-of-power 2026 midterms topic narrowly", () => {
    expect(matchesPartyControlTopicTarget({
      title: "Balance of Power: 2026 Midterms",
      rulesText: "Resolves to the final balance of power in the House and Senate after the 2026 midterms."
    })).toBe(true);

    expect(matchesPartyControlTopicTarget({
      title: "2026 Seoul Mayoral Election Winner",
      rulesText: "Resolves to the candidate who wins the election."
    })).toBe(false);
  });

  it("parses the Opinion balance-of-power page", () => {
    const parsed = parseOpinionPartyControlDirectPage({
      url: "https://app.opinion.trade/market/balance-of-power-2026-midterms",
      html: `
        <html>
          <head>
            <title>Balance of Power: 2026 Midterms</title>
            <meta name="description" content="Democrats Sweep: 52% | Republicans Sweep: 12% | D Senate, R House: 9% | Other: 8%">
            <meta name="twitter:image:src" content="https://app.opinion.trade/og/balance-of-power-2026-midterms/493239">
          </head>
        </html>
      `
    });

    expect(parsed?.venue).toBe("OPINION");
    expect(parsed?.venueMarketId).toBe("493239");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "D Senate, R House",
      "Democrats Sweep",
      "Other",
      "Republicans Sweep"
    ]);
  });

  it("parses the Polymarket balance-of-power page", () => {
    const parsed = parsePolymarketPartyControlDirectPage({
      url: "https://polymarket.com/event/balance-of-power-2026-midterms",
      html: `
        <html>
          <head>
            <title>Balance of Power: 2026 Midterms Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="Balance of Power: 2026 Midterms">
          </head>
          <body>
            Democrats Sweep
            D Senate, R House
            R Senate, D House
            Republicans Sweep
            Other
          </body>
        </html>
      `
    });

    expect(parsed?.venue).toBe("POLYMARKET");
    expect(parsed?.venueMarketId).toBe("balance-of-power-2026-midterms");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Democrats Sweep",
      "Republicans Sweep",
      "D Senate, R House",
      "R Senate, D House",
      "Other"
    ]);
  });

  it("admits targeted Polymarket party-control rows into current-state refresh", () => {
    const parsed = parsePolymarketPartyControlDirectPage({
      url: "https://polymarket.com/event/balance-of-power-2026-midterms",
      html: `
        <html>
          <head>
            <title>Balance of Power: 2026 Midterms Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="Balance of Power: 2026 Midterms">
          </head>
          <body>
            Democrats Sweep
            D Senate, R House
            R Senate, D House
            Republicans Sweep
            Other
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();
    expect(classifyPoliticsCurrentAdmission(parsed!)).toBe("POLITICS_ADMITTED");
  });

  it("normalizes the Polymarket balance-of-power row as usa party-control using outcome labels", () => {
    const parsed = parsePolymarketPartyControlDirectPage({
      url: "https://polymarket.com/event/balance-of-power-2026-midterms",
      html: `
        <html>
          <head>
            <title>Balance of Power: 2026 Midterms Predictions &amp; Odds | Polymarket</title>
            <meta property="og:title" content="Balance of Power: 2026 Midterms">
          </head>
          <body>
            Democrats Sweep
            D Senate, R House
            R Senate, D House
            Republicans Sweep
            Other
          </body>
        </html>
      `
    });

    expect(parsed).not.toBeNull();

    const extracted = extractPoliticsInventoryRow({
      interpretedContractId: "contract_party_control_poly_test",
      venueMarketProfileId: "profile_party_control_poly_test",
      venue: "POLYMARKET",
      venueMarketId: parsed!.venueMarketId,
      canonicalEventId: "event_party_control_poly_test",
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

    expect(extracted.family).toBe("PARTY_CONTROL");
    expect(extracted.jurisdiction).toBe("usa");
    expect(extracted.cycleYear).toBe("2026");
  });

  it("matches the grouped Predict party-control umbrella row narrowly", () => {
    expect(matchesPartyControlTopicTarget({
      title: "Balance of Power: 2026 Midterms",
      rulesText: "Grouped exact-market API rescue from Predict component markets for the 2026 midterms balance of power.",
      categoryHints: ["Politics", "Predict", "Party Control"],
      tags: ["Balance of Power"]
    })).toBe(true);
  });

  it("parses the Predict balance-of-power page when HTML is available", () => {
    const parsed = parsePredictPartyControlDirectPage({
      url: "https://predict.fun/market/balance-of-power-2026-midterm-elections",
      html: `
        <html>
          <head><title>Balance of Power: 2026 Midterms | Predict</title></head>
          <body>
            # Balance of Power: 2026 Midterms
            Democrats Sweep
            D Senate, R House
            R Senate, D House
            Republicans Sweep
            Other
          </body>
        </html>
      `
    });

    expect(parsed?.venue).toBe("PREDICT");
    expect(parsed?.venueMarketId).toBe("balance-of-power-2026-midterm-elections");
    expect(parsed?.outcomes.map((outcome) => outcome.label)).toEqual([
      "Democrats Sweep",
      "Republicans Sweep",
      "D Senate, R House",
      "R Senate, D House",
      "Other"
    ]);
  });
});
