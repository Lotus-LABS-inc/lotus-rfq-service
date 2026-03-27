import type { Logger } from "pino";

import {
  PREDICT_MAINNET_BASE_URL,
  PREDICT_TESTNET_BASE_URL,
  type PredictEnvironment
} from "./predict-types.js";
import {
  PredictSchemaParseError,
  parsePredictAccountActivityResponse,
  parsePredictAuthMessageResponse,
  parsePredictConnectedAccountResponse,
  parsePredictJwtResponse,
  parsePredictMarketLastSaleResponse,
  parsePredictMarketOrderbookResponse,
  parsePredictMarketResponse,
  parsePredictMarketStatisticsResponse,
  parsePredictMarketsResponse,
  parsePredictOrderMatchEventsResponse,
  parsePredictOrderResponse,
  parsePredictOrdersResponse,
  parsePredictPositionsResponse
} from "./predict-schemas.js";

type QueryValue = string | number | boolean;
type QueryParams = Readonly<Record<string, QueryValue | undefined>>;

export interface PredictRetryConfig {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface PredictClientConfig {
  environment: PredictEnvironment;
  baseUrl?: string;
  apiKey?: string;
  jwt?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  retry?: PredictRetryConfig;
}

export interface PredictMarketsQuery {
  category?: string;
  tag?: string;
  state?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PredictOrdersQuery {
  marketId?: string;
  status?: string;
  maker?: string;
  page?: number;
  limit?: number;
}

export interface PredictOrderMatchesQuery {
  marketId?: string;
  orderHash?: string;
  page?: number;
  limit?: number;
}

export interface PredictAccountActivityQuery {
  page?: number;
  limit?: number;
}

export interface PredictPositionsQuery {
  marketId?: string;
}

export interface PredictJwtRequest {
  address: string;
  signature: string;
  message: string;
}

export class PredictClientError extends Error {
  public readonly status: number | null;
  public readonly endpoint: string;

  public constructor(message: string, endpoint: string, status: number | null = null) {
    super(message);
    this.name = "PredictClientError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class PredictResponseValidationError extends Error {
  public readonly endpoint: string;

  public constructor(message: string, endpoint: string) {
    super(message);
    this.name = "PredictResponseValidationError";
    this.endpoint = endpoint;
  }
}

export const PREDICT_ENDPOINTS = Object.freeze({
  markets: "/v1/markets",
  marketById: (id: string) => `/v1/markets/${encodeURIComponent(id)}`,
  marketStats: (id: string) => `/v1/markets/${encodeURIComponent(id)}/stats`,
  marketLastSale: (id: string) => `/v1/markets/${encodeURIComponent(id)}/last-sale`,
  marketOrderbook: (id: string) => `/v1/markets/${encodeURIComponent(id)}/orderbook`,
  orders: "/v1/orders",
  orderByHash: (hash: string) => `/v1/orders/${encodeURIComponent(hash)}`,
  orderMatches: "/v1/orders/matches",
  account: "/v1/account",
  accountActivity: "/v1/account/activity",
  positions: "/v1/positions",
  positionsByAddress: (address: string) => `/v1/positions/${encodeURIComponent(address)}`,
  authMessage: "/v1/auth/message",
  auth: "/v1/auth"
});

const defaultRetry = Object.freeze({
  maxRetries: 2,
  baseBackoffMs: 500,
  maxBackoffMs: 5_000
});

const isRetriableStatus = (status: number): boolean => status === 429 || status >= 500;

const buildUrl = (baseUrl: string, path: string, query?: QueryParams): string => {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }
};

const parseRetryAfterMs = (response: Response, fallbackMs: number): number => {
  const header = response.headers.get("retry-after");
  const parsed = header === null ? Number.NaN : Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000 : fallbackMs;
};

const resolveBaseUrl = (config: PredictClientConfig): string =>
  config.baseUrl ?? (config.environment === "mainnet" ? PREDICT_MAINNET_BASE_URL : PREDICT_TESTNET_BASE_URL);

export type PredictMarketsResponse = ReturnType<typeof parsePredictMarketsResponse>;
export type PredictMarketResponse = ReturnType<typeof parsePredictMarketResponse>;
export type PredictMarketStatisticsResponse = ReturnType<typeof parsePredictMarketStatisticsResponse>;
export type PredictMarketLastSaleResponse = ReturnType<typeof parsePredictMarketLastSaleResponse>;
export type PredictMarketOrderbookResponse = ReturnType<typeof parsePredictMarketOrderbookResponse>;
export type PredictOrdersResponse = ReturnType<typeof parsePredictOrdersResponse>;
export type PredictOrderResponse = ReturnType<typeof parsePredictOrderResponse>;
export type PredictOrderMatchEventsResponse = ReturnType<typeof parsePredictOrderMatchEventsResponse>;
export type PredictConnectedAccountResponse = ReturnType<typeof parsePredictConnectedAccountResponse>;
export type PredictAccountActivityResponse = ReturnType<typeof parsePredictAccountActivityResponse>;
export type PredictPositionsResponse = ReturnType<typeof parsePredictPositionsResponse>;
export type PredictAuthMessageResponse = ReturnType<typeof parsePredictAuthMessageResponse>;
export type PredictJwtResponse = ReturnType<typeof parsePredictJwtResponse>;

export class PredictClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly retry: Required<PredictRetryConfig>;
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

