import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  InternalClearingAdminService,
  InternalClearingAmbiguityError,
  InternalClearingEntityNotFoundError,
  InternalClearingRoundNotFoundError
} from "./internal-clearing-admin-service.js";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const reconcileBodySchema = z.object({
  dryRun: z.boolean().default(true),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

const forceFailBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

export interface AdminInternalClearingRouteDeps {
  internalClearingAdminService: InternalClearingAdminService;
}

export const registerAdminInternalClearingRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminInternalClearingRouteDeps
): Promise<void> => {
  app.get("/admin/internal-clearing/round/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const inspection = await deps.internalClearingAdminService.getRoundInspection(parsedParams.data.id);
      return reply.send(inspection);
    } catch (error) {
      if (error instanceof InternalClearingRoundNotFoundError) {
        return reply.status(404).send({ code: "ROUND_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalClearingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, roundId: parsedParams.data.id }, "Failed to inspect internal clearing round.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to inspect internal clearing round." });
    }
  });

  app.get("/admin/internal-clearing/entity/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const inspection = await deps.internalClearingAdminService.getEntityInspection(parsedParams.data.id);
      return reply.send(inspection);
    } catch (error) {
      if (error instanceof InternalClearingEntityNotFoundError) {
        return reply.status(404).send({ code: "ENTITY_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalClearingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, entityId: parsedParams.data.id }, "Failed to inspect internal clearing entity.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to inspect internal clearing entity." });
    }
  });

  app.post("/admin/internal-clearing/round/:id/reconcile", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    const parsedBody = reconcileBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalClearingAdminService.reconcileRound({
        roundId: parsedParams.data.id,
        requestedBy: request.user.userId,
        dryRun: parsedBody.data.dryRun
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalClearingRoundNotFoundError) {
        return reply.status(404).send({ code: "ROUND_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalClearingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, roundId: parsedParams.data.id }, "Failed to reconcile internal clearing round.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to reconcile internal clearing round." });
    }
  });

  app.post("/admin/internal-clearing/round/:id/force-fail", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    const parsedBody = forceFailBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalClearingAdminService.createForceFailTask({
        roundId: parsedParams.data.id,
        requestedBy: request.user.userId,
        reason: parsedBody.data.reason
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalClearingRoundNotFoundError) {
        return reply.status(404).send({ code: "ROUND_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalClearingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, roundId: parsedParams.data.id }, "Failed to create internal clearing force-fail task.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to create internal clearing force-fail task." });
    }
  });
};
