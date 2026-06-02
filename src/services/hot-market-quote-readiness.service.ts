import type {
  NormalizedVenueQuoteSnapshot,
  SharedCoreQuoteReadinessMarket,
  VenueQuoteMappingReadiness,
  VenueQuoteMappingResolver
} from "../core/sor/quote-snapshot.js";
import {
  DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS,
  type MarketQuoteReadinessSnapshot
} from "../repositories/venue-orderbook-snapshot.repository.js";

export interface HotMarketQuoteReadinessSnapshotStore {
  getDisplay(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
    maxAgeMs: number;
    includeDbFallback?: boolean | undefined;
  }): Promise<NormalizedVenueQuoteSnapshot | null>;
}

export interface MarketQuoteReadinessFallbackSource {
  listLatestMarketQuoteReadiness(input: {
    canonicalMarketIds: readonly string[];
    maxAgeMs?: number | undefined;
  }): Promise<MarketQuoteReadinessSnapshot[]>;
}

export interface HotMarketQuoteReadinessSourceConfig {
  maxAgeMs: number;
  batchReadinessLimit: number;
}

export class HotMarketQuoteReadinessSource {
  private readonly config: HotMarketQuoteReadinessSourceConfig;

  public constructor(private readonly deps: {
    mappingResolver: Pick<VenueQuoteMappingResolver, "getReadiness" | "listApprovedReadiness">;
    hotSnapshots: HotMarketQuoteReadinessSnapshotStore;
    fallbackSource?: MarketQuoteReadinessFallbackSource | undefined;
    config?: Partial<HotMarketQuoteReadinessSourceConfig> | undefined;
  }) {
    this.config = {
      maxAgeMs: DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS,
      batchReadinessLimit: 2_500,
      ...(deps.config ?? {})
    };
  }

  public async listLatestMarketQuoteReadiness(input: {
    canonicalMarketIds: readonly string[];
    maxAgeMs?: number | undefined;
  }): Promise<MarketQuoteReadinessSnapshot[]> {
    const canonicalMarketIds = [...new Set(input.canonicalMarketIds.map((id) => id.trim()).filter(Boolean))];
    if (canonicalMarketIds.length === 0) {
      return [];
    }
    const maxAgeMs = input.maxAgeMs ?? this.config.maxAgeMs;
    const readinessByMarket = await this.loadReadinessByMarket(canonicalMarketIds);
    const hotResults = await Promise.all(canonicalMarketIds.map(async (canonicalMarketId) => {
      const readiness = readinessByMarket.get(canonicalMarketId) ?? [];
      return this.buildHotReadinessSnapshot(canonicalMarketId, readiness, maxAgeMs);
    }));
    const fallbackNeeded = hotResults
      .filter((snapshot) => snapshot.quoteReadyVenueCount <= 0)
      .map((snapshot) => snapshot.canonicalMarketId);
    if (fallbackNeeded.length === 0 || !this.deps.fallbackSource) {
      return hotResults;
    }
    const fallback = await this.deps.fallbackSource.listLatestMarketQuoteReadiness({
      canonicalMarketIds: fallbackNeeded,
      maxAgeMs
    });
    const fallbackByMarket = new Map(fallback.map((snapshot) => [snapshot.canonicalMarketId, snapshot] as const));
    return hotResults.map((snapshot) => {
      if (snapshot.quoteReadyVenueCount > 0) {
        return snapshot;
      }
      const fallbackSnapshot = fallbackByMarket.get(snapshot.canonicalMarketId);
      return fallbackSnapshot && fallbackSnapshot.quoteReadyVenueCount > 0
        ? fallbackSnapshot
        : snapshot;
    });
  }

