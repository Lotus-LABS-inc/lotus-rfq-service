import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { MonetizationRepository } from "../../repositories/monetization.repository.js";

const ledgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
  status: z.string().optional(),
  venue: z.string().optional(),
  revenueSource: z.string().optional(),
  captureMode: z.string().optional(),
  policyVersion: z.string().optional()
});

export interface AdminMonetizationRouteDeps {
  monetizationRepository: MonetizationRepository;
}

export const registerAdminMonetizationRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminMonetizationRouteDeps
): Promise<void> => {
  app.get("/admin/monetization/summary", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const rows = await deps.monetizationRepository.getSummary();
      const totals = rows.reduce(
        (acc, row) => ({
          actualBuilderFeesCollected: addDecimal(acc.actualBuilderFeesCollected, row.actual_builder_fees_collected),
          shadowImprovementFees: addDecimal(acc.shadowImprovementFees, row.shadow_improvement_fees),
          uncollectedImprovementOpportunity: addDecimal(acc.uncollectedImprovementOpportunity, row.uncollected_improvement_opportunity),
          ledgerAmount: addDecimal(acc.ledgerAmount, row.ledger_amount)
        }),
        {
          actualBuilderFeesCollected: "0",
          shadowImprovementFees: "0",
          uncollectedImprovementOpportunity: "0",
          ledgerAmount: "0"
        }
      );
      return reply.send({
        summary: {
          generatedAt: new Date().toISOString(),
          totals,
          rows: rows.map((row) => ({
            venue: row.venue,
            lane: row.lane,
            captureMode: row.capture_mode,
            revenueSource: row.revenue_source,
            policyVersion: row.policy_version,
            currency: row.currency,
            rowCount: row.row_count,
            actualBuilderFeesCollected: row.actual_builder_fees_collected,
            shadowImprovementFees: row.shadow_improvement_fees,
            uncollectedImprovementOpportunity: row.uncollected_improvement_opportunity,
            ledgerAmount: row.ledger_amount
          }))
        }
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to build admin monetization summary.");
      return reply.status(500).send({ code: "ADMIN_MONETIZATION_SUMMARY_ERROR", message: "Failed to build monetization summary." });
    }
  });

  app.get("/admin/monetization/ledger", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = ledgerQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const rows = await deps.monetizationRepository.listLedgerEntries({
        limit: parsed.data.limit,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.venue ? { venue: parsed.data.venue } : {}),
        ...(parsed.data.revenueSource ? { revenueSource: parsed.data.revenueSource } : {}),
        ...(parsed.data.captureMode ? { captureMode: parsed.data.captureMode } : {}),
        ...(parsed.data.policyVersion ? { policyVersion: parsed.data.policyVersion } : {})
      });
      return reply.send({
        ledger: rows.map((row) => ({
          id: row.id,
          executionId: row.execution_id,
          rfqId: row.rfq_id,
          quoteId: row.quote_id,
          userId: row.user_id,
          venue: row.venue,
          laneId: row.lane_id,
          policyVersion: row.fee_policy_version,
          feeType: row.fee_type,
          status: row.status,
          amount: row.amount,
          currency: row.currency,
          captureMode: row.capture_mode,
          revenueSource: row.revenue_source,
          actualBuilderFeeCollected: row.actual_builder_fee_collected,
          shadowImprovementFee: row.shadow_improvement_fee,
          uncollectedImprovementOpportunity: row.uncollected_improvement_opportunity,
          settlementStatus: row.settlement_status,
          sourceEventId: row.source_event_id,
          metadata: row.metadata,
          createdAt: row.created_at.toISOString()
        }))
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list admin monetization ledger.");
      return reply.status(500).send({ code: "ADMIN_MONETIZATION_LEDGER_ERROR", message: "Failed to list monetization ledger." });
    }
  });

  app.get("/admin/monetization/policies", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const policies = await deps.monetizationRepository.listPolicies();
      return reply.send({
        policies: policies.map((policy) => ({
          id: policy.id,
          version: policy.version,
          enabled: policy.enabled,
          mode: policy.mode,
          currency: policy.currency,
          priceImprovementShareBps: policy.price_improvement_share_bps,
          executionFeeBps: policy.execution_fee_bps,
          fastLaneFeeBps: policy.fast_lane_fee_bps,
          ghostFillProtectionFeeBps: policy.ghost_fill_protection_fee_bps,
          maxTotalFeeBps: policy.max_total_fee_bps,
          captureMode: policy.capture_mode,
          config: policy.config,
          createdAt: policy.created_at.toISOString(),
          updatedAt: policy.updated_at.toISOString()
        }))
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list admin monetization policies.");
      return reply.status(500).send({ code: "ADMIN_MONETIZATION_POLICIES_ERROR", message: "Failed to list monetization policies." });
    }
  });
};

const addDecimal = (left: string, right: string): string => {
  const result = Number(left) + Number(right);
  return Number.isFinite(result) ? result.toFixed(8).replace(/\.?0+$/, "") : "0";
};
