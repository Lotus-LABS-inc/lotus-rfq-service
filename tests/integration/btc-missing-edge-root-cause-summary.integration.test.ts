import { describe, expect, it } from "vitest";

import { buildBtcMissingEdgeRootCauseSummary } from "../../src/reports/btc-missing-edge-root-cause-summary.js";
import { buildBtcAuditData, buildBtcRow } from "./btc-audit-test-fixtures.js";

describe("btc missing edge root cause summary", () => {
  it("classifies missing remote exact counterparts as ingestion gaps when local inventory is missing the venue market", () => {
    const data = buildBtcAuditData({
      localRows: [
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
          venue: "POLYMARKET",
          venueMarketId: "pm-threshold",
          title: "BTC above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE"
        }),
        buildBtcRow({
          source: "REMOTE_AUDIT",
          venue: "LIMITLESS",
          venueMarketId: "lt-threshold",
          title: "Bitcoin above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE"
        })
      ]
    });

    const summary = buildBtcMissingEdgeRootCauseSummary(data);
    const entry = summary.entries.find((item) =>
      item.family === "THRESHOLD_BY_DATE" && item.venuePair === "LIMITLESS_POLYMARKET"
    );

    expect(entry?.rootCause).toBe("INGESTION_MISSING");
  });

  it("classifies present-but-misaligned exact counterparts as normalization gaps", () => {
    const data = buildBtcAuditData({
      localRows: [
        buildBtcRow({
          venue: "POLYMARKET",
          venueMarketId: "pm-threshold",
          title: "BTC above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE"
        }),
        buildBtcRow({
          venue: "LIMITLESS",
          venueMarketId: "lt-threshold",
          title: "Bitcoin above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE",
          structuralEligibilityStatus: "STRUCTURAL_REJECTED",
          structuralRejectionReasons: ["missing_time_boundary"],
          exactWindowKey: null
        })
      ],
      remoteRows: [
        buildBtcRow({
          source: "REMOTE_AUDIT",
          venue: "POLYMARKET",
          venueMarketId: "pm-threshold",
          title: "BTC above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE"
        }),
        buildBtcRow({
          source: "REMOTE_AUDIT",
          venue: "LIMITLESS",
          venueMarketId: "lt-threshold",
          title: "Bitcoin above 100k by March 31",
          normalizedFamily: "THRESHOLD_BY_DATE"
        })
      ]
    });

    const summary = buildBtcMissingEdgeRootCauseSummary(data);
    const entry = summary.entries.find((item) =>
      item.family === "THRESHOLD_BY_DATE" && item.venuePair === "LIMITLESS_POLYMARKET"
    );

    expect(entry?.rootCause).toBe("NORMALIZATION_MISSING");
  });
});
