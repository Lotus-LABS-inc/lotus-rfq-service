import { describe, expect, it } from "vitest";

import { CryptoMatchingPipeline } from "../../src/matching/crypto/crypto-matching-pipeline.js";
import { cryptoScopedAssetValues } from "../../src/matching/crypto/crypto-match-labels.js";
import { buildCryptoMultiAssetExpansionArtifactsFromResult } from "../../src/reports/crypto-multi-asset-expansion.js";
import { InMemoryCryptoRepository } from "./crypto-test-harness.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

const baseline = (overrides?: Partial<{
  sourceCryptoMarketCount: number;
  btcMarketCount: number;
  pairEdgeCount: number;
  exactSafeApprovedCount: number;
  routeablePairsByFamily: Record<string, number>;
  routeablePairsByVenuePair: Record<string, number>;
  blockerReasons: Record<string, number>;
}>): {
  matchingQuality: {
    observedAt: string;
    matchingVersionId: string;
    sourceCryptoMarketCount: number;
    btcMarketCount: number;
    pairEdgeCount: number;
    labels: Record<string, number>;
    families: Record<string, number>;
    venuePairs: Record<string, number>;
    blockerReasons: Record<string, number>;
    structuralLaneRejections: Record<string, number>;
  };
  routeability: {
    observedAt: string;
    matchingVersionId: string;
    sourceCryptoMarketCount: number;
    btcEligibleStructuralMarketCount: number;
    pairEdgeCount: number;
    routeablePairsByFamily: Record<string, number>;
    routeablePairsByVenuePair: Record<string, number>;
    labelDistribution: Record<string, number>;
    exactSafeApprovedCount: number;
    triCapableFamilies: readonly string[];
    blockerReasons: Record<string, number>;
    mismatchDistributions: {
      dateBoundaryMismatch: number;
      cutoffMismatch: number;
      thresholdStructureMismatch: number;
      familyMismatch: number;
    };
  };
} => ({
  matchingQuality: {
    observedAt: "2026-04-02T00:00:00.000Z",
    matchingVersionId: "baseline",
    sourceCryptoMarketCount: overrides?.sourceCryptoMarketCount ?? 46,
    btcMarketCount: overrides?.btcMarketCount ?? 20,
    pairEdgeCount: overrides?.pairEdgeCount ?? 2,
    labels: {},
    families: {},
    venuePairs: {},
    blockerReasons: overrides?.blockerReasons ?? {},
    structuralLaneRejections: {}
  },
  routeability: {
    observedAt: "2026-04-02T00:00:00.000Z",
    matchingVersionId: "baseline",
    sourceCryptoMarketCount: overrides?.sourceCryptoMarketCount ?? 46,
    btcEligibleStructuralMarketCount: overrides?.btcMarketCount ?? 20,
    pairEdgeCount: overrides?.pairEdgeCount ?? 2,
    routeablePairsByFamily: overrides?.routeablePairsByFamily ?? { ATH_BY_DATE: 1, SAME_DAY_DIRECTIONAL: 1 },
    routeablePairsByVenuePair: overrides?.routeablePairsByVenuePair ?? { LIMITLESS_POLYMARKET: 1, OPINION_POLYMARKET: 1 },
    labelDistribution: {},
    exactSafeApprovedCount: overrides?.exactSafeApprovedCount ?? 2,
    triCapableFamilies: [],
    blockerReasons: overrides?.blockerReasons ?? {},
    mismatchDistributions: {
      dateBoundaryMismatch: 0,
      cutoffMismatch: 0,
      thresholdStructureMismatch: 0,
      familyMismatch: 0
    }
  }
});

