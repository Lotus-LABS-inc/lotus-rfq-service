import type { ExecutionLegV0, GhostFillStatusV0, SettlementStatusV0 } from "./types.js";
import type { VenueFillState } from "./venue-adapter.js";

export interface GhostFillClassification {
  status: GhostFillStatusV0;
  settlementStatus: SettlementStatusV0;
  reason?: string;
}

export class GhostFillProtectionService {
  public classify(input: {
    leg: ExecutionLegV0;
    fillState: VenueFillState;
    settlementStatus: SettlementStatusV0;
    protectionEnabled: boolean;
  }): GhostFillClassification {
    if (!input.protectionEnabled) {
      return { status: "NOT_APPLICABLE", settlementStatus: input.settlementStatus };
    }

    if (input.settlementStatus === "SETTLEMENT_VERIFIED") {
      return { status: "CLEAR", settlementStatus: input.settlementStatus };
    }

    const offchainFilled = input.fillState.offchainFilled === true || input.fillState.status === "FILLED";
    if (input.leg.venue === "POLYMARKET" && offchainFilled && input.settlementStatus === "SETTLEMENT_TIMEOUT") {
      return {
        status: "SUSPECTED",
        settlementStatus: "GHOST_FILL_SUSPECTED",
        reason: "polymarket_offchain_fill_without_finality"
      };
    }

    if (input.settlementStatus === "GHOST_FILL_CONFIRMED") {
      return {
        status: "CONFIRMED",
        settlementStatus: "GHOST_FILL_CONFIRMED",
        reason: "venue_finality_confirms_ghost_fill"
      };
    }

    return { status: "CLEAR", settlementStatus: input.settlementStatus };
  }
}
