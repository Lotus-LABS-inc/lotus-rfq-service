import Decimal from "decimal.js";
import { performance } from "node:perf_hooks";
import { recordLatencyDuration, withLatencyStage, withLatencyStageSync } from "../../observability/latency.js";
import { calculateVenueFeeQuote, type VenueFeeQuote } from "./venue-fees.js";

export type QuoteQuality =
  | "FULL_DEPTH_STREAM"
  | "FULL_DEPTH_REST"
  | "TOP_OF_BOOK_REST"
  | "INDICATIVE_DEPTH"
  | "DIAGNOSTIC_ONLY";

export type QuoteSnapshotSource = "STREAM" | "REST";

export interface NormalizedQuoteLevel {
  price: string;
  size: string;
}

export interface NormalizedVenueQuoteSnapshot {
  venue: string;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  source: QuoteSnapshotSource;
  quoteQuality: QuoteQuality;
  sourceTimestamp: Date | null;
  receivedAt: Date;
  bids: readonly NormalizedQuoteLevel[];
  asks: readonly NormalizedQuoteLevel[];
  feeBps?: number | undefined;
  fixedFee?: number | undefined;
  feeQuote?: VenueFeeQuote | undefined;
  venueFeeBps?: number | undefined;
  venueFeeModel?: VenueFeeQuote["feeModel"] | undefined;
  polymarketFeeRate?: number | undefined;
  polymarketCategory?: string | undefined;
  opinionTopicRate?: number | undefined;
  limitlessMarketType?: "amm" | "clob" | undefined;
  staticFeeApproved?: boolean | undefined;
  settlementEvidenceSupported?: boolean | undefined;
  missingFactors?: readonly string[] | undefined;
  blockers?: readonly string[] | undefined;
  streamResynced?: boolean | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface QuoteCalculationInput {
  snapshot: NormalizedVenueQuoteSnapshot;
  side: "buy" | "sell";
  amount: number;
  now?: Date | undefined;
  streamFreshnessMs?: number | undefined;
  restFreshnessMs?: number | undefined;
}

export interface QuoteCalculationResult {
  ok: boolean;
  venue: string;
  quoteQuality: QuoteQuality;
  source: QuoteSnapshotSource;
  freshnessMs: number;
  price: number;
  availableSize: number;
  spreadBps: number;
  slippageBps: number;
  liquidityScore: number;
  confidencePenaltyBps: number;
  feeBps?: number | undefined;
  fixedFee?: number | undefined;
  feeAmount?: number | undefined;
  effectiveFeeBps?: number | undefined;
  feeQuote?: VenueFeeQuote | undefined;
  settlementEvidenceSupported?: boolean | undefined;
  missingFactors: readonly string[];
  blockers: readonly string[];
  metadata: Readonly<Record<string, unknown>>;
}

export interface VenueQuoteSnapshotReaderInput {
  canonicalMarketId: string;
  canonicalOutcomeId?: string | undefined;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  side: "buy" | "sell";
  quantity: number;
}

export interface VenueQuoteSnapshotReader {
  venue: string;
  getQuoteSnapshot(input: VenueQuoteSnapshotReaderInput): Promise<NormalizedVenueQuoteSnapshot | null>;
}

export interface HotVenueQuoteSnapshotStore {
  touch(input: { canonicalMarketId: string; canonicalOutcomeId?: string | undefined }): void;
  put?(snapshot: NormalizedVenueQuoteSnapshot): void;
  get(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
  }): Promise<NormalizedVenueQuoteSnapshot | null>;
  getDisplay?(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
    maxAgeMs: number;
    includeDbFallback?: boolean | undefined;
  }): Promise<NormalizedVenueQuoteSnapshot | null>;
}

export interface VenueQuoteMapping {
  venue: string;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
}

export interface VenueQuoteMappingReadiness {
  venue: string;
  approvedVenueMarketId: string;
  venueMarketId: string | null;
  venueOutcomeId: string | null;
  quoteReady: boolean;
  blockers: readonly string[];
}

export interface SharedCoreQuoteReadinessMarket {
  canonicalEventId: string;
  canonicalMarketIds: readonly string[];
  title: string;
  category: string;
  venues: readonly VenueQuoteMappingReadiness[];
}

