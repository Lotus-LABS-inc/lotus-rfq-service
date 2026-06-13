import { HttpClient, MarketFetcher, type MarketInterface } from "@limitless-exchange/sdk";

import { classifyStructuredOpinionFamily } from "../opinion/opinion-family-classifier.js";
import type { LimitlessLiveMarket } from "./limitless-live-market-loader.js";

export interface LimitlessCurrentDiscoveryClientConfig {
  apiKey?: string | null;
  baseUrl?: string;
  maxPages?: number;
  pageSize?: number;
  maxMissingSlugDetails?: number;
  requestTimeoutMs?: number;
}

export interface LimitlessCurrentDiscoveryResult {
  status: "SUCCESS" | "EMPTY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
  rows: readonly LimitlessLiveMarket[];
  primaryDiscoveryPath: string;
  warnings: readonly string[];
}

const DEFAULT_BASE_URL = "https://api.limitless.exchange";
const PRIMARY_DISCOVERY_PATH = "limitless_sdk_active_markets_with_active_slugs";
const MAX_LIMITLESS_PAGE_SIZE = 25;

interface LimitlessActiveSlug {
  slug: string;
  strikePrice?: string | number | null;
  ticker?: string | null;
  deadline?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeLimitlessActiveSlugs = (payload: unknown): LimitlessActiveSlug[] => {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : [];
  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.slug !== "string" || row.slug.trim().length === 0) {
      return [];
    }
    const normalized: LimitlessActiveSlug = { slug: row.slug.trim() };
    if (typeof row.strikePrice === "string" || typeof row.strikePrice === "number" || row.strikePrice === null) {
      normalized.strikePrice = row.strikePrice;
    }
    if (typeof row.ticker === "string" || row.ticker === null) {
      normalized.ticker = row.ticker;
    }
    if (typeof row.deadline === "string" || row.deadline === null) {
      normalized.deadline = row.deadline;
    }
    return [normalized];
  });
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);

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

const toLimitlessLiveMarket = (
  market: MarketInterface,
  fetchedAt: Date,
  sourceRef: string = PRIMARY_DISCOVERY_PATH
): LimitlessLiveMarket => {
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
    sourceRef,
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
    const warnings: string[] = [];
    const fetchedAt = new Date();
    const rows = new Map<string, LimitlessLiveMarket>();
    const seenSlugs = new Set<string>();
    let degraded = false;

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
      const pageSize = Math.min(this.config.pageSize ?? MAX_LIMITLESS_PAGE_SIZE, MAX_LIMITLESS_PAGE_SIZE);
      const maxPages = this.config.maxPages ?? 120;
      const maxMissingSlugDetails = this.config.maxMissingSlugDetails ?? pageSize * maxPages;
      const requestTimeoutMs = this.config.requestTimeoutMs ?? 10_000;
      let expectedActiveMarketCount: number | null = null;

      for (let page = 1; page <= maxPages; page += 1) {
        const response = await withTimeout(
          marketFetcher.getActiveMarkets({
            page,
            limit: pageSize,
            sortBy: "newest"
          }),
          requestTimeoutMs,
          `Limitless active markets request timed out after ${requestTimeoutMs}ms.`
        );
        if (typeof response.totalMarketsCount === "number" && Number.isFinite(response.totalMarketsCount)) {
          expectedActiveMarketCount = response.totalMarketsCount;
        }
        for (const market of response.data) {
          const row = toLimitlessLiveMarket(market, fetchedAt, "limitless_sdk_active_markets");
          rows.set(row.venueMarketId, row);
          if (row.slug) seenSlugs.add(row.slug);
        }
        if (response.data.length < pageSize) {
          break;
        }
        if (expectedActiveMarketCount !== null && page * pageSize >= expectedActiveMarketCount) {
          break;
        }
        if (page === maxPages && expectedActiveMarketCount !== null && rows.size < expectedActiveMarketCount) {
          warnings.push(`Limitless active market scan reached maxPages=${maxPages} before expected total ${expectedActiveMarketCount}.`);
          degraded = true;
        }
      }

      let activeSlugs: LimitlessActiveSlug[] = [];
      try {
        activeSlugs = normalizeLimitlessActiveSlugs(await withTimeout(
          httpClient.get<unknown>("/markets/active/slugs"),
          requestTimeoutMs,
          `Limitless active slugs request timed out after ${requestTimeoutMs}ms.`
        ));
        if (expectedActiveMarketCount !== null && activeSlugs.length > 0 && activeSlugs.length !== expectedActiveMarketCount) {
          warnings.push(`Limitless active slugs count ${activeSlugs.length} differs from active market total ${expectedActiveMarketCount}.`);
        }
      } catch (error) {
        warnings.push(`Limitless active slugs unavailable: ${error instanceof Error ? error.message : String(error)}`);
        if (rows.size === 0) {
          degraded = true;
        }
      }

      const allMissingSlugs = activeSlugs
        .map((entry) => entry.slug)
        .filter((slug) => !seenSlugs.has(slug));
      const missingSlugs = allMissingSlugs.slice(0, maxMissingSlugDetails);
      for (const slug of missingSlugs) {
        try {
          const market = await withTimeout(
            marketFetcher.getMarket(slug),
            requestTimeoutMs,
            `Limitless market detail request timed out after ${requestTimeoutMs}ms.`
          );
          const row = toLimitlessLiveMarket(market, fetchedAt, "limitless_active_slug_detail");
          rows.set(row.venueMarketId, row);
          if (row.slug) seenSlugs.add(row.slug);
        } catch (error) {
          warnings.push(`Limitless market detail unavailable for ${slug}: ${error instanceof Error ? error.message : String(error)}`);
          degraded = true;
        }
      }
      if (missingSlugs.length < allMissingSlugs.length) {
        warnings.push(`Limitless active slug detail scan capped at ${maxMissingSlugDetails} of ${allMissingSlugs.length} missing slugs.`);
        degraded = true;
      }

      const expectedCount = expectedActiveMarketCount ?? activeSlugs.length;
      degraded = degraded || (expectedCount > 0 && rows.size < expectedCount);
      return {
        status: rows.size > 0 ? (degraded ? "DEGRADED" : "SUCCESS") : "EMPTY",
        rows: [...rows.values()],
        primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
        warnings
      };
    } catch (error) {
      if (rows.size > 0) {
        return {
          status: "DEGRADED",
          rows: [...rows.values()],
          primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
          warnings: [...warnings, error instanceof Error ? error.message : String(error)]
        };
      }
      return {
        status: "UNAVAILABLE",
        rows: [],
        primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
        warnings: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
}
