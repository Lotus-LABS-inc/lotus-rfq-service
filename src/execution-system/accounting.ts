import type { ExecutionFeeSummary, ExecutionLegV0, SettlementStatusV0 } from "./types.js";

export interface AccountingRecordV0 {
  executionId: string;
  userId: string;
  venue: string;
  canonicalTopicKey: string;
  candidateId: string;
  side: "buy" | "sell";
  filledSize: string;
  averagePrice: number;
  fees: ExecutionFeeSummary;
  settlementStatus: SettlementStatusV0;
  createdAt: string;
}

export interface PositionUpdateV0 {
  venue: string;
  candidateId: string;
  deltaSize: string;
  displayOnly: boolean;
}

export class AccountingUpdateService {
  public buildPostSettlementUpdate(input: {
    executionId: string;
    userId: string;
    canonicalTopicKey: string;
    candidateId: string;
    side: "buy" | "sell";
    legs: readonly ExecutionLegV0[];
    fees: ExecutionFeeSummary;
  }): { records: AccountingRecordV0[]; positions: PositionUpdateV0[] } {
    const verifiedLegs = input.legs.filter((leg) => leg.settlementStatus === "SETTLEMENT_VERIFIED");
    const records = verifiedLegs.map((leg) => ({
      executionId: input.executionId,
      userId: input.userId,
      venue: leg.venue,
      canonicalTopicKey: input.canonicalTopicKey,
      candidateId: input.candidateId,
      side: input.side,
      filledSize: leg.size,
      averagePrice: leg.price,
      fees: input.fees,
      settlementStatus: leg.settlementStatus,
      createdAt: new Date().toISOString()
    }));
    const sign = input.side === "buy" ? "" : "-";
    const positions = verifiedLegs.map((leg) => ({
      venue: leg.venue,
      candidateId: input.candidateId,
      deltaSize: `${sign}${leg.size}`,
      displayOnly: false
    }));
    const total = verifiedLegs.reduce((sum, leg) => sum + Number(leg.size), 0);
    if (total > 0) {
      positions.push({
        venue: "UNIFIED_DISPLAY",
        candidateId: input.candidateId,
        deltaSize: `${sign}${total}`,
        displayOnly: true
      });
    }
    return { records, positions };
  }
}
