import type { Logger } from "pino"

import {
  LimitlessSchemaParseError,
  parseLimitlessHistoricalPriceResponse,
  parseLimitlessMarketDetailResponse,
  parseLimitlessMarketEventsResponse,
  parseLimitlessPortfolioHistoryResponse,
  parseLimitlessPortfolioTradesResponse
} from "./limitless-schemas.js"

type QueryValue = string | number | boolean
type QueryParams = Readonly<Record<string, QueryValue | undefined>>

export type LimitlessHistoricalPriceQuery = Readonly<{
  slug: string;
  from?: string;
  to?: string;
  interval?: "1h" | "6h" | "1d" | "1w" | "1m" | "all";
}>

export type LimitlessMarketEventsQuery = Readonly<{
  slug: string;
  page?: number;
  limit?: number;
}>

export type LimitlessPortfolioHistoryQuery = Readonly<{
  page: number;
  limit: number;
  from?: string;
  to?: string;
}>

export interface LimitlessRetryConfig {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface LimitlessHistoricalClientConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  retry?: LimitlessRetryConfig;
}

export class LimitlessClientError extends Error {
  public readonly status: number | null
  public readonly endpoint: string

  public constructor(message: string, endpoint: string, status: number | null = null) {
    super(message)
    this.name = "LimitlessClientError"
    this.status = status
    this.endpoint = endpoint
  }
}

export class LimitlessRateLimitError extends LimitlessClientError {
  public readonly retryAfterMs: number | null

  public constructor(message: string, endpoint: string, retryAfterMs: number | null) {
    super(message, endpoint, 429)
    this.name = "LimitlessRateLimitError"
    this.retryAfterMs = retryAfterMs
  }
}

export class LimitlessResponseValidationError extends Error {
  public readonly endpoint: string

  public constructor(message: string, endpoint: string) {
    super(message)
    this.name = "LimitlessResponseValidationError"
    this.endpoint = endpoint
  }
}

export const LIMITLESS_HISTORICAL_ENDPOINTS = Object.freeze({
  marketDetail: (addressOrSlug: string) => `/markets/${encodeURIComponent(addressOrSlug)}`,
  historicalPrice: (slug: string) => `/markets/${encodeURIComponent(slug)}/historical-price`,
  marketEvents: (slug: string) => `/markets/${encodeURIComponent(slug)}/events`,
  portfolioHistory: "/portfolio/history",
  portfolioTrades: "/portfolio/trades"
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
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
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

export type LimitlessMarketDetail = ReturnType<typeof parseLimitlessMarketDetailResponse>
export type LimitlessHistoricalPriceSeries = ReturnType<typeof parseLimitlessHistoricalPriceResponse>[number]
export type LimitlessHistoricalPricePoint = LimitlessHistoricalPriceSeries["prices"][number]
export type LimitlessMarketEvent = ReturnType<typeof parseLimitlessMarketEventsResponse>["events"][number]
export type LimitlessPortfolioHistoryEntry = ReturnType<typeof parseLimitlessPortfolioHistoryResponse>["data"][number]
export type LimitlessPortfolioTradesResponse = ReturnType<typeof parseLimitlessPortfolioTradesResponse>

export class LimitlessHistoricalClient {
  private readonly fetchImpl: typeof fetch
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined
  private readonly retry: Required<LimitlessRetryConfig>

  public constructor(private readonly config: LimitlessHistoricalClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch
    this.logger = config.logger
    this.retry = {
      maxRetries: config.retry?.maxRetries ?? defaultRetryConfig.maxRetries,
      baseBackoffMs: config.retry?.baseBackoffMs ?? defaultRetryConfig.baseBackoffMs,
      maxBackoffMs: config.retry?.maxBackoffMs ?? defaultRetryConfig.maxBackoffMs
    }
  }

  public getMarketDetail(addressOrSlug: string): Promise<LimitlessMarketDetail> {
    return this.request("getMarketDetail", LIMITLESS_HISTORICAL_ENDPOINTS.marketDetail(addressOrSlug), undefined, parseLimitlessMarketDetailResponse)
  }

  public getHistoricalPrice(query: LimitlessHistoricalPriceQuery): Promise<LimitlessHistoricalPriceSeries[]> {
    const { slug, ...rest } = query
    return this.request("getHistoricalPrice", LIMITLESS_HISTORICAL_ENDPOINTS.historicalPrice(slug), rest, parseLimitlessHistoricalPriceResponse)
  }

  public getMarketEvents(query: LimitlessMarketEventsQuery) {
    const { slug, ...rest } = query
    return this.request("getMarketEvents", LIMITLESS_HISTORICAL_ENDPOINTS.marketEvents(slug), rest, parseLimitlessMarketEventsResponse)
  }

  public getPortfolioHistory(query: LimitlessPortfolioHistoryQuery) {
    return this.request("getPortfolioHistory", LIMITLESS_HISTORICAL_ENDPOINTS.portfolioHistory, query, parseLimitlessPortfolioHistoryResponse)
  }

  public getPortfolioTrades(): Promise<LimitlessPortfolioTradesResponse> {
    return this.request("getPortfolioTrades", LIMITLESS_HISTORICAL_ENDPOINTS.portfolioTrades, undefined, parseLimitlessPortfolioTradesResponse)
  }

  private async request<T>(
    operation: string,
    path: string,
    query: QueryParams | undefined,
    parser: (payload: unknown) => T
  ): Promise<T> {
    const url = buildUrl(this.config.baseUrl, path, query)

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt += 1) {
      try {
        this.logger?.info({ operation, url, query, attempt }, "Calling Limitless historical endpoint.")
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-API-Key": this.config.apiKey
          }
        })

        if (!response.ok) {
          const retriable = isRetriableStatus(response.status)
          if (!retriable) {
            throw new LimitlessClientError(
              `Limitless request failed with non-retriable status ${response.status}.`,
              path,
              response.status
            )
          }

          if (response.status === 429) {
            const retryAfterMs = parseRetryAfterMs(response, this.retry.baseBackoffMs)
            if (attempt >= this.retry.maxRetries) {
              throw new LimitlessRateLimitError("Limitless request exhausted retries after rate limiting.", path, retryAfterMs)
            }
            this.logger?.warn({ operation, url, attempt, retryAfterMs }, "Limitless rate limit encountered. Retrying.")
            await sleep(retryAfterMs)
            continue
          }

          if (attempt >= this.retry.maxRetries) {
            throw new LimitlessClientError(`Limitless request exhausted retries after status ${response.status}.`, path, response.status)
          }

          const backoffMs = Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs)
          this.logger?.warn({ operation, url, attempt, backoffMs, status: response.status }, "Limitless server error encountered. Retrying.")
          await sleep(backoffMs)
          continue
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch (error) {
          throw new LimitlessClientError(
            `Limitless response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            path,
            response.status
          )
        }

        try {
          return parser(payload)
        } catch (error) {
          if (error instanceof LimitlessSchemaParseError) {
            throw new LimitlessResponseValidationError(error.message, path)
          }
          throw error
        }
      } catch (error) {
        const isRetryableNetworkError = error instanceof TypeError
        if (!isRetryableNetworkError || attempt >= this.retry.maxRetries) {
          throw error
        }

        const backoffMs = Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs)
        this.logger?.warn({ operation, url, attempt, backoffMs, error }, "Limitless network error encountered. Retrying.")
        await sleep(backoffMs)
      }
    }

    throw new LimitlessClientError("Limitless request exhausted retries.", path)
  }
}

