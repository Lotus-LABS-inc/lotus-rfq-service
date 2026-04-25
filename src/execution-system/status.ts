import type { ExecutionStateV0, ExecutionSystemMetadataV0 } from "./types.js";

export const mapExecutionStateToUserStatus = (state: ExecutionStateV0): string => {
  switch (state) {
    case "CREATED":
      return "preparing route";
    case "PREFLIGHT_CHECKING":
      return "checking lane approval";
    case "READY_TO_SUBMIT":
      return "reserving liquidity";
    case "SUBMITTED":
      return "submitting order";
    case "PARTIAL_FILL":
      return "partially filled";
    case "FILLED_PENDING_SETTLEMENT":
      return "filled pending settlement";
    case "SETTLEMENT_VERIFIED":
      return "settlement verified";
    case "GHOST_FILL_SUSPECTED":
    case "GHOST_FILL_CONFIRMED":
      return "ghost fill detected";
    case "REROUTING":
    case "REROUTED":
      return "rerouting safely";
    case "PREFLIGHT_FAILED":
    case "FAILED_CLOSED":
      return "failed closed";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "preparing route";
  }
};

export interface FrontendExecutionStatusV0 {
  executionId: string;
  currentState: ExecutionStateV0;
  userStatus: string;
  venuePath: readonly string[];
  filledAmount: string;
  settlementStatus: string;
  ghostFillStatus: string;
  fallbackStatus: "not_used" | "used" | "unavailable";
  feeSummary: Record<string, number>;
  adapterStatus: readonly {
    venue: string;
    legStatus: string;
    settlementStatus: string;
    errorCode?: string;
  }[];
  receipt?: unknown;
}

export const buildFrontendExecutionStatus = (metadata: ExecutionSystemMetadataV0): FrontendExecutionStatusV0 => ({
  executionId: metadata.executionRequest.executionId,
  currentState: metadata.currentState,
  userStatus: mapExecutionStateToUserStatus(metadata.currentState),
  venuePath: metadata.executionRequest.venuePath,
  filledAmount: String(metadata.legs.reduce((sum, leg) => sum + (leg.settlementStatus === "SETTLEMENT_VERIFIED" ? Number(leg.size) : 0), 0)),
  settlementStatus: metadata.settlementStatus,
  ghostFillStatus: metadata.ghostFillStatus,
  fallbackStatus: metadata.fallbackUsed ? "used" : metadata.currentState === "FAILED_CLOSED" ? "unavailable" : "not_used",
  feeSummary: metadata.feeSummary,
  adapterStatus: metadata.legs.map((leg) => ({
    venue: leg.venue,
    legStatus: leg.status,
    settlementStatus: leg.settlementStatus,
    ...(leg.errorCode ? { errorCode: leg.errorCode } : {})
  })),
  ...(metadata.receipt ? { receipt: metadata.receipt } : {})
});
