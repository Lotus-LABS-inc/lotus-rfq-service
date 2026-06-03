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
  activeMarketBatchSize?: number;
  priorityMarketBatchSize?: number;
  priorityVenues?: readonly string[];
  maxSamplesPerTick: number;
  sampleConcurrency?: number;
  maxTickDurationMs?: number;
  sampleTimeoutMs?: number;
  cleanupIntervalMs?: number;
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
  activeMarkets: number;
  scannedMarkets: number;
  skippedClosedMarkets: number;
  sampledOutcomes: number;
  insertedSnapshots: number;
  failedSamples: number;
  skippedCooldownSamples: number;
  sampledByVenue?: Record<string, number> | undefined;
  persistedByVenue?: Record<string, number> | undefined;
  failedByVenue?: Record<string, number> | undefined;
  deletedOldSnapshots: number;
  deletedClosedMarketSnapshots: number;
  deletedClosedLatestSnapshots: number;
  deletedStaleBlockedLatestSnapshots: number;
}

const DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG = {
  intervalMs: 5_000,
  marketBatchSize: 10,
  activeMarketBatchSize: 160,
  priorityMarketBatchSize: 48,
  priorityVenues: ["OPINION", "LIMITLESS", "PREDICT_FUN", "POLYMARKET"] as readonly string[],
  maxSamplesPerTick: 48,
  sampleConcurrency: 12,
  maxTickDurationMs: 6_000,
  sampleTimeoutMs: 2_500,
  cleanupIntervalMs: 30 * 60_000,
  retentionHours: 720,
  levelsPerSide: 25,
  quoteProviderCooldownMs: 15_000
} as const;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_AUTH_COOLDOWN_MS = 15 * 60_000;
const SAMPLE_TIMEOUT_COOLDOWN_MS = 10_000;

export const buildMarketOrderbookRecorderConfig = (): MarketOrderbookRecorderConfig => {
  // Worker-owned duty: do not add per-duty env flags such as
  // MARKET_ORDERBOOK_RECORDER_ENABLED. If the worker service is running, the
  // recorder is expected to run with code-owned production defaults.
  return {
    ...DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG
  };
};

export class MarketOrderbookRecorder {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private marketOffset = 0;
  private priorityMarketOffset = 0;
  private lastCleanupAt = Date.now();
  private readonly venueCooldownUntil = new Map<string, number>();
  private readonly sampleCooldownUntil = new Map<string, number>();

  public constructor(
    private readonly marketCatalogRepository: Pick<MarketCatalogRepository, "listMarkets">,
    private readonly quoteSource: MarketDataQuoteSource,
    private readonly snapshotRepository: Pick<VenueOrderbookSnapshotRepository, "insertMany" | "cleanupSnapshots">,
    private readonly logger: MarketOrderbookRecorderLogger,
    private readonly config: MarketOrderbookRecorderConfig,
    private readonly activeMarketSource?: {
      listActiveMarketsFromRedis(input?: { limit?: number | undefined }): Promise<Array<{
        canonicalMarketId: string;
        canonicalOutcomeId?: string | undefined;
        lastSeenAt: Date;
      }>>;
    } | undefined
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }
    this.stopped = false;
    this.logger.info({
      intervalMs: this.config.intervalMs,
      marketBatchSize: this.config.marketBatchSize,
      activeMarketBatchSize: this.config.activeMarketBatchSize ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.activeMarketBatchSize,
      priorityMarketBatchSize: this.config.priorityMarketBatchSize ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.priorityMarketBatchSize,
      priorityVenues: this.config.priorityVenues ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.priorityVenues,
      maxSamplesPerTick: this.config.maxSamplesPerTick,
      sampleConcurrency: this.config.sampleConcurrency ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.sampleConcurrency,
      maxTickDurationMs: this.config.maxTickDurationMs ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.maxTickDurationMs,
      sampleTimeoutMs: this.config.sampleTimeoutMs ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.sampleTimeoutMs,
      cleanupIntervalMs: this.config.cleanupIntervalMs ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.cleanupIntervalMs,
      retentionHours: this.config.retentionHours,
      levelsPerSide: this.config.levelsPerSide
    }, "Market orderbook recorder started.");
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.intervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (!this.timer) {
      await this.waitForIdle();
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info({}, "Market orderbook recorder stopped.");
    await this.waitForIdle();
  }

