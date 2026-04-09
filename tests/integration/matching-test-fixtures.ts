import type { MatchingMarketRecord } from "../../src/matching/matching-types.js";

interface BuildMarketOptions {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  venueMarketId: string;
  canonicalEventId?: string;
  title: string;
  rulesText?: string | null;
  category: MatchingMarketRecord["category"];
  marketClass?: MatchingMarketRecord["marketClass"];
  sourceMetadataVersion?: string;
  historicalRowCount?: number;
}

export const buildMatchingMarket = (input: BuildMarketOptions): MatchingMarketRecord => ({
  interpretedContractId: input.interpretedContractId,
  venueMarketProfileId: `profile-${input.interpretedContractId}`,
  canonicalEventId: input.canonicalEventId ?? "11111111-1111-5111-8111-111111111111",
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: input.title,
  description: null,
  rulesText: input.rulesText ?? null,
  category: input.category,
  marketClass: input.marketClass ?? "BINARY",
  sourceMetadataVersion: input.sourceMetadataVersion ?? "current-state-v1",
  confidenceScore: "0.95",
  propositionSemantics: {},
  outcomeSemantics: {},
  timingSemantics: {},
  resolutionSemantics: {},
  settlementSemantics: {},
  ambiguityFlags: {},
  rawLineageReferences: {},
  publishedAt: new Date("2026-03-01T00:00:00.000Z"),
  expiresAt: new Date("2026-03-31T23:59:59.000Z"),
  resolvesAt: new Date("2026-03-31T23:59:59.000Z"),
  outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  outcomeSchema: { kind: "YES_NO" },
  historicalRowCount: input.historicalRowCount ?? 0,
  inventoryTemporalBasis: input.historicalRowCount && input.historicalRowCount > 0 ? "HISTORICAL" : "LIVE_CURRENT_STATE"
});
