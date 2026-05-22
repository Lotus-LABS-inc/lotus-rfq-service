import { describe, expect, it } from "vitest";

import {
  buildOpinionTokenEnrichment,
  extractOpinionQuoteIdentifier,
  opinionLookupCandidatesFromIdentifier,
  type OpinionQuoteProfileForEnrichment
} from "../src/core/sor/opinion-token-enrichment.js";
import type { OpinionNormalizedMarket } from "../src/integrations/opinion/opinion-types.js";

const profile = (overrides: Partial<OpinionQuoteProfileForEnrichment> = {}): OpinionQuoteProfileForEnrichment => ({
  profileId: "vmp-opinion",
  canonicalEventId: "event-1",
  canonicalMarketId: "FRONTEND_CURATED:NOMINEE|US_PRESIDENT|2028|REPUBLICAN|JD_VANCE",
  approvedVenueMarketId: "OPINION:493224:NOMINEE|US_PRESIDENT|2028|REPUBLICAN|JD_VANCE",
  title: "Republican Presidential Nominee 2028: Jd Vance",
  outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
  normalizedPayload: {},
  rawSourcePayload: {},
  ...overrides
});

const market = (overrides: Partial<OpinionNormalizedMarket> = {}): OpinionNormalizedMarket => ({
  venue: "OPINION",
  venueMarketId: "493224",
  title: "Republican Presidential Nominee 2028",
  slug: "republican-presidential-nominee-2028",
  marketType: 1,
  status: "Activated",
  statusCode: 2,
  labels: ["Politics"],
  rules: null,
  yesLabel: "Yes",
  noLabel: "No",
  yesTokenId: null,
  noTokenId: null,
  conditionId: null,
  resultTokenId: null,
  volume: null,
  volume24h: null,
  volume7d: null,
  quoteToken: "0xquote",
  chainId: "56",
  questionId: null,
  createdAt: null,
  cutoffAt: null,
  resolvedAt: null,
  childMarkets: [],
  sourceMetadataVersion: "opinion-openapi-v1",
  raw: {},
  ...overrides
});

describe("Opinion token enrichment", () => {
  it("extracts curated Opinion numeric ids from approved venue market ids", () => {
    expect(extractOpinionQuoteIdentifier(profile())).toBe("493224");
  });

  it("builds slug lookup candidates from slug-plus-outcome identifiers", () => {
    expect(opinionLookupCandidatesFromIdentifier("f1-world-drivers-champion-2026:lando-norris")).toEqual([
      "f1-world-drivers-champion-2026:lando-norris",
      "f1-world-drivers-champion-2026"
    ]);
  });

  it("enriches a binary Opinion market with executable YES and NO token ids", () => {
    const result = buildOpinionTokenEnrichment({
      profile: profile({ canonicalMarketId: "canonical" }),
      matchedIdentifier: "493246",
      generatedAt: "2026-05-22T00:00:00.000Z",
      metadataVersion: "opinion-openapi-v1",
      market: market({
        venueMarketId: "493246",
        title: "Will Trump acquire Greenland before 2027?",
        marketType: 0,
        yesTokenId: "yes-token",
        noTokenId: "no-token",
        conditionId: "condition-1",
        resultTokenId: "result-1"
      })
    });

    expect(result).toMatchObject({
      ok: true,
      enrichment: {
        quoteMarketId: "493246",
        quoteOutcomeTokenIds: { YES: "yes-token", NO: "no-token" }
      }
    });
    expect(result.ok ? result.enrichment.normalizedPayload : {}).toMatchObject({
      quoteMarketId: "493246",
      quoteTokenId: "yes-token",
      quoteOutcomeTokenIds: { YES: "yes-token", NO: "no-token" },
      quoteSource: "opinion_openapi_market_detail"
    });
  });

  it("selects the matching categorical child market by curated outcome label", () => {
    const result = buildOpinionTokenEnrichment({
      profile: profile(),
      matchedIdentifier: "493224",
      generatedAt: "2026-05-22T00:00:00.000Z",
      metadataVersion: "opinion-openapi-v1",
      market: market({
        childMarkets: [
          market({ venueMarketId: "493224-1", title: "Marco Rubio", yesTokenId: "rubio-yes", noTokenId: "rubio-no" }),
          market({ venueMarketId: "493224-2", title: "JD Vance", yesTokenId: "vance-yes", noTokenId: "vance-no" })
        ]
      })
    });

    expect(result).toMatchObject({
      ok: true,
      enrichment: {
        quoteMarketId: "493224-2",
        quoteOutcomeLabel: "JD Vance",
        quoteOutcomeTokenIds: { YES: "vance-yes", NO: "vance-no" }
      }
    });
  });

  it("fails closed when child market selection is ambiguous", () => {
    const result = buildOpinionTokenEnrichment({
      profile: profile({ canonicalMarketId: "canonical", title: "Republican Presidential Nominee 2028" }),
      matchedIdentifier: "493224",
      generatedAt: "2026-05-22T00:00:00.000Z",
      metadataVersion: "opinion-openapi-v1",
      market: market({
        childMarkets: [
          market({ venueMarketId: "1", title: "Candidate A", yesTokenId: "a-yes", noTokenId: "a-no" }),
          market({ venueMarketId: "2", title: "Candidate B", yesTokenId: "b-yes", noTokenId: "b-no" })
        ]
      })
    });

    expect(result).toEqual({
      ok: false,
      profileId: "vmp-opinion",
      matchedIdentifier: "493224",
      blockers: ["OPINION_EXECUTABLE_CHILD_MARKET_AMBIGUOUS"]
    });
  });

  it("keeps unresolved markets blocked when executable token ids are absent", () => {
    const result = buildOpinionTokenEnrichment({
      profile: profile({ canonicalMarketId: "canonical" }),
      matchedIdentifier: "493246",
      generatedAt: "2026-05-22T00:00:00.000Z",
      metadataVersion: "opinion-openapi-v1",
      market: market({ venueMarketId: "493246", marketType: 0 })
    });

    expect(result).toEqual({
      ok: false,
      profileId: "vmp-opinion",
      matchedIdentifier: "493246",
      blockers: ["OPINION_TOKEN_ID_MISSING"]
    });
  });
});
