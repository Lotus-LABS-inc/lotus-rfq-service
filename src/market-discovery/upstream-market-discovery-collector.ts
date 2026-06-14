import { createHash } from "node:crypto";

import {
  buildStableTextId,
  normalizeCategory,
  normalizeFreeText,
  normalizeMarketClass,
  type CanonicalCategory,
  type CanonicalMarketClass,
  type CanonicalVenue
} from "../canonical/canonicalization-types.js";
import { LimitlessCurrentDiscoveryClient } from "../integrations/limitless/limitless-current-discovery-client.js";
import type { LimitlessLiveMarket } from "../integrations/limitless/limitless-live-market-loader.js";
import { OpinionCurrentDiscoveryClient } from "../integrations/opinion/opinion-current-discovery-client.js";
import type { OpinionNormalizedMarket } from "../integrations/opinion/opinion-types.js";
import { PolymarketGammaClient, type PolymarketGammaEvent, type PolymarketGammaMarket } from "../integrations/polymarket/polymarket-gamma-client.js";
import { PredictClient, type PredictMarketsResponse } from "../integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../integrations/predict/predict-market-adapter.js";
import type { PredictEnvironment } from "../integrations/predict/predict-types.js";
import type { VenueMarketDiscoverySnapshot, MarketDiscoveryRunSummary } from "./market-discovery-types.js";

type VenueStatus = MarketDiscoveryRunSummary["venueStatuses"][string];

export interface UpstreamMarketDiscoveryCollectorResult {
  snapshots: readonly VenueMarketDiscoverySnapshot[];
  venueStatuses: MarketDiscoveryRunSummary["venueStatuses"];
}

export interface UpstreamMarketDiscoveryCollectorConfig {
  maxConcurrentVenueFetches?: number;
  polymarket?: {
    gammaClient?: PolymarketGammaClient;
    pageSize?: number;
    maxPages?: number;
    maxEventDetailExpansions?: number;
    maxDerivedEventSlugExpansions?: number;
  };
  limitless?: {
    client?: LimitlessCurrentDiscoveryClient;
  };
  opinion?: {
    client?: OpinionCurrentDiscoveryClient;
    metadataVersion?: string;
  };
  predict?: {
    client?: PredictClient;
    environment?: PredictEnvironment;
    pageSize?: number;
    maxPages?: number;
  };
  now?: () => Date;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const POLYMARKET_DISCOVERY_ORDERS = ["volume", "createdAt"] as const;

const status = (
  state: VenueStatus["status"],
  rowCount: number,
  warningCount = 0
): VenueStatus => ({ status: state, rowCount, warningCount });

const venueFetchConcurrency = (configured?: number): number =>
  Math.max(1, Math.min(4, Math.floor(
    configured ?? (Number(process.env.MARKET_DISCOVERY_MAX_CONCURRENT_VENUE_FETCHES) || 2)
  )));

const runVenueTasks = async <T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> => {
  const results: T[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const asStringArray = (...values: readonly unknown[]): string[] => {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value
        .flatMap((entry) => {
          if (typeof entry === "string" || typeof entry === "number") return [String(entry)];
          if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
            const record = entry as Record<string, unknown>;
            return firstString(record.label, record.name, record.title, record.slug) ?? [];
          }
          return [];
        })
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return asStringArray(parsed);
      } catch {
        return [value.trim()];
      }
    }
  }
  return [];
};

const dateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1_000_000_000_000 ? value : value * 1_000);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};

const semanticBoundary = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    const date = dateOrNull(value);
    if (date) return date.toISOString().slice(0, 10);
    if (typeof value === "string") {
      const iso = value.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
      if (iso) {
        const boundary = `${iso[1]}-${iso[2]}-${iso[3]}`;
        const parsed = new Date(`${boundary}T00:00:00.000Z`);
        if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === boundary) return boundary;
      }
    }
  }
  return null;
};

const isPast = (date: Date | null, now: Date): boolean => date !== null && date.getTime() <= now.getTime();

