import { describe, expect, it } from "vitest";
import type { CreateTradeInput, Trade } from "../../src/core/internal-engine/types.js";

describe("internal trade types", () => {
  it("accepts string or number values when creating a trade payload", () => {
    const asString: CreateTradeInput = {
      market_id: "market-1",
      buy_order_id: "buy-order-1",
      sell_order_id: "sell-order-1",
      price: "1.2345",
      size: "50"
    };

    const asNumber: CreateTradeInput = {
      market_id: "market-1",
      buy_order_id: "buy-order-2",
      sell_order_id: "sell-order-2",
      price: 1.2345,
      size: 50
    };

    expect(asString.price).toBeTypeOf("string");
    expect(asString.size).toBeTypeOf("string");
    expect(asNumber.price).toBeTypeOf("number");
    expect(asNumber.size).toBeTypeOf("number");
  });

  it("represents persisted numeric values as strings", () => {
    const trade: Trade = {
      id: "trade-1",
      market_id: "market-1",
      buy_order_id: "buy-order-1",
      sell_order_id: "sell-order-1",
      price: "1.2345",
      size: "50",
      created_at: new Date()
    };

    expect(trade.price).toBeTypeOf("string");
    expect(trade.size).toBeTypeOf("string");
    expect(trade.created_at).toBeInstanceOf(Date);
  });
});
