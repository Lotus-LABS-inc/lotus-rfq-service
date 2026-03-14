import type { Logger } from "pino"

import {
  PredexonSchemaParseError,
  parsePredexonCandlesticksResponse,
  parsePredexonEventsResponse,
  parsePredexonMarketPriceResponse,
  parsePredexonMarketsResponse,
  parsePredexonOpenInterestResponse,
  parsePredexonOrderbooksResponse,
  parsePredexonTradesResponse,
  parsePredexonVolumeResponse
} from "./predexon-schemas.js"

type ArrayElement<T extends readonly unknown[]> = T[number]
type QueryValue = string | number | boolean | readonly string[]
type QueryParams = Readonly<Record<string, QueryValue | undefined>>

export type PredexonMarketsQuery = Readonly<{
  status?: "open" | "closed";
  min_price?: number;
  max_price?: number;
  min_open_interest?: number;
  min_volume?: number;
  tags?: readonly string[];
  event_slug?: readonly string[];
  search?: string;
  condition_id?: readonly string[];
  question_id?: readonly string[];
  market_id?: readonly string[];
  market_slug?: readonly string[];
  token_id?: readonly string[];
  sort?:
    | "volume"
    | "open_interest"
    | "price_desc"
    | "price_asc"
    | "expiration"
    | "expiration_asc"
    | "created"
    | "created_asc"
    | "relevance"
    | "volume_1d"
    | "volume_7d"
    | "volume_30d"
    | "trades_1d"
    | "trades_7d"
    | "trades_30d"
    | "oi_change_1d"
    | "oi_change_7d"
    | "oi_change_30d";
  limit?: number;
  offset?: number;
  min_volume_1d?: number;
  min_volume_7d?: number;
  min_volume_30d?: number;
  min_trades_1d?: number;
  min_trades_7d?: number;
  min_trades_30d?: number;
}>

export type PredexonEventsQuery = Readonly<{
  status?: "open" | "closed";
  category?: string;
  search?: string;
  id?: readonly string[];
  slug?: readonly string[];
  tag?: readonly string[];
  sort?: "created" | "created_asc" | "start_date" | "start_date_asc" | "end_date" | "end_date_desc" | "title" | "relevance";
  limit?: number;
  offset?: number;
}>

export type PredexonCandlesticksQuery = Readonly<{
  condition_id: string;
  start_time?: number;
  end_time?: number;
  interval?: number;
}>

export type PredexonMarketPriceQuery = Readonly<{
  token_id: string;
  at_time?: number;
}>

export type PredexonOrderbooksQuery = Readonly<{
  token_id: string;
  start_time: number;
  end_time: number;
  limit?: number;
  pagination_key?: string;
}>

export type PredexonTradesQuery = Readonly<{
  market_slug?: string;
  condition_id?: string;
  token_id?: string;
  wallet?: string;
  start_time?: number;
  end_time?: number;
  min_total?: number;
  limit?: number;
  order?: "asc" | "desc";
  pagination_key?: string;
}>

export type PredexonVolumeQuery = Readonly<{
  token_id: string;
  granularity?: "day" | "week" | "month" | "year" | "all";
  start_time?: number;
  end_time?: number;
}>

export type PredexonOpenInterestQuery = Readonly<{
  condition_id: string;
  granularity?: "day" | "week" | "month" | "year" | "all";
  start_time?: number;
  end_time?: number;
}>

export interface PredexonRetryConfig {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface PredexonHistoricalClientConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  retry?: PredexonRetryConfig;
}

export class PredexonClientError extends Error {
  public readonly status: number | null
  public readonly endpoint: string

  public constructor(message: string, endpoint: string, status: number | null = null) {
    super(message)
    this.name = "PredexonClientError"
    this.status = status
    this.endpoint = endpoint
  }
}

export class PredexonRateLimitError extends PredexonClientError {
  public readonly retryAfterMs: number | null

