import type {
  NormalizedQuoteLevel,
  NormalizedVenueQuoteSnapshot,
  QuoteSnapshotCache,
  VenueQuoteSnapshotReader,
  VenueQuoteSnapshotReaderInput
} from "../../core/sor/quote-snapshot.js";
import { PredictClient } from "./predict-client.js";
import type { PredictEnvironment } from "./predict-types.js";

export interface PredictQuoteReaderConfig {
  client: Pick<PredictClient, "getMarketOrderbook" | "getMarketStatistics">;
  streamCache: QuoteSnapshotCache;
  environment: PredictEnvironment;
  now?: () => Date;
  feeBps?: number | undefined;
}

export class PredictQuoteReader implements VenueQuoteSnapshotReader {
  public readonly venue = "PREDICT";
  private readonly now: () => Date;

  public constructor(private readonly config: PredictQuoteReaderConfig) {
    this.now = config.now ?? (() => new Date());
  }

  public async getQuoteSnapshot(input: VenueQuoteSnapshotReaderInput): Promise<NormalizedVenueQuoteSnapshot | null> {
    const cached = this.config.streamCache.get({
      venue: this.venue,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId
    });
    if (cached?.source === "STREAM") {
      return cached;
    }

    const [orderbook, stats] = await Promise.all([
      this.config.client.getMarketOrderbook(input.venueMarketId),
      this.config.client.getMarketStatistics(input.venueMarketId).catch(() => null)
    ]);
    const statsRecord = asRecord(stats);
    const venueFeeBps = this.config.feeBps ?? parseOptionalNumber(statsRecord.feeRateBps ?? statsRecord.fee_rate_bps);
    return normalizePredictOrderbook({
      payload: orderbook,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId,
      receivedAt: this.now(),
      environment: this.config.environment,
      feeBps: this.config.feeBps,
      venueFeeBps
    });
  }
}

export const normalizePredictOrderbook = (input: {
  payload: unknown;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  receivedAt: Date;
  environment: PredictEnvironment;
  feeBps?: number | undefined;
  venueFeeBps?: number | undefined;
}): NormalizedVenueQuoteSnapshot => {
  const record = unwrapRecord(input.payload);
  const bids = normalizeLevels(record.bids);
  const asks = normalizeLevels(record.asks);
  return {
    venue: "PREDICT",
    venueMarketId: input.venueMarketId,
    ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: bids.length > 1 && asks.length > 1 ? "FULL_DEPTH_REST" : "TOP_OF_BOOK_REST",
    sourceTimestamp: asDate(record.timestamp ?? record.updatedAt ?? record.updated_at),
    receivedAt: input.receivedAt,
    bids,
    asks,
    ...(input.feeBps !== undefined ? { feeBps: input.feeBps, staticFeeApproved: true } : {}),
    ...(input.feeBps === undefined && input.venueFeeBps !== undefined ? {
      venueFeeBps: input.venueFeeBps,
      venueFeeModel: "PREDICT_MARKET_STATS" as const
    } : {}),
    settlementEvidenceSupported: true,
    missingFactors: [],
    blockers: [],
    streamResynced: true,
    metadata: {
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId ?? null,
      environment: input.environment
    }
  };
};

const unwrapRecord = (payload: unknown): Record<string, unknown> => {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  const result = asRecord(record.result);
  if (Object.keys(data).length > 0) return data;
  if (Object.keys(result).length > 0) return result;
  return record;
};

const normalizeLevels = (value: unknown): readonly NormalizedQuoteLevel[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (Array.isArray(entry) && entry.length >= 2) {
      return normalizeLevel(entry[0], entry[1]);
    }
    const record = asRecord(entry);
    return normalizeLevel(record.price ?? record.p, record.size ?? record.s ?? record.quantity);
  });
};

const normalizeLevel = (price: unknown, size: unknown): NormalizedQuoteLevel[] => {
  if (!isNumericLike(price) || !isNumericLike(size)) {
    return [];
  }
  return [{ price: String(price), size: String(size) }];
};

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const isNumericLike = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

const asDate = (value: unknown): Date | null => {
  if (typeof value === "number") return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};