describe("crypto multi-asset expansion", () => {
  it("admits BTC, ETH, and SOL while rejecting non-target assets and bad crypto rows", async () => {
    const repository = new InMemoryCryptoRepository([
      buildMatchingMarket({
        interpretedContractId: "btc-ath-pm",
        venue: "POLYMARKET",
        venueMarketId: "btc-ath-pm",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31, 2026?"
      }),
      buildMatchingMarket({
        interpretedContractId: "eth-sdd-pm",
        venue: "POLYMARKET",
        venueMarketId: "eth-sdd-pm",
        category: "CRYPTO",
        title: "Ethereum Up or Down on March 21?(12:00 ET)"
      }),
      buildMatchingMarket({
        interpretedContractId: "sol-th-lt",
        venue: "LIMITLESS",
        venueMarketId: "sol-th-lt",
        category: "CRYPTO",
        title: "SOL above $200 on March 31, 2026 16:00 UTC?"
      }),
      buildMatchingMarket({
        interpretedContractId: "doge-sdd",
        venue: "OPINION",
        venueMarketId: "doge-sdd",
        category: "CRYPTO",
        title: "Dogecoin Up or Down on March 21?(12:00 ET)"
      }),
      buildMatchingMarket({
        interpretedContractId: "bad-row",
        venue: "LIMITLESS",
        venueMarketId: "bad-row",
        category: "CRYPTO",
        title: "Will Arsenal win tonight?"
      })
    ]);

    const result = await new CryptoMatchingPipeline(repository, {
      allowedAssets: cryptoScopedAssetValues,
      allowedFamilies: ["SAME_DAY_DIRECTIONAL", "ATH_BY_DATE", "THRESHOLD_BY_DATE"]
    }).run();
    const artifacts = buildCryptoMultiAssetExpansionArtifactsFromResult({
      result,
      baseline: baseline()
    });

    expect(artifacts.scopeActivation.admittedCountsByAsset["BTC"]).toBe(1);
    expect(artifacts.scopeActivation.admittedCountsByAsset["ETH"]).toBe(1);
    expect(artifacts.scopeActivation.admittedCountsByAsset["SOL"]).toBe(1);
    expect(artifacts.scopeActivation.excludedCountsByReason["NON_TARGET_ASSET"]).toBeGreaterThanOrEqual(1);
    expect(artifacts.scopeActivation.excludedCountsByReason["BAD_CRYPTO_ROW"]).toBeGreaterThanOrEqual(1);
  });

  it("emits a success decision when ETH and SOL materially lift exact-safe edge density", async () => {
    const repository = new InMemoryCryptoRepository([
      buildMatchingMarket({
        interpretedContractId: "btc-ath-pm",
        venue: "POLYMARKET",
        venueMarketId: "btc-ath-pm",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31, 2026?"
      }),
      buildMatchingMarket({
        interpretedContractId: "btc-ath-lt",
        venue: "LIMITLESS",
        venueMarketId: "btc-ath-lt",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31?"
      }),
      buildMatchingMarket({
        interpretedContractId: "eth-sdd-pm",
        venue: "POLYMARKET",
        venueMarketId: "eth-sdd-pm",
        category: "CRYPTO",
        title: "Ethereum Up or Down on March 21?(12:00 ET)"
      }),
      buildMatchingMarket({
        interpretedContractId: "eth-sdd-lt",
        venue: "LIMITLESS",
        venueMarketId: "eth-sdd-lt",
        category: "CRYPTO",
        title: "Ethereum higher or lower on March 21?(12:00 ET)"
      }),
      buildMatchingMarket({
        interpretedContractId: "eth-sdd-op",
        venue: "OPINION",
        venueMarketId: "eth-sdd-op",
        category: "CRYPTO",
        title: "Ethereum Up or Down on March 21?(12:00 ET)"
      }),
      buildMatchingMarket({
        interpretedContractId: "sol-th-pm",
        venue: "POLYMARKET",
        venueMarketId: "sol-th-pm",
        category: "CRYPTO",
        title: "SOL above $200 on March 31, 2026 16:00 UTC?"
      }),
      buildMatchingMarket({
        interpretedContractId: "sol-th-lt",
        venue: "LIMITLESS",
        venueMarketId: "sol-th-lt",
        category: "CRYPTO",
        title: "SOL above $200 on March 31, 2026 16:00 UTC?"
      })
    ]);

    const result = await new CryptoMatchingPipeline(repository, {
      allowedAssets: cryptoScopedAssetValues,
      allowedFamilies: ["SAME_DAY_DIRECTIONAL", "ATH_BY_DATE", "THRESHOLD_BY_DATE"]
    }).run();
    const artifacts = buildCryptoMultiAssetExpansionArtifactsFromResult({
      result,
      baseline: baseline({
        sourceCryptoMarketCount: 7,
        btcMarketCount: 2,
        pairEdgeCount: 2,
        exactSafeApprovedCount: 2
      })
    });

    expect(artifacts.pairRouteabilitySummary.exactSafePairsByAsset["ETH"]).toBe(3);
    expect(artifacts.pairRouteabilitySummary.exactSafePairsByAsset["SOL"]).toBe(1);
    expect(artifacts.decision.decision).toBe("CRYPTO_EXPANSION_SUCCESS__STAY_IN_CRYPTO");
  });

  it("emits a flat decision when the scoped expansion adds no new exact-safe edges", async () => {
    const repository = new InMemoryCryptoRepository([
      buildMatchingMarket({
        interpretedContractId: "btc-ath-pm",
        venue: "POLYMARKET",
        venueMarketId: "btc-ath-pm",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31, 2026?"
      }),
      buildMatchingMarket({
        interpretedContractId: "btc-ath-lt",
        venue: "LIMITLESS",
        venueMarketId: "btc-ath-lt",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31?"
      }),
      buildMatchingMarket({
        interpretedContractId: "eth-sdd-pm",
        venue: "POLYMARKET",
        venueMarketId: "eth-sdd-pm",
        category: "CRYPTO",
        title: "Ethereum Up or Down on March 21?(12:00 ET)"
      }),
      buildMatchingMarket({
        interpretedContractId: "eth-sdd-op",
        venue: "OPINION",
        venueMarketId: "eth-sdd-op",
        category: "CRYPTO",
        title: "Ethereum Up or Down on March 21?(16:00 ET)"
      })
    ]);

    const result = await new CryptoMatchingPipeline(repository, {
      allowedAssets: cryptoScopedAssetValues,
      allowedFamilies: ["SAME_DAY_DIRECTIONAL", "ATH_BY_DATE", "THRESHOLD_BY_DATE"]
    }).run();
    const artifacts = buildCryptoMultiAssetExpansionArtifactsFromResult({
      result,
      baseline: baseline({
        sourceCryptoMarketCount: 4,
        btcMarketCount: 4,
        pairEdgeCount: 1,
        exactSafeApprovedCount: 1,
        routeablePairsByFamily: { ATH_BY_DATE: 1 },
        routeablePairsByVenuePair: { LIMITLESS_POLYMARKET: 1 }
      })
    });

    expect(artifacts.pairRouteabilitySummary.exactSafeApprovedCount).toBe(1);
    expect(artifacts.decision.decision).toBe("CRYPTO_EXPANSION_FLAT__PIVOT_TO_SPORTS");
  });
});