export interface VenueQuoteMappingResolver {
  resolve(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMapping[]>;
  preloadReadiness?(inputs: readonly {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }[]): Promise<void>;
  getReadiness?(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMappingReadiness[]>;
  listApprovedReadiness?(input: {
    limit: number;
  }): Promise<readonly SharedCoreQuoteReadinessMarket[]>;
}

export interface SharedCoreVenueQuoteMappingRow extends Record<string, unknown> {
  requested_canonical_market_id?: string;
  canonical_event_id?: string;
  canonical_market_id?: string | null;
  title?: string;
  canonical_category?: string;
  venue: string;
  venue_market_id: string;
  normalized_payload: unknown;
  raw_source_payload: unknown;
}

export interface SharedCoreQuoteMappingLoader {
  loadApprovedVenueMappings(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly SharedCoreVenueQuoteMappingRow[]>;
  loadApprovedVenueMappingsBatch?(input: {
    canonicalMarketIds: readonly string[];
  }): Promise<readonly SharedCoreVenueQuoteMappingRow[]>;
  listApprovedVenueMappings(input: {
    limit: number;
  }): Promise<readonly SharedCoreVenueQuoteMappingRow[]>;
}

const supportedQuoteVenues = new Set(["POLYMARKET", "LIMITLESS", "PREDICT", "PREDICT_FUN", "OPINION", "MYRIAD"]);
const DEFAULT_MAPPING_READINESS_CACHE_TTL_MS = 60_000;

export interface CalculatedVenueQuoteSnapshot {
  venue: string;
  availableSize: number;
  quotedPrice: number;
  fees: Readonly<Record<string, number>>;
  latencyMs: number;
  fillProb: number;
  metadata: Readonly<Record<string, unknown>>;
}

export interface VenueQuoteSnapshotBlocker {
  venue: string;
  reason: string;
  venueMarketId?: string | undefined;
  venueOutcomeId?: string | undefined;
  detailsCode?: string | undefined;
}

export interface CalculatedVenueQuoteSnapshotReport {
  snapshots: readonly CalculatedVenueQuoteSnapshot[];
  blocked: readonly VenueQuoteSnapshotBlocker[];
}

export interface VenueQuoteSnapshotReport {
  snapshots: readonly NormalizedVenueQuoteSnapshot[];
  blocked: readonly VenueQuoteSnapshotBlocker[];
}

export class QuoteSnapshotCache {
  private readonly snapshots = new Map<string, NormalizedVenueQuoteSnapshot>();

  public put(snapshot: NormalizedVenueQuoteSnapshot): void {
    this.snapshots.set(snapshotKey(snapshot.venue, snapshot.venueMarketId, snapshot.venueOutcomeId), snapshot);
  }

  public get(input: { venue: string; venueMarketId: string; venueOutcomeId?: string | undefined }): NormalizedVenueQuoteSnapshot | null {
    return this.snapshots.get(snapshotKey(input.venue, input.venueMarketId, input.venueOutcomeId)) ?? null;
  }
}

export class CompositeVenueQuoteSource {
  private readonly readerByVenue: ReadonlyMap<string, VenueQuoteSnapshotReader>;
  private readonly readerTimeoutMs: number;
  private readonly readerTimeoutMsByVenue: ReadonlyMap<string, number>;

  public constructor(
    readers: readonly VenueQuoteSnapshotReader[],
    private readonly mappingResolver: VenueQuoteMappingResolver,
    private readonly now: () => Date = () => new Date(),
    private readonly hotSnapshotStore?: HotVenueQuoteSnapshotStore | undefined,
    options: {
      readerTimeoutMs?: number | undefined;
      perVenueReaderTimeoutMs?: Readonly<Record<string, number>> | undefined;
    } = {}
  ) {
    this.readerTimeoutMs = Math.max(250, Math.min(options.readerTimeoutMs ?? 2_500, 10_000));
    this.readerTimeoutMsByVenue = new Map(Object.entries(options.perVenueReaderTimeoutMs ?? {})
      .map(([venue, timeoutMs]) => [venue.trim().toUpperCase(), clampReaderTimeoutMs(timeoutMs)] as const));
    this.readerByVenue = new Map(readers.flatMap((reader) => {
      const venue = reader.venue.toUpperCase();
      return venue === "PREDICT_FUN"
        ? [[venue, reader] as const, ["PREDICT", reader] as const]
        : [[venue, reader] as const];
    }));
  }

  public async getCalculatedSnapshots(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    side: "buy" | "sell";
    quantity: number;
  }): Promise<readonly CalculatedVenueQuoteSnapshot[]> {
    return (await this.getCalculatedSnapshotReport(input)).snapshots;
  }

  public async getCalculatedSnapshotReport(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    side: "buy" | "sell";
    quantity: number;
    readMode?: "live" | "cached_display" | undefined;
    displayMaxAgeMs?: number | undefined;
  }): Promise<CalculatedVenueQuoteSnapshotReport> {
    const rawReport = await this.getQuoteSnapshotReport(input);
    const calculatedResults = withLatencyStageSync("quote_aggregation_calculation", {
      canonicalMarketId: input.canonicalMarketId
    }, () => rawReport.snapshots.map((snapshot): {
      snapshot: CalculatedVenueQuoteSnapshot | null;
      blocker: VenueQuoteSnapshotBlocker | null;
    } => {
      const calculated = calculateVenueQuote({
        snapshot,
        side: input.side,
        amount: input.quantity,
        now: this.now()
      });
      if (!calculated.ok) {
        return {
          snapshot: null,
          blocker: {
            venue: snapshot.venue.toUpperCase(),
            reason: calculated.blockers.join(",") || "QUOTE_CALCULATION_BLOCKED",
            venueMarketId: snapshot.venueMarketId,
            ...(snapshot.venueOutcomeId ? { venueOutcomeId: snapshot.venueOutcomeId } : {})
          }
        };
      }
      const output: CalculatedVenueQuoteSnapshot = {
        venue: calculated.venue,
        availableSize: calculated.availableSize,
        quotedPrice: calculated.price,
        fees: {
          ...(calculated.feeAmount !== undefined ? { provider_fee: calculated.feeAmount } : {}),
          ...(calculated.fixedFee !== undefined ? { fixed_fee: calculated.fixedFee } : {})
        },
        latencyMs: calculated.freshnessMs,
        fillProb: calculated.liquidityScore,
        metadata: {
          source: "venue_quote_snapshot",
          venue: calculated.venue,
          venueMarketId: snapshot.venueMarketId,
          venueOutcomeId: snapshot.venueOutcomeId,
          quoteQuality: calculated.quoteQuality,
          quoteSource: calculated.source,
          freshnessMs: calculated.freshnessMs,
          spreadBps: calculated.spreadBps,
          slippageBps: calculated.slippageBps,
          liquidityScore: calculated.liquidityScore,
          confidencePenaltyBps: calculated.confidencePenaltyBps,
          feeAmount: calculated.feeAmount,
          effectiveFeeBps: calculated.effectiveFeeBps,
          feeQuote: calculated.feeQuote,
          missingFactors: calculated.missingFactors,
          blockers: calculated.blockers,
          settlementEvidenceSupported: calculated.settlementEvidenceSupported,
          ...calculated.metadata
        }
      };
      return { snapshot: output, blocker: null };
    }));
    return {
      snapshots: calculatedResults
        .map((result) => result.snapshot)
        .filter((result): result is CalculatedVenueQuoteSnapshot => result !== null),
      blocked: [
        ...rawReport.blocked,
        ...calculatedResults
          .map((result) => result.blocker)
          .filter((result): result is VenueQuoteSnapshotBlocker => result !== null)
      ]
    };
  }

  public async getQuoteSnapshotReport(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    side: "buy" | "sell";
    quantity: number;
    readMode?: "live" | "cached_display" | undefined;
    displayMaxAgeMs?: number | undefined;
  }): Promise<VenueQuoteSnapshotReport> {
    this.hotSnapshotStore?.touch({
      canonicalMarketId: input.canonicalMarketId,
      ...(input.canonicalOutcomeId ? { canonicalOutcomeId: input.canonicalOutcomeId } : {})
    });
    const readiness = await withLatencyStage("quote_source_mapping_lookup", {
      canonicalMarketId: input.canonicalMarketId
    }, () => this.loadMappingReadiness(input));
    const mappingBlockers: VenueQuoteSnapshotBlocker[] = readiness
      .filter((row) => !row.quoteReady)
      .map((row) => ({
        venue: row.venue,
        reason: row.blockers.join(",") || "QUOTE_MAPPING_NOT_READY",
        ...(row.venueMarketId ? { venueMarketId: row.venueMarketId } : {}),
        ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
      }));
    const mappings = readiness
      .filter((row) => row.quoteReady && row.venueMarketId !== null)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId!,
        ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
      }));

    const results = await Promise.all(mappings.map(async (mapping): Promise<{
      snapshot: NormalizedVenueQuoteSnapshot | null;
      blocker: VenueQuoteSnapshotBlocker | null;
    }> => {
      const startedAt = performance.now();
      try {
        const readMode = input.readMode ?? "live";
        const hotSnapshot = await this.readHotSnapshot({
          venue: mapping.venue,
          venueMarketId: mapping.venueMarketId,
          ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {}),
          ...(readMode === "cached_display" ? { maxAgeMs: input.displayMaxAgeMs ?? 45_000 } : {})
        });
        if (hotSnapshot) {
          recordLatencyDuration("venue_quote_fetch", performance.now() - startedAt, {
            canonicalMarketId: input.canonicalMarketId,
            venue: mapping.venue,
            external: false,
            cache: "hit"
          });
          return { snapshot: hotSnapshot, blocker: null };
        }
        if (readMode === "cached_display") {
          recordLatencyDuration("venue_quote_fetch", performance.now() - startedAt, {
            canonicalMarketId: input.canonicalMarketId,
            venue: mapping.venue,
            external: false,
            cache: "miss",
            blockerCategory: "QUOTE_SNAPSHOT_CACHE_MISS"
          });
          return {
            snapshot: null,
            blocker: {
              venue: mapping.venue.toUpperCase(),
              reason: "QUOTE_SNAPSHOT_CACHE_MISS",
              venueMarketId: mapping.venueMarketId,
              ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {})
            }
          };
        }
        const reader = this.readerByVenue.get(mapping.venue.toUpperCase());
        if (!reader) {
          recordLatencyDuration("venue_quote_fetch", performance.now() - startedAt, {
            canonicalMarketId: input.canonicalMarketId,
            venue: mapping.venue,
            external: true,
            blockerCategory: "QUOTE_READER_UNSUPPORTED"
          });
          return {
            snapshot: null,
            blocker: {
              venue: mapping.venue.toUpperCase(),
              reason: "QUOTE_READER_UNSUPPORTED",
              venueMarketId: mapping.venueMarketId,
              ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {})
            }
          };
        }
        const snapshot = await withQuoteReaderTimeout(
          reader.getQuoteSnapshot({
            canonicalMarketId: input.canonicalMarketId,
            ...(input.canonicalOutcomeId ? { canonicalOutcomeId: input.canonicalOutcomeId } : {}),
            venueMarketId: mapping.venueMarketId,
            ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {}),
            side: input.side,
            quantity: input.quantity
          }),
          this.resolveReaderTimeoutMs(mapping.venue),
          mapping.venue
        );
        if (!snapshot) {
          recordLatencyDuration("venue_quote_fetch", performance.now() - startedAt, {
            canonicalMarketId: input.canonicalMarketId,
            venue: mapping.venue,
            external: true,
            blockerCategory: "QUOTE_SNAPSHOT_UNAVAILABLE"
          });
          return {
            snapshot: null,
            blocker: {
              venue: mapping.venue.toUpperCase(),
              reason: "QUOTE_SNAPSHOT_UNAVAILABLE",
              venueMarketId: mapping.venueMarketId,
              ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {})
            }
          };
        }
        recordLatencyDuration("venue_quote_fetch", performance.now() - startedAt, {
          canonicalMarketId: input.canonicalMarketId,
          venue: mapping.venue,
          external: true
        });
        this.hotSnapshotStore?.put?.(snapshot);
        return { snapshot, blocker: null };
      } catch (error) {
        const classified = classifyQuoteReaderError(error);
        const venue = mapping.venue.toUpperCase();
        recordLatencyDuration("venue_quote_fetch", performance.now() - startedAt, {
          canonicalMarketId: input.canonicalMarketId,
          venue,
          external: true,
          blockerCategory: classified.reason
        });
        const detailsCode = (venue === "PREDICT_FUN" || venue === "PREDICT") && classified.reason === "QUOTE_PROVIDER_HTTP_401"
          ? "PREDICT_PROVIDER_AUTH_INVALID"
          : classified.detailsCode;
        return {
          snapshot: null,
          blocker: {
            venue,
            reason: classified.reason,
            venueMarketId: mapping.venueMarketId,
            ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {}),
            ...(detailsCode ? { detailsCode } : {})
          }
        };
      }
    }));
    return {
      snapshots: results
        .map((result) => result.snapshot)
        .filter((result): result is NormalizedVenueQuoteSnapshot => result !== null),
      blocked: [
        ...mappingBlockers,
        ...results
          .map((result) => result.blocker)
          .filter((result): result is VenueQuoteSnapshotBlocker => result !== null)
      ]
    };
  }

  public async preloadMappingReadiness(inputs: readonly {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }[]): Promise<void> {
    await this.mappingResolver.preloadReadiness?.(inputs);
  }

  private async loadMappingReadiness(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMappingReadiness[]> {
    if (this.mappingResolver.getReadiness) {
      return this.mappingResolver.getReadiness(input);
    }
    return (await this.mappingResolver.resolve(input)).map((mapping) => ({
      venue: mapping.venue.toUpperCase(),
      approvedVenueMarketId: mapping.venueMarketId,
      venueMarketId: mapping.venueMarketId,
      venueOutcomeId: mapping.venueOutcomeId ?? null,
      quoteReady: true,
      blockers: []
    }));
  }

  private resolveReaderTimeoutMs(venue: string): number {
    return this.readerTimeoutMsByVenue.get(venue.trim().toUpperCase()) ?? this.readerTimeoutMs;
  }

  private async readHotSnapshot(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
    maxAgeMs?: number | undefined;
  }): Promise<NormalizedVenueQuoteSnapshot | null> {
    if (!this.hotSnapshotStore) {
      return null;
    }
    const maxAgeMs = input.maxAgeMs;
    if (maxAgeMs !== undefined && this.hotSnapshotStore.getDisplay) {
      return this.hotSnapshotStore.getDisplay({
        venue: input.venue,
        venueMarketId: input.venueMarketId,
        ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
        maxAgeMs
      });
    }
    return this.hotSnapshotStore.get(input);
  }
}

