import type { LotusNormalizedMarketCategory, MyriadMarketDetail, MyriadMarketSummary } from "./myriad-schemas.js"

export type MyriadPreviewCategory = LotusNormalizedMarketCategory | "ESPORTS"

const topicMap: ReadonlyArray<[LotusNormalizedMarketCategory, readonly string[]]> = [
  ["SPORTS", ["sports", "soccer", "nba", "nfl", "mlb", "ufc", "tennis", "football", "esports"]],
  ["CRYPTO", ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "token"]],
  ["POLITICS", ["politics", "election", "government", "president", "senate", "parliament"]],
  ["CULTURE", ["entertainment", "movie", "music", "television", "celebrity", "culture"]],
  ["TECH", ["technology", "ai", "startup", "software", "chip", "tech"]],
  ["WEATHER", ["weather", "rain", "temperature", "storm", "hurricane", "snow"]]
]

const normalizedTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0)

const collectSignals = (market: Pick<MyriadMarketSummary, "topics" | "title" | "description" | "slug">): string[] => {
  const signals = [
    ...(market.topics ?? []),
    market.title,
    market.slug,
    market.description ?? ""
  ]
  return signals.flatMap(normalizedTokens)
}

export const normalizeMyriadTopicCategory = (
  market: Pick<MyriadMarketSummary, "topics" | "title" | "description" | "slug">
): LotusNormalizedMarketCategory => {
  const signals = collectSignals(market)
  for (const [category, keywords] of topicMap) {
    if (keywords.some((keyword) => signals.includes(keyword))) {
      return category
    }
  }
  return "OTHER"
}

export const classifyMyriadPreviewCategory = (
  market: Pick<MyriadMarketSummary, "topics" | "title" | "description" | "slug">
): MyriadPreviewCategory => {
  const signals = collectSignals(market)
  if (["gaming", "esports", "league", "legends", "lck", "lpl", "worlds", "valorant"].some((keyword) => signals.includes(keyword))) {
    return "ESPORTS"
  }
  return normalizeMyriadTopicCategory(market)
}

export const isSimpleBinaryOutcomeMarket = (market: Pick<MyriadMarketDetail, "outcomes">): boolean =>
  market.outcomes.length === 2 && market.outcomes.every((outcome) => typeof outcome.title === "string" && outcome.title.trim().length > 0)
