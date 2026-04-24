import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { MyriadClient } from "../../src/integrations/myriad/myriad-client.js"
import { MyriadMarketCrawler } from "../../src/integrations/myriad/myriad-market-crawler.js"
import { MyriadMarketDetailEnricher } from "../../src/integrations/myriad/myriad-market-detail-enricher.js"
import { MyriadMarketEventsBackfill } from "../../src/integrations/myriad/myriad-market-events-backfill.js"
import { buildMyriadPhase4Candidates, generateMyriadPhase4Shortlists } from "../../src/integrations/myriad/myriad-phase4-shortlist.js"
import { classifyMyriadPreviewCategory } from "../../src/integrations/myriad/myriad-topic-normalizer.js"
import { myriadPhase4PreviewArtifactSchema, type MyriadPhase4PreviewArtifact } from "../../src/integrations/myriad/myriad-preview-artifact.js"
import type { MyriadMarketSummary, MyriadQuestion } from "../../src/integrations/myriad/myriad-schemas.js"

const artifactPath = path.resolve(process.cwd(), ".tmp", "myriad-phase4-preview.json")
const baseUrl = "https://api-v2.myriadprotocol.com/"
const marketLookbackDays = 7
const perCategoryCandidateLimit = 2

type PreviewCategory = "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS"

const categoryQueries: ReadonlyArray<{
  category: PreviewCategory;
  query: {
    state: "open";
    topics?: string;
    keyword?: string;
    sort: "volume";
    order: "desc";
    limit: number;
  };
}> = [
  { category: "SPORTS", query: { state: "open", topics: "Sports", sort: "volume", order: "desc", limit: 8 } },
  { category: "CRYPTO", query: { state: "open", topics: "Crypto", sort: "volume", order: "desc", limit: 8 } },
  { category: "POLITICS", query: { state: "open", topics: "Politics", sort: "volume", order: "desc", limit: 8 } },
  { category: "ESPORTS", query: { state: "open", keyword: "esports", sort: "volume", order: "desc", limit: 8 } }
]

const marketKey = (market: Pick<MyriadMarketSummary, "slug" | "networkId">): string =>
  `${market.slug}|${market.networkId}`

const toNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const toNullableIso = (value: string | null | undefined): string | null => value ?? null

