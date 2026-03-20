import type { Logger } from "pino";

import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput,
  type HistoricalVenueAdapter
} from "../../core/historical-simulation/historical-simulation.types.js";
import { buildStableUuid, type CanonicalOutcomeDefinition } from "../../canonical/canonicalization-types.js";
import type { CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import type { HistoricalIngestionCategory } from "../../jobs/historical-ingestion.shared.js";
import { MyriadMarketCrawler } from "./myriad-market-crawler.js";
import { MyriadMarketDetailEnricher } from "./myriad-market-detail-enricher.js";
import { MyriadMarketEventsBackfill } from "./myriad-market-events-backfill.js";
import { classifyMyriadPreviewCategory, isSimpleBinaryOutcomeMarket } from "./myriad-topic-normalizer.js";
import type {
  MyriadClient,
  MyriadMarketDetail,
  MyriadMarketEvent,
  MyriadMarketSummary,
  MyriadOutcome,
  MyriadPriceChartSeries,
  MyriadQuestion
} from "./myriad-schemas.js";

export interface MyriadHistoricalAdapterConfig {
  client: Pick<MyriadClient, "listMarkets" | "getMarket" | "listQuestions" | "getMarketEvents">;
  metadataVersion: string;
  eventPageSize?: number;
  maxEventPagesPerMarket?: number;
  maxEventRowsPerMarket?: number;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface MyriadHistoricalScope {
  category: HistoricalIngestionCategory;
  canonicalEventId: string;
  canonicalMarketId: string;
  summary: MyriadMarketSummary;
  detail: MyriadMarketDetail;
  question: MyriadQuestion | null;
}

export interface HistoricalMarketStateFragment extends Omit<CreateHistoricalMarketStateInput, "id"> {}

export class MyriadHistoricalAdapter {
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;
  private readonly marketCrawler: MyriadMarketCrawler;
  private readonly detailEnricher: MyriadMarketDetailEnricher;
  private readonly eventsBackfill: MyriadMarketEventsBackfill;

  public constructor(private readonly config: MyriadHistoricalAdapterConfig) {
    this.logger = config.logger;
    this.marketCrawler = new MyriadMarketCrawler({ client: config.client, logger: config.logger });
    this.detailEnricher = new MyriadMarketDetailEnricher({ client: config.client, logger: config.logger });
    this.eventsBackfill = new MyriadMarketEventsBackfill({ client: config.client, logger: config.logger });
  }

  public getVenueAdapter(): HistoricalVenueAdapter {
    return {
      venue: "MYRIAD",
      marketClass: HistoricalMarketClass.BINARY,
      supportsCandles: true,
      supportsOrderbookHistory: false,
      supportsTradesHistory: false,
      supportsOwnExecutionHistory: false,
      metadataVersion: this.config.metadataVersion
    };
  }

  public async listScopedMarkets(input: {
    categories: readonly HistoricalIngestionCategory[];
    batchSize?: number;
    canonicalEventId?: string;
    canonicalMarketId?: string;
  }): Promise<readonly MyriadHistoricalScope[]> {
    const pageSize = Math.max(1, Math.min(input.batchSize ?? 100, 100));
    const candidateMarkets = await this.loadCandidateMarkets(pageSize);
    const scopes: MyriadHistoricalScope[] = [];

    for (const summary of candidateMarkets) {
      const category = toHistoricalIngestionCategory(classifyMyriadPreviewCategory(summary));
      if (!category || !input.categories.includes(category)) {
        continue;
      }

      const enrichment = await this.detailEnricher.enrich(summary);
      if (!isSimpleBinaryOutcomeMarket(enrichment.detail)) {
        continue;
      }

      const question = await this.findLinkedQuestion(enrichment.detail);
      const scope = buildHistoricalScope(category, summary, enrichment.detail, question);
      if (input.canonicalEventId && scope.canonicalEventId !== input.canonicalEventId) {
        continue;
      }
      if (input.canonicalMarketId && scope.canonicalMarketId !== input.canonicalMarketId) {
        continue;
      }
      scopes.push(scope);
    }

    return scopes.sort(compareScopes);
  }

  public buildCanonicalSeed(scope: MyriadHistoricalScope): CuratedCanonicalGraphSeed {
    const outcomes = buildCanonicalOutcomes(scope.detail.outcomes);
    const sanitizedQuestion = sanitizeJsonValue(scope.question) as MyriadQuestion | null;
    const sanitizedDetail = sanitizeJsonValue(scope.detail) as MyriadMarketDetail;
    const eventTitle = sanitizeString(scope.question?.title ?? scope.detail.title);
    return {
      canonicalEventId: scope.canonicalEventId,
      canonicalMarketId: scope.canonicalMarketId,
      canonicalCategory: scope.category.toUpperCase(),
      venue: "MYRIAD",
      venueMarketId: stringifyId(sanitizedDetail.id),
      title: sanitizeString(scope.detail.title),
      description: sanitizeNullableString(scope.detail.description),
      marketType: scope.detail.moneyline ? "AMM_BINARY_MONEYLINE" : "AMM_BINARY",
      marketClass: "BINARY",
      outcomes,
      outcomeSchema: {
        marketShape: "binary",
        outcomeLabels: outcomes.map((outcome) => outcome.label)
      },
      topics: sanitizeJsonValue(scope.detail.topics) as readonly string[],
      publishedAt: asDate(scope.detail.publishedAt),
      expiresAt: asDate(scope.detail.expiresAt),
      resolvesAt: asDate(scope.detail.resolvesAt),
      fees: {
        metadata: sanitizeJsonValue(scope.detail.fees ?? {}) as Record<string, unknown>
      },
      feeModel: "myriad_documented_market_fees",
      resolutionSource: sanitizeNullableString(scope.detail.resolutionSource),
      resolutionTitle: sanitizeString(scope.detail.resolutionTitle ?? scope.detail.title),
      resolutionRulesText: sanitizeNullableString(scope.detail.description),
      settlementType: "unknown",
      settlementLagHours: null,
      finalityLagHours: null,
      payoutTimingHours: null,
      network: String(scope.detail.networkId),
      rawSourcePayload: {
        question: sanitizedQuestion,
        market: sanitizedDetail
      },
      normalizedPayload: {
        questionId: sanitizedQuestion ? stringifyId(sanitizedQuestion.id) : null,
        marketId: stringifyId(sanitizedDetail.id),
        marketSlug: sanitizeString(scope.detail.slug),
        networkId: scope.detail.networkId,
        category: scope.category
      },
      mappingLineage: ["ingest-myriad-historical"],
      sourceMetadataVersion: this.config.metadataVersion,
      eventPropositionKey: sanitizedQuestion
        ? `myriad-question:${stringifyId(sanitizedQuestion.id)}`
        : `myriad-market:${scope.detail.networkId}:${stringifyId(scope.detail.id)}`,
      eventTitle,
      eventNormalizedPropositionText: eventTitle,
      eventSourceHints: {
        questionId: sanitizedQuestion ? stringifyId(sanitizedQuestion.id) : null,
        marketId: stringifyId(scope.detail.id),
        marketSlug: sanitizeString(scope.detail.slug)
      },
      propositionHints: {
        normalizedPropositionText: eventTitle,
        groupingHints: {
          questionId: sanitizedQuestion ? stringifyId(sanitizedQuestion.id) : null,
          networkId: scope.detail.networkId
        }
      },
      executableDisplayName: sanitizeString(scope.detail.title),
      executableMetadata: {
        simulationOnly: true,
        venueType: "amm_conservative"
      }
    };
  }

  public async buildHistoricalStateFragments(input: {
    scope: MyriadHistoricalScope;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<readonly HistoricalMarketStateFragment[]> {
    const eventWindow = {
      since: Math.floor(input.windowStart.getTime() / 1_000),
      until: Math.floor(input.windowEnd.getTime() / 1_000)
    };
    const events = await this.eventsBackfill.backfill({
      idOrSlug: input.scope.detail.id,
      network_id: input.scope.detail.networkId,
      since: eventWindow.since,
      until: eventWindow.until,
      limit: this.config.eventPageSize ?? 100,
      maxPages: this.config.maxEventPagesPerMarket,
      maxEvents: this.config.maxEventRowsPerMarket
    });
    if (events.truncated) {
      this.logger?.warn?.(
        {
          canonicalMarketId: input.scope.canonicalMarketId,
          venueMarketId: stringifyId(input.scope.detail.id),
          pagesFetched: events.pagesFetched,
          eventRowsFetched: events.events.length,
          truncationReason: events.truncationReason,
          maxEventPagesPerMarket: this.config.maxEventPagesPerMarket ?? null,
          maxEventRowsPerMarket: this.config.maxEventRowsPerMarket ?? null
        },
        "Myriad event backfill truncated to conservative operational cap."
      );
    }

    const chartFragments = buildPriceChartFragments(input.scope, this.config.metadataVersion, input.windowStart, input.windowEnd);
    const eventFragments = buildEventFragments(
      input.scope,
      this.config.metadataVersion,
      events.events,
      input.windowStart,
      input.windowEnd
    );

    return [...chartFragments, ...eventFragments].sort(
      (left, right) =>
        left.timestamp.getTime() - right.timestamp.getTime() ||
        left.venueMarketId.localeCompare(right.venueMarketId) ||
        left.sourceTimestamp.getTime() - right.sourceTimestamp.getTime()
    );
  }

  private async loadCandidateMarkets(limit: number): Promise<readonly MyriadMarketSummary[]> {
    const states: Array<"open" | "closed" | "resolved"> = ["open", "closed", "resolved"];
    const allMarkets = new Map<string, MyriadMarketSummary>();

    for (const state of states) {
      const crawled = await this.marketCrawler.crawlAll({
        state,
        limit,
        maxItems: limit,
        sort: "volume",
        order: "desc"
      });
      for (const market of crawled.markets) {
        allMarkets.set(buildMarketKey(market), market);
      }
    }

    return [...allMarkets.values()].sort(compareMarketSummaries);
  }

  private async findLinkedQuestion(detail: MyriadMarketDetail): Promise<MyriadQuestion | null> {
    const response = await this.config.client.listQuestions({
      page: 1,
      limit: 20,
      keyword: detail.title
    });

    return response.data.find((question) =>
      question.markets.some((market) =>
        stringifyId(market.id) === stringifyId(detail.id) &&
        market.networkId === detail.networkId
      )
    ) ?? null;
  }
}

const SERIES_PRIORITY: Readonly<Record<MyriadPriceChartSeries["timeframe"], number>> = {
  all: 4,
  "30d": 3,
  "7d": 2,
  "24h": 1
};

const stringifyId = (value: string | number): string => String(value);

const asDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toHistoricalIngestionCategory = (
  value: ReturnType<typeof classifyMyriadPreviewCategory>
): HistoricalIngestionCategory | null => {
  switch (value) {
    case "SPORTS":
      return "sports";
    case "CRYPTO":
      return "crypto";
    case "POLITICS":
      return "politics";
    case "ESPORTS":
      return "esports";
    default:
      return null;
  }
};

const normalizeSegment = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "MARKET";

const buildHistoricalScope = (
  category: HistoricalIngestionCategory,
  summary: MyriadMarketSummary,
  detail: MyriadMarketDetail,
  question: MyriadQuestion | null
): MyriadHistoricalScope => ({
  category,
  canonicalEventId: question
    ? buildStableUuid(`myriad-question:${stringifyId(question.id)}`)
    : buildStableUuid(`myriad-market:${detail.networkId}:${stringifyId(detail.id)}`),
  canonicalMarketId: `MYRIAD-${normalizeSegment(category)}-${normalizeSegment(detail.slug)}-N${detail.networkId}`,
  summary,
  detail,
  question
});

const compareMarketSummaries = (left: MyriadMarketSummary, right: MyriadMarketSummary): number =>
  left.slug.localeCompare(right.slug) ||
  left.networkId - right.networkId ||
  stringifyId(left.id).localeCompare(stringifyId(right.id));

const compareScopes = (left: MyriadHistoricalScope, right: MyriadHistoricalScope): number =>
  left.canonicalEventId.localeCompare(right.canonicalEventId) ||
  left.canonicalMarketId.localeCompare(right.canonicalMarketId) ||
  compareMarketSummaries(left.summary, right.summary);

const buildMarketKey = (market: MyriadMarketSummary): string =>
  `${market.slug}|${market.networkId}|${stringifyId(market.id)}`;

const buildCanonicalOutcomes = (outcomes: readonly MyriadOutcome[]): readonly CanonicalOutcomeDefinition[] =>
  outcomes.map((outcome) => ({
    id: stringifyId(outcome.id),
    label: sanitizeString(outcome.title),
    metadata: {
      currentPrice: typeof outcome.price === "number" ? String(outcome.price) : null
    }
  }));

const sanitizeNullableString = (value: string | null | undefined): string | null =>
  value == null ? null : sanitizeString(value);

const sanitizeString = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u2260/g, "!=")
    .replace(/\u2248/g, "~=")
    .replace(/\u00A0/g, " ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .trim();

const sanitizeJsonValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeJsonValue(nestedValue)])
    );
  }
  return value;
};

