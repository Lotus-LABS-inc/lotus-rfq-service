import type {
  NormalizedQuoteLevel,
  NormalizedVenueQuoteSnapshot,
  QuoteSnapshotCache,
  VenueQuoteSnapshotReader,
  VenueQuoteSnapshotReaderInput
} from "../../core/sor/quote-snapshot.js";
import type { OpinionClient } from "./opinion-client.js";

export interface OpinionQuoteReaderConfig {
  client: Pick<OpinionClient, "getTokenOrderbook">;
  streamCache: QuoteSnapshotCache;
  now?: () => Date;
  topicRate?: number | undefined;
  feeBps?: number | undefined;
}

export class OpinionQuoteReader implements VenueQuoteSnapshotReader {
  public readonly venue = "OPINION";
  private readonly now: () => Date;

  public constructor(private readonly config: OpinionQuoteReaderConfig) {
    this.now = config.now ?? (() => new Date());
  }

  public async getQuoteSnapshot(input: VenueQuoteSnapshotReaderInput): Promise<NormalizedVenueQuoteSnapshot | null> {
    const tokenId = input.venueOutcomeId ?? opinionExecutableTokenId(input.venueMarketId);
    const cached = this.config.streamCache.get({
      venue: this.venue,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: tokenId
    });
    if (cached?.source === "STREAM") {
      return cached;
    }

    const payload = await this.config.client.getTokenOrderbook({ tokenId });
    const apiTopicRate = parseOpinionTopicRate(payload);
    return normalizeOpinionOrderbook({
      payload,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: tokenId,
      receivedAt: this.now(),
      topicRate: this.config.topicRate ?? apiTopicRate ?? undefined,
      feeBps: this.config.feeBps
    });
  }
}

const opinionExecutableTokenId = (venueMarketId: string): string => {
  const numericPrefix = venueMarketId.match(/^(\d+)(?=[:_-])/);
  return numericPrefix?.[1] ?? venueMarketId;
};

export const normalizeOpinionOrderbook = (input: {
  payload: unknown;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  receivedAt: Date;
  topicRate?: number | undefined;
  feeBps?: number | undefined;
}): NormalizedVenueQuoteSnapshot => {
  const record = unwrapRecord(input.payload);
  const bids = normalizeLevels(record.bids);
  const asks = normalizeLevels(record.asks);
  const blockers = bids.length === 0 && asks.length === 0 ? ["QUOTE_PROVIDER_EMPTY_BOOK"] : [];
  const missingFactors = [
    ...(input.feeBps === undefined && input.topicRate === undefined ? ["FEE_DISCOVERY"] : []),
    ...(bids.length === 0 && asks.length > 0 ? ["BID_DEPTH_MISSING"] : []),
    ...(asks.length === 0 && bids.length > 0 ? ["ASK_DEPTH_MISSING"] : [])
  ];
  return {
    venue: "OPINION",
    venueMarketId: input.venueMarketId,
    ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: bids.length > 1 && asks.length > 1 ? "FULL_DEPTH_REST" : "TOP_OF_BOOK_REST",
    sourceTimestamp: asDate(record.timestamp ?? record.updatedAt ?? record.updated_at),
    receivedAt: input.receivedAt,
    bids,
    asks,
    ...(input.feeBps !== undefined ? { feeBps: input.feeBps, staticFeeApproved: true } : {}),
    ...(input.feeBps === undefined && input.topicRate !== undefined ? { opinionTopicRate: input.topicRate } : {}),
    settlementEvidenceSupported: true,
    missingFactors,
    blockers,
    streamResynced: true,
    metadata: {
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId ?? null,
      topicRate: input.topicRate ?? null,
      topicRateSource: input.topicRate !== undefined ? "api_or_config" : null
    }
  };
};

export const parseOpinionTopicRate = (payload: unknown): number | null => {
  const candidates = collectTopicRateCandidates(payload);
  for (const candidate of candidates) {
    const parsed = parseNonNegativeNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const unwrapRecord = (payload: unknown): Record<string, unknown> => {
  const record = asRecord(payload);
  const result = asRecord(record.result);
  const data = asRecord(record.data);
  if (Object.keys(result).length > 0) return result;
  if (Object.keys(data).length > 0) return data;
  return record;
};

const collectTopicRateCandidates = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value.flatMap(collectTopicRateCandidates);
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return [];
  }
  const candidates: unknown[] = [
    record.topic_rate,
    record.topicRate,
    record.topicFeeRate,
    record.topic_fee_rate,
    record.feeTopicRate,
    record.fee_topic_rate
  ];
  for (const key of ["result", "data", "market", "token", "orderbook", "fee", "fees", "feeConfig", "fee_config"]) {
    candidates.push(...collectTopicRateCandidates(record[key]));
  }
  return candidates;
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

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const isNumericLike = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

const parseNonNegativeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};

const asDate = (value: unknown): Date | null => {
  if (typeof value === "number") return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};
