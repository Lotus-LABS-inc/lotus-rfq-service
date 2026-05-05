import { describe, expect, it } from "vitest";
import { calculateVenueFeeQuote } from "../src/core/sor/venue-fees.js";
import { parsePolymarketFeeRate } from "../src/integrations/polymarket/polymarket-fee-reader.js";

describe("venue fee calculators", () => {
  it("calculates Polymarket protocol fees from venue fee rate", () => {
    const quote = calculateVenueFeeQuote({
      venue: "POLYMARKET",
      side: "buy",
      quantity: 100,
      price: 0.5,
      polymarketFeeRate: 0.072
    });

    expect(quote?.feeModel).toBe("POLYMARKET_PROTOCOL");
    expect(quote?.feeSource).toBe("VENUE_API");
    expect(Number(quote?.feeAmount)).toBeCloseTo(1.8);
    expect(quote?.effectiveFeeBps).toBeCloseTo(360);
  });

  it("calculates Limitless CLOB buy fee from the documented curve", () => {
    const quote = calculateVenueFeeQuote({
      venue: "LIMITLESS",
      side: "buy",
      quantity: 100,
      price: 0.7,
      limitlessMarketType: "clob"
    });

    expect(quote?.feeModel).toBe("LIMITLESS_CLOB_CURVE");
    expect(quote?.feeSource).toBe("DOC_RULESET");
    expect(quote?.effectiveFeeBps).toBeCloseTo(151);
    expect(Number(quote?.feeAmount)).toBeCloseTo(1.057);
  });

  it("calculates Limitless AMM flat fee", () => {
    const quote = calculateVenueFeeQuote({
      venue: "LIMITLESS",
      side: "sell",
      quantity: 50,
      price: 0.4,
      limitlessMarketType: "amm"
    });

    expect(quote?.feeModel).toBe("LIMITLESS_AMM_FLAT");
    expect(quote?.effectiveFeeBps).toBe(40);
    expect(Number(quote?.feeAmount)).toBeCloseTo(0.08);
  });

  it("parses Polymarket CLOB fee details", () => {
    expect(parsePolymarketFeeRate({ fd: { r: 720, e: 4 } })).toBe(0.072);
    expect(parsePolymarketFeeRate({ fd: { r: "0.03" } })).toBe(0.03);
    expect(parsePolymarketFeeRate({})).toBeNull();
  });
});
