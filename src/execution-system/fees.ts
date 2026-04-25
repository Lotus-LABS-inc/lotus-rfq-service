import type { ExecutionFeeSummary, ExecutionRequestV0 } from "./types.js";

export interface FeeConfigV0 {
  priceImprovementShare: number;
  fastLaneFee: number;
  ghostFillProtectionFee: number;
  futureSettlementFee: number;
}

export class ExecutionFeeService {
  public constructor(private readonly config: FeeConfigV0 = {
    priceImprovementShare: 0.1,
    fastLaneFee: 0,
    ghostFillProtectionFee: 0,
    futureSettlementFee: 0
  }) {}

  public preview(request: ExecutionRequestV0): ExecutionFeeSummary {
    return this.calculate({
      expectedPrice: request.expectedPrice,
      realizedPrice: request.expectedPrice,
      size: Number(request.size),
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
      fastLaneEnabled: input.request.fastLaneEnabled,
      ghostFillProtectionEnabled: input.request.ghostFillProtectionEnabled
    });
  }

  private calculate(input: {
    expectedPrice: number;
    realizedPrice: number;
    size: number;
    fastLaneEnabled: boolean;
    ghostFillProtectionEnabled: boolean;
  }): ExecutionFeeSummary {
    const improvement = Math.max(0, input.expectedPrice - input.realizedPrice) * input.size;
    const priceImprovementFee = improvement * this.config.priceImprovementShare;
    const fastLaneFee = input.fastLaneEnabled ? this.config.fastLaneFee : 0;
    const ghostFillProtectionFee = input.ghostFillProtectionEnabled ? this.config.ghostFillProtectionFee : 0;
    const futureSettlementFee = this.config.futureSettlementFee;
    return {
      priceImprovementFee,
      fastLaneFee,
      ghostFillProtectionFee,
      futureSettlementFee,
      totalFees: priceImprovementFee + fastLaneFee + ghostFillProtectionFee + futureSettlementFee
    };
  }
}
