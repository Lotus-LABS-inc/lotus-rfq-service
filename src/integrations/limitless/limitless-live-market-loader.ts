import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  buildStableTextId,
  buildStableUuid,
  normalizeCategory,
  type CanonicalCategory
} from "../../canonical/canonicalization-types.js";
import type { CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import { classifyStructuredOpinionFamily } from "../opinion/opinion-family-classifier.js";

export interface LimitlessLiveMarket {
  venueMarketId: string;
  marketId: string;
  title: string;
  description: string | null;
  slug: string;
  status: string | null;
  categories: readonly string[];
  tags: readonly string[];
  createdAt: Date | null;
  updatedAt: Date | null;
  expiresAt: Date | null;
  openInterest: string | null;
  volume: string | null;
  liquidity: string | null;
  marketType: string | null;
  sourceRef: string;
  fetchedAt: Date;
  canonicalCategory: CanonicalCategory;
  family: string;
  asset: string | null;
  timeBoundary: string | null;
  threshold: string | null;
  raw: Record<string, unknown>;
}

export interface LimitlessLiveMarketLoadSummary {
  observedAt: string;
  fetchedFromLiveSurface: boolean;
  sourceRefs: readonly string[];
  totalMarkets: number;
  categories: Record<string, number>;
  families: Record<string, number>;
  assets: Record<string, number>;
}

const LIMITLESS_PUBLIC_BASE_URL = "https://limitless.exchange";
const DEFAULT_PATHS = ["/markets", "/markets?search=bitcoin"] as const;
const SNAPSHOT_MARKET_PATTERN =
  /"description":"((?:\\.|[^"\\])*)".*?"title":"((?:\\.|[^"\\])*)".*?"expirationTimestamp":(\d+).*?"createdAt":"((?:\\.|[^"\\])*)".*?"updatedAt":"((?:\\.|[^"\\])*)".*?"categories":\[(.*?)\].*?"tags":\[(.*?)\].*?"openInterest":"((?:\\.|[^"\\])*)".*?"volume":"((?:\\.|[^"\\])*)".*?"liquidity":"((?:\\.|[^"\\])*)".*?"slug":"((?:\\.|[^"\\])*)".*?"status":"((?:\\.|[^"\\])*)".*?"marketType":"((?:\\.|[^"\\])*)"/gs;
const SIMPLE_MARKET_PATTERN =
  /"description":"((?:\\.|[^"\\])*)".*?"title":"((?:\\.|[^"\\])*)".*?"expirationTimestamp":(\d+).*?"slug":"((?:\\.|[^"\\])*)"/gs;

const decodeHtmlJson = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
};

const inferCategory = (input: {
  title: string;
  description: string | null;
  categories: readonly string[];
  tags: readonly string[];
}): CanonicalCategory => {
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
  return normalizeCategory(input.categories[0] ?? "OTHER");
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const parseStringArrayLiteral = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("\"") && entry.endsWith("\""))
    .map((entry) => decodeHtmlJson(entry.slice(1, -1)));

