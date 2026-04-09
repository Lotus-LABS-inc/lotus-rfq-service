import { describe, expect, it } from "vitest";

import {
  buildLimitlessBtcDirectionalDecisionArtifact,
  buildLimitlessBtcDirectionalSourceHygieneSummary
} from "../../src/reports/limitless-btc-directional-decision.js";
import type {
  LimitlessBtcDirectionalAlignmentMatrix,
  LimitlessBtcDirectionalInventoryArtifact
} from "../../src/reports/limitless-btc-directional-types.js";

const emptyAlignment = (overrides?: Partial<LimitlessBtcDirectionalAlignmentMatrix>): LimitlessBtcDirectionalAlignmentMatrix => ({
  observedAt: "2026-04-02T00:00:00.000Z",
  knownWindows: [],
  limitlessCandidateCount: 0,
  rows: [],
  ...overrides
});

const emptyInventory = (overrides?: Partial<LimitlessBtcDirectionalInventoryArtifact>): LimitlessBtcDirectionalInventoryArtifact => ({
  observedAt: "2026-04-02T00:00:00.000Z",
  reachableSurfaceCount: 1,
  authenticatedEnrichmentAttempted: false,
  candidates: [],
  exclusions: [],
  ...overrides
});

describe("limitless btc directional decision", () => {
  it("chooses adapter-next when an exact-safe counterpart exists", () => {
    const artifact = buildLimitlessBtcDirectionalDecisionArtifact({
      inventory: emptyInventory({
        authenticatedEnrichmentAttempted: true,
        candidates: [
          {
            venueMarketId: "lt-1",
            rawTitle: "Bitcoin higher or lower on March 21",
            normalizedTitle: "bitcoin higher or lower on march 21",
            asset: "BTC",
            family: "SAME_DAY_DIRECTIONAL",
            familyConfidence: "1",
            comparator: "YES_NO_DIRECTIONAL",
            date: "2026-03-21",
            cutoffTimestamp: "2026-03-21T16:00:00.000Z",
            timezoneNormalizedCutoff: "2026-03-21T16:00:00.000Z",
            bucketGranularity: "DAY",
            observationType: "SAME_DAY_DIRECTIONAL",
            binaryStructure: "UP_DOWN_BINARY",
            sourceSurfaces: ["limitless-live-market-loader"],
            discoveryTimestamp: "2026-04-02T00:00:00.000Z",
            currentlyActive: true,
            ambiguityFlags: []
          }
        ]
      }),
      alignment: emptyAlignment({
        limitlessCandidateCount: 1,
        rows: [
          {
            knownWindow: {
              venue: "POLYMARKET",
              venueMarketId: "pm-1",
              title: "BTC up or down on March 21",
              exactWindowKey: "key",
              date: "2026-03-21",
              cutoffTimestamp: "2026-03-21T16:00:00.000Z",
              timezoneNormalizedCutoff: "2026-03-21T16:00:00.000Z",
              bucketGranularity: "DAY",
              observationType: "SAME_DAY_DIRECTIONAL",
              binaryStructure: "UP_DOWN_BINARY"
            },
            blocker: "NO_LIMITLESS_COUNTERPART",
            exactSafeComparable: true,
            matchedLimitlessMarketId: "lt-1",
            rationale: "exact"
          }
        ]
      })
    });

    expect(artifact.decision).toBe("LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__INGESTION_ADAPTER_NEXT");
  });

  it("chooses not-proven when authenticated enrichment is unavailable", () => {
    const artifact = buildLimitlessBtcDirectionalDecisionArtifact({
      inventory: emptyInventory(),
      alignment: emptyAlignment()
    });

    expect(artifact.decision).toBe("LIMITLESS_BTC_DIRECTIONAL_INVENTORY_NOT_PROVEN_ON_CURRENT_SURFACES");
  });

  it("summarizes source hygiene rejection reasons", () => {
    const artifact = buildLimitlessBtcDirectionalSourceHygieneSummary(emptyInventory({
      exclusions: [
        {
          surface: "limitless-live-market-loader",
          venueMarketId: "row-1",
          title: "Sports row",
          reasons: ["missing_btc_signal", "bad_crypto_row"]
        }
      ]
    }));

    expect(artifact.reasons["missing_btc_signal"]).toBe(1);
    expect(artifact.earlyFilterTighteningRecommended).toBe(true);
  });
});
