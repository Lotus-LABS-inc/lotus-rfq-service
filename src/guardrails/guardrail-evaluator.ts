import {
  type PerformanceGuardrailConfig,
  validatePerformanceGuardrailConfig,
} from "./guardrail-config.js";
import type { ExecutionMode } from "../core/replay/control-plane.types.js";

export type GuardrailViolationType =
  | "PLANNER_LATENCY_BUDGET_EXCEEDED"
  | "BUCKET_TOO_LARGE"
  | "GRAPH_TOO_DENSE"
  | "CANDIDATE_ENUMERATION_TOO_LARGE"
  | "LOCK_WAIT_TOO_HIGH"
  | "REPLAY_WRITE_FAILURE_RATE_TOO_HIGH";

export type GuardrailSuggestedDegradation = Exclude<ExecutionMode, "FULL_MODE" | "DISABLE_INTERNAL_CROSS">;

export interface GuardrailViolation {
  readonly type: GuardrailViolationType;
  readonly actual: number;
  readonly threshold: number;
  readonly reason: string;
}

export interface GuardrailRuntimeStats {
  readonly plannerType: "SOR" | "NETTING_PHASE2A" | "CLEARING_PHASE2B";
  readonly plannerLatencyMs?: number | null;
  readonly bucketEntityCount?: number | null;
  readonly graphEdges?: number | null;
  readonly candidateGroups?: number | null;
  readonly lockWaitMs?: number | null;
  readonly replayWriteFailures?: number | null;
}

export interface GuardrailEvaluationInput {
  readonly guardrails: PerformanceGuardrailConfig;
  readonly stats: GuardrailRuntimeStats;
}

export interface GuardrailEvaluationResult {
  readonly violated: boolean;
  readonly violations: readonly GuardrailViolation[];
  readonly suggestedDegradation?: GuardrailSuggestedDegradation;
}

export interface GuardrailEvaluatorErrorOptions {
  readonly code: "invalid_guardrail_input";
}

export class GuardrailEvaluatorError extends Error {
  public readonly code: "invalid_guardrail_input";

  public constructor(message: string, options: GuardrailEvaluatorErrorOptions) {
    super(message);
    this.name = "GuardrailEvaluatorError";
    this.code = options.code;
  }
}

export interface IGuardrailEvaluator {
  evaluate(input: GuardrailEvaluationInput): GuardrailEvaluationResult;
}

const DEGRADATION_PRECEDENCE: readonly GuardrailSuggestedDegradation[] = [
  "SAFE_FALLBACK",
  "DISABLE_PHASE2A_AND_2B",
  "DISABLE_PHASE2B",
  "SOR_ONLY",
] as const;

export class GuardrailEvaluator implements IGuardrailEvaluator {
  public evaluate(input: GuardrailEvaluationInput): GuardrailEvaluationResult {
    validatePerformanceGuardrailConfig(input.guardrails);
    validateRuntimeStats(input.stats);

    const violations: GuardrailViolation[] = [];

    const plannerLatencyThreshold = getPlannerLatencyThreshold(
      input.guardrails,
      input.stats.plannerType,
    );
    const plannerLatencyMs = requireStat(input.stats.plannerLatencyMs, "plannerLatencyMs");
    if (plannerLatencyMs > plannerLatencyThreshold) {
      violations.push({
        type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
        actual: plannerLatencyMs,
        threshold: plannerLatencyThreshold,
        reason: `planner latency ${plannerLatencyMs}ms exceeded ${input.stats.plannerType} budget ${plannerLatencyThreshold}ms`,
      });
    }

    const bucketEntityCount = requireStat(input.stats.bucketEntityCount, "bucketEntityCount");
    if (bucketEntityCount > input.guardrails.maxBucketEntityCount) {
      violations.push({
        type: "BUCKET_TOO_LARGE",
        actual: bucketEntityCount,
        threshold: input.guardrails.maxBucketEntityCount,
        reason: `bucket entity count ${bucketEntityCount} exceeded limit ${input.guardrails.maxBucketEntityCount}`,
      });
    }

    const graphEdges = requireStat(input.stats.graphEdges, "graphEdges");
    if (graphEdges > input.guardrails.maxGraphEdges) {
      violations.push({
        type: "GRAPH_TOO_DENSE",
        actual: graphEdges,
        threshold: input.guardrails.maxGraphEdges,
        reason: `graph edges ${graphEdges} exceeded limit ${input.guardrails.maxGraphEdges}`,
      });
    }

    const candidateGroups = requireStat(input.stats.candidateGroups, "candidateGroups");
    if (candidateGroups > input.guardrails.maxCandidateGroups) {
      violations.push({
        type: "CANDIDATE_ENUMERATION_TOO_LARGE",
        actual: candidateGroups,
        threshold: input.guardrails.maxCandidateGroups,
        reason: `candidate groups ${candidateGroups} exceeded limit ${input.guardrails.maxCandidateGroups}`,
      });
    }

    const lockWaitMs = requireStat(input.stats.lockWaitMs, "lockWaitMs");
    if (lockWaitMs > input.guardrails.maxLockWaitMs) {
      violations.push({
        type: "LOCK_WAIT_TOO_HIGH",
        actual: lockWaitMs,
        threshold: input.guardrails.maxLockWaitMs,
        reason: `lock wait ${lockWaitMs}ms exceeded limit ${input.guardrails.maxLockWaitMs}ms`,
      });
    }

    const replayWriteFailures = requireStat(
      input.stats.replayWriteFailures,
      "replayWriteFailures",
    );
    if (replayWriteFailures > input.guardrails.maxReplayWriteFailuresBeforeDegrade) {
      violations.push({
        type: "REPLAY_WRITE_FAILURE_RATE_TOO_HIGH",
        actual: replayWriteFailures,
        threshold: input.guardrails.maxReplayWriteFailuresBeforeDegrade,
        reason: `replay write failures ${replayWriteFailures} exceeded limit ${input.guardrails.maxReplayWriteFailuresBeforeDegrade}`,
      });
    }

    if (violations.length === 0) {
      return {
        violated: false,
        violations: [],
      };
    }

    return {
      violated: true,
      violations,
      suggestedDegradation: selectSuggestedDegradation(violations, input.stats.plannerType),
    };
  }
}

