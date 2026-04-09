import { describe, expect, it, vi, afterEach } from "vitest";

import { OpinionClient } from "../../src/integrations/opinion/opinion-client.js";
import { PredexonHistoricalClient } from "../../src/integrations/predexon/predexon-client.js";
import { runOpinionHistoricalRecovery } from "../../src/integrations/opinion/opinion-historical-market-loader.js";

describe("opinion historical market loader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers targeted crypto historical snapshots without rewriting the current-state path", async () => {
    vi.spyOn(OpinionClient.prototype, "listMarkets").mockResolvedValue([
      {
        marketId: "10045",
        marketTitle: "Bitcoin Up or Down on March 22? (12:00 ET)",
        slug: "btc-up-down-mar-22",
        statusEnum: "ACTIVATED",
        status: 2,
        labels: ["CRYPTO"],
        rules: "BTC daily directional market",
        createdAt: new Date("2026-03-21T00:00:00.000Z").toISOString(),
        cutoffAt: new Date("2026-03-22T16:00:00.000Z").toISOString()
      }
    ]);
    vi.spyOn(PredexonHistoricalClient.prototype, "getOpinionOrderbookHistory").mockResolvedValue([
      {
        timestamp: new Date("2026-03-21T12:00:00.000Z").toISOString(),
        best_bid: "0.49",
        best_ask: "0.51",
        adjusted_midpoint: "0.50"
      } as never
    ]);

    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM venue_market_profiles")) {
          return {
            rows: [{
              venue_market_id: "10045",
              canonical_event_id: "event-1",
              canonical_market_id: "market-1"
            }]
          };
        }
        if (sql.includes("INSERT INTO historical_market_states")) {
          return { rowCount: 1, rows: [{ id: "state-1" }] };
        }
        return { rows: [], rowCount: 0 };
      })
    } as never;

    const summary = await runOpinionHistoricalRecovery({
      repoRoot: process.cwd(),
      pool,
      opinionBaseUrl: "https://openapi.opinion.trade/openapi",
      opinionApiKey: "test-key",
      predexonBaseUrl: "https://api.predexon.com",
      predexonApiKey: "predexon-test",
      maxPages: 1,
      maxPerFamily: 2
    });

    expect(summary.targetedMarkets).toBe(1);
    expect(summary.recoveredHistoricalMarkets).toBe(1);
    expect(summary.insertedStates).toBe(1);
    expect(summary.missingHistory).toHaveLength(0);
    expect(queries.some((query) => query.includes("INSERT INTO historical_market_states"))).toBe(true);
  });
});
