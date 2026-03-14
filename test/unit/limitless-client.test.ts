import { describe, expect, it, vi } from "vitest"

import { LimitlessClientError, LimitlessHistoricalClient } from "../../src/integrations/limitless/limitless-client.js"

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const makeResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...(init ?? {})
  })

describe("LimitlessHistoricalClient", () => {
  it("builds historical price requests with query parameters", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      makeResponse([
        {
          title: "YES",
          prices: [{ price: 0.61, timestamp: "2024-01-10T00:00:00Z" }]
        }
      ])
    )
    const client = new LimitlessHistoricalClient({
      baseUrl: "https://api.limitless.exchange",
      apiKey: "lmts_test",
      fetchImpl
    })

    await client.getHistoricalPrice({
      slug: "btc-above-100k",
      interval: "1d",
      from: "2024-01-01T00:00:00Z"
    })

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] ?? []
    expect(requestUrl).toContain("/markets/btc-above-100k/historical-price?")
    expect(requestUrl).toContain("interval=1d")
    expect(requestUrl).toContain("from=2024-01-01T00%3A00%3A00Z")
    expect((requestInit?.headers as Record<string, string>)?.["X-API-Key"]).toBe("lmts_test")
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
          title: "BTC above 100k?",
          slug: "btc-above-100k"
        })
      )

    const client = new LimitlessHistoricalClient({
      baseUrl: "https://api.limitless.exchange",
      apiKey: "lmts_test",
      fetchImpl,
      retry: { maxRetries: 1, baseBackoffMs: 0, maxBackoffMs: 0 }
    })

    const result = await client.getMarketDetail("btc-above-100k")

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.title).toBe("BTC above 100k?")
  })

  it("retries once on 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(makeResponse({ message: "server error" }, { status: 500 }))
      .mockResolvedValueOnce(
        makeResponse({
          events: [{ id: "event-1", type: "ORDER_PLACED", timestamp: "2024-01-01T00:00:00Z" }]
        })
      )

    const client = new LimitlessHistoricalClient({
      baseUrl: "https://api.limitless.exchange",
      apiKey: "lmts_test",
      fetchImpl,
      retry: { maxRetries: 1, baseBackoffMs: 0, maxBackoffMs: 0 }
    })

    const result = await client.getMarketEvents({ slug: "btc-above-100k" })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.events[0]?.id).toBe("event-1")
  })

  it("fails immediately on non-retriable 4xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => makeResponse({ message: "bad request" }, { status: 400 }))
    const client = new LimitlessHistoricalClient({
      baseUrl: "https://api.limitless.exchange",
      apiKey: "lmts_test",
      fetchImpl
    })

    await expect(client.getPortfolioHistory({ page: 1, limit: 10 })).rejects.toBeInstanceOf(LimitlessClientError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("fails closed on malformed payloads", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => makeResponse([{ timestamp: "2024-01-01T00:00:00Z" }]))
    const client = new LimitlessHistoricalClient({
      baseUrl: "https://api.limitless.exchange",
      apiKey: "lmts_test",
      fetchImpl
    })

    await expect(client.getHistoricalPrice({ slug: "btc-above-100k" })).rejects.toThrow("payload validation failed")
  })
})