  public constructor(message: string, endpoint: string, retryAfterMs: number | null) {
    super(message, endpoint, 429)
    this.name = "PredexonRateLimitError"
    this.retryAfterMs = retryAfterMs
  }
}

export class PredexonResponseValidationError extends Error {
  public readonly endpoint: string

  public constructor(message: string, endpoint: string) {
    super(message)
    this.name = "PredexonResponseValidationError"
    this.endpoint = endpoint
  }
}

export const PREDExonHistoricalEndpoints = Object.freeze({
  listMarkets: "/v2/polymarket/markets",
  listEvents: "/v2/polymarket/events",
  candlesticks: (conditionId: string) => `/v2/polymarket/candlesticks/${encodeURIComponent(conditionId)}`,
  marketPrice: (tokenId: string) => `/v2/polymarket/market-price/${encodeURIComponent(tokenId)}`,
  orderbooks: "/v2/polymarket/orderbooks",
  trades: "/v2/polymarket/trades",
  volume: (tokenId: string) => `/v2/polymarket/markets/${encodeURIComponent(tokenId)}/volume`,
  openInterest: (conditionId: string) =>
    `/v2/polymarket/markets/${encodeURIComponent(conditionId)}/open_interest`
})

const defaultRetryConfig = Object.freeze({
  maxRetries: 2,
  baseBackoffMs: 1_000,
  maxBackoffMs: 5_000
})

const isRetriableStatus = (status: number): boolean => status === 429 || status >= 500

const buildUrl = (baseUrl: string, path: string, query?: QueryParams): string => {
  const url = new URL(path, baseUrl)
  if (!query) {
    return url.toString()
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item)
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

const parseRetryAfterMs = (response: Response, fallbackMs: number): number => {
  const retryAfter = response.headers.get("retry-after")
  const parsed = retryAfter === null ? Number.NaN : Number.parseInt(retryAfter, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000 : fallbackMs
}

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationMs))
  }
}

export type PredexonMarket = ArrayElement<ReturnType<typeof parsePredexonMarketsResponse>>
export type PredexonEvent = ArrayElement<ReturnType<typeof parsePredexonEventsResponse>>
export type PredexonCandle = ArrayElement<ReturnType<typeof parsePredexonCandlesticksResponse>>
export type PredexonMarketPrice = ReturnType<typeof parsePredexonMarketPriceResponse>
export type PredexonOrderbookSnapshot = ArrayElement<ReturnType<typeof parsePredexonOrderbooksResponse>>
export type PredexonTrade = ArrayElement<ReturnType<typeof parsePredexonTradesResponse>>
export type PredexonVolumePoint = ArrayElement<ReturnType<typeof parsePredexonVolumeResponse>>
export type PredexonOpenInterestPoint = ArrayElement<ReturnType<typeof parsePredexonOpenInterestResponse>>

export class PredexonHistoricalClient {
  private readonly fetchImpl: typeof fetch
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined
  private readonly retry: Required<PredexonRetryConfig>

  public constructor(private readonly config: PredexonHistoricalClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch
    this.logger = config.logger
    this.retry = {
      maxRetries: config.retry?.maxRetries ?? defaultRetryConfig.maxRetries,
      baseBackoffMs: config.retry?.baseBackoffMs ?? defaultRetryConfig.baseBackoffMs,
      maxBackoffMs: config.retry?.maxBackoffMs ?? defaultRetryConfig.maxBackoffMs
    }
  }

  public listMarkets(query: PredexonMarketsQuery = {}): Promise<PredexonMarket[]> {
    return this.request("listMarkets", PREDExonHistoricalEndpoints.listMarkets, query, parsePredexonMarketsResponse)
  }

  public listEvents(query: PredexonEventsQuery = {}): Promise<PredexonEvent[]> {
    return this.request("listEvents", PREDExonHistoricalEndpoints.listEvents, query, parsePredexonEventsResponse)
  }

  public getCandlesticks(query: PredexonCandlesticksQuery): Promise<PredexonCandle[]> {
    const { condition_id, ...rest } = query
    return this.request("getCandlesticks", PREDExonHistoricalEndpoints.candlesticks(condition_id), rest, parsePredexonCandlesticksResponse)
  }

