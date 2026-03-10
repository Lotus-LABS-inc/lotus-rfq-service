import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { RedisClient } from "../../db/redis.js";
import type { IRiskEngine } from "../risk-engine.js";
import {
  executionFailureTotal,
  executionLatencyMs,
  executionSuccessTotal,
  lockWaitTimeMs,
  sorAvgFillRate5mSnapshot,
  sorPlanFailureTotal,
  sorPlanSuccessTotal,
  sorPlanUnwindTotal,
  sorStepFallbackTotal,
  sorStepRetriesTotal
} from "../../observability/metrics.js";
import { withSpan } from "../../observability/tracing.js";
import type {
  ExecutionPlan,
  IExecutionRouter,
  IPlanRunner,
  PersistedRouteCandidate,
  PersistedRouteStep,
  PersistedRoutingPlan,
  PlanExecutionResult,
  PlanStep,
  PlanStepStatus
} from "./types.js";

const PlanRunnerInputSchema = z.object({
  id: z.string().uuid(),
  rfqId: z.string().uuid()
});

const TERMINAL_STEP_STATES: ReadonlySet<PlanStepStatus> = new Set(["FILLED", "SKIPPED", "UNWOUND"]);
const TERMINAL_PLAN_STATES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "UNWOUND"]);

interface PlanRunnerRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

interface PlanRunnerConfig {
  concurrency: number;
  stepTimeoutMs: number;
  lockTtlMs: number;
  retry: PlanRunnerRetryConfig;
}

interface PlanRunnerDependencies {
  pool: Pool;
  redis: RedisClient;
  executionRouter: IExecutionRouter;
  riskEngine: IRiskEngine;
  logger: Pick<Logger, "info" | "warn" | "error">;
  config?: Partial<PlanRunnerConfig>;
  now?: () => Date;
}

interface StepAttemptResult {
  status: "FILLED" | "FAILED" | "SKIPPED";
  usedFallback: boolean;
  reason?: string;
}

const PLAN_RUNNER_DEFAULTS: PlanRunnerConfig = {
  concurrency: 4,
  stepTimeoutMs: 3000,
  lockTtlMs: 10000,
  retry: {
    maxRetries: 2,
    baseDelayMs: 100
  }
};

let sorFillRateSnapshot = 1;

export class PlanRunner implements IPlanRunner {
  private readonly now: () => Date;
  private readonly config: PlanRunnerConfig;

  public constructor(private readonly deps: PlanRunnerDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.config = {
      ...PLAN_RUNNER_DEFAULTS,
      ...(deps.config ?? {}),
      retry: {
        ...PLAN_RUNNER_DEFAULTS.retry,
        ...(deps.config?.retry ?? {})
      }
    };
  }

  public async run(plan: ExecutionPlan): Promise<PlanExecutionResult> {
    const parsedPlan = PlanRunnerInputSchema.parse(plan);

    return withSpan(
      "sor.plan.run",
      {
        rfq_id: parsedPlan.rfqId,
        state: "RUNNING",
        plan_id: parsedPlan.id
      },
      async () => {
        const persistedPlan = await this.loadPlan(parsedPlan.id);
        if (TERMINAL_PLAN_STATES.has(persistedPlan.state)) {
          return this.mapPlanStateToResult(persistedPlan, plan.rfqId);
        }

        await this.insertRouteHistory(parsedPlan.id, "ROUTE_RUN_CONTEXT", {
          rfq_id: plan.rfqId,
          reservation_token: persistedPlan.reservation_token
        });
        await this.updatePlanState(parsedPlan.id, "RUNNING");
        await this.insertRouteHistory(parsedPlan.id, "ROUTE_RUN_STARTED", {
          rfq_id: plan.rfqId
        });

        const initialSteps = await this.loadPlanSteps(parsedPlan.id);
        const executableSteps = initialSteps.filter((step) => !TERMINAL_STEP_STATES.has(step.state));
        await this.runWithConcurrency(executableSteps, this.config.concurrency, async (step) => {
          await this.executeStepWithFallback(plan, step);
        });

        const finalSteps = await this.loadPlanSteps(parsedPlan.id);

        return this.resolvePlanResult(plan, persistedPlan.acceptance_policy, finalSteps);
      }
    );
  }