const clampReaderTimeoutMs = (timeoutMs: number): number =>
  Math.max(250, Math.min(timeoutMs, 10_000));

const mappingReadinessCacheKey = (
  canonicalMarketId: string,
  canonicalOutcomeId: string | undefined
): string => `${canonicalMarketId}\u0000${canonicalOutcomeId ?? ""}`;

const uniqueMappingReadinessInputs = (inputs: readonly {
  canonicalMarketId: string;
  canonicalOutcomeId?: string | undefined;
}[]): Array<{ canonicalMarketId: string; canonicalOutcomeId?: string | undefined }> => {
  const seen = new Set<string>();
  const unique: Array<{ canonicalMarketId: string; canonicalOutcomeId?: string | undefined }> = [];
  for (const input of inputs) {
    const canonicalMarketId = input.canonicalMarketId.trim();
    if (!canonicalMarketId) {
      continue;
    }
    const canonicalOutcomeId = input.canonicalOutcomeId?.trim();
    const key = mappingReadinessCacheKey(canonicalMarketId, canonicalOutcomeId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({
      canonicalMarketId,
      ...(canonicalOutcomeId ? { canonicalOutcomeId } : {})
    });
  }
  return unique;
};

const resolveMappingReadinessCacheTtlMs = (cacheTtlMs: number | undefined): number =>
  Math.max(100, Math.min(cacheTtlMs ?? DEFAULT_MAPPING_READINESS_CACHE_TTL_MS, 10 * 60_000));

export class SharedCoreVenueQuoteMappingResolver implements VenueQuoteMappingResolver {
  private readonly readinessCache = new Map<string, {
    expiresAtMs: number;
    value?: readonly VenueQuoteMappingReadiness[] | undefined;
    promise?: Promise<readonly VenueQuoteMappingReadiness[]> | undefined;
  }>();

  public constructor(
    private readonly loader: SharedCoreQuoteMappingLoader,
    private readonly options: {
      cacheTtlMs?: number | undefined;
      now?: () => Date;
    } = {}
  ) {}

  public async resolve(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMapping[]> {
    const readiness = await this.getReadiness(input);
    return readiness
      .filter((row) => row.quoteReady && row.venueMarketId !== null)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId!,
        ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
      }));
  }

  public async getReadiness(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMappingReadiness[]> {
    const cacheKey = mappingReadinessCacheKey(input.canonicalMarketId, input.canonicalOutcomeId);
    const nowMs = (this.options.now ?? (() => new Date()))().getTime();
    const cached = this.readinessCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) {
      if (cached.value) {
        return cached.value;
      }
      if (cached.promise) {
        return cached.promise;
      }
    }

    const expiresAtMs = nowMs + resolveMappingReadinessCacheTtlMs(this.options.cacheTtlMs);
    const promise = this.loadReadiness(input)
      .then((value) => {
        this.readinessCache.set(cacheKey, { expiresAtMs, value });
        return value;
      })
      .catch((error) => {
        this.readinessCache.delete(cacheKey);
        throw error;
      });
    this.readinessCache.set(cacheKey, { expiresAtMs, promise });
    return promise;
  }

  public async preloadReadiness(inputs: readonly {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }[]): Promise<void> {
    const nowMs = (this.options.now ?? (() => new Date()))().getTime();
    const cacheTtlMs = resolveMappingReadinessCacheTtlMs(this.options.cacheTtlMs);
    const expiresAtMs = nowMs + cacheTtlMs;
    const missing = uniqueMappingReadinessInputs(inputs)
      .filter((input) => {
        const cached = this.readinessCache.get(mappingReadinessCacheKey(input.canonicalMarketId, input.canonicalOutcomeId));
        return !cached || cached.expiresAtMs <= nowMs;
      });
    if (missing.length === 0) {
      return;
    }

    if (!this.loader.loadApprovedVenueMappingsBatch) {
      await Promise.all(missing.map((input) => this.getReadiness(input)));
      return;
    }

    const rows = await this.loader.loadApprovedVenueMappingsBatch({
      canonicalMarketIds: [...new Set(missing.map((input) => input.canonicalMarketId))]
    });
    const rowsByRequestedId = new Map<string, SharedCoreVenueQuoteMappingRow[]>();
    for (const row of rows) {
      const requestedId = firstString(row.requested_canonical_market_id);
      if (!requestedId) {
        continue;
      }
      const bucket = rowsByRequestedId.get(requestedId) ?? [];
      bucket.push(row);
      rowsByRequestedId.set(requestedId, bucket);
    }
    for (const input of missing) {
      const value = normalizeSharedCoreMappingReadiness(
        rowsByRequestedId.get(input.canonicalMarketId) ?? [],
        input.canonicalOutcomeId
      );
      this.setReadinessCacheValue(input.canonicalMarketId, input.canonicalOutcomeId, expiresAtMs, value);
    }
  }

  private async loadReadiness(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMappingReadiness[]> {
    const rows = await this.loader.loadApprovedVenueMappings(input);
    return normalizeSharedCoreMappingReadiness(rows, input.canonicalOutcomeId);
  }

  public async listApprovedReadiness(input: {
    limit: number;
  }): Promise<readonly SharedCoreQuoteReadinessMarket[]> {
    const rows = await this.loader.listApprovedVenueMappings(input);
    this.primeReadinessCacheFromApprovedRows(rows);
    return normalizeSharedCoreReadinessMarkets(rows);
  }

  private setReadinessCacheValue(
    canonicalMarketId: string,
    canonicalOutcomeId: string | undefined,
    expiresAtMs: number,
    value: readonly VenueQuoteMappingReadiness[]
  ): void {
    this.readinessCache.set(mappingReadinessCacheKey(canonicalMarketId, canonicalOutcomeId), {
      expiresAtMs,
      value
    });
  }

  private primeReadinessCacheFromApprovedRows(rows: readonly SharedCoreVenueQuoteMappingRow[]): void {
    if (rows.length === 0) {
      return;
    }

    const nowMs = (this.options.now ?? (() => new Date()))().getTime();
    const expiresAtMs = nowMs + resolveMappingReadinessCacheTtlMs(this.options.cacheTtlMs);
    const rowsByMarketId = new Map<string, SharedCoreVenueQuoteMappingRow[]>();

    for (const row of rows) {
      const rowMarketIds = new Set([
        firstString(row.canonical_market_id),
        firstString(row.requested_canonical_market_id)
      ]);
      for (const marketId of rowMarketIds) {
        if (!marketId) {
          continue;
        }
        const bucket = rowsByMarketId.get(marketId) ?? [];
        bucket.push(row);
        rowsByMarketId.set(marketId, bucket);
      }
    }

    for (const [canonicalMarketId, marketRows] of rowsByMarketId.entries()) {
      const outcomes = readinessOutcomeAliasesFromRows(marketRows);
      this.setReadinessCacheValue(
        canonicalMarketId,
        undefined,
        expiresAtMs,
        normalizeSharedCoreMappingReadiness(marketRows)
      );
      for (const canonicalOutcomeId of outcomes) {
        this.setReadinessCacheValue(
          canonicalMarketId,
          canonicalOutcomeId,
          expiresAtMs,
          normalizeSharedCoreMappingReadiness(marketRows, canonicalOutcomeId)
        );
      }
    }
  }
}

