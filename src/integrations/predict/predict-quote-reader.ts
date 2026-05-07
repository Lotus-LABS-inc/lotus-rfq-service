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
  client: Pick<PredictClient, "getMarketOrderbook" | "getMarketStatistics"> & Partial<Pick<PredictClient, "getMarketById">>;
  streamCache: QuoteSnapshotCache;
  environment: PredictEnvironment;
  now?: () => Date;
  feeBps?: number | undefined;
}

export class PredictQuoteReader implements VenueQuoteSnapshotReader {
  public readonly venue = "PREDICT_FUN";
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

    const [orderbook, stats, marketDetail] = await Promise.all([
      this.config.client.getMarketOrderbook(input.venueMarketId),
      this.config.client.getMarketStatistics(input.venueMarketId).catch(() => null),
      this.config.client.getMarketById?.(input.venueMarketId).catch(() => null) ?? Promise.resolve(null)
    ]);
    const statsRecord = asRecord(stats);
    const venueFeeBps = this.config.feeBps ?? parseOptionalNumber(statsRecord.feeRateBps ?? statsRecord.fee_rate_bps);
    const outcomeResolution = resolvePredictOutcome(input.venueOutcomeId, input.canonicalOutcomeId, marketDetail);
    return normalizePredictOrderbook({
      payload: orderbook,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: outcomeResolution.venueOutcomeId,
      outcomeSide: outcomeResolution.outcomeSide,
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
  outcomeSide?: "YES" | "NO" | undefined;
  receivedAt: Date;
  environment: PredictEnvironment;
  feeBps?: number | undefined;
  venueFeeBps?: number | undefined;
}): NormalizedVenueQuoteSnapshot => {
  const record = unwrapRecord(input.payload);
  const rawBids = normalizeLevels(record.bids);
  const rawAsks = normalizeLevels(record.asks);
  const bids = input.outcomeSide === "NO" ? invertBinaryLevels(rawAsks, "desc") : rawBids;
  const asks = input.outcomeSide === "NO" ? invertBinaryLevels(rawBids, "asc") : rawAsks;
  const blockers = !input.venueOutcomeId || !looksLikeNumericId(input.venueOutcomeId)
    ? ["PREDICT_FUN_TOKEN_ID_MISSING"]
    : [];
  return {
    venue: "PREDICT_FUN",
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
    blockers,
    streamResynced: true,
    metadata: {
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId ?? null,
      environment: input.environment,
      ...(input.outcomeSide ? { outcomeSide: input.outcomeSide } : {})
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

const invertBinaryLevels = (
  levels: readonly NormalizedQuoteLevel[],
  sort: "asc" | "desc"
): readonly NormalizedQuoteLevel[] =>
  levels
    .map((level) => ({
      price: Number((1 - Number(level.price)).toFixed(12)),
      size: level.size
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && level.price < 1)
    .sort((left, right) => sort === "asc" ? left.price - right.price : right.price - left.price)
    .map((level) => ({ price: String(level.price), size: level.size }));

const resolvePredictOutcome = (
  configuredOutcomeId: string | undefined,
  canonicalOutcomeId: string | undefined,
  marketDetail: unknown
): { venueOutcomeId?: string | undefined; outcomeSide?: "YES" | "NO" | undefined } => {
  const rawOutcomes = asRecord(marketDetail).outcomes;
  const outcomes: readonly unknown[] = Array.isArray(rawOutcomes) ? rawOutcomes : [];
  const normalizedCanonical = canonicalOutcomeId?.trim().toUpperCase();
  const yes = findOutcomeToken(outcomes, "YES");
  const no = findOutcomeToken(outcomes, "NO");
  if (configuredOutcomeId && looksLikeNumericId(configuredOutcomeId)) {
    return {
      venueOutcomeId: configuredOutcomeId,
      ...(yes && configuredOutcomeId === yes ? { outcomeSide: "YES" as const } : {}),
      ...(no && configuredOutcomeId === no ? { outcomeSide: "NO" as const } : {})
    };
  }
  if (normalizedCanonical === "YES" && yes) {
    return { venueOutcomeId: yes, outcomeSide: "YES" };
  }
  if (normalizedCanonical === "NO" && no) {
    return { venueOutcomeId: no, outcomeSide: "NO" };
  }
  return {};
};

const findOutcomeToken = (outcomes: readonly unknown[], label: "YES" | "NO"): string | undefined => {
  const matches = outcomes.flatMap((outcome) => {
    const record = asRecord(outcome);
    const outcomeLabel = firstString(record.label, record.name, record.title, record.outcomeType, record.outcome_type);
    const token = firstString(record.tokenId, record.token_id, record.onChainId, record.on_chain_id, record.id, record.indexSet);
    return outcomeLabel && normalizeOutcomeLabel(outcomeLabel) === label && token ? [token] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
};

const looksLikeNumericId = (value: string): boolean => /^\d+$/.test(value);

const normalizeOutcomeLabel = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

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

const firstString = (...values: readonly unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
};

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