const hashSummary = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const inferCategory = (input: { title: string; category?: string | null; tags?: readonly string[] }): CanonicalCategory => {
  const category = normalizeCategory(input.category);
  if (category !== "OTHER") return category;
  const text = normalizeFreeText(`${input.title} ${(input.tags ?? []).join(" ")}`);
  if (/\b(nba|nfl|nhl|mlb|f1|football|soccer|champions league|premier league|la liga|world cup)\b/.test(text)) return "SPORTS";
  if (/\b(lck|lpl|lec|lcs|esports|valorant|cs2|dota|gaming)\b/.test(text)) return "ESPORTS";
  if (/\b(election|president|senate|governor|trump|netanyahu|newsom|ossoff)\b/.test(text)) return "POLITICS";
  if (/\b(btc|bitcoin|eth|ethereum|sol|solana|xrp|bnb|fdv|token|crypto)\b/.test(text)) return "CRYPTO";
  return "OTHER";
};

const inferMarketClass = (outcomes: readonly string[], explicit?: string | null): CanonicalMarketClass => {
  const normalized = normalizeMarketClass(explicit);
  if (normalized !== "UNKNOWN") return normalized;
  if (outcomes.length <= 2) return "BINARY";
  return "MULTI_OUTCOME";
};

const eventTitleFromRaw = (fallback: string, raw: Record<string, unknown>): string => {
  const eventRows = Array.isArray(raw.events) ? raw.events.map(asRecord) : [];
  return firstString(
    raw.eventTitle,
    raw.event_title,
    raw.groupTitle,
    raw.group_title,
    raw.seriesTitle,
    raw.series_title,
    raw.eventName,
    raw.event_name,
    eventRows[0]?.title,
    eventRows[0]?.name
  ) ?? fallback;
};

const eventSlugFromRaw = (raw: Record<string, unknown>): string | null => {
  const eventRows = Array.isArray(raw.events) ? raw.events.map(asRecord) : [];
  return firstString(
    raw.eventSlug,
    raw.event_slug,
    raw.groupSlug,
    raw.group_slug,
    eventRows[0]?.slug
  );
};

const categoryFromRaw = (raw: Record<string, unknown>): string | null => {
  const categoryRows = Array.isArray(raw.categories) ? raw.categories.map(asRecord) : [];
  return firstString(
    raw.category,
    raw.categorySlug,
    raw.category_slug,
    categoryRows[0]?.label,
    categoryRows[0]?.name,
    categoryRows[0]?.slug
  );
};

const tagsFromRaw = (raw: Record<string, unknown>): string[] => [
  ...asStringArray(raw.tags),
  ...asStringArray(raw.categories),
  ...asStringArray(raw.events)
];

const snapshot = (input: Omit<VenueMarketDiscoverySnapshot, "id" | "normalizedTitle" | "sourceHash" | "sourceKind">): VenueMarketDiscoverySnapshot => {
  const normalizedTitle = normalizeFreeText(input.title);
  const rawSummary = input.rawSummary;
  return {
    ...input,
    id: buildStableTextId("venue-discovery-", `${input.venue}:${input.venueMarketId}`),
    normalizedTitle,
    sourceHash: hashSummary({
      venue: input.venue,
      venueMarketId: input.venueMarketId,
      title: input.title,
      outcomes: input.outcomes,
      semanticBoundaryKey: input.semanticBoundaryKey,
      rulesText: input.rulesText,
      rawSummary
    }),
    sourceKind: "UPSTREAM_VENUE"
  };
};

const polymarketOutcomes = (market: PolymarketGammaMarket): { labels: string[]; tokenIds: string[] } => {
  const raw = market.raw;
  const tokenRows = Array.isArray(raw.outcomes) ? raw.outcomes.map(asRecord) : [];
  const labels = tokenRows.flatMap((entry) => firstString(entry.label, entry.outcome) ?? []);
  const tokenIds = tokenRows.flatMap((entry) => firstString(entry.token_id, entry.tokenId) ?? []);
  return {
    labels: labels.length > 0 ? labels : asStringArray(raw.outcomes),
    tokenIds
  };
};

const shouldFetchPolymarketEventDetail = (event: PolymarketGammaEvent): boolean => {
  if (event.markets.length <= 1) {
    return true;
  }
  const normalizedTitle = normalizeFreeText(event.title);
  return /\b(above|below|first|winner|champion|which|who|___)\b/.test(normalizedTitle);
};

const shouldTryDerivedPolymarketEventSlug = (title: string): boolean => {
  const normalizedTitle = normalizeFreeText(title);
  return /\b(fdv|ipo|above|below|first|winner|champion|which|who|hit|launch)\b/.test(normalizedTitle);
};