export const calculateVenueQuote = (input: QuoteCalculationInput): QuoteCalculationResult => {
  const now = input.now ?? new Date();
  const freshnessMs = Math.max(0, now.getTime() - input.snapshot.receivedAt.getTime());
  const freshnessLimit = input.snapshot.source === "STREAM"
    ? input.streamFreshnessMs ?? 1_000
    : input.restFreshnessMs ?? 1_500;
  const missingFactors = [...(input.snapshot.missingFactors ?? [])];
  const blockers = [...(input.snapshot.blockers ?? [])];

  if (input.snapshot.quoteQuality === "DIAGNOSTIC_ONLY") {
    blockers.push("QUOTE_QUALITY_DIAGNOSTIC_ONLY");
  }
  if (freshnessMs > freshnessLimit) {
    blockers.push("QUOTE_SNAPSHOT_STALE");
  }
  if (input.snapshot.source === "STREAM" && input.snapshot.streamResynced === false) {
    blockers.push("STREAM_REST_RESYNC_REQUIRED");
  }
  if (input.snapshot.settlementEvidenceSupported === false) {
    blockers.push("SETTLEMENT_EVIDENCE_UNSUPPORTED");
  }

  const bids = normalizeBook(input.snapshot.bids, "desc");
  const asks = normalizeBook(input.snapshot.asks, "asc");
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;

  const bookSide = input.side === "buy" ? asks : bids;
  const executableTopPrice = input.side === "buy" ? bestAsk : bestBid;
  if (executableTopPrice === null) {
    blockers.push("EXECUTABLE_TOP_PRICE_MISSING");
  }
  if (bestBid === null || bestAsk === null) {
    missingFactors.push("BEST_BID_ASK_PARTIAL");
  }
  const fill = walkBook(bookSide, input.amount);
  if (fill.filledSize.lte(0)) {
    blockers.push("EXECUTABLE_DEPTH_MISSING");
  }
  if (fill.filledSize.lt(input.amount)) {
    missingFactors.push("PARTIAL_DEPTH_FOR_SIZE");
  }

  const weightedPrice = fill.filledSize.gt(0) ? fill.notional.div(fill.filledSize) : new Decimal(0);
  const topPrice = executableTopPrice;
  const spreadBps = bestBid !== null && bestAsk !== null
    ? bps(new Decimal(bestAsk).minus(bestBid), new Decimal(bestBid).plus(bestAsk).div(2))
    : new Decimal(0);
  const slippageBps = topPrice === null
    ? new Decimal(0)
    : input.side === "buy"
      ? bps(weightedPrice.minus(topPrice), topPrice)
      : bps(new Decimal(topPrice).minus(weightedPrice), topPrice);
  const feeQuote = input.snapshot.feeQuote ?? calculateVenueFeeQuote({
    venue: input.snapshot.venue,
    side: input.side,
    quantity: fill.filledSize,
    price: weightedPrice,
    ...(input.snapshot.staticFeeApproved && input.snapshot.feeBps !== undefined ? { staticFeeBps: input.snapshot.feeBps } : {}),
    ...(input.snapshot.venueFeeBps !== undefined ? { venueFeeBps: input.snapshot.venueFeeBps } : {}),
    ...(input.snapshot.venueFeeModel ? { venueFeeModel: input.snapshot.venueFeeModel } : {}),
    ...(input.snapshot.polymarketFeeRate !== undefined ? { polymarketFeeRate: input.snapshot.polymarketFeeRate } : {}),
    ...(input.snapshot.polymarketCategory ? { polymarketCategory: input.snapshot.polymarketCategory } : {}),
    ...(input.snapshot.opinionTopicRate !== undefined ? { opinionTopicRate: input.snapshot.opinionTopicRate } : {}),
    ...(input.snapshot.limitlessMarketType ? { limitlessMarketType: input.snapshot.limitlessMarketType } : {})
  });

  if (!feeQuote) {
    missingFactors.push("FEE_DISCOVERY");
  }

  const confidencePenaltyBps = quoteQualityPenaltyBps(input.snapshot.quoteQuality) +
    missingFactors.length * 2 +
    (input.snapshot.staticFeeApproved && input.snapshot.feeBps === undefined ? 5 : 0);
  const utilization = fill.totalDepth.gt(0) ? fill.filledSize.div(fill.totalDepth) : new Decimal(1);
  const liquidityScore = Decimal.max(
    0,
    Decimal.min(1, new Decimal(1).minus(spreadBps.div(2_000)).minus(slippageBps.div(2_000)).minus(utilization.times(0.25)))
  );

  return {
    ok: blockers.length === 0,
    venue: input.snapshot.venue.toUpperCase(),
    quoteQuality: input.snapshot.quoteQuality,
    source: input.snapshot.source,
    freshnessMs,
    price: roundNumber(weightedPrice),
    availableSize: roundNumber(fill.totalDepth),
    spreadBps: roundNumber(Decimal.max(0, spreadBps)),
    slippageBps: roundNumber(Decimal.max(0, slippageBps)),
    liquidityScore: roundNumber(liquidityScore),
    confidencePenaltyBps,
    ...(input.snapshot.feeBps !== undefined ? { feeBps: input.snapshot.feeBps } : {}),
    ...(input.snapshot.fixedFee !== undefined ? { fixedFee: input.snapshot.fixedFee } : {}),
    ...(feeQuote ? {
      feeAmount: roundNumber(new Decimal(feeQuote.feeAmount)),
      effectiveFeeBps: feeQuote.effectiveFeeBps,
      feeQuote
    } : {}),
    settlementEvidenceSupported: input.snapshot.settlementEvidenceSupported,
    missingFactors: [...new Set(missingFactors)],
    blockers: [...new Set(blockers)],
    metadata: input.snapshot.metadata ?? {}
  };
};

