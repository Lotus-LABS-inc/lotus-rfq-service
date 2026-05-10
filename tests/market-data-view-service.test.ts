import { describe, expect, it } from "vitest";
import { LiveMarketDataViewService } from "../src/services/market-data-view.service.js";

describe("LiveMarketDataViewService", () => {
  it("merges historical chart movement with the live point and inverts binary No history", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => ({
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-1",
            venueOutcomeId: "yes",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: now,
            receivedAt: now,
            bestBid: "0.70",
            bestAsk: "0.74",
            midpoint: "0.72",
            spread: "0.04",
            topOfBookSize: "100",
            bids: [{ price: "0.70", size: "100" }],
            asks: [{ price: "0.74", size: "100" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: []
        })
      },
      {
        now: () => now,
        historicalChartSource: {
          listChartPoints: async () => [
            { timestamp: new Date("2026-05-10T11:56:00.000Z"), venue: "POLYMARKET", value: "0.20" },
            { timestamp: new Date("2026-05-10T11:58:00.000Z"), venue: "POLYMARKET", value: "0.35" }
          ]
        }
      }
    );

    const chart = await service.getChart({
      marketId: "market-1",
      canonicalEventId: "event-1",
      venueMarketIds: ["poly-1"],
      outcomeId: "NO",
      outcomeLabel: "No",
      timeframe: "1H"
    });

    expect(chart.historyStatus).toBe("live");
    expect(chart.points.map((point) => point.unified)).toContain("0.8");
    expect(chart.points.map((point) => point.unified)).toContain("0.65");
    expect(chart.points.at(-1)?.unified).toBe("0.72");
  });
});
