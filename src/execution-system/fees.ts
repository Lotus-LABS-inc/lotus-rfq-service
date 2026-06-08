import type { ExecutionFeeSummary, ExecutionRequestV0 } from "./types.js";
import {
  getMonetizationPolicyFromEnv,
  isShadowImprovementEnabled,
  type MonetizationPolicy
} from "./monetization-policy.js";

export interface FeeConfigV0 {
  priceImprovementShare?: number;
  fastLaneFee?: number;
  ghostFillProtectionFee?: number;
  futureSettlementFee: number;
  policy?: MonetizationPolicy;
}

export class ExecutionFeeService {
  public constructor(private readonly config: FeeConfigV0 = {
    policy: getMonetizationPolicyFromEnv(),
    futureSettlementFee: 0
  }) {}

  public preview(request: ExecutionRequestV0): ExecutionFeeSummary {
    return this.calculate({
      expectedPrice: request.expectedPrice,
      realizedPrice: request.expectedPrice,
      size: Number(request.size),
      singleVenueMaxFillSize: Number(request.singleVenueMaxFillSize ?? request.size),
      side: request.side,
      fastLaneEnabled: request.fastLaneEnabled,
      ghostFillProtectionEnabled: request.ghostFillProtectionEnabled
    });
  }

  public realized(input: {
    request: ExecutionRequestV0;
    realizedPrice: number;
  }): ExecutionFeeSummary {
    return this.calculate({
      expectedPrice: input.request.expectedPrice,
      realizedPrice: input.realizedPrice,
      size: Number(input.request.size),
      singleVenueMaxFillSize: Number(input.request.singleVenueMaxFillSize ?? input.request.size),
      side: input.request.side,
      fastLaneEnabled: input.request.fastLaneEnabled,
      ghostFillProtectionEnabled: input.request.ghostFillProtectionEnabled
    });
  }

  private calculate(input: {
    expectedPrice: number;
    realizedPrice: number;
    size: number;
    singleVenueMaxFillSize: number;
    side: ExecutionRequestV0["side"];
    fastLaneEnabled: boolean;
    ghostFillProtectionEnabled: boolean;
  }): ExecutionFeeSummary {
    if (!this.config.policy) {
      const legacyImprovement = Math.max(0, input.expectedPrice - input.realizedPrice) * input.size;
      const legacyPriceImprovementFee = legacyImprovement * (this.config.priceImprovementShare ?? 0.1);
      const legacyFastLaneFee = input.fastLaneEnabled ? (this.config.fastLaneFee ?? 0) : 0;
      const legacyGhostFillProtectionFee = input.ghostFillProtectionEnabled ? (this.config.ghostFillProtectionFee ?? 0) : 0;
      const legacyFutureSettlementFee = this.config.futureSettlementFee;
      const legacyTotal = legacyPriceImprovementFee + legacyFastLaneFee + legacyGhostFillProtectionFee + legacyFutureSettlementFee;
      return {
        policyVersion: "legacy-fees-v0",
        currency: "USDC",
        mode: "SHADOW",
        captureMode: "SHADOW",
        revenueSource: "SHADOW_PRICE_IMPROVEMENT",
        priceImprovementFee: legacyPriceImprovementFee,
        shareImprovementFee: 0,
        executionFee: 0,
        fastLaneFee: legacyFastLaneFee,
        ghostFillProtectionFee: legacyGhostFillProtectionFee,
        futureSettlementFee: legacyFutureSettlementFee,
        totalLotusFee: legacyTotal,
        notionalCap: Number.POSITIVE_INFINITY,
        capApplied: false,
        actualBuilderFeesCollected: 0,
        shadowImprovementFees: legacyTotal,
        uncollectedImprovementOpportunity: legacyTotal,
        userFeeDisclosureLabel: "Estimated Lotus improvement share, not collected.",
        totalFees: legacyTotal
      };
    }

    const policy = this.config.policy;
    const improvementPerUnit = input.side === "sell"
      ? input.realizedPrice - input.expectedPrice
      : input.expectedPrice - input.realizedPrice;
    const improvement = Math.max(0, improvementPerUnit) * input.size;
    const filledNotional = Math.max(0, input.realizedPrice * input.size);
    const priceImprovementFee = improvement * policy.priceImprovementShareBps / 10_000;
    const extraShares = Math.max(0, input.size - input.singleVenueMaxFillSize);
    const shareImprovementFee = extraShares * input.realizedPrice * policy.shareImprovementShareBps / 10_000;
    const executionFee = filledNotional * policy.executionFeeBps / 10_000;
    const fastLaneFee = input.fastLaneEnabled ? improvement * policy.fastLaneFeeBps / 10_000 : 0;
    const ghostFillProtectionFee = input.ghostFillProtectionEnabled ? improvement * policy.ghostFillProtectionFeeBps / 10_000 : 0;
    const futureSettlementFee = this.config.futureSettlementFee;
    const shadowEnabled = isShadowImprovementEnabled(policy);
    const uncappedTotal = !shadowEnabled
      ? 0
      : priceImprovementFee + shareImprovementFee + executionFee + fastLaneFee + ghostFillProtectionFee + futureSettlementFee;
    const notionalCap = filledNotional * policy.maxTotalFeeBps / 10_000;
    const totalLotusFee = Math.min(uncappedTotal, notionalCap);
    return {
      policyVersion: policy.policyVersion,
      currency: policy.currency,
      mode: policy.mode,
      captureMode: policy.captureMode,
      revenueSource: "SHADOW_PRICE_IMPROVEMENT",
      priceImprovementFee,
      shareImprovementFee,
      executionFee,
      fastLaneFee,
      ghostFillProtectionFee,
      futureSettlementFee,
      totalLotusFee,
      notionalCap,
      capApplied: uncappedTotal > notionalCap,
      actualBuilderFeesCollected: 0,
      shadowImprovementFees: totalLotusFee,
      uncollectedImprovementOpportunity: totalLotusFee,
      userFeeDisclosureLabel: "Estimated Lotus improvement share, not collected.",
      totalFees: totalLotusFee
    };
  }
}