  public async finalizeOrUnwind(plan: ExecutionPlan, reason?: string): Promise<PlanExecutionResult> {
    return withSpan(
      "sor.plan.finalize",
      {
        rfq_id: plan.rfqId,
        state: "UNWOUND",
        plan_id: plan.id
      },
      async () => {
        await this.insertRouteHistory(plan.id, "ROUTE_UNWIND_STARTED", {
          rfq_id: plan.rfqId,
          reason: reason ?? "unknown"
        });
        await this.insertRouteHistory(plan.id, "ROUTE_UNWIND_REQUIRED", {
          rfq_id: plan.rfqId,
          reason: reason ?? "persistent_failure"
        });
        sorPlanUnwindTotal.labels(reason ?? "persistent_failure").inc();
        sorPlanFailureTotal.labels("UNWOUND", reason ?? "persistent_failure").inc();
        await this.updatePlanState(plan.id, "UNWOUND");
        await this.insertRouteHistory(plan.id, "ROUTE_UNWIND_COMPLETED", {
          rfq_id: plan.rfqId,
          mode: "operator_intervention"
        });

        return {
          planId: plan.id,
          rfqId: plan.rfqId,
          status: "UNWOUND",
          ...(reason ? { failureReason: reason } : {})
        };
      }
    );
  }

  private async executeStepWithFallback(plan: ExecutionPlan, step: PersistedRouteStep): Promise<void> {
    const attemptedProviders = new Set<string>();
    let currentStep = step;
    while (true) {
      attemptedProviders.add(currentStep.provider_id);
      const result = await this.executeSingleStep(plan, currentStep);
      if (result.status === "FILLED" || result.status === "SKIPPED") {
        return;
      }

      const fallback = await this.createFallbackStep(plan.id, currentStep, attemptedProviders);
      if (!fallback) {
        return;
      }

      await this.insertRouteHistory(plan.id, "ROUTE_STEP_FALLBACK_CREATED", {
        step_id: currentStep.id,
        fallback_step_id: fallback.id,
        leg_id: currentStep.leg_id
      });
      sorStepFallbackTotal.labels(
        currentStep.provider_id,
        fallback.provider_id,
        currentStep.leg_id
      ).inc();
      currentStep = fallback;
    }
  }

