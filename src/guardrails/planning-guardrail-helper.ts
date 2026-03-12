import type { Logger } from "pino";

import {
  bucketSizeLimitExceededTotal,
  graphDensityLimitExceededTotal,
  guardrailModeTransitionsTotal,
  lockWaitLimitExceededTotal,
  phase3aGuardrailShadowDivergenceTotal,
  phase3aGuardrailShadowTotal,
  phase3aGuardrailShadowWouldDegradeTotal,
  plannerLatencyBudgetExceededTotal,
} from "../observability/metrics.js";
import type { ExecutionMode, IDegradationManager, DegradationContext } from "./degradation-manager.js";
import type {
  GuardrailEvaluationResult,
  GuardrailViolation,
  GuardrailRuntimeStats,
  IGuardrailEvaluator,
} from "./guardrail-evaluator.js";
import type { PerformanceGuardrailConfig } from "./guardrail-config.js";

export interface IReplayWriteFailureStatsSource {
  getReplayWriteFailures(): number | Promise<number>;
}

export interface PlanningGuardrailDecision {
  readonly effectiveMode: ExecutionMode;
  readonly guardrailEvaluation: GuardrailEvaluationResult;
  readonly skipCurrentEngine: boolean;
  readonly reason: string;
  readonly enforcementMode: GuardrailEnforcementMode;
  readonly shadowWouldDegrade: boolean;
}

export type GuardrailEnforcementMode = "ENFORCED" | "SHADOW";

export interface EvaluatePlanningGuardrailsInput {
  readonly guardrails: PerformanceGuardrailConfig;
  readonly stats: Omit<GuardrailRuntimeStats, "replayWriteFailures">;
  readonly context: DegradationContext;
  readonly guardrailEvaluator: IGuardrailEvaluator;
  readonly degradationManager: IDegradationManager;
  readonly replayWriteFailureStatsSource: IReplayWriteFailureStatsSource | undefined;
  readonly logger: Pick<Logger, "info" | "warn" | "error">;
  readonly requestedBy?: string;
  readonly enforcementMode?: GuardrailEnforcementMode;
}

function shouldSkipEngine(engine: DegradationContext["engine"], mode: ExecutionMode): boolean {
  switch (engine) {
    case "SOR":
      return false;
    case "NETTING_PHASE2A":
      return mode === "DISABLE_PHASE2A_AND_2B" || mode === "SOR_ONLY" || mode === "SAFE_FALLBACK";
    case "CLEARING_PHASE2B":
      return (
        mode === "DISABLE_PHASE2B" ||
        mode === "DISABLE_PHASE2A_AND_2B" ||
        mode === "SOR_ONLY" ||
        mode === "SAFE_FALLBACK"
      );
    case "INTERNAL_CROSS":
      return mode === "DISABLE_INTERNAL_CROSS" || mode === "SAFE_FALLBACK";
    default:
      return false;
  }
}

export async function evaluatePlanningGuardrails(
  input: EvaluatePlanningGuardrailsInput
): Promise<PlanningGuardrailDecision> {
  const enforcementMode = input.enforcementMode ?? "ENFORCED";
  const plannerType = input.stats.plannerType;
  const replayWriteFailures = input.replayWriteFailureStatsSource
    ? await input.replayWriteFailureStatsSource.getReplayWriteFailures()
    : 0;

  const guardrailEvaluation = input.guardrailEvaluator.evaluate({
    guardrails: input.guardrails,
    stats: {
      ...input.stats,
      replayWriteFailures,
    },
  });

  const effective = await input.degradationManager.getEffectiveExecutionMode(
    {
      ...input.context,
      guardrailEvaluation,
    },
    {
      requestedBy: input.requestedBy ?? "guardrail-evaluator",
      persist: enforcementMode !== "SHADOW",
    }
  );

  const reason = effective.reason;
  const wouldSkipCurrentEngine = shouldSkipEngine(input.context.engine, effective.mode);
  const skipCurrentEngine = enforcementMode === "ENFORCED" ? wouldSkipCurrentEngine : false;
  const shadowWouldDegrade = enforcementMode === "SHADOW" && effective.mode !== "FULL_MODE";

  for (const violation of guardrailEvaluation.violations) {
    recordGuardrailViolationMetric(input.context.engine, plannerType, violation);
  }

  if (enforcementMode === "SHADOW") {
    phase3aGuardrailShadowTotal.labels(input.context.engine, enforcementMode).inc();
    if (shadowWouldDegrade) {
      phase3aGuardrailShadowWouldDegradeTotal.labels(input.context.engine, effective.mode).inc();
      phase3aGuardrailShadowDivergenceTotal.labels(input.context.engine, reason).inc();
    }
  }

  if (guardrailEvaluation.violated || effective.mode !== "FULL_MODE" || enforcementMode === "SHADOW") {
    input.logger.warn(
      {
        shardId: input.context.shardId,
        bucketId: input.context.bucketId ?? null,
        marketId: input.context.marketId ?? null,
        engine: input.context.engine,
        mode: effective.mode,
        source: effective.source,
        reason,
        skipCurrentEngine,
        wouldSkipCurrentEngine,
        enforcementMode,
        violations: guardrailEvaluation.violations,
      },
      "Planning guardrail evaluation activated a degraded execution path."
    );
  }

  if (effective.mode !== "FULL_MODE" && enforcementMode === "ENFORCED") {
    guardrailModeTransitionsTotal.labels(input.context.engine, effective.mode, reason).inc();
  }

  return {
    effectiveMode: effective.mode,
    guardrailEvaluation,
    skipCurrentEngine,
    reason,
    enforcementMode,
    shadowWouldDegrade,
  };
}

function recordGuardrailViolationMetric(
  engine: DegradationContext["engine"],
  plannerType: GuardrailRuntimeStats["plannerType"],
  violation: GuardrailViolation
): void {
  switch (violation.type) {
    case "PLANNER_LATENCY_BUDGET_EXCEEDED":
      plannerLatencyBudgetExceededTotal.labels(engine, plannerType).inc();
      return;
    case "BUCKET_TOO_LARGE":
      bucketSizeLimitExceededTotal.labels(engine, plannerType).inc();
      return;
    case "GRAPH_TOO_DENSE":
      graphDensityLimitExceededTotal.labels(engine, plannerType).inc();
      return;
    case "LOCK_WAIT_TOO_HIGH":
      lockWaitLimitExceededTotal.labels(engine, plannerType).inc();
      return;
    default:
      return;
  }
}
