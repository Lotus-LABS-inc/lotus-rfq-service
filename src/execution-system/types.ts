import { z } from "zod";

export const executionModes = ["SINGLE_VENUE", "PAIR", "TRI", "SPLIT"] as const;
export type ExecutionMode = (typeof executionModes)[number];

export const executionSides = ["buy", "sell"] as const;
export type ExecutionSide = (typeof executionSides)[number];

export const executionStates = [
  "CREATED",
  "PREFLIGHT_CHECKING",
  "PREFLIGHT_FAILED",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "PARTIAL_FILL",
  "FILLED_PENDING_SETTLEMENT",
  "SETTLEMENT_VERIFIED",
  "GHOST_FILL_SUSPECTED",
  "GHOST_FILL_CONFIRMED",
  "REROUTING",
  "REROUTED",
  "FAILED_CLOSED",
  "COMPLETED",
  "CANCELLED"
] as const;

export type ExecutionStateV0 = (typeof executionStates)[number];

export const settlementStatuses = [
  "NOT_APPLICABLE",
  "DRY_RUN_ONLY",
  "SETTLEMENT_VERIFIED",
  "SETTLEMENT_PENDING",
  "SETTLEMENT_TIMEOUT",
  "SETTLEMENT_UNKNOWN",
  "GHOST_FILL_SUSPECTED",
  "GHOST_FILL_CONFIRMED"
] as const;

export type SettlementStatusV0 = (typeof settlementStatuses)[number];

export const ghostFillStatuses = ["NOT_APPLICABLE", "CLEAR", "SUSPECTED", "CONFIRMED"] as const;
export type GhostFillStatusV0 = (typeof ghostFillStatuses)[number];

export const executionLegStatuses = [
  "CREATED",
  "PREPARED",
  "SUBMITTED",
  "PARTIAL_FILL",
  "FILLED_PENDING_SETTLEMENT",
  "SETTLEMENT_VERIFIED",
  "FAILED",
  "FAILED_CLOSED",
  "CANCELLED"
] as const;

export type ExecutionLegStatusV0 = (typeof executionLegStatuses)[number];

const isoDateString = z.string().datetime();
const positiveNumericString = z.string().regex(/^\d+(\.\d+)?$/);

export const ExecutionFeeSummarySchema = z.object({
  policyVersion: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  mode: z.enum(["DISABLED", "SHADOW", "ENFORCED"]).optional(),
  captureMode: z.enum(["DISABLED", "SHADOW", "BUILDER_FEE_ONLY", "SHADOW_PLUS_BUILDER_FEE", "SMART_FEE_ROUTER_PLANNED"]).optional(),
  revenueSource: z.enum(["POLYMARKET_BUILDER_FEE", "VENUE_BUILDER_FEE", "SHADOW_PRICE_IMPROVEMENT", "MANUAL_INVOICE_PLANNED", "SMART_FEE_ROUTER_PLANNED"]).optional(),
  priceImprovementFee: z.number().nonnegative(),
  executionFee: z.number().nonnegative().optional(),
  fastLaneFee: z.number().nonnegative(),
  ghostFillProtectionFee: z.number().nonnegative(),
  futureSettlementFee: z.number().nonnegative(),
  totalLotusFee: z.number().nonnegative().optional(),
  notionalCap: z.number().nonnegative().optional(),
  capApplied: z.boolean().optional(),
  actualBuilderFeesCollected: z.number().nonnegative().optional(),
  shadowImprovementFees: z.number().nonnegative().optional(),
  uncollectedImprovementOpportunity: z.number().nonnegative().optional(),
  userFeeDisclosureLabel: z.string().min(1).optional(),
  totalFees: z.number().nonnegative()
});

export type ExecutionFeeSummary = z.infer<typeof ExecutionFeeSummarySchema>;