  private async executeSingleStep(plan: ExecutionPlan, step: PersistedRouteStep): Promise<StepAttemptResult> {
    const lockKey = `route_step:${step.id}:lock`;
    const lockToken = randomUUID();
    const lockWaitStart = performance.now();
    const lockResult = await withSpan(
      "sor.step.lock",
      {
        rfq_id: plan.rfqId,
        state: "LOCKING",
        plan_id: plan.id,
        step_id: step.id,
        provider_id: step.provider_id
      },
      async () => this.deps.redis.set(lockKey, lockToken, "PX", this.config.lockTtlMs, "NX")
    );
    lockWaitTimeMs.observe(performance.now() - lockWaitStart);

    if (lockResult !== "OK") {
      await this.insertRouteHistory(plan.id, "ROUTE_STEP_LOCK_SKIPPED", {
        step_id: step.id,
        provider_id: step.provider_id
      });
      return { status: "SKIPPED", usedFallback: false, reason: "lock_not_acquired" };
    }

    try {
      const refreshed = await this.getStepById(step.id);
      if (!refreshed || TERMINAL_STEP_STATES.has(refreshed.state)) {
        return { status: "SKIPPED", usedFallback: false, reason: "already_terminal" };
      }

      const transitioned = await this.markStepExecuting(refreshed.id);
      if (!transitioned) {
        return { status: "SKIPPED", usedFallback: false, reason: "state_race" };
      }

      const transientErrors: string[] = [];
      const maxAttempts = this.config.retry.maxRetries + 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = performance.now();
        try {
          const result = await withSpan(
            "sor.plan_runner.step_execute",
            {
              rfq_id: plan.rfqId,
              state: "EXECUTING",
              plan_id: plan.id,
              step_id: refreshed.id,
              provider_id: refreshed.provider_id
            },
            async () =>
              this.withTimeout(
                this.deps.executionRouter.executeStep(this.toPlanStep(refreshed), plan),
                this.config.stepTimeoutMs
              )
          );
          executionLatencyMs.observe(performance.now() - startedAt);

          if (result.ok) {
            const persistedPlan = await this.loadPlan(plan.id);
            await this.markStepFilled(refreshed.id, {
              execution_ref: result.executionRef ?? null,
              provider_id: refreshed.provider_id,
              reservation_token: persistedPlan.reservation_token
            });
            await this.updateRiskAfterStepSuccess(plan, refreshed);
            executionSuccessTotal.inc();
            await this.insertRouteHistory(plan.id, "ROUTE_STEP_FILLED", {
              step_id: refreshed.id,
              provider_id: refreshed.provider_id
            });
            return { status: "FILLED", usedFallback: false };
          }

          transientErrors.push(result.error ?? "execution_failed");
        } catch (error) {
          transientErrors.push(error instanceof Error ? error.message : "unknown_execution_error");
        }

        if (attempt < maxAttempts) {
          sorStepRetriesTotal.labels(refreshed.provider_type, refreshed.provider_id).inc();
          await withSpan(
            "sor.step.retry",
            {
              rfq_id: plan.rfqId,
              state: "RETRYING",
              plan_id: plan.id,
              step_id: refreshed.id,
              provider_id: refreshed.provider_id
            },
            async () => {
              await this.delay(this.config.retry.baseDelayMs * 2 ** (attempt - 1));
            }
          );
        }
      }

      const failureReason = transientErrors.at(-1) ?? "execution_failed";
      await this.markStepFailed(refreshed.id, {
        reason: failureReason,
        attempts: transientErrors.length
      });
      executionFailureTotal.inc();
      await this.insertRouteHistory(plan.id, "ROUTE_STEP_FAILED", {
        step_id: refreshed.id,
        provider_id: refreshed.provider_id,
        reason: failureReason
      });
      return {
        status: "FAILED",
        usedFallback: false,
        reason: failureReason
      };
    } finally {
      await this.deps.redis.del(lockKey);
    }
  }

  private async resolvePlanResult(
    plan: ExecutionPlan,
    policy: PersistedRoutingPlan["acceptance_policy"],
    steps: readonly PersistedRouteStep[]
  ): Promise<PlanExecutionResult> {
    const filled = steps.filter((step) => step.state === "FILLED").length;
    const failed = steps.filter((step) => step.state === "FAILED").length;
    const allLegIds = new Set(steps.map((step) => step.leg_id));
    const filledLegIds = new Set(
      steps.filter((step) => step.state === "FILLED").map((step) => step.leg_id)
    );
    const legsCovered = allLegIds.size > 0 && allLegIds.size === filledLegIds.size;

    if (policy === "ALL_OR_NONE" && (!legsCovered || failed > 0)) {
      const unwindResult = await this.finalizeOrUnwind(plan, "persistent_step_failure");
      this.observeFillRateSnapshot(filled, steps.length);
      return unwindResult;
    }

    if (failed > 0 && filled === 0) {
      await this.updatePlanState(plan.id, "FAILED");
      await this.insertRouteHistory(plan.id, "ROUTE_RUN_FAILED", {
        rfq_id: plan.rfqId
      });
      sorPlanFailureTotal.labels("FAILED", "all_steps_failed").inc();
      this.observeFillRateSnapshot(filled, steps.length);
      return {
        planId: plan.id,
        rfqId: plan.rfqId,
        status: "FAILED",
        failureReason: "all_steps_failed"
      };
    }

    if (legsCovered) {
      await this.updatePlanState(plan.id, "COMPLETED");
      await this.insertRouteHistory(plan.id, "ROUTE_RUN_COMPLETED", {
        rfq_id: plan.rfqId
      });
      sorPlanSuccessTotal.labels("COMPLETED").inc();
      this.observeFillRateSnapshot(filled, steps.length);
      return {
        planId: plan.id,
        rfqId: plan.rfqId,
        status: "COMPLETED"
      };
    }

    if (failed > 0 && filled > 0) {
      await this.updatePlanState(plan.id, "COMPLETED", { partial: true });
      await this.insertRouteHistory(plan.id, "ROUTE_RUN_PARTIAL", {
        rfq_id: plan.rfqId
      });
      sorPlanSuccessTotal.labels("PARTIAL").inc();
      this.observeFillRateSnapshot(filled, steps.length);
      return {
        planId: plan.id,
        rfqId: plan.rfqId,
        status: "PARTIAL"
      };
    }

    await this.updatePlanState(plan.id, "COMPLETED");
    await this.insertRouteHistory(plan.id, "ROUTE_RUN_COMPLETED", {
      rfq_id: plan.rfqId
    });
    sorPlanSuccessTotal.labels("COMPLETED").inc();
    this.observeFillRateSnapshot(filled, steps.length);
    return {
      planId: plan.id,
      rfqId: plan.rfqId,
      status: "COMPLETED"
    };
  }

  private observeFillRateSnapshot(filledSteps: number, totalSteps: number): void {
    const instantaneousFillRate = totalSteps > 0 ? filledSteps / totalSteps : 0;
    sorFillRateSnapshot = instantaneousFillRate * 0.2 + sorFillRateSnapshot * 0.8;
    sorAvgFillRate5mSnapshot.set(sorFillRateSnapshot);
  }

  private async updateRiskAfterStepSuccess(plan: ExecutionPlan, step: PersistedRouteStep): Promise<void> {
    const persistedPlan = await this.loadPlan(plan.id);
    const session = await this.loadRFQSession(plan.rfqId);
    const executedPrice =
      typeof step.result?.executed_price === "string" ? step.result.executed_price : "1";
    await this.deps.riskEngine.updateExposureAfterExecution({
      id: step.id,
      executionId: step.id,
      planId: plan.id,
      rfqId: plan.rfqId,
      sessionId: plan.rfqId,
      reservationToken: persistedPlan.reservation_token,
      takerId: session.taker_id,
      canonicalMarketId: session.canonical_market_id,
      side: session.side,
      executedQuantity: step.target_size,
      executedPrice,
      providerId: step.provider_id,
      legId: step.leg_id,
      quantity: step.target_size
    }, step.provider_type === "INTERNAL");
  }

  private async createFallbackStep(
    planId: string,
    failedStep: PersistedRouteStep,
    attemptedProviders: ReadonlySet<string>
  ): Promise<PersistedRouteStep | null> {
    const candidates = await this.loadCandidatesByLeg(planId, failedStep.leg_id);
    const fallback = candidates.find(
      (candidate) => !attemptedProviders.has(candidate.provider_id)
    );
    if (!fallback) {
      return null;
    }

    const nextStepIndex = await this.loadNextStepIndex(planId);
    const id = randomUUID();
    const idempotencyKey = randomUUID();
    const clientOrderId = randomUUID();
    await this.withClient(async (client) => {
      await client.query(
        `/*sor.insert_fallback_step*/ INSERT INTO route_steps (
          id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
          target_size, client_order_id, idempotency_key, state, result
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          id,
          planId,
          failedStep.leg_id,
          nextStepIndex,
          fallback.provider_type,
          fallback.provider_id,
          failedStep.target_size,
          clientOrderId,
          idempotencyKey,
          "PENDING",
          JSON.stringify({ source_step_id: failedStep.id, fallback_candidate_id: fallback.id })
        ]
      );
    });

    return {
      id,
      routing_plan_id: planId,
      leg_id: failedStep.leg_id,
      step_index: nextStepIndex,
      provider_type: fallback.provider_type,
      provider_id: fallback.provider_id,
      target_size: failedStep.target_size,
      client_order_id: clientOrderId,
      idempotency_key: idempotencyKey,
      state: "PENDING",
      submitted_at: null,
      completed_at: null,
      result: null
    };
  }

  private async loadPlan(planId: string): Promise<PersistedRoutingPlan> {
    const plan = await this.withClient(async (client) => {
      const result = await client.query<PersistedRoutingPlan>(
        "/*sor.load_plan*/ SELECT id, rfq_id, acceptance_policy, reservation_token, state, metadata FROM routing_plans WHERE id = $1 LIMIT 1",
        [planId]
      );
      return result.rows[0];
    });

    if (!plan) {
      throw new Error(`Routing plan ${planId} not found.`);
    }
    return plan;
  }

  private async loadPlanSteps(planId: string): Promise<PersistedRouteStep[]> {
    return this.withClient(async (client) => {
      const result = await client.query<PersistedRouteStep>(
        `/*sor.load_steps*/ SELECT id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
         target_size, client_order_id, idempotency_key, state, submitted_at, completed_at, result
         FROM route_steps WHERE routing_plan_id = $1 ORDER BY step_index ASC`,
        [planId]
      );
      return result.rows;
    });
  }

  private async getStepById(stepId: string): Promise<PersistedRouteStep | null> {
    return this.withClient(async (client) => {
      const result = await client.query<PersistedRouteStep>(
        `/*sor.get_step_by_id*/ SELECT id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
         target_size, client_order_id, idempotency_key, state, submitted_at, completed_at, result
         FROM route_steps WHERE id = $1 LIMIT 1`,
        [stepId]
      );
      return result.rows[0] ?? null;
    });
  }

  private async loadCandidatesByLeg(
    planId: string,
    legId: string
  ): Promise<PersistedRouteCandidate[]> {
    return this.withClient(async (client) => {
      const result = await client.query<PersistedRouteCandidate>(
        `/*sor.load_candidates_by_leg*/ SELECT id, routing_plan_id, leg_id, provider_type, provider_id,
         available_size, quoted_price, fees, latency_ms, fill_prob, metadata
         FROM route_candidates
         WHERE routing_plan_id = $1 AND leg_id = $2
         ORDER BY quoted_price ASC`,
        [planId, legId]
      );
      return result.rows;
    });
  }

  private async loadRFQSession(
    sessionId: string
  ): Promise<{ taker_id: string; canonical_market_id: string; side: "buy" | "sell" }> {
    return this.withClient(async (client) => {
      const result = await client.query<{
        taker_id: string;
        canonical_market_id: string;
        side: "buy" | "sell";
      }>(
        "/*sor.load_rfq_session*/ SELECT taker_id, canonical_market_id, side FROM rfq_sessions WHERE id = $1 LIMIT 1",
        [sessionId]
      );
      const session = result.rows[0];
      if (!session) {
        throw new Error(`RFQ session ${sessionId} not found for risk update.`);
      }
      return session;
    });
  }

  private async loadNextStepIndex(planId: string): Promise<number> {
    return this.withClient(async (client) => {
      const result = await client.query<{ next_index: number }>(
        "/*sor.load_next_step_index*/ SELECT COALESCE(MAX(step_index), -1) + 1 AS next_index FROM route_steps WHERE routing_plan_id = $1",
        [planId]
      );
      return result.rows[0]?.next_index ?? 0;
    });
  }

  private async markStepExecuting(stepId: string): Promise<boolean> {
    return this.withClient(async (client) => {
      const result = await client.query(
        `/*sor.mark_step_executing*/ UPDATE route_steps
         SET state = 'EXECUTING', submitted_at = now()
         WHERE id = $1 AND state IN ('PENDING', 'FAILED')`,
        [stepId]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  private async markStepFilled(stepId: string, payload: Record<string, unknown>): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `/*sor.mark_step_filled*/ UPDATE route_steps
         SET state = 'FILLED', completed_at = now(), result = $2::jsonb
         WHERE id = $1`,
        [stepId, JSON.stringify(payload)]
      );
    });
  }

  private async markStepFailed(stepId: string, payload: Record<string, unknown>): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `/*sor.mark_step_failed*/ UPDATE route_steps
         SET state = 'FAILED', completed_at = now(), result = $2::jsonb
         WHERE id = $1`,
        [stepId, JSON.stringify(payload)]
      );
    });
  }

  private async updatePlanState(
    planId: string,
    state: "RUNNING" | "COMPLETED" | "FAILED" | "UNWOUND",
    metadataPatch?: Record<string, unknown>
  ): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `/*sor.update_plan_state*/ UPDATE routing_plans
         SET state = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $1`,
        [planId, state, JSON.stringify(metadataPatch ?? {})]
      );
    });
  }

  private async insertRouteHistory(
    planId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        "/*sor.insert_route_history*/ INSERT INTO route_history (routing_plan_id, event_type, payload, created_at) VALUES ($1, $2, $3::jsonb, $4)",
        [planId, eventType, JSON.stringify(payload), this.now()]
      );
    });
  }

  private toPlanStep(step: PersistedRouteStep): PlanStep {
    return {
      id: step.id,
      stepIndex: step.step_index,
      providerType: step.provider_type,
      providerId: step.provider_id,
      targetSize: Number(step.target_size),
      roundedSize: Number(step.target_size),
      targetPrice: 0,
      idempotencyKey: step.idempotency_key,
      state: step.state,
      metadata: {
        leg_id: step.leg_id,
        client_order_id: step.client_order_id
      }
    };
  }

  private mapPlanStateToResult(plan: PersistedRoutingPlan, rfqId: string): PlanExecutionResult {
    if (plan.state === "COMPLETED") {
      return { planId: plan.id, rfqId, status: "COMPLETED" };
    }
    if (plan.state === "UNWOUND") {
      return { planId: plan.id, rfqId, status: "UNWOUND" };
    }
    return { planId: plan.id, rfqId, status: "FAILED" };
  }

  private async runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    let index = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    const runners = Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        if (current) {
          await worker(current);
        }
      }
    });
    await Promise.all(runners);
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.deps.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("step_timeout")), timeoutMs);
      void promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private async delay(durationMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }
}
