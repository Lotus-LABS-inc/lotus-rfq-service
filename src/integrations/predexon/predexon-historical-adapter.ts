import type { Logger } from "pino"

import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput,
  type HistoricalVenueAdapter
} from "../../core/historical-simulation/historical-simulation.types.js"
import {
  type PredexonHistoricalClient,
  type PredexonCandlesticksQuery,
  type PredexonEventsQuery,
  type PredexonMarketsQuery,
  type PredexonOpenInterestQuery,
  type PredexonOrderbooksQuery,
  type PredexonTradesQuery,
  type PredexonVolumeQuery
} from "./predexon-client.js"

export class PredexonHistoricalAdapterError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "PredexonHistoricalAdapterError"
  }
}

export interface PredexonHistoricalAdapterConfig {
  client: PredexonHistoricalClient;
  metadataVersion: string;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface PredexonHistoricalMarketMetadata {
  marketId: string | null;
  conditionId: string;
  title: string;
  eventId: string | null;
  eventSlug: string | null;
  marketSlug: string | null;
  tokenIds: string[];
  status: string | null;
  volume: string | null;
  liquidity: string | null;
  raw: Record<string, unknown>;
}

export interface PredexonHistoricalEventMetadata {
  eventId: string;
  title: string;
  slug: string | null;
  category: string | null;
  status: string | null;
  startDate: Date | null;
  endDate: Date | null;
  raw: Record<string, unknown>;
}

export interface HistoricalMarketStateFragment extends Omit<CreateHistoricalMarketStateInput, "id"> {}

export interface PredexonFragmentContext {
  canonicalEventId: string;
  venueMarketId: string;
}

export interface PredexonPriceFragmentContext extends PredexonFragmentContext {
  tokenId: string;
  atTime?: number;
}

export interface PredexonVolumeOpenInterestContext extends PredexonFragmentContext {
  tokenId: string;
  conditionId: string;
  volumeQuery?: Omit<PredexonVolumeQuery, "token_id">;
  openInterestQuery?: Omit<PredexonOpenInterestQuery, "condition_id">;
}

const toNumericString = (value: string | number | null | undefined): string | null =>
  value === undefined || value === null ? null : String(value)

const toDate = (value: string | number): Date => {
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) {
      throw new PredexonHistoricalAdapterError(`Predexon timestamp is not a valid ISO string: ${value}.`)
    }
    return new Date(parsed)
  }

  const millis = value >= 1_000_000_000_000 ? value : value * 1_000
  return new Date(millis)
}

const buildBaseFragment = (
  context: PredexonFragmentContext,
  metadataVersion: string,
  timestamp: Date
): HistoricalMarketStateFragment => ({
  canonicalEventId: context.canonicalEventId,
  venue: "POLYMARKET",
  venueMarketId: context.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp,
  metadataVersion,
  sourceTimestamp: timestamp
})

const getTokenIds = (market: Record<string, unknown>): string[] => {
  const tokenIds = Array.isArray(market.token_ids) ? market.token_ids.filter((value): value is string => typeof value === "string") : []
  if (tokenIds.length > 0) {
    return tokenIds
  }

  if (typeof market.token_id === "string") {
    return [market.token_id]
  }

  if (!Array.isArray(market.outcomes)) {
    return []
  }

  return market.outcomes
    .map((outcome) =>
      typeof outcome === "object" && outcome !== null && typeof outcome.token_id === "string" ? outcome.token_id : null
    )
    .filter((value): value is string => value !== null)
}

const topOfBook = (levels: ReadonlyArray<Record<string, unknown>>): string | null => {
  const first = levels[0]
  return first && (typeof first.price === "string" || typeof first.price === "number") ? String(first.price) : null
}

const buildSpread = (bestBid: string | null, bestAsk: string | null): string | null =>
  bestBid !== null && bestAsk !== null ? String(Number(bestAsk) - Number(bestBid)) : null

const buildMidpoint = (bestBid: string | null, bestAsk: string | null): string | null =>
  bestBid !== null && bestAsk !== null ? String((Number(bestBid) + Number(bestAsk)) / 2) : null

export class PredexonHistoricalAdapter {
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined

  public constructor(private readonly config: PredexonHistoricalAdapterConfig) {
    this.logger = config.logger
  }

  public getVenueAdapter(): HistoricalVenueAdapter {
    return {
      venue: "POLYMARKET",
      marketClass: HistoricalMarketClass.BINARY,
      supportsCandles: true,
      supportsOrderbookHistory: true,
      supportsTradesHistory: true,
      supportsOwnExecutionHistory: false,
      metadataVersion: this.config.metadataVersion
    }
  }

