import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { FundingReadinessAdminService } from "./funding-readiness-admin-service.js";

const fundingIntentParamsSchema = z.object({
  fundingIntentId: z.string().min(1)
});

const userParamsSchema = z.object({
  userId: z.string().min(1)
});

const venueParamsSchema = z.object({
  venue: z.string().min(1).transform((value) => value.toUpperCase())
});

export interface AdminFundingReadinessRouteDeps {
  fundingReadinessAdminService: FundingReadinessAdminService;
}

export const registerAdminFundingReadinessRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminFundingReadinessRouteDeps
): Promise<void> => {
  app.get("/admin/funding/readiness", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ readiness: await deps.fundingReadinessAdminService.listReadiness() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list funding readiness.");
      return reply.status(500).send({
        code: "FUNDING_READINESS_ADMIN_ERROR",
        message: "Failed to list funding readiness."
      });
    }
  });

  app.get("/admin/funding/readiness/summary", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ summary: await deps.fundingReadinessAdminService.getSummary() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to build funding readiness summary.");
      return reply.status(500).send({
        code: "FUNDING_READINESS_SUMMARY_ERROR",
        message: "Failed to build funding readiness summary."
      });
    }
  });

  app.get("/admin/funding/readiness/user/:userId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = userParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.fundingReadinessAdminService.listByUser(parsed.data.userId) });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list funding readiness by user.");
      return reply.status(500).send({
        code: "FUNDING_READINESS_ADMIN_ERROR",
        message: "Failed to list funding readiness by user."
      });
    }
  });

  app.get("/admin/funding/readiness/venue/:venue", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = venueParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.fundingReadinessAdminService.listByVenue(parsed.data.venue) });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list funding readiness by venue.");
      return reply.status(500).send({
        code: "FUNDING_READINESS_ADMIN_ERROR",
        message: "Failed to list funding readiness by venue."
      });
    }
  });

  app.get("/admin/funding/readiness/:fundingIntentId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = fundingIntentParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const readiness = await deps.fundingReadinessAdminService.listByIntent(parsed.data.fundingIntentId);
      if (readiness.length === 0) {
        return reply.status(404).send({
          code: "FUNDING_READINESS_NOT_FOUND",
          message: "Funding readiness was not found."
        });
      }
      return reply.send({ readiness });
    } catch (error) {
      app.log.error({ err: error }, "Failed to load funding readiness.");
      return reply.status(500).send({
        code: "FUNDING_READINESS_ADMIN_ERROR",
        message: "Failed to load funding readiness."
      });
    }
  });
};
