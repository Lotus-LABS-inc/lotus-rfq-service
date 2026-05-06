import { describe, expect, it } from "vitest";

import {
  buildPolymarketClobTokenEnrichment,
  classifyPolymarketQuoteIdentifier,
  extractPolymarketQuoteIdentifier
} from "../src/core/sor/polymarket-clob-token-enrichment.js";
import { normalizeGammaMarketList } from "../src/integrations/polymarket/polymarket-gamma-client.js";

const profile = {
  profileId: "profile-1",
  approvedVenueMarketId: "POLYMARKET:bitcoin-all-time-high-by-june-30-2026:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
  title: "Bitcoin all time high by June 30, 2026?",
  normalizedPayload: {
    curatedKey: "CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
    venueMarketId: "bitcoin-all-time-high-by-june-30-2026"
  },
  rawSourcePayload: {}
};

const market = {
  marketId: "123",
  conditionId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
  marketSlug: "bitcoin-all-time-high-by-june-30-2026",
  title: "Bitcoin all time high by June 30, 2026?",
  raw: {
    outcomes: [
      { label: "Yes", token_id: "yes-token" },
      { label: "No", token_id: "no-token" }
    ]
  }
};

describe("Polymarket CLOB token enrichment", () => {
  it("extracts source identifiers from approved shared-core payloads", () => {
    expect(extractPolymarketQuoteIdentifier(profile)).toBe("bitcoin-all-time-high-by-june-30-2026");
    expect(classifyPolymarketQuoteIdentifier(market.conditionId)).toBe("CONDITION_ID");
    expect(classifyPolymarketQuoteIdentifier("123")).toBe("MARKET_ID");
    expect(classifyPolymarketQuoteIdentifier("bitcoin-all-time-high-by-june-30-2026")).toBe("MARKET_SLUG");
  });

  it("builds source-backed quoteMarketId and quoteTokenId updates", () => {
    const result = buildPolymarketClobTokenEnrichment({
      profile,
      markets: [market],
      generatedAt: "2026-05-06T00:00:00.000Z",
      metadataVersion: "polymarket-official-v1",
      source: "polymarket_official_api"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected enrichment");
    }
    expect(result.enrichment.quoteMarketId).toBe(market.conditionId);
    expect(result.enrichment.quoteTokenId).toBe("yes-token");
    expect(result.enrichment.normalizedPayload).toMatchObject({
      quoteMarketId: market.conditionId,
      quoteTokenId: "yes-token",
      quoteOutcomeTokenIds: {
        YES: "yes-token",
        NO: "no-token"
      },
      quoteSource: "polymarket_official_api"
    });
    expect(result.enrichment.rawSourcePayload.quoteEvidence).toMatchObject({
      conditionId: market.conditionId,
      marketId: "123",
      marketSlug: "bitcoin-all-time-high-by-june-30-2026"
    });
  });

  it("rejects ambiguous source matches", () => {
    const result = buildPolymarketClobTokenEnrichment({
      profile,
      markets: [market, { ...market, conditionId: "0x437ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4" }],
      generatedAt: "2026-05-06T00:00:00.000Z",
      metadataVersion: "polymarket-official-v1",
      source: "polymarket_official_api"
    });

    expect(result).toMatchObject({
      ok: false,
      blockers: ["POLYMARKET_SOURCE_MATCH_AMBIGUOUS"]
    });
  });

  it("allows exact source-title matches when stored slug identifier is not executable", () => {
    const result = buildPolymarketClobTokenEnrichment({
      profile: {
        ...profile,
        approvedVenueMarketId: "POLYMARKET:lol-lpl-2026-season-winner:bilibili-gaming:SPORTS|TOURNAMENT_WINNER|LPL|2026|BILIBILI_GAMING",
        normalizedPayload: {
          curatedKey: "SPORTS|TOURNAMENT_WINNER|LPL|2026|BILIBILI_GAMING",
          venueMarketId: "lol-lpl-2026-season-winner:bilibili-gaming"
        },
        title: "Will Bilibili Gaming win the LPL 2026 season?"
      },
      markets: [{
        ...market,
        conditionId: "0x1c27970809d0ec4e22757cef8628026108f91712bd6318092b65767351957dc0",
        marketSlug: "will-bilibili-gaming-win-the-lpl-2026-season",
        title: "Will Bilibili Gaming win the LPL 2026 season?"
      }],
      generatedAt: "2026-05-06T00:00:00.000Z",
      metadataVersion: "polymarket-official-v1",
      source: "polymarket_official_api"
    });

    expect(result.ok).toBe(true);
  });

  it("rejects markets without labeled binary token evidence", () => {
    const result = buildPolymarketClobTokenEnrichment({
      profile,
      markets: [{ ...market, raw: { outcomes: [{ label: "Brazil", token_id: "brazil-token" }] } }],
      generatedAt: "2026-05-06T00:00:00.000Z",
      metadataVersion: "polymarket-official-v1",
      source: "polymarket_official_api"
    });

    expect(result).toMatchObject({
      ok: false,
      blockers: ["POLYMARKET_OUTCOME_TOKEN_EVIDENCE_MISSING"]
    });
  });

  it("maps first-to-threshold source outcome labels to canonical YES and NO tokens", () => {
    const result = buildPolymarketClobTokenEnrichment({
      profile: {
        profileId: "profile-threshold",
        approvedVenueMarketId: "POLYMARKET:1357099:CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01|YES",
        title: "First To Threshold By Date Btc 60000: 2027-01-01",
        normalizedPayload: {
          curatedKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01|YES",
          venueMarketId: "1357099"
        },
        rawSourcePayload: {}
      },
      markets: [{
        marketId: "1357099",
        conditionId: "0xecd961f60dad9a8f4f25f717bc6771e09cddf3077657aafc67a6a528c92aad55",
        marketSlug: "will-bitcoin-hit-60k-or-80k-first-965",
        title: "Will Bitcoin hit $60k or $80k first?",
        raw: {
          outcomes: [
            { label: "$60k", token_id: "sixty-token" },
            { label: "$80k", token_id: "eighty-token" }
          ]
        }
      }],
      generatedAt: "2026-05-06T00:00:00.000Z",
      metadataVersion: "polymarket-official-v1",
      source: "polymarket_official_api"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected enrichment");
    }
    expect(result.enrichment.normalizedPayload.quoteOutcomeTokenIds).toEqual({
      YES: "sixty-token",
      NO: "eighty-token"
    });
  });

  it("normalizes official Polymarket Gamma clobTokenIds into outcome token evidence", () => {
    expect(normalizeGammaMarketList({
      id: "948956",
      question: "Bitcoin all time high by June 30, 2026?",
      conditionId: market.conditionId,
      slug: "bitcoin-all-time-high-by-june-30-2026",
      outcomes: "[\"Yes\", \"No\"]",
      clobTokenIds: "[\"yes-token\", \"no-token\"]"
    })).toMatchObject([{
      conditionId: market.conditionId,
      marketSlug: "bitcoin-all-time-high-by-june-30-2026",
      title: "Bitcoin all time high by June 30, 2026?",
      raw: {
        outcomes: [
          { label: "Yes", token_id: "yes-token" },
          { label: "No", token_id: "no-token" }
        ]
      }
    }]);
  });
});
