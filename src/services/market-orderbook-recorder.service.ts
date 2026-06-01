import Decimal from "decimal.js";
import type { MarketCatalogMarket, MarketCatalogRepository } from "../repositories/market-catalog.repository.js";
import type {
  VenueOrderbookSnapshotInput,
  VenueOrderbookSnapshotRepository
} from "../repositories/venue-orderbook-snapshot.repository.js";
import type { MarketDataQuoteSource } from "./market-data-view.service.js";
import type { NormalizedQuoteLevel, NormalizedVenueQuoteSnapshot } from "../core/sor/quote-snapshot.js";

export interface MarketOrderbookRecorderConfig {
  intervalMs: number;
  marketBatchSize: number;
  retentionHours: number;
  levelsPerSide: number;
  quoteProviderCooldownMs: number;
}

export interface MarketOrderbookRecorderLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
  error(input: Record<string, unknown>, message: string): void;
}

export interface MarketOrderbookRecorderRunResult {
  marketOffset: number;
  scannedMarkets: number;
  skippedClosedMarkets: number;
  sampledOutcomes: number;
  insertedSnapshots: number;
  failedSamples: number;
  skippedCooldownSamples: number;
  deletedOldSnapshots: number;
  deletedClosedMarketSnapshots: number;
  deletedClosedLatestSnapshots: number;
  deletedStaleBlockedLatestSnapshots: number;
}

const DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG = {
  intervalMs: 60_000,
  marketBatchSize: 50,
  retentionHours: 720,
  levelsPerSide: 25,
  quoteProviderCooldownMs: 30_000
} as const;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_AUTH_COOLDOWN_MS = 15 * 60_000;

export const buildMarketOrderbookRecorderConfig = (): MarketOrderbookRecorderConfig => ({
  ...DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG
});

export class MarketOrderbookRecorder {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private marketOffset = 0;
  private readonly venueCooldownUntil = new Map<string, number>();

  public constructor(
    private readonly marketCatalogRepository: Pick<MarketCatalogRepository, "listMarkets">,
    private readonly quoteSource: MarketDataQuoteSource,
    private readonly snapshotRepository: Pick<VenueOrderbookSnapshotRepository, "insertMany" | "cleanupSnapshots">,
    private readonly logger: MarketOrderbookRecorderLogger,
    private readonly config: MarketOrderbookRecorderConfig
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }
    this.logger.info({
      intervalMs: this.config.intervalMs,
      marketBatchSize: this.config.marketBatchSize,
      retentionHours: this.config.retentionHours,
      levelsPerSide: this.config.levelsPerSide
    }, "Market orderbook recorder started.");
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.intervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info({}, "Market orderbook recorder stopped.");
  }

  public async runOnce(): Promise<MarketOrderbookRecorderRunResult> {
    const empty = emptyResult();
    if (this.running) {
      this.logger.warn({}, "Market orderbook recorder tick skipped because the previous tick is still running.");
      return empty;
    }

    this.running = true;
    try {
      const cleanup = await this.snapshotRepository.cleanupSnapshots({
        olderThan: new Date(Date.now() - this.config.retentionHours * 60 * 60 * 1000)
      });
      const marketOffset = this.marketOffset;
      let markets = await this.marketCatalogRepository.listMarkets({
        limit: this.config.marketBatchSize,
        offset: marketOffset
      });
      if (markets.length === 0 && marketOffset > 0) {
        this.marketOffset = 0;
        markets = await this.marketCatalogRepository.listMarkets({ limit: this.config.marketBatchSize, offset: 0 });
      }
      this.marketOffset = markets.length < this.config.marketBatchSize
        ? 0
        : this.marketOffset + this.config.marketBatchSize;
      const result: MarketOrderbookRecorderRunResult = {
        marketOffset,
        scannedMarkets: markets.length,
        skippedClosedMarkets: 0,
        sampledOutcomes: 0,
        insertedSnapshots: 0,
        failedSamples: 0,
        skippedCooldownSamples: 0,
        ...cleanup
      };

      for (const market of markets) {
        if (market.status !== "OPEN") {
          result.skippedClosedMarkets += 1;
          continue;
        }

        for (const sample of buildMarketSamples(market)) {
          if (this.isSampleFullyCoolingDown(market, sample)) {
            result.skippedCooldownSamples += 1;
            continue;
          }
          result.sampledOutcomes += 1;
          try {
            const report = await this.quoteSource.getQuoteSnapshotReport({
              canonicalMarketId: sample.canonicalMarketId,
              ...(sample.outcomeId ? { canonicalOutcomeId: sample.outcomeId } : {}),
              side: "buy",
              quantity: 1
            });
            const snapshots = report.snapshots.flatMap((snapshot) =>
              toSnapshotInput({
                canonicalEventId: market.canonicalEventId,
                canonicalMarketId: sample.canonicalMarketId,
                canonicalOutcomeId: sample.outcomeId,
                snapshot,
                levelsPerSide: this.config.levelsPerSide
              })
            );
            const blockedSnapshots = report.blocked.map((blocker) =>
              toBlockedSnapshotInput({
                canonicalEventId: market.canonicalEventId,
                canonicalMarketId: sample.canonicalMarketId,
                canonicalOutcomeId: sample.outcomeId,
                blocker,
                receivedAt: new Date()
              })
            );
            for (const blocker of report.blocked) {
              this.applyProviderCooldown(blocker.venue, blocker.reason);
            }
            result.insertedSnapshots += await this.snapshotRepository.insertMany([
              ...snapshots,
              ...blockedSnapshots
            ]);
          } catch (error) {
            result.failedSamples += 1;
            this.logger.warn({
              canonicalEventId: market.canonicalEventId,
              canonicalMarketId: sample.canonicalMarketId,
              outcomeId: sample.outcomeId,
              errorName: error instanceof Error ? error.name : "UnknownError"
            }, "Market orderbook recorder failed to sample market outcome.");
          }
        }
      }

      if (
        result.insertedSnapshots > 0 ||
        result.failedSamples > 0 ||
        result.deletedClosedMarketSnapshots > 0 ||
        result.deletedClosedLatestSnapshots > 0 ||
        result.deletedStaleBlockedLatestSnapshots > 0 ||
        result.deletedOldSnapshots > 0
      ) {
        this.logger.info({ ...result }, "Market orderbook recorder tick completed.");
      }
      return result;
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError"
      }, "Market orderbook recorder tick failed.");
      return empty;
    } finally {
      this.running = false;
    }
  }

  private isSampleFullyCoolingDown(market: MarketCatalogMarket, sample: { canonicalMarketId: string }): boolean {
    const venues = [...new Set(market.venueMarkets
      .filter((venueMarket) => venueMarket.canonicalMarketId === sample.canonicalMarketId)
      .map((venueMarket) => normalizeVenue(venueMarket.venue)))];
    return venues.length > 0 && venues.every((venue) => (this.venueCooldownUntil.get(venue) ?? 0) > Date.now());
  }

  private applyProviderCooldown(venue: string, reason: string): void {
    const cooldownMs = providerCooldownMsForReason(reason, this.config.quoteProviderCooldownMs);
    if (cooldownMs <= 0) {
      return;
    }
    this.venueCooldownUntil.set(normalizeVenue(venue), Date.now() + cooldownMs);
  }
}

