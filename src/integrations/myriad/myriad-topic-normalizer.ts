import {
  rankSemanticCategories,
  type SemanticDiscoveryCategory
} from "../../simulation/semantic-rulepack.js"
import type { LotusNormalizedMarketCategory, MyriadMarketDetail, MyriadMarketSummary } from "./myriad-schemas.js"

export type MyriadPreviewCategory = LotusNormalizedMarketCategory | "ESPORTS"

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

const mapSemanticCategoryToLotus = (category: SemanticDiscoveryCategory): LotusNormalizedMarketCategory =>
  category === "ESPORTS"
    ? "SPORTS"
    : category === "CULTURE" || category === "TECH" || category === "WEATHER" || category === "CRYPTO" || category === "POLITICS" || category === "SPORTS"
      ? category
      : "OTHER"

const collectSemanticRankings = (
  market: Pick<MyriadMarketSummary, "topics" | "title" | "description" | "slug">
) => rankSemanticCategories(collectSignals(market).join(" "), [
  "ESPORTS",
  "SPORTS",
  "CRYPTO",
  "POLITICS",
  "CULTURE",
  "TECH",
  "WEATHER",
  "OTHER"
])

export const normalizeMyriadTopicCategory = (
  market: Pick<MyriadMarketSummary, "topics" | "title" | "description" | "slug">
): LotusNormalizedMarketCategory => {
  const ranking = collectSemanticRankings(market)[0]
  return ranking ? mapSemanticCategoryToLotus(ranking.category) : "OTHER"
}

export const classifyMyriadPreviewCategory = (
  market: Pick<MyriadMarketSummary, "topics" | "title" | "description" | "slug">
): MyriadPreviewCategory => {
  const ranking = collectSemanticRankings(market)[0]
  if (!ranking) {
    return "OTHER"
  }
  return ranking.category === "ESPORTS" ? "ESPORTS" : mapSemanticCategoryToLotus(ranking.category)
}

export const isSimpleBinaryOutcomeMarket = (market: Pick<MyriadMarketDetail, "outcomes">): boolean =>
  market.outcomes.length === 2 && market.outcomes.every((outcome) => typeof outcome.title === "string" && outcome.title.trim().length > 0)
