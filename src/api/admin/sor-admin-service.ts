import type { Logger } from "pino";
import type { Pool } from "pg";
import type { IPlanRunner, SORAcceptancePolicy } from "../../core/sor/types.js";

interface RoutingPlanRow {
  id: string;
  rfq_id: string;
  acceptance_policy: SORAcceptancePolicy;
  reservation_token: string | null;
  state: string;
  cost_estimate: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

interface RouteStepRow {
  id: string;
  routing_plan_id: string;
  leg_id: string;
  step_index: number;
  provider_type: "LP" | "VENUE" | "INTERNAL";
  provider_id: string;
  target_size: string;
  client_order_id: string;
  idempotency_key: string;
  state: string;
  submitted_at: Date | null;
  completed_at: Date | null;
  result: Record<string, unknown> | null;
}

interface RouteCandidateRow {
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

export interface SORPlanSnapshot {
  plan: RoutingPlanRow;
  route_steps: RouteStepRow[];
  provider_candidates: RouteCandidateRow[];
}

export interface RetryStepInput {
  planId: string;
  stepId: string;
  newProviderId: string;
  newProviderType: "LP" | "VENUE" | "INTERNAL";
  reason: string;
  requestedBy: string;
}

export interface ForceUnwindInput {
  planId: string;
  reason: string;
  requestedBy: string;
}

export interface SORConfigInput {
  sorEnabled?: boolean | undefined;
  sorCanaryShadowEnabled?: boolean | undefined;
  sorCanaryPercent?: number | undefined;
}

export class PlanNotFoundError extends Error {
  public constructor(planId: string) {
    super(`Routing plan ${planId} not found.`);
    this.name = "PlanNotFoundError";
  }
}

export class StepNotFoundError extends Error {
  public constructor(planId: string, stepId: string) {
    super(`Route step ${stepId} not found for plan ${planId}.`);
    this.name = "StepNotFoundError";
  }
}

export class ProviderCandidateNotFoundError extends Error {
  public constructor(planId: string, legId: string, providerId: string) {
    super(`Provider candidate ${providerId} not found for leg ${legId} in plan ${planId}.`);
    this.name = "ProviderCandidateNotFoundError";
  }
}

export interface SORAdminServiceDeps {
  pool: Pool;
  redis: import("../../db/redis.js").RedisClient;
  planRunner: IPlanRunner;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export class SORAdminService {
  public constructor(private readonly deps: SORAdminServiceDeps) { }

  public async getPlanSnapshot(planId: string): Promise<SORPlanSnapshot> {
    const plan = await this.loadPlan(planId);
    const [stepsResult, candidatesResult] = await Promise.all([
      this.deps.pool.query<RouteStepRow>(
        `SELECT id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
                target_size, client_order_id, idempotency_key, state, submitted_at, completed_at, result
         FROM route_steps
         WHERE routing_plan_id = $1
         ORDER BY step_index ASC`,
        [planId]
      ),
      this.deps.pool.query<RouteCandidateRow>(
        `SELECT id, routing_plan_id, leg_id, provider_type, provider_id, available_size,
                quoted_price, fees, latency_ms, fill_prob, metadata
         FROM route_candidates
         WHERE routing_plan_id = $1
         ORDER BY leg_id ASC, quoted_price ASC`,
        [planId]
      )
    ]);

    return {
      plan,
      route_steps: stepsResult.rows,
      provider_candidates: candidatesResult.rows
    };
  }

  public async forceUnwind(input: ForceUnwindInput): Promise<{ planId: string; status: string }> {
    const plan = await this.loadPlan(input.planId);

    const result = await this.deps.planRunner.finalizeOrUnwind(
      {
        id: plan.id,
        rfqId: plan.rfq_id,
        acceptancePolicy: plan.acceptance_policy,
        steps: [],
        createdAt: new Date()
      },
      input.reason
    );

    await this.deps.pool.query(
      `INSERT INTO route_history (routing_plan_id, event_type, payload, created_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [
        input.planId,
        "ADMIN_FORCE_UNWIND",
        JSON.stringify({
          reason: input.reason,
          requested_by: input.requestedBy,
          status: result.status
        })
      ]
    );

    this.deps.logger.warn(
      {
        planId: input.planId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        status: result.status
      },
      "Admin force-unwind executed for SOR plan."
    );

    return {
      planId: input.planId,
      status: result.status
    };
  }

  public async retryStep(input: RetryStepInput): Promise<{ planId: string; status: string }> {
    const plan = await this.loadPlan(input.planId);

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");

      const stepResult = await client.query<RouteStepRow>(
        `SELECT id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
                target_size, client_order_id, idempotency_key, state, submitted_at, completed_at, result
         FROM route_steps
         WHERE id = $1 AND routing_plan_id = $2
         LIMIT 1`,
        [input.stepId, input.planId]
      );
      const step = stepResult.rows[0];
      if (!step) {
        throw new StepNotFoundError(input.planId, input.stepId);
      }

      const candidateResult = await client.query<RouteCandidateRow>(
        `SELECT id, routing_plan_id, leg_id, provider_type, provider_id, available_size,
                quoted_price, fees, latency_ms, fill_prob, metadata
         FROM route_candidates
         WHERE routing_plan_id = $1 AND leg_id = $2 AND provider_id = $3
         LIMIT 1`,
        [input.planId, step.leg_id, input.newProviderId]
      );
      if (!candidateResult.rows[0]) {
        throw new ProviderCandidateNotFoundError(input.planId, step.leg_id, input.newProviderId);
      }

      await client.query(
        `UPDATE route_steps
         SET provider_id = $2,
             provider_type = $3,
             state = 'PENDING',
             submitted_at = NULL,
             completed_at = NULL,
             result = $4::jsonb
         WHERE id = $1 AND routing_plan_id = $5`,
        [
          input.stepId,
          input.newProviderId,
          input.newProviderType,
          JSON.stringify({
            admin_retry: true,
            reason: input.reason,
            requested_by: input.requestedBy
          }),
          input.planId
        ]
      );

      await client.query(
        `INSERT INTO route_history (routing_plan_id, event_type, payload, created_at)
         VALUES ($1, $2, $3::jsonb, NOW())`,
        [
          input.planId,
          "ADMIN_STEP_RETRY_REQUESTED",
          JSON.stringify({
            step_id: input.stepId,
            new_provider_id: input.newProviderId,
            new_provider_type: input.newProviderType,
            reason: input.reason,
            requested_by: input.requestedBy
          })
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const result = await this.deps.planRunner.run({
      id: plan.id,
      rfqId: plan.rfq_id,
      acceptancePolicy: plan.acceptance_policy,
      steps: [],
      createdAt: new Date()
    });

    this.deps.logger.warn(
      {
        planId: input.planId,
        stepId: input.stepId,
        newProviderId: input.newProviderId,
        requestedBy: input.requestedBy,
        status: result.status
      },
      "Admin step retry executed for SOR plan."
    );

    return {
      planId: input.planId,
      status: result.status
    };
  }

  private async loadPlan(planId: string): Promise<RoutingPlanRow> {
    const planResult = await this.deps.pool.query<RoutingPlanRow>(
      `SELECT id, rfq_id, acceptance_policy, reservation_token, state, cost_estimate, metadata, created_at
       FROM routing_plans
       WHERE id = $1
       LIMIT 1`,
      [planId]
    );
    const plan = planResult.rows[0];
    if (!plan) {
      throw new PlanNotFoundError(planId);
    }
    return plan;
  }

  public async updateConfig(input: SORConfigInput): Promise<void> {
    const updates: Record<string, string> = {};
    if (input.sorEnabled !== undefined) updates["sor_enabled"] = String(input.sorEnabled);
    if (input.sorCanaryShadowEnabled !== undefined) updates["sor_canary_shadow_enabled"] = String(input.sorCanaryShadowEnabled);
    if (input.sorCanaryPercent !== undefined) updates["sor_canary_percent"] = String(input.sorCanaryPercent);

    if (Object.keys(updates).length > 0) {
      // RedisClient.set requires: key, value, mode, duration, condition?
      // Setting a 1-year expiration (approx) or something long if we want it "permanent"
      // or we can add a 'permanent' set if the interface allows.
      // Interface shows: set(key, value, mode, duration, condition?)
      await this.deps.redis.set("sor:config:runtime", JSON.stringify(updates), "EX", 31536000);
    }

    this.deps.logger.info({ updates }, "SOR runtime configuration updated.");
  }
}