const choosePreferredSeries = (outcome: MyriadOutcome): MyriadPriceChartSeries | null => {
  const candidates = (outcome.price_charts ?? [])
    .map((series) => ({
      timeframe: series.timeframe,
      points: series.prices.map((point) => ({
        timestamp: point.timestamp,
        price: typeof point.price === "number" ? point.price : Number(point.value)
      }))
    }))
    .filter((series): series is MyriadPriceChartSeries => series.points.length > 0);

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort(
    (left, right) =>
      SERIES_PRIORITY[right.timeframe] - SERIES_PRIORITY[left.timeframe] ||
      right.points.length - left.points.length
  )[0] ?? null;
};

const toPointDate = (value: string | number): Date => {
  if (typeof value === "number") {
    return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  }
  return new Date(value);
};

const buildPriceChartFragments = (
  scope: MyriadHistoricalScope,
  metadataVersion: string,
  windowStart: Date,
  windowEnd: Date
): HistoricalMarketStateFragment[] => {
  const preferredSeries = scope.detail.outcomes
    .map((outcome) => ({
      outcome,
      series: choosePreferredSeries(outcome)
    }))
    .filter((entry): entry is { outcome: MyriadOutcome; series: MyriadPriceChartSeries } => entry.series !== null);

  if (preferredSeries.length === 0) {
    return [];
  }

  const primary = preferredSeries[0]!;
  const lookup = new Map<string, Array<{ outcomeId: string; title: string; price: number; timeframe: string }>>();
  for (const entry of preferredSeries) {
    for (const point of entry.series.points) {
      const timestamp = toPointDate(point.timestamp).toISOString();
      const bucket = lookup.get(timestamp) ?? [];
      bucket.push({
        outcomeId: stringifyId(entry.outcome.id),
        title: entry.outcome.title,
        price: point.price,
        timeframe: entry.series.timeframe
      });
      lookup.set(timestamp, bucket);
    }
  }

  return primary.series.points.flatMap((point) => {
    const timestamp = toPointDate(point.timestamp);
    if (timestamp.getTime() < windowStart.getTime() || timestamp.getTime() > windowEnd.getTime()) {
      return [];
    }

    const prices = lookup.get(timestamp.toISOString()) ?? [{
      outcomeId: stringifyId(primary.outcome.id),
      title: primary.outcome.title,
      price: point.price,
      timeframe: primary.series.timeframe
    }];

    return [{
      canonicalEventId: scope.canonicalEventId,
      canonicalMarketId: scope.canonicalMarketId,
      canonicalCategory: scope.category.toUpperCase() as CreateHistoricalMarketStateInput["canonicalCategory"],
      venue: "MYRIAD",
      venueMarketId: stringifyId(scope.detail.id),
      marketClass: HistoricalMarketClass.BINARY,
      timestamp,
      lastPrice: String(point.price),
      candles: {
        source: "MYRIAD",
        depthModel: "amm_conservative",
        historyEvidence: "price_chart+market_events",
        quoteHistoryAvailable: false,
        primaryOutcomeId: stringifyId(primary.outcome.id),
        primaryOutcomeTitle: sanitizeString(primary.outcome.title),
        prices: sanitizeJsonValue(prices) as typeof prices
      },
      metadataVersion,
      sourceTimestamp: timestamp
    }];
  });
};

