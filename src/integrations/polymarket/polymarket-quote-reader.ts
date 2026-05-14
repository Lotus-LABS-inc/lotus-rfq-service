import type {
  NormalizedQuoteLevel,
  NormalizedVenueQuoteSnapshot,
  VenueQuoteSnapshotReader,
  VenueQuoteSnapshotReaderInput,
  QuoteSnapshotCache
} from "../../core/sor/quote-snapshot.js";
import type { PolymarketFeeReader } from "./polymarket-fee-reader.js";
import { PolymarketGammaClient, type PolymarketGammaMarket } from "./polymarket-gamma-client.js";

export interface PolymarketOrderbookClient {
  getOrderbook(input: {
    tokenId: string;
    marketId: string;
  }): Promise<unknown>;
}

export interface PolymarketQuoteReaderConfig {
  client: PolymarketOrderbookClient;
  streamCache: QuoteSnapshotCache;
  now?: () => Date;
  feeBps?: number | undefined;
  feeReader?: PolymarketFeeReader | undefined;
  metadataClient?: Pick<PolymarketGammaClient, "getMarketByIdentifier"> | undefined;
}

export class PolymarketQuoteReader implements VenueQuoteSnapshotReader {
  public readonly venue = "POLYMARKET";
  private readonly now: () => Date;

  public constructor(private readonly config: PolymarketQuoteReaderConfig) {
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

    const resolvedOutcome = await this.resolveOutcomeToken(input);
    let payload: unknown;
    try {
      payload = await this.config.client.getOrderbook({
        marketId: input.venueMarketId,
        tokenId: resolvedOutcome.venueOutcomeId
      });
    } catch (error) {
      const indicativeSnapshot = await this.getIndicativeMetadataSnapshot(input, resolvedOutcome);
      if (indicativeSnapshot) {
        return indicativeSnapshot;
      }
      throw error;
    }
    const feeRate = this.config.feeBps === undefined
      ? await this.config.feeReader?.getFeeRate({ conditionId: input.venueMarketId })
      : null;
    return normalizePolymarketOrderbook({
      payload,
      venueMarketId: input.venueMarketId,
      venueOutcomeId: resolvedOutcome.venueOutcomeId,
      receivedAt: this.now(),
      feeBps: this.config.feeBps,
      polymarketFeeRate: feeRate ?? undefined,
      polymarketCategory: inferPolymarketCategory(input.canonicalMarketId),
      outcomeLabel: resolvedOutcome.outcomeLabel
    });
  }

  private async resolveOutcomeToken(input: VenueQuoteSnapshotReaderInput): Promise<{
    venueOutcomeId: string;
    outcomeLabel?: string | undefined;
  }> {
    if (input.venueOutcomeId) {
      return { venueOutcomeId: input.venueOutcomeId };
    }
    if (!this.config.metadataClient) {
      throw new Error("POLYMARKET_CLOB_TOKEN_ID_MISSING");
    }
    const markets = await this.config.metadataClient.getMarketByIdentifier(input.venueMarketId);
    const token = resolveOutcomeTokenFromGammaMarkets(markets, input.canonicalOutcomeId);
    if (!token) {
      throw new Error("POLYMARKET_CLOB_TOKEN_ID_MISSING");
    }
    return token;
  }

  private async getIndicativeMetadataSnapshot(
    input: VenueQuoteSnapshotReaderInput,
    resolvedOutcome: { venueOutcomeId: string; outcomeLabel?: string | undefined }
  ): Promise<NormalizedVenueQuoteSnapshot | null> {
    if (!this.config.metadataClient) {
      return null;
    }
    try {
      const markets = await this.config.metadataClient.getMarketByIdentifier(input.venueMarketId);
      const indicative = resolveIndicativePriceFromGammaMarkets(markets, resolvedOutcome, input.canonicalOutcomeId);
      if (!indicative) {
        return null;
      }
      return normalizePolymarketIndicativeMetadata({
        venueMarketId: input.venueMarketId,
        venueOutcomeId: resolvedOutcome.venueOutcomeId,
        receivedAt: this.now(),
        feeBps: this.config.feeBps,
        polymarketCategory: inferPolymarketCategory(input.canonicalMarketId),
        outcomeLabel: indicative.outcomeLabel,
        price: indicative.price,
        marketStatus: indicative.marketStatus
      });
    } catch {
      return null;
    }
  }
}