  public constructor(private readonly config: PredictClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.baseUrl = resolveBaseUrl(config);
    this.retry = {
      maxRetries: config.retry?.maxRetries ?? defaultRetry.maxRetries,
      baseBackoffMs: config.retry?.baseBackoffMs ?? defaultRetry.baseBackoffMs,
      maxBackoffMs: config.retry?.maxBackoffMs ?? defaultRetry.maxBackoffMs
    };
    this.logger = config.logger;
  }

  public getMarkets(query: PredictMarketsQuery = {}): Promise<PredictMarketsResponse> {
    return this.request("getMarkets", "GET", PREDICT_ENDPOINTS.markets, query as QueryParams, undefined, parsePredictMarketsResponse);
  }

  public getMarketById(marketId: string): Promise<PredictMarketResponse> {
    return this.request("getMarketById", "GET", PREDICT_ENDPOINTS.marketById(marketId), undefined, undefined, parsePredictMarketResponse);
  }

  public getMarketStatistics(marketId: string): Promise<PredictMarketStatisticsResponse> {
    return this.request("getMarketStatistics", "GET", PREDICT_ENDPOINTS.marketStats(marketId), undefined, undefined, parsePredictMarketStatisticsResponse);
  }

  public getMarketLastSale(marketId: string): Promise<PredictMarketLastSaleResponse> {
    return this.request("getMarketLastSale", "GET", PREDICT_ENDPOINTS.marketLastSale(marketId), undefined, undefined, parsePredictMarketLastSaleResponse);
  }

  public getMarketOrderbook(marketId: string): Promise<PredictMarketOrderbookResponse> {
    return this.request("getMarketOrderbook", "GET", PREDICT_ENDPOINTS.marketOrderbook(marketId), undefined, undefined, parsePredictMarketOrderbookResponse);
  }

  public getOrders(query: PredictOrdersQuery = {}): Promise<PredictOrdersResponse> {
    return this.request("getOrders", "GET", PREDICT_ENDPOINTS.orders, query as QueryParams, undefined, parsePredictOrdersResponse);
  }

  public getOrderByHash(hash: string): Promise<PredictOrderResponse> {
    return this.request("getOrderByHash", "GET", PREDICT_ENDPOINTS.orderByHash(hash), undefined, undefined, parsePredictOrderResponse);
  }