const polymarketDerivedSlugPriority = (title: string): number => {
  const normalizedTitle = normalizeFreeText(title);
  let score = 0;
  if (/\b(fdv|ipo|launch)\b/.test(normalizedTitle)) score += 100;
  if (/\b(above|below|hit|first)\b/.test(normalizedTitle)) score += 40;
  if (title.includes("___")) score += 30;
  if (/\b(winner|champion|which|who)\b/.test(normalizedTitle)) score += 10;
  return score;
};

const derivePolymarketEventSlug = (title: string): string | null => {
  const slug = title
    .toLowerCase()
    .replace(/___+/g, "")
    .replace(/\$[0-9]+(?:\.[0-9]+)?\s*(?:k|m|b|t)?/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.length > 0 ? slug : null;
};

const titleFromDerivedPolymarketSlug = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

export class UpstreamMarketDiscoveryCollector {
  public constructor(private readonly config: UpstreamMarketDiscoveryCollectorConfig = {}) {}

  public async collect(): Promise<UpstreamMarketDiscoveryCollectorResult> {
    const venueResults = await runVenueTasks(
      [
        () => this.collectPolymarket(),
        () => this.collectLimitless(),
        () => this.collectOpinion(),
        () => this.collectPredict()
      ],
      venueFetchConcurrency(this.config.maxConcurrentVenueFetches)
    );
    const polymarket = venueResults[0];
    const limitless = venueResults[1];
    const opinion = venueResults[2];
    const predict = venueResults[3];
    if (!polymarket || !limitless || !opinion || !predict) {
      throw new Error("Market discovery venue collector did not return all venue results.");
    }
    const augmentedPolymarketSnapshots = await this.collectPolymarketDerivedEventSlugs([
      ...limitless.snapshots,
      ...opinion.snapshots,
      ...predict.snapshots
    ], polymarket.snapshots);
    return {
      snapshots: [
        ...augmentedPolymarketSnapshots,
        ...limitless.snapshots,
        ...opinion.snapshots,
        ...predict.snapshots
      ],
      venueStatuses: {
        POLYMARKET: status(
          augmentedPolymarketSnapshots.length > 0 ? "SUCCESS" : polymarket.status.status,
          augmentedPolymarketSnapshots.length,
          polymarket.status.warningCount
        ),
        LIMITLESS: limitless.status,
        OPINION: opinion.status,
        PREDICT_FUN: predict.status
      }
    };
  }

  private async collectPolymarket(): Promise<{ snapshots: VenueMarketDiscoverySnapshot[]; status: VenueStatus }> {
    try {
      const client = this.config.polymarket?.gammaClient ?? new PolymarketGammaClient();
      const pageSize = this.config.polymarket?.pageSize ?? DEFAULT_PAGE_SIZE;
      const maxPages = this.config.polymarket?.maxPages ?? DEFAULT_MAX_PAGES;
      const maxEventDetailExpansions = this.config.polymarket?.maxEventDetailExpansions
        ?? pageSize * maxPages * POLYMARKET_DISCOVERY_ORDERS.length;
      let eventDetailExpansions = 0;
      const expandedEventSlugs = new Set<string>();
      const now = this.config.now?.() ?? new Date();
      const rows = new Map<string, VenueMarketDiscoverySnapshot>();
      const addMarket = (market: PolymarketGammaMarket): void => {
        const row = this.polymarketSnapshot(market, now);
        if (row) {
          rows.set(market.conditionId, row);
        }
      };
      for (const order of POLYMARKET_DISCOVERY_ORDERS) {
        for (let page = 0; page < maxPages; page += 1) {
          const events = await client.listEvents({
            limit: pageSize,
            offset: page * pageSize,
            active: true,
            closed: false,
            archived: false,
            order,
            ascending: false
          });
          for (const event of events) {
            const expandedEvent = eventDetailExpansions < maxEventDetailExpansions
              ? await this.expandPolymarketEventIfUseful(client, event).then((expanded) => {
                if (expanded !== event) {
                  eventDetailExpansions += 1;
                  if (event.eventSlug) {
                    expandedEventSlugs.add(event.eventSlug);
                  }
                }
                return expanded;
              })
              : event;
            for (const market of this.polymarketEventMarkets(expandedEvent)) {
              addMarket(market);
            }
          }
          if (events.length < pageSize) break;
        }
      }
      for (const order of POLYMARKET_DISCOVERY_ORDERS) {
        for (let page = 0; page < maxPages; page += 1) {
          const markets = await client.listMarkets({
            limit: pageSize,
            offset: page * pageSize,
            active: true,
            closed: false,
            archived: false,
            order,
            ascending: false
          });
          for (const market of markets) {
            const eventSlug = eventSlugFromRaw(market.raw);
            if (eventSlug && !expandedEventSlugs.has(eventSlug) && eventDetailExpansions < maxEventDetailExpansions) {
              try {
                const eventTitle = eventTitleFromRaw(market.title, market.raw);
                const detailMarkets = await client.getEventMarketsBySlug(eventSlug);
                eventDetailExpansions += 1;
                expandedEventSlugs.add(eventSlug);
                for (const detailMarket of this.polymarketEventMarkets({
                  eventId: null,
                  eventSlug,
                  title: eventTitle,
                  markets: detailMarkets,
                  raw: {
                    slug: eventSlug,
                    title: eventTitle
                  }
                })) {
                  addMarket(detailMarket);
                }
                continue;
              } catch {
                expandedEventSlugs.add(eventSlug);
              }
            }
            addMarket(market);
          }
          if (markets.length < pageSize) break;
        }
      }
      const snapshots = [...rows.values()];
      return { snapshots, status: status(snapshots.length > 0 ? "SUCCESS" : "EMPTY", snapshots.length) };
    } catch {
      return { snapshots: [], status: status("UNAVAILABLE", 0, 1) };
    }
  }

  private async collectPolymarketDerivedEventSlugs(
    sourceSnapshots: readonly VenueMarketDiscoverySnapshot[],
    existingPolymarketSnapshots: readonly VenueMarketDiscoverySnapshot[]
  ): Promise<VenueMarketDiscoverySnapshot[]> {
    const client = this.config.polymarket?.gammaClient ?? new PolymarketGammaClient();
    const maxExpansions = this.config.polymarket?.maxDerivedEventSlugExpansions ?? 100;
    const now = this.config.now?.() ?? new Date();
    const rows = new Map(existingPolymarketSnapshots.map((snapshot) => [snapshot.venueMarketId, snapshot]));
    const candidateSlugs = new Map<string, string>();
    for (const snapshot of sourceSnapshots) {
      const topicTitle = firstString(
        snapshot.rawSummary.eventTitle,
        snapshot.rawSummary.event_title,
        snapshot.rawSummary.groupTitle,
        snapshot.rawSummary.group_title
      );
      const slug = topicTitle ? derivePolymarketEventSlug(topicTitle) : null;
      if (topicTitle && slug && shouldTryDerivedPolymarketEventSlug(topicTitle)) {
        candidateSlugs.set(slug, topicTitle);
      }
    }
    const orderedSlugs = [...candidateSlugs.entries()]
      .sort((left, right) => polymarketDerivedSlugPriority(right[1]) - polymarketDerivedSlugPriority(left[1]))
      .slice(0, maxExpansions)
      .map(([slug]) => slug);
    for (const eventSlug of orderedSlugs) {
      try {
        const markets = await client.getEventMarketsBySlug(eventSlug);
        for (const market of this.polymarketEventMarkets({
          eventId: null,
          eventSlug,
          title: titleFromDerivedPolymarketSlug(eventSlug),
          markets,
          raw: {
            slug: eventSlug,
            title: titleFromDerivedPolymarketSlug(eventSlug)
          }
        })) {
          const row = this.polymarketSnapshot(market, now);
          if (row) {
            rows.set(row.venueMarketId, row);
          }
        }
      } catch {
        continue;
      }
    }
    return [...rows.values()];
  }

  private async expandPolymarketEventIfUseful(
    client: PolymarketGammaClient,
    event: PolymarketGammaEvent
  ): Promise<PolymarketGammaEvent> {
    if (!event.eventSlug || !shouldFetchPolymarketEventDetail(event)) {
      return event;
    }
    try {
      const markets = await client.getEventMarketsBySlug(event.eventSlug);
      if (markets.length <= event.markets.length) {
        return event;
      }
      return {
        ...event,
        markets
      };
    } catch {
      return event;
    }
  }

  private polymarketEventMarkets(event: PolymarketGammaEvent): PolymarketGammaMarket[] {
    return event.markets.map((market) => ({
      ...market,
      raw: {
        ...market.raw,
        eventTitle: event.title,
        eventSlug: event.eventSlug,
        events: [
          {
            id: event.eventId,
            slug: event.eventSlug,
            title: event.title
          }
        ],
        eventRaw: event.raw
      }
    }));
  }

  private polymarketSnapshot(market: PolymarketGammaMarket, now: Date): VenueMarketDiscoverySnapshot | null {
    const raw = market.raw;
    const closed = raw.closed === true || raw.archived === true || raw.active === false;
    const expiresAt = dateOrNull(raw.endDateIso ?? raw.endDate ?? raw.end_date_iso ?? raw.end_date);
    if (closed || isPast(expiresAt, now)) return null;
    const outcomes = polymarketOutcomes(market);
    const tags = tagsFromRaw(raw);
    const eventTitle = eventTitleFromRaw(market.title, raw);
    const eventSlug = eventSlugFromRaw(raw);
    return snapshot({
      venue: "POLYMARKET",
      venueMarketId: market.conditionId,
      active: true,
      title: market.title,
      category: inferCategory({ title: `${eventTitle} ${market.title}`, category: categoryFromRaw(raw), tags }),
      marketClass: inferMarketClass(outcomes.labels, firstString(raw.marketType, raw.market_type)),
      outcomes: outcomes.labels,
      semanticBoundaryKey: semanticBoundary(expiresAt, raw.endDateIso, raw.endDate, market.title, eventTitle, market.marketSlug),
      expiresAt,
      resolvesAt: dateOrNull(raw.resolutionDate ?? raw.resolution_date),
      rulesText: firstString(raw.rules, raw.description, raw.resolutionSource),
      resolutionSource: firstString(raw.resolutionSource, raw.resolution_source),
      slug: market.marketSlug,
      sourceUrl: eventSlug
        ? `https://polymarket.com/event/${eventSlug}`
        : market.marketSlug ? `https://polymarket.com/market/${market.marketSlug}` : null,
      tokenIds: outcomes.tokenIds,
      quoteReady: outcomes.tokenIds.length > 0,
      executionReady: outcomes.tokenIds.length > 0,
      rawSummary: {
        marketId: market.marketId,
        conditionId: market.conditionId,
        slug: market.marketSlug,
        eventTitle,
        eventSlug,
        tags,
        active: raw.active,
        closed: raw.closed,
        archived: raw.archived
      }
    });
  }

  private async collectLimitless(): Promise<{ snapshots: VenueMarketDiscoverySnapshot[]; status: VenueStatus }> {
    const result = await (this.config.limitless?.client ?? new LimitlessCurrentDiscoveryClient()).listCurrentMarkets();
    const now = this.config.now?.() ?? new Date();
    const snapshots = result.rows
      .filter((row) => !isPast(row.expiresAt, now))
      .map((row) => this.limitlessSnapshot(row));
    return { snapshots, status: status(result.status, snapshots.length, result.warnings.length) };
  }

  private limitlessSnapshot(row: LimitlessLiveMarket): VenueMarketDiscoverySnapshot {
    const rawTokens = asRecord(row.raw.tokens);
    const tokenIds = [
      firstString(rawTokens.yes, rawTokens.YES, rawTokens.yesTokenId, rawTokens.yes_token_id),
      firstString(rawTokens.no, rawTokens.NO, rawTokens.noTokenId, rawTokens.no_token_id)
    ].filter((entry): entry is string => entry !== null);
    const eventTitle = firstString(
      row.raw.eventTitle,
      row.raw.event_title,
      row.raw.groupTitle,
      row.raw.group_title,
      row.raw.seriesTitle,
      row.raw.series_title
    ) ?? row.title;
    return snapshot({
      venue: "LIMITLESS",
      venueMarketId: row.venueMarketId,
      active: true,
      title: row.title,
      category: inferCategory({ title: `${eventTitle} ${row.title}`, category: row.canonicalCategory, tags: [...row.categories, ...row.tags] }),
      marketClass: inferMarketClass(["Yes", "No"], row.marketType),
      outcomes: ["Yes", "No"],
      semanticBoundaryKey: row.timeBoundary ?? semanticBoundary(row.expiresAt, row.title, eventTitle, row.slug),
      expiresAt: row.expiresAt,
      resolvesAt: null,
      rulesText: row.description,
      resolutionSource: firstString(row.sourceRef),
      slug: row.slug,
      sourceUrl: row.slug ? `https://limitless.exchange/markets/${row.slug}` : null,
      tokenIds,
      quoteReady: tokenIds.length > 0,
      executionReady: tokenIds.length > 0,
      rawSummary: {
        marketId: row.marketId,
        slug: row.slug,
        eventTitle,
        family: row.family,
        asset: row.asset,
        threshold: row.threshold,
        categories: row.categories,
        tags: row.tags,
        status: row.status
      }
    });
  }

  private async collectOpinion(): Promise<{ snapshots: VenueMarketDiscoverySnapshot[]; status: VenueStatus }> {
    const apiKeys = [
      process.env.OPINION_API_KEY,
      process.env.OPINION_OPENAPI_API_KEY,
      process.env.OPINION_ORDERBOOK_API_KEY,
      process.env.OPINION_CLOB_API_KEY
    ].filter((key): key is string => typeof key === "string" && key.trim().length > 0);
    // Opinion's primary CLOB-SDK endpoint frequently times out, so it relies on the openapi
    // fallback. Under the full concurrent run (alongside the large Polymarket pull) the default
    // 10s per-page timeout starves the fallback too, yielding 0 snapshots. Give it more headroom
    // (env-tunable) so the fallback can complete under load.
    const requestTimeoutMs = Number(process.env.OPINION_DISCOVERY_TIMEOUT_MS) || 25_000;
    const client = this.config.opinion?.client ?? new OpinionCurrentDiscoveryClient({
      apiKey: apiKeys[0] ?? null,
      apiKeys,
      requestTimeoutMs
    });
    const result = await client.listCurrentMarkets(this.config.opinion?.metadataVersion ?? "market-discovery-v2");
    const now = this.config.now?.() ?? new Date();
    const snapshots = result.rows
      .filter((row) => !isPast(row.cutoffAt ?? row.resolvedAt, now))
      .map((row) => this.opinionSnapshot(row));
    return { snapshots, status: status(result.status, snapshots.length, result.warnings.length) };
  }

  private opinionSnapshot(row: OpinionNormalizedMarket): VenueMarketDiscoverySnapshot {
    const outcomes = [row.yesLabel, row.noLabel].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    const tokenIds = [row.yesTokenId, row.noTokenId].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    const raw = asRecord(row.raw);
    const eventTitle = firstString(
      raw.eventTitle,
      raw.event_title,
      raw.groupTitle,
      raw.group_title,
      raw.seriesTitle,
      raw.series_title,
      raw.questionTitle,
      raw.question_title
    ) ?? row.title;
    return snapshot({
      venue: "OPINION",
      venueMarketId: row.venueMarketId,
      active: true,
      title: row.title,
      category: inferCategory({ title: `${eventTitle} ${row.title}`, category: firstString(raw.category, raw.categorySlug), tags: asStringArray(raw.tags, raw.categories) }),
      marketClass: inferMarketClass(outcomes, null),
      outcomes,
      semanticBoundaryKey: semanticBoundary(row.resolvedAt, row.cutoffAt, row.title, eventTitle, row.slug),
      expiresAt: row.cutoffAt,
      resolvesAt: row.resolvedAt,
      rulesText: row.rules,
      resolutionSource: firstString(raw.resolutionSource, raw.resolution_source, raw.source),
      slug: row.slug,
      sourceUrl: firstString(raw.sourceUrl, raw.url) ?? (row.slug ? `https://opinion.trade/market/${row.slug}` : null),
      tokenIds,
      quoteReady: tokenIds.length > 0,
      executionReady: tokenIds.length > 0,
      rawSummary: {
        status: row.status,
        statusCode: row.statusCode,
        slug: row.slug,
        eventTitle,
        labels: row.labels
      }
    });
  }

  private async collectPredict(): Promise<{ snapshots: VenueMarketDiscoverySnapshot[]; status: VenueStatus }> {
    if (!process.env.PREDICT_API_KEY && !this.config.predict?.client) {
      return { snapshots: [], status: status("NOT_CONFIGURED", 0, 1) };
    }
    try {
      const client = this.config.predict?.client ?? new PredictClient({
        environment: this.config.predict?.environment ?? (process.env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet"),
        ...(process.env.PREDICT_MAINNET_BASE_URL ? { baseUrl: process.env.PREDICT_MAINNET_BASE_URL } : {}),
        ...(process.env.PREDICT_API_KEY ? { apiKey: process.env.PREDICT_API_KEY } : {}),
        retry: { maxRetries: 1, baseBackoffMs: 500, maxBackoffMs: 1_500 }
      });
      const pageSize = this.config.predict?.pageSize ?? 50;
      const maxPages = this.config.predict?.maxPages ?? 2;
      const now = this.config.now?.() ?? new Date();
      const environment = this.config.predict?.environment ?? (process.env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet");
      const adapter = new PredictMarketAdapter({
        client,
        environment,
        metadataVersion: "market-discovery-v2"
      });
      const snapshots: VenueMarketDiscoverySnapshot[] = [];
      const seen = new Set<string>();
      const categoryQueries = [
        { marketVariant: "DEFAULT", sort: "VOLUME" },
        { marketVariant: "DEFAULT", sort: "POPULAR" },
        { marketVariant: "DEFAULT" }
      ] as const;
      for (const categoryQuery of categoryQueries) {
        let categoryAfter: string | undefined;
        for (let page = 1; page <= maxPages; page += 1) {
          const response = await client.getCategoriesPage({
            first: pageSize,
            status: "OPEN",
            ...categoryQuery,
            ...(categoryAfter ? { after: categoryAfter } : {})
          });
          for (const category of response.data) {
            if (isPredictShortLivedCategory(category, now)) {
              continue;
            }
            const categoryMarkets = predictCategoryMarketEntries(category);
            for (const market of categoryMarkets) {
              const mergedMarket = {
                ...market,
                eventTitle: firstString(category.title, category.shortTitle, category.slug),
                eventSlug: firstString(category.slug),
                category: firstString(category.title, category.shortTitle, category.slug),
                categorySlug: firstString(category.slug),
                categories: [firstString(category.title, category.shortTitle, category.slug)].filter(Boolean),
                tags: asStringArray(category.tags),
                categoryStatus: category.status,
                categoryStartsAt: category.startsAt,
                categoryEndsAt: category.endsAt,
                sourceUrl: firstString(market.url, market.sourceUrl, market.source_url)
                  ?? (firstString(category.slug) ? `https://predict.fun/market/${firstString(category.slug)}` : null)
              };
              const normalized = this.predictSnapshot(mergedMarket, now);
              if (normalized && !seen.has(normalized.venueMarketId)) {
                seen.add(normalized.venueMarketId);
                snapshots.push(normalized);
              }
            }
          }
          categoryAfter = response.cursor ?? undefined;
          if (response.data.length < pageSize || !categoryAfter) break;
        }
      }
      let after: string | undefined;
      for (let page = 1; page <= maxPages && snapshots.length === 0; page += 1) {
        const response = await client.getMarketsPage({
          first: pageSize,
          status: "OPEN",
          marketVariant: "DEFAULT",
          ...(after ? { after } : {})
        });
        const markets = predictMarketEntries(response.data);
        if (page === 1 && markets.length === 0) {
          const fallbackMarkets = predictMarketEntries(await client.getMarkets({ first: pageSize, status: "OPEN" }));
          for (const market of fallbackMarkets) {
            const normalized = this.predictSnapshot(market, now);
            if (normalized && !seen.has(normalized.venueMarketId)) {
              seen.add(normalized.venueMarketId);
              snapshots.push(normalized);
            }
          }
          break;
        }
        for (const market of markets) {
          const marketId = firstString(market.id, market.marketId, market.market_id);
          const enrichedMarket = marketId
            ? asRecord(await adapter.getMarketById(marketId).catch(() => market))
            : market;
          const normalized = this.predictSnapshot(enrichedMarket, now);
          if (normalized && !seen.has(normalized.venueMarketId)) {
            seen.add(normalized.venueMarketId);
            snapshots.push(normalized);
          }
        }
        after = response.cursor ?? undefined;
        if (markets.length < pageSize || !after) break;
      }
      return { snapshots, status: status(snapshots.length > 0 ? "SUCCESS" : "EMPTY", snapshots.length) };
    } catch {
      return { snapshots: [], status: status("UNAVAILABLE", 0, 1) };
    }
  }

  private predictSnapshot(market: Record<string, unknown>, now: Date): VenueMarketDiscoverySnapshot | null {
    const expiresAt = dateOrNull(
      market.closesAt
      ?? market.closes_at
      ?? market.closeAt
      ?? market.close_at
      ?? market.endsAt
      ?? market.ends_at
      ?? market.categoryEndsAt
      ?? market.category_ends_at
      ?? market.expiresAt
      ?? market.expires_at
    );
    const resolvesAt = dateOrNull(market.resolvesAt ?? market.resolves_at ?? market.resolutionAt ?? market.resolution_at ?? market.resolutionDate ?? market.resolution_date);
    const stateText = normalizeFreeText(String(market.tradingStatus ?? market.trading_status ?? market.status ?? market.state ?? ""));
    const lifecycleText = normalizeFreeText(String(market.status ?? market.state ?? market.categoryStatus ?? ""));
    if (
      stateText.includes("closed")
      || stateText.includes("resolved")
      || stateText.includes("inactive")
      || lifecycleText.includes("resolved")
      || isPast(resolvesAt ?? expiresAt, now)
    ) {
      return null;
    }
    const outcomes = predictOutcomes(market);
    const title = firstString(market.title, market.question) ?? `Predict market ${firstString(market.id, market.venueMarketId) ?? "unknown"}`;
    const eventTitle = firstString(market.eventTitle, market.event_title, market.groupTitle, market.group_title, market.question) ?? title;
    const venueMarketId = firstString(market.id, market.marketId, market.market_id, market.venueMarketId, market.venue_market_id) ?? title;
    const slug = firstString(market.slug);
    return snapshot({
      venue: "PREDICT",
      venueMarketId,
      active: true,
      title,
      category: inferCategory({ title: `${eventTitle} ${title}`, category: firstString(market.category, market.categorySlug, market.category_slug), tags: asStringArray(market.tags, market.categories) }),
      marketClass: inferMarketClass(outcomes.labels, firstString(market.marketType, market.market_type, market.marketClass, market.market_class)),
      outcomes: outcomes.labels,
      semanticBoundaryKey: semanticBoundary(resolvesAt, expiresAt, title, eventTitle, slug),
      expiresAt,
      resolvesAt,
      rulesText: firstString(market.rules, market.description),
      resolutionSource: firstString(market.resolutionSource, market.resolution_source, market.source),
      slug,
      sourceUrl: firstString(market.url, market.sourceUrl, market.source_url) ?? (slug ? `https://predict.fun/market/${slug}` : null),
      tokenIds: outcomes.tokenIds,
      quoteReady: outcomes.tokenIds.length > 0,
      executionReady: outcomes.tokenIds.length > 0,
      rawSummary: {
        id: venueMarketId,
        eventTitle,
        status: market.status,
        tradingStatus: market.tradingStatus ?? market.trading_status,
        state: market.state,
        slug
      }
    });
  }
}

const predictMarketEntries = (response: PredictMarketsResponse): Record<string, unknown>[] => {
  if (Array.isArray(response)) return response.map(asRecord);
  const record = asRecord(response);
  const rows = record.data ?? record.markets ?? record.items ?? record.results;
  return Array.isArray(rows) ? rows.map(asRecord) : [];
};

const predictCategoryMarketEntries = (category: Record<string, unknown>): Record<string, unknown>[] => {
  const markets = category.markets;
  return Array.isArray(markets) ? markets.map(asRecord) : [];
};

const isPredictShortLivedCategory = (category: Record<string, unknown>, now: Date): boolean => {
  const variant = normalizeFreeText(String(category.marketVariant ?? category.market_variant ?? ""));
  const tags = asStringArray(category.tags).map(normalizeFreeText);
  if (variant === "crypto up down" || tags.some((tag) => tag.includes("up down") || tag === "5 min" || tag === "15 min" || tag === "1 hour")) {
    return true;
  }
  const startsAt = dateOrNull(category.startsAt ?? category.starts_at);
  const endsAt = dateOrNull(category.endsAt ?? category.ends_at);
  if (!startsAt || !endsAt) {
    return false;
  }
  const durationMs = endsAt.getTime() - startsAt.getTime();
  if (durationMs <= 0) {
    return true;
  }
  const remainingMs = endsAt.getTime() - now.getTime();
  return durationMs < 24 * 60 * 60 * 1_000 || remainingMs < 6 * 60 * 60 * 1_000;
};

const predictOutcomes = (market: Record<string, unknown>): { labels: string[]; tokenIds: string[] } => {
  const outcomeRows = Array.isArray(market.outcomes) ? market.outcomes.map(asRecord) : [];
  const labels = outcomeRows.flatMap((entry) => firstString(entry.label, entry.name, entry.title) ?? []);
  const tokenIds = outcomeRows.flatMap((entry) => firstString(entry.tokenId, entry.token_id, entry.onChainId, entry.on_chain_id) ?? []);
  const fallbackToken = firstString(market.tokenId, market.token_id);
  return {
    labels: labels.length > 0 ? labels : ["Yes", "No"],
    tokenIds: fallbackToken ? [...new Set([...tokenIds, fallbackToken])] : tokenIds
  };
};
