export interface OpinionNormalizedMarket {
  venue: "OPINION";
  venueMarketId: string;
  title: string;
  slug: string | null;
  status: string | null;
  statusCode: number | null;
  labels: readonly string[];
  rules: string | null;
  yesLabel: string | null;
  noLabel: string | null;
  volume: string | null;
  volume24h: string | null;
  volume7d: string | null;
  quoteToken: string | null;
  chainId: string | null;
  questionId: string | null;
  createdAt: Date | null;
  cutoffAt: Date | null;
  resolvedAt: Date | null;
  sourceMetadataVersion: string;
  raw: Record<string, unknown>;
}
