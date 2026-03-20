import { describe, expect, it, vi } from "vitest"

import { MyriadClient, MyriadClientError } from "../../src/integrations/myriad/myriad-client.js"

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const makeResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...(init ?? {})
  })

describe("MyriadClient", () => {
  it("builds paginated markets requests with filters", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      makeResponse({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false }
      })
    )

    const client = new MyriadClient({
      baseUrl: "https://api-v2.myriadprotocol.com/",
      apiKey: "myriad_key",
      fetchImpl
    })

    await client.listMarkets({ page: 1, limit: 50, state: "open", topics: "politics,crypto", keyword: "election" })

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] ?? []
    expect(String(requestUrl)).toContain("/markets?")
    expect(String(requestUrl)).toContain("state=open")
    expect(String(requestUrl)).toContain("topics=politics%2Ccrypto")
    expect(String(requestUrl)).toContain("keyword=election")
    expect((requestInit?.headers as Record<string, string>)?.["x-api-key"]).toBe("myriad_key")
  })

  it("retries 429 honoring Retry-After", async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "0", "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(
        makeResponse({
          data: [],
          meta: { page: 1, limit: 20, total: 0, totalMarkets: 0, totalPages: 0, hasNext: false, hasPrev: false }
        })
      )

    const client = new MyriadClient({
      baseUrl: "https://api-v2.myriadprotocol.com/",
      fetchImpl,
      retry: { maxRetries: 1, baseBackoffMs: 0, maxBackoffMs: 0 }
    })

    const result = await client.listQuestions()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.pagination.page).toBe(1)
  })

  it("fails closed on malformed payloads", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => makeResponse({ data: [{ slug: "bad" }], pagination: {} }))
    const client = new MyriadClient({
      baseUrl: "https://api-v2.myriadprotocol.com/",
      fetchImpl
    })

    await expect(client.listMarkets()).rejects.toThrow("payload validation failed")
  })

  it("fails immediately on non-retriable 4xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => makeResponse({ message: "bad request" }, { status: 400 }))
    const client = new MyriadClient({
      baseUrl: "https://api-v2.myriadprotocol.com/",
      fetchImpl
    })

    await expect(client.getMarket({ idOrSlug: "bad-market" })).rejects.toBeInstanceOf(MyriadClientError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