const buildEventFragments = (
  scope: MyriadHistoricalScope,
  metadataVersion: string,
  events: readonly MyriadMarketEvent[],
  windowStart: Date,
  windowEnd: Date
): HistoricalMarketStateFragment[] => {
  const grouped = new Map<string, MyriadMarketEvent[]>();

  for (const event of events) {
    const timestamp = new Date(event.timestamp * 1_000);
    if (timestamp.getTime() < windowStart.getTime() || timestamp.getTime() > windowEnd.getTime()) {
      continue;
    }
    const key = timestamp.toISOString();
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([timestampIso, bucket]) => {
      const timestamp = new Date(timestampIso);
      const tradeLikeEvents = bucket.filter((event) => event.action === "buy" || event.action === "sell");
      const totalValue = tradeLikeEvents.reduce((sum, event) => sum + event.value, 0);
      const totalShares = tradeLikeEvents.reduce((sum, event) => sum + event.shares, 0);
      const derivedPrice = totalShares > 0 ? String(totalValue / totalShares) : null;

      return {
        canonicalEventId: scope.canonicalEventId,
        canonicalMarketId: scope.canonicalMarketId,
        canonicalCategory: scope.category.toUpperCase() as CreateHistoricalMarketStateInput["canonicalCategory"],
        venue: "MYRIAD",
        venueMarketId: stringifyId(scope.detail.id),
        marketClass: HistoricalMarketClass.BINARY,
        timestamp,
        lastPrice: derivedPrice,
        volume: totalValue > 0 ? String(totalValue) : null,
        marketEvents: {
          source: "MYRIAD",
          depthModel: "amm_conservative",
          historyEvidence: "price_chart+market_events",
          quoteHistoryAvailable: false,
          activitySummary: {
            eventCount: bucket.length,
            tradeLikeEventCount: tradeLikeEvents.length,
            totalValue,
            totalShares
          },
          events: sanitizeJsonValue(bucket) as readonly MyriadMarketEvent[]
        },
        metadataVersion,
        sourceTimestamp: timestamp
      };
    });
};