  public async runOnce(): Promise<MarketOrderbookRecorderRunResult> {
    const empty = emptyResult();
    if (this.stopped) {
      return empty;
    }
    if (this.running) {
      this.logger.warn({}, "Market orderbook recorder tick skipped because the previous tick is still running.");
      return empty;
    }

    this.running = true;
    try {
      const tickStartedAt = Date.now();
      const maxTickDurationMs = this.config.maxTickDurationMs ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.maxTickDurationMs;
      const sampleTimeoutMs = this.config.sampleTimeoutMs ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.sampleTimeoutMs;
      const sampleConcurrency = Math.max(
        1,
        Math.floor(this.config.sampleConcurrency ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.sampleConcurrency)
      );
      const cleanup = await this.cleanupSnapshotsIfDue(tickStartedAt);
      const activeMarkets = await this.listActiveMarkets();
      const priorityMarkets = await this.listPriorityMarkets();
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
      if (activeMarkets.length > 0 || priorityMarkets.length > 0) {
        markets = uniqueMarketsByEventAndMarketIds([...activeMarkets, ...priorityMarkets, ...markets]);
      }
      const result: MarketOrderbookRecorderRunResult = {
        marketOffset,
        activeMarkets: activeMarkets.length,
        scannedMarkets: markets.length,
        skippedClosedMarkets: 0,
        sampledOutcomes: 0,
        insertedSnapshots: 0,
        failedSamples: 0,
        skippedCooldownSamples: 0,
        ...cleanup
      };
      const candidateSamples: Array<{
        market: MarketCatalogMarket;
        sample: MarketOrderbookRecorderSample;
      }> = [];

      marketLoop:
      for (const market of markets) {
        if (this.stopped) {
          break;
        }
        if (market.status !== "OPEN") {
          result.skippedClosedMarkets += 1;
          continue;
        }

        for (const sample of buildMarketSamples(market)) {
          if (this.stopped) {
            break marketLoop;
          }
          if (Date.now() - tickStartedAt >= maxTickDurationMs) {
            this.logger.warn({
              maxTickDurationMs,
              candidateOutcomes: candidateSamples.length,
              scannedMarkets: result.scannedMarkets
            }, "Market orderbook recorder tick stopped early because its time budget was exhausted.");
            break marketLoop;
          }
          if (this.isSampleFullyCoolingDown(market, sample)) {
            result.skippedCooldownSamples += 1;
            continue;
          }
          if (this.isSampleCoolingDown(sample)) {
            result.skippedCooldownSamples += 1;
            continue;
          }
          candidateSamples.push({ market, sample });
        }
      }
      const scheduledSamples = selectSamplesForTick(
        candidateSamples,
        this.config.maxSamplesPerTick,
        this.config.priorityVenues ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.priorityVenues
      );
      result.sampledOutcomes = scheduledSamples.length;
      result.sampledByVenue = countScheduledSampleVenues(scheduledSamples);
      const persistedByVenue = new Map<string, number>();
      const failedByVenue = new Map<string, number>();
      if (scheduledSamples.length > 0 && this.quoteSource.preloadMappingReadiness) {
        try {
          await this.quoteSource.preloadMappingReadiness(scheduledSamples.map(({ sample }) => ({
            canonicalMarketId: sample.canonicalMarketId,
            canonicalOutcomeId: sample.outcomeId
          })));
        } catch (error) {
          this.logger.warn({
            errorName: error instanceof Error ? error.name : "UnknownError",
            sampledOutcomes: scheduledSamples.length
          }, "Market orderbook recorder mapping preload failed; falling back to per-sample mapping lookup.");
        }
      }

      let nextSampleIndex = 0;
      let timeBudgetLogged = false;
      const workers = Array.from({ length: Math.min(sampleConcurrency, scheduledSamples.length) }, async () => {
        while (!this.stopped) {
          if (Date.now() - tickStartedAt >= maxTickDurationMs) {
            if (!timeBudgetLogged) {
              timeBudgetLogged = true;
              this.logger.warn({
                maxTickDurationMs,
                sampledOutcomes: result.sampledOutcomes,
                scannedMarkets: result.scannedMarkets
              }, "Market orderbook recorder tick stopped early because its time budget was exhausted.");
            }
            return;
          }
          const sampleIndex = nextSampleIndex;
          nextSampleIndex += 1;
          const work = scheduledSamples[sampleIndex];
          if (!work) {
            return;
          }
          const sampleResult = await this.processSample(work.market, work.sample, sampleTimeoutMs);
          result.insertedSnapshots += sampleResult.insertedSnapshots;
          result.failedSamples += sampleResult.failedSamples;
          addVenueCounts(persistedByVenue, sampleResult.persistedByVenue);
          addVenueCounts(failedByVenue, sampleResult.failedByVenue);
        }
      });
      await Promise.all(workers);
      result.persistedByVenue = mapToRecord(persistedByVenue);
      result.failedByVenue = mapToRecord(failedByVenue);

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

  private isSampleCoolingDown(sample: { canonicalMarketId: string; outcomeId?: string | null | undefined }): boolean {
    return (this.sampleCooldownUntil.get(sampleCooldownKey(sample)) ?? 0) > Date.now();
  }

  private applySampleCooldown(sample: { canonicalMarketId: string; outcomeId?: string | null | undefined }): void {
    this.sampleCooldownUntil.set(sampleCooldownKey(sample), Date.now() + SAMPLE_TIMEOUT_COOLDOWN_MS);
  }

  private async processSample(
    market: MarketCatalogMarket,
    sample: MarketOrderbookRecorderSample,
    sampleTimeoutMs: number
  ): Promise<{
    insertedSnapshots: number;
    failedSamples: number;
    persistedByVenue: Record<string, number>;
    failedByVenue: Record<string, number>;
  }> {
    try {
      const report = await withRecorderTimeout(
        this.quoteSource.getQuoteSnapshotReport({
          canonicalMarketId: sample.canonicalMarketId,
          ...(sample.outcomeId ? { canonicalOutcomeId: sample.outcomeId } : {}),
          side: "buy",
          quantity: 1
        }),
        sampleTimeoutMs
      );
      if (this.stopped) {
        return { insertedSnapshots: 0, failedSamples: 0, persistedByVenue: {}, failedByVenue: {} };
      }
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
      ).filter((snapshot): snapshot is VenueOrderbookSnapshotInput => snapshot !== null);
      const hasSnapshots = report.snapshots.length > 0;
      for (const blocker of report.blocked) {
        this.applyProviderCooldown(blocker.venue, blocker.reason);
        if (!hasSnapshots && isTransientQuoteReadBlocker(blocker.reason, blocker.detailsCode)) {
          this.applySampleCooldown(sample);
        }
      }
      const insertedSnapshots = await this.snapshotRepository.insertMany([
        ...snapshots,
        ...blockedSnapshots
      ]);
      return {
        insertedSnapshots,
        failedSamples: 0,
        persistedByVenue: countSnapshotInputVenues([...snapshots, ...blockedSnapshots]),
        failedByVenue: {}
      };
    } catch (error) {
      if (error instanceof RecorderSampleTimeoutError) {
        this.applySampleCooldown(sample);
      }
      this.logger.warn({
        canonicalEventId: market.canonicalEventId,
        canonicalMarketId: sample.canonicalMarketId,
        outcomeId: sample.outcomeId,
        errorName: error instanceof Error ? error.name : "UnknownError"
      }, "Market orderbook recorder failed to sample market outcome.");
      return {
        insertedSnapshots: 0,
        failedSamples: 1,
        persistedByVenue: {},
        failedByVenue: Object.fromEntries(sample.venueKeys.map((venue) => [venue, 1]))
      };
    }
  }

  private async listPriorityMarkets(): Promise<MarketCatalogMarket[]> {
    const priorityMarketBatchSize = this.config.priorityMarketBatchSize ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.priorityMarketBatchSize;
    const priorityVenues = this.config.priorityVenues ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.priorityVenues;
    if (priorityMarketBatchSize <= 0 || priorityVenues.length === 0) {
      return [];
    }

    const catalogWindow = await this.marketCatalogRepository.listMarkets({
      limit: Math.max(250, priorityMarketBatchSize),
      offset: 0
    });
    const priorityMarkets = catalogWindow.filter((market) =>
      market.status === "OPEN" && marketIncludesAnyVenue(market, priorityVenues)
    );
    if (priorityMarkets.length === 0) {
      this.priorityMarketOffset = 0;
      return [];
    }

    if (this.priorityMarketOffset >= priorityMarkets.length) {
      this.priorityMarketOffset = 0;
    }
    const selected = wrapSlice(priorityMarkets, this.priorityMarketOffset, priorityMarketBatchSize);
    this.priorityMarketOffset = (this.priorityMarketOffset + priorityMarketBatchSize) % priorityMarkets.length;
    return selected;
  }

  private async listActiveMarkets(): Promise<MarketCatalogMarket[]> {
    if (!this.activeMarketSource) {
      return [];
    }
    const activeMarketBatchSize = this.config.activeMarketBatchSize ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.activeMarketBatchSize;
    if (activeMarketBatchSize <= 0) {
      return [];
    }
    const activeTargets = await this.activeMarketSource.listActiveMarketsFromRedis({
      limit: activeMarketBatchSize
    });
    if (activeTargets.length === 0) {
      return [];
    }
    const activeIds = new Set(activeTargets.map((target) => target.canonicalMarketId));
    const catalogWindow = await this.marketCatalogRepository.listMarkets({
      limit: Math.max(250, activeMarketBatchSize),
      offset: 0
    });
    return catalogWindow.filter((market) =>
      market.canonicalMarketIds.some((canonicalMarketId) => activeIds.has(canonicalMarketId)) ||
      activeIds.has(market.canonicalEventId)
    );
  }

  private async cleanupSnapshotsIfDue(nowMs: number): Promise<Pick<
    MarketOrderbookRecorderRunResult,
    | "deletedOldSnapshots"
    | "deletedClosedMarketSnapshots"
    | "deletedClosedLatestSnapshots"
    | "deletedStaleBlockedLatestSnapshots"
  >> {
    const cleanupIntervalMs = this.config.cleanupIntervalMs ?? DEFAULT_MARKET_ORDERBOOK_RECORDER_CONFIG.cleanupIntervalMs;
    if (cleanupIntervalMs > 0 && nowMs - this.lastCleanupAt < cleanupIntervalMs) {
      return emptyCleanupResult();
    }
    this.lastCleanupAt = nowMs;
    return this.snapshotRepository.cleanupSnapshots({
      olderThan: new Date(nowMs - this.config.retentionHours * 60 * 60 * 1000)
    });
  }

  private async waitForIdle(): Promise<void> {
    for (let attempt = 0; attempt < 100 && this.running; attempt += 1) {
      await sleep(50);
    }
  }
}

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

class RecorderSampleTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`Market orderbook recorder sample timed out after ${timeoutMs}ms.`);
    this.name = "RecorderSampleTimeoutError";
  }
}

const withRecorderTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new RecorderSampleTimeoutError(timeoutMs)), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

type MarketOrderbookRecorderSample = { canonicalMarketId: string; outcomeId: string; venueKeys: readonly string[] };

const buildMarketSamples = (market: MarketCatalogMarket): MarketOrderbookRecorderSample[] => {
  const canonicalMarketIds = market.canonicalMarketIds.length > 0 ? market.canonicalMarketIds : [market.canonicalEventId];
  return canonicalMarketIds.flatMap((canonicalMarketId): MarketOrderbookRecorderSample[] => {
    const venueMarkets = market.venueMarkets.filter((venueMarket) => venueMarket.canonicalMarketId === canonicalMarketId);
    const venueKeys = [...new Set(venueMarkets.map((venueMarket) => normalizeVenue(venueMarket.venue)))];
    const outcomeIds = [...new Map(
      venueMarkets
        .flatMap((venueMarket) => venueMarket.outcomes)
        .filter((outcome) => outcome.id.trim().length > 0)
        .map((outcome) => [outcome.label.trim().toLowerCase(), outcome.id.trim()] as const)
    ).values()];
    return outcomeIds.map((outcomeId) => ({ canonicalMarketId, outcomeId, venueKeys }));
  });
};

const selectSamplesForTick = <T extends {
  market: MarketCatalogMarket;
  sample: MarketOrderbookRecorderSample;
}>(
  candidates: readonly T[],
  maxSamples: number,
  priorityVenues: readonly string[]
): T[] => {
  const limit = Math.max(0, Math.floor(maxSamples));
  if (limit <= 0 || candidates.length === 0) {
    return [];
  }
  const normalizedPriorityVenues = [...new Set(priorityVenues.map(normalizeVenue))];
  if (normalizedPriorityVenues.length === 0) {
    return candidates.slice(0, limit);
  }

  const bucketQueues = new Map<string, EventRoundRobinQueue<T>>(
    [...normalizedPriorityVenues, "__OTHER__"].map((venue) => [venue, createEventRoundRobinQueue<T>()])
  );
  for (const candidate of candidates) {
    const venueSet = new Set(candidate.sample.venueKeys.map(normalizeVenue));
    const bucketKey = normalizedPriorityVenues.find((venue) => venueSet.has(venue)) ?? "__OTHER__";
    bucketQueues.get(bucketKey)!.push(candidate);
  }

  const selected: T[] = [];
  const selectedKeys = new Set<string>();
  while (selected.length < limit) {
    let addedThisRound = false;
    for (const venue of [...normalizedPriorityVenues, "__OTHER__"]) {
      const bucket = bucketQueues.get(venue);
      if (!bucket || bucket.isEmpty()) {
        continue;
      }
      while (!bucket.isEmpty()) {
        const candidate = bucket.shift();
        if (!candidate) {
          break;
        }
        const key = sampleCooldownKey(candidate.sample);
        if (selectedKeys.has(key)) {
          continue;
        }
        selected.push(candidate);
        selectedKeys.add(key);
        addedThisRound = true;
        break;
      }
      if (selected.length >= limit) {
        break;
      }
    }
    if (!addedThisRound) {
      break;
    }
  }
  return selected;
};