const buildMarketSamples = (market: MarketCatalogMarket): Array<{ canonicalMarketId: string; outcomeId: string | null }> => {
  const canonicalMarketIds = market.canonicalMarketIds.length > 0 ? market.canonicalMarketIds : [market.canonicalEventId];
  return canonicalMarketIds.flatMap((canonicalMarketId): Array<{ canonicalMarketId: string; outcomeId: string | null }> => {
    const venueMarkets = market.venueMarkets.filter((venueMarket) => venueMarket.canonicalMarketId === canonicalMarketId);
    const outcomeIds = [...new Map(
      venueMarkets
        .flatMap((venueMarket) => venueMarket.outcomes)
        .filter((outcome) => outcome.id.trim().length > 0)
        .map((outcome) => [outcome.label.trim().toLowerCase(), outcome.id.trim()] as const)
    ).values()];
    return outcomeIds.length > 0
      ? outcomeIds.map((outcomeId) => ({ canonicalMarketId, outcomeId }))
      : [{ canonicalMarketId, outcomeId: null }];
  });
};

const toSnapshotInput = (input: {
  canonicalEventId: string;
  canonicalMarketId: string;
  canonicalOutcomeId: string | null;
  snapshot: NormalizedVenueQuoteSnapshot;
  levelsPerSide: number;
}): VenueOrderbookSnapshotInput[] => {
  const bids = normalizeLevels(input.snapshot.bids, "desc").slice(0, input.levelsPerSide);
  const asks = normalizeLevels(input.snapshot.asks, "asc").slice(0, input.levelsPerSide);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const midpoint = midpointFromBest(bestBid, bestAsk);
  if (!bestBid && !bestAsk && !midpoint) {
    return [];
  }
  const blockerSnapshot = snapshotBlockersForRecorder(input.snapshot);
  return [{
    canonicalEventId: input.canonicalEventId,
    canonicalMarketId: input.canonicalMarketId,
    canonicalOutcomeId: input.canonicalOutcomeId,
    venue: normalizeVenue(input.snapshot.venue),
    venueMarketId: input.snapshot.venueMarketId,
    venueOutcomeId: input.snapshot.venueOutcomeId ?? null,
    source: input.snapshot.source,
    quoteQuality: input.snapshot.quoteQuality,
    sourceTimestamp: input.snapshot.sourceTimestamp,
    receivedAt: input.snapshot.receivedAt,
    bestBid,
    bestAsk,
    midpoint,
    spread: spreadFromBest(bestBid, bestAsk),
    bidDepth: sumSizes(bids),
    askDepth: sumSizes(asks),
    bids,
    asks,
    blockers: blockerSnapshot.blockers,
    ...(blockerSnapshot.metadataVersion ? { metadataVersion: blockerSnapshot.metadataVersion } : {})
  }];
};