export class PolymarketRestOrderbookClient implements PolymarketOrderbookClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly config: {
    clobHost: string;
    fetchImpl?: typeof fetch;
  }) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async getOrderbook(input: { tokenId: string; marketId: string }): Promise<unknown> {
    const url = new URL("/book", this.config.clobHost);
    url.searchParams.set("token_id", input.tokenId);
    const response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Polymarket orderbook request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export const normalizePolymarketOrderbook = (input: {
  payload: unknown;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  receivedAt: Date;
  feeBps?: number | undefined;
  polymarketFeeRate?: number | undefined;
  polymarketCategory?: string | undefined;
  outcomeLabel?: string | undefined;
}): NormalizedVenueQuoteSnapshot => {
  const record = asRecord(input.payload);
  const bids = normalizeLevels(record.bids);
  const asks = normalizeLevels(record.asks);
  return {
    venue: "POLYMARKET",
    venueMarketId: input.venueMarketId,
    ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: bids.length > 1 && asks.length > 1 ? "FULL_DEPTH_REST" : "TOP_OF_BOOK_REST",
    sourceTimestamp: asDate(record.timestamp ?? record.updated_at ?? record.updatedAt),
    receivedAt: input.receivedAt,
    bids,
    asks,
    ...(input.feeBps !== undefined ? { feeBps: input.feeBps } : {}),
    ...(input.polymarketFeeRate !== undefined ? { polymarketFeeRate: input.polymarketFeeRate } : {}),
    ...(input.polymarketCategory ? { polymarketCategory: input.polymarketCategory } : {}),
    staticFeeApproved: input.feeBps !== undefined,
    settlementEvidenceSupported: true,
    missingFactors: [],
    blockers: [],
    streamResynced: true,
    metadata: {
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId ?? null,
      outcomeLabel: input.outcomeLabel ?? null
    }
  };
};

export const normalizePolymarketIndicativeMetadata = (input: {
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  receivedAt: Date;
  feeBps?: number | undefined;
  polymarketCategory?: string | undefined;
  outcomeLabel?: string | undefined;
  price: string;
  marketStatus: Readonly<Record<string, unknown>>;
}): NormalizedVenueQuoteSnapshot => ({
  venue: "POLYMARKET",
  venueMarketId: input.venueMarketId,
  ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
  source: "REST",
  quoteQuality: "INDICATIVE_DEPTH",
  sourceTimestamp: input.receivedAt,
  receivedAt: input.receivedAt,
  bids: [{ price: input.price, size: "0" }],
  asks: [{ price: input.price, size: "0" }],
  ...(input.feeBps !== undefined ? { feeBps: input.feeBps } : {}),
  ...(input.polymarketCategory ? { polymarketCategory: input.polymarketCategory } : {}),
  staticFeeApproved: input.feeBps !== undefined,
  settlementEvidenceSupported: true,
  missingFactors: ["ORDERBOOK_DEPTH"],
  blockers: ["ORDERBOOK_UNAVAILABLE_DISPLAY_ONLY"],
  streamResynced: true,
  metadata: {
    venueMarketId: input.venueMarketId,
    venueOutcomeId: input.venueOutcomeId ?? null,
    outcomeLabel: input.outcomeLabel ?? null,
    displayOnly: true,
    marketStatus: input.marketStatus
  }
});

export const resolveOutcomeTokenFromGammaMarkets = (
  markets: readonly PolymarketGammaMarket[],
  canonicalOutcomeId?: string | undefined
): { venueOutcomeId: string; outcomeLabel?: string | undefined } | null => {
  if (!canonicalOutcomeId || markets.length !== 1) {
    return null;
  }
  const outcomes = extractGammaOutcomes(markets[0]?.raw);
  const wanted = normalizeOutcomeLabel(canonicalOutcomeId);
  const matches = outcomes.filter((outcome) => normalizeOutcomeLabel(outcome.label) === wanted);
  if (matches.length !== 1) {
    return null;
  }
  return { venueOutcomeId: matches[0]!.tokenId, outcomeLabel: matches[0]!.label };
};

export const resolveIndicativePriceFromGammaMarkets = (
  markets: readonly PolymarketGammaMarket[],
  resolvedOutcome: { venueOutcomeId: string; outcomeLabel?: string | undefined },
  canonicalOutcomeId?: string | undefined
): {
  price: string;
  outcomeLabel?: string | undefined;
  marketStatus: Readonly<Record<string, unknown>>;
} | null => {
  for (const market of markets) {
    const outcomes = extractGammaOutcomePrices(market.raw);
    const outcome = outcomes.find((entry) =>
      entry.tokenId === resolvedOutcome.venueOutcomeId ||
      normalizeOutcomeLabel(entry.label) === normalizeOutcomeLabel(resolvedOutcome.outcomeLabel ?? canonicalOutcomeId ?? "")
    );
    if (!outcome || !isNumericLike(outcome.price)) {
      continue;
    }
    return {
      price: String(outcome.price),
      outcomeLabel: outcome.label,
      marketStatus: {
        active: market.raw.active ?? null,
        closed: market.raw.closed ?? null,
        acceptingOrders: market.raw.accepting_orders ?? market.raw.acceptingOrders ?? null,
        enableOrderBook: market.raw.enable_order_book ?? market.raw.enableOrderBook ?? null,
        marketSlug: market.marketSlug ?? null,
        conditionId: market.conditionId
      }
    };
  }
  return null;
};

const inferPolymarketCategory = (canonicalMarketId: string): string | undefined => {
  const firstSegment = canonicalMarketId.split("|", 1)[0]?.split(":", 2).pop();
  return firstSegment && firstSegment.length > 0 ? firstSegment.toUpperCase() : undefined;
};

const extractGammaOutcomes = (raw: Record<string, unknown> | undefined): Array<{ label: string; tokenId: string }> => {
  const outcomes = Array.isArray(raw?.outcomes) ? raw.outcomes : [];
  return outcomes.flatMap((entry) => {
    const record = asRecord(entry);
    const label = firstString(record.label, record.outcome, record.name, record.title);
    const tokenId = firstString(record.token_id, record.tokenId, record.id);
    return label && tokenId ? [{ label, tokenId }] : [];
  });
};

const extractGammaOutcomePrices = (raw: Record<string, unknown> | undefined): Array<{ label: string; tokenId?: string | undefined; price: string }> => {
  const labels = parseStringArray(raw?.outcomes);
  const tokenIds = parseStringArray(raw?.clobTokenIds, raw?.clob_token_ids);
  const prices = parseStringArray(raw?.outcomePrices, raw?.outcome_prices);
  return labels.flatMap((label, index) => {
    const price = prices[index];
    if (!price || !isNumericLike(price)) {
      return [];
    }
    return [{
      label,
      ...(tokenIds[index] ? { tokenId: tokenIds[index] } : {}),
      price
    }];
  });
};

const normalizeOutcomeLabel = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const normalizeLevels = (value: unknown): readonly NormalizedQuoteLevel[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (Array.isArray(entry) && entry.length >= 2) {
      return normalizeLevel(entry[0], entry[1]);
    }
    const record = asRecord(entry);
    return normalizeLevel(record.price ?? record.p, record.size ?? record.s);
  });
};

const normalizeLevel = (price: unknown, size: unknown): NormalizedQuoteLevel[] => {
  if (!isNumericLike(price) || !isNumericLike(size)) {
    return [];
  }
  return [{ price: String(price), size: String(size) }];
};

const parseStringArray = (...values: readonly unknown[]): string[] => {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
        }
      } catch {
        return [];
      }
    }
  }
  return [];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

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
