import { describe, expect, it } from "vitest";

import { buildPmLimitlessCryptoDateAlignedSeeds } from "../../src/operations/semantic-expansion/pm-limitless-crypto-date-aligned-expansion.js";
import type { ExactSeedDefinition } from "../../src/operations/semantic-expansion/exact-seed-shared.js";
import type { SemanticExpansionInventoryRow } from "../../src/operations/semantic-expansion/shared.js";

const buildInventoryRow = (input: {
  venue: "POLYMARKET" | "LIMITLESS";
  venueMarketId: string;
  title: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
}): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: `${input.venue}-${input.venueMarketId}`,
  canonicalEventId: input.canonicalEventId,
  canonicalMarketId: input.canonicalMarketId,
  currentExecutableMemberCount: 1,
  canonicalCategory: "CRYPTO",
  semanticCategory: "CRYPTO",
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: input.title,
  description: null,
  rules: null,
  marketType: null,
  marketClass: "BINARY",
  outcomes: [],
  outcomeSchema: {},
  topics: [],
  publishedAt: null,
  expiresAt: "2026-03-22T16:00:00.000Z",
  resolvesAt: null,
  fees: {},
  feeModel: null,
  resolutionSource: null,
  resolutionTitle: null,
  resolutionRulesText: null,
  resolutionAuthorityType: null,
  sourceHierarchy: {},
  disputeWindowHours: null,
  ambiguousTimeBoundary: false,
  ambiguousSourceReference: false,
  ambiguousJurisdictionOrScope: false,
  settlementType: null,
  settlementLagHours: null,
  finalityLagHours: null,
  payoutTimingHours: null,
  feeOnEntry: false,
  feeOnExit: false,
  timeSensitiveFeeBehavior: null,
  requiresConservativeAnchor: false,
  network: null,
  chain: null,
  rawSourcePayload: {},
  normalizedPayload: {},
  mappingLineage: [],
  confidenceScore: null,
  sourceMetadataVersion: "test",
  historicalRowCount: 0,
  latestHistoricalTimestamp: null,
  evidenceLabel: "live_inventory_only"
});

describe("buildPmLimitlessCryptoDateAlignedSeeds", () => {
  it("adds only same-asset same-family same-date same-cutoff crypto anchors", () => {
    const baselineSeeds: ExactSeedDefinition[] = [{
      seedReference: "baseline-btc-ath",
      canonicalEventId: "event-ath",
      canonicalMarketId: "market-ath",
      canonicalCategory: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?",
      sourceText: "Bitcoin all time high by March 31, 2026?",
      memberVenues: ["POLYMARKET", "LIMITLESS"],
      memberVenueMarketIds: ["LIMITLESS:ath-a", "POLYMARKET:ath-b"],
      targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION"],
      boundaryReferenceAt: "2026-03-31T23:59:59.000Z",
      exactDateSearch: null
    }];

    const pmRow = buildInventoryRow({
      venue: "POLYMARKET",
      venueMarketId: "pm-btc-0322",
      title: "Bitcoin Up or Down on March 22?",
      canonicalEventId: "event-0322",
      canonicalMarketId: null
    });
    const limitlessRow = buildInventoryRow({
      venue: "LIMITLESS",
      venueMarketId: "lm-btc-0322",
      title: "Bitcoin Up or Down on March 22?(12:00 ET)",
      canonicalEventId: "event-0322",
      canonicalMarketId: null
    });
    const pmWrongAsset = buildInventoryRow({
      venue: "POLYMARKET",
      venueMarketId: "pm-eth-0322",
      title: "Ethereum Up or Down on March 22?",
      canonicalEventId: "event-eth",
      canonicalMarketId: null
    });
    const limitlessWrongAsset = buildInventoryRow({
      venue: "LIMITLESS",
      venueMarketId: "lm-eth-0322",
      title: "Ethereum Up or Down on March 22?(12:00 ET)",
      canonicalEventId: "event-eth",
      canonicalMarketId: null
    });

    const result = buildPmLimitlessCryptoDateAlignedSeeds({
      baselineSeeds,
      matrix: {
        observedAt: new Date().toISOString(),
        metadataVersion: "test",
        scannedCryptoMarketCount: 1,
        countsByFamily: {
          ATH_BY_DATE: 0,
          THRESHOLD_BY_DATE: 0,
          SAME_DAY_DIRECTIONAL: 1,
          PRICE_AT_CLOSE: 0,
          GENERIC_UP_DOWN: 0
        },
        btcTargetableDates: [{
          family: "SAME_DAY_DIRECTIONAL",
          exactDate: "march 22 2026",
          cutoffStyle: "NOON_ET_DAILY",
          count: 1,
          representativeMarkets: [{ marketId: "10045", title: "Bitcoin Up or Down on March 22?(12:00 ET)" }]
        }],
        matrix: [{
          asset: "bitcoin",
          family: "SAME_DAY_DIRECTIONAL",
          exactDate: "march 22 2026",
          cutoffStyle: "NOON_ET_DAILY",
          count: 1,
          representativeMarkets: [{ marketId: "10045", title: "Bitcoin Up or Down on March 22?(12:00 ET)" }]
        }]
      },
      inventoryByKey: new Map([
        ["POLYMARKET:pm-btc-0322", pmRow],
        ["LIMITLESS:lm-btc-0322", limitlessRow],
        ["POLYMARKET:pm-eth-0322", pmWrongAsset],
        ["LIMITLESS:lm-eth-0322", limitlessWrongAsset]
      ]),
      matches: [
        {
          matchClass: "semantic_near_exact",
          category: "CRYPTO",
          venueSet: ["POLYMARKET", "LIMITLESS"],
          seed: { venue: "POLYMARKET", venueMarketId: "pm-btc-0322" },
          candidate: { venue: "LIMITLESS", venueMarketId: "lm-btc-0322" }
        },
        {
          matchClass: "semantic_near_exact",
          category: "CRYPTO",
          venueSet: ["POLYMARKET", "LIMITLESS"],
          seed: { venue: "POLYMARKET", venueMarketId: "pm-eth-0322" },
          candidate: { venue: "LIMITLESS", venueMarketId: "lm-eth-0322" }
        }
      ]
    });

    expect(result.summary.addedSeedCount).toBe(1);
    expect(result.summary.addedSeeds[0]?.asset).toBe("bitcoin");
    expect(result.summary.excludedCandidates[0]?.exclusionReason).toBe("wrong_asset");
  });
});