type EventRoundRobinQueue<T extends { market: MarketCatalogMarket }> = {
  push(candidate: T): void;
  shift(): T | null;
  isEmpty(): boolean;
};

const createEventRoundRobinQueue = <T extends { market: MarketCatalogMarket }>(): EventRoundRobinQueue<T> => {
  const byEvent = new Map<string, T[]>();
  const eventOrder: string[] = [];
  return {
    push(candidate) {
      const eventKey = marketEventQueueKey(candidate.market);
      let bucket = byEvent.get(eventKey);
      if (!bucket) {
        bucket = [];
        byEvent.set(eventKey, bucket);
        eventOrder.push(eventKey);
      }
      bucket.push(candidate);
    },
    shift() {
      while (eventOrder.length > 0) {
        const eventKey = eventOrder.shift()!;
        const bucket = byEvent.get(eventKey);
        if (!bucket || bucket.length === 0) {
          byEvent.delete(eventKey);
          continue;
        }
        const candidate = bucket.shift()!;
        if (bucket.length > 0) {
          eventOrder.push(eventKey);
        } else {
          byEvent.delete(eventKey);
        }
        return candidate;
      }
      return null;
    },
    isEmpty() {
      return eventOrder.length === 0;
    }
  };
};

const marketEventQueueKey = (market: MarketCatalogMarket): string =>
  market.canonicalEventId || market.eventId || market.canonicalMarketIds.join("|") || market.title;

