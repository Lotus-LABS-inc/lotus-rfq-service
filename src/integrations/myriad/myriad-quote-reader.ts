import Decimal from "decimal.js";
import type {
  NormalizedVenueQuoteSnapshot,
  QuoteSnapshotCache,
  VenueQuoteSnapshotReader,
  VenueQuoteSnapshotReaderInput
} from "../../core/sor/quote-snapshot.js";
import type { VenueFeeQuote } from "../../core/sor/venue-fees.js";
import type { MyriadClient } from "./myriad-client.js";

export interface MyriadQuoteReaderConfig {
  client: Pick<MyriadClient, "getMarketQuote"> & Partial<Pick<MyriadClient, "getMarket">>;
  streamCache: QuoteSnapshotCache;
  now?: () => Date;
}

export class MyriadQuoteReader implements VenueQuoteSnapshotReader {
  public readonly venue = "MYRIAD";
  private readonly now: () => Date;

  public constructor(private readonly config: MyriadQuoteReaderConfig) {
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

    const marketDetail = await this.config.client.getMarket?.({ idOrSlug: input.venueMarketId }).catch(() => null);
    const venueOutcomeId = resolveMyriadOutcome(input.venueOutcomeId, input.canonicalOutcomeId, marketDetail);
    const payload = await this.config.client.getMarketQuote({
      market_slug: input.venueMarketId,
      outcome_id: parseOutcomeId(venueOutcomeId),
      action: input.side,
      shares: input.quantity,
      slippage: 0.005
    });
    return normalizeMyriadQuote({
      payload,
      venueMarketId: input.venueMarketId,
      venueOutcomeId,
      side: input.side,
      quantity: input.quantity,
      receivedAt: this.now()
    });
  }
}

export const normalizeMyriadQuote = (input: {
  payload: unknown;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  side: "buy" | "sell";
  quantity: number;
  receivedAt: Date;
}): NormalizedVenueQuoteSnapshot => {
  const record = unwrapRecord(input.payload);
  const priceAverage = parseDecimal(record.price_average ?? record.priceAverage ?? record.price);
  const priceBefore = parseDecimal(record.price_before ?? record.priceBefore ?? priceAverage);
  const priceAfter = parseDecimal(record.price_after ?? record.priceAfter ?? priceAverage);
  const feeAmount = sumFees(record.fees);
  const price = priceAverage ?? new Decimal(0);
  const size = parseDecimal(record.shares) ?? new Decimal(input.quantity);
  const bids = [{ price: String(Decimal.min(priceBefore ?? price, price).toString()), size: size.toString() }];
  const asks = [{ price: String(Decimal.max(priceAfter ?? price, price).toString()), size: size.toString() }];
  return {
    venue: "MYRIAD",
    venueMarketId: input.venueMarketId,
    ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: "INDICATIVE_DEPTH",
    sourceTimestamp: null,
    receivedAt: input.receivedAt,
    bids,
    asks,
    ...(feeAmount !== null ? { feeQuote: buildMyriadFeeQuote(feeAmount, price, size) } : {}),
    settlementEvidenceSupported: true,
    missingFactors: feeAmount === null ? ["FEE_DISCOVERY"] : [],
    blockers: priceAverage === null ? ["MYRIAD_QUOTE_PRICE_MISSING"] : [],
    streamResynced: true,
    metadata: {
      venueMarketId: input.venueMarketId,
      venueOutcomeId: input.venueOutcomeId ?? null,
      quoteMode: "myriad_quote_endpoint"
    }
  };
};

const buildMyriadFeeQuote = (
  feeAmount: InstanceType<typeof Decimal>,
  price: InstanceType<typeof Decimal>,
  size: InstanceType<typeof Decimal>
): VenueFeeQuote => {
  const notional = price.times(size);
  return {
    feeModel: "MYRIAD_QUOTE_API",
    feeSource: "VENUE_API",
    feeAmount: feeAmount.toDecimalPlaces(12).toString(),
    effectiveFeeBps: notional.gt(0) ? Number(feeAmount.div(notional).times(10_000).toDecimalPlaces(12).toString()) : 0,
    confidence: "HIGH",
    appliesTo: "taker",
    paidIn: "ECONOMIC_EQUIVALENT_USDC"
  };
};

const parseOutcomeId = (value: string | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveMyriadOutcome = (
  configuredOutcomeId: string | undefined,
  canonicalOutcomeId: string | undefined,
  marketDetail: unknown
): string | undefined => {
  if (configuredOutcomeId) {
    return configuredOutcomeId;
  }
  if (!canonicalOutcomeId) {
    return undefined;
  }
  const rawOutcomes = asRecord(marketDetail).outcomes;
  const outcomes: readonly unknown[] = Array.isArray(rawOutcomes) ? rawOutcomes : [];
  const normalizedCanonical = normalizeOutcomeLabel(canonicalOutcomeId);
  const matches = outcomes.flatMap((outcome) => {
    const record = asRecord(outcome);
    const title = firstString(record.title, record.label, record.name);
    const id = firstString(record.id, record.outcomeId, record.outcome_id);
    return title && id && normalizeOutcomeLabel(title) === normalizedCanonical ? [id] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
};

const normalizeOutcomeLabel = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const sumFees = (value: unknown): InstanceType<typeof Decimal> | null => {
  const record = asRecord(value);
  const entries = Object.values(record).flatMap((entry) => {
    const parsed = parseDecimal(entry);
    return parsed === null ? [] : [parsed];
  });
  if (entries.length === 0) return null;
  return entries.reduce((sum, entry) => sum.plus(entry), new Decimal(0));
};

const parseDecimal = (value: unknown): InstanceType<typeof Decimal> | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.gte(0) ? parsed : null;
  } catch {
    return null;
  }
};

const unwrapRecord = (payload: unknown): Record<string, unknown> => {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  const result = asRecord(record.result);
  if (Object.keys(data).length > 0) return data;
  if (Object.keys(result).length > 0) return result;
  return record;
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
