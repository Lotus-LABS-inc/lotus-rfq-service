import Decimal from "decimal.js";
import type { MarketCatalogMarket, MarketCatalogRepository } from "../repositories/market-catalog.repository.js";
import type {
  VenueOrderbookSnapshotInput,
  VenueOrderbookSnapshotRepository
} from "../repositories/venue-orderbook-snapshot.repository.js";
import type { MarketDataQuoteSource } from "./market-data-view.service.js";
import type { NormalizedQuoteLevel, NormalizedVenueQuoteSnapshot } from "../core/sor/quote-snapshot.js";

export interface MarketOrderbookRecorderConfig {
  enabled: boolean;
  intervalMs: number;
  marketBatchSize: number;
  retentionHours: number;
  levelsPerSide: number;
}

export interface MarketOrderbookRecorderLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
  error(input: Record<string, unknown>, message: string): void;
}

export interface MarketOrderbookRecorderRunResult {
  scannedMarkets: number;
  skippedClosedMarkets: number;
  sampledOutcomes: number;
  insertedSnapshots: number;
  failedSamples: number;
  deletedOldSnapshots: number;
  deletedClosedMarketSnapshots: number;
}

export const buildMarketOrderbookRecorderConfigFromEnv = (
  env: NodeJS.ProcessEnv
): MarketOrderbookRecorderConfig => ({
  enabled: env.MARKET_ORDERBOOK_RECORDER_ENABLED === "true",
  intervalMs: parseBoundedInteger(env.MARKET_ORDERBOOK_RECORDER_INTERVAL_MS, 60_000, 10_000, 3_600_000),
  marketBatchSize: parseBoundedInteger(env.MARKET_ORDERBOOK_RECORDER_MARKET_BATCH_SIZE, 100, 1, 1_000),
  retentionHours: parseBoundedInteger(env.MARKET_ORDERBOOK_RECORDER_RETENTION_HOURS, 720, 1, 8_760),
  levelsPerSide: parseBoundedInteger(env.MARKET_ORDERBOOK_RECORDER_LEVELS_PER_SIDE, 25, 1, 50)
});

export class MarketOrderbookRecorder {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly marketCatalogRepository: Pick<MarketCatalogRepository, "listMarkets">,
    private readonly quoteSource: MarketDataQuoteSource,
    private readonly snapshotRepository: Pick<VenueOrderbookSnapshotRepository, "insertMany" | "cleanupSnapshots">,
    private readonly logger: MarketOrderbookRecorderLogger,
    private readonly config: MarketOrderbookRecorderConfig
  ) {}

  public start(): void {
    if (!this.config.enabled || this.timer) {
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
    if (!this.config.enabled) {
      return empty;
    }
    if (this.running) {
      this.logger.warn({}, "Market orderbook recorder tick skipped because the previous tick is still running.");
      return empty;
    }

    this.running = true;
    try {
      const cleanup = await this.snapshotRepository.cleanupSnapshots({
        olderThan: new Date(Date.now() - this.config.retentionHours * 60 * 60 * 1000)
      });
      const markets = await this.marketCatalogRepository.listMarkets({ limit: this.config.marketBatchSize });
      const result: MarketOrderbookRecorderRunResult = {
        scannedMarkets: markets.length,
        skippedClosedMarkets: 0,
        sampledOutcomes: 0,
        insertedSnapshots: 0,
        failedSamples: 0,
        ...cleanup
      };

      for (const market of markets) {
        if (market.status !== "OPEN") {
          result.skippedClosedMarkets += 1;
          continue;
        }

        for (const sample of buildMarketSamples(market)) {
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
            result.insertedSnapshots += await this.snapshotRepository.insertMany(snapshots);
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

      if (result.insertedSnapshots > 0 || result.failedSamples > 0 || result.deletedClosedMarketSnapshots > 0 || result.deletedOldSnapshots > 0) {
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
  return [{
    canonicalEventId: input.canonicalEventId,
    canonicalMarketId: input.canonicalMarketId,
    canonicalOutcomeId: input.canonicalOutcomeId,
    venue: input.snapshot.venue.toUpperCase(),
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
    blockers: [...(input.snapshot.blockers ?? []), ...(input.snapshot.missingFactors ?? [])]
  }];
};

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
  scannedMarkets: 0,
  skippedClosedMarkets: 0,
  sampledOutcomes: 0,
  insertedSnapshots: 0,
  failedSamples: 0,
  deletedOldSnapshots: 0,
  deletedClosedMarketSnapshots: 0
});

const parseBoundedInteger = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};
