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
      makeResponse([
        {
          condition_id: "cond-1",
          title: "Will BTC close above 100k?"
        }
      ])
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
        makeResponse([
          {
            condition_id: "cond-1",
            title: "Will ETH rally?"
          }
        ])
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
})
