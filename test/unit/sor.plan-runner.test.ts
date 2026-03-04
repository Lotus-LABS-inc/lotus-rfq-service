import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanRunner } from "../../src/core/sor/plan-runner.js";
import type {
  ExecutionPlan,
  PersistedRouteCandidate,
  PersistedRouteStep,
  PersistedRoutingPlan
} from "../../src/core/sor/types.js";
import {
  metricsRegistry,
  sorAvgFillRate5mSnapshot,
  sorPlanFailureTotal,
  sorPlanSuccessTotal,
  sorPlanUnwindTotal,
  sorStepFallbackTotal,
  sorStepRetriesTotal
} from "../../src/observability/metrics.js";

interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

interface InMemoryStore {
  plan: PersistedRoutingPlan;
  steps: PersistedRouteStep[];
  candidates: PersistedRouteCandidate[];
  history: Array<{ event_type: string; payload: Record<string, unknown> }>;
}

const createStore = (
  policy: PersistedRoutingPlan["acceptance_policy"] = "BEST_EFFORT"
): InMemoryStore => ({
  plan: {
    id: "14111111-1111-4111-8111-111111111111",
    rfq_id: "25111111-1111-4111-8111-111111111111",
    acceptance_policy: policy,
    reservation_token: "reservation-token-1",
    state: "DRAFT",
    metadata: {}
  },
  steps: [
    {
      id: "36111111-1111-4111-8111-111111111111",
      routing_plan_id: "14111111-1111-4111-8111-111111111111",
      leg_id: "47111111-1111-4111-8111-111111111111",
      step_index: 0,
      provider_type: "LP",
      provider_id: "lp-primary",
      target_size: "5",
      client_order_id: "order-1",
      idempotency_key: "idemp-1",
      state: "PENDING",
      submitted_at: null,
      completed_at: null,
      result: null
    },
    {
      id: "58111111-1111-4111-8111-111111111111",
      routing_plan_id: "14111111-1111-4111-8111-111111111111",
      leg_id: "69111111-1111-4111-8111-111111111111",
      step_index: 1,
      provider_type: "LP",
      provider_id: "lp-secondary",
      target_size: "4",
      client_order_id: "order-2",
      idempotency_key: "idemp-2",
      state: "PENDING",
      submitted_at: null,
      completed_at: null,
      result: null
    }
  ],
  candidates: [
    {
      id: "7a111111-1111-4111-8111-111111111111",
      routing_plan_id: "14111111-1111-4111-8111-111111111111",
      leg_id: "47111111-1111-4111-8111-111111111111",
      provider_type: "LP",
      provider_id: "lp-primary",
      available_size: "5",
      quoted_price: "1.01",
      fees: {},
      latency_ms: 2,
      fill_prob: "0.8",
      metadata: {}
    },
    {
      id: "8b111111-1111-4111-8111-111111111111",
      routing_plan_id: "14111111-1111-4111-8111-111111111111",
      leg_id: "47111111-1111-4111-8111-111111111111",
      provider_type: "LP",
      provider_id: "lp-fallback",
      available_size: "5",
      quoted_price: "1.03",
      fees: {},
      latency_ms: 3,
      fill_prob: "0.7",
      metadata: {}
    }
  ],
  history: []
});

