import { parseOpinionMarketList } from "./opinion-schemas.js";

export interface OpinionClientConfig {
  baseUrl: string;
  apiKey: string;
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
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new OpinionClientError(`Opinion /market failed with HTTP ${response.status}.`, response.status, payload);
    }

    return parseOpinionMarketList(payload);
  }

  public async getTokenOrderbook(input: { tokenId: string }): Promise<unknown> {
    const normalizedBaseUrl = this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`;
    const url = new URL("token/orderbook", normalizedBaseUrl);
    url.searchParams.set("token_id", input.tokenId);

    const response = await fetch(url, {
      headers: {
        apikey: this.config.apiKey
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new OpinionClientError(`Opinion /token/orderbook failed with HTTP ${response.status}.`, response.status, payload);
    }

    return payload;
  }
}
