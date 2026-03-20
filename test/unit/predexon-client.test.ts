import { describe, expect, it, vi } from "vitest"

import { PredexonClientError, PredexonHistoricalClient } from "../../src/integrations/predexon/predexon-client.js"

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const makeResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...(init ?? {})
  })

describe("PredexonHistoricalClient", () => {
  it("builds listMarkets requests with repeated array query parameters", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      makeResponse({
        markets: [
          {
            condition_id: "cond-1",
            title: "Will BTC close above 100k?"
          }
        ]
      })
    )
    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl
    })

    await client.listMarkets({
      market_id: ["m-1", "m-2"],
      limit: 2
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [requestUrl] = fetchImpl.mock.calls[0] ?? []
    expect(requestUrl).toContain("/v2/polymarket/markets?")
    expect(requestUrl).toContain("market_id=m-1")
    expect(requestUrl).toContain("market_id=m-2")
    expect(requestUrl).toContain("limit=2")
  })

  it("retries on 429 honoring Retry-After", async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "retry-after": "0", "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          price: 0.51,
          timestamp: 1710000000000
        })
      )

    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl,
      retry: { maxRetries: 1, baseBackoffMs: 0, maxBackoffMs: 0 }
    })

    const result = await client.getMarketPrice({ token_id: "token-1" })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.price).toBe(0.51)
  })

  it("retries once on 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(makeResponse({ message: "server error" }, { status: 500 }))
      .mockResolvedValueOnce(
        makeResponse({
          markets: [
            {
              condition_id: "cond-1",
              title: "Will ETH rally?"
            }
          ]
        })
      )

    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl,
      retry: { maxRetries: 1, baseBackoffMs: 0, maxBackoffMs: 0 }
    })

    const result = await client.listMarkets()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result[0]?.condition_id).toBe("cond-1")
  })

  it("fails immediately on non-retriable 4xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => makeResponse({ message: "bad request" }, { status: 400 }))
    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl
    })

    await expect(client.listEvents()).rejects.toBeInstanceOf(PredexonClientError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("fails closed on malformed payloads", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => makeResponse([{ title: "missing condition id" }]))
    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl
    })

    await expect(client.listMarkets()).rejects.toThrow("payload validation failed")
  })

  it("supports Limitless historical orderbooks", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      makeResponse({
        snapshots: [
          {
            market_slug: "btc-limitless",
            timestamp: 1710000000000,
            bids: [{ price: 0.47, size: 40 }],
            asks: [{ price: 0.49, size: 35 }],
            adjusted_midpoint: 0.48
          }
        ]
      })
    )
    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl
    })

    const result = await client.getLimitlessOrderbookHistory({
      market_slug: "btc-limitless",
      start_time: 1710000000,
      end_time: 1710003600
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [requestUrl] = fetchImpl.mock.calls[0] ?? []
    expect(requestUrl).toContain("/v2/limitless/orderbooks?")
    expect(result[0]?.market_slug).toBe("btc-limitless")
    expect(result[0]?.adjusted_midpoint).toBe(0.48)
  })

  it("supports Opinion historical orderbooks", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      makeResponse({
        snapshots: [
          {
            market_id: 6808,
            timestamp: 1710000000000,
            bids: [{ price: 0.62, size: 18 }],
            asks: [{ price: 0.64, size: 15 }],
            best_bid: 0.62,
            best_ask: 0.64,
            bid_depth: 18,
            ask_depth: 15
          }
        ]
      })
    )
    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl
    })

    const result = await client.getOpinionOrderbookHistory({
      market_id: "opinion-market-1",
      start_time: 1710000000,
      end_time: 1710003600
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [requestUrl] = fetchImpl.mock.calls[0] ?? []
    expect(requestUrl).toContain("/v2/opinion/orderbooks?")
    expect(result[0]?.market_id).toBe("6808")
    expect(result[0]?.best_bid).toBe(0.62)
  })

  it("accepts polymarket orderbooks that use assetId instead of token_id", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      makeResponse({
        snapshots: [
          {
            assetId: "token-asset-1",
            market: "condition-1",
            timestamp: 1710000000000,
            bids: [{ price: 0.48, size: 100 }],
            asks: [{ price: 0.52, size: 90 }]
          }
        ]
      })
    )
    const client = new PredexonHistoricalClient({
      baseUrl: "https://api.predexon.com",
      apiKey: "test-key",
      fetchImpl
    })

    const result = await client.getOrderbookHistory({
      token_id: "token-asset-1",
      start_time: 1710000000000,
      end_time: 1710003600000
    })

    expect(result[0]?.token_id).toBe("token-asset-1")
    expect(result[0]?.bids[0]).toEqual(expect.objectContaining({ price: 0.48, size: 100 }))
  })
})