const createPool = (store: InMemoryStore) => {
  const query = vi.fn(
    async <T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = []
    ): Promise<QueryResult<T>> => {
      if (sql.startsWith("/*sor.load_plan*/")) {
        return { rows: [store.plan as unknown as T], rowCount: 1 };
      }
      if (sql.startsWith("/*sor.load_steps*/")) {
        return { rows: [...store.steps] as unknown as T[], rowCount: store.steps.length };
      }
      if (sql.startsWith("/*sor.get_step_by_id*/")) {
        const id = params[0] as string;
        const step = store.steps.find((entry) => entry.id === id);
        return { rows: step ? [step as unknown as T] : [], rowCount: step ? 1 : 0 };
      }
      if (sql.startsWith("/*sor.mark_step_executing*/")) {
        const id = params[0] as string;
        const step = store.steps.find((entry) => entry.id === id);
        if (!step || !["PENDING", "FAILED"].includes(step.state)) {
          return { rows: [], rowCount: 0 };
        }
        step.state = "EXECUTING";
        step.submitted_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("/*sor.mark_step_filled*/")) {
        const id = params[0] as string;
        const payload = JSON.parse(params[1] as string) as Record<string, unknown>;
        const step = store.steps.find((entry) => entry.id === id);
        if (step) {
          step.state = "FILLED";
          step.completed_at = new Date();
          step.result = payload;
        }
        return { rows: [], rowCount: step ? 1 : 0 };
      }
      if (sql.startsWith("/*sor.mark_step_failed*/")) {
        const id = params[0] as string;
        const payload = JSON.parse(params[1] as string) as Record<string, unknown>;
        const step = store.steps.find((entry) => entry.id === id);
        if (step) {
          step.state = "FAILED";
          step.completed_at = new Date();
          step.result = payload;
        }
        return { rows: [], rowCount: step ? 1 : 0 };
      }
      if (sql.startsWith("/*sor.update_plan_state*/")) {
        const state = params[1] as PersistedRoutingPlan["state"];
        const metadataPatch = JSON.parse(params[2] as string) as Record<string, unknown>;
        store.plan.state = state;
        store.plan.metadata = {
          ...(store.plan.metadata ?? {}),
          ...metadataPatch
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("/*sor.insert_route_history*/")) {
        store.history.push({
          event_type: params[1] as string,
          payload: JSON.parse(params[2] as string) as Record<string, unknown>
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("/*sor.load_candidates_by_leg*/")) {
        const legId = params[1] as string;
        const rows = store.candidates
          .filter((candidate) => candidate.leg_id === legId)
          .sort((left, right) => Number(left.quoted_price) - Number(right.quoted_price));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (sql.startsWith("/*sor.load_next_step_index*/")) {
        const nextIndex =
          Math.max(...store.steps.map((entry) => entry.step_index), -1) + 1;
        return { rows: [{ next_index: nextIndex } as unknown as T], rowCount: 1 };
      }
      if (sql.startsWith("/*sor.load_rfq_session*/")) {
        return {
          rows: [
            {
              taker_id: "taker-1",
              canonical_market_id: "market-1",
              side: "buy"
            } as unknown as T
          ],
          rowCount: 1
        };
      }
      if (sql.startsWith("/*sor.insert_fallback_step*/")) {
        const step: PersistedRouteStep = {
          id: params[0] as string,
          routing_plan_id: params[1] as string,
          leg_id: params[2] as string,
          step_index: params[3] as number,
          provider_type: params[4] as PersistedRouteStep["provider_type"],
          provider_id: params[5] as string,
          target_size: params[6] as string,
          client_order_id: params[7] as string,
          idempotency_key: params[8] as string,
          state: params[9] as PersistedRouteStep["state"],
          submitted_at: null,
          completed_at: null,
          result: JSON.parse(params[10] as string) as Record<string, unknown>
        };
        store.steps.push(step);
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL in test harness: ${sql}`);
    }
  );

  const client = {
    query,
    release: vi.fn()
  };

  return {
    query,
    pool: {
      connect: vi.fn(async () => client)
    }
  };
};

const executionPlan: ExecutionPlan = {
  id: "14111111-1111-4111-8111-111111111111",
  rfqId: "25111111-1111-4111-8111-111111111111",
  acceptancePolicy: "BEST_EFFORT",
  steps: [],
  createdAt: new Date("2026-03-04T10:00:00.000Z")
};

describe("SOR PlanRunner", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("executes persisted steps successfully and marks plan completed", async () => {
    const store = createStore("BEST_EFFORT");
    const { pool } = createPool(store);

    const executeStep = vi.fn(async () => ({ ok: true as const, executionRef: "exec-1" }));
    const updateExposureAfterExecution = vi.fn(async () => {});
    const redisSet = vi.fn(async () => "OK" as const);
    const redisDel = vi.fn(async () => 1);

    const runner = new PlanRunner({
      pool: pool as never,
      redis: {
        set: redisSet,
        del: redisDel
      } as never,
      executionRouter: { executeStep } as never,
      riskEngine: { updateExposureAfterExecution } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        concurrency: 2,
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const result = await runner.run(executionPlan);

    expect(result.status).toBe("COMPLETED");
    expect(store.plan.state).toBe("COMPLETED");
    expect(store.steps.every((step) => step.state === "FILLED")).toBe(true);
    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(updateExposureAfterExecution).toHaveBeenCalledTimes(2);
    expect(redisSet).toHaveBeenCalledTimes(2);

    const successMetric = await sorPlanSuccessTotal.get();
    const completedCount = successMetric.values.find(
      (value) => value.labels.status === "COMPLETED"
    );
    expect(completedCount?.value).toBe(1);

    const fillRate = await sorAvgFillRate5mSnapshot.get();
    expect(fillRate.values[0]?.value).toBeGreaterThan(0);
  });

  it("uses fallback provider when primary step persistently fails", async () => {
    const store = createStore("BEST_EFFORT");
    store.steps = [store.steps[0]].filter(Boolean) as PersistedRouteStep[];
    const { pool } = createPool(store);

    const executeStep = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: "provider_down" })
      .mockResolvedValueOnce({ ok: true as const, executionRef: "fallback-exec" });
    const updateExposureAfterExecution = vi.fn(async () => {});

    const runner = new PlanRunner({
      pool: pool as never,
      redis: {
        set: vi.fn(async () => "OK" as const),
        del: vi.fn(async () => 1)
      } as never,
      executionRouter: { executeStep } as never,
      riskEngine: { updateExposureAfterExecution } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        concurrency: 1,
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const result = await runner.run(executionPlan);

    expect(result.status).toBe("COMPLETED");
    expect(store.steps.some((step) => step.provider_id === "lp-fallback")).toBe(true);
    expect(store.history.some((entry) => entry.event_type === "ROUTE_STEP_FALLBACK_CREATED")).toBe(
      true
    );
    expect(executeStep).toHaveBeenCalledTimes(2);

    const fallbackMetric = await sorStepFallbackTotal.get();
    expect(fallbackMetric.values.some((value) => value.labels.to_provider_id === "lp-fallback")).toBe(
      true
    );
  });

  it("increments retry counter on step retry", async () => {
    const store = createStore("BEST_EFFORT");
    store.steps = [store.steps[0]].filter(Boolean) as PersistedRouteStep[];
    const { pool } = createPool(store);

    const executeStep = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: "temporary_failure" })
      .mockResolvedValueOnce({ ok: true as const, executionRef: "after-retry" });

    const runner = new PlanRunner({
      pool: pool as never,
      redis: {
        set: vi.fn(async () => "OK" as const),
        del: vi.fn(async () => 1)
      } as never,
      executionRouter: { executeStep } as never,
      riskEngine: { updateExposureAfterExecution: vi.fn(async () => {}) } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        concurrency: 1,
        retry: { maxRetries: 1, baseDelayMs: 1 }
      }
    });

    const result = await runner.run(executionPlan);
    expect(result.status).toBe("COMPLETED");

    const retryMetric = await sorStepRetriesTotal.get();
    expect(retryMetric.values.some((value) => value.labels.provider_id === "lp-primary")).toBe(
      true
    );
  });

  it("is idempotent on re-run by skipping already filled steps", async () => {
    const store = createStore("BEST_EFFORT");
    const { pool } = createPool(store);

    const executeStep = vi.fn(async () => ({ ok: true as const, executionRef: "exec-retry" }));
    const updateExposureAfterExecution = vi.fn(async () => {});

    const runner = new PlanRunner({
      pool: pool as never,
      redis: {
        set: vi.fn(async () => "OK" as const),
        del: vi.fn(async () => 1)
      } as never,
      executionRouter: { executeStep } as never,
      riskEngine: { updateExposureAfterExecution } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        concurrency: 2,
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const first = await runner.run(executionPlan);
    const second = await runner.run(executionPlan);

    expect(first.status).toBe("COMPLETED");
    expect(second.status).toBe("COMPLETED");
    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(updateExposureAfterExecution).toHaveBeenCalledTimes(2);
  });

  it("marks plan unwound on ALL_OR_NONE persistent failure", async () => {
    const store = createStore("ALL_OR_NONE");
    store.steps = [store.steps[0]].filter(Boolean) as PersistedRouteStep[];
    store.candidates = [store.candidates[0]].filter(Boolean) as PersistedRouteCandidate[];
    const { pool } = createPool(store);

    const executeStep = vi.fn(async () => ({ ok: false as const, error: "hard_failure" }));

    const runner = new PlanRunner({
      pool: pool as never,
      redis: {
        set: vi.fn(async () => "OK" as const),
        del: vi.fn(async () => 1)
      } as never,
      executionRouter: { executeStep } as never,
      riskEngine: { updateExposureAfterExecution: vi.fn(async () => {}) } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        concurrency: 1,
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const result = await runner.run({
      ...executionPlan,
      acceptancePolicy: "ALL_OR_NONE"
    });

    expect(result.status).toBe("UNWOUND");
    expect(store.plan.state).toBe("UNWOUND");
    expect(
      store.history.some((entry) => entry.event_type === "ROUTE_UNWIND_REQUIRED")
    ).toBe(true);

    const unwindMetric = await sorPlanUnwindTotal.get();
    expect(unwindMetric.values.some((value) => value.labels.reason === "persistent_step_failure")).toBe(
      true
    );
    const failureMetric = await sorPlanFailureTotal.get();
    expect(
      failureMetric.values.some(
        (value) => value.labels.status === "UNWOUND"
      )
    ).toBe(true);
  });
});
