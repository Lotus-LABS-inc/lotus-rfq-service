import { z } from "zod";
import Decimal from "decimal.js";
import {
  type CanonicalRFQInput,
  type CandidateScore,
  type ICostModel,
  LiquiditySource,
  type RouteCandidate,
  type SORAcceptancePolicy,
  type SelectedQuoteInput
} from "./types.js";
import { withSpan } from "../../observability/tracing.js";

export const CostModelConfigSchema = z.object({
  slippageAlpha: z.number().positive().default(0.001),
  slippageBeta: z.number().positive().default(1.1),
  expectedRecoveryCost: z.number().nonnegative().default(0.1),
  timeValueOfMoneyCost: z.number().nonnegative().default(0.01),
  latencyPenaltyPerMs: z.number().nonnegative().default(0.0001)
});

export type CostModelConfig = z.infer<typeof CostModelConfigSchema>;

export interface CandidateScoreBreakdown {
  effective_cost: InstanceType<typeof Decimal>;
  expected_slippage: InstanceType<typeof Decimal>;
  failure_cost: InstanceType<typeof Decimal>;
  latency_penalty: InstanceType<typeof Decimal>;
  total_score: InstanceType<typeof Decimal>;
  fill_prob: number;
}

export class CostModel implements ICostModel {
  private readonly config: CostModelConfig;

  public constructor(config?: Partial<CostModelConfig>) {
    this.config = CostModelConfigSchema.parse(config ?? {});
  }

  public scoreCandidate(candidate: RouteCandidate, size: number): CandidateScoreBreakdown {
    const tradeSize = new Decimal(Math.max(size, 0));
    const quotedPrice = new Decimal(candidate.quoted_price);
    const availableSize = new Decimal(Math.max(candidate.available_size, 1e-9));

    const notional = quotedPrice.times(tradeSize);
    const slippageRatio = new Decimal(this.config.slippageAlpha).times(
      tradeSize.div(availableSize).pow(this.config.slippageBeta)
    );
    const expectedSlippage = notional.times(slippageRatio);

    const feeTotal = Object.values(candidate.fees).reduce(
      (acc, current) => acc.plus(new Decimal(current)),
      new Decimal(0)
    );

    const effectiveCost = notional.plus(expectedSlippage).plus(feeTotal);

    // Cross isolation: internally crossed residual candidates carry no external failure/latency penalty.
    const isInternal = candidate.provider_type === LiquiditySource.INTERNAL_CROSS;

    const fillProb = Math.max(0, Math.min(1, candidate.fill_prob));
    const failureProb = new Decimal(1).minus(fillProb);
    const failureCost = isInternal
      ? new Decimal(0)
      : failureProb.times(new Decimal(this.config.expectedRecoveryCost).plus(this.config.timeValueOfMoneyCost));

    const latencyPenalty = isInternal
      ? new Decimal(0)
      : new Decimal(candidate.latency_ms).times(this.config.latencyPenaltyPerMs);

    const totalScore = effectiveCost.plus(failureCost).plus(latencyPenalty);

    return {
      effective_cost: effectiveCost,
      expected_slippage: expectedSlippage,
      failure_cost: failureCost,
      latency_penalty: latencyPenalty,
      total_score: totalScore,
      fill_prob: fillProb
    };
  }

  public async evaluateCandidates(
    rfq: CanonicalRFQInput,
    candidates: readonly RouteCandidate[],
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<readonly CandidateScore[]> {
    return withSpan(
      "sor.cost_model.evaluate",
      { rfq_id: rfq.rfqId, acceptance_policy: policy },
      async () =>
        candidates
          .map((candidate) => {
            const scored = this.scoreCandidate(candidate, selectedQuote.quantity);
            const size = Math.max(selectedQuote.quantity, 1e-9);
            const effectiveUnitCost = scored.total_score.div(size);

            return {
              candidateId: candidate.id,
              providerId: candidate.provider_id,
              effectiveUnitCost: effectiveUnitCost.toNumber(),
              totalExpectedCost: scored.total_score.toNumber(),
              breakdown: {
                effectiveUnitCost: scored.effective_cost.div(size).toNumber(),
                basePrice: candidate.quoted_price,
                providerFee: candidate.fees.provider_fee ?? 0,
                protocolFee: candidate.fees.protocol_fee ?? 0,
                gasCost: candidate.fees.gas_cost ?? 0,
                latencyPenalty: scored.latency_penalty.toNumber(),
                failurePenalty: scored.failure_cost.toNumber()
              }
            } satisfies CandidateScore;
          })
          .sort((a, b) => a.totalExpectedCost - b.totalExpectedCost)
    );
  }
}
