import Decimal from "decimal.js";
import type {
  NormalizedQuoteLevel,
  NormalizedVenueQuoteSnapshot,
  VenueQuoteSnapshotBlocker,
  VenueQuoteSnapshotReport
} from "../core/sor/quote-snapshot.js";

export type MarketChartTimeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

export interface MarketDataQuoteSource {
  preloadMappingReadiness?(inputs: readonly {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }[]): Promise<void>;
  getQuoteSnapshotReport(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    side: "buy" | "sell";
    quantity: number;
    readMode?: "live" | "cached_display" | undefined;
    displayMaxAgeMs?: number | undefined;
    venueAllowlist?: readonly string[] | undefined;
  }): Promise<VenueQuoteSnapshotReport>;
}

export interface MarketOrderbookLiveSnapshotSource {
  get(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly NormalizedVenueQuoteSnapshot[]>;
}

export interface MarketHistoricalChartSource {
  listChartPoints(input: {
    marketId: string;
    outcomeId?: string | null | undefined;
    canonicalEventId?: string | null | undefined;
    venueMarketIds?: readonly string[] | undefined;
    venueMappings?: readonly { venue: string; venueMarketId: string }[] | undefined;
    since?: Date | null | undefined;
    limit?: number | undefined;
    timeframe?: MarketChartTimeframe | undefined;
  }): Promise<Array<{ timestamp: Date; venue: string; value: string }>>;
}

export interface MarketOrderbookLevel {
  venue: string;
  venueMarketId: string;
  venueOutcomeId: string | null;
  price: string;
  size: string;
  cumulativeSize: string;
  cumulativeNotional: string;
}

export interface MarketOrderbookVenue {
  venue: string;
  venueMarketId: string;
  venueOutcomeId: string | null;
  source: "STREAM" | "REST";
  hotSnapshotSource?: "memory" | "redis" | "db_last_good" | undefined;
  freshnessMs?: number | undefined;
  snapshotStatus?: "live" | "stale" | "blocked" | "resyncing" | undefined;
  quoteQuality: string;
  sourceTimestamp: string | null;
  receivedAt: string;
  bestBid: string | null;
  bestAsk: string | null;
  midpoint: string | null;
  spread: string | null;
  bidDepth: string;
  askDepth: string;
  blockers: string[];
  bids: MarketOrderbookLevel[];
  asks: MarketOrderbookLevel[];
}

export interface MarketOrderbookResponse {
  marketId: string;
  outcomeId: string | null;
  generatedAt: string;
  depth: number;
  venues: MarketOrderbookVenue[];
  bids: MarketOrderbookLevel[];
  asks: MarketOrderbookLevel[];
  bestBid: string | null;
  bestAsk: string | null;
  midpoint: string | null;
  spread: string | null;
  status: "live" | "partial" | "stale" | "blocked" | "unavailable";
  blockers: VenueQuoteSnapshotBlocker[];
}

export interface MarketChartPoint {
  timestamp: string;
  label: string;
  unified: string | null;
  venues: Record<string, string | null>;
}

export interface MarketChartResponse {
  marketId: string;
  outcomeId: string | null;
  timeframe: MarketChartTimeframe;
  generatedAt: string;
  historyStatus: "live" | "accumulating" | "unavailable";
  series: Array<{ id: string; label: string; color: string }>;
  points: MarketChartPoint[];
  blockers: VenueQuoteSnapshotBlocker[];
}

export interface MarketBatchQuoteRequestItem {
  marketId: string;
  outcomeId: string;
  side?: "buy" | "sell";
  amount?: string | number;
}

export type MarketBatchQuoteDisplayMode = "debug" | "user";

export interface MarketBatchQuoteVenueEvidence {
  venue: string;
  venueMarketId: string;
  venueOutcomeId: string | null;
  price: string | null;
  bid: string | null;
  ask: string | null;
  availableSize: string;
  liquidity: string;
  spread: string | null;
  source: "STREAM" | "REST";
  hotSnapshotSource?: "memory" | "redis" | "db_last_good" | undefined;
  snapshotStatus?: "live" | "stale" | "blocked" | "resyncing" | undefined;
  quoteQuality: string;
  freshnessMs: number | null;
  blockers: string[];
}

export interface MarketBatchQuoteItem {
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  generatedAt: string;
  status: "live" | "partial" | "stale" | "unavailable";
  bestVenue: string | null;
  bestVenuePrice: string | null;
  unifiedAveragePrice: string | null;
  liquidity: string;
  spread: string | null;
  freshnessMs: number | null;
  venues: MarketBatchQuoteVenueEvidence[];
  blockers: VenueQuoteSnapshotBlocker[];
}

export interface MarketBatchQuoteResponse {
  generatedAt: string;
  quotes: MarketBatchQuoteItem[];
}

export interface MarketLivePriceRequestItem {
  marketId: string;
  canonicalMarketIds?: readonly string[] | undefined;
  outcomeId?: string | undefined;
}

export interface MarketLivePriceItem {
  marketId: string;
  outcomeId: string | null;
  generatedAt: string;
  status: "live" | "no_live_price";
  price: string | null;
  bestBid: string | null;
  bestAsk: string | null;
  midpoint: string | null;
  spread: string | null;
  bestVenue: string | null;
  venueCount: number;
  venues: string[];
  liveVenueCount: number;
  liveVenues: string[];
  linkedVenueCount: number;
  linkedVenues: string[];
  averagePrice: string | null;
  freshnessMs: number | null;
}

export interface MarketLivePricesResponse {
  generatedAt: string;
  prices: MarketLivePriceItem[];
}

interface StoredChartPoint {
  marketId: string;
  outcomeId: string | null;
  timestamp: Date;
  unified: string | null;
  venues: Record<string, string | null>;
}

interface BatchQuoteCacheEntry {
  expiresAt: number;
  staleUntil: number;
  item?: MarketBatchQuoteItem;
  promise?: Promise<MarketBatchQuoteItem>;
}

const MAX_STORED_POINTS = 20_000;
const MAX_HISTORY_MS = 31 * 24 * 60 * 60 * 1000;
const ORDERBOOK_CACHE_MS = 3_000;
const ORDERBOOK_LIVE_TIMEOUT_MS = 750;
const ORDERBOOK_MAPPING_PRELOAD_TIMEOUT_MS = 750;
const ORDERBOOK_DISPLAY_SNAPSHOT_MAX_AGE_MS = 120_000;
const CHART_ORDERBOOK_DISPLAY_MAX_AGE_MS = 600_000;
const STREAM_ORDERBOOK_LIVE_FRESHNESS_MS = 15_000;
const REST_ORDERBOOK_LIVE_FRESHNESS_MS = 45_000;
const BATCH_QUOTE_CACHE_MS = 3_000;
const BATCH_QUOTE_REFRESH_GRACE_MS = 15_000;
const BATCH_QUOTE_LIVE_TIMEOUT_MS = 150;
const BATCH_QUOTE_DISPLAY_SNAPSHOT_MAX_AGE_MS = 120_000;
const CHART_CACHE_MS = 10_000;
const CHART_LIVE_POINT_TIMEOUT_MS = 50;
const CHART_HISTORICAL_POINTS_TIMEOUT_MS = 150;
const LIVE_PRICE_CACHE_MS = 2_000;
const VENUE_COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#22D3EE"];

export class LiveMarketDataViewService {
  private readonly chartPoints: StoredChartPoint[] = [];
  private readonly orderbookCache = new Map<string, { expiresAt: number; response?: MarketOrderbookResponse; promise?: Promise<MarketOrderbookResponse> }>();
  private readonly lastGoodOrderbooks = new Map<string, MarketOrderbookResponse>();
  private readonly batchQuoteCache = new Map<string, BatchQuoteCacheEntry>();
  private readonly chartCache = new Map<string, { expiresAt: number; response: MarketChartResponse }>();
  private readonly livePriceCache = new Map<string, { expiresAt: number; item: MarketLivePriceItem }>();
  private readonly lastGoodBatchQuotes = new Map<string, MarketBatchQuoteItem>();
  private readonly now: () => Date;
  private readonly orderbookLiveTimeoutMs: number;
  private readonly batchQuoteLiveTimeoutMs: number;

