import type { Logger } from "pino"

import type { MyriadClient, MyriadPaginatedMarketsQuery } from "./myriad-client.js"
import type { MyriadMarketSummary } from "./myriad-schemas.js"

export interface MyriadMarketCrawlerConfig {
  client: Pick<MyriadClient, "listMarkets">;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface MyriadMarketCrawlerResult {
  markets: readonly MyriadMarketSummary[];
  pagesFetched: number;
}

const sortMarkets = (markets: readonly MyriadMarketSummary[]): MyriadMarketSummary[] =>
  [...markets].sort(
    (left, right) =>
      String(left.slug).localeCompare(String(right.slug)) ||
      Number(left.networkId) - Number(right.networkId) ||
      String(left.id).localeCompare(String(right.id))
  )

export class MyriadMarketCrawler {
  public constructor(private readonly config: MyriadMarketCrawlerConfig) {}

  public async crawlAll(
    query: Omit<MyriadPaginatedMarketsQuery, "page" | "limit"> & { limit?: number; maxItems?: number } = {}
  ): Promise<MyriadMarketCrawlerResult> {
    const limit = Math.min(query.limit ?? 100, 100)
    const maxItems = query.maxItems ?? null
    let page = 1
    let pagesFetched = 0
    const markets: MyriadMarketSummary[] = []

    while (true) {
      const response = await this.config.client.listMarkets({ ...query, page, limit })
      pagesFetched += 1
      markets.push(...response.data)
      this.config.logger?.info({ page, limit, returned: response.data.length }, "Fetched Myriad markets page.")
      if (maxItems !== null && markets.length >= maxItems) {
        break
      }
      if (!response.pagination.hasNext) {
        break
      }
      page += 1
    }

    return {
      markets: sortMarkets(maxItems === null ? markets : markets.slice(0, maxItems)),
      pagesFetched
    }
  }
}