const normalizeSharedCoreMappingReadiness = (
  rows: readonly SharedCoreVenueQuoteMappingRow[],
  canonicalOutcomeId?: string | undefined
): readonly VenueQuoteMappingReadiness[] =>
  rows.flatMap((row) => {
    const venue = typeof row.venue === "string" ? row.venue.toUpperCase() : "";
    if (!venue) {
      return [];
    }
    const normalizedPayload = asRecord(row.normalized_payload);
    const rawPayload = asRecord(row.raw_source_payload);
    const venueMarketId = firstString(
      normalizedPayload.quoteMarketId,
      normalizedPayload.quote_market_id,
      normalizedPayload.executableMarketId,
      normalizedPayload.executable_market_id,
      normalizedPayload.venueMarketId,
      normalizedPayload.venue_market_id,
      rawPayload.quoteMarketId,
      rawPayload.quote_market_id,
      rawPayload.executableMarketId,
      rawPayload.executable_market_id,
      rawPayload.venueMarketId,
      rawPayload.venue_market_id,
      stripCuratedVenueMarketId(row.venue_market_id, venue, normalizedPayload.curatedKey ?? rawPayload.curatedKey)
    );
    const venueOutcomeId = firstString(
      tokenForCanonicalOutcome(normalizedPayload.quoteOutcomeTokenIds, canonicalOutcomeId),
      tokenForCanonicalOutcome(normalizedPayload.quote_outcome_token_ids, canonicalOutcomeId),
      tokenForCanonicalOutcome(normalizedPayload.outcomes, canonicalOutcomeId),
      tokenForCanonicalOutcome(normalizedPayload.tokens, canonicalOutcomeId),
      tokenForCanonicalOutcome(rawPayload.quoteOutcomeTokenIds, canonicalOutcomeId),
      tokenForCanonicalOutcome(rawPayload.quote_outcome_token_ids, canonicalOutcomeId),
      tokenForCanonicalOutcome(rawPayload.outcomes, canonicalOutcomeId),
      tokenForCanonicalOutcome(rawPayload.tokens, canonicalOutcomeId),
      normalizedPayload.quoteTokenId,
      normalizedPayload.quote_token_id,
      normalizedPayload.quoteOutcomeId,
      normalizedPayload.quote_outcome_id,
      normalizedPayload.executableOutcomeId,
      normalizedPayload.executable_outcome_id,
      normalizedPayload.venueOutcomeId,
      normalizedPayload.venue_outcome_id,
      rawPayload.quoteTokenId,
      rawPayload.quote_token_id,
      rawPayload.quoteOutcomeId,
      rawPayload.quote_outcome_id,
      rawPayload.executableOutcomeId,
      rawPayload.executable_outcome_id,
      rawPayload.venueOutcomeId,
      rawPayload.venue_outcome_id
    );
    const blockers = quoteMappingBlockers({
      venue,
      venueMarketId,
      venueOutcomeId,
      providerBlockers: [
        ...stringArray(normalizedPayload.quoteVerificationBlockers),
        ...stringArray(normalizedPayload.quote_verification_blockers),
        ...stringArray(rawPayload.quoteVerificationBlockers),
        ...stringArray(rawPayload.quote_verification_blockers)
      ]
    });
    return [{
      venue,
      approvedVenueMarketId: row.venue_market_id,
      venueMarketId,
      venueOutcomeId,
      quoteReady: blockers.length === 0,
      blockers
    }];
  });

