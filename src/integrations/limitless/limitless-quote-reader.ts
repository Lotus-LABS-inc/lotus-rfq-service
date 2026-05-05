import type {
  NormalizedQuoteLevel,
  NormalizedVenueQuoteSnapshot,
  QuoteSnapshotCache,
  VenueQuoteSnapshotReader,
  VenueQuoteSnapshotReaderInput
} from "../../core/sor/quote-snapshot.js";
import type { LimitlessFeeReader } from "./limitless-fee-reader.js";

export interface LimitlessOrderbookClient {
  getOrderbook(input: {
    marketId: string;
    outcomeId?: string | undefined;
  }): Promise<unknown>;
}

export interface LimitlessQuoteReaderConfig {
  client: LimitlessOrderbookClient;
  streamCache: QuoteSnapshotCache;
  now?: () => Date;
  feeBps?: number | undefined;
  feeReader?: LimitlessFeeReader | undefined;
}

export class LimitlessQuoteReader implements VenueQuoteSnapshotReader {
  public readonly venue = "LIMITLESS";
  private readonly now: () => Date;

  public constructor(private readonly config: LimitlessQuoteReaderConfig) {
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

    const payload = await this.config.client.getOrderbook({
      marketId: input.venueMarketId,
      ...(input.venueOutcomeId ? { outcomeId: input.venueOutcomeId } : {})
    });
    const resolvedFeeBps = this.config.feeBps ?? await this.config.feeReader?.getFeeBps({
      marketSlug: input.venueMarketId
    });
    return normalizeLimitlessOrderbook({
      payload,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId,
      receivedAt: this.now(),
      feeBps: resolvedFeeBps ?? undefined
    });
  }
}

export class LimitlessRestOrderbookClient implements LimitlessOrderbookClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly config: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
  }) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async getOrderbook(input: { marketId: string; outcomeId?: string | undefined }): Promise<unknown> {
    const url = new URL(`/markets/${encodeURIComponent(input.marketId)}/orderbook`, this.config.baseUrl);
    if (input.outcomeId) {
      url.searchParams.set("outcomeId", input.outcomeId);
    }
    const response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Limitless orderbook request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export const normalizeLimitlessOrderbook = (input: {
  payload: unknown;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  receivedAt: Date;
  feeBps?: number | undefined;
}): NormalizedVenueQuoteSnapshot => {
  const record = unwrapOrderbookRecord(input.payload);
  const bids = normalizeLevels(record.bids ?? record.buy);
  const asks = normalizeLevels(record.asks ?? record.sell);
  return {
    venue: "LIMITLESS",
    venueMarketId: input.venueMarketId,
    ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: bids.length > 1 && asks.length > 1 ? "FULL_DEPTH_REST" : "TOP_OF_BOOK_REST",
    sourceTimestamp: asDate(record.timestamp ?? record.updated_at ?? record.updatedAt),
    receivedAt: input.receivedAt,
    bids,
    asks,
    ...(input.feeBps !== undefined ? { feeBps: input.feeBps } : {}),
    staticFeeApproved: input.feeBps !== undefined,
    settlementEvidenceSupported: true,
    missingFactors: input.feeBps === undefined ? ["FEE_DISCOVERY"] : [],
    blockers: [],
    streamResynced: true,
    metadata: { venueMarketId: input.venueMarketId, venueOutcomeId: input.venueOutcomeId ?? null }
  };
};

const unwrapOrderbookRecord = (payload: unknown): Record<string, unknown> => {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  const orderbook = asRecord(record.orderbook);
  if (Object.keys(orderbook).length > 0) {
    return orderbook;
  }
  if (Object.keys(data).length > 0) {
    return data;
  }
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

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const isNumericLike = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

const asDate = (value: unknown): Date | null => {
  if (typeof value === "number") {
    return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};
