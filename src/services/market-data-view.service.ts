import Decimal from "decimal.js";
import type {
  NormalizedQuoteLevel,
  NormalizedVenueQuoteSnapshot,
  VenueQuoteSnapshotBlocker,
  VenueQuoteSnapshotReport
} from "../core/sor/quote-snapshot.js";

export type MarketChartTimeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

export interface MarketDataQuoteSource {
  getQuoteSnapshotReport(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    side: "buy" | "sell";
    quantity: number;
  }): Promise<VenueQuoteSnapshotReport>;
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
  status: "live" | "partial" | "unavailable";
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

interface StoredChartPoint {
  marketId: string;
  outcomeId: string | null;
  timestamp: Date;
  unified: string | null;
  venues: Record<string, string | null>;
}

const MAX_STORED_POINTS = 20_000;
const MAX_HISTORY_MS = 31 * 24 * 60 * 60 * 1000;
const VENUE_COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#22D3EE"];

export class LiveMarketDataViewService {
  private readonly chartPoints: StoredChartPoint[] = [];
  private readonly now: () => Date;

  public constructor(
    private readonly quoteSource: MarketDataQuoteSource,
    options: { now?: () => Date } = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async getOrderbook(input: {
    marketId: string;
    outcomeId?: string | undefined;
    depth?: number | undefined;
    venue?: string | undefined;
  }): Promise<MarketOrderbookResponse> {
    const generatedAt = this.now();
    const depth = clampDepth(input.depth);
    const report = await this.quoteSource.getQuoteSnapshotReport({
      canonicalMarketId: input.marketId,
      ...(input.outcomeId ? { canonicalOutcomeId: input.outcomeId } : {}),
      side: "buy",
      quantity: 1
    });
    const venueFilter = input.venue?.trim().toUpperCase();
    const snapshots = venueFilter
      ? report.snapshots.filter((snapshot) => snapshot.venue.toUpperCase() === venueFilter)
      : report.snapshots;
    const venues = snapshots.map((snapshot) => sanitizeVenueOrderbook(snapshot, depth));
    const bids = sortLevels(venues.flatMap((venue) => venue.bids), "desc").slice(0, depth);
    const asks = sortLevels(venues.flatMap((venue) => venue.asks), "asc").slice(0, depth);
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const midpoint = midpointFromBest(bestBid, bestAsk);
    const spread = spreadFromBest(bestBid, bestAsk);
    const blockers = venueFilter
      ? report.blocked.filter((blocker) => blocker.venue.toUpperCase() === venueFilter)
      : report.blocked;
    const status = venues.length > 0 && blockers.length === 0 ? "live" : venues.length > 0 ? "partial" : "unavailable";

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

  public async getChart(input: {
    marketId: string;
    outcomeId?: string | undefined;
    timeframe: MarketChartTimeframe;
  }): Promise<MarketChartResponse> {
    const orderbook = await this.getOrderbook({
      marketId: input.marketId,
      ...(input.outcomeId ? { outcomeId: input.outcomeId } : {}),
      depth: 5
    });
    const cutoff = timeframeCutoff(input.timeframe, this.now());
    const points = this.chartPoints
      .filter((point) =>
        point.marketId === input.marketId &&
        point.outcomeId === (input.outcomeId ?? null) &&
        (cutoff === null || point.timestamp >= cutoff)
      )
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    const venueIds = [...new Set(points.flatMap((point) => Object.keys(point.venues)))].sort();
    const series = [
      { id: "unified", label: "Unified", color: "#ccff00" },
      ...venueIds.map((venue, index) => ({
        id: venue,
        label: venueLabel(venue),
        color: VENUE_COLORS[index % VENUE_COLORS.length]!
      }))
    ];
    return {
      marketId: input.marketId,
      outcomeId: input.outcomeId ?? null,
      timeframe: input.timeframe,
      generatedAt: orderbook.generatedAt,
      historyStatus: points.length > 1 ? "live" : orderbook.status === "unavailable" ? "unavailable" : "accumulating",
      series,
      points: points.map((point) => ({
        timestamp: point.timestamp.toISOString(),
        label: formatChartLabel(point.timestamp, input.timeframe),
        unified: point.unified,
        venues: point.venues
      })),
      blockers: orderbook.blockers
    };
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
}

const sanitizeVenueOrderbook = (snapshot: NormalizedVenueQuoteSnapshot, depth: number): MarketOrderbookVenue => {
  const bids = cumulativeLevels(snapshot.venue, snapshot.venueMarketId, snapshot.venueOutcomeId ?? null, sortRawLevels(snapshot.bids, "desc").slice(0, depth));
  const asks = cumulativeLevels(snapshot.venue, snapshot.venueMarketId, snapshot.venueOutcomeId ?? null, sortRawLevels(snapshot.asks, "asc").slice(0, depth));
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    venue: snapshot.venue.toUpperCase(),
    venueMarketId: snapshot.venueMarketId,
    venueOutcomeId: snapshot.venueOutcomeId ?? null,
    source: snapshot.source,
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