const readinessOutcomeAliasesFromRows = (rows: readonly SharedCoreVenueQuoteMappingRow[]): readonly string[] => {
  const aliases = new Set(["YES", "NO", "yes", "no"]);
  for (const row of rows) {
    const normalizedPayload = asRecord(row.normalized_payload);
    const rawPayload = asRecord(row.raw_source_payload);
    for (const value of [
      normalizedPayload.quoteOutcomeTokenIds,
      normalizedPayload.quote_outcome_token_ids,
      normalizedPayload.outcomes,
      normalizedPayload.tokens,
      rawPayload.quoteOutcomeTokenIds,
      rawPayload.quote_outcome_token_ids,
      rawPayload.outcomes,
      rawPayload.tokens
    ]) {
      collectReadinessOutcomeAliases(aliases, value);
    }
  }
  return [...aliases];
};

const collectReadinessOutcomeAliases = (aliases: Set<string>, value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      for (const alias of [
        firstString(record.id),
        firstString(record.label),
        firstString(record.name),
        firstString(record.outcome),
        firstString(record.outcomeId),
        firstString(record.outcome_id)
      ]) {
        addReadinessOutcomeAlias(aliases, alias);
      }
    }
    return;
  }

  const record = asRecord(value);
  for (const alias of Object.keys(record)) {
    addReadinessOutcomeAlias(aliases, alias);
  }
};