  public constructor(
    private readonly quoteSource: MarketDataQuoteSource,
    options: {
      now?: () => Date;
      orderbookLiveTimeoutMs?: number | undefined;
      batchQuoteLiveTimeoutMs?: number | undefined;
      historicalChartSource?: MarketHistoricalChartSource | undefined;
      liveOrderbookSource?: MarketOrderbookLiveSnapshotSource | undefined;
    } = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.orderbookLiveTimeoutMs = Math.max(50, Math.min(options.orderbookLiveTimeoutMs ?? ORDERBOOK_LIVE_TIMEOUT_MS, 5_000));
    this.batchQuoteLiveTimeoutMs = Math.max(50, Math.min(options.batchQuoteLiveTimeoutMs ?? BATCH_QUOTE_LIVE_TIMEOUT_MS, 5_000));
    this.historicalChartSource = options.historicalChartSource;
    this.liveOrderbookSource = options.liveOrderbookSource;
  }

  private readonly historicalChartSource: MarketHistoricalChartSource | undefined;
  private readonly liveOrderbookSource: MarketOrderbookLiveSnapshotSource | undefined;

  public async getLivePrices(input: {
    items: readonly MarketLivePriceRequestItem[];
  }): Promise<MarketLivePricesResponse> {
    const generatedAt = this.now();
    const prices = await Promise.all(input.items.map((item) => this.getLivePriceItem(item, generatedAt)));
    return {
      generatedAt: generatedAt.toISOString(),
      prices
    };
  }

