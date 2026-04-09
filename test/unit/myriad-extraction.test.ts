import { describe, expect, it, vi } from "vitest"

import { MyriadQuestionCrawler } from "../../src/integrations/myriad/myriad-question-crawler.js"
import { MyriadMarketCrawler } from "../../src/integrations/myriad/myriad-market-crawler.js"
import { MyriadMarketDetailEnricher } from "../../src/integrations/myriad/myriad-market-detail-enricher.js"
import { MyriadMarketEventsBackfill } from "../../src/integrations/myriad/myriad-market-events-backfill.js"
import { buildMyriadPhase4Candidates, generateMyriadPhase4Shortlists } from "../../src/integrations/myriad/myriad-phase4-shortlist.js"
import { classifyMyriadPreviewCategory, normalizeMyriadTopicCategory } from "../../src/integrations/myriad/myriad-topic-normalizer.js"

describe("Myriad extraction modules", () => {
  it("crawls paginated questions and markets deterministically", async () => {
    const questionCrawler = new MyriadQuestionCrawler({
      client: {
        listQuestions: vi
          .fn()
          .mockResolvedValueOnce({
            data: [{ id: 2, title: "Question B", expiresAt: "2026-03-20T00:00:00Z", marketCount: 1, markets: [] }],
            pagination: { page: 1, limit: 1, total: 2, totalPages: 2, hasNext: true, hasPrev: false }
          })
          .mockResolvedValueOnce({
            data: [{ id: 1, title: "Question A", expiresAt: "2026-03-19T00:00:00Z", marketCount: 1, markets: [] }],
            pagination: { page: 2, limit: 1, total: 2, totalPages: 2, hasNext: false, hasPrev: true }
          })
      } as never
    })

    const marketCrawler = new MyriadMarketCrawler({
      client: {
        listMarkets: vi
          .fn()
          .mockResolvedValueOnce({
            data: [{
              id: 200,
              networkId: 2741,
              slug: "zeta-market",
              title: "Zeta Market",
              state: "open",
              topics: [],
              outcomes: []
            }],
            pagination: { page: 1, limit: 1, total: 2, totalPages: 2, hasNext: true, hasPrev: false }
          })
          .mockResolvedValueOnce({
            data: [{
              id: 100,
              networkId: 2741,
              slug: "alpha-market",
              title: "Alpha Market",
              state: "open",
              topics: [],
              outcomes: []
            }],
            pagination: { page: 2, limit: 1, total: 2, totalPages: 2, hasNext: false, hasPrev: true }
          })
      } as never
    })

    const questions = await questionCrawler.crawlAll({ limit: 1 })
    const markets = await marketCrawler.crawlAll({ limit: 1 })

    expect(questions.pagesFetched).toBe(2)
    expect(questions.questions.map((item) => item.id)).toEqual([1, 2])
    expect(markets.pagesFetched).toBe(2)
    expect(markets.markets.map((item) => item.slug)).toEqual(["alpha-market", "zeta-market"])
  })

  it("enriches market detail and backfills events using since/until filters", async () => {
    const enricher = new MyriadMarketDetailEnricher({
      client: {
        getMarket: vi.fn(async () => ({
          id: 101,
          networkId: 2741,
          slug: "election-market",
          title: "Election Market",
          description: "Will candidate win?",
          publishedAt: "2026-03-01T00:00:00Z",
          expiresAt: "2026-11-01T00:00:00Z",
          resolvesAt: "2026-11-02T00:00:00Z",
          state: "open",
          voided: false,
          topics: ["politics"],
          resolutionSource: "Official election authority",
          resolutionTitle: "Election result",
          outcomes: [
            { id: 0, title: "Yes", price_charts: [{ timeframe: "24h", prices: [{ timestamp: 1710000000, price: 0.52, date: "2024-03-09T00:00:00.000Z" }] }] },
            { id: 1, title: "No" }
          ]
        }))
      } as never
    })

    const backfill = new MyriadMarketEventsBackfill({
      client: {
        getMarketEvents: vi
          .fn()
          .mockImplementation(async (query) => ({
            data: query.page === 1
              ? [{
                  user: "0x1",
                  action: "buy",
                  marketTitle: "Election Market",
                  marketSlug: "election-market",
                  marketId: 101,
                  networkId: 2741,
                  outcomeTitle: "Yes",
                  outcomeId: 0,
                  shares: 10,
                  value: 5.2,
                  timestamp: 1710000100,
                  blockNumber: 100,
                  token: "0xtoken"
                }]
              : [{
                  user: "0x2",
                  action: "sell",
                  marketTitle: "Election Market",
                  marketSlug: "election-market",
                  marketId: 101,
                  networkId: 2741,
                  outcomeTitle: "Yes",
                  outcomeId: 0,
                  shares: 5,
                  value: 2.6,
                  timestamp: 1710000200,
                  blockNumber: 101,
                  token: "0xtoken"
                }],
            pagination: {
              page: query.page ?? 1,
              limit: query.limit ?? 100,
              total: 2,
              totalPages: 2,
              hasNext: (query.page ?? 1) === 1,
              hasPrev: (query.page ?? 1) > 1
            }
          }))
      } as never
    })

    const summary = {
      id: 101,
      networkId: 2741,
      slug: "election-market",
      title: "Election Market",
      description: "Will candidate win?",
      publishedAt: "2026-03-01T00:00:00Z",
      expiresAt: "2026-11-01T00:00:00Z",
      resolvesAt: "2026-11-02T00:00:00Z",
      state: "open",
      voided: false,
      topics: ["politics"],
      outcomes: [{ id: 0, title: "Yes" }, { id: 1, title: "No" }]
    }

    const enrichment = await enricher.enrich(summary as never)
    const events = await backfill.backfill({
      idOrSlug: "election-market",
      network_id: 2741,
      since: 1710000000,
      until: 1710000300,
      limit: 1
    })

    expect(enrichment.priceCharts).toEqual([
      { timeframe: "24h", points: [{ timestamp: 1710000000, price: 0.52 }] }
    ])
    expect(events.pagesFetched).toBe(2)
    expect(events.events.map((item) => item.timestamp)).toEqual([1710000100, 1710000200])
  })

  it("caps market event backfill by configured page or row limits", async () => {
    const backfill = new MyriadMarketEventsBackfill({
      client: {
        getMarketEvents: vi
          .fn()
          .mockResolvedValueOnce({
            data: [{
              user: "0x1",
              action: "buy",
              marketTitle: "Election Market",
              marketSlug: "election-market",
              marketId: 101,
              networkId: 2741,
              outcomeTitle: "Yes",
              outcomeId: 0,
              shares: 10,
              value: 5.2,
              timestamp: 1710000100,
              blockNumber: 100,
              token: "0xtoken"
            }],
            pagination: { page: 1, limit: 1, total: 3, totalPages: 3, hasNext: true, hasPrev: false }
          })
          .mockResolvedValueOnce({
            data: [{
              user: "0x2",
              action: "buy",
              marketTitle: "Election Market",
              marketSlug: "election-market",
              marketId: 101,
              networkId: 2741,
              outcomeTitle: "Yes",
              outcomeId: 0,
              shares: 10,
              value: 5.4,
              timestamp: 1710000200,
              blockNumber: 101,
              token: "0xtoken"
            }],
            pagination: { page: 2, limit: 1, total: 3, totalPages: 3, hasNext: true, hasPrev: true }
          })
          .mockResolvedValueOnce({
            data: [{
              user: "0x3",
              action: "buy",
              marketTitle: "Election Market",
              marketSlug: "election-market",
              marketId: 101,
              networkId: 2741,
              outcomeTitle: "Yes",
              outcomeId: 0,
              shares: 10,
              value: 5.6,
              timestamp: 1710000300,
              blockNumber: 102,
              token: "0xtoken"
            }],
            pagination: { page: 3, limit: 1, total: 3, totalPages: 3, hasNext: false, hasPrev: true }
          })
      } as never
    })

    const cappedByPages = await backfill.backfill({
      idOrSlug: "election-market",
      network_id: 2741,
      limit: 1,
      maxPages: 2
    })

    expect(cappedByPages.pagesFetched).toBe(2)
    expect(cappedByPages.events).toHaveLength(2)
    expect(cappedByPages.truncated).toBe(true)
    expect(cappedByPages.truncationReason).toBe("max_pages")

    const cappedByRows = await backfill.backfill({
      idOrSlug: "election-market",
      network_id: 2741,
      limit: 1,
      maxEvents: 1
    })

    expect(cappedByRows.pagesFetched).toBe(1)
    expect(cappedByRows.events).toHaveLength(1)
    expect(cappedByRows.truncated).toBe(true)
    expect(cappedByRows.truncationReason).toBe("max_events")
  })

  it("normalizes categories and generates deterministic shortlists", () => {
    expect(
      normalizeMyriadTopicCategory({
        topics: ["politics"],
        title: "Will candidate win the election?",
        description: "",
        slug: "candidate-election"
      })
    ).toBe("POLITICS")
    expect(
      classifyMyriadPreviewCategory({
        topics: ["gaming", "lck"],
        title: "Will T1 win Worlds?",
        description: "League of Legends esports final",
        slug: "t1-worlds"
      })
    ).toBe("ESPORTS")
    expect(
      normalizeMyriadTopicCategory({
        topics: ["ai"],
        title: "Will OpenAI launch a new model?",
        description: "AI release prediction market",
        slug: "openai-model-launch"
      })
    ).toBe("TECH")

    const questions = [{
      id: 1,
      title: "Question A",
      expiresAt: "2026-03-20T00:00:00Z",
      marketCount: 1,
      markets: [{
        id: 101,
        slug: "election-market",
        title: "Election Market",
        description: "Will candidate win?",
        state: "resolved",
        networkId: 2741,
        liquidity: 1000,
        volume: 5000,
        volume24h: 100,
        imageUrl: null,
        expiresAt: "2026-11-01T00:00:00Z",
        topics: ["politics"],
        outcomes: [{ id: 0, title: "Yes", price: 0.51, shares: 100 }]
      }]
    }]

    const candidates = buildMyriadPhase4Candidates({
      questions,
      records: [
        {
          enrichment: {
            summary: {
              id: 101,
              networkId: 2741,
              slug: "election-market",
              title: "Election Market",
              description: "Will candidate win?",
              publishedAt: "2026-03-01T00:00:00Z",
              expiresAt: "2026-11-01T00:00:00Z",
              resolvesAt: "2026-11-02T00:00:00Z",
              state: "resolved",
              voided: false,
              topics: ["politics"],
              resolutionSource: "Official authority",
              resolutionTitle: "Election result",
              liquidity: 1000,
              volume: 5000,
              volume24h: 100,
              users: 10,
              shares: 100,
              featured: false,
              inPlay: false,
              perpetual: false,
              moneyline: false,
              outcomes: [{ id: 0, title: "Yes" }, { id: 1, title: "No" }]
            },
            detail: {
              id: 101,
              networkId: 2741,
              slug: "election-market",
              title: "Election Market",
              description: "Will candidate win?",
              publishedAt: "2026-03-01T00:00:00Z",
              expiresAt: "2026-11-01T00:00:00Z",
              resolvesAt: "2026-11-02T00:00:00Z",
              state: "resolved",
              voided: false,
              topics: ["politics"],
              resolutionSource: "Official authority",
              resolutionTitle: "Election result",
              liquidity: 1000,
              volume: 5000,
              volume24h: 100,
              users: 10,
              shares: 100,
              featured: false,
              inPlay: false,
              perpetual: false,
              moneyline: false,
              outcomes: [
                { id: 0, title: "Yes", price_charts: [{ timeframe: "24h", prices: [{ timestamp: 1710000000, price: 0.52 }] }] },
                { id: 1, title: "No" }
              ]
            },
            priceCharts: [{ timeframe: "24h", points: [{ timestamp: 1710000000, price: 0.52 }] }],
            raw: {}
          },
          events: [{
            user: "0x1",
            action: "buy",
            marketTitle: "Election Market",
            marketSlug: "election-market",
            marketId: 101,
            networkId: 2741,
            outcomeTitle: "Yes",
            outcomeId: 0,
            shares: 10,
            value: 5.2,
            timestamp: 1710000100,
            blockNumber: 100,
            token: "0xtoken"
          }]
        }
      ]
    })

    const shortlists = generateMyriadPhase4Shortlists(candidates, {
      highLiquidityLimit: 1,
      categoryBalancedPerCategory: 1,
      recentlyResolvedLimit: 1
    })

    expect(candidates[0]?.lotusCategory).toBe("POLITICS")
    expect(candidates[0]?.simulationReadiness).toEqual(
      expect.objectContaining({
        hasQuestionGrouping: true,
        hasResolutionMetadata: true,
        hasOutcomeMetadata: true,
        hasUsablePriceHistory: true,
        hasUsableEventHistory: true,
        likelyGoodForReplay: true
      })
    )
    expect(shortlists.highLiquidity.map((item) => item.marketDetail.slug)).toEqual(["election-market"])
    expect(shortlists.categoryBalanced.map((item) => item.marketDetail.slug)).toEqual(["election-market"])
    expect(shortlists.recentlyResolved.map((item) => item.marketDetail.slug)).toEqual(["election-market"])
  })
})