const addReadinessOutcomeAlias = (aliases: Set<string>, value: string | null): void => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 128) {
    return;
  }
  aliases.add(trimmed);
  aliases.add(trimmed.toUpperCase().replace(/\s+/g, "_"));
  aliases.add(trimmed.toLowerCase().replace(/\s+/g, "_"));
};

const normalizeSharedCoreReadinessMarkets = (rows: readonly SharedCoreVenueQuoteMappingRow[]): readonly SharedCoreQuoteReadinessMarket[] => {
  const byEvent = new Map<string, {
    canonicalMarketIds: Set<string>;
    title: string;
    category: string;
    rowByVenueKey: Map<string, SharedCoreVenueQuoteMappingRow>;
  }>();
  for (const row of rows) {
    const eventId = firstString(row.canonical_event_id);
    if (!eventId) {
      continue;
    }
    const bucket = byEvent.get(eventId) ?? {
      canonicalMarketIds: new Set<string>(),
      title: firstString(row.title) ?? eventId,
      category: firstString(row.canonical_category) ?? "UNKNOWN",
      rowByVenueKey: new Map<string, SharedCoreVenueQuoteMappingRow>()
    };
    const canonicalMarketId = firstString(row.canonical_market_id);
    if (canonicalMarketId) {
      bucket.canonicalMarketIds.add(canonicalMarketId);
    }
    bucket.rowByVenueKey.set(`${row.venue}:${row.venue_market_id}`, row);
    byEvent.set(eventId, bucket);
  }
  return [...byEvent.entries()].map(([canonicalEventId, bucket]) => ({
    canonicalEventId,
    canonicalMarketIds: [...bucket.canonicalMarketIds].sort(),
    title: bucket.title,
    category: bucket.category,
    venues: normalizeSharedCoreMappingReadiness([...bucket.rowByVenueKey.values()])
  }));
};

const quoteMappingBlockers = (input: {
  venue: string;
  venueMarketId: string | null;
  venueOutcomeId: string | null;
  providerBlockers?: readonly string[] | undefined;
}): readonly string[] => {
  const blockers: string[] = [];
  if (!supportedQuoteVenues.has(input.venue)) {
    blockers.push("QUOTE_READER_UNSUPPORTED");
  }
  if (!input.venueMarketId) {
    blockers.push("VENUE_MARKET_ID_MISSING");
  }
  // Some official venue APIs can resolve executable outcome tokens from the approved
  // shared-core market id at quote time. Keep routing fail-closed in the reader instead
  // of blocking before that source-backed lookup runs.
  if (input.venue === "OPINION" && !input.venueOutcomeId && !looksLikeOpinionExecutableId(input.venueMarketId)) {
    blockers.push("OPINION_TOKEN_ID_MISSING");
  }
  blockers.push(...(input.providerBlockers ?? []));
  return [...new Set(blockers)];
};

class QuoteReaderTimeoutError extends Error {
  public constructor(venue: string, timeoutMs: number) {
    super(`${venue} quote reader timeout after ${timeoutMs}ms.`);
    this.name = "QuoteReaderTimeoutError";
  }
}

const withQuoteReaderTimeout = async <T>(promise: Promise<T>, timeoutMs: number, venue: string): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new QuoteReaderTimeoutError(venue, timeoutMs)), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const classifyQuoteReaderError = (error: unknown): { reason: string; detailsCode?: string | undefined } => {
  const record = asRecord(error);
  const status = typeof record.status === "number" && Number.isInteger(record.status) ? record.status : null;
  const name = firstString(record.name);
  const message = error instanceof Error ? error.message : firstString(record.message) ?? String(error);
  const normalized = `${name ?? ""} ${message}`.toUpperCase();
  const messageStatus = message.match(/\bstatus\s+(\d{3})\b/i)?.[1] ?? null;

  if (normalized.includes("LIMITLESS") && normalized.includes("MARKET IS NOT ACTIVE")) {
    return { reason: "LIMITLESS_MARKET_NOT_ACTIVE", detailsCode: safeDetailsCode(message) };
  }
  if (status !== null || messageStatus !== null) {
    return { reason: `QUOTE_PROVIDER_HTTP_${status ?? messageStatus}`, detailsCode: safeDetailsCode(message) };
  }
  if (normalized.includes("TIMEOUT") || normalized.includes("ABORT")) {
    return { reason: "QUOTE_PROVIDER_TIMEOUT", detailsCode: safeDetailsCode(message) };
  }
  if (normalized.includes("TOKEN_ID_MISSING") || normalized.includes("OPINION_TOKEN_ID_MISSING")) {
    return { reason: "OPINION_TOKEN_ID_MISSING", detailsCode: safeDetailsCode(message) };
  }
  if (normalized.includes("VENUE_OUTCOME_ID_MISSING") || normalized.includes("OUTCOME_ID_MISSING")) {
    return { reason: "VENUE_OUTCOME_ID_MISSING", detailsCode: safeDetailsCode(message) };
  }
  if (
    normalized.includes("BAD_PAYLOAD") ||
    normalized.includes("INVALID_PAYLOAD") ||
    normalized.includes("ZOD") ||
    normalized.includes("PARSE") ||
    normalized.includes("JSON")
  ) {
    return { reason: "QUOTE_PROVIDER_BAD_PAYLOAD", detailsCode: safeDetailsCode(message) };
  }
  if (normalized.includes("EMPTY_BOOK") || normalized.includes("ORDERBOOK_EMPTY") || normalized.includes("NO_ORDERBOOK")) {
    return { reason: "QUOTE_PROVIDER_EMPTY_BOOK", detailsCode: safeDetailsCode(message) };
  }
  return { reason: "QUOTE_READER_FAILED", detailsCode: safeDetailsCode(message) };
};

