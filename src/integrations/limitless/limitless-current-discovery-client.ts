import { HttpClient, MarketFetcher, type MarketInterface } from "@limitless-exchange/sdk";

import { classifyStructuredOpinionFamily } from "../opinion/opinion-family-classifier.js";
import type { LimitlessLiveMarket } from "./limitless-live-market-loader.js";

export interface LimitlessCurrentDiscoveryClientConfig {
  apiKey?: string | null;
  baseUrl?: string;
  maxPages?: number;
  pageSize?: number;
  requestTimeoutMs?: number;
}

export interface LimitlessCurrentDiscoveryResult {
  status: "SUCCESS" | "EMPTY" | "UNAVAILABLE" | "NOT_CONFIGURED";
  rows: readonly LimitlessLiveMarket[];
  primaryDiscoveryPath: string;
  warnings: readonly string[];
}

const DEFAULT_BASE_URL = "https://api.limitless.exchange";
const PRIMARY_DISCOVERY_PATH = "limitless_sdk_active_markets";

const inferCategory = (input: {
  title: string;
  description: string | null;
  categories: readonly string[];
  tags: readonly string[];
}): "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS" | "OTHER" => {
  const labelText = [...input.categories, ...input.tags].join(" ").toUpperCase();
  const text = `${input.title} ${input.description ?? ""} ${labelText}`.toUpperCase();
  if (/(NBA|NFL|NHL|MLB|PREMIER LEAGUE|FOOTBALL|SOCCER|TENNIS|F1)/.test(text)) {
    return "SPORTS";
  }
  if (/(LCK|LCS|LEC|LPL|ESPORT|VALORANT|CS2|LOL|DOTA)/.test(text)) {
    return "ESPORTS";
  }
  if (/(ELECTION|PRESIDENT|POLITIC|TRUMP|GOVERNOR|SENATE)/.test(text)) {
    return "POLITICS";
  }
  if (/(BTC|BITCOIN|ETH|SOL|CRYPTO|BNB|PRICE|ALL TIME HIGH)/.test(text)) {
    return "CRYPTO";
  }
  return "OTHER";
};

const toDateOrNull = (value: string | number | null | undefined): Date | null => {
  if (typeof value === "number") {
    return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};

const toLimitlessLiveMarket = (market: MarketInterface, fetchedAt: Date): LimitlessLiveMarket => {
  const description = typeof market.description === "string" ? market.description : market.proxyTitle ?? null;
  const categories = Array.isArray(market.categories) ? market.categories : [];
  const tags = Array.isArray(market.tags) ? market.tags : [];
  const canonicalCategory = inferCategory({
    title: market.title,
    description,
    categories,
    tags
  });
  const family = classifyStructuredOpinionFamily({
    category: canonicalCategory,
    title: market.title,
    rules: description,
    boundaryReferenceAt: toDateOrNull(market.expirationTimestamp)
  });

  return {
    venueMarketId: market.conditionId ?? market.slug,
    marketId: String(market.id),
    title: market.title,
    description,
    slug: market.slug,
    status: market.status ?? null,
    categories,
    tags,
    createdAt: toDateOrNull(market.createdAt),
    updatedAt: toDateOrNull(market.updatedAt),
    expiresAt: toDateOrNull(market.expirationTimestamp),
    openInterest: market.openInterest ?? null,
    volume: market.volume ?? null,
    liquidity: market.liquidity ?? null,
    marketType: market.marketType ?? null,
    sourceRef: PRIMARY_DISCOVERY_PATH,
    fetchedAt,
    canonicalCategory,
    family: family.familyBucket,
    asset: family.subject,
    timeBoundary: family.deadlineOrSeason,
    threshold: family.threshold,
    raw: market as unknown as Record<string, unknown>
  };
};

export class LimitlessCurrentDiscoveryClient {
  public constructor(private readonly config: LimitlessCurrentDiscoveryClientConfig = {}) {}

  public async listCurrentMarkets(): Promise<LimitlessCurrentDiscoveryResult> {
    try {
      const resolvedApiKey = this.config.apiKey ?? process.env.LIMITLESS_API_KEY ?? null;
      const httpClient = new HttpClient(
        resolvedApiKey
          ? {
              baseURL: this.config.baseUrl ?? process.env.LIMITLESS_BASE_URL ?? DEFAULT_BASE_URL,
              apiKey: resolvedApiKey
            }
          : {
              baseURL: this.config.baseUrl ?? process.env.LIMITLESS_BASE_URL ?? DEFAULT_BASE_URL
            }
      );
      const marketFetcher = new MarketFetcher(httpClient);
      const pageSize = this.config.pageSize ?? 25;
      const maxPages = this.config.maxPages ?? 20;
      const requestTimeoutMs = this.config.requestTimeoutMs ?? 10_000;
      const fetchedAt = new Date();
      const rows = new Map<string, LimitlessLiveMarket>();

      for (let page = 1; page <= maxPages; page += 1) {
        const response = await Promise.race([
          marketFetcher.getActiveMarkets({
            page,
            limit: pageSize,
            sortBy: "newest"
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Limitless active markets request timed out after ${requestTimeoutMs}ms.`)), requestTimeoutMs);
          })
        ]);
        for (const market of response.data) {
          const row = toLimitlessLiveMarket(market, fetchedAt);
          rows.set(row.venueMarketId, row);
        }
        if (response.data.length < pageSize) {
          break;
        }
      }

      return {
        status: rows.size > 0 ? "SUCCESS" : "EMPTY",
        rows: [...rows.values()],
        primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
        warnings: []
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        rows: [],
        primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
        warnings: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
}