const toDateOrNull = (value: unknown): Date | null => {
  if (typeof value === "number") {
    return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractJsonArrayAfterToken = (html: string, token: string): unknown[] => {
  const results: unknown[] = [];
  let searchIndex = 0;

  while (searchIndex < html.length) {
    const tokenIndex = html.indexOf(token, searchIndex);
    if (tokenIndex === -1) {
      break;
    }

    const arrayStart = html.indexOf("[", tokenIndex + token.length);
    if (arrayStart === -1) {
      break;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;
    let arrayEnd = -1;

    for (let index = arrayStart; index < html.length; index += 1) {
      const character = html[index]!;
      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (character === "\\") {
          escaping = true;
          continue;
        }
        if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
        continue;
      }
      if (character === "[") {
        depth += 1;
        continue;
      }
      if (character === "]") {
        depth -= 1;
        if (depth === 0) {
          arrayEnd = index;
          break;
        }
      }
    }

    if (arrayEnd === -1) {
      break;
    }

    const slice = html.slice(arrayStart, arrayEnd + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      }
    } catch {
      // Ignore malformed payloads and keep searching.
    }

    searchIndex = arrayEnd + 1;
  }

  return results;
};

const parseMarketsFromHtml = (html: string, sourceRef: string, fetchedAt: Date): readonly LimitlessLiveMarket[] => {
  const searchableHtml = html.replace(/\\"/g, "\"");
  const rawMarkets = [
    ...extractJsonArrayAfterToken(searchableHtml, "\"markets\":"),
    ...extractJsonArrayAfterToken(searchableHtml, "\"home-page-banner-markets\"")
  ];
  const parsed = new Map<string, LimitlessLiveMarket>();

  for (const raw of rawMarkets) {
    if (!isObject(raw)) {
      continue;
    }
    const slug = typeof raw.slug === "string" ? raw.slug : null;
    const title = typeof raw.title === "string" ? decodeHtmlJson(raw.title) : null;
    if (!slug || !title) {
      continue;
    }

    const description = typeof raw.description === "string" ? decodeHtmlJson(raw.description) : null;
    const categories = toStringArray(raw.categories);
    const tags = toStringArray(raw.tags);
    const canonicalCategory = inferCategory({
      title,
      description,
      categories,
      tags
    });
    const family = classifyStructuredOpinionFamily({
      category: canonicalCategory,
      title,
      rules: description,
      boundaryReferenceAt: toDateOrNull(raw.expirationTimestamp) ?? toDateOrNull(raw.expirationDate)
    });

    parsed.set(slug, {
      venueMarketId: slug,
      marketId: typeof raw.id === "number" || typeof raw.id === "string" ? String(raw.id) : slug,
      title,
      description,
      slug,
      status: typeof raw.status === "string" ? raw.status : null,
      categories,
      tags,
      createdAt: toDateOrNull(raw.createdAt),
      updatedAt: toDateOrNull(raw.updatedAt),
      expiresAt: toDateOrNull(raw.expirationTimestamp) ?? toDateOrNull(raw.expirationDate),
      openInterest: typeof raw.openInterest === "string" || typeof raw.openInterest === "number" ? String(raw.openInterest) : null,
      volume: typeof raw.volume === "string" || typeof raw.volume === "number" ? String(raw.volume) : null,
      liquidity: typeof raw.liquidity === "string" || typeof raw.liquidity === "number" ? String(raw.liquidity) : null,
      marketType: typeof raw.marketType === "string" ? raw.marketType : null,
      sourceRef,
      fetchedAt,
      canonicalCategory,
      family: family.familyBucket,
      asset: family.subject,
      timeBoundary: family.deadlineOrSeason,
      threshold: family.threshold,
      raw
    });
  }

  for (const match of searchableHtml.matchAll(SNAPSHOT_MARKET_PATTERN)) {
    const title = decodeHtmlJson(match[2] ?? "");
    const slug = decodeHtmlJson(match[11] ?? "");
    if (!title || !slug || parsed.has(slug)) {
      continue;
    }
    const description = decodeHtmlJson(match[1] ?? "");
    const categories = parseStringArrayLiteral(match[6] ?? "");
    const tags = parseStringArrayLiteral(match[7] ?? "");
    const canonicalCategory = inferCategory({
      title,
      description,
      categories,
      tags
    });
    const family = classifyStructuredOpinionFamily({
      category: canonicalCategory,
      title,
      rules: description,
      boundaryReferenceAt: toDateOrNull(match[3] ?? null)
    });

    parsed.set(slug, {
      venueMarketId: slug,
      marketId: slug,
      title,
      description,
      slug,
      status: decodeHtmlJson(match[12] ?? "") || null,
      categories,
      tags,
      createdAt: toDateOrNull(decodeHtmlJson(match[4] ?? "")),
      updatedAt: toDateOrNull(decodeHtmlJson(match[5] ?? "")),
      expiresAt: toDateOrNull(match[3] ?? null),
      openInterest: decodeHtmlJson(match[8] ?? "") || null,
      volume: decodeHtmlJson(match[9] ?? "") || null,
      liquidity: decodeHtmlJson(match[10] ?? "") || null,
      marketType: decodeHtmlJson(match[13] ?? "") || null,
      sourceRef,
      fetchedAt,
      canonicalCategory,
      family: family.familyBucket,
      asset: family.subject,
      timeBoundary: family.deadlineOrSeason,
      threshold: family.threshold,
      raw: {
        title,
        description,
        slug
      }
    });
  }

  for (const match of searchableHtml.matchAll(SIMPLE_MARKET_PATTERN)) {
    const title = decodeHtmlJson(match[2] ?? "");
    const slug = decodeHtmlJson(match[4] ?? "");
    if (!title || !slug || parsed.has(slug)) {
      continue;
    }
    const description = decodeHtmlJson(match[1] ?? "");
    const canonicalCategory = inferCategory({
      title,
      description,
      categories: [],
      tags: []
    });
    const family = classifyStructuredOpinionFamily({
      category: canonicalCategory,
      title,
      rules: description,
      boundaryReferenceAt: toDateOrNull(match[3] ?? null)
    });
    parsed.set(slug, {
      venueMarketId: slug,
      marketId: slug,
      title,
      description,
      slug,
      status: null,
      categories: [],
      tags: [],
      createdAt: null,
      updatedAt: null,
      expiresAt: toDateOrNull(match[3] ?? null),
      openInterest: null,
      volume: null,
      liquidity: null,
      marketType: null,
      sourceRef,
      fetchedAt,
      canonicalCategory,
      family: family.familyBucket,
      asset: family.subject,
      timeBoundary: family.deadlineOrSeason,
      threshold: family.threshold,
      raw: {
        title,
        description,
        slug
      }
    });
  }

  return [...parsed.values()];
};

export const buildLimitlessLiveSeed = (
  market: LimitlessLiveMarket,
  metadataVersion: string
): CuratedCanonicalGraphSeed => ({
  canonicalEventId: buildStableUuid(`limitless-live-event:${market.venueMarketId}`),
  canonicalMarketId: buildStableTextId("limitless-live-market-", market.venueMarketId),
  canonicalCategory: market.canonicalCategory,
  venue: "LIMITLESS",
  venueMarketId: market.venueMarketId,
  title: market.title,
  description: market.description,
  marketType: market.marketType ?? "BINARY",
  marketClass: "BINARY",
  outcomes: [
    { id: "YES", label: "Yes", metadata: { venue: "LIMITLESS" } },
    { id: "NO", label: "No", metadata: { venue: "LIMITLESS" } }
  ],
  outcomeSchema: {
    marketShape: "binary",
    yesLabel: "Yes",
    noLabel: "No"
  },
  topics: [...market.categories, ...market.tags],
  publishedAt: market.createdAt,
  expiresAt: market.expiresAt,
  resolvesAt: market.expiresAt,
  resolutionSource: "limitless_public_market_surface",
  resolutionTitle: market.title,
  resolutionRulesText: market.description,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "unknown",
  rawSourcePayload: market.raw,
  normalizedPayload: {
    sourceRef: market.sourceRef,
    family: market.family,
    asset: market.asset,
    timeBoundary: market.timeBoundary,
    threshold: market.threshold,
    liveFetchTimestamp: market.fetchedAt.toISOString()
  },
  mappingLineage: ["limitless-live-market-loader"],
  sourceMetadataVersion: metadataVersion,
  propositionHints: {
    normalizedPropositionText: `${market.title} ${market.description ?? ""}`.trim()
  },
  executableDisplayName: market.title,
  executableMetadata: {
    source: "limitless-live-market-loader",
    liveCurrentState: true
  }
});

export const loadLimitlessLiveMarkets = async (input: {
  repoRoot: string;
  fetchRemote?: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  paths?: readonly string[];
  requestTimeoutMs?: number;
}): Promise<{
  markets: readonly LimitlessLiveMarket[];
  summary: LimitlessLiveMarketLoadSummary;
}> => {
  const fetchedAt = new Date();
  const sources = new Map<string, string>();
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.baseUrl ?? LIMITLESS_PUBLIC_BASE_URL;
  const paths = input.paths ?? DEFAULT_PATHS;
  const requestTimeoutMs = input.requestTimeoutMs ?? 10_000;

  if (input.fetchRemote ?? true) {
    for (const route of paths) {
      try {
        const response = await Promise.race([
          fetchImpl(new URL(route, baseUrl)),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Limitless live market fetch timed out after ${requestTimeoutMs}ms.`)), requestTimeoutMs);
          })
        ]);
        if (response.ok) {
          sources.set(`${baseUrl}${route}`, await response.text());
        }
      } catch {
        // Fall back to checked-in snapshots below.
      }
    }
  }

  if (sources.size === 0) {
    for (const entry of readdirSync(input.repoRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(".tmp-limitless") || !entry.name.endsWith(".html")) {
        continue;
      }
      const absolutePath = path.resolve(input.repoRoot, entry.name);
      sources.set(entry.name, readFileSync(absolutePath, "utf8"));
    }
  }

  const collectMarkets = (sourceMap: ReadonlyMap<string, string>): Map<string, LimitlessLiveMarket> => {
    const markets = new Map<string, LimitlessLiveMarket>();
    for (const [sourceRef, html] of sourceMap.entries()) {
      for (const market of parseMarketsFromHtml(html, sourceRef, fetchedAt)) {
        markets.set(market.venueMarketId, market);
      }
    }
    return markets;
  };

  let markets = collectMarkets(sources);
  if (markets.size === 0) {
    for (const entry of readdirSync(input.repoRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(".tmp-limitless") || !entry.name.endsWith(".html")) {
        continue;
      }
      const absolutePath = path.resolve(input.repoRoot, entry.name);
      if (!sources.has(entry.name)) {
        sources.set(entry.name, readFileSync(absolutePath, "utf8"));
      }
    }
    markets = collectMarkets(sources);
  }

  const rows = [...markets.values()].sort((left, right) =>
    left.canonicalCategory.localeCompare(right.canonicalCategory)
    || left.title.localeCompare(right.title)
  );

  return {
    markets: rows,
    summary: {
      observedAt: fetchedAt.toISOString(),
      fetchedFromLiveSurface: [...sources.keys()].some((value) => value.startsWith(baseUrl)),
      sourceRefs: [...sources.keys()],
      totalMarkets: rows.length,
      categories: rows.reduce<Record<string, number>>((accumulator, row) => {
        accumulator[row.canonicalCategory] = (accumulator[row.canonicalCategory] ?? 0) + 1;
        return accumulator;
      }, {}),
      families: rows.reduce<Record<string, number>>((accumulator, row) => {
        accumulator[row.family] = (accumulator[row.family] ?? 0) + 1;
        return accumulator;
      }, {}),
      assets: rows.reduce<Record<string, number>>((accumulator, row) => {
        const key = row.asset ?? "UNKNOWN";
        accumulator[key] = (accumulator[key] ?? 0) + 1;
        return accumulator;
      }, {})
    }
  };
};
