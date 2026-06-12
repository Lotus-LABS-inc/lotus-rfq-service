import { describe, expect, it } from "vitest";
import { FlowSegmentationService } from "../src/core/rfq-engine/flow-segmentation.js";

describe("FlowSegmentationService", () => {
  const service = new FlowSegmentationService();

  it("scores objective soft flow deterministically", () => {
    const input = {
      canonicalMarketId: "POLITICS|NOMINEE|US_PRESIDENT|2028",
      canonicalEventId: "event-1",
      canonicalFamily: "NOMINEE",
      side: "buy" as const,
      quantity: "200",
      routingPath: "UI" as const,
      marketLiquidity: "1000",
      timestamp: new Date("2026-06-12T12:34:56.000Z")
    };

    const first = service.segment(input);
    const second = service.segment(input);

    expect(first.flowSegment).toBe("soft");
    expect(first.score).toBe(85);
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.reasonCodes).toContain("family:NOMINEE:+40");
  });

  it("falls back to standard when liquidity is missing and score stays below soft threshold", () => {
    const decision = service.segment({
      canonicalMarketId: "CRYPTO|ATH_BY_DATE|BTC|2026-06-30",
      canonicalEventId: "event-1",
      side: "sell",
      quantity: "5",
      routingPath: "API",
      marketLiquidity: null,
      timestamp: new Date("2026-06-12T12:00:00.000Z")
    });

    expect(decision.flowSegment).toBe("standard");
    expect(decision.reasonCodes).toContain("size:liquidity_unknown:0");
  });

  it("does not accept user identity as a segmentation input", () => {
    expect(Object.keys(service.segment({
      canonicalMarketId: "CRYPTO|FDV_LAUNCH|TOKEN",
      canonicalEventId: "event-1",
      side: "buy",
      quantity: "5",
      timestamp: new Date("2026-06-12T12:00:00.000Z")
    }))).not.toContain("takerId");
  });
});
