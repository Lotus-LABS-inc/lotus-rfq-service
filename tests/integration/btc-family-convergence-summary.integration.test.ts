import { describe, expect, it } from "vitest";

import { buildBtcFamilyConvergenceSummary } from "../../src/reports/btc-family-convergence-summary.js";
import { buildBtcAuditData, buildBtcRow, buildPairEdge } from "./btc-audit-test-fixtures.js";

describe("btc family convergence summary", () => {
  it("selects SAME_DAY_DIRECTIONAL when it has the best exact-safe and remote tri convergence signal", () => {
    const data = buildBtcAuditData({
      localRows: [
        buildBtcRow({
          venue: "POLYMARKET",
          venueMarketId: "pm-sdd",
          title: "BTC up or down on March 21",
          normalizedFamily: "SAME_DAY_DIRECTIONAL",
          comparator: "UP",
          threshold: null,
          observationType: "SAME_DAY_DIRECTIONAL"
        }),
        buildBtcRow({
          venue: "OPINION",
          venueMarketId: "op-sdd",
          title: "Bitcoin up or down on March 21",
          normalizedFamily: "SAME_DAY_DIRECTIONAL",
          comparator: "UP",
          threshold: null,
          observationType: "SAME_DAY_DIRECTIONAL"
        }),
        buildBtcRow({
          venue: "POLYMARKET",
          venueMarketId: "pm-threshold",
          title: "BTC above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE"
        })
      ],
      remoteRows: [
        buildBtcRow({
          source: "REMOTE_AUDIT",
          venue: "LIMITLESS",
          venueMarketId: "lt-sdd",
          title: "Bitcoin higher or lower on March 21",
          normalizedFamily: "SAME_DAY_DIRECTIONAL",
          comparator: "UP",
          threshold: null,
          observationType: "SAME_DAY_DIRECTIONAL"
        })
      ],
      pairEdges: [
        buildPairEdge({
          id: "edge-sdd",
          family: "SAME_DAY_DIRECTIONAL",
          leftVenue: "POLYMARKET",
          rightVenue: "OPINION"
        })
      ]
    });

    const summary = buildBtcFamilyConvergenceSummary(data);

    expect(summary.selectedFamily).toBe("SAME_DAY_DIRECTIONAL");
    expect(summary.families.find((entry) => entry.family === "SAME_DAY_DIRECTIONAL")?.likelyTriViability)
      .toBe("REMOTE_TRI_WINDOW_PRESENT");
  });
});
