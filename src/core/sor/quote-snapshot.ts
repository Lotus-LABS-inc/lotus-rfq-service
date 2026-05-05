import Decimal from "decimal.js";

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

export interface VenueQuoteMapping {
  venue: string;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
}

export interface VenueQuoteMappingResolver {
  resolve(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMapping[]>;
}

export interface CalculatedVenueQuoteSnapshot {
  venue: string;
  availableSize: number;
  quotedPrice: number;
  fees: Readonly<Record<string, number>>;
  latencyMs: number;
  fillProb: number;
  metadata: Readonly<Record<string, unknown>>;
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

  public constructor(
    readers: readonly VenueQuoteSnapshotReader[],
    private readonly mappingResolver: VenueQuoteMappingResolver,
    private readonly now: () => Date = () => new Date()
  ) {
    this.readerByVenue = new Map(readers.map((reader) => [reader.venue.toUpperCase(), reader]));
  }

  public async getCalculatedSnapshots(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    side: "buy" | "sell";
    quantity: number;
  }): Promise<readonly CalculatedVenueQuoteSnapshot[]> {
    const mappings = await this.mappingResolver.resolve(input);
    const results = await Promise.all(mappings.map(async (mapping): Promise<CalculatedVenueQuoteSnapshot | null> => {
      const reader = this.readerByVenue.get(mapping.venue.toUpperCase());
      if (!reader) {
        return null;
      }
      const snapshot = await reader.getQuoteSnapshot({
        canonicalMarketId: input.canonicalMarketId,
        ...(input.canonicalOutcomeId ? { canonicalOutcomeId: input.canonicalOutcomeId } : {}),
        venueMarketId: mapping.venueMarketId,
        ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {}),
        side: input.side,
        quantity: input.quantity
      });
      if (!snapshot) {
        return null;
      }
      const calculated = calculateVenueQuote({
        snapshot,
        side: input.side,
        amount: input.quantity,
        now: this.now()
      });
      if (!calculated.ok) {
        return null;
      }
      const output: CalculatedVenueQuoteSnapshot = {
        venue: calculated.venue,
        availableSize: calculated.availableSize,
        quotedPrice: calculated.price,
        fees: {
          ...(calculated.feeBps !== undefined ? { provider_fee_bps: calculated.feeBps } : {}),
          ...(calculated.fixedFee !== undefined ? { fixed_fee: calculated.fixedFee } : {})
        },
        latencyMs: calculated.freshnessMs,
        fillProb: calculated.liquidityScore,
        metadata: {
          source: "venue_quote_snapshot",
          venue: calculated.venue,
          quoteQuality: calculated.quoteQuality,
          quoteSource: calculated.source,
          freshnessMs: calculated.freshnessMs,
          spreadBps: calculated.spreadBps,
          slippageBps: calculated.slippageBps,
          liquidityScore: calculated.liquidityScore,
          confidencePenaltyBps: calculated.confidencePenaltyBps,
          missingFactors: calculated.missingFactors,
          blockers: calculated.blockers,
          settlementEvidenceSupported: calculated.settlementEvidenceSupported,
          ...calculated.metadata
        }
      };
      return output;
    }));
    return results.filter((result): result is CalculatedVenueQuoteSnapshot => result !== null);
  }
}

export class EnvVenueQuoteMappingResolver implements VenueQuoteMappingResolver {
  public constructor(private readonly rawJson: string | undefined) {}

  public async resolve(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly VenueQuoteMapping[]> {
    if (!this.rawJson || this.rawJson.trim().length === 0) {
      return [];
    }
    const parsed = JSON.parse(this.rawJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const record = parsed as Record<string, unknown>;
    const key = input.canonicalOutcomeId
      ? `${input.canonicalMarketId}|${input.canonicalOutcomeId}`
      : input.canonicalMarketId;
    const direct = normalizeMappings(record[key]);
    if (direct.length > 0) {
      return direct;
    }
    return normalizeMappings(record[input.canonicalMarketId]);
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
  if (bestBid === null || bestAsk === null) {
    blockers.push("BEST_BID_ASK_MISSING");
  }

  const bookSide = input.side === "buy" ? asks : bids;
  const fill = walkBook(bookSide, input.amount);
  if (fill.filledSize.lte(0)) {
    blockers.push("EXECUTABLE_DEPTH_MISSING");
  }
  if (fill.filledSize.lt(input.amount)) {
    blockers.push("NO_DEPTH_FOR_SIZE");
  }

  const weightedPrice = fill.filledSize.gt(0) ? fill.notional.div(fill.filledSize) : new Decimal(0);
  const topPrice = input.side === "buy" ? bestAsk : bestBid;
  const spreadBps = bestBid !== null && bestAsk !== null
    ? bps(new Decimal(bestAsk).minus(bestBid), new Decimal(bestBid).plus(bestAsk).div(2))
    : new Decimal(0);
  const slippageBps = topPrice === null
    ? new Decimal(0)
    : input.side === "buy"
      ? bps(weightedPrice.minus(topPrice), topPrice)
      : bps(new Decimal(topPrice).minus(weightedPrice), topPrice);
  if (input.snapshot.feeBps === undefined && !input.snapshot.staticFeeApproved) {
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
    settlementEvidenceSupported: input.snapshot.settlementEvidenceSupported,
    missingFactors: [...new Set(missingFactors)],
    blockers: [...new Set(blockers)],
    metadata: input.snapshot.metadata ?? {}
  };
};

const normalizeMappings = (value: unknown): readonly VenueQuoteMapping[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.venue !== "string" || typeof record.venueMarketId !== "string") {
      return [];
    }
    return [{
      venue: record.venue.toUpperCase(),
      venueMarketId: record.venueMarketId,
      ...(typeof record.venueOutcomeId === "string" ? { venueOutcomeId: record.venueOutcomeId } : {})
    }];
  });
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