  private async loadReadinessByMarket(
    canonicalMarketIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly VenueQuoteMappingReadiness[]>> {
    const byMarket = new Map<string, readonly VenueQuoteMappingReadiness[]>();
    if (this.deps.mappingResolver.listApprovedReadiness) {
      const rows = await this.deps.mappingResolver.listApprovedReadiness({
        limit: Math.max(this.config.batchReadinessLimit, canonicalMarketIds.length)
      });
      for (const [marketId, readiness] of readinessByCanonicalMarket(rows)) {
        if (canonicalMarketIds.includes(marketId)) {
          byMarket.set(marketId, readiness);
        }
      }
    }
    if (!this.deps.mappingResolver.getReadiness) {
      return byMarket;
    }
    const missing = canonicalMarketIds.filter((marketId) => !byMarket.has(marketId));
    if (missing.length === 0) {
      return byMarket;
    }
    const loaded = await Promise.all(missing.map(async (canonicalMarketId) => [
      canonicalMarketId,
      await this.deps.mappingResolver.getReadiness!({ canonicalMarketId })
    ] as const));
    for (const [canonicalMarketId, readiness] of loaded) {
      byMarket.set(canonicalMarketId, readiness);
    }
    return byMarket;
  }

  private async buildHotReadinessSnapshot(
    canonicalMarketId: string,
    readiness: readonly VenueQuoteMappingReadiness[],
    maxAgeMs: number
  ): Promise<MarketQuoteReadinessSnapshot> {
    const blockers = readiness.flatMap(mappingBlockers);
    const readyMappings = readiness.filter((row) => row.quoteReady && row.venueMarketId !== null);
    const snapshots = await Promise.all(readyMappings.map(async (row) => {
      const snapshot = await this.deps.hotSnapshots.getDisplay({
        venue: row.venue,
        venueMarketId: row.venueMarketId!,
        ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {}),
        maxAgeMs,
        includeDbFallback: false
      });
      return { row, snapshot };
    }));
    const liveSnapshots = snapshots.filter((entry): entry is {
      row: VenueQuoteMappingReadiness & { venueMarketId: string };
      snapshot: NormalizedVenueQuoteSnapshot;
    } => Boolean(entry.snapshot && isPricedLiveSnapshot(entry.snapshot)));
    const missingHot = snapshots
      .filter((entry) => !entry.snapshot || !isPricedLiveSnapshot(entry.snapshot))
      .map((entry) => ({
        venue: normalizeVenue(entry.row.venue),
        reason: entry.snapshot?.blockers?.join(",") || "LIVE_QUOTE_SNAPSHOT_MISSING",
        ...(entry.row.venueMarketId ? { venueMarketId: entry.row.venueMarketId } : {}),
        ...(entry.row.venueOutcomeId ? { venueOutcomeId: entry.row.venueOutcomeId } : {})
      }));
    const quoteReadyVenues = [...new Set(liveSnapshots.map((entry) => normalizeVenue(entry.row.venue)))].sort();
    const lastQuoteAt = liveSnapshots
      .map((entry) => entry.snapshot.receivedAt.toISOString())
      .sort()
      .at(-1) ?? null;
    return {
      canonicalMarketId,
      quoteStatus: quoteReadyVenues.length > 0 && blockers.length === 0 && missingHot.length === 0 ? "live"
        : quoteReadyVenues.length > 0 ? "partial"
        : "unavailable",
      quoteReadyVenueCount: quoteReadyVenues.length,
      quoteReadyVenues,
      quoteBlockers: [...blockers, ...missingHot],
      lastQuoteAt
    };
  }
}

const readinessByCanonicalMarket = (
  rows: readonly SharedCoreQuoteReadinessMarket[]
): ReadonlyMap<string, readonly VenueQuoteMappingReadiness[]> => {
  const byMarket = new Map<string, VenueQuoteMappingReadiness[]>();
  for (const row of rows) {
    const marketIds = row.canonicalMarketIds.length > 0 ? row.canonicalMarketIds : [row.canonicalEventId];
    for (const marketId of marketIds) {
      byMarket.set(marketId, [...(byMarket.get(marketId) ?? []), ...row.venues]);
    }
  }
  return byMarket;
};

const mappingBlockers = (row: VenueQuoteMappingReadiness): MarketQuoteReadinessSnapshot["quoteBlockers"] =>
  row.quoteReady && row.venueMarketId !== null
    ? []
    : [{
        venue: normalizeVenue(row.venue),
        reason: row.blockers.join(",") || "QUOTE_MAPPING_NOT_READY",
        ...(row.venueMarketId ? { venueMarketId: row.venueMarketId } : {}),
        ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
      }];

const isPricedLiveSnapshot = (snapshot: NormalizedVenueQuoteSnapshot): boolean =>
  (snapshot.blockers?.length ?? 0) === 0
  && (snapshot.bids.length > 0 || snapshot.asks.length > 0);

const normalizeVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};
