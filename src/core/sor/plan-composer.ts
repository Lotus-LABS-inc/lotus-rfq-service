import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  type ExecutionPlan,
  type IPlanComposer,
  type PlanComposerInput,
  type PlanStep,
  type RouteCandidate
} from "./types.js";

const PlanComposerInputSchema = z.object({
  rfq: z.object({
    rfqId: z.string().uuid()
  }),
  selectedQuote: z.object({
    quoteId: z.string().min(1)
  }),
  policy: z.enum(["ALL_OR_NONE", "PARTIAL_ALLOWED", "BEST_EFFORT"]),
  reservationToken: z.string().min(1),
  createdBy: z.string().uuid(),
  routeCandidates: z.array(
    z.object({
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
    })
  ),
  allocations: z.array(
    z.object({
      candidateId: z.string().uuid(),
      providerId: z.string().min(1),
      targetSize: z.number().nonnegative(),
      roundedSize: z.number().nonnegative(),
      targetPrice: z.number().nonnegative()
    })
  ),
  scoredCandidates: z.array(
    z.object({
      candidateId: z.string().uuid(),
      totalExpectedCost: z.number()
    })
  )
});

type ParsedPlanComposerInput = z.infer<typeof PlanComposerInputSchema>;

export interface PlanComposerDependencies {
  pool: Pool;
  logger: Pick<Logger, "info" | "error">;
  now?: () => Date;
  createUuid?: () => string;
}

export class PlanComposer implements IPlanComposer {
  private readonly now: () => Date;
  private readonly createUuid: () => string;

  public constructor(private readonly deps: PlanComposerDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.createUuid = deps.createUuid ?? (() => randomUUID());
  }

  public async composePlan(input: PlanComposerInput): Promise<ExecutionPlan> {
    const parsed = PlanComposerInputSchema.parse(input);
    const planId = this.createUuid();
    const createdAt = this.now();
    const costEstimate = this.computeCostEstimate(parsed.scoredCandidates, parsed.allocations);
    const candidateById = this.buildCandidateMap(parsed.routeCandidates);
    const steps = this.buildSteps(parsed.allocations, candidateById);

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      await this.insertRoutingPlan(client, {
        planId,
        rfqId: parsed.rfq.rfqId,
        policy: parsed.policy,
        reservationToken: parsed.reservationToken,
        createdBy: parsed.createdBy,
        costEstimate,
        createdAt,
        selectedQuoteId: parsed.selectedQuote.quoteId
      });
      await this.insertRouteCandidates(client, planId, parsed.routeCandidates);
      await this.insertRouteSteps(client, planId, steps);
      await this.insertRouteHistory(client, planId, {
        event: "ROUTE_PLAN_CREATED",
        createdAt,
        payload: {
          rfq_id: parsed.rfq.rfqId,
          selected_quote_id: parsed.selectedQuote.quoteId,
          step_count: steps.length
        }
      });
      await client.query("COMMIT");
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }

    this.deps.logger.info(
      {
        planId,
        rfqId: parsed.rfq.rfqId,
        stepCount: steps.length
      },
      "SOR routing plan persisted."
    );

    return {
      id: planId,
      rfqId: parsed.rfq.rfqId,
      acceptancePolicy: parsed.policy,
      steps,
      metadata: {
        plan_id: planId,
        reservation_token: parsed.reservationToken
      },
      createdAt
    };
  }

  private buildCandidateMap(candidates: readonly RouteCandidate[]): Map<string, RouteCandidate> {
    return new Map(candidates.map((candidate) => [candidate.id, candidate]));
  }

  private buildSteps(
    allocations: PlanComposerInput["allocations"],
    candidateById: ReadonlyMap<string, RouteCandidate>
  ): PlanStep[] {
    return allocations.map((allocation, index) => {
      const candidate = candidateById.get(allocation.candidateId);
      if (!candidate) {
        throw new Error(`Candidate ${allocation.candidateId} missing for step composition.`);
      }

      return {
        id: this.createUuid(),
        stepIndex: index,
        providerType: candidate.provider_type,
        providerId: candidate.provider_id,
        candidateId: candidate.id,
        targetSize: allocation.targetSize,
        roundedSize: allocation.roundedSize,
        targetPrice: allocation.targetPrice,
        idempotencyKey: this.createUuid(),
        state: "PENDING",
        metadata: {
          leg_id: candidate.leg_id,
          client_order_id: this.createUuid()
        }
      };
    });
  }

  private computeCostEstimate(
    scoredCandidates: ParsedPlanComposerInput["scoredCandidates"],
    allocations: ParsedPlanComposerInput["allocations"]
  ): number {
    if (allocations.length === 0) {
      return 0;
    }

    const scoreByCandidateId = new Map(
      scoredCandidates.map((score) => [score.candidateId, score.totalExpectedCost] as const)
    );

    return allocations.reduce((total, allocation) => {
      const score = scoreByCandidateId.get(allocation.candidateId);
      return total + (score ?? allocation.targetPrice * allocation.roundedSize);
    }, 0);
  }

  private async insertRoutingPlan(
    client: PoolClient,
    input: {
      planId: string;
      rfqId: string;
      policy: "ALL_OR_NONE" | "PARTIAL_ALLOWED" | "BEST_EFFORT";
      reservationToken: string;
      createdBy: string;
      costEstimate: number;
      createdAt: Date;
      selectedQuoteId: string;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO routing_plans (
        id, rfq_id, acceptance_policy, reservation_token, created_by, state, cost_estimate, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        input.planId,
        input.rfqId,
        input.policy,
        input.reservationToken,
        input.createdBy,
        "DRAFT",
        input.costEstimate.toString(),
        JSON.stringify({ selected_quote_id: input.selectedQuoteId }),
        input.createdAt
      ]
    );
  }

  private async insertRouteCandidates(
    client: PoolClient,
    planId: string,
    candidates: readonly RouteCandidate[]
  ): Promise<void> {
    for (const candidate of candidates) {
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
          JSON.stringify(candidate.metadata ?? {})
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
      const legId = this.extractLegId(step);
      const clientOrderId = this.extractClientOrderId(step);
      await client.query(
        `INSERT INTO route_steps (
          id, routing_plan_id, leg_id, step_index, provider_type, provider_id,
          target_size, client_order_id, idempotency_key, state, result
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          step.id,
          planId,
          legId,
          step.stepIndex,
          step.providerType,
          step.providerId,
          step.roundedSize.toString(),
          clientOrderId,
          step.idempotencyKey ?? this.createUuid(),
          step.state,
          JSON.stringify({})
        ]
      );
    }
  }

  private async insertRouteHistory(
    client: PoolClient,
    planId: string,
    input: {
      event: string;
      payload: Record<string, unknown>;
      createdAt: Date;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO route_history (routing_plan_id, event_type, payload, created_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [planId, input.event, JSON.stringify(input.payload), input.createdAt]
    );
  }

  private async rollbackQuietly(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      this.deps.logger.error({ err: rollbackError }, "SOR plan composer rollback failed.");
    }
  }

  private extractLegId(step: PlanStep): string {
    const legId = step.metadata?.leg_id;
    if (typeof legId !== "string") {
      throw new Error(`Step ${step.id} missing leg_id metadata.`);
    }
    return legId;
  }

  private extractClientOrderId(step: PlanStep): string {
    const clientOrderId = step.metadata?.client_order_id;
    if (typeof clientOrderId !== "string") {
      throw new Error(`Step ${step.id} missing client_order_id metadata.`);
    }
    return clientOrderId;
  }
}
