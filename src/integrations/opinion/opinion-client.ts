import { parseOpinionMarketDetail, parseOpinionMarketList } from "./opinion-schemas.js";

export interface OpinionClientConfig {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs?: number | undefined;
  maxRetries?: number | undefined;
}

export class OpinionClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "OpinionClientError";
  }
}

export class OpinionClient {
  public constructor(private readonly config: OpinionClientConfig) {}

  public async listMarkets(input: { page: number; limit: number }): Promise<readonly Record<string, unknown>[]> {
    const normalizedBaseUrl = this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`;
    const url = new URL("market", normalizedBaseUrl);
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("limit", String(input.limit));

    const { response, payload } = await this.fetchJsonWithRetry(url, "Opinion /market");

    if (!response.ok) {
      throw new OpinionClientError(`Opinion /market failed with HTTP ${response.status}.`, response.status, payload);
    }

    return parseOpinionMarketList(payload);
  }

  public async getMarketById(input: { marketId: string }): Promise<Record<string, unknown>> {
    return this.getMarketDetail(`market/${encodeURIComponent(input.marketId)}`, "Opinion /market/{marketId}");
  }

  public async getCategoricalMarketById(input: { marketId: string }): Promise<Record<string, unknown>> {
    return this.getMarketDetail(`market/categorical/${encodeURIComponent(input.marketId)}`, "Opinion /market/categorical/{marketId}");
  }

  public async getMarketBySlug(input: { slug: string }): Promise<Record<string, unknown>> {
    return this.getMarketDetail(`market/slug/${encodeURIComponent(input.slug)}`, "Opinion /market/slug/{slug}");
  }

  public async getTokenOrderbook(input: { tokenId: string }): Promise<unknown> {
    const normalizedBaseUrl = this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`;
    const url = new URL("token/orderbook", normalizedBaseUrl);
    url.searchParams.set("token_id", input.tokenId);

    const { response, payload } = await this.fetchJsonWithRetry(url, "Opinion /token/orderbook");

    if (!response.ok) {
      throw new OpinionClientError(`Opinion /token/orderbook failed with HTTP ${response.status}.`, response.status, payload);
    }

    return payload;
  }

  private async getMarketDetail(path: string, operation: string): Promise<Record<string, unknown>> {
    const normalizedBaseUrl = this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`;
    const url = new URL(path, normalizedBaseUrl);

    const { response, payload } = await this.fetchJsonWithRetry(url, operation);

    if (!response.ok) {
      throw new OpinionClientError(`${operation} failed with HTTP ${response.status}.`, response.status, payload);
    }

    return parseOpinionMarketDetail(payload) as Record<string, unknown>;
  }

  private async fetchJsonWithRetry(
    url: URL,
    operation: string
  ): Promise<{ response: Response; payload: unknown }> {
    const maxRetries = Math.max(0, Math.min(3, Math.floor(this.config.maxRetries ?? 2)));
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            apikey: this.config.apiKey
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 8_000)
        });
        const payload = await response.json().catch(() => null) as unknown;
        if (!isRetryableOpinionStatus(response.status) || attempt >= maxRetries) {
          return { response, payload };
        }
        lastError = new OpinionClientError(`${operation} failed with HTTP ${response.status}.`, response.status, payload);
      } catch (error) {
        lastError = error;
        if (!isRetryableOpinionFetchError(error) || attempt >= maxRetries) {
          throw error;
        }
      }
      await sleep(opinionRetryDelayMs(attempt));
    }
    throw lastError instanceof Error ? lastError : new Error(`${operation} failed.`);
  }
}

const isRetryableOpinionStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const isRetryableOpinionFetchError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return name.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("etimedout");
};

const opinionRetryDelayMs = (attempt: number): number =>
  Math.min(750, 150 * (attempt + 1));

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};
