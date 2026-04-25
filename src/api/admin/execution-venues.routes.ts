import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  ExecutionVenueNotFoundError,
  ExecutionVenuesAdminService
} from "./execution-venues-admin-service.js";

const paramsSchema = z.object({
  venue: z.string().min(1).transform((value) => value.toUpperCase())
});

export interface AdminExecutionVenuesRouteDeps {
  executionVenuesAdminService: ExecutionVenuesAdminService;
}

export const registerAdminExecutionVenuesRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminExecutionVenuesRouteDeps
): Promise<void> => {
  app.get("/admin/execution-venues", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ venues: await deps.executionVenuesAdminService.listVenues() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list execution venue readiness.");
      return reply.status(500).send({
        code: "EXECUTION_VENUES_ADMIN_ERROR",
        message: "Failed to list execution venue readiness."
      });
    }
  });

  app.get("/admin/execution-venues/:venue", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ venue: await deps.executionVenuesAdminService.getVenue(parsed.data.venue) });
    } catch (error) {
      if (error instanceof ExecutionVenueNotFoundError) {
        return reply.status(404).send({ code: "EXECUTION_VENUE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load execution venue readiness.");
      return reply.status(500).send({
        code: "EXECUTION_VENUES_ADMIN_ERROR",
        message: "Failed to load execution venue readiness."
      });
    }
  });
};
