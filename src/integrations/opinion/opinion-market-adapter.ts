import {
  buildStableTextId,
  buildStableUuid,
  normalizeCategory,
  normalizeFreeText,
  type CanonicalOutcomeDefinition
} from "../../canonical/canonicalization-types.js";
import type { CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import type { OpinionClient } from "./opinion-client.js";
import type { OpinionNormalizedMarket } from "./opinion-types.js";

export interface OpinionMarketAdapterConfig {
  client: Pick<OpinionClient, "listMarkets">;
  metadataVersion: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const toDate = (value: unknown): Date | null => {
  if (typeof value === "number") {
    return new Date((value >= 1_000_000_000_000 ? value : value * 1_000));
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;

const buildOutcomes = (market: OpinionNormalizedMarket): readonly CanonicalOutcomeDefinition[] => [
  {
    id: "YES",
    label: market.yesLabel ?? "Yes",
    metadata: { venue: "OPINION", ...(market.yesTokenId ? { tokenId: market.yesTokenId } : {}) }
  },
  {
    id: "NO",
    label: market.noLabel ?? "No",
    metadata: { venue: "OPINION", ...(market.noTokenId ? { tokenId: market.noTokenId } : {}) }
  }
];

const detectCategoryFromText = (text: string): string => {
  if (/(PRESIDENT|ELECTION|SENATE|GOVERNOR|POLITIC|TRUMP|DEMOCRAT|REPUBLICAN|COUNTRY STRIKE|IRAN)/.test(text)) {
    return "POLITICS";
  }
  if (/(BTC|ETH|BNB|SOL|CRYPTO|USD UP OR DOWN|PRICE)/.test(text)) {
    return "CRYPTO";
  }
  if (/(DOTA|LOL|LCK|LEAGUE OF LEGENDS|VALORANT|CS2|ESPORT|KPL)/.test(text)) {
    return "ESPORTS";
  }
  if (/(NBA|NFL|NHL|MLB|PREMIER LEAGUE|STANLEY|FINALS|MATCH|FC WIN|WIN THE MATCH)/.test(text)) {
    return "SPORTS";
  }
  return "OTHER";
};

export class OpinionMarketAdapter {
  public constructor(private readonly config: OpinionMarketAdapterConfig) {}

  public async listMarkets(input: { page: number; limit: number }): Promise<readonly OpinionNormalizedMarket[]> {
    const markets = await this.config.client.listMarkets(input);
    return markets.map((market) => normalizeOpinionMarketRecord(asRecord(market), this.config.metadataVersion));
  }

  public inferCanonicalCategory(market: OpinionNormalizedMarket): string {
    const labels = new Set(market.labels.map((label) => label.trim().toUpperCase()));
    if (labels.has("POLITICS")) {
      return "POLITICS";
    }
    if (labels.has("CRYPTO")) {
      return "CRYPTO";
    }
    if (labels.has("ESPORTS")) {
      return "ESPORTS";
    }
    if (labels.has("SPORTS") || labels.has("NBA") || labels.has("NFL") || labels.has("NHL") || labels.has("MLB")) {
      return "SPORTS";
    }
    return detectCategoryFromText(`${market.title.toUpperCase()} ${market.rules?.toUpperCase() ?? ""}`);
  }

  public buildCanonicalSeed(market: OpinionNormalizedMarket): CuratedCanonicalGraphSeed {
    const canonicalCategory = normalizeCategory(this.inferCanonicalCategory(market));
    const outcomes = buildOutcomes(market);
    const eventKey = `opinion-event:${market.venueMarketId}`;
    const propositionText = normalizeFreeText(`${market.title} ${market.rules ?? ""}`);

    return {
      canonicalEventId: buildStableUuid(eventKey),
      canonicalMarketId: buildStableTextId("opinion-market-", market.venueMarketId),
      canonicalCategory,
      venue: "OPINION",
      venueMarketId: market.venueMarketId,
      title: market.title,
      description: market.rules,
      marketType: "BINARY",
      marketClass: "BINARY",
      outcomes,
      outcomeSchema: {
        marketShape: "binary",
        yesLabel: market.yesLabel ?? "Yes",
        noLabel: market.noLabel ?? "No"
      },
      topics: market.labels,
      publishedAt: market.createdAt,
      expiresAt: market.cutoffAt,
      resolvesAt: market.resolvedAt,
      resolutionSource: "opinion_openapi_market",
      resolutionTitle: market.title,
      resolutionRulesText: market.rules,
      resolutionAuthorityType: "CENTRAL",
      settlementType: "onchain",
      network: market.chainId === "56" ? "BNB_MAINNET" : null,
      chain: market.chainId === "56" ? "BNB" : null,
      rawSourcePayload: market.raw,
      normalizedPayload: {
        marketId: market.venueMarketId,
        slug: market.slug,
        questionId: market.questionId,
        ...(market.yesTokenId ? { quoteTokenId: market.yesTokenId } : {}),
        ...(market.yesTokenId || market.noTokenId ? {
          quoteOutcomeTokenIds: {
            ...(market.yesTokenId ? { YES: market.yesTokenId } : {}),
            ...(market.noTokenId ? { NO: market.noTokenId } : {})
          }
        } : {}),
        ...(market.conditionId ? { conditionId: market.conditionId } : {}),
        ...(market.resultTokenId ? { resultTokenId: market.resultTokenId } : {})
      },
      mappingLineage: ["opinion-market-adapter"],
      sourceMetadataVersion: this.config.metadataVersion,
      eventPropositionKey: buildStableUuid(`opinion-proposition:${market.venueMarketId}`),
      eventTitle: market.title,
      eventNormalizedPropositionText: propositionText,
      eventSourceHints: {
        marketId: market.venueMarketId,
        labels: market.labels
      },
      propositionHints: {
        normalizedPropositionText: propositionText
      },
      executableDisplayName: market.title,
      executableMetadata: {
        simulationOnly: true,
        venueType: "binary_market"
      }
    };
  }
}

export const normalizeOpinionMarketRecord = (
  market: Record<string, unknown>,
  metadataVersion: string
): OpinionNormalizedMarket => ({
  venue: "OPINION",
  venueMarketId: String(market.marketId),
  title: typeof market.marketTitle === "string" ? market.marketTitle : String(market.marketId),
  slug: typeof market.slug === "string" ? market.slug : null,
  marketType: typeof market.marketType === "number" ? market.marketType : null,
  status: typeof market.statusEnum === "string" ? market.statusEnum : null,
  statusCode: typeof market.status === "number" ? market.status : null,
  labels: Array.isArray(market.labels) ? market.labels.filter((value): value is string => typeof value === "string") : [],
  rules: typeof market.rules === "string" ? market.rules : null,
  yesLabel: typeof market.yesLabel === "string" ? market.yesLabel : null,
  noLabel: typeof market.noLabel === "string" ? market.noLabel : null,
  yesTokenId: typeof market.yesTokenId === "string" ? market.yesTokenId : null,
  noTokenId: typeof market.noTokenId === "string" ? market.noTokenId : null,
  conditionId: typeof market.conditionId === "string" ? market.conditionId : null,
  resultTokenId: typeof market.resultTokenId === "string" ? market.resultTokenId : null,
  volume: toStringOrNull(market.volume),
  volume24h: toStringOrNull(market.volume24h),
  volume7d: toStringOrNull(market.volume7d),
  quoteToken: typeof market.quoteToken === "string" ? market.quoteToken : null,
  chainId: toStringOrNull(market.chainId),
  questionId: typeof market.questionId === "string" ? market.questionId : null,
  createdAt: toDate(market.createdAt),
  cutoffAt: toDate(market.cutoffAt),
  resolvedAt: toDate(market.resolvedAt),
  childMarkets: Array.isArray(market.childMarkets)
    ? market.childMarkets.map((child) => normalizeOpinionMarketRecord(asRecord(child), metadataVersion))
    : [],
  sourceMetadataVersion: metadataVersion,
  raw: market
});
