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
      id: String(outcome.id ?? outcome.indexSet ?? index),
      label:
        typeof outcome.label === "string" ? outcome.label :
        typeof outcome.name === "string" ? outcome.name :
        typeof outcome.title === "string" ? outcome.title :
        `Outcome ${index + 1}`,
      tokenId:
        typeof outcome.tokenId === "string" ? outcome.tokenId :
        typeof outcome.token_id === "string" ? outcome.token_id :
        typeof outcome.onChainId === "string" ? outcome.onChainId :
        typeof outcome.on_chain_id === "string" ? outcome.on_chain_id :
        null,
      outcomeType:
        typeof outcome.outcomeType === "string" ? outcome.outcomeType :
        typeof outcome.outcome_type === "string" ? outcome.outcome_type :
        null,
      raw: outcome
    }));
};

const normalizeStatistics = (payload: Record<string, unknown>): PredictNormalizedMarketStatistics => ({
  volume:
    typeof payload.volume === "string" || typeof payload.volume === "number"
      ? String(payload.volume)
      : typeof payload.volumeTotalUsd === "string" || typeof payload.volumeTotalUsd === "number"
        ? String(payload.volumeTotalUsd)
        : typeof payload.volume_total_usd === "string" || typeof payload.volume_total_usd === "number"
          ? String(payload.volume_total_usd)
          : typeof payload.volume24hUsd === "string" || typeof payload.volume24hUsd === "number"
            ? String(payload.volume24hUsd)
            : typeof payload.volume_24h_usd === "string" || typeof payload.volume_24h_usd === "number"
              ? String(payload.volume_24h_usd)
              : null,
  liquidity:
    typeof payload.liquidity === "string" || typeof payload.liquidity === "number"
      ? String(payload.liquidity)
      : typeof payload.totalLiquidityUsd === "string" || typeof payload.totalLiquidityUsd === "number"
        ? String(payload.totalLiquidityUsd)
        : typeof payload.total_liquidity_usd === "string" || typeof payload.total_liquidity_usd === "number"
          ? String(payload.total_liquidity_usd)
          : null,
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

const monthNames = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

const normalizeDatePhrase = (value: string): string =>
  value
    .replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\bET\b/gi, "GMT-0500")
    .replace(/\bEST\b/gi, "GMT-0500")
    .replace(/\bEDT\b/gi, "GMT-0400")
    .replace(/\bCT\b/gi, "GMT-0600")
    .replace(/\bCST\b/gi, "GMT-0600")
    .replace(/\bCDT\b/gi, "GMT-0500")
    .replace(/\bMT\b/gi, "GMT-0700")
    .replace(/\bMST\b/gi, "GMT-0700")
    .replace(/\bMDT\b/gi, "GMT-0600")
    .replace(/\bPT\b/gi, "GMT-0800")
    .replace(/\bPST\b/gi, "GMT-0800")
    .replace(/\bPDT\b/gi, "GMT-0700")
    .replace(/\bUTC\b/gi, "UTC")
    .replace(/\s+/g, " ")
    .trim();

const parseDateOnlyToUtcClose = (value: string): Date | null => {
  const normalized = normalizeDatePhrase(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = new Date(`${normalized}T23:59:59.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(`${normalized} 23:59:59 UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseLooseTimestamp = (value: string): Date | null => {
    const normalized = normalizeDatePhrase(value.replace(/,\s+/g, " "));
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const extractYearFromCategorySlug = (market: Record<string, unknown>): string | null => {
    const slugCandidates = [
        typeof market.categorySlug === "string" ? market.categorySlug : null,
        typeof market.category_slug === "string" ? market.category_slug : null
    ].filter((value): value is string => value !== null && value.length > 0);

    for (const slug of slugCandidates) {
        const match = slug.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
};

const extractPredictTiming = (market: Record<string, unknown>): {
  createdAt: Date | null;
  closesAt: Date | null;
  resolvesAt: Date | null;
  ambiguousTimeBoundary: boolean;
} => {
  const createdAt = toDate(market.createdAt ?? market.created_at);
  const explicitClose =
    toDate(market.expiresAt ?? market.expires_at ?? market.resolveAt ?? market.resolve_at ?? market.closesAt ?? market.closes_at ?? market.endAt ?? market.end_at ?? market.endTime ?? market.end_time);
  if (explicitClose) {
    return {
      createdAt,
      closesAt: explicitClose,
      resolvesAt: explicitClose,
      ambiguousTimeBoundary: false
    };
  }

  const title = typeof market.title === "string" ? market.title : "";
  const description = typeof market.description === "string" ? market.description : "";
  const question = typeof market.question === "string" ? market.question : "";
  const combined = `${title}\n${question}\n${description}`;

  const timestampPattern = new RegExp(
    `${monthNames}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}\\s+at\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)?\\s*(?:UTC|ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|\\+\\d{2}:\\d{2})?`,
    "gi"
  );
  const timestampMatches = [...combined.matchAll(timestampPattern)]
    .map((match) => parseLooseTimestamp(match[0]))
    .filter((value): value is Date => value !== null);
  if (timestampMatches.length > 0) {
    const latest = timestampMatches.reduce((left, right) => left.getTime() >= right.getTime() ? left : right);
    return {
      createdAt,
      closesAt: latest,
      resolvesAt: latest,
      ambiguousTimeBoundary: false
    };
  }

  const isoDateMatches = [...combined.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)]
    .map((match) => parseDateOnlyToUtcClose(match[1]!))
    .filter((value): value is Date => value !== null);
  if (isoDateMatches.length > 0) {
    const latest = isoDateMatches.reduce((left, right) => left.getTime() >= right.getTime() ? left : right);
    return {
      createdAt,
      closesAt: latest,
      resolvesAt: latest,
      ambiguousTimeBoundary: true
    };
  }

  const monthDateMatches = [...combined.matchAll(new RegExp(`${monthNames}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}`, "gi"))]
    .map((match) => parseDateOnlyToUtcClose(match[0]))
    .filter((value): value is Date => value !== null);
  if (monthDateMatches.length > 0) {
    const latest = monthDateMatches.reduce((left, right) => left.getTime() >= right.getTime() ? left : right);
    return {
      createdAt,
      closesAt: latest,
      resolvesAt: latest,
      ambiguousTimeBoundary: true
    };
  }

  const inferredYear = extractYearFromCategorySlug(market);
  if (inferredYear) {
    const monthDateWithoutYearMatches = [
      ...combined.matchAll(new RegExp(`${monthNames}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+at\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)?\\s*(?:UTC|ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|\\+\\d{2}:\\d{2})?`, "gi"))
    ]
      .map((match) => parseLooseTimestamp(`${match[0]} ${inferredYear}`))
      .filter((value): value is Date => value !== null);
    if (monthDateWithoutYearMatches.length > 0) {
      const latest = monthDateWithoutYearMatches.reduce((left, right) => left.getTime() >= right.getTime() ? left : right);
      return {
        createdAt,
        closesAt: latest,
        resolvesAt: latest,
        ambiguousTimeBoundary: true
      };
    }

    const monthDayOnlyMatches = [
      ...combined.matchAll(new RegExp(`${monthNames}\\s+\\d{1,2}(?:st|nd|rd|th)?`, "gi"))
    ]
      .map((match) => parseDateOnlyToUtcClose(`${match[0]} ${inferredYear}`))
      .filter((value): value is Date => value !== null);
    if (monthDayOnlyMatches.length > 0) {
      const latest = monthDayOnlyMatches.reduce((left, right) => left.getTime() >= right.getTime() ? left : right);
      return {
        createdAt,
        closesAt: latest,
        resolvesAt: latest,
        ambiguousTimeBoundary: true
      };
    }
  }

  return {
    createdAt,
    closesAt: null,
    resolvesAt: null,
    ambiguousTimeBoundary: false
  };
};

const normalizeLastSale = (payload: Record<string, unknown>): PredictNormalizedLastSale => ({
  price:
    typeof payload.price === "string" || typeof payload.price === "number"
      ? String(payload.price)
      : typeof payload.priceInCurrency === "string" || typeof payload.priceInCurrency === "number"
        ? String(payload.priceInCurrency)
        : typeof payload.price_in_currency === "string" || typeof payload.price_in_currency === "number"
          ? String(payload.price_in_currency)
          : null,
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

const detectPredictCategoryFromText = (text: string): string => {
  if (/\b(PRESIDENT|ELECTION|SENATE|TRUMP|DEMOCRAT|REPUBLICAN|GOVERNOR|POLITIC\S*|IRAN|COUNTRY)\b/.test(text)) {
    return "POLITICS";
  }
  if (/\b(BTC|ETH|BNB|SOL|CRYPTO)\b|USD UP OR DOWN|PRICE FEED|BTC\/USD|ETH\/USD|BNB\/USD/.test(text)) {
    return "CRYPTO";
  }
  if (/\b(DOTA|LOL|LCK|VALORANT|CS2|ESPORT\S*|KPL|GEN\\.G|T1)\b|LEAGUE OF LEGENDS/.test(text)) {
    return "ESPORTS";
  }
  if (/\b(NBA|NFL|NHL|MLB|FC|MATCH|STANLEY|FINALS|SPORTS_MATCH)\b|PREMIER LEAGUE|WIN ON/.test(text)) {
    return "SPORTS";
  }
  return "OTHER";
};

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
    const category = normalizeCategory(input.canonicalCategory ?? this.inferCanonicalCategory(input.market));
    const outcomes = buildCanonicalOutcomes(input.market);
    const eventId = input.canonicalEventId ?? buildStableUuid(`predict-event:${this.config.environment}:${normalizedTitle}`);
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
      publishedAt: input.market.createdAt,
      expiresAt: input.market.closesAt,
      resolvesAt: input.market.resolvesAt,
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
      ...(input.market.ambiguousTimeBoundary ? { ambiguousTimeBoundary: true } : {}),
      executableDisplayName: input.market.title,
      executableMetadata: {
        simulationOnly: true,
        venueType: "clob_orderbook",
        environment: input.market.environment
      }
    };
  }

  public inferCanonicalCategory(market: PredictNormalizedMarket): string {
    const categoryTokens = [...market.categories, ...market.tags]
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0);
    const directHit = categoryTokens.find((value) => ["SPORTS", "CRYPTO", "POLITICS", "ESPORTS"].includes(value));
    if (directHit) {
      return directHit;
    }

    return detectPredictCategoryFromText(
      `${market.title.toUpperCase()} ${market.description?.toUpperCase() ?? ""} ${categoryTokens.join(" ")}`
    );
  }

  private async enrichMarket(market: Record<string, unknown>): Promise<PredictNormalizedMarket> {
    const marketId = String(market.id);
    const [statistics, lastSale] = await Promise.all([
      this.config.client.getMarketStatistics(marketId).then((value) => normalizeStatistics(asRecord(value))).catch(() => null),
      this.config.client.getMarketLastSale(marketId).then((value) => normalizeLastSale(asRecord(value))).catch(() => null)
    ]);
    const timing = extractPredictTiming(market);

    return {
      venue: "PREDICT",
      environment: this.config.environment,
      venueMarketId: marketId,
      title: typeof market.title === "string" ? market.title : marketId,
      description: typeof market.description === "string" ? market.description : null,
      question: typeof market.question === "string" ? market.question : null,
      status: typeof market.status === "string" ? market.status : typeof market.state === "string" ? market.state : null,
      categories: [
        ...(typeof market.category === "string" ? [market.category] : []),
        ...(typeof market.categorySlug === "string" ? [market.categorySlug] : []),
        ...(typeof market.category_slug === "string" ? [market.category_slug] : []),
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
      createdAt: timing.createdAt,
      closesAt: timing.closesAt,
      resolvesAt: timing.resolvesAt,
      ambiguousTimeBoundary: timing.ambiguousTimeBoundary,
      sourceMetadataVersion: this.config.metadataVersion,
      raw: market
    };
  }
}
