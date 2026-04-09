import { describe, expect, it } from "vitest";

import { buildBtcAuditData, buildBtcRow } from "./btc-audit-test-fixtures.js";
import { buildLimitlessBtcDirectionalAlignmentMatrix } from "../../src/reports/limitless-btc-directional-alignment-matrix.js";
import type { LimitlessBtcDirectionalInventoryArtifact } from "../../src/reports/limitless-btc-directional-types.js";

const buildInventory = (overrides?: Partial<LimitlessBtcDirectionalInventoryArtifact>): LimitlessBtcDirectionalInventoryArtifact => ({
  observedAt: "2026-04-02T00:00:00.000Z",
  reachableSurfaceCount: 1,
  authenticatedEnrichmentAttempted: true,
  candidates: [],
  exclusions: [],
  ...overrides
});

describe("limitless btc directional alignment", () => {
  it("marks exact-safe alignment only when the Limitless candidate matches the full window", () => {
    const data = buildBtcAuditData({
      localRows: [
        buildBtcRow({
          venue: "POLYMARKET",
          venueMarketId: "pm-window",
          title: "BTC up or down on March 21",
          normalizedFamily: "SAME_DAY_DIRECTIONAL",
          threshold: null,
          comparator: "YES_NO_DIRECTIONAL",
          observationType: "SAME_DAY_DIRECTIONAL",
          binaryStructure: "UP_DOWN_BINARY",
          date: "2026-03-21",
          cutoffTimestamp: "2026-03-21T16:00:00.000Z",
          timezoneNormalizedCutoff: "2026-03-21T16:00:00.000Z"
        })
      ]
    });
    const inventory = buildInventory({
      candidates: [
        {
          venueMarketId: "lt-window",
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
    });

    const artifact = buildLimitlessBtcDirectionalAlignmentMatrix({
      btcAuditData: data,
      inventory
    });

    expect(artifact.rows[0]?.exactSafeComparable).toBe(true);
    expect(artifact.rows[0]?.matchedLimitlessMarketId).toBe("lt-window");
  });

  it("fails closed with a cutoff mismatch when only the day aligns", () => {
    const data = buildBtcAuditData({
      localRows: [
        buildBtcRow({
          venue: "OPINION",
          venueMarketId: "op-window",
          title: "Bitcoin up or down on March 21",
          normalizedFamily: "SAME_DAY_DIRECTIONAL",
          threshold: null,
          comparator: "YES_NO_DIRECTIONAL",
          observationType: "SAME_DAY_DIRECTIONAL",
          binaryStructure: "UP_DOWN_BINARY",
          date: "2026-03-21",
          cutoffTimestamp: "2026-03-21T16:00:00.000Z",
          timezoneNormalizedCutoff: "2026-03-21T16:00:00.000Z"
        })
      ]
    });
    const inventory = buildInventory({
      candidates: [
        {
          venueMarketId: "lt-mismatch",
          rawTitle: "Bitcoin higher or lower on March 21",
          normalizedTitle: "bitcoin higher or lower on march 21",
          asset: "BTC",
          family: "SAME_DAY_DIRECTIONAL",
          familyConfidence: "1",
          comparator: "YES_NO_DIRECTIONAL",
          date: "2026-03-21",
          cutoffTimestamp: "2026-03-21T18:00:00.000Z",
          timezoneNormalizedCutoff: "2026-03-21T18:00:00.000Z",
          bucketGranularity: "DAY",
          observationType: "SAME_DAY_DIRECTIONAL",
          binaryStructure: "UP_DOWN_BINARY",
          sourceSurfaces: ["limitless-live-market-loader"],
          discoveryTimestamp: "2026-04-02T00:00:00.000Z",
          currentlyActive: true,
          ambiguityFlags: []
        }
      ]
    });

    const artifact = buildLimitlessBtcDirectionalAlignmentMatrix({
      btcAuditData: data,
      inventory
    });

    expect(artifact.rows[0]?.exactSafeComparable).toBe(false);
    expect(artifact.rows[0]?.blocker).toBe("CUTOFF_MISMATCH");
  });
});
