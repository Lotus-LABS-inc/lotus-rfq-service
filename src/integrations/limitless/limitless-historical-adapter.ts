import type { Logger } from "pino"

import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput,
  type HistoricalVenueAdapter
} from "../../core/historical-simulation/historical-simulation.types.js"
import type {
  LimitlessHistoricalClient,
  LimitlessHistoricalPriceQuery,
  LimitlessMarketEventsQuery,
  LimitlessPortfolioHistoryQuery
} from "./limitless-client.js"

export class LimitlessHistoricalAdapterError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "LimitlessHistoricalAdapterError"
  }
}

export interface LimitlessHistoricalAdapterConfig {
  client: LimitlessHistoricalClient;
  metadataVersion: string;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface LimitlessHistoricalMarketMetadata {
  address: string | null;
  slug: string | null;
  title: string;
  status: string | null;
  tradeType: string | null;
  marketType: string | null;
  volume: string | null;
  openInterest: string | null;
  liquidity: string | null;
  venue: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface HistoricalMarketStateFragment extends Omit<CreateHistoricalMarketStateInput, "id"> {}

export interface LimitlessFragmentContext {
  canonicalEventId: string;
  venueMarketId: string;
}

const toNumericString = (value: string | number | null | undefined): string | null =>
  value === undefined || value === null ? null : String(value)

const toDate = (value: string | number): Date => {
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) {
      throw new LimitlessHistoricalAdapterError(`Limitless timestamp is not a valid ISO string: ${value}.`)
    }
    return new Date(parsed)
  }

  const millis = value >= 1_000_000_000_000 ? value : value * 1_000
  return new Date(millis)
}

const buildBaseFragment = (
  context: LimitlessFragmentContext,
  metadataVersion: string,
  timestamp: Date
): HistoricalMarketStateFragment => ({
  canonicalEventId: context.canonicalEventId,
  venue: "LIMITLESS",
  venueMarketId: context.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp,
  metadataVersion,
  sourceTimestamp: timestamp
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null

const matchesVenueMarket = (entry: Record<string, unknown>, venueMarketId: string): boolean => {
  const market = asRecord(entry.market)
  return market !== null && typeof market.slug === "string" ? market.slug === venueMarketId : false
}

export class LimitlessHistoricalAdapter {
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined

  public constructor(private readonly config: LimitlessHistoricalAdapterConfig) {
    this.logger = config.logger
  }

  public getVenueAdapter(): HistoricalVenueAdapter {
    return {
      venue: "LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      supportsCandles: true,
      supportsOrderbookHistory: false,
      supportsTradesHistory: false,
      supportsOwnExecutionHistory: true,
      metadataVersion: this.config.metadataVersion
    }
  }

  public async getHistoricalMarket(addressOrSlug: string): Promise<LimitlessHistoricalMarketMetadata> {
    const market = await this.config.client.getMarketDetail(addressOrSlug)
    return {
      address: typeof market.address === "string" ? market.address : null,
      slug: typeof market.slug === "string" ? market.slug : null,
      title: market.title,
      status: typeof market.status === "string" ? market.status : null,
      tradeType: typeof market.tradeType === "string" ? market.tradeType : null,
      marketType: typeof market.marketType === "string" ? market.marketType : null,
      volume: toNumericString(market.volume),
      openInterest: toNumericString(market.openInterest),
      liquidity: toNumericString(market.liquidity),
      venue: asRecord(market.venue),
      raw: market
    }
  }

  public async buildHistoricalPriceFragments(
    context: LimitlessFragmentContext,
    query: LimitlessHistoricalPriceQuery
  ): Promise<HistoricalMarketStateFragment[]> {
    const series = await this.config.client.getHistoricalPrice(query)
    return series.flatMap((entry) =>
      entry.prices.map((pricePoint) => {
        const timestamp = toDate(pricePoint.timestamp)
        return {
          ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
          lastPrice: toNumericString(pricePoint.price),
          candles: {
            title: entry.title,
            point: pricePoint
          }
        }
      })
    )
  }

  public async buildMarketEventFragments(
    context: LimitlessFragmentContext,
    query: LimitlessMarketEventsQuery
  ): Promise<HistoricalMarketStateFragment[]> {
    const response = await this.config.client.getMarketEvents(query)
    return response.events.map((event) => {
      const timestamp = toDate(event.timestamp)
      const eventData = asRecord(event.data)
      return {
        ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
        lastPrice:
          eventData && (typeof eventData.price === "string" || typeof eventData.price === "number")
            ? String(eventData.price)
            : null,
        marketEvents: event
      }
    })
  }

  public async buildPortfolioHistoryFragments(
    context: LimitlessFragmentContext,
    query: LimitlessPortfolioHistoryQuery
  ): Promise<HistoricalMarketStateFragment[]> {
    const response = await this.config.client.getPortfolioHistory(query)
    return response.data.filter((entry) => matchesVenueMarket(entry, context.venueMarketId)).map((entry) => {
      const timestamp = toDate(entry.blockTimestamp)
      return {
        ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
        lastPrice: toNumericString(entry.outcomeTokenPrice),
        volume: toNumericString(entry.collateralAmount),
        ownExecutionHistory: entry
      }
    })
  }

  public async getPortfolioTrades(): Promise<Record<string, unknown>> {
    const response = await this.config.client.getPortfolioTrades()
    this.logger?.info("Retrieved raw Limitless portfolio trades payload.")
    return response
  }
}
