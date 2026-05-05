import type { Logger } from "pino"

import {
  MyriadSchemaParseError,
  parseMyriadMarketDetailResponse,
  parseMyriadMarketEventsResponse,
  parseMyriadMarketsListResponse,
  parseMyriadQuestionDetailResponse,
  parseMyriadQuestionsListResponse
} from "./myriad-schemas.js"

type QueryValue = string | number | boolean
type QueryParams = Readonly<Record<string, QueryValue | undefined>>

export interface MyriadRetryConfig {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface MyriadClientConfig {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  retry?: MyriadRetryConfig;
}

export type MyriadPaginatedQuestionsQuery = Readonly<{
  page?: number;
  limit?: number;
  keyword?: string;
  min_markets?: number;
  max_markets?: number;
}>

export type MyriadPaginatedMarketsQuery = Readonly<{
  page?: number;
  limit?: number;
  sort?: "volume" | "volume_24h" | "liquidity" | "expires_at" | "published_at" | "featured";
  order?: "asc" | "desc";
  network_id?: string;
  state?: "open" | "closed" | "resolved";
  token_address?: string;
  topics?: string;
  keyword?: string;
  ids?: string;
  in_play?: boolean;
  moneyline?: boolean;
  min_duration?: number;
  max_duration?: number;
  buy_lp_fee_lte?: number;
  sell_fee_lt?: number;
}>

export type MyriadMarketLookup = Readonly<{
  idOrSlug: string | number;
  network_id?: number;
}>

export type MyriadMarketEventsQuery = MyriadMarketLookup & Readonly<{
  page?: number;
  limit?: number;
  since?: number;
  until?: number;
}>

export class MyriadClientError extends Error {
  public readonly status: number | null
  public readonly endpoint: string

  public constructor(message: string, endpoint: string, status: number | null = null) {
    super(message)
    this.name = "MyriadClientError"
    this.status = status
    this.endpoint = endpoint
  }
}

export class MyriadRateLimitError extends MyriadClientError {
  public readonly retryAfterMs: number | null

  public constructor(message: string, endpoint: string, retryAfterMs: number | null) {
    super(message, endpoint, 429)
    this.name = "MyriadRateLimitError"
    this.retryAfterMs = retryAfterMs
  }
}

export class MyriadResponseValidationError extends Error {
  public readonly endpoint: string

  public constructor(message: string, endpoint: string) {
    super(message)
    this.name = "MyriadResponseValidationError"
    this.endpoint = endpoint
  }
}

export const MYRIAD_ENDPOINTS = Object.freeze({
  questions: "/questions",
  questionDetail: (id: string | number) => `/questions/${encodeURIComponent(String(id))}`,
  markets: "/markets",
  marketDetail: (idOrSlug: string | number) => `/markets/${encodeURIComponent(String(idOrSlug))}`,
  marketEvents: (idOrSlug: string | number) => `/markets/${encodeURIComponent(String(idOrSlug))}/events`,
  marketQuote: "/markets/quote"
})

const defaultRetryConfig = Object.freeze({
  maxRetries: 2,
  baseBackoffMs: 1_000,
  maxBackoffMs: 5_000
})

const isRetriableStatus = (status: number): boolean => status === 429 || status >= 500

const buildUrl = (baseUrl: string, path: string, query?: QueryParams): string => {
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationMs))
  }
}

