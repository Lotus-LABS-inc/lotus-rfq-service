import { describe, expect, it } from "vitest";

import { createPerformanceGuardrailConfig } from "../../src/guardrails/guardrail-config.js";
import {
  GuardrailEvaluator,
  GuardrailEvaluatorError,
  type GuardrailViolation,
  type GuardrailRuntimeStats,
} from "../../src/guardrails/guardrail-evaluator.js";

const baseGuardrails = createPerformanceGuardrailConfig({
  version: "guardrails-v1",
  maxSorPlanningLatencyMs: 25,
  maxNettingPlanningLatencyMs: 40,
  maxClearingPlanningLatencyMs: 60,
  maxBucketEntityCount: 100,
  maxGraphEdges: 500,
  maxCandidateGroups: 200,
  maxLockWaitMs: 15,
  maxLockHoldMs: 30,
  maxReplayWriteFailuresBeforeDegrade: 3,
  degradationPolicyVersion: "degradation-v1",
});

const buildStats = (overrides: Partial<GuardrailRuntimeStats>): GuardrailRuntimeStats => ({
  plannerType: "SOR",
  plannerLatencyMs: 10,
  bucketEntityCount: 50,
  graphEdges: 100,
  candidateGroups: 10,
  lockWaitMs: 5,
  replayWriteFailures: 0,
  ...overrides,
});

describe("GuardrailEvaluator", () => {
  it("flags SOR planner latency budget exceeded", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        plannerType: "SOR",
        plannerLatencyMs: 26,
      }),
    });

    expect(result.violated).toBe(true);
    expect(result.violations).toEqual([
      expect.objectContaining({
        type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
        actual: 26,
        threshold: 25,
      }),
    ]);
    expect(result.suggestedDegradation).toBe("SOR_ONLY");
  });

  it("flags Phase 2A planner latency budget exceeded", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        plannerType: "NETTING_PHASE2A",
        plannerLatencyMs: 41,
      }),
    });

    expect(result.violations[0]?.type).toBe("PLANNER_LATENCY_BUDGET_EXCEEDED");
    expect(result.violations[0]?.threshold).toBe(40);
    expect(result.suggestedDegradation).toBe("DISABLE_PHASE2A_AND_2B");
  });

  it("flags Phase 2B planner latency budget exceeded", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        plannerType: "CLEARING_PHASE2B",
        plannerLatencyMs: 61,
      }),
    });

    expect(result.violations[0]?.type).toBe("PLANNER_LATENCY_BUDGET_EXCEEDED");
    expect(result.violations[0]?.threshold).toBe(60);
    expect(result.suggestedDegradation).toBe("DISABLE_PHASE2B");
  });

  it("flags bucket too large", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        bucketEntityCount: 101,
      }),
    });

    expect(result.violations[0]?.type).toBe("BUCKET_TOO_LARGE");
    expect(result.suggestedDegradation).toBe("DISABLE_PHASE2B");
  });

  it("flags graph too dense via graph edges threshold", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        graphEdges: 501,
      }),
    });

    expect(result.violations[0]?.type).toBe("GRAPH_TOO_DENSE");
    expect(result.suggestedDegradation).toBe("DISABLE_PHASE2B");
  });

  it("flags candidate enumeration too large", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        candidateGroups: 201,
      }),
    });

    expect(result.violations[0]?.type).toBe("CANDIDATE_ENUMERATION_TOO_LARGE");
    expect(result.suggestedDegradation).toBe("DISABLE_PHASE2B");
  });

  it("flags lock wait too high", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        lockWaitMs: 16,
      }),
    });

    expect(result.violations[0]?.type).toBe("LOCK_WAIT_TOO_HIGH");
    expect(result.suggestedDegradation).toBe("DISABLE_PHASE2A_AND_2B");
  });

  it("flags replay write failure count too high", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        replayWriteFailures: 4,
      }),
    });

    expect(result.violations[0]?.type).toBe("REPLAY_WRITE_FAILURE_RATE_TOO_HIGH");
    expect(result.suggestedDegradation).toBe("SAFE_FALLBACK");
  });

  it("returns no violations when stats are within guardrails", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({}),
    });

    expect(result).toEqual({
      violated: false,
      violations: [],
    });
  });

  it("chooses the most conservative degradation when multiple violations exist", () => {
    const evaluator = new GuardrailEvaluator();

    const result = evaluator.evaluate({
      guardrails: baseGuardrails,
      stats: buildStats({
        plannerType: "SOR",
        plannerLatencyMs: 26,
        candidateGroups: 250,
        replayWriteFailures: 5,
      }),
    });

    expect(result.violated).toBe(true);
    expect(result.violations.map((violation: GuardrailViolation) => violation.type)).toEqual([
      "PLANNER_LATENCY_BUDGET_EXCEEDED",
      "CANDIDATE_ENUMERATION_TOO_LARGE",
      "REPLAY_WRITE_FAILURE_RATE_TOO_HIGH",
    ]);
    expect(result.suggestedDegradation).toBe("SAFE_FALLBACK");
  });

  it("fails closed when a required stat is missing", () => {
    const evaluator = new GuardrailEvaluator();
    const { graphEdges, ...statsWithoutGraphEdges } = buildStats({});

    expect(() =>
      evaluator.evaluate({
        guardrails: baseGuardrails,
        stats: statsWithoutGraphEdges,
      }),
    ).toThrowError(GuardrailEvaluatorError);
  });

  it("fails closed when a stat is negative", () => {
    const evaluator = new GuardrailEvaluator();

    expect(() =>
      evaluator.evaluate({
        guardrails: baseGuardrails,
        stats: buildStats({
          lockWaitMs: -1,
        }),
      }),
    ).toThrowError(GuardrailEvaluatorError);
  });

  it("fails closed when a stat is non-finite", () => {
    const evaluator = new GuardrailEvaluator();

    expect(() =>
      evaluator.evaluate({
        guardrails: baseGuardrails,
        stats: buildStats({
          plannerLatencyMs: Number.POSITIVE_INFINITY,
        }),
      }),
    ).toThrowError(GuardrailEvaluatorError);
  });
});
