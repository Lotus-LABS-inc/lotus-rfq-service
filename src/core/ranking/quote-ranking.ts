import { rankingDurationMs } from "../../observability/metrics.js";
import { withSpanSync } from "../../observability/tracing.js";
import { QuoteStalenessGuard, type StalenessAwareQuote } from "../quote-staleness-guard.js";

export interface NormalizedQuote extends StalenessAwareQuote {
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
  const startedAt = performance.now();
  const stalenessGuard = new QuoteStalenessGuard();

  return withSpanSync(
    "rfq.ranking",
    {
      rfq_id: "unknown",
      lp_id: "n/a",
      state: "RANKING"
    },
    () => {
      const ranked = stalenessGuard
        .filterValidQuotes(quotes)
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

      const output = ranked.map((quote, index) => ({
        ...quote,
        rank: index + 1
      }));
      rankingDurationMs.observe(performance.now() - startedAt);
      return output;
    }
  );
};