  private async getLivePriceItem(item: MarketLivePriceRequestItem, generatedAt: Date): Promise<MarketLivePriceItem> {
    const normalizedOutcomeId = normalizeBinaryOutcomeId(item.outcomeId);
    const marketIds = normalizeOrderbookMarketIds(item.marketId, item.canonicalMarketIds);
    const key = livePriceCacheKey(orderbookCacheMarketKey(item.marketId, marketIds), normalizedOutcomeId ?? null);
    const cached = this.livePriceCache.get(key);
    if (cached && cached.expiresAt > generatedAt.getTime()) {
      return {
        ...cached.item,
        generatedAt: generatedAt.toISOString()
      };
    }
    const outcomeIds = livePriceDisplayOutcomeIds(normalizedOutcomeId);
    // Collect live snapshots per canonical market ID so we can detect partial coverage.
    // flatMap loses per-ID structure needed to identify which venues are missing.
    const liveSnapshotsPerMarket: readonly NormalizedVenueQuoteSnapshot[][] = this.liveOrderbookSource
      ? await Promise.all(marketIds.map(async (canonicalMarketId) => {
          const results = await Promise.all(
            outcomeIds.map((outcomeId) => this.liveOrderbookSource!.get({
              canonicalMarketId,
              ...(outcomeId ? { canonicalOutcomeId: outcomeId } : {})
            }).catch((): readonly NormalizedVenueQuoteSnapshot[] => []))
          );
          return results.flat();
        }))
      : marketIds.map((): NormalizedVenueQuoteSnapshot[] => []);
    const liveSnapshots = dedupeSnapshotsByIdentity(liveSnapshotsPerMarket.flat());
    // When any canonical market ID has no live snapshots (e.g. LIMITLESS expired from
    // 30s Redis TTL while POLYMARKET is always hot via WebSocket), fall through to
    // quoteSource so hotQuoteSnapshots (memory → Redis → DB) fills the gap.
    // Without this, POLYMARKET-only live cache silences LIMITLESS in the closed card price.
    const liveCacheIncomplete = marketIds.length > 1 && liveSnapshotsPerMarket.some((s) => s.length === 0);
    let snapshots: readonly NormalizedVenueQuoteSnapshot[] = (liveSnapshots.length === 0 || liveCacheIncomplete) && this.quoteSource
      ? dedupeSnapshotsByIdentity((await Promise.all(marketIds.map((canonicalMarketId) =>
          this.quoteSource!.getQuoteSnapshotReport({
            canonicalMarketId,
            ...(normalizedOutcomeId ? { canonicalOutcomeId: normalizedOutcomeId } : {}),
            side: "buy",
            quantity: 1,
            readMode: "cached_display",
            displayMaxAgeMs: ORDERBOOK_DISPLAY_SNAPSHOT_MAX_AGE_MS
          }).then((r) => r.snapshots).catch(() => [] as readonly NormalizedVenueQuoteSnapshot[])
        ))).flat())
      : liveSnapshots;
    let liveVenues = snapshots
      .map((snapshot) => sanitizeVenueOrderbook(snapshot, 5, generatedAt))
      .filter(isLiveTradableOrderbookVenue);
    // Level 3: live REST fetch when Redis and DB cached snapshot both yield no usable prices
    if (liveVenues.length === 0 && this.quoteSource) {
      const restSnapshots = dedupeSnapshotsByIdentity((await Promise.all(marketIds.map((canonicalMarketId) =>
        this.quoteSource!.getQuoteSnapshotReport({
          canonicalMarketId,
          ...(normalizedOutcomeId ? { canonicalOutcomeId: normalizedOutcomeId } : {}),
          side: "buy",
          quantity: 1,
          readMode: "live"
        }).then((r) => r.snapshots).catch(() => [] as readonly NormalizedVenueQuoteSnapshot[])
      ))).flat());
      if (restSnapshots.length > 0) {
        snapshots = restSnapshots;
        liveVenues = snapshots
          .map((snapshot) => sanitizeVenueOrderbook(snapshot, 5, generatedAt))
          .filter(isLiveTradableOrderbookVenue);
      }
    }
    const liveVenueNames = [...new Set(liveVenues.map((venue) => venue.venue))].sort();
    const linkedVenues = linkedVenuesFromMarketIds(marketIds, snapshots);
    const bids = sortLevels(liveVenues.flatMap((venue) => venue.bids), "desc");
    const asks = sortLevels(liveVenues.flatMap((venue) => venue.asks), "asc");
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const midpoint = midpointFromBest(bestBid, bestAsk);
    const spread = spreadFromBest(bestBid, bestAsk);
    const bestVenue = asks[0]?.venue ?? bids[0]?.venue ?? null;
    const averagePrice = averageDecimalStrings(liveVenues
      .map((venue) => venue.midpoint ?? venue.bestAsk ?? venue.bestBid)
      .filter((value): value is string => value !== null));
    const price = averagePrice ?? midpoint ?? bestAsk ?? bestBid;
    const freshnessValues = liveVenues
      .map((venue) => venue.freshnessMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const output: MarketLivePriceItem = {
      marketId: item.marketId,
      outcomeId: normalizedOutcomeId ?? null,
      generatedAt: generatedAt.toISOString(),
      status: price ? "live" : "no_live_price",
      price,
      bestBid,
      bestAsk,
      midpoint,
      spread,
      bestVenue,
      venueCount: liveVenues.length,
      venues: liveVenueNames,
      liveVenueCount: liveVenues.length,
      liveVenues: liveVenueNames,
      linkedVenueCount: linkedVenues.length,
      linkedVenues,
      averagePrice,
      freshnessMs: freshnessValues.length > 0 ? Math.min(...freshnessValues) : null
    };
    this.livePriceCache.set(key, {
      expiresAt: generatedAt.getTime() + LIVE_PRICE_CACHE_MS,
      item: output
    });
    return output;
  }

  public async getOrderbook(input: {
    marketId: string;
    canonicalMarketIds?: readonly string[] | undefined;
    outcomeId?: string | undefined;
    depth?: number | undefined;
    venue?: string | undefined;
    snapshotOnly?: boolean | undefined;
  }): Promise<MarketOrderbookResponse> {
    const normalizedOutcomeId = normalizeBinaryOutcomeId(input.outcomeId);
    const normalizedInput = {
      ...input,
      ...(normalizedOutcomeId ? { outcomeId: normalizedOutcomeId } : { outcomeId: undefined })
    };
    const generatedAt = this.now();
    const depth = clampDepth(input.depth);
    const orderbookMarketIds = normalizeOrderbookMarketIds(normalizedInput.marketId, normalizedInput.canonicalMarketIds);
    const key = orderbookCacheKey(
      orderbookCacheMarketKey(normalizedInput.marketId, orderbookMarketIds),
      normalizedInput.outcomeId ?? null,
      normalizedInput.venue ?? null,
      depth
    );
    const cached = this.orderbookCache.get(key);
    if (cached && cached.expiresAt > generatedAt.getTime()) {
      if (cached.response) {
        return {
          ...cached.response,
          generatedAt: generatedAt.toISOString()
        };
      }
      if (cached.promise && !normalizedInput.snapshotOnly) {
        return cached.promise;
      }
    }

    const cachedLiveOrderbook = await this.getCachedLiveOrderbook(normalizedInput, generatedAt, depth, orderbookMarketIds);
    if (cachedLiveOrderbook) {
      this.lastGoodOrderbooks.set(key, cachedLiveOrderbook);
      this.orderbookCache.set(key, { expiresAt: generatedAt.getTime() + ORDERBOOK_CACHE_MS, response: cachedLiveOrderbook });
      return cachedLiveOrderbook;
    }

    if (normalizedInput.snapshotOnly) {
      return unavailableOrderbook({
        input: normalizedInput,
        generatedAt,
        depth,
        reason: "MARKET_ORDERBOOK_SNAPSHOT_PENDING"
      });
    }

    await this.preloadOrderbookMappings(orderbookMarketIds, normalizedInput.outcomeId);
    const livePromise = this.loadOrderbook(normalizedInput, generatedAt, depth, orderbookMarketIds)
      .catch((error) => unavailableOrderbook({
        input: normalizedInput,
        generatedAt,
        depth,
        reason: error instanceof Error && error.message ? "LIVE_ORDERBOOK_UNAVAILABLE" : "MARKET_ORDERBOOK_UNAVAILABLE"
      }));
    const promise = withTimeout(
      livePromise,
      this.orderbookRequestTimeoutMs(),
      unavailableOrderbook({
        input: normalizedInput,
        generatedAt,
        depth,
        reason: "MARKET_ORDERBOOK_REFRESH_DEFERRED"
      })
    );
    void livePromise
      .then((orderbook) => {
        const output = orderbook;
        if (isDeferredOrderbook(output)) {
          this.orderbookCache.delete(key);
          return;
        }
        if (isDisplayUsableOrderbook(output)) {
          this.lastGoodOrderbooks.set(key, output);
        }
        this.orderbookCache.set(key, { expiresAt: this.now().getTime() + ORDERBOOK_CACHE_MS, response: output });
      })
      .catch(() => undefined);
    this.orderbookCache.set(key, { expiresAt: generatedAt.getTime() + ORDERBOOK_CACHE_MS, promise });

    const orderbook = await promise;
    const output = orderbook;
    if (isDisplayUsableOrderbook(output)) {
      this.lastGoodOrderbooks.set(key, output);
    }
    if (isDeferredOrderbook(output)) {
      this.orderbookCache.delete(key);
    } else {
      this.orderbookCache.set(key, { expiresAt: generatedAt.getTime() + ORDERBOOK_CACHE_MS, response: output });
    }
    return output;
  }

  private async getCachedLiveOrderbook(input: {
    marketId: string;
    canonicalMarketIds?: readonly string[] | undefined;
    outcomeId?: string | undefined;
    depth?: number | undefined;
    venue?: string | undefined;
  }, generatedAt: Date, depth: number, orderbookMarketIds: readonly string[]): Promise<MarketOrderbookResponse | null> {
    if (!this.liveOrderbookSource) {
      return null;
    }
    const reports = await Promise.all(orderbookMarketIds.map(async (canonicalMarketId): Promise<VenueQuoteSnapshotReport> => {
      try {
        return {
          snapshots: await this.liveOrderbookSource!.get({
            canonicalMarketId,
            ...(input.outcomeId ? { canonicalOutcomeId: input.outcomeId } : {})
          }),
          blocked: []
        };
      } catch {
        return { snapshots: [], blocked: [] };
      }
    }));
    // If any canonical market ID has no live snapshots, fall through to loadOrderbook()
    // so hotQuoteSnapshots (memory → Redis → DB) fills the gap. Without this, a
    // POLYMARKET-only live cache result would mask LIMITLESS whose 30s Redis TTL expired,
    // causing the terminal to show only Polymarket despite LIMITLESS being live in hotQuoteSnapshots.
    if (orderbookMarketIds.length > 1 && reports.some((report) => report.snapshots.length === 0)) {
      return null;
    }
    const report = mergeVenueQuoteSnapshotReports(reports);
    if (report.snapshots.length === 0) {
      return null;
    }
    const orderbook = this.orderbookFromReport(input, generatedAt, depth, report);
    return isDisplayUsableOrderbook(orderbook) ? orderbook : null;
  }

  private async loadOrderbook(input: {
    marketId: string;
    canonicalMarketIds?: readonly string[] | undefined;
    outcomeId?: string | undefined;
    depth?: number | undefined;
    venue?: string | undefined;
  }, generatedAt: Date, depth: number, orderbookMarketIds: readonly string[]): Promise<MarketOrderbookResponse> {
    const loadReport = (canonicalMarketId: string): Promise<VenueQuoteSnapshotReport> =>
      this.quoteSource.getQuoteSnapshotReport({
        canonicalMarketId,
        ...(input.outcomeId ? { canonicalOutcomeId: input.outcomeId } : {}),
        side: "buy",
        quantity: 1,
        readMode: "cached_display",
        displayMaxAgeMs: ORDERBOOK_DISPLAY_SNAPSHOT_MAX_AGE_MS
      });
    const reports = orderbookMarketIds.length > 1
      ? await Promise.all(orderbookMarketIds.map((canonicalMarketId) =>
        withTimeout(
          loadReport(canonicalMarketId),
          this.orderbookLiveTimeoutMs,
          orderbookLegDeferredReport(canonicalMarketId)
        )
      ))
      : [await loadReport(orderbookMarketIds[0] ?? input.marketId)];
    const report = mergeVenueQuoteSnapshotReports(reports);
    return this.orderbookFromReport(input, generatedAt, depth, report);
  }

  private orderbookFromReport(input: {
    marketId: string;
    canonicalMarketIds?: readonly string[] | undefined;
    outcomeId?: string | undefined;
    depth?: number | undefined;
    venue?: string | undefined;
  }, generatedAt: Date, depth: number, report: VenueQuoteSnapshotReport): MarketOrderbookResponse {
    const venueFilter = input.venue?.trim().toUpperCase();
    const snapshots = venueFilter
      ? report.snapshots.filter((snapshot) => snapshot.venue.toUpperCase() === venueFilter)
      : report.snapshots;
    const allVenues = snapshots.map((snapshot) => sanitizeVenueOrderbook(snapshot, depth, generatedAt));
    const staleVenueBlockers = allVenues
      .filter((venue) => venue.snapshotStatus === "stale")
      .map((venue) => ({
        venue: venue.venue,
        reason: "LIVE_ORDERBOOK_REQUIRED",
        venueMarketId: venue.venueMarketId,
        venueOutcomeId: venue.venueOutcomeId ?? undefined
      }));
    const venues = allVenues.filter(isLiveTradableOrderbookVenue);
    const bids = sortLevels(venues.flatMap((venue) => venue.bids), "desc").slice(0, depth);
    const asks = sortLevels(venues.flatMap((venue) => venue.asks), "asc").slice(0, depth);
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const midpoint = midpointFromBest(bestBid, bestAsk);
    const spread = spreadFromBest(bestBid, bestAsk);
    const sourceBlockers = venueFilter
      ? report.blocked.filter((blocker) => blocker.venue.toUpperCase() === venueFilter)
      : report.blocked;
    const visibleSourceBlockers = venues.length > 0
      ? sourceBlockers.filter((blocker) => !isLotusDeferredLegBlocker(blocker))
      : sourceBlockers;
    const hasSuppressedDeferredLeg = sourceBlockers.length !== visibleSourceBlockers.length;
    const blockers = [...visibleSourceBlockers, ...staleVenueBlockers];
    const status = resolveOrderbookStatus(venues, blockers, hasSuppressedDeferredLeg);

    this.recordChartPoint({
      marketId: input.marketId,
      outcomeId: input.outcomeId ?? null,
      timestamp: generatedAt,
      unified: midpoint,
      venues: Object.fromEntries(venues.map((venue) => [venue.venue, venue.midpoint]))
    });

    return {
      marketId: input.marketId,
      outcomeId: input.outcomeId ?? null,
      generatedAt: generatedAt.toISOString(),
      depth,
      venues,
      bids,
      asks,
      bestBid,
      bestAsk,
      midpoint,
      spread,
      status,
      blockers: [...blockers]
    };
  }

  private orderbookRequestTimeoutMs(): number {
    return Math.min(5_000, this.orderbookLiveTimeoutMs + 25);
  }

  private async preloadOrderbookMappings(
    canonicalMarketIds: readonly string[],
    outcomeId: string | undefined
  ): Promise<void> {
    if (!this.quoteSource.preloadMappingReadiness || canonicalMarketIds.length === 0) {
      return;
    }
    await withTimeout(
      this.quoteSource.preloadMappingReadiness(canonicalMarketIds.map((canonicalMarketId) => ({
        canonicalMarketId,
        ...(outcomeId ? { canonicalOutcomeId: outcomeId } : {})
      }))),
      ORDERBOOK_MAPPING_PRELOAD_TIMEOUT_MS,
      undefined
    );
  }

  private staleOrderbookFromLastGood(key: string, current: MarketOrderbookResponse, generatedAt: Date): MarketOrderbookResponse | null {
    const lastGood = this.lastGoodOrderbooks.get(key);
    if (!lastGood) return null;
    return {
      ...lastGood,
      generatedAt: generatedAt.toISOString(),
      status: lastGood.status === "live" ? "stale" : lastGood.status,
      blockers: [
        ...current.blockers,
        {
          venue: "LOTUS",
          reason: "LAST_GOOD_ORDERBOOK_USED",
          detailsCode: lastGood.generatedAt
        }
      ]
    };
  }

  public async getBatchQuotes(input: {
    items: readonly MarketBatchQuoteRequestItem[];
    displayMode?: MarketBatchQuoteDisplayMode | undefined;
  }): Promise<MarketBatchQuoteResponse> {
    const generatedAt = this.now();
    const quotes = await Promise.all(input.items.map(async (item) => {
      const side = item.side ?? "buy";
      const quantity = normalizeQuoteAmount(item.amount);
      const key = batchQuoteCacheKey(item.marketId, item.outcomeId, side, quantity);
      const cached = this.batchQuoteCache.get(key);
      if (cached && cached.expiresAt > generatedAt.getTime()) {
        if (cached.item && isDisplayUsableBatchQuote(cached.item)) return cached.item;
        if (cached.item) this.batchQuoteCache.delete(key);
        if (cached.promise) return cached.promise;
      }
      if (cached?.item && isDisplayUsableBatchQuote(cached.item) && cached.staleUntil > generatedAt.getTime()) {
        this.refreshBatchQuoteInBackground(key, { item, side, quantity, generatedAt });
        return batchQuoteFromRefreshGrace(cached.item, generatedAt);
      }
      const livePromise = this.loadBatchQuoteItem({ item, side, quantity, generatedAt });
      const promise = withTimeout(
        livePromise,
        this.batchQuoteLiveTimeoutMs,
        unavailableBatchQuoteItem({
          item,
          side,
          generatedAt,
          reason: "MARKET_BATCH_QUOTE_REFRESH_DEFERRED"
        })
      );
      void livePromise
        .then((quote) => {
          const output = quote;
          if (output.status === "live" || output.status === "partial") {
            this.lastGoodBatchQuotes.set(key, output);
            this.cacheBatchQuoteItem(key, output, this.now());
          }
        })
        .catch(() => undefined);
      this.batchQuoteCache.set(key, {
        expiresAt: generatedAt.getTime() + BATCH_QUOTE_CACHE_MS,
        staleUntil: generatedAt.getTime() + BATCH_QUOTE_REFRESH_GRACE_MS,
        promise
      });
      const quote = await promise;
      const output = quote;
      if (output.status === "live" || output.status === "partial") {
        this.lastGoodBatchQuotes.set(key, output);
      }
      if (isDeferredBatchQuote(output)) {
        this.batchQuoteCache.delete(key);
      } else if (isDisplayUsableBatchQuote(output)) {
        this.cacheBatchQuoteItem(key, output, generatedAt);
      } else {
        this.batchQuoteCache.delete(key);
      }
      return output;
    }));
    return {
      generatedAt: generatedAt.toISOString(),
      quotes: input.displayMode === "user"
        ? quotes.map(toUserFacingBatchQuote)
        : quotes
    };
  }

  private refreshBatchQuoteInBackground(
    key: string,
    input: {
      item: MarketBatchQuoteRequestItem;
      side: "buy" | "sell";
      quantity: number;
      generatedAt: Date;
    }
  ): void {
    const cached = this.batchQuoteCache.get(key);
    if (cached?.promise) {
      return;
    }
    const livePromise = this.loadBatchQuoteItem(input)
      .then((quote) => {
        const output = quote;
        if (output.status === "live" || output.status === "partial") {
          this.lastGoodBatchQuotes.set(key, output);
          this.cacheBatchQuoteItem(key, output, this.now());
        } else if (isDeferredBatchQuote(output)) {
          this.batchQuoteCache.delete(key);
        } else {
          const current = this.batchQuoteCache.get(key);
          if (current?.promise === livePromise) {
            this.batchQuoteCache.delete(key);
          }
        }
        return output;
      })
      .catch((error) => {
        const current = this.batchQuoteCache.get(key);
        if (current) {
          this.batchQuoteCache.set(key, batchQuoteCacheEntryWithoutPromise(current));
        }
        throw error;
      })
      .finally(() => {
        const current = this.batchQuoteCache.get(key);
        if (current?.promise === livePromise) {
          this.batchQuoteCache.set(key, batchQuoteCacheEntryWithoutPromise(current));
        }
      });
    if (cached) {
      this.batchQuoteCache.set(key, { ...cached, promise: livePromise });
    }
    void livePromise.catch(() => undefined);
  }

  private cacheBatchQuoteItem(key: string, item: MarketBatchQuoteItem, generatedAt: Date): void {
    this.batchQuoteCache.set(key, {
      expiresAt: generatedAt.getTime() + BATCH_QUOTE_CACHE_MS,
      staleUntil: generatedAt.getTime() + BATCH_QUOTE_REFRESH_GRACE_MS,
      item
    });
  }

  private staleBatchQuoteFromLastGood(key: string, current: MarketBatchQuoteItem, generatedAt: Date): MarketBatchQuoteItem | null {
    const lastGood = this.lastGoodBatchQuotes.get(key);
    if (!lastGood) return null;
    return {
      ...lastGood,
      generatedAt: generatedAt.toISOString(),
      status: "stale",
      blockers: [
        ...current.blockers,
        {
          venue: "LOTUS",
          reason: "LAST_GOOD_QUOTE_USED",
          detailsCode: lastGood.generatedAt
        }
      ]
    };
  }

  private async loadBatchQuoteItem(input: {
    item: MarketBatchQuoteRequestItem;
    side: "buy" | "sell";
    quantity: number;
    generatedAt: Date;
  }): Promise<MarketBatchQuoteItem> {
    try {
      const report = await this.quoteSource.getQuoteSnapshotReport({
        canonicalMarketId: input.item.marketId,
        canonicalOutcomeId: input.item.outcomeId,
        side: input.side,
        quantity: input.quantity,
        readMode: "cached_display",
        displayMaxAgeMs: BATCH_QUOTE_DISPLAY_SNAPSHOT_MAX_AGE_MS
      });
      return buildBatchQuoteItem({
        marketId: input.item.marketId,
        outcomeId: input.item.outcomeId,
        side: input.side,
        generatedAt: input.generatedAt,
        report,
        now: input.generatedAt
      });
    } catch (error) {
      return unavailableBatchQuoteItem({
        item: input.item,
        side: input.side,
        generatedAt: input.generatedAt,
        reason: error instanceof Error ? error.message : "MARKET_BATCH_QUOTE_UNAVAILABLE"
      });
    }
  }

  public async getChart(input: {
    marketId: string;
    outcomeId?: string | undefined;
    outcomeLabel?: string | undefined;
    canonicalEventId?: string | null | undefined;
    venueMarketIds?: readonly string[] | undefined;
    venueMappings?: readonly { venue: string; venueMarketId: string }[] | undefined;
    timeframe: MarketChartTimeframe;
  }): Promise<MarketChartResponse> {
    const cacheKey = chartCacheKey(input);
    const now = this.now();
    const cached = this.chartCache.get(cacheKey);
    if (cached && cached.expiresAt > now.getTime()) {
      return {
        ...cached.response,
        generatedAt: now.toISOString()
      };
    }
    const cutoff = timeframeCutoff(input.timeframe, this.now());
    const [orderbook, historicalPoints] = await Promise.all([
      withTimeout(
        this.getChartOrderbook(input),
        CHART_LIVE_POINT_TIMEOUT_MS,
        unavailableChartOrderbook(input, now.toISOString(), "LIVE_ORDERBOOK_TIMEOUT")
      ),
      withTimeout(
        this.loadHistoricalChartPoints({
          marketId: input.marketId,
          outcomeId: input.outcomeId ?? null,
          canonicalEventId: input.canonicalEventId,
          venueMarketIds: input.venueMarketIds,
          venueMappings: input.venueMappings,
          since: cutoff,
          timeframe: input.timeframe,
          outcomeLabel: input.outcomeLabel
        }),
        CHART_HISTORICAL_POINTS_TIMEOUT_MS,
        []
      )
    ]);
    const storedPoints = this.chartPoints
      .filter((point) =>
        point.marketId === input.marketId &&
        point.outcomeId === (input.outcomeId ?? null) &&
        (cutoff === null || point.timestamp >= cutoff)
      )
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    const points = mergeChartPoints(historicalPoints, storedPoints);
    const venueIds = [...new Set(points.flatMap((point) => Object.keys(point.venues)))].sort();
    const series = [
      { id: "unified", label: "Unified", color: "#ccff00" },
      ...venueIds.map((venue, index) => ({
        id: venue,
        label: venueLabel(venue),
        color: VENUE_COLORS[index % VENUE_COLORS.length]!
      }))
    ];
    const historyStatus: MarketChartResponse["historyStatus"] = points.length > 1
      ? "live"
      : orderbook.status === "unavailable" || orderbook.status === "blocked"
        ? "unavailable"
        : "accumulating";
    const response: MarketChartResponse = {
      marketId: input.marketId,
      outcomeId: input.outcomeId ?? null,
      timeframe: input.timeframe,
      generatedAt: now.toISOString(),
      historyStatus,
      series,
      points: points.map((point) => ({
        timestamp: point.timestamp.toISOString(),
        label: formatChartLabel(point.timestamp, input.timeframe),
        unified: point.unified,
        venues: point.venues
      })),
      blockers: orderbook.blockers
    };
    this.chartCache.set(cacheKey, {
      expiresAt: now.getTime() + CHART_CACHE_MS,
      response
    });
    return response;
  }

  private async getChartOrderbook(input: {
    marketId: string;
    outcomeId?: string | undefined;
  }): Promise<MarketOrderbookResponse> {
    const generatedAt = this.now();
    const depth = 5;
    try {
      const orderbook = await this.getOrderbook({
        marketId: input.marketId,
        ...(input.outcomeId ? { outcomeId: input.outcomeId } : {}),
        depth
      });
      if (orderbook.venues.length > 0) {
        return orderbook;
      }
      // Cold-start: only LIVE_ORDERBOOK_REQUIRED blockers with no live venues.
      // Re-read with a wider staleness window — chart only needs a price to plot, not execution safety.
      const hasOnlyStaleBlockers = orderbook.blockers.length > 0 &&
        orderbook.blockers.every((b) => b.reason === "LIVE_ORDERBOOK_REQUIRED");
      if (!hasOnlyStaleBlockers || !this.quoteSource) {
        return orderbook;
      }
      const report = await this.quoteSource.getQuoteSnapshotReport({
        canonicalMarketId: input.marketId,
        ...(input.outcomeId ? { canonicalOutcomeId: input.outcomeId } : {}),
        side: "buy",
        quantity: 1,
        readMode: "cached_display",
        displayMaxAgeMs: CHART_ORDERBOOK_DISPLAY_MAX_AGE_MS
      }).catch(() => null);
      if (!report || report.snapshots.length === 0) {
        return orderbook;
      }
      const allVenues = report.snapshots.map((s) => sanitizeVenueOrderbook(s, depth, generatedAt));
      const usableVenues = allVenues.filter((v) => v.bestBid !== null || v.bestAsk !== null);
      if (usableVenues.length === 0) {
        return orderbook;
      }
      const bids = sortLevels(usableVenues.flatMap((v) => v.bids), "desc").slice(0, depth);
      const asks = sortLevels(usableVenues.flatMap((v) => v.asks), "asc").slice(0, depth);
      const bestBid = bids[0]?.price ?? null;
      const bestAsk = asks[0]?.price ?? null;
      const midpoint = midpointFromBest(bestBid, bestAsk);
      const spread = spreadFromBest(bestBid, bestAsk);
      this.recordChartPoint({
        marketId: input.marketId,
        outcomeId: input.outcomeId ?? null,
        timestamp: generatedAt,
        unified: midpoint,
        venues: Object.fromEntries(usableVenues.map((v) => [v.venue, v.midpoint]))
      });
      return {
        marketId: input.marketId,
        outcomeId: input.outcomeId ?? null,
        generatedAt: generatedAt.toISOString(),
        depth,
        venues: usableVenues,
        bids,
        asks,
        bestBid,
        bestAsk,
        midpoint,
        spread,
        status: usableVenues.some((v) => v.snapshotStatus === "live") ? "live" : "stale",
        blockers: []
      };
    } catch (error) {
      return {
        marketId: input.marketId,
        outcomeId: input.outcomeId ?? null,
        generatedAt: generatedAt.toISOString(),
        depth,
        venues: [],
        bids: [],
        asks: [],
        bestBid: null,
        bestAsk: null,
        midpoint: null,
        spread: null,
        status: "unavailable",
        blockers: [{
          venue: "LOTUS",
          reason: error instanceof Error && error.message ? "LIVE_ORDERBOOK_UNAVAILABLE" : "MARKET_ORDERBOOK_UNAVAILABLE"
        }]
      };
    }
  }

  private recordChartPoint(point: StoredChartPoint): void {
    const previous = this.chartPoints[this.chartPoints.length - 1];
    if (
      previous &&
      previous.marketId === point.marketId &&
      previous.outcomeId === point.outcomeId &&
      point.timestamp.getTime() - previous.timestamp.getTime() < 5_000
    ) {
      this.chartPoints[this.chartPoints.length - 1] = point;
    } else {
      this.chartPoints.push(point);
    }
    const cutoffMs = this.now().getTime() - MAX_HISTORY_MS;
    while (this.chartPoints.length > MAX_STORED_POINTS || (this.chartPoints[0]?.timestamp.getTime() ?? cutoffMs) < cutoffMs) {
      this.chartPoints.shift();
    }
  }

  private async loadHistoricalChartPoints(input: {
    marketId: string;
    outcomeId: string | null;
    canonicalEventId?: string | null | undefined;
    venueMarketIds?: readonly string[] | undefined;
    venueMappings?: readonly { venue: string; venueMarketId: string }[] | undefined;
    since: Date | null;
    timeframe: MarketChartTimeframe;
    outcomeLabel?: string | undefined;
  }): Promise<StoredChartPoint[]> {
    if (!this.historicalChartSource) {
      return [];
    }
    let rows: Array<{ timestamp: Date; venue: string; value: string }>;
    try {
      rows = await this.historicalChartSource.listChartPoints({
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        canonicalEventId: input.canonicalEventId,
        venueMarketIds: input.venueMarketIds,
        venueMappings: input.venueMappings,
        since: input.since,
        timeframe: input.timeframe,
        limit: 600
      });
    } catch {
      return [];
    }
    const byTimestamp = new Map<number, StoredChartPoint>();
    for (const row of rows) {
      const value = normalizeHistoricalOutcomeValue(row.value, input.outcomeLabel);
      if (value === null) continue;
      const bucket = Math.round(row.timestamp.getTime() / 60_000) * 60_000;
      const existing = byTimestamp.get(bucket) ?? {
        marketId: input.marketId,
        outcomeId: null,
        timestamp: new Date(bucket),
        unified: null,
        venues: {}
      };
      existing.venues[row.venue.toUpperCase()] = value;
      byTimestamp.set(bucket, existing);
    }
    return [...byTimestamp.values()]
      .map((point) => ({
        ...point,
        unified: averageDecimalStrings(Object.values(point.venues))
      }))
      .filter((point) => point.unified !== null || Object.keys(point.venues).length > 0)
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const unavailableBatchQuoteItem = (input: {
  item: MarketBatchQuoteRequestItem;
  side: "buy" | "sell";
  generatedAt: Date;
  reason: string;
}): MarketBatchQuoteItem => ({
  marketId: input.item.marketId,
  outcomeId: input.item.outcomeId,
  side: input.side,
  generatedAt: input.generatedAt.toISOString(),
  status: "unavailable",
  bestVenue: null,
  bestVenuePrice: null,
  unifiedAveragePrice: null,
  liquidity: "0",
  spread: null,
  freshnessMs: null,
  venues: [],
  blockers: [{
    venue: "LOTUS",
    reason: input.reason
  }]
});

const unavailableChartOrderbook = (
  input: { marketId: string; outcomeId?: string | undefined },
  generatedAt: string,
  reason: string
): MarketOrderbookResponse => ({
  marketId: input.marketId,
  outcomeId: input.outcomeId ?? null,
  generatedAt,
  depth: 5,
  venues: [],
  bids: [],
  asks: [],
  bestBid: null,
  bestAsk: null,
  midpoint: null,
  spread: null,
  status: "unavailable",
  blockers: [{ venue: "LOTUS", reason }]
});

const unavailableOrderbook = (input: {
  input: {
    marketId: string;
    outcomeId?: string | undefined;
    venue?: string | undefined;
  };
  generatedAt: Date;
  depth: number;
  reason: string;
}): MarketOrderbookResponse => ({
  marketId: input.input.marketId,
  outcomeId: input.input.outcomeId ?? null,
  generatedAt: input.generatedAt.toISOString(),
  depth: input.depth,
  venues: [],
  bids: [],
  asks: [],
  bestBid: null,
  bestAsk: null,
  midpoint: null,
  spread: null,
  status: "unavailable",
  blockers: [{
    venue: input.input.venue?.trim().toUpperCase() || "LOTUS",
    reason: input.reason
  }]
});

const orderbookCacheKey = (
  marketId: string,
  outcomeId: string | null,
  venue: string | null,
  depth: number
): string => `${marketId}\u0000${outcomeId ?? ""}\u0000${venue?.trim().toUpperCase() ?? ""}\u0000${depth}`;

const orderbookCacheMarketKey = (marketId: string, canonicalMarketIds: readonly string[]): string =>
  canonicalMarketIds.length === 1 && canonicalMarketIds[0] === marketId
    ? marketId
    : `${marketId}\u0000${canonicalMarketIds.join("\u0001")}`;

const normalizeOrderbookMarketIds = (
  marketId: string,
  canonicalMarketIds: readonly string[] | undefined
): string[] => {
  const normalized = [...new Set((canonicalMarketIds ?? [marketId])
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];
  return normalized.length > 0 ? normalized : [marketId];
};

const normalizeBinaryOutcomeId = (outcomeId: string | undefined): string | undefined => {
  const trimmed = outcomeId?.trim();
  if (!trimmed) {
    return undefined;
  }
  const upper = trimmed.toUpperCase();
  return upper === "YES" || upper === "NO" ? upper : trimmed;
};

const mergeVenueQuoteSnapshotReports = (reports: readonly VenueQuoteSnapshotReport[]): VenueQuoteSnapshotReport => {
  const snapshotsByKey = new Map<string, NormalizedVenueQuoteSnapshot>();
  const blockedByKey = new Map<string, VenueQuoteSnapshotBlocker>();
  for (const report of reports) {
    for (const snapshot of report.snapshots) {
      snapshotsByKey.set(venueSnapshotIdentityKey(snapshot), snapshot);
    }
    for (const blocker of report.blocked) {
      blockedByKey.set(venueBlockerIdentityKey(blocker), blocker);
    }
  }
  return {
    snapshots: [...snapshotsByKey.values()],
    blocked: [...blockedByKey.values()]
  };
};

const orderbookLegDeferredReport = (canonicalMarketId: string): VenueQuoteSnapshotReport => ({
  snapshots: [],
  blocked: [{
    venue: "LOTUS",
    reason: "MARKET_ORDERBOOK_LEG_REFRESH_DEFERRED",
    detailsCode: canonicalMarketId
  }]
});

const venueSnapshotIdentityKey = (snapshot: NormalizedVenueQuoteSnapshot): string =>
  `${snapshot.venue.toUpperCase()}\u0000${snapshot.venueMarketId}\u0000${snapshot.venueOutcomeId ?? ""}`;

const dedupeSnapshotsByIdentity = (
  snapshots: readonly NormalizedVenueQuoteSnapshot[]
): NormalizedVenueQuoteSnapshot[] => {
  const byKey = new Map<string, NormalizedVenueQuoteSnapshot>();
  for (const snapshot of snapshots) {
    const key = venueSnapshotIdentityKey(snapshot);
    const existing = byKey.get(key);
    if (!existing || snapshot.receivedAt.getTime() > existing.receivedAt.getTime()) {
      byKey.set(key, snapshot);
    }
  }
  return [...byKey.values()];
};

const venueBlockerIdentityKey = (blocker: VenueQuoteSnapshotBlocker): string =>
  `${blocker.venue.toUpperCase()}\u0000${blocker.reason}\u0000${blocker.venueMarketId ?? ""}\u0000${blocker.venueOutcomeId ?? ""}`;

const livePriceDisplayOutcomeIds = (outcomeId: string | undefined): readonly (string | undefined)[] =>
  outcomeId ? [outcomeId] : [undefined, "YES"];

const linkedVenuesFromMarketIds = (
  marketIds: readonly string[],
  snapshots: readonly NormalizedVenueQuoteSnapshot[]
): string[] => {
  const venues = new Set<string>();
  for (const marketId of marketIds) {
    const venue = venueFromCanonicalMarketId(marketId);
    if (venue) {
      venues.add(venue);
    }
  }
  for (const snapshot of snapshots) {
    venues.add(normalizeDisplayVenue(snapshot.venue));
  }
  return [...venues].sort();
};

const venueFromCanonicalMarketId = (marketId: string): string | null => {
  const trimmed = marketId.trim();
  const directSuffix = trimmed.match(/:(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$/i)?.[1];
  if (directSuffix) {
    return normalizeDisplayVenue(directSuffix);
  }
  const parts = trimmed.split(":").filter(Boolean);
  const candidate = parts.find((part) => /^(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$/i.test(part));
  return candidate ? normalizeDisplayVenue(candidate) : null;
};

const normalizeDisplayVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};

const isDisplayUsableOrderbook = (orderbook: MarketOrderbookResponse): boolean =>
  orderbook.venues.length > 0 &&
  (orderbook.status === "live" || orderbook.status === "partial");

const isLiveTradableOrderbookVenue = (venue: MarketOrderbookVenue): boolean =>
  venue.snapshotStatus === "live" && (venue.bestBid !== null || venue.bestAsk !== null);

const isDeferredOrderbook = (orderbook: MarketOrderbookResponse): boolean =>
  orderbook.blockers.some((blocker) =>
    blocker.venue === "LOTUS" &&
    (blocker.reason === "MARKET_ORDERBOOK_REFRESH_DEFERRED" ||
      blocker.reason === "MARKET_ORDERBOOK_LEG_REFRESH_DEFERRED"));

const isDeferredBatchQuote = (quote: MarketBatchQuoteItem): boolean =>
  quote.status === "unavailable" &&
  quote.blockers.some((blocker) => blocker.venue === "LOTUS" && blocker.reason === "MARKET_BATCH_QUOTE_REFRESH_DEFERRED");

const isDisplayUsableBatchQuote = (quote: MarketBatchQuoteItem): boolean =>
  quote.status === "live" || quote.status === "partial";

const batchQuoteFromRefreshGrace = (
  quote: MarketBatchQuoteItem,
  generatedAt: Date
): MarketBatchQuoteItem => ({
  ...quote,
  generatedAt: generatedAt.toISOString()
});

const toUserFacingBatchQuote = (quote: MarketBatchQuoteItem): MarketBatchQuoteItem => {
  const hasDisplayPrice = quote.bestVenuePrice !== null ||
    quote.unifiedAveragePrice !== null ||
    quote.venues.some((venue) => venue.price !== null);
  if (!hasDisplayPrice) {
    return {
      ...quote,
      status: "unavailable",
      blockers: []
    };
  }
  return {
    ...quote,
    status: "live",
    venues: quote.venues.map((venue) => ({
      ...venue,
      blockers: []
    })),
    blockers: []
  };
};

const batchQuoteCacheEntryWithoutPromise = (entry: BatchQuoteCacheEntry): BatchQuoteCacheEntry => ({
  expiresAt: entry.expiresAt,
  staleUntil: entry.staleUntil,
  ...(entry.item ? { item: entry.item } : {})
});

const chartCacheKey = (input: {
  marketId: string;
  outcomeId?: string | undefined;
  timeframe: MarketChartTimeframe;
}): string => `${input.marketId}\u0000${input.outcomeId ?? ""}\u0000${input.timeframe}`;

const sanitizeVenueOrderbook = (snapshot: NormalizedVenueQuoteSnapshot, depth: number, now: Date): MarketOrderbookVenue => {
  const bids = cumulativeLevels(snapshot.venue, snapshot.venueMarketId, snapshot.venueOutcomeId ?? null, sortRawLevels(snapshot.bids, "desc").slice(0, depth));
  const asks = cumulativeLevels(snapshot.venue, snapshot.venueMarketId, snapshot.venueOutcomeId ?? null, sortRawLevels(snapshot.asks, "asc").slice(0, depth));
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    venue: snapshot.venue.toUpperCase(),
    venueMarketId: snapshot.venueMarketId,
    venueOutcomeId: snapshot.venueOutcomeId ?? null,
    source: snapshot.source,
    ...hotSnapshotSourceField(snapshot.metadata),
    freshnessMs: snapshotFreshnessMs(snapshot, now),
    snapshotStatus: snapshotStatus(snapshot, now),
    quoteQuality: snapshot.quoteQuality,
    sourceTimestamp: snapshot.sourceTimestamp?.toISOString() ?? null,
    receivedAt: snapshot.receivedAt.toISOString(),
    bestBid,
    bestAsk,
    midpoint: midpointFromBest(bestBid, bestAsk),
    spread: spreadFromBest(bestBid, bestAsk),
    bidDepth: sumSizes(bids),
    askDepth: sumSizes(asks),
    blockers: [...new Set([...(snapshot.blockers ?? []), ...(snapshot.missingFactors ?? [])])],
    bids,
    asks
  };
};

const snapshotFreshnessMs = (snapshot: NormalizedVenueQuoteSnapshot, now: Date): number => {
  const basis = snapshot.sourceTimestamp ?? snapshot.receivedAt;
  return Math.max(0, now.getTime() - basis.getTime());
};

const snapshotStatus = (
  snapshot: NormalizedVenueQuoteSnapshot,
  now: Date
): "live" | "stale" | "blocked" | "resyncing" => {
  if (snapshot.streamResynced === false) {
    return "resyncing";
  }
  if ((snapshot.blockers ?? []).length > 0) {
    return "blocked";
  }
  const thresholdMs = snapshot.source === "STREAM"
    ? STREAM_ORDERBOOK_LIVE_FRESHNESS_MS
    : REST_ORDERBOOK_LIVE_FRESHNESS_MS;
  return snapshotFreshnessMs(snapshot, now) <= thresholdMs ? "live" : "stale";
};

const resolveOrderbookStatus = (
  venues: readonly MarketOrderbookVenue[],
  blockers: readonly VenueQuoteSnapshotBlocker[],
  partialHint = false
): MarketOrderbookResponse["status"] => {
  const hasLive = venues.some((venue) => venue.snapshotStatus === "live");
  const hasStale = venues.some((venue) => venue.snapshotStatus === "stale");
  const hasBlocked = blockers.length > 0 || venues.some((venue) =>
    venue.snapshotStatus === "blocked" || venue.snapshotStatus === "resyncing" || venue.blockers.length > 0);
  if (hasLive) {
    return hasBlocked || partialHint || venues.some((venue) => venue.snapshotStatus !== "live") ? "partial" : "live";
  }
  if (hasStale) {
    return hasBlocked ? "partial" : "stale";
  }
  if (hasBlocked) {
    return "blocked";
  }
  return "unavailable";
};

const isLotusDeferredLegBlocker = (blocker: VenueQuoteSnapshotBlocker): boolean =>
  blocker.venue.toUpperCase() === "LOTUS" &&
  blocker.reason === "MARKET_ORDERBOOK_LEG_REFRESH_DEFERRED";

const hotSnapshotSourceField = (
  metadata: Readonly<Record<string, unknown>> | undefined
): { hotSnapshotSource?: "memory" | "redis" | "db_last_good" | undefined } => {
  const value = metadata?.hotSnapshotSource;
  return value === "memory" || value === "redis" || value === "db_last_good"
    ? { hotSnapshotSource: value }
    : {};
};

const buildBatchQuoteItem = (input: {
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  generatedAt: Date;
  report: VenueQuoteSnapshotReport;
  now: Date;
}): MarketBatchQuoteItem => {
  const venues = input.report.snapshots.map((snapshot) => {
    const bid = bestLevel(snapshot.bids, "bid");
    const ask = bestLevel(snapshot.asks, "ask");
    const price = input.side === "buy" ? ask : bid;
    const availableSize = input.side === "buy"
      ? sumLevelSizes(snapshot.asks)
      : sumLevelSizes(snapshot.bids);
    const liquidity = price && availableSize
      ? new Decimal(price).times(availableSize).toDecimalPlaces(8).toString()
      : "0";
    const freshnessMs = snapshot.sourceTimestamp
      ? Math.max(0, input.now.getTime() - snapshot.sourceTimestamp.getTime())
      : Math.max(0, input.now.getTime() - snapshot.receivedAt.getTime());
    return {
      venue: snapshot.venue.toUpperCase(),
      venueMarketId: snapshot.venueMarketId,
      venueOutcomeId: snapshot.venueOutcomeId ?? null,
      price,
      bid,
      ask,
      availableSize: availableSize?.toDecimalPlaces(8).toString() ?? "0",
      liquidity,
      spread: spreadFromBest(bid, ask),
      source: snapshot.source,
      ...hotSnapshotSourceField(snapshot.metadata),
      snapshotStatus: snapshotStatus(snapshot, input.now),
      quoteQuality: snapshot.quoteQuality,
      freshnessMs,
      blockers: [...new Set([...(snapshot.blockers ?? []), ...(snapshot.missingFactors ?? [])])]
    };
  });
  const liveVenues = venues.filter(isLiveTradableBatchQuoteVenue);
  const pricedVenues = liveVenues.filter((venue) => venue.price !== null);
  const best = pricedVenues.sort((left, right) => input.side === "buy"
    ? Number(left.price) - Number(right.price)
    : Number(right.price) - Number(left.price)
  )[0];
  const prices = pricedVenues.map((venue) => venue.price).filter((value): value is string => value !== null);
  const liquidity = liveVenues.reduce((sum, venue) => sum.plus(venue.liquidity), new Decimal(0)).toDecimalPlaces(8).toString();
  const freshnessValues = liveVenues.map((venue) => venue.freshnessMs).filter((value): value is number => value !== null);
  const staleVenueBlockers = venues
    .filter((venue) => venue.snapshotStatus === "stale")
    .map((venue) => ({
      venue: venue.venue,
      reason: "LIVE_QUOTE_REQUIRED",
      venueMarketId: venue.venueMarketId,
      venueOutcomeId: venue.venueOutcomeId ?? undefined
    }));
  const blockers = [...input.report.blocked, ...staleVenueBlockers];
  const hasVenueBlockers = liveVenues.some((venue) => venue.blockers.length > 0);
  const status = liveVenues.length > 0 && blockers.length === 0 && !hasVenueBlockers
    ? "live"
    : liveVenues.length > 0
        ? "partial"
        : "unavailable";
  return {
    marketId: input.marketId,
    outcomeId: input.outcomeId,
    side: input.side,
    generatedAt: input.generatedAt.toISOString(),
    status,
    bestVenue: best?.venue ?? null,
    bestVenuePrice: best?.price ?? null,
    unifiedAveragePrice: averageDecimalStrings(prices),
    liquidity,
    spread: averageDecimalStrings(venues.map((venue) => venue.spread)),
    freshnessMs: freshnessValues.length ? Math.max(...freshnessValues) : null,
    venues: liveVenues,
    blockers: [...blockers]
  };
};

const isLiveTradableBatchQuoteVenue = (venue: {
  snapshotStatus: "live" | "stale" | "blocked" | "resyncing";
  blockers: readonly unknown[];
}): boolean =>
  venue.snapshotStatus === "live" && venue.blockers.length === 0;

const batchQuoteCacheKey = (
  marketId: string,
  outcomeId: string,
  side: "buy" | "sell",
  quantity: number
): string => `${marketId}\u0000${outcomeId}\u0000${side}\u0000${quantity}`;

const livePriceCacheKey = (
  marketId: string,
  outcomeId: string | null
): string => `${marketId}\u0000${outcomeId ?? ""}`;

const bestLevel = (
  levels: readonly NormalizedQuoteLevel[],
  side: "bid" | "ask"
): string | null => {
  const values = levels
    .map((level) => decimal(level.price))
    .filter((value): value is InstanceType<typeof Decimal> => Boolean(value));
  if (values.length === 0) return null;
  return values
    .sort((left, right) => side === "bid" ? right.comparedTo(left) : left.comparedTo(right))[0]!
    .toDecimalPlaces(12)
    .toString();
};

const sumLevelSizes = (levels: readonly NormalizedQuoteLevel[]): InstanceType<typeof Decimal> | null => {
  if (levels.length === 0) return null;
  return levels.reduce((sum, level) => {
    const size = decimal(level.size);
    return size ? sum.plus(size) : sum;
  }, new Decimal(0));
};

const cumulativeLevels = (
  venue: string,
  venueMarketId: string,
  venueOutcomeId: string | null,
  levels: readonly NormalizedQuoteLevel[]
): MarketOrderbookLevel[] => {
  let cumulativeSize = new Decimal(0);
  let cumulativeNotional = new Decimal(0);
  return levels.flatMap((level) => {
    const price = decimal(level.price);
    const size = decimal(level.size);
    if (!price || !size || price.lt(0) || size.lte(0)) return [];
    cumulativeSize = cumulativeSize.plus(size);
    cumulativeNotional = cumulativeNotional.plus(price.times(size));
    return [{
      venue: venue.toUpperCase(),
      venueMarketId,
      venueOutcomeId,
      price: price.toDecimalPlaces(12).toString(),
      size: size.toDecimalPlaces(8).toString(),
      cumulativeSize: cumulativeSize.toDecimalPlaces(8).toString(),
      cumulativeNotional: cumulativeNotional.toDecimalPlaces(8).toString()
    }];
  });
};

const sortRawLevels = (levels: readonly NormalizedQuoteLevel[], direction: "asc" | "desc"): readonly NormalizedQuoteLevel[] =>
  [...levels].sort((left, right) => direction === "asc"
    ? Number(left.price) - Number(right.price)
    : Number(right.price) - Number(left.price));

const mergeChartPoints = (
  historicalPoints: readonly StoredChartPoint[],
  livePoints: readonly StoredChartPoint[]
): StoredChartPoint[] => {
  const byBucket = new Map<number, StoredChartPoint>();
  for (const point of [...historicalPoints, ...livePoints]) {
    const bucket = Math.round(point.timestamp.getTime() / 5_000) * 5_000;
    const existing = byBucket.get(bucket);
    byBucket.set(bucket, {
      marketId: point.marketId,
      outcomeId: point.outcomeId,
      timestamp: new Date(bucket),
      unified: point.unified ?? existing?.unified ?? null,
      venues: {
        ...(existing?.venues ?? {}),
        ...point.venues
      }
    });
  }
  return [...byBucket.values()].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
};

const normalizeHistoricalOutcomeValue = (value: string, outcomeLabel: string | undefined): string | null => {
  const parsed = decimal(value);
  if (!parsed || parsed.lt(0)) return null;
  const bounded = parsed.gt(1) && parsed.lte(100) ? parsed.div(100) : parsed;
  if (bounded.gt(1)) return null;
  const isNoOutcome = outcomeLabel !== undefined && /^(no|down|false)$/i.test(outcomeLabel.trim());
  const normalized = isNoOutcome ? new Decimal(1).minus(bounded) : bounded;
  return normalized.toDecimalPlaces(12).toString();
};

const averageDecimalStrings = (values: readonly (string | null)[]): string | null => {
  const decimals = values.flatMap((value) => {
    const parsed = typeof value === "string" ? decimal(value) : null;
    return parsed ? [parsed] : [];
  });
  if (decimals.length === 0) return null;
  const total = decimals.reduce((sum, value) => sum.plus(value), new Decimal(0));
  return total.div(decimals.length).toDecimalPlaces(12).toString();
};

const sortLevels = (levels: readonly MarketOrderbookLevel[], direction: "asc" | "desc"): MarketOrderbookLevel[] =>
  [...levels].sort((left, right) => direction === "asc"
    ? Number(left.price) - Number(right.price)
    : Number(right.price) - Number(left.price));

const midpointFromBest = (bestBid: string | null, bestAsk: string | null): string | null => {
  const bid = decimal(bestBid);
  const ask = decimal(bestAsk);
  return bid && ask ? bid.plus(ask).div(2).toDecimalPlaces(12).toString() : null;
};

const spreadFromBest = (bestBid: string | null, bestAsk: string | null): string | null => {
  const bid = decimal(bestBid);
  const ask = decimal(bestAsk);
  return bid && ask ? ask.minus(bid).toDecimalPlaces(12).toString() : null;
};

const sumSizes = (levels: readonly MarketOrderbookLevel[]): string =>
  levels.reduce((sum, level) => sum.plus(level.size), new Decimal(0)).toDecimalPlaces(8).toString();

const decimal = (value: string | number | null | undefined): InstanceType<typeof Decimal> | null => {
  if (value === null || value === undefined) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
};

const clampDepth = (value: number | undefined): number =>
  Math.max(1, Math.min(50, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 20));

const normalizeQuoteAmount = (value: string | number | undefined): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const timeframeCutoff = (timeframe: MarketChartTimeframe, now: Date): Date | null => {
  const hours = timeframe === "1H" ? 1
    : timeframe === "6H" ? 6
      : timeframe === "1D" ? 24
        : timeframe === "1W" ? 24 * 7
          : timeframe === "1M" ? 24 * 30
            : null;
  return hours === null ? null : new Date(now.getTime() - hours * 60 * 60 * 1000);
};

const formatChartLabel = (date: Date, timeframe: MarketChartTimeframe): string =>
  new Intl.DateTimeFormat("en-US", timeframe === "1H" || timeframe === "6H"
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "2-digit" }).format(date);

const venueLabel = (venue: string): string =>
  venue.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
