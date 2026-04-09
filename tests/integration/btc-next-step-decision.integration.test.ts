import { describe, expect, it } from "vitest";

import { buildBtcNextStepDecision } from "../../src/reports/btc-next-step-decision.js";
import type { BtcFamilyConvergenceSummary, BtcMissingEdgeRootCauseSummary } from "../../src/reports/btc-audit-types.js";
import type { CryptoPairRouteabilitySummary } from "../../src/reports/crypto-pair-routeability-summary.js";

describe("btc next step decision", () => {
  it("stays inventory blocked when upstream scarcity dominates and no tri path exists", () => {
    const familySummary: BtcFamilyConvergenceSummary = {
      observedAt: "2026-04-02T00:00:00Z",
      sourceCryptoMarketCount: 46,
      btcEligibleMarketCount: 20,
      selectedFamily: "SAME_DAY_DIRECTIONAL",
      selectionRationale: "fixture",
      families: []
    };
    const rootCauseSummary: BtcMissingEdgeRootCauseSummary = {
      observedAt: "2026-04-02T00:00:00Z",
      dominantRootCause: "UPSTREAM_INVENTORY_MISSING",
      countsByRootCause: {
        UPSTREAM_INVENTORY_MISSING: 8,
        INGESTION_MISSING: 1,
        NORMALIZATION_MISSING: 0,
        TRUE_STRUCTURE_MISMATCH: 3
      },
      entries: []
    };
    const routeability: CryptoPairRouteabilitySummary = {
      observedAt: "2026-04-02T00:00:00Z",
      matchingVersionId: "fixture",
      sourceCryptoMarketCount: 46,
      btcEligibleStructuralMarketCount: 20,
      pairEdgeCount: 2,
      routeablePairsByFamily: {
        ATH_BY_DATE: 1,
        SAME_DAY_DIRECTIONAL: 1
      },
      routeablePairsByVenuePair: {
        LIMITLESS_POLYMARKET: 1,
        OPINION_POLYMARKET: 1
      },
      labelDistribution: {
        EXACT: 2
      },
      exactSafeApprovedCount: 2,
      triCapableFamilies: [],
      blockerReasons: {},
      mismatchDistributions: {
        dateBoundaryMismatch: 0,
        cutoffMismatch: 0,
        thresholdStructureMismatch: 0,
        familyMismatch: 0
      }
    };

    const decision = buildBtcNextStepDecision({
      familySummary,
      rootCauseSummary,
      routeability
    });

    expect(decision.decision).toBe("BTC_MATCHER_READY__INVENTORY_BLOCKED");
    expect(decision.limitlessOpinionExactPath).toBe(false);
    expect(decision.triCapableFamily).toBeNull();
  });
});
