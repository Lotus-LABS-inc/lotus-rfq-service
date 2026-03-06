import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import {
  type ExecutionPlan,
  type IPlanComposer,
  type PlanStep,
  type RouteCandidate,
  type CanonicalRFQInput,
  type CandidateScore,
  type SORAcceptancePolicy,
  type RoutingPlan,
  type PersistedRoutingPlan,
  type SplitAllocation
} from "./types.js";

export interface PlanComposerDependencies {
  pool: Pool;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now?: () => Date;
}

export class PlanComposer implements IPlanComposer {
  private readonly now: () => Date;

  public constructor(private readonly deps: PlanComposerDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  private deriveId(domain: string, ...seeds: string[]): string {
    const hash = crypto.createHash("sha256");
    hash.update(domain);
    for (const seed of seeds) {
      hash.update("|");
      hash.update(seed);
    }
    const hex = hash.digest("hex");
    // Ensure it's a valid UUID v4 format for Zod validation
    // 8-4-4-4-12
    // Set version 4 and variant 1 bits
    const s1 = hex.slice(0, 8);
    const s2 = hex.slice(8, 12);
    const s3 = "4" + hex.slice(13, 16); // v4
    const s4 = (parseInt(hex.slice(16, 17), 16) & 0x3 | 0x8).toString(16) + hex.slice(17, 20); // variant 1
    const s5 = hex.slice(20, 32);
    return `${s1}-${s2}-${s3}-${s4}-${s5}`;
  }

  public async composePlan(
    rfq: CanonicalRFQInput,
    candidates: readonly RouteCandidate[],
    scores: readonly CandidateScore[],
    allocations: readonly SplitAllocation[],
    policy: SORAcceptancePolicy
  ): Promise<ExecutionPlan> {
    const planId = this.deriveId("plan", rfq.rfqId, rfq.idempotencyKey);
    const createdAt = this.now();

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");

      // Idempotency check: serializable select
      const existingPlanRes = await client.query<RoutingPlan>(
        "SELECT * FROM routing_plans WHERE id = $1",
        [planId]
      );

      if (existingPlanRes.rows.length > 0) {
        const plan = existingPlanRes.rows[0];
        if (plan) {
          this.deps.logger.info({ planId, rfqId: rfq.rfqId }, "Existing routing plan found (idempotent hit).");
          await client.query("ROLLBACK");
          return plan;
        }
      }

      const costEstimate = scores.reduce((acc, s) => acc + s.totalExpectedCost, 0);

      const reservationToken = (rfq.metadata?.reservation_token as string) ?? null;

      const res = await client.query<RoutingPlan>(
        `INSERT INTO routing_plans (
          id, rfq_id, acceptance_policy, state, cost_estimate, reservation_token, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        RETURNING *`,
        [
          planId,
          rfq.rfqId,
          policy,
          "DRAFT",
          costEstimate.toString(),
          reservationToken,
          JSON.stringify({ idempotency_key: rfq.idempotencyKey }),
          createdAt
        ]
      );
      const plan = res.rows[0];

      await this.insertRouteCandidates(client, planId, rfq, candidates, scores);

      const quantity = Number.parseFloat(rfq.quantity);
      const steps = this.generateDeterministicSteps(planId, candidates, allocations);
      await this.insertRouteSteps(client, planId, steps);

      await client.query("COMMIT");

      const executionPlan: ExecutionPlan = {
        id: planId,
        rfqId: rfq.rfqId,
        acceptancePolicy: policy,
        steps,
        createdAt,
        metadata: { idempotency_key: rfq.idempotencyKey }
      };

      return executionPlan;
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error.code === "23505") { // unique_violation race
        const res = await this.deps.pool.query<PersistedRoutingPlan>("SELECT * FROM routing_plans WHERE id = $1", [planId]);
        const plan = res.rows[0];
        if (plan) {
          // We'd need to fetch steps too if we want to return the full ExecutionPlan here
          // But for idempotency, usually returning the same plan ID is enough or we re-generate steps
          // Let's re-generate deterministicly
          const steps = this.generateDeterministicSteps(planId, candidates, allocations);
          return {
            id: plan.id,
            rfqId: plan.rfq_id,
            acceptancePolicy: plan.acceptance_policy,
            steps,
            createdAt: (plan as any).created_at ?? createdAt,
            metadata: plan.metadata ?? {}
          };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private generateDeterministicSteps(
    planId: string,
    candidates: readonly RouteCandidate[],
    allocations: readonly SplitAllocation[]
  ): PlanStep[] {
    if (allocations.length === 0) return [];

    return allocations.map((alloc, index) => {
      const candidate = candidates.find(c => c.id === alloc.candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found for allocation: ${alloc.candidateId}`);
      }

      const stepId = this.deriveId("step", planId, index.toString());

      const step: PlanStep = {
        id: stepId,
        stepIndex: index,
        providerType: candidate.provider_type,
        providerId: candidate.provider_id,
        candidateId: candidate.id,
        targetSize: alloc.targetSize,
        roundedSize: alloc.roundedSize,
        targetPrice: alloc.targetPrice,
        idempotencyKey: stepId,
        state: "PENDING",
        metadata: {
          leg_id: candidate.leg_id,
          client_order_id: this.deriveId("clordid", stepId)
        }
      };
      return step;
    });
  }

  private async insertRouteCandidates(
    client: PoolClient,
    planId: string,
    rfq: CanonicalRFQInput,
    candidates: readonly RouteCandidate[],
    scores: readonly CandidateScore[]
  ): Promise<void> {
    for (const candidate of candidates) {
      const score = scores.find(s => s.candidateId === candidate.id);
      await client.query(
        `INSERT INTO route_candidates (
          id, routing_plan_id, leg_id, provider_type, provider_id, available_size,
          quoted_price, fees, latency_ms, fill_prob, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)`,
        [
          candidate.id,
          planId,
          candidate.leg_id,
          candidate.provider_type,
          candidate.provider_id,
          candidate.available_size.toString(),
          candidate.quoted_price.toString(),
          JSON.stringify(candidate.fees),
          candidate.latency_ms,
          candidate.fill_prob.toString(),
          JSON.stringify({ ...candidate.metadata, score: score?.totalExpectedCost ?? 0, stp_mode: rfq.stpMode })
        ]
      );
    }
  }

  private async insertRouteSteps(
    client: PoolClient,
    planId: string,
    steps: readonly PlanStep[]
  ): Promise<void> {
    for (const step of steps) {
      await client.query(
        `INSERT INTO route_steps (
          id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
          target_size, rounded_size, target_price, state, idempotency_key, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          step.id,
          planId,
          step.metadata ? step.metadata["leg_id"] : null,
          step.stepIndex,
          step.providerType,
          step.providerId,
          step.targetSize.toString(),
          step.roundedSize.toString(),
          step.targetPrice.toString(),
          step.state,
          step.idempotencyKey,
          JSON.stringify(step.metadata ?? {})
        ]
      );
    }
  }
}