export const ExecutionRequestSchema = z.object({
  executionId: z.string().min(1),
  rfqId: z.string().min(1),
  userId: z.string().min(1),
  canonicalTopicKey: z.string().min(1),
  canonicalOutcomeId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  side: z.enum(executionSides),
  size: positiveNumericString,
  selectedLaneId: z.string().min(1),
  venuePath: z.array(z.string().min(1)).min(1),
  executionMode: z.enum(executionModes),
  approvedScopeHash: z.string().min(1),
  maxSlippage: z.number().nonnegative(),
  fastLaneEnabled: z.boolean(),
  ghostFillProtectionEnabled: z.boolean(),
  expectedPrice: z.number().nonnegative(),
  expectedFees: ExecutionFeeSummarySchema,
  idempotencyKey: z.string().min(1),
  createdAt: isoDateString,
  executionScopeToken: z.string().min(1).optional(),
  fallbackLaneId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).refine((value) => Boolean(value.canonicalOutcomeId ?? value.candidateId), {
  message: "ExecutionRequest requires canonicalOutcomeId or candidateId.",
  path: ["canonicalOutcomeId"]
});

export type ExecutionRequestV0 = z.infer<typeof ExecutionRequestSchema>;

export const ExecutionLegSchema = z.object({
  executionLegId: z.string().min(1),
  parentExecutionId: z.string().min(1),
  venue: z.string().min(1),
  venueMarketId: z.string().min(1),
  venueOutcomeId: z.string().min(1),
  side: z.enum(executionSides),
  size: positiveNumericString,
  price: z.number().nonnegative(),
  status: z.enum(executionLegStatuses),
  submittedAt: isoDateString.optional(),
  filledAt: isoDateString.optional(),
  settlementStatus: z.enum(settlementStatuses),
  venueOrderId: z.string().min(1).optional(),
  fillId: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional()
});

export type ExecutionLegV0 = z.infer<typeof ExecutionLegSchema>;

export const ExecutionReceiptSchema = z.object({
  executionId: z.string().min(1),
  userId: z.string().min(1),
  state: z.enum(executionStates),
  filledSize: z.string(),
  averagePrice: z.number().nonnegative(),
  settlementStatus: z.enum(settlementStatuses),
  ghostFillStatus: z.enum(ghostFillStatuses),
  fees: ExecutionFeeSummarySchema,
  emittedAt: isoDateString
});

export type ExecutionReceiptV0 = z.infer<typeof ExecutionReceiptSchema>;

export const ExecutionResultSchema = z.object({
  executionId: z.string().min(1),
  finalState: z.enum(executionStates),
  filledSize: z.string(),
  averagePrice: z.number().nonnegative(),
  venueBreakdown: z.array(z.object({
    venue: z.string().min(1),
    filledSize: z.string(),
    averagePrice: z.number().nonnegative(),
    settlementStatus: z.enum(settlementStatuses)
  })),
  settlementStatus: z.enum(settlementStatuses),
  ghostFillStatus: z.enum(ghostFillStatuses),
  fallbackUsed: z.boolean(),
  fees: ExecutionFeeSummarySchema,
  auditEventIds: z.array(z.string().min(1)),
  receipt: ExecutionReceiptSchema.optional()
});

export type ExecutionResultV0 = z.infer<typeof ExecutionResultSchema>;

export const ExecutionSystemMetadataSchema = z.object({
  version: z.literal("execution-system-v0"),
  executionId: z.string().min(1),
  rfqId: z.string().min(1),
  userId: z.string().min(1),
  canonicalTopicKey: z.string().min(1),
  candidateId: z.string().min(1).optional(),
  canonicalOutcomeId: z.string().min(1).optional(),
  side: z.enum(executionSides),
  size: positiveNumericString,
  selectedLaneId: z.string().min(1),
  venuePath: z.array(z.string().min(1)).min(1),
  executionMode: z.enum(executionModes),
  approvedScopeHash: z.string().min(1),
  maxSlippage: z.number().nonnegative(),
  fastLaneEnabled: z.boolean(),
  ghostFillProtectionEnabled: z.boolean(),
  expectedPrice: z.number().nonnegative(),
  expectedFees: ExecutionFeeSummarySchema,
  idempotencyKey: z.string().min(1),
  executionState: z.enum(executionStates),
  settlementState: z.enum(settlementStatuses),
  ghostFillState: z.enum(ghostFillStatuses),
  fallbackState: z.enum(["NOT_USED", "REROUTED", "FAILED_CLOSED"]),
  executionRequest: ExecutionRequestSchema,
  currentState: z.enum(executionStates),
  legs: z.array(ExecutionLegSchema),
  settlementStatus: z.enum(settlementStatuses),
  ghostFillStatus: z.enum(ghostFillStatuses),
  fallbackUsed: z.boolean(),
  fallbackReason: z.string().optional(),
  feeSummary: ExecutionFeeSummarySchema,
  auditEventIds: z.array(z.string()),
  receipt: ExecutionReceiptSchema.optional(),
  updatedAt: isoDateString
});

export type ExecutionSystemMetadataV0 = z.infer<typeof ExecutionSystemMetadataSchema>;

export type ExecutionFailureCode =
  | "LANE_NOT_FOUND"
  | "LANE_NOT_OPERATOR_APPROVED"
  | "LANE_HELD_OR_REVOKED"
  | "TOPIC_SCOPE_MISMATCH"
  | "CANDIDATE_SCOPE_MISMATCH"
  | "VENUE_SCOPE_MISMATCH"
  | "RULE_STATE_DEGRADED"
  | "SCOPE_TOKEN_REQUIRED"
  | "SCOPE_TOKEN_INVALID"
  | "VENUE_PAUSED"
  | "MARKET_CLOSED"
  | "OUTCOME_NOT_PRESENT"
  | "PRICE_OUTSIDE_SLIPPAGE"
  | "LIQUIDITY_UNAVAILABLE"
  | "FUNDING_UNAVAILABLE"
  | "IDEMPOTENCY_ALREADY_COMPLETED"
  | "FALLBACK_NOT_APPROVED"
  | "VENUE_EXECUTION_NOT_CONFIGURED"
  | "ADAPTER_SUBMISSION_FAILED"
  | "SETTLEMENT_NOT_VERIFIED"
  | "GHOST_FILL_DETECTED"
  | "NO_APPROVED_FALLBACK";

export interface ExecutionCheckResult {
  ok: boolean;
  code?: ExecutionFailureCode;
  reason?: string;
}

export const zeroFees = (): ExecutionFeeSummary => ({
  policyVersion: "disabled",
  currency: "USDC",
  mode: "DISABLED",
  captureMode: "DISABLED",
  revenueSource: "SHADOW_PRICE_IMPROVEMENT",
  priceImprovementFee: 0,
  executionFee: 0,
  fastLaneFee: 0,
  ghostFillProtectionFee: 0,
  futureSettlementFee: 0,
  totalLotusFee: 0,
  notionalCap: 0,
  capApplied: false,
  actualBuilderFeesCollected: 0,
  shadowImprovementFees: 0,
  uncollectedImprovementOpportunity: 0,
  userFeeDisclosureLabel: "Estimated Lotus improvement share, not collected.",
  totalFees: 0
});

export const validateExecutionRequest = (value: unknown): ExecutionRequestV0 =>
  ExecutionRequestSchema.parse(value);

export const validateExecutionLeg = (value: unknown): ExecutionLegV0 =>
  ExecutionLegSchema.parse(value);

export const validateExecutionResult = (value: unknown): ExecutionResultV0 =>
  ExecutionResultSchema.parse(value);
