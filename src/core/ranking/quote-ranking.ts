import { rankingDurationMs } from "../../observability/metrics.js";
import { withSpanSync } from "../../observability/tracing.js";
import { QuoteStalenessGuard, type StalenessAwareQuote } from "../quote-staleness-guard.js";
import {
  computeReliabilityScore,
  type LPReliabilityProfile,
  type ReliabilityWeights
} from "../lp-reliability-engine.js";

export interface NormalizedQuote extends StalenessAwareQuote {
  quoteId: string;
  lpId?: string;
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
  score: number;
  reliabilityBonus: number;
  latencyBonus: number;
  failurePenalty: number;
  rank: number;
}

export interface QuoteRankingInput {
  reliabilityProfiles?: Readonly<Record<string, LPReliabilityProfile>>;
  weights?: Partial<ReliabilityWeights>;
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

export const rankQuotesByEffectiveCost = (
  quotes: readonly NormalizedQuote[],
  input?: QuoteRankingInput
): RankedQuote[] => {
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
        .map((quote) => {
          const profile =
            quote.lpId && input?.reliabilityProfiles
              ? input.reliabilityProfiles[quote.lpId]
              : undefined;
          const reliabilityInput = {
            effectivePrice: quote.effectiveCost,
            ...(profile ? { profile } : {}),
            ...(input?.weights ? { weights: input.weights } : {})
          };
          const reliabilityScore = computeReliabilityScore(reliabilityInput);

          return {
            ...quote,
            score: reliabilityScore.score,
            reliabilityBonus: reliabilityScore.reliabilityBonus,
            latencyBonus: reliabilityScore.latencyBonus,
            failurePenalty: reliabilityScore.failurePenalty
          };
        })
        .sort((left, right) => {
          if (left.score !== right.score) {
            return left.score - right.score;
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