const safeDetailsCode = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value
    .replace(/0x[a-f0-9]{16,}/gi, "0xREDACTED")
    .replace(/[A-Za-z0-9_-]{24,}/g, "REDACTED")
    .replace(/[^A-Za-z0-9_:.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return normalized || undefined;
};

const looksLikeNumericId = (value: string | null): boolean =>
  typeof value === "string" && /^\d+$/.test(value);

const looksLikeOpinionExecutableId = (value: string | null): boolean =>
  looksLikeNumericId(value) || (typeof value === "string" && /^\d{5,}(?=[:_-])/.test(value));

const tokenForCanonicalOutcome = (value: unknown, canonicalOutcomeId?: string | undefined): string | null => {
  if (!canonicalOutcomeId) {
    return null;
  }
  if (Array.isArray(value)) {
    const normalizedOutcomeId = canonicalOutcomeId.trim().toUpperCase();
    for (const item of value) {
      const record = asRecord(item);
      const labels = [
        firstString(record.id),
        firstString(record.label),
        firstString(record.name),
        firstString(record.outcome),
        firstString(record.outcomeId),
        firstString(record.outcome_id)
      ]
        .filter((entry): entry is string => entry !== null)
        .map((entry) => entry.trim().toUpperCase().replace(/\s+/g, "_"));
      if (!labels.includes(normalizedOutcomeId) && !(normalizedOutcomeId === "YES" && labels.includes("Y")) && !(normalizedOutcomeId === "NO" && labels.includes("N"))) {
        continue;
      }
      const token = firstString(
        record.tokenId,
        record.token_id,
        record.quoteTokenId,
        record.quote_token_id,
        record.venueOutcomeId,
        record.venue_outcome_id
      );
      if (token) return token;
    }
    return null;
  }
  const record = asRecord(value);
  const normalizedOutcomeId = canonicalOutcomeId.trim().toUpperCase();
  return firstString(
    record[canonicalOutcomeId],
    record[canonicalOutcomeId.trim()],
    record[normalizedOutcomeId],
    record[normalizedOutcomeId.replace(/\s+/g, "_")]
  );
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];

const stripCuratedVenueMarketId = (
  venueMarketId: string,
  venue: string,
  curatedKey: unknown
): string | null => {
  const prefix = `${venue}:`;
  if (!venueMarketId.startsWith(prefix)) {
    return venueMarketId || null;
  }
  const withoutPrefix = venueMarketId.slice(prefix.length);
  if (typeof curatedKey === "string" && curatedKey.length > 0) {
    const suffix = `:${curatedKey}`;
    return withoutPrefix.endsWith(suffix)
      ? withoutPrefix.slice(0, -suffix.length)
      : withoutPrefix;
  }
  return withoutPrefix;
};

const normalizeBook = (levels: readonly NormalizedQuoteLevel[], sort: "asc" | "desc") =>
  levels
    .map((level) => ({
      price: new Decimal(level.price),
      size: new Decimal(level.size)
    }))
    .filter((level) => level.price.gt(0) && level.size.gt(0))
    .sort((left, right) => sort === "asc"
      ? left.price.comparedTo(right.price)
      : right.price.comparedTo(left.price));

const walkBook = (
  levels: readonly { price: InstanceType<typeof Decimal>; size: InstanceType<typeof Decimal> }[],
  amount: number
) => {
  let remaining = new Decimal(amount);
  let filledSize = new Decimal(0);
  let notional = new Decimal(0);
  const totalDepth = levels.reduce((sum, level) => sum.plus(level.size), new Decimal(0));
  for (const level of levels) {
    if (remaining.lte(0)) {
      break;
    }
    const size = Decimal.min(remaining, level.size);
    filledSize = filledSize.plus(size);
    notional = notional.plus(size.times(level.price));
    remaining = remaining.minus(size);
  }
  return { filledSize, notional, totalDepth };
};

const bps = (
  numerator: InstanceType<typeof Decimal>,
  denominator: InstanceType<typeof Decimal> | string | number
): InstanceType<typeof Decimal> => {
  const base = new Decimal(denominator);
  return base.lte(0) ? new Decimal(0) : numerator.div(base).times(10_000);
};

const quoteQualityPenaltyBps = (quality: QuoteQuality): number => {
  if (quality === "FULL_DEPTH_STREAM") return 0;
  if (quality === "FULL_DEPTH_REST") return 2;
  if (quality === "TOP_OF_BOOK_REST") return 8;
  if (quality === "INDICATIVE_DEPTH") return 15;
  return 10_000;
};

const roundNumber = (value: InstanceType<typeof Decimal>): number =>
  Number(value.toDecimalPlaces(12).toString());

const snapshotKey = (venue: string, venueMarketId: string, venueOutcomeId: string | undefined): string =>
  `${venue.toUpperCase()}|${venueMarketId}|${venueOutcomeId ?? ""}`;