const parseRetryAfterMs = (response: Response, fallbackMs: number): number => {
  const header = response.headers.get("retry-after")
  const parsed = header === null ? Number.NaN : Number.parseInt(header, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000 : fallbackMs
}

export type MyriadQuestionsListResponse = ReturnType<typeof parseMyriadQuestionsListResponse>
export type MyriadMarketsListResponse = ReturnType<typeof parseMyriadMarketsListResponse>
export type MyriadQuestionDetail = ReturnType<typeof parseMyriadQuestionDetailResponse>
export type MyriadMarketDetail = ReturnType<typeof parseMyriadMarketDetailResponse>
export type MyriadMarketEventsResponse = ReturnType<typeof parseMyriadMarketEventsResponse>

export class MyriadClient {
  private readonly fetchImpl: typeof fetch
  private readonly retry: Required<MyriadRetryConfig>
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined

  public constructor(private readonly config: MyriadClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch
    this.logger = config.logger
    this.retry = {
      maxRetries: config.retry?.maxRetries ?? defaultRetryConfig.maxRetries,
      baseBackoffMs: config.retry?.baseBackoffMs ?? defaultRetryConfig.baseBackoffMs,
      maxBackoffMs: config.retry?.maxBackoffMs ?? defaultRetryConfig.maxBackoffMs
    }
  }

  public listQuestions(query: MyriadPaginatedQuestionsQuery = {}): Promise<MyriadQuestionsListResponse> {
    return this.request("listQuestions", MYRIAD_ENDPOINTS.questions, query, parseMyriadQuestionsListResponse)
  }

  public getQuestion(id: string | number): Promise<MyriadQuestionDetail> {
    return this.request("getQuestion", MYRIAD_ENDPOINTS.questionDetail(id), undefined, parseMyriadQuestionDetailResponse)
  }

  public listMarkets(query: MyriadPaginatedMarketsQuery = {}): Promise<MyriadMarketsListResponse> {
    return this.request("listMarkets", MYRIAD_ENDPOINTS.markets, query, parseMyriadMarketsListResponse)
  }

  public getMarket(lookup: MyriadMarketLookup): Promise<MyriadMarketDetail> {
    return this.request(
      "getMarket",
      MYRIAD_ENDPOINTS.marketDetail(lookup.idOrSlug),
      lookup.network_id !== undefined ? { network_id: lookup.network_id } : undefined,
      parseMyriadMarketDetailResponse
    )
  }

  public getMarketEvents(query: MyriadMarketEventsQuery): Promise<MyriadMarketEventsResponse> {
    const { idOrSlug, ...rest } = query
    return this.request("getMarketEvents", MYRIAD_ENDPOINTS.marketEvents(idOrSlug), rest, parseMyriadMarketEventsResponse)
  }

  public async getMarketQuote(input: Record<string, unknown>): Promise<unknown> {
    return this.requestRaw("quoteMarket", "POST", MYRIAD_ENDPOINTS.marketQuote, undefined, input)
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
        this.logger?.info({ operation, path, query, attempt }, "Calling Myriad endpoint.")
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(this.config.apiKey ? { "x-api-key": this.config.apiKey } : {})
          }
        })

        if (!response.ok) {
          if (!isRetriableStatus(response.status)) {
            throw new MyriadClientError(`Myriad request failed with status ${response.status}.`, path, response.status)
          }

          if (response.status === 429) {
            const retryAfterMs = parseRetryAfterMs(response, this.retry.baseBackoffMs)
            if (attempt >= this.retry.maxRetries) {
              throw new MyriadRateLimitError("Myriad request exhausted retries after rate limiting.", path, retryAfterMs)
            }
            this.logger?.warn({ operation, path, attempt, retryAfterMs }, "Myriad rate limit encountered. Retrying.")
            await sleep(retryAfterMs)
            continue
          }

          if (attempt >= this.retry.maxRetries) {
            throw new MyriadClientError(`Myriad request exhausted retries after status ${response.status}.`, path, response.status)
          }

          const backoffMs = Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs)
          this.logger?.warn({ operation, path, attempt, backoffMs, status: response.status }, "Myriad server error encountered. Retrying.")
          await sleep(backoffMs)
          continue
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch (error) {
          throw new MyriadClientError(
            `Myriad response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            path,
            response.status
          )
        }

        try {
          return parser(payload)
        } catch (error) {
          if (error instanceof MyriadSchemaParseError) {
            throw new MyriadResponseValidationError(error.message, path)
          }
          throw error
        }
      } catch (error) {
        const retryableNetworkError = error instanceof TypeError
        if (!retryableNetworkError || attempt >= this.retry.maxRetries) {
          throw error
        }
        const backoffMs = Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs)
        this.logger?.warn({ operation, path, attempt, backoffMs, error }, "Myriad network error encountered. Retrying.")
        await sleep(backoffMs)
      }
    }

    throw new MyriadClientError("Myriad request exhausted retries.", path)
  }

  private async requestRaw(
    operation: string,
    method: "GET" | "POST",
    path: string,
    query: QueryParams | undefined,
    body: unknown
  ): Promise<unknown> {
    const url = buildUrl(this.config.baseUrl, path, query)
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.config.apiKey ? { "x-api-key": this.config.apiKey } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new MyriadClientError(`Myriad ${operation} failed with status ${response.status}.`, path, response.status)
    }
    return payload
  }
}