const main = async (): Promise<void> => {
  const apiKey = process.env.MYRIAD_API_KEY
  const client = new MyriadClient({
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    retry: {
      maxRetries: 2,
      baseBackoffMs: 750,
      maxBackoffMs: 2_500
    }
  })
  const crawler = new MyriadMarketCrawler({ client })
  const enricher = new MyriadMarketDetailEnricher({ client })
  const backfill = new MyriadMarketEventsBackfill({ client })

  const selectedMarkets = new Map<string, { category: PreviewCategory; summary: MyriadMarketSummary }>()

  for (const { category, query } of categoryQueries) {
    const crawled = await crawler.crawlAll(query)
    const filtered = crawled.markets.filter((market) => classifyMyriadPreviewCategory(market) === category)
    for (const market of filtered.slice(0, perCategoryCandidateLimit)) {
      selectedMarkets.set(marketKey(market), { category, summary: market })
    }
  }

  const questionCache = new Map<string, MyriadQuestion | null>()
  const records: Array<{
    category: PreviewCategory;
    enrichment: Awaited<ReturnType<MyriadMarketDetailEnricher["enrich"]>>;
    events: Awaited<ReturnType<MyriadMarketEventsBackfill["backfill"]>>["events"];
  }> = []

  const nowSeconds = Math.floor(Date.now() / 1_000)
  const sinceSeconds = nowSeconds - marketLookbackDays * 24 * 60 * 60

  for (const { category, summary } of [...selectedMarkets.values()].sort((left, right) =>
    left.category.localeCompare(right.category) || marketKey(left.summary).localeCompare(marketKey(right.summary))
  )) {
    const enrichment = await enricher.enrich(summary)
    const questionCacheKey = `${enrichment.detail.title}|${enrichment.detail.networkId}|${enrichment.detail.id}`
    if (!questionCache.has(questionCacheKey)) {
      try {
        const questions = await client.listQuestions({ page: 1, limit: 5, keyword: enrichment.detail.title })
        const matchedQuestion =
          questions.data.find((question) =>
            question.markets.some((market) => String(market.id) === String(enrichment.detail.id) && market.networkId === enrichment.detail.networkId)
          ) ?? null
        questionCache.set(questionCacheKey, matchedQuestion)
      } catch (error) {
        questionCache.set(questionCacheKey, null)
        process.stderr.write(`Question lookup failed for ${enrichment.detail.slug}: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
    let events: Awaited<ReturnType<MyriadMarketEventsBackfill["backfill"]>>["events"] = []
    try {
      const backfilled = await backfill.backfill({
        idOrSlug: summary.id,
        network_id: summary.networkId,
        since: sinceSeconds,
        until: nowSeconds,
        limit: 100
      })
      events = backfilled.events
    } catch (error) {
      process.stderr.write(`Event backfill failed for ${summary.slug}: ${error instanceof Error ? error.message : String(error)}\n`)
    }

    records.push({
      category,
      enrichment,
      events
    })
  }

  const candidates = buildMyriadPhase4Candidates({
    questions: [...questionCache.values()].filter((question): question is MyriadQuestion => question !== null),
    records: records.map((record) => ({
      enrichment: record.enrichment,
      events: record.events
    }))
  })

  const shortlists = generateMyriadPhase4Shortlists(candidates, {
    highLiquidityLimit: 8,
    categoryBalancedPerCategory: 2,
    recentlyResolvedLimit: 4
  })
  const shortlistMembership = new Map<string, Array<"highLiquidity" | "categoryBalanced" | "recentlyResolved">>()
  for (const [setName, markets] of Object.entries(shortlists) as Array<[keyof typeof shortlists, typeof candidates]>) {
    for (const market of markets) {
      const key = `${market.marketDetail.slug}|${market.marketDetail.networkId}`
      const entry = shortlistMembership.get(key) ?? []
      entry.push(setName)
      shortlistMembership.set(key, entry)
    }
  }

  const categoryByKey = new Map(records.map((record) => [marketKey(record.enrichment.summary), record.category]))
  const artifact: MyriadPhase4PreviewArtifact = {
    version: "myriad-phase4-preview-v1",
    generatedAt: new Date().toISOString(),
    source: {
      baseUrl,
      marketLookbackDays,
      perCategoryCandidateLimit
    },
    candidates: candidates
      .map((candidate) => {
        const key = `${candidate.marketDetail.slug}|${candidate.marketDetail.networkId}`
        const previewCategory = categoryByKey.get(key) ?? classifyMyriadPreviewCategory(candidate.marketDetail)
        const pointCount = candidate.priceCharts.reduce((total, series) => total + series.points.length, 0)
        return {
          key,
          previewCategory,
          lotusCategory: candidate.lotusCategory,
          shortlistSets: shortlistMembership.get(key) ?? [],
          question: candidate.question
            ? {
                id: String(candidate.question.id),
                title: candidate.question.title,
                marketCount: candidate.question.marketCount,
                expiresAt: toNullableIso(candidate.question.expiresAt)
              }
            : null,
          market: {
            id: String(candidate.marketDetail.id),
            networkId: candidate.marketDetail.networkId,
            slug: candidate.marketDetail.slug,
            title: candidate.marketDetail.title,
            state: candidate.marketDetail.state,
            publishedAt: toNullableIso(candidate.marketDetail.publishedAt),
            expiresAt: toNullableIso(candidate.marketDetail.expiresAt),
            resolvesAt: toNullableIso(candidate.marketDetail.resolvesAt ?? undefined),
            topics: candidate.marketDetail.topics ?? [],
            resolutionSource: candidate.marketDetail.resolutionSource ?? null,
            resolutionTitle: candidate.marketDetail.resolutionTitle ?? null,
            liquidity: toNullableNumber(candidate.marketDetail.liquidity),
            volume: toNullableNumber(candidate.marketDetail.volume),
            volume24h: toNullableNumber(candidate.marketDetail.volume24h),
            users: toNullableNumber(candidate.marketDetail.users),
            voided: candidate.marketDetail.voided === true,
            featured: candidate.marketDetail.featured === true,
            inPlay: candidate.marketDetail.inPlay === true,
            perpetual: candidate.marketDetail.perpetual === true,
            moneyline: candidate.marketDetail.moneyline === true,
            outcomeCount: candidate.marketDetail.outcomes.length,
            outcomes: candidate.marketDetail.outcomes.map((outcome) => ({
              id: String(outcome.id),
              title: outcome.title,
              price: toNullableNumber(outcome.price)
            }))
          },
          priceHistory: {
            seriesCount: candidate.priceCharts.length,
            timeframes: [...new Set(candidate.priceCharts.map((series) => series.timeframe))],
            pointCount
          },
          eventHistory: {
            eventCount: candidate.events.length,
            firstTimestamp: candidate.events[0]?.timestamp ?? null,
            lastTimestamp: candidate.events[candidate.events.length - 1]?.timestamp ?? null
          },
          simulationReadiness: candidate.simulationReadiness
        }
      })
      .sort((left, right) =>
        left.previewCategory.localeCompare(right.previewCategory) ||
        left.market.slug.localeCompare(right.market.slug) ||
        left.market.networkId - right.market.networkId
      )
  }

  myriadPhase4PreviewArtifactSchema.parse(artifact)
  await mkdir(path.dirname(artifactPath), { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")

  process.stdout.write(
    `${JSON.stringify({
      artifactPath,
      generatedAt: artifact.generatedAt,
      candidateCount: artifact.candidates.length,
      categories: [...new Set(artifact.candidates.map((candidate) => candidate.previewCategory))]
    }, null, 2)}\n`
  )
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