  public getMarketPrice(query: PredexonMarketPriceQuery): Promise<PredexonMarketPrice> {
    const { token_id, ...rest } = query
    return this.request("getMarketPrice", PREDExonHistoricalEndpoints.marketPrice(token_id), rest, parsePredexonMarketPriceResponse)
  }

  public getOrderbookHistory(query: PredexonOrderbooksQuery): Promise<PredexonOrderbookSnapshot[]> {
    return this.request("getOrderbookHistory", PREDExonHistoricalEndpoints.orderbooks, query, parsePredexonOrderbooksResponse)
  }

  public getTradesHistory(query: PredexonTradesQuery): Promise<PredexonTrade[]> {
    return this.request("getTradesHistory", PREDExonHistoricalEndpoints.trades, query, parsePredexonTradesResponse)
  }

  public getVolumeTimeSeries(query: PredexonVolumeQuery): Promise<PredexonVolumePoint[]> {
    const { token_id, ...rest } = query
    return this.request("getVolumeTimeSeries", PREDExonHistoricalEndpoints.volume(token_id), rest, parsePredexonVolumeResponse)
  }

  public getOpenInterestTimeSeries(query: PredexonOpenInterestQuery): Promise<PredexonOpenInterestPoint[]> {
    const { condition_id, ...rest } = query
    return this.request("getOpenInterestTimeSeries", PREDExonHistoricalEndpoints.openInterest(condition_id), rest, parsePredexonOpenInterestResponse)
  }

  private async request<T>(operation: string, path: string, query: QueryParams | undefined, parser: (payload: unknown) => T): Promise<T> {
    const url = buildUrl(this.config.baseUrl, path, query)

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt += 1) {
      try {
        this.logger?.info?.({ operation, url, attempt }, "Predexon request started.")
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "x-api-key": this.config.apiKey
          }
        })

        if (isRetriableStatus(response.status) && attempt < this.retry.maxRetries) {
          const waitMs = Math.min(parseRetryAfterMs(response, this.retry.baseBackoffMs * (attempt + 1)), this.retry.maxBackoffMs)
          this.logger?.warn?.({ operation, url, attempt, status: response.status, waitMs }, "Predexon request retry scheduled.")
          await sleep(waitMs)
          continue
        }

        if (response.status === 429) {
          throw new PredexonRateLimitError(`Predexon rate limit encountered for ${operation}.`, path, parseRetryAfterMs(response, this.retry.baseBackoffMs))
        }

        if (!response.ok) {
          throw new PredexonClientError(`Predexon request failed for ${operation}. Status: ${response.status}.`, path, response.status)
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          throw new PredexonClientError(`Predexon returned invalid JSON for ${operation}.`, path, response.status)
        }

        try {
          const parsed = parser(payload)
          this.logger?.info?.({ operation, url, attempt, status: response.status }, "Predexon request completed.")
          return parsed
        } catch (error) {
          if (error instanceof PredexonSchemaParseError) {
            throw new PredexonResponseValidationError(error.message, path)
          }
          throw error
        }
      } catch (error) {
        if (
          error instanceof PredexonRateLimitError ||
          error instanceof PredexonClientError ||
          error instanceof PredexonResponseValidationError
        ) {
          this.logger?.error?.({ err: error, operation, url, attempt }, "Predexon request failed.")
          throw error
        }

        if (attempt < this.retry.maxRetries) {
          const waitMs = Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs)
          this.logger?.warn?.({ err: error, operation, url, attempt, waitMs }, "Predexon network failure retried.")
          await sleep(waitMs)
          continue
        }

        this.logger?.error?.({ err: error, operation, url, attempt }, "Predexon request exhausted retries.")
        throw new PredexonClientError(`Predexon network request failed for ${operation}.`, path)
      }
    }

    throw new PredexonClientError(`Predexon request exhausted retry budget for ${operation}.`, path)
  }
}
