import type { MyriadMarketDetailEnrichment } from "./myriad-market-detail-enricher.js"
import type { MyriadMarketEvent, MyriadQuestion, MyriadPhase4Candidate } from "./myriad-schemas.js"
import { isSimpleBinaryOutcomeMarket, normalizeMyriadTopicCategory } from "./myriad-topic-normalizer.js"

export interface MyriadPhase4ShortlistSets {
  highLiquidity: readonly MyriadPhase4Candidate[];
  categoryBalanced: readonly MyriadPhase4Candidate[];
  recentlyResolved: readonly MyriadPhase4Candidate[];
}

const hasResolutionMetadata = (candidate: MyriadPhase4Candidate): boolean =>
  Boolean(candidate.marketDetail.resolutionSource || candidate.marketDetail.resolutionTitle || candidate.marketDetail.resolvesAt)

const scoreCandidate = (candidate: MyriadPhase4Candidate): number => {
  const liquidity = Number(candidate.marketDetail.liquidity ?? 0)
  const volume = Number(candidate.marketDetail.volume ?? 0)
  const recency = candidate.marketDetail.publishedAt ? Date.parse(candidate.marketDetail.publishedAt) / 1_000_000_000 : 0
  const resolvedBoost = candidate.marketDetail.state === "resolved" ? 1_000_000_000 : 0
  const binaryBoost = isSimpleBinaryOutcomeMarket(candidate.marketDetail) ? 500_000_000 : 0
  const resolutionBoost = hasResolutionMetadata(candidate) ? 250_000_000 : 0
  const eventBoost = candidate.simulationReadiness.hasUsableEventHistory ? 150_000_000 : 0
  const priceBoost = candidate.simulationReadiness.hasUsablePriceHistory ? 150_000_000 : 0
  const nonVoidedBoost = candidate.marketDetail.voided ? 0 : 100_000_000
  return liquidity + volume + recency + resolvedBoost + binaryBoost + resolutionBoost + eventBoost + priceBoost + nonVoidedBoost
}

const compareCandidates = (left: MyriadPhase4Candidate, right: MyriadPhase4Candidate): number =>
  scoreCandidate(right) - scoreCandidate(left) ||
  left.lotusCategory.localeCompare(right.lotusCategory) ||
  left.marketDetail.slug.localeCompare(right.marketDetail.slug) ||
  left.marketDetail.networkId - right.marketDetail.networkId

const uniqueBySlugAndNetwork = (candidates: readonly MyriadPhase4Candidate[]): MyriadPhase4Candidate[] => {
  const seen = new Set<string>()
  const unique: MyriadPhase4Candidate[] = []
  for (const candidate of [...candidates].sort(compareCandidates)) {
    const key = `${candidate.marketDetail.slug}|${candidate.marketDetail.networkId}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(candidate)
    }
  }
  return unique
}

const groupQuestionById = (questions: readonly MyriadQuestion[]): Map<string, MyriadQuestion> =>
  new Map(questions.map((question) => [String(question.id), question]))

export const buildMyriadPhase4Candidates = (input: {
  questions: readonly MyriadQuestion[];
  records: readonly {
    enrichment: MyriadMarketDetailEnrichment;
    events: readonly MyriadMarketEvent[];
  }[];
}): readonly MyriadPhase4Candidate[] => {
  const questionById = groupQuestionById(input.questions)
  const candidates = input.records.map(({ enrichment, events }) => {
    const detail = enrichment.detail
    const question =
      input.questions.find((item) => item.markets.some((market) => String(market.id) === String(detail.id) && market.networkId === detail.networkId)) ?? null
    const hasResolutionMetadata = Boolean(detail.resolutionSource || detail.resolutionTitle || detail.resolvesAt)
    const hasOutcomeMetadata = detail.outcomes.length > 0
    const hasUsablePriceHistory = enrichment.priceCharts.some((series) => series.points.length > 0)
    const hasUsableEventHistory = events.length > 0
    const likelyGoodForReplay = hasOutcomeMetadata && hasUsablePriceHistory && hasUsableEventHistory && !detail.voided
    return {
      question,
      marketSummary: enrichment.summary,
      marketDetail: detail,
      outcomes: detail.outcomes,
      priceCharts: enrichment.priceCharts,
      events,
      lotusCategory: normalizeMyriadTopicCategory(detail),
      simulationReadiness: {
        hasQuestionGrouping: question !== null,
        hasResolutionMetadata,
        hasOutcomeMetadata,
        hasUsablePriceHistory,
        hasUsableEventHistory,
        likelyGoodForReplay,
        likelyGoodForCanaryShadowTesting: likelyGoodForReplay && (detail.state === "open" || detail.state === "resolved")
      },
      raw: {
        question: question as Record<string, unknown> | null,
        marketSummary: enrichment.summary as Record<string, unknown>,
        marketDetail: detail as Record<string, unknown>,
        events: events as readonly Record<string, unknown>[]
      }
    } satisfies MyriadPhase4Candidate
  })

  return uniqueBySlugAndNetwork(candidates).map((candidate) => {
    const question = candidate.question ? questionById.get(String(candidate.question.id)) ?? candidate.question : null
    return {
      ...candidate,
      question,
      simulationReadiness: {
        ...candidate.simulationReadiness,
        hasQuestionGrouping: question !== null
      }
    }
  })
}

export const generateMyriadPhase4Shortlists = (
  candidates: readonly MyriadPhase4Candidate[],
  options: { highLiquidityLimit?: number; categoryBalancedPerCategory?: number; recentlyResolvedLimit?: number } = {}
): MyriadPhase4ShortlistSets => {
  const sorted = uniqueBySlugAndNetwork(candidates)
  const highLiquidityLimit = options.highLiquidityLimit ?? 10
  const categoryBalancedPerCategory = options.categoryBalancedPerCategory ?? 2
  const recentlyResolvedLimit = options.recentlyResolvedLimit ?? 10

  const highLiquidity = sorted
    .filter((candidate) => candidate.marketDetail.state === "open" || candidate.marketDetail.state === "closed" || candidate.marketDetail.state === "resolved")
    .slice(0, highLiquidityLimit)

  const categoryBuckets = new Map<string, MyriadPhase4Candidate[]>()
  for (const candidate of sorted) {
    const bucket = categoryBuckets.get(candidate.lotusCategory) ?? []
    if (bucket.length < categoryBalancedPerCategory) {
      bucket.push(candidate)
      categoryBuckets.set(candidate.lotusCategory, bucket)
    }
  }
  const categoryBalanced = [...categoryBuckets.values()].flat().sort(compareCandidates)

  const recentlyResolved = sorted
    .filter((candidate) => candidate.marketDetail.state === "resolved" && candidate.marketDetail.voided !== true)
    .slice(0, recentlyResolvedLimit)

  return {
    highLiquidity,
    categoryBalanced,
    recentlyResolved
  }
}
