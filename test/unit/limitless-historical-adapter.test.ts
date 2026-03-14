import { describe, expect, it, vi } from "vitest"

import { LimitlessHistoricalAdapter } from "../../src/integrations/limitless/limitless-historical-adapter.js"

describe("LimitlessHistoricalAdapter", () => {
  it("normalizes market metadata", async () => {
    const adapter = new LimitlessHistoricalAdapter({
      metadataVersion: "limitless-v1",
      client: {
        getMarketDetail: vi.fn(async () => ({
          address: "0x1234",
          slug: "btc-above-100k",
          title: "BTC above 100k?",
          status: "FUNDED",
          tradeType: "clob",
          marketType: "single",
          volume: "1250000",
          openInterest: "920000",
          liquidity: "500000",
          venue: {
            exchange: "0xExchange",
            adapter: "0xAdapter"
          }
        }))
      } as never
    })

    const result = await adapter.getHistoricalMarket("btc-above-100k")

    expect(result).toEqual(
      expect.objectContaining({
        address: "0x1234",
        slug: "btc-above-100k",
        tradeType: "clob",
        volume: "1250000",
        venue: expect.objectContaining({ exchange: "0xExchange" })
      })
    )
  })

  it("normalizes historical price into fragments", async () => {
    const adapter = new LimitlessHistoricalAdapter({
      metadataVersion: "limitless-v1",
      client: {
        getHistoricalPrice: vi.fn(async () => [
          {
            title: "YES",
            prices: [{ price: 0.62, timestamp: "2024-01-10T00:00:00Z" }]
          }
        ])
      } as never
    })

    const result = await adapter.buildHistoricalPriceFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "btc-above-100k" },
      { slug: "btc-above-100k", interval: "1d" }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        canonicalEventId: "canonical-event-1",
        venue: "LIMITLESS",
        venueMarketId: "btc-above-100k",
        metadataVersion: "limitless-v1",
        lastPrice: "0.62"
      })
    )
    expect(result[0]?.candles).toEqual(
      expect.objectContaining({
        title: "YES"
      })
    )
  })

  it("normalizes market events into fragments", async () => {
    const adapter = new LimitlessHistoricalAdapter({
      metadataVersion: "limitless-v1",
      client: {
        getMarketEvents: vi.fn(async () => ({
          events: [
            {
              id: "event-1",
              type: "NEW_TRADE",
              timestamp: "2024-01-10T00:00:00Z",
              data: { price: 0.58, side: "buy" }
            }
          ]
        }))
      } as never
    })

    const result = await adapter.buildMarketEventFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "btc-above-100k" },
      { slug: "btc-above-100k", page: 1, limit: 10 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        lastPrice: "0.58"
      })
    )
    expect(result[0]?.marketEvents).toEqual(expect.objectContaining({ type: "NEW_TRADE" }))
  })

  it("normalizes portfolio history into own execution fragments", async () => {
    const adapter = new LimitlessHistoricalAdapter({
      metadataVersion: "limitless-v1",
      client: {
        getPortfolioHistory: vi.fn(async () => ({
          data: [
            {
              blockTimestamp: 1710000000,
              collateralAmount: "125",
              market: {
                slug: "btc-above-100k",
                title: "BTC above 100k?"
              },
              outcomeTokenAmount: "250",
              outcomeTokenAmounts: ["250", "0"],
              outcomeIndex: 0,
              outcomeTokenPrice: 0.5,
              strategy: "Buy"
            }
          ],
          totalCount: 1
        }))
      } as never
    })

    const result = await adapter.buildPortfolioHistoryFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "btc-above-100k" },
      { page: 1, limit: 10 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        lastPrice: "0.5",
        volume: "125"
      })
    )
    expect(result[0]?.ownExecutionHistory).toEqual(expect.objectContaining({ strategy: "Buy" }))
  })

  it("fails closed on malformed payload behavior surfaced by client validation", async () => {
    const adapter = new LimitlessHistoricalAdapter({
      metadataVersion: "limitless-v1",
      client: {
        getMarketDetail: vi.fn(async () => {
          throw new Error("payload validation failed")
        })
      } as never
    })

    await expect(adapter.getHistoricalMarket("btc-above-100k")).rejects.toThrow("payload validation failed")
  })
})
