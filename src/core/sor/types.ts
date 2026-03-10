import { z } from "zod";

export type UUID = string;
export type CanonicalSide = "buy" | "sell";
export type SORAcceptancePolicy = "ALL_OR_NONE" | "PARTIAL_ALLOWED" | "BEST_EFFORT";
export type STPMode = "CANCEL_NEWEST" | "CANCEL_OLDEST" | "CANCEL_BOTH" | "NONE";
export enum LiquiditySource {
  LP = "LP",
  VENUE = "VENUE",
  INTERNAL_CROSS = "INTERNAL_CROSS"
}

export type RoutingPlanStatus =
  | "DRAFT"
  | "RESERVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "UNWOUND";

export type PlanStepStatus =
  | "PENDING"
  | "EXECUTING"
  | "FILLED"
  | "FAILED"
  | "SKIPPED"
  | "UNWOUND";

export const CanonicalRFQInputSchema = z.object({
  rfqId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  canonicalMarketId: z.string(),
  canonicalOutcomeId: z.string().optional(),
  takerId: z.string().uuid(),
  side: z.enum(["buy", "sell"]),
  quantity: z.string(),
  stpMode: z.enum(["CANCEL_NEWEST", "CANCEL_OLDEST", "CANCEL_BOTH", "NONE"]).default("CANCEL_NEWEST"),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CanonicalRFQInput = z.infer<typeof CanonicalRFQInputSchema>;

export const SelectedQuoteInputSchema = z.object({
  quoteId: z.string().min(1),
  lpId: z.string().optional(),
  price: z.number(),
  quantity: z.number().positive(),
  feeBps: z.number().int().nonnegative().default(0),
  validUntil: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});

export type SelectedQuoteInput = z.infer<typeof SelectedQuoteInputSchema>;

export const RouteCandidateSchema = z.object({
  id: z.string().uuid(),
  leg_id: z.string().uuid(),
  provider_type: z.enum(["LP", "VENUE", "INTERNAL"]),
  provider_id: z.string().min(1),
  available_size: z.number().nonnegative(),
  quoted_price: z.number().nonnegative(),
  fees: z.record(z.string(), z.number().nonnegative()),
  latency_ms: z.number().int().nonnegative(),
  fill_prob: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type RouteCandidate = z.infer<typeof RouteCandidateSchema>;

export const PlanStepSchema = z.object({
  id: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  providerType: z.enum(["LP", "VENUE", "INTERNAL"]),
  providerId: z.string().min(1),
  candidateId: z.string().uuid().optional(),
  targetSize: z.number().nonnegative(),
  roundedSize: z.number().nonnegative(),
  targetPrice: z.number(),
  idempotencyKey: z.string().min(1),
  state: z.enum(["PENDING", "EXECUTING", "FILLED", "FAILED", "SKIPPED", "UNWOUND"]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string().uuid(),
  rfqId: z.string().uuid(),
  acceptancePolicy: z.enum(["ALL_OR_NONE", "PARTIAL_ALLOWED", "BEST_EFFORT"]),
  steps: z.array(PlanStepSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.date()
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export interface CostBreakdown {
  effectiveUnitCost: number;
  basePrice: number;
  providerFee: number;
  protocolFee: number;
  gasCost: number;
  latencyPenalty: number;
  failurePenalty: number;
}

export interface CandidateScore {
  candidateId: UUID;
  providerId: string;
  effectiveUnitCost: number;
  totalExpectedCost: number;
  breakdown: CostBreakdown;
}

export interface SplitAllocation {
  candidateId: UUID;
  providerId: string;
  targetSize: number;
  roundedSize: number;
  targetPrice: number;
}

export interface PlanComposerInput {
  rfq: CanonicalRFQInput;
  selectedQuote: SelectedQuoteInput;
  policy: SORAcceptancePolicy;
  reservationToken: string;
  createdBy: string;
  routeCandidates: readonly RouteCandidate[];
  scoredCandidates: readonly CandidateScore[];
  allocations: readonly SplitAllocation[];
}

export interface PlanExecutionResult {
  planId: UUID;
  rfqId: UUID;
  status: "COMPLETED" | "FAILED" | "UNWOUND" | "PARTIAL";
  failureReason?: string;
}

export interface PersistedRoutingPlan {
  id: string;
  rfq_id: string;
  acceptance_policy: SORAcceptancePolicy;
  reservation_token: string | null;
  state: RoutingPlanStatus;
  metadata: Record<string, unknown> | null;
}

export interface PersistedRouteStep {
  id: string;
  routing_plan_id: string;
  leg_id: string;
  step_index: number;
  provider_type: "LP" | "VENUE" | "INTERNAL";
  provider_id: string;
  target_size: string;
  client_order_id: string;
  idempotency_key: string;
  state: PlanStepStatus;
  submitted_at: Date | null;
  completed_at: Date | null;
  result: Record<string, unknown> | null;
}

export interface PersistedRouteCandidate {
  id: string;
  routing_plan_id: string;
  leg_id: string;
  provider_type: "LP" | "VENUE" | "INTERNAL";
  provider_id: string;
  available_size: string;
  quoted_price: string;
  fees: Record<string, number> | null;
  latency_ms: number | null;
  fill_prob: string | number | null;
  metadata: Record<string, unknown> | null;
}

export interface IOrderRouter {
  buildPlan(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<ExecutionPlan>;
}

export interface IRouteScout {
  discoverCandidates(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy,
    options?: { forceRefresh?: boolean }
  ): Promise<readonly RouteCandidate[]>;
}

export interface ICostModel {
  evaluateCandidates(
    rfq: CanonicalRFQInput,
    candidates: readonly RouteCandidate[],
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<readonly CandidateScore[]>;
}

export interface ISplitter {
  split(
    targetSize: number,
    scoredCandidates: readonly CandidateScore[],
    options: {
      minChunkSize: number;
      tickSize: number;
      perProviderCapacity: Readonly<Record<string, number>>;
    }
  ): Promise<readonly SplitAllocation[]>;
}

export interface IPlanComposer {
  /**
   * Composes an execution plan based on the provided RFQ, candidates, scores, and policy.
   *
   * PERSISTENCE: This method MUST be implemented idempotently.
   * If a plan with the derived deterministic ID already exists, it should return the existing plan.
   */
  composePlan(
    rfq: CanonicalRFQInput,
    candidates: readonly RouteCandidate[],
    scores: readonly CandidateScore[],
    allocations: readonly SplitAllocation[],
    policy: SORAcceptancePolicy
  ): Promise<ExecutionPlan>;
}

export interface IPlanRunner {
  run(plan: ExecutionPlan): Promise<PlanExecutionResult>;
  finalizeOrUnwind(plan: ExecutionPlan, reason?: string): Promise<PlanExecutionResult>;
}

export interface IExecutionRouter {
  executeStep(step: PlanStep, plan: ExecutionPlan): Promise<{
    ok: boolean;
    executionRef?: string;
    error?: string;
  }>;
}

// Compatibility aliases retained for existing imports during scaffold stage.
export type RouteStep = PlanStep;
export type RoutingPlan = ExecutionPlan;
