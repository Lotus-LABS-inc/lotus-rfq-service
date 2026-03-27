import {
  buildStableTextId,
  buildStableUuid,
  normalizeCategory,
  normalizeFreeText,
  type CanonicalOutcomeDefinition
} from "../../canonical/canonicalization-types.js";
import type { CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import type { PredictClient } from "./predict-client.js";
import type {
  PredictEnvironment,
  PredictNormalizedLastSale,
  PredictNormalizedMarket,
  PredictNormalizedMarketStatistics
} from "./predict-types.js";

export interface PredictMarketAdapterConfig {
  client: Pick<PredictClient, "getMarkets" | "getMarketById" | "getMarketStatistics" | "getMarketLastSale">;
  environment: PredictEnvironment;
  metadataVersion: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const normalizeOutcomes = (market: Record<string, unknown>): PredictNormalizedMarket["outcomes"] => {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  return outcomes
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
    .map((outcome, index) => ({
      id: String(outcome.id ?? index),
      label: typeof outcome.label === "string" ? outcome.label : typeof outcome.title === "string" ? outcome.title : `Outcome ${index + 1}`,
      tokenId:
        typeof outcome.tokenId === "string" ? outcome.tokenId :
        typeof outcome.token_id === "string" ? outcome.token_id :
        null,
      outcomeType:
        typeof outcome.outcomeType === "string" ? outcome.outcomeType :
        typeof outcome.outcome_type === "string" ? outcome.outcome_type :
        null,
      raw: outcome
    }));
};

const normalizeStatistics = (payload: Record<string, unknown>): PredictNormalizedMarketStatistics => ({
  volume: typeof payload.volume === "string" || typeof payload.volume === "number" ? String(payload.volume) : null,
  liquidity: typeof payload.liquidity === "string" || typeof payload.liquidity === "number" ? String(payload.liquidity) : null,
  openInterest:
    typeof payload.openInterest === "string" || typeof payload.openInterest === "number"
      ? String(payload.openInterest)
      : typeof payload.open_interest === "string" || typeof payload.open_interest === "number"
        ? String(payload.open_interest)
        : null,
  feeRateBps:
    typeof payload.feeRateBps === "string" || typeof payload.feeRateBps === "number"
      ? String(payload.feeRateBps)
      : typeof payload.fee_rate_bps === "string" || typeof payload.fee_rate_bps === "number"
        ? String(payload.fee_rate_bps)
        : null,
  raw: payload
});

const toDate = (value: unknown): Date | null => {
  if (typeof value === "number") {
    const millis = value >= 1_000_000_000_000 ? value : value * 1_000;
    return new Date(millis);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  return null;
};

const normalizeLastSale = (payload: Record<string, unknown>): PredictNormalizedLastSale => ({
  price: typeof payload.price === "string" || typeof payload.price === "number" ? String(payload.price) : null,
  size: typeof payload.size === "string" || typeof payload.size === "number" ? String(payload.size) : null,
  timestamp: toDate(payload.timestamp ?? payload.matchedAt ?? payload.matched_at),
  raw: payload
});

const buildCanonicalOutcomes = (market: PredictNormalizedMarket): readonly CanonicalOutcomeDefinition[] =>
  market.outcomes.map((outcome) => ({
    id: outcome.id,
    label: outcome.label,
    tokenId: outcome.tokenId,
    outcomeType: outcome.outcomeType,
    metadata: {
      venue: "PREDICT",
      environment: market.environment
    }
  }));

export class PredictMarketAdapter {
  public constructor(private readonly config: PredictMarketAdapterConfig) {}

  public async listMarkets(): Promise<readonly PredictNormalizedMarket[]> {
    const markets = await this.config.client.getMarkets();
    return Promise.all(markets.map((market) => this.enrichMarket(asRecord(market))));
  }

  public async getMarketById(marketId: string): Promise<PredictNormalizedMarket> {
    const market = await this.config.client.getMarketById(marketId);
    return this.enrichMarket(asRecord(market));
  }

  public buildCanonicalSeed(input: {
    market: PredictNormalizedMarket;
    canonicalCategory?: string;
    canonicalEventId?: string;
    canonicalMarketId?: string;
  }): CuratedCanonicalGraphSeed {
    const normalizedTitle = normalizeFreeText(input.market.title);
    const category = normalizeCategory(input.canonicalCategory ?? input.market.categories[0] ?? "OTHER");
    const outcomes = buildCanonicalOutcomes(input.market);
    const eventId = input.canonicalEventId ?? buildStableTextId("predict-event-", `${this.config.environment}:${normalizedTitle}`);
    const marketId = input.canonicalMarketId ?? buildStableTextId("predict-market-", `${this.config.environment}:${input.market.venueMarketId}`);

    return {
      canonicalEventId: eventId,
      canonicalMarketId: marketId,
      canonicalCategory: category,
      venue: "PREDICT",
      venueMarketId: input.market.venueMarketId,
      title: input.market.title,
      description: input.market.description,
      marketType: "CLOB_BINARY",
      marketClass: outcomes.length === 2 ? "BINARY" : "UNKNOWN",
      outcomes,
      outcomeSchema: {
        marketShape: outcomes.length === 2 ? "binary" : "unknown",
        outcomeLabels: outcomes.map((outcome) => outcome.label)
      },
      topics: [...input.market.categories, ...input.market.tags],
      publishedAt: null,
      expiresAt: null,
      resolvesAt: null,
      fees: {
        takerFeeBps: input.market.statistics?.feeRateBps ?? null
      },
      feeModel: "predict_documented_market_fees",
      resolutionSource: "predict_market_metadata",
      resolutionTitle: input.market.title,
      resolutionRulesText: input.market.description,
      settlementType: "onchain",
      settlementLagHours: null,
      finalityLagHours: null,
      payoutTimingHours: null,
      network: this.config.environment === "mainnet" ? "BNB_MAINNET" : "BNB_TESTNET",
      chain: "BNB",
      rawSourcePayload: input.market.raw,
      normalizedPayload: {
        environment: input.market.environment,
        marketId: input.market.venueMarketId,
        chainId: input.market.chainId,
        contractAddress: input.market.contractAddress,
        tokenId: input.market.tokenId
      },
      mappingLineage: ["predict-market-adapter"],
      sourceMetadataVersion: this.config.metadataVersion,
      eventPropositionKey: buildStableUuid(`predict-proposition:${this.config.environment}:${normalizedTitle}`),
      eventTitle: input.market.title,
      eventNormalizedPropositionText: normalizedTitle,
      eventSourceHints: {
        environment: input.market.environment,
        marketId: input.market.venueMarketId
      },
      propositionHints: {
        normalizedPropositionText: normalizedTitle,
        groupingHints: {
          environment: input.market.environment,
          categories: input.market.categories
        }
      },
      executableDisplayName: input.market.title,
      executableMetadata: {
        simulationOnly: true,
        venueType: "clob_orderbook",
        environment: input.market.environment
      }
    };
  }

  private async enrichMarket(market: Record<string, unknown>): Promise<PredictNormalizedMarket> {
    const marketId = String(market.id);
    const [statistics, lastSale] = await Promise.all([
      this.config.client.getMarketStatistics(marketId).then((value) => normalizeStatistics(asRecord(value))).catch(() => null),
      this.config.client.getMarketLastSale(marketId).then((value) => normalizeLastSale(asRecord(value))).catch(() => null)
    ]);

    return {
      venue: "PREDICT",
      environment: this.config.environment,
      venueMarketId: marketId,
      title: typeof market.title === "string" ? market.title : marketId,
      description: typeof market.description === "string" ? market.description : null,
      status: typeof market.status === "string" ? market.status : typeof market.state === "string" ? market.state : null,
      categories: [
        ...(typeof market.category === "string" ? [market.category] : []),
        ...(Array.isArray(market.categories) ? market.categories.filter((value): value is string => typeof value === "string") : [])
      ],
      tags: Array.isArray(market.tags) ? market.tags.filter((value): value is string => typeof value === "string") : [],
      chainId:
        typeof market.chainId === "string" || typeof market.chainId === "number"
          ? String(market.chainId)
          : typeof market.chain_id === "string" || typeof market.chain_id === "number"
            ? String(market.chain_id)
            : null,
      contractAddress:
        typeof market.contractAddress === "string"
          ? market.contractAddress
          : typeof market.contract_address === "string"
            ? market.contract_address
            : null,
      tokenId:
        typeof market.tokenId === "string" ? market.tokenId :
        typeof market.token_id === "string" ? market.token_id :
        null,
      outcomes: normalizeOutcomes(market),
      statistics,
      lastSale,
      sourceMetadataVersion: this.config.metadataVersion,
      raw: market
    };
  }
}