const countScheduledSampleVenues = (
  scheduledSamples: readonly { sample: MarketOrderbookRecorderSample }[]
): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const scheduled of scheduledSamples) {
    for (const venue of scheduled.sample.venueKeys) {
      addVenueCount(counts, venue, 1);
    }
  }
  return mapToRecord(counts);
};

const countSnapshotInputVenues = (
  snapshots: readonly VenueOrderbookSnapshotInput[]
): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const snapshot of snapshots) {
    addVenueCount(counts, snapshot.venue, 1);
  }
  return mapToRecord(counts);
};

const addVenueCounts = (target: Map<string, number>, values: Record<string, number>): void => {
  for (const [venue, count] of Object.entries(values)) {
    addVenueCount(target, venue, count);
  }
};

const addVenueCount = (target: Map<string, number>, venue: string, count: number): void => {
  const normalizedVenue = normalizeVenue(venue);
  target.set(normalizedVenue, (target.get(normalizedVenue) ?? 0) + count);
};

const mapToRecord = (values: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...values.entries()].sort(([left], [right]) => left.localeCompare(right)));

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

  const nonBlockingOpinionWarnings = new Set(["FEE_DISCOVERY", "BID_DEPTH_MISSING", "ASK_DEPTH_MISSING"]);
  const blockingMissingFactors = missingFactors.filter((factor) => !nonBlockingOpinionWarnings.has(factor));
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
}): VenueOrderbookSnapshotInput | null => {
  if (isTransientQuoteReadBlocker(input.blocker.reason, input.blocker.detailsCode)) {
    return null;
  }
  return {
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
  };
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
  marketOffset: 0,
  activeMarkets: 0,
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

const emptyCleanupResult = (): Pick<
  MarketOrderbookRecorderRunResult,
  | "deletedOldSnapshots"
  | "deletedClosedMarketSnapshots"
  | "deletedClosedLatestSnapshots"
  | "deletedStaleBlockedLatestSnapshots"
> => ({
  deletedOldSnapshots: 0,
  deletedClosedMarketSnapshots: 0,
  deletedClosedLatestSnapshots: 0,
  deletedStaleBlockedLatestSnapshots: 0
});

const normalizeVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};

