import type { Logger } from "pino"

import type { MyriadClient, MyriadMarketEventsQuery, MyriadMarketLookup } from "./myriad-client.js"
import type { MyriadMarketEvent } from "./myriad-schemas.js"

export interface MyriadMarketEventsBackfillConfig {
  client: Pick<MyriadClient, "getMarketEvents">;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface MyriadMarketEventsBackfillInput extends MyriadMarketLookup {
  since?: number;
  until?: number;
  limit?: number;
}

export interface MyriadMarketEventsBackfillResult {
  events: readonly MyriadMarketEvent[];
  pagesFetched: number;
}

export class MyriadMarketEventsBackfill {
  public constructor(private readonly config: MyriadMarketEventsBackfillConfig) {}

  public async backfill(input: MyriadMarketEventsBackfillInput): Promise<MyriadMarketEventsBackfillResult> {
    const limit = Math.min(input.limit ?? 100, 100)
    let page = 1
    let pagesFetched = 0
    const events: MyriadMarketEvent[] = []

    while (true) {
      const query: MyriadMarketEventsQuery = {
        idOrSlug: input.idOrSlug,
        page,
        limit,
        ...(input.network_id !== undefined ? { network_id: input.network_id } : {}),
        ...(input.since !== undefined ? { since: input.since } : {}),
        ...(input.until !== undefined ? { until: input.until } : {})
      }
      const response = await this.config.client.getMarketEvents(query)
      pagesFetched += 1
      events.push(...response.data)
      this.config.logger?.info({ idOrSlug: input.idOrSlug, page, limit, returned: response.data.length }, "Fetched Myriad market events page.")
      if (!response.pagination.hasNext) {
        break
      }
      page += 1
    }

    return {
      events: [...events].sort(
        (left, right) =>
          left.timestamp - right.timestamp ||
          left.blockNumber - right.blockNumber ||
          String(left.marketId).localeCompare(String(right.marketId))
      ),
      pagesFetched
    }
  }
}