  public getOrderMatchEvents(query: PredictOrderMatchesQuery = {}): Promise<PredictOrderMatchEventsResponse> {
    return this.request("getOrderMatchEvents", "GET", PREDICT_ENDPOINTS.orderMatches, query as QueryParams, undefined, parsePredictOrderMatchEventsResponse);
  }

  public getConnectedAccount(): Promise<PredictConnectedAccountResponse> {
    return this.request("getConnectedAccount", "GET", PREDICT_ENDPOINTS.account, undefined, undefined, parsePredictConnectedAccountResponse, true);
  }

  public getAccountActivity(query: PredictAccountActivityQuery = {}): Promise<PredictAccountActivityResponse> {
    return this.request("getAccountActivity", "GET", PREDICT_ENDPOINTS.accountActivity, query as QueryParams, undefined, parsePredictAccountActivityResponse, true);
  }

  public getPositions(query: PredictPositionsQuery = {}): Promise<PredictPositionsResponse> {
    return this.request("getPositions", "GET", PREDICT_ENDPOINTS.positions, query as QueryParams, undefined, parsePredictPositionsResponse, true);
  }

  public getPositionsByAddress(address: string): Promise<PredictPositionsResponse> {
    return this.request("getPositionsByAddress", "GET", PREDICT_ENDPOINTS.positionsByAddress(address), undefined, undefined, parsePredictPositionsResponse);
  }

  public getAuthMessage(address?: string): Promise<PredictAuthMessageResponse> {
    return this.request(
      "getAuthMessage",
      "GET",
      PREDICT_ENDPOINTS.authMessage,
      address ? { address } : undefined,
      undefined,
      parsePredictAuthMessageResponse
    );
  }

  public getJwtWithValidSignature(input: PredictJwtRequest): Promise<PredictJwtResponse> {
    return this.request("getJwtWithValidSignature", "POST", PREDICT_ENDPOINTS.auth, undefined, input, parsePredictJwtResponse);
  }

  private async request<T>(
    operation: string,
    method: "GET" | "POST",
    path: string,
    query: QueryParams | undefined,
    body: unknown,
    parser: (payload: unknown) => T,
    requiresJwt = false
  ): Promise<T> {
    const url = buildUrl(this.baseUrl, path, query);

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt += 1) {
      try {
        this.logger?.info({ operation, path, method, attempt }, "Calling Predict endpoint.");
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...(this.config.apiKey ? { "x-api-key": this.config.apiKey } : {})
        };
        if (body !== undefined) {
          headers["content-type"] = "application/json";
        }
        if (requiresJwt && this.config.jwt) {
          headers.authorization = `Bearer ${this.config.jwt}`;
        }

        const response = await this.fetchImpl(url, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        });

        if (!response.ok) {
          if (!isRetriableStatus(response.status) || attempt >= this.retry.maxRetries) {
            throw new PredictClientError(`Predict request failed with status ${response.status}.`, path, response.status);
          }
          const backoffMs = response.status === 429
            ? parseRetryAfterMs(response, this.retry.baseBackoffMs)
            : Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs);
          this.logger?.warn({ operation, path, attempt, status: response.status, backoffMs }, "Predict request retry scheduled.");
          await sleep(backoffMs);
          continue;
        }

        const payload = await response.json();
        try {
          return parser(payload);
        } catch (error) {
          if (error instanceof PredictSchemaParseError) {
            throw new PredictResponseValidationError(error.message, path);
          }
          throw error;
        }
      } catch (error) {
        const retryableNetworkError = error instanceof TypeError;
        if (!retryableNetworkError || attempt >= this.retry.maxRetries) {
          throw error;
        }
        const backoffMs = Math.min(this.retry.baseBackoffMs * (attempt + 1), this.retry.maxBackoffMs);
        this.logger?.warn({ operation, path, attempt, backoffMs, error }, "Predict network error encountered. Retrying.");
        await sleep(backoffMs);
      }
    }

    throw new PredictClientError("Predict request exhausted retries.", path);
  }
}