const snapshotBlockersForRecorder = (snapshot: NormalizedVenueQuoteSnapshot): {
  blockers: readonly string[];
  metadataVersion?: string | undefined;
} => {
  const blockers = [...(snapshot.blockers ?? [])];
  const missingFactors = [...(snapshot.missingFactors ?? [])];
  const venue = normalizeVenue(snapshot.venue);

  if (venue !== "OPINION") {
    return { blockers: [...blockers, ...missingFactors] };
  }

  const blockingMissingFactors = missingFactors.filter((factor) => factor !== "FEE_DISCOVERY");
  return {
    blockers: [...blockers, ...blockingMissingFactors],
    ...(blockingMissingFactors.length !== missingFactors.length
      ? { metadataVersion: "venue-orderbook-recorder-opinion-fee-warning-v1" }
      : {})
  };
};

const toBlockedSnapshotInput = (input: {
  canonicalEventId: string;
  canonicalMarketId: string;
  canonicalOutcomeId: string | null;
  blocker: {
    venue: string;
    reason: string;
    venueMarketId?: string | undefined;
    venueOutcomeId?: string | undefined;
    detailsCode?: string | undefined;
  };
  receivedAt: Date;
}): VenueOrderbookSnapshotInput => ({
  canonicalEventId: input.canonicalEventId,
  canonicalMarketId: input.canonicalMarketId,
  canonicalOutcomeId: input.canonicalOutcomeId,
  venue: normalizeVenue(input.blocker.venue),
  venueMarketId: input.blocker.venueMarketId ?? `${normalizeVenue(input.blocker.venue)}:unknown`,
  venueOutcomeId: input.blocker.venueOutcomeId ?? null,
  source: "REST",
  quoteQuality: "DIAGNOSTIC_ONLY",
  sourceTimestamp: input.receivedAt,
  receivedAt: input.receivedAt,
  bestBid: null,
  bestAsk: null,
  midpoint: null,
  spread: null,
  bidDepth: "0",
  askDepth: "0",
  bids: [],
  asks: [],
  blockers: [
    normalizeBlockerReason(input.blocker.reason),
    ...(input.blocker.detailsCode ? [input.blocker.detailsCode] : [])
  ],
  metadataVersion: "venue-orderbook-recorder-blocker-v1"
});

const normalizeLevels = (
  levels: readonly NormalizedQuoteLevel[],
  direction: "asc" | "desc"
): Array<{ price: string; size: string }> =>
  levels
    .flatMap((level) => {
      const price = decimal(level.price);
      const size = decimal(level.size);
      return price && size && price.gt(0) && size.gt(0)
        ? [{ price: price.toDecimalPlaces(12).toString(), size: size.toDecimalPlaces(8).toString() }]
        : [];
    })
    .sort((left, right) => direction === "asc"
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

const sumSizes = (levels: readonly { size: string }[]): string =>
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

const emptyResult = (): MarketOrderbookRecorderRunResult => ({
  marketOffset: 0,
  scannedMarkets: 0,
  skippedClosedMarkets: 0,
  sampledOutcomes: 0,
  insertedSnapshots: 0,
  failedSamples: 0,
  skippedCooldownSamples: 0,
  deletedOldSnapshots: 0,
  deletedClosedMarketSnapshots: 0,
  deletedClosedLatestSnapshots: 0,
  deletedStaleBlockedLatestSnapshots: 0
});

const normalizeVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};

const providerCooldownMsForReason = (reason: string, baseCooldownMs: number): number => {
  if (reason.includes("QUOTE_PROVIDER_HTTP_429")) {
    return Math.max(baseCooldownMs, RATE_LIMIT_COOLDOWN_MS);
  }
  if (reason.includes("QUOTE_PROVIDER_HTTP_401") || reason.includes("PREDICT_PROVIDER_AUTH_INVALID")) {
    return Math.max(baseCooldownMs, PROVIDER_AUTH_COOLDOWN_MS);
  }
  if (reason.includes("QUOTE_PROVIDER_HTTP_503") || reason.includes("QUOTE_PROVIDER_HTTP_502")) {
    return Math.max(baseCooldownMs, baseCooldownMs * 2);
  }
  return 0;
};

const normalizeBlockerReason = (reason: string): string =>
  reason.trim();