const validateRuntimeStats = (stats: GuardrailRuntimeStats): void => {
  if (
    stats.plannerType !== "SOR" &&
    stats.plannerType !== "NETTING_PHASE2A" &&
    stats.plannerType !== "CLEARING_PHASE2B"
  ) {
    throw new GuardrailEvaluatorError(`Unsupported plannerType: ${String(stats.plannerType)}`, {
      code: "invalid_guardrail_input",
    });
  }

  ensureNonNegativeFinite(stats.plannerLatencyMs, "plannerLatencyMs");
  ensureNonNegativeFinite(stats.bucketEntityCount, "bucketEntityCount");
  ensureNonNegativeFinite(stats.graphEdges, "graphEdges");
  ensureNonNegativeFinite(stats.candidateGroups, "candidateGroups");
  ensureNonNegativeFinite(stats.lockWaitMs, "lockWaitMs");
  ensureNonNegativeFinite(stats.replayWriteFailures, "replayWriteFailures");
};

const ensureNonNegativeFinite = (value: number | null | undefined, field: string): void => {
  if (value === null || value === undefined) {
    return;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new GuardrailEvaluatorError(`${field} must be a finite number >= 0.`, {
      code: "invalid_guardrail_input",
    });
  }
};

const requireStat = (value: number | null | undefined, field: string): number => {
  if (value === null || value === undefined) {
    throw new GuardrailEvaluatorError(`${field} is required for guardrail evaluation.`, {
      code: "invalid_guardrail_input",
    });
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new GuardrailEvaluatorError(`${field} must be a finite number >= 0.`, {
      code: "invalid_guardrail_input",
    });
  }

  return value;
};

const getPlannerLatencyThreshold = (
  guardrails: PerformanceGuardrailConfig,
  plannerType: GuardrailRuntimeStats["plannerType"],
): number => {
  switch (plannerType) {
    case "SOR":
      return guardrails.maxSorPlanningLatencyMs;
    case "NETTING_PHASE2A":
      return guardrails.maxNettingPlanningLatencyMs;
    case "CLEARING_PHASE2B":
      return guardrails.maxClearingPlanningLatencyMs;
    default:
      throw new GuardrailEvaluatorError(`Unsupported plannerType: ${String(plannerType)}`, {
        code: "invalid_guardrail_input",
      });
  }
};

const getDegradationForViolation = (
  violation: GuardrailViolation,
  plannerType: GuardrailRuntimeStats["plannerType"],
): GuardrailSuggestedDegradation => {
  switch (violation.type) {
    case "REPLAY_WRITE_FAILURE_RATE_TOO_HIGH":
      return "SAFE_FALLBACK";
    case "LOCK_WAIT_TOO_HIGH":
      return "DISABLE_PHASE2A_AND_2B";
    case "CANDIDATE_ENUMERATION_TOO_LARGE":
      return "DISABLE_PHASE2B";
    case "GRAPH_TOO_DENSE":
      return "DISABLE_PHASE2B";
    case "BUCKET_TOO_LARGE":
      return "DISABLE_PHASE2B";
    case "PLANNER_LATENCY_BUDGET_EXCEEDED":
      if (plannerType === "SOR") {
        return "SOR_ONLY";
      }
      if (plannerType === "NETTING_PHASE2A") {
        return "DISABLE_PHASE2A_AND_2B";
      }
      return "DISABLE_PHASE2B";
    default:
      throw new GuardrailEvaluatorError(`Unsupported violation type: ${String(violation.type)}`, {
        code: "invalid_guardrail_input",
      });
  }
};

const selectSuggestedDegradation = (
  violations: readonly GuardrailViolation[],
  plannerType: GuardrailRuntimeStats["plannerType"],
): GuardrailSuggestedDegradation => {
  const degradations = violations.map((violation) =>
    getDegradationForViolation(violation, plannerType),
  );

  for (const degradation of DEGRADATION_PRECEDENCE) {
    if (degradations.includes(degradation)) {
      return degradation;
    }
  }

  throw new GuardrailEvaluatorError("Unable to determine suggested degradation.", {
    code: "invalid_guardrail_input",
  });
};
