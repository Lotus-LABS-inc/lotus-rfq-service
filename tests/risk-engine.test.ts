import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { RiskEngine } from "../src/core/risk-engine.js";

describe("RiskEngine", () => {
  it("checks market exposure with text comparison for catalog canonical ids", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [{ total_gross: "0" }] };
      }),
      release: vi.fn()
    };
    const pool = {
      connect: vi.fn(async () => client)
    };
    const riskEngine = new RiskEngine(
      {} as never,
      { getRollingExposure: vi.fn(async () => 0) } as never,
      { fetchMarketById: vi.fn(async () => ({ id: "market", isActive: true })) } as never,
      pool as never,
      {
        userNotionalCap: 10000,
        marketNotionalCap: 10000,
        lpNotionalCap: 10000,
        globalNotionalCap: 10000,
        maxOrderNotional: 10000
      },
      pino({ level: "silent" })
    );

    await expect(
      riskEngine.validateRFQCreation({
        taker_id: "11111111-1111-1111-1111-111111111111",
        canonical_market_id: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|ETH|2026-06-30:POLYMARKET",
        side: "buy",
        quantity: "1"
      })
    ).resolves.toBeUndefined();

    expect(queries.some((sql) => sql.includes("canonical_market_id::text = $1"))).toBe(true);
  });
});