const marketIncludesAnyVenue = (
  market: MarketCatalogMarket,
  venues: readonly string[]
): boolean => {
  const normalizedVenues = new Set(venues.map(normalizeVenue));
  return market.venueMarkets.some((venueMarket) => normalizedVenues.has(normalizeVenue(venueMarket.venue))) ||
    market.venues.some((venue) => normalizedVenues.has(normalizeVenue(venue)));
};

const uniqueMarketsByEventAndMarketIds = (markets: readonly MarketCatalogMarket[]): MarketCatalogMarket[] => {
  const seen = new Set<string>();
  const unique: MarketCatalogMarket[] = [];
  for (const market of markets) {
    const key = `${market.canonicalEventId}:${market.canonicalMarketIds.join("|") || market.eventId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(market);
  }
  return unique;
};

const wrapSlice = <T>(values: readonly T[], offset: number, limit: number): T[] => {
  if (limit <= 0 || values.length === 0) {
    return [];
  }
  const selected: T[] = [];
  for (let index = 0; index < Math.min(limit, values.length); index += 1) {
    selected.push(values[(offset + index) % values.length]!);
  }
  return selected;
};

const sampleCooldownKey = (sample: { canonicalMarketId: string; outcomeId?: string | null | undefined }): string =>
  `${sample.canonicalMarketId}:${sample.outcomeId ?? ""}`;

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
  if (isTransientQuoteReadBlocker(reason)) {
    return 0;
  }
  return 0;
};

const normalizeBlockerReason = (reason: string): string =>
  reason.trim();

const isTransientQuoteReadBlocker = (reason: string, detailsCode?: string | undefined): boolean => {
  const values = [reason, detailsCode ?? ""].map((value) => value.trim());
  return values.some((value) =>
    value === "QUOTE_PROVIDER_TIMEOUT" ||
    value.includes("quote_reader_timeout_after_") ||
    value.includes("recorder sample timed out")
  );
};
