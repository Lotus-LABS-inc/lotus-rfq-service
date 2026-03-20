import type { Logger } from "pino"

import type { MyriadClient, MyriadMarketLookup } from "./myriad-client.js"
import type { MyriadMarketDetail, MyriadMarketSummary, MyriadPriceChartSeries } from "./myriad-schemas.js"

export interface MyriadMarketDetailEnricherConfig {
  client: Pick<MyriadClient, "getMarket">;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface MyriadMarketDetailEnrichment {
  summary: MyriadMarketSummary;
  detail: MyriadMarketDetail;
  priceCharts: readonly MyriadPriceChartSeries[];
  raw: Record<string, unknown>;
}

const extractPriceCharts = (detail: MyriadMarketDetail): MyriadPriceChartSeries[] =>
  detail.outcomes.flatMap((outcome) =>
    (outcome.price_charts ?? [])
      .filter((series) => Array.isArray(series.prices) && series.prices.length > 0)
      .map((series) => ({
        timeframe: series.timeframe,
        points: series.prices.map((point) => ({
          timestamp: point.timestamp,
          price: "price" in point && typeof point.price === "number" ? point.price : Number(point.value)
        }))
      }))
  )

export class MyriadMarketDetailEnricher {
  public constructor(private readonly config: MyriadMarketDetailEnricherConfig) {}

  public async enrich(summary: MyriadMarketSummary): Promise<MyriadMarketDetailEnrichment> {
    const lookup: MyriadMarketLookup = {
      idOrSlug: summary.id,
      network_id: summary.networkId
    }
    const detail = await this.config.client.getMarket(lookup)
    this.config.logger?.info({ slug: summary.slug, networkId: summary.networkId }, "Enriched Myriad market detail.")
    return {
      summary,
      detail,
      priceCharts: extractPriceCharts(detail),
      raw: detail as Record<string, unknown>
    }
  }

  public async enrichMany(summaries: readonly MyriadMarketSummary[]): Promise<readonly MyriadMarketDetailEnrichment[]> {
    const results: MyriadMarketDetailEnrichment[] = []
    for (const summary of summaries) {
      results.push(await this.enrich(summary))
    }
    return results.sort(
      (left, right) =>
        left.summary.slug.localeCompare(right.summary.slug) ||
        left.summary.networkId - right.summary.networkId
    )
  }
}
