import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { ExecutionIntentRepository } from "../../repositories/execution-intent.repository.js";
import type { ExecutionRecordRepository } from "../../repositories/execution-record.repository.js";
import type { ExecutionControlRepository } from "../../repositories/execution-control.repository.js";
import type { FundingReadinessAdminService } from "./funding-readiness-admin-service.js";
import type { ExecutionVenuesAdminService } from "./execution-venues-admin-service.js";

const executionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
  state: z.string().optional(),
  venue: z.string().optional(),
  settlementStatus: z.string().optional()
});

const executionParamsSchema = z.object({
  executionId: z.string().uuid()
});

export interface AdminOpsRouteDeps {
  executionIntentRepository: ExecutionIntentRepository;
  executionRecordRepository: ExecutionRecordRepository;
  executionControlRepository: ExecutionControlRepository;
  fundingReadinessAdminService: FundingReadinessAdminService;
  executionVenuesAdminService: ExecutionVenuesAdminService;
}

export const registerAdminOpsRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminOpsRouteDeps
): Promise<void> => {
  app.get("/admin/ops/summary", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const [records, intents, fundingSummary, venues] = await Promise.all([
        deps.executionRecordRepository.list(100),
        deps.executionIntentRepository.list(100),
        deps.fundingReadinessAdminService.getSummary(),
        deps.executionVenuesAdminService.listVenues()
      ]);
      return reply.send({
        summary: {
          generatedAt: new Date().toISOString(),
          executions: {
            recentRecords: records.length,
            recentIntents: intents.length,
            byState: countBy(records, (record) => record.executionState),
            bySettlementStatus: countBy(records, (record) => record.settlementStatus),
            byVenue: countBy(records, (record) => record.venue)
          },
          funding: {
            totalFundingIntents: fundingSummary.totalFundingIntents,
            readyToTrade: fundingSummary.readyToTrade,
            venueCreditPending: fundingSummary.venueCreditPending,
            destinationNotConfirmed: fundingSummary.destinationNotConfirmed,
            failed: fundingSummary.failed,
            unknown: fundingSummary.unknown
          },
          venues
        }
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to build admin ops summary.");
      return reply.status(500).send({ code: "ADMIN_OPS_SUMMARY_ERROR", message: "Failed to build admin ops summary." });
    }
  });

  app.get("/admin/executions", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = executionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const records = (await deps.executionRecordRepository.list(parsed.data.limit)).filter((record) => {
        if (parsed.data.state && record.executionState !== parsed.data.state) return false;
        if (parsed.data.venue && record.venue.toUpperCase() !== parsed.data.venue.toUpperCase()) return false;
        if (parsed.data.settlementStatus && record.settlementStatus !== parsed.data.settlementStatus) return false;
        return true;
      });
      return reply.send({ executions: records });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list admin executions.");
      return reply.status(500).send({ code: "ADMIN_EXECUTIONS_ERROR", message: "Failed to list executions." });
    }
  });

  app.get("/admin/executions/:executionId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = executionParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const record = await deps.executionRecordRepository.findById(parsed.data.executionId);
      if (!record) {
        return reply.status(404).send({ code: "EXECUTION_NOT_FOUND", message: "Execution not found." });
      }
      const [intent, audit] = await Promise.all([
        deps.executionIntentRepository.findById(record.executionIntentId),
        deps.executionControlRepository.listControlAuditByRecord(record.id)
      ]);
      return reply.send({ execution: { record, intent, audit } });
    } catch (error) {
      app.log.error({ err: error }, "Failed to load admin execution detail.");
      return reply.status(500).send({ code: "ADMIN_EXECUTION_DETAIL_ERROR", message: "Failed to load execution." });
    }
  });

  app.get("/admin/funding/summary", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ summary: await deps.fundingReadinessAdminService.getSummary() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to build admin funding summary.");
      return reply.status(500).send({ code: "ADMIN_FUNDING_SUMMARY_ERROR", message: "Failed to build funding summary." });
    }
  });
};

const countBy = <T>(rows: T[], keyOf: (row: T) => string): Record<string, number> =>
  rows.reduce<Record<string, number>>((counts, row) => {
    const key = keyOf(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
