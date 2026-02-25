export interface NormalizedQuote {
  quoteId: string;
  basePrice: number;
  venueFee: number;
  protocolFee: number;
  gasCost: number;
  slippageEstimate: number;
  reliabilityScore: number;
  latencyScore: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface RankedQuote extends NormalizedQuote {
  effectiveCost: number;
  rank: number;
}

export const calculateEffectiveCost = (quote: NormalizedQuote): number => {
  return (
    quote.basePrice +
    quote.venueFee +
    quote.protocolFee +
    quote.gasCost +
    quote.slippageEstimate
  );
};

export const rankQuotesByEffectiveCost = (quotes: readonly NormalizedQuote[]): RankedQuote[] => {
  const ranked = quotes
    .map((quote) => ({
      ...quote,
      effectiveCost: calculateEffectiveCost(quote)
    }))
    .sort((left, right) => {
      if (left.effectiveCost !== right.effectiveCost) {
        return left.effectiveCost - right.effectiveCost;
      }

      if (left.reliabilityScore !== right.reliabilityScore) {
        return right.reliabilityScore - left.reliabilityScore;
      }

      if (left.latencyScore !== right.latencyScore) {
        return right.latencyScore - left.latencyScore;
      }

      return left.quoteId.localeCompare(right.quoteId);
    });

  return ranked.map((quote, index) => ({
    ...quote,
    rank: index + 1
  }));
};

