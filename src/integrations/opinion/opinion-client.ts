import { parseOpinionMarketDetail, parseOpinionMarketList } from "./opinion-schemas.js";

export interface OpinionClientConfig {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs?: number | undefined;
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

    const response = await fetch(url, {
      headers: {
        apikey: this.config.apiKey
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 8_000)
    });
    const payload = await response.json();

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

    const response = await fetch(url, {
      headers: {
        apikey: this.config.apiKey
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 8_000)
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new OpinionClientError(`Opinion /token/orderbook failed with HTTP ${response.status}.`, response.status, payload);
    }

    return payload;
  }

  private async getMarketDetail(path: string, operation: string): Promise<Record<string, unknown>> {
    const normalizedBaseUrl = this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`;
    const url = new URL(path, normalizedBaseUrl);

    const response = await fetch(url, {
      headers: {
        apikey: this.config.apiKey
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 8_000)
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new OpinionClientError(`${operation} failed with HTTP ${response.status}.`, response.status, payload);
    }

    return parseOpinionMarketDetail(payload) as Record<string, unknown>;
  }
}
