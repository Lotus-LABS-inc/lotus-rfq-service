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
  getMarketDetail?(marketId: string): Promise<unknown>;
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

    const marketDetail = await this.config.client.getMarketDetail?.(input.venueMarketId).catch(() => null);
    const executableMarketId = resolveLimitlessExecutableMarketId(input.venueMarketId, input.canonicalMarketId, marketDetail);
    const outcomeResolution = resolveLimitlessOutcome(input.venueOutcomeId, input.canonicalOutcomeId, marketDetail);
    const payload = await this.config.client.getOrderbook({
      marketId: executableMarketId,
      ...(outcomeResolution.venueOutcomeId ? { outcomeId: outcomeResolution.venueOutcomeId } : {})
    });
    const resolvedFeeBps = this.config.feeBps ?? await this.config.feeReader?.getFeeBps({
      marketSlug: executableMarketId
    });
    return normalizeLimitlessOrderbook({
      payload,
      venueMarketId: executableMarketId,
      venueOutcomeId: outcomeResolution.venueOutcomeId,
      outcomeSide: outcomeResolution.outcomeSide,
      receivedAt: this.now(),
      feeBps: resolvedFeeBps ?? undefined,
      approvedVenueMarketId: input.venueMarketId
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

  public async getMarketDetail(marketId: string): Promise<unknown> {
    const url = new URL(`/markets/${encodeURIComponent(marketId)}`, this.config.baseUrl);
    const response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Limitless market detail request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export const normalizeLimitlessOrderbook = (input: {
  payload: unknown;
  venueMarketId: string;
  approvedVenueMarketId?: string | undefined;
  venueOutcomeId?: string | undefined;
  outcomeSide?: "YES" | "NO" | undefined;
  receivedAt: Date;
  feeBps?: number | undefined;
}): NormalizedVenueQuoteSnapshot => {
  const record = unwrapOrderbookRecord(input.payload);
  const venueOutcomeId = input.venueOutcomeId ?? firstString(record.tokenId, record.token_id);
  const rawBids = normalizeLevels(record.bids ?? record.buy);
  const rawAsks = normalizeLevels(record.asks ?? record.sell);
  const bids = input.outcomeSide === "NO" ? invertBinaryLevels(rawAsks, "desc") : rawBids;
  const asks = input.outcomeSide === "NO" ? invertBinaryLevels(rawBids, "asc") : rawAsks;
  return {
    venue: "LIMITLESS",
    venueMarketId: input.venueMarketId,
    ...(venueOutcomeId ? { venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: bids.length > 1 && asks.length > 1 ? "FULL_DEPTH_REST" : "TOP_OF_BOOK_REST",
    sourceTimestamp: asDate(record.timestamp ?? record.updated_at ?? record.updatedAt),
    receivedAt: input.receivedAt,
    bids,
    asks,
    ...(input.feeBps !== undefined ? { feeBps: input.feeBps } : {}),
    limitlessMarketType: inferLimitlessMarketType(record),
    staticFeeApproved: input.feeBps !== undefined,
    settlementEvidenceSupported: true,
    missingFactors: [],
    blockers: [],
    streamResynced: true,
    metadata: {
      approvedVenueMarketId: input.approvedVenueMarketId ?? input.venueMarketId,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: venueOutcomeId ?? null,
      ...(input.outcomeSide ? { outcomeSide: input.outcomeSide } : {})
    }
  };
};

const inferLimitlessMarketType = (record: Record<string, unknown>): "amm" | "clob" => {
  const tradeType = typeof record.tradeType === "string" ? record.tradeType.toLowerCase() : "";
  const marketType = typeof record.marketType === "string" ? record.marketType.toLowerCase() : "";
  return tradeType === "amm" || marketType === "amm" ? "amm" : "clob";
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

const resolveLimitlessOutcome = (
  configuredOutcomeId: string | undefined,
  canonicalOutcomeId: string | undefined,
  marketDetail: unknown
): { venueOutcomeId?: string | undefined; outcomeSide?: "YES" | "NO" | undefined } => {
  const tokens = asRecord(asRecord(marketDetail).tokens);
  const yes = firstString(tokens.yes, tokens.YES, tokens.Yes);
  const no = firstString(tokens.no, tokens.NO, tokens.No);
  const normalizedCanonical = canonicalOutcomeId?.trim().toUpperCase();
  if (configuredOutcomeId) {
    return {
      venueOutcomeId: configuredOutcomeId,
      ...(yes && configuredOutcomeId === yes ? { outcomeSide: "YES" as const } : {}),
      ...(no && configuredOutcomeId === no ? { outcomeSide: "NO" as const } : {}),
      ...(!yes && !no && normalizedCanonical === "YES" ? { outcomeSide: "YES" as const } : {}),
      ...(!yes && !no && normalizedCanonical === "NO" ? { outcomeSide: "NO" as const } : {})
    };
  }
  if (normalizedCanonical === "YES" && yes) {
    return { venueOutcomeId: yes, outcomeSide: "YES" };
  }
  if (normalizedCanonical === "NO" && no) {
    return { venueOutcomeId: no, outcomeSide: "NO" };
  }
  if (normalizedCanonical === "YES" || normalizedCanonical === "NO") {
    return { outcomeSide: normalizedCanonical };
  }
  return {};
};

const resolveLimitlessExecutableMarketId = (
  approvedMarketId: string,
  canonicalMarketId: string,
  marketDetail: unknown
): string => {
  const detail = asRecord(marketDetail);
  const children = Array.isArray(detail.markets) ? detail.markets.map(asRecord) : [];
  if (children.length === 0) {
    return approvedMarketId;
  }

  const hints = candidateHints(canonicalMarketId);
  const exactMatches = children.filter((child) => {
    const labels = [
      child.slug,
      child.title,
      child.proxyTitle,
      child.conditionId,
      child.id
    ].flatMap((value) => normalizedAliases(value));
    return labels.some((label) => hints.has(label));
  });

  if (exactMatches.length !== 1) {
    return approvedMarketId;
  }

  return firstString(
    exactMatches[0]?.slug,
    exactMatches[0]?.conditionId,
    exactMatches[0]?.id
  ) ?? approvedMarketId;
};

const candidateHints = (canonicalMarketId: string): ReadonlySet<string> => {
  const rawParts = canonicalMarketId.split("|").flatMap((part) => part.split(":"));
  const hints = new Set<string>();
  for (const part of rawParts) {
    for (const alias of normalizedAliases(part)) {
      hints.add(alias);
    }
  }
  return hints;
};

const normalizedAliases = (value: unknown): readonly string[] => {
  const text = firstString(value);
  if (!text) {
    return [];
  }
  const compact = normalizeLabel(text);
  const withoutNumericSuffix = normalizeLabel(text.replace(/-\d{10,}$/, ""));
  const words = normalizeLabel(text.replace(/[_-]+/g, " "));
  return [...new Set([compact, withoutNumericSuffix, words].filter((entry) => entry.length > 0))];
};

const normalizeLabel = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

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
