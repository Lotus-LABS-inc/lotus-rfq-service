import { describe, expect, it, vi } from "vitest"

import { PredexonHistoricalAdapter } from "../../src/integrations/predexon/predexon-historical-adapter.js"

describe("PredexonHistoricalAdapter", () => {
  it("normalizes market discovery metadata", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        listMarkets: vi.fn(async () => [
          {
            market_id: "market-1",
            condition_id: "condition-1",
            title: "Will BTC close above 100k?",
            event_id: "event-1",
            event_slug: "btc-above-100k",
            token_ids: ["yes-1", "no-1"],
            status: "open",
            volume: 12345,
            liquidity: 6789
          }
        ])
      } as never
    })

    const result = await adapter.listHistoricalMarkets()

    expect(result).toEqual([
      expect.objectContaining({
        marketId: "market-1",
        conditionId: "condition-1",
        eventId: "event-1",
        tokenIds: ["yes-1", "no-1"],
        volume: "12345",
        liquidity: "6789"
      })
    ])
  })

  it("normalizes candles into historical market state fragments", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        getCandlesticks: vi.fn(async () => [
          {
            timestamp: 1710000000000,
            open: 0.45,
            high: 0.55,
            low: 0.4,
            close: 0.5,
            volume: 1000
          }
        ])
      } as never
    })

    const result = await adapter.buildCandleStateFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "condition-1" },
      { condition_id: "condition-1", interval: 60 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        canonicalEventId: "canonical-event-1",
        venue: "POLYMARKET",
        venueMarketId: "condition-1",
        metadataVersion: "predexon-v2",
        lastPrice: "0.5",
        volume: "1000"
      })
    )
    expect(result[0]?.candles).toEqual(expect.objectContaining({ close: 0.5 }))
  })

  it("normalizes orderbook history into top-of-book fragments", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        getOrderbookHistory: vi.fn(async () => [
          {
            token_id: "token-1",
            timestamp: 1710000000000,
            bids: [{ price: 0.48, size: 100 }],
            asks: [{ price: 0.52, size: 90 }]
          }
        ])
      } as never
    })

    const result = await adapter.buildOrderbookStateFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "token-1" },
      { token_id: "token-1", start_time: 1710000000000, end_time: 1710003600000 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        bestBid: "0.48",
        bestAsk: "0.52",
        spread: "0.040000000000000036",
        midpoint: "0.5"
      })
    )
  })

  it("normalizes Limitless orderbook history into venue-specific fragments", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        getLimitlessOrderbookHistory: vi.fn(async () => [
          {
            market_slug: "limitless-btc",
            timestamp: 1710000000000,
            bids: [{ price: 0.48, size: 100 }],
            asks: [{ price: 0.50, size: 90 }],
            adjusted_midpoint: 0.49
          }
        ])
      } as never
    })

    const result = await adapter.buildLimitlessOrderbookStateFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "limitless-btc", venue: "LIMITLESS" },
      { market_slug: "limitless-btc", start_time: 1710000000, end_time: 1710003600 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        venue: "LIMITLESS",
        bestBid: "0.48",
        bestAsk: "0.5",
        midpoint: "0.49",
        lastPrice: "0.49"
      })
    )
  })

  it("normalizes Opinion orderbook history into venue-specific fragments", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        getOpinionOrderbookHistory: vi.fn(async () => [
          {
            market_id: "opinion-market-1",
            timestamp: 1710000000000,
            bids: [{ price: 0.61, size: 19 }],
            asks: [{ price: 0.64, size: 14 }],
            best_bid: 0.61,
            best_ask: 0.64,
            bid_depth: 19,
            ask_depth: 14
          }
        ])
      } as never
    })

    const result = await adapter.buildOpinionOrderbookStateFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "opinion-market-1", venue: "OPINION" },
      { market_id: "opinion-market-1", start_time: 1710000000, end_time: 1710003600 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        venue: "OPINION",
        bestBid: "0.61",
        bestAsk: "0.64",
        midpoint: "0.625",
        lastPrice: "0.625"
      })
    )
  })

  it("normalizes trades into historical market state fragments", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        getTradesHistory: vi.fn(async () => [
          {
            token_id: "token-1",
            timestamp: 1710000000000,
            price: 0.51,
            amount_usd: 1500,
            side: "buy"
          }
        ])
      } as never
    })

    const result = await adapter.buildTradeStateFragments(
      { canonicalEventId: "canonical-event-1", venueMarketId: "token-1" },
      { token_id: "token-1", limit: 1 }
    )

    expect(result[0]).toEqual(
      expect.objectContaining({
        lastPrice: "0.51",
        volume: "1500"
      })
    )
    expect(result[0]?.trades).toEqual(expect.objectContaining({ side: "buy" }))
  })

  it("merges volume and open interest on shared timestamps", async () => {
    const adapter = new PredexonHistoricalAdapter({
      metadataVersion: "predexon-v2",
      client: {
        getVolumeTimeSeries: vi.fn(async () => [
          {
            timestamp: 1710000000000,
            total_volume: 1200
          }
        ]),
        getOpenInterestTimeSeries: vi.fn(async () => [
          {
            timestamp: 1710000000000,
            open_interest: 3200
          }
        ])
      } as never
    })

    const result = await adapter.buildVolumeOpenInterestFragments({
      canonicalEventId: "canonical-event-1",
      venueMarketId: "condition-1",
      tokenId: "token-1",
      conditionId: "condition-1"
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(
      expect.objectContaining({
        volume: "1200",
        openInterest: "3200"
      })
    )
  })
})