  public async listHistoricalMarkets(query: PredexonMarketsQuery = {}): Promise<PredexonHistoricalMarketMetadata[]> {
    const markets = await this.config.client.listMarkets(query)
    return markets.map((market) => ({
      marketId: typeof market.market_id === "string" ? market.market_id : null,
      conditionId: market.condition_id,
      title: market.title,
      eventId: typeof market.event_id === "string" ? market.event_id : null,
      eventSlug: typeof market.event_slug === "string" ? market.event_slug : null,
      marketSlug: typeof market.market_slug === "string" ? market.market_slug : null,
      tokenIds: getTokenIds(market),
      status: typeof market.status === "string" ? market.status : null,
      volume: toNumericString(market.volume),
      liquidity: toNumericString(market.liquidity),
      raw: market
    }))
  }

  public async listHistoricalEvents(query: PredexonEventsQuery = {}): Promise<PredexonHistoricalEventMetadata[]> {
    const events = await this.config.client.listEvents(query)
    return events.map((event) => ({
      eventId: event.id,
      title: event.title,
      slug: typeof event.slug === "string" ? event.slug : null,
      category: typeof event.category === "string" ? event.category : null,
      status: typeof event.status === "string" ? event.status : null,
      startDate: event.start_date === undefined ? null : toDate(event.start_date),
      endDate: event.end_date === undefined ? null : toDate(event.end_date),
      raw: event
    }))
  }

  public async buildCandleStateFragments(
    context: PredexonFragmentContext,
    query: PredexonCandlesticksQuery
  ): Promise<HistoricalMarketStateFragment[]> {
    const candles = await this.config.client.getCandlesticks(query)
    return candles.map((candle) => {
      const timestamp = toDate(candle.timestamp)
      return {
        ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
        lastPrice: toNumericString(candle.close),
        volume: toNumericString(candle.volume),
        candles: candle
      }
    })
  }

  public async buildOrderbookStateFragments(
    context: PredexonFragmentContext,
    query: PredexonOrderbooksQuery
  ): Promise<HistoricalMarketStateFragment[]> {
    const snapshots = await this.config.client.getOrderbookHistory(query)
    return snapshots.map((snapshot) => {
      const timestamp = toDate(snapshot.timestamp)
      const bestBid = topOfBook(snapshot.bids as ReadonlyArray<Record<string, unknown>>)
      const bestAsk = topOfBook(snapshot.asks as ReadonlyArray<Record<string, unknown>>)
      return {
        ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
        bestBid,
        bestAsk,
        spread: buildSpread(bestBid, bestAsk),
        midpoint: buildMidpoint(bestBid, bestAsk),
        orderbookSnapshot: snapshot
      }
    })
  }

  public async buildTradeStateFragments(
    context: PredexonFragmentContext,
    query: PredexonTradesQuery
  ): Promise<HistoricalMarketStateFragment[]> {
    const trades = await this.config.client.getTradesHistory(query)
    return trades.map((trade) => {
      const timestamp = toDate(trade.timestamp)
      return {
        ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
        lastPrice: toNumericString(trade.price),
        volume: toNumericString(trade.amount_usd),
        trades: trade
      }
    })
  }

  public async buildVolumeOpenInterestFragments(
    context: PredexonVolumeOpenInterestContext
  ): Promise<HistoricalMarketStateFragment[]> {
    const [volumePoints, openInterestPoints] = await Promise.all([
      this.config.client.getVolumeTimeSeries({ token_id: context.tokenId, ...(context.volumeQuery ?? {}) }),
      this.config.client.getOpenInterestTimeSeries({ condition_id: context.conditionId, ...(context.openInterestQuery ?? {}) })
    ])
    const byTimestamp = new Map<string, HistoricalMarketStateFragment>()

    for (const point of volumePoints) {
      const timestamp = toDate(point.timestamp)
      const key = timestamp.toISOString()
      byTimestamp.set(key, {
        ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
        volume: toNumericString(point.total_volume ?? point.volume),
        candles: point
      })
    }

    for (const point of openInterestPoints) {
      const timestamp = toDate(point.timestamp)
      const key = timestamp.toISOString()
      const current = byTimestamp.get(key) ?? buildBaseFragment(context, this.config.metadataVersion, timestamp)
      current.openInterest = toNumericString(point.open_interest ?? point.value)
      current.marketEvents = point
      byTimestamp.set(key, current)
    }

    return Array.from(byTimestamp.values()).sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
  }

  public async buildMarketPriceFragment(context: PredexonPriceFragmentContext): Promise<HistoricalMarketStateFragment> {
    const price = await this.config.client.getMarketPrice({
      token_id: context.tokenId,
      ...(context.atTime !== undefined ? { at_time: context.atTime } : {})
    })
    const timestamp = toDate(price.timestamp)
    return {
      ...buildBaseFragment(context, this.config.metadataVersion, timestamp),
      lastPrice: toNumericString(price.price)
    }
  }
}
