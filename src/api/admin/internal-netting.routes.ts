import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  InternalNettingAdminService,
  InternalNettingAmbiguityError,
  InternalNettingComboNotFoundError,
  InternalNettingGroupNotFoundError
} from "./internal-netting-admin-service.js";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const reconcileBodySchema = z.object({
  dryRun: z.boolean().default(true),
  force: z.boolean().default(false),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

const forceFailBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

export interface AdminInternalNettingRouteDeps {
  internalNettingAdminService: InternalNettingAdminService;
}

export const registerAdminInternalNettingRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminInternalNettingRouteDeps
): Promise<void> => {
  app.get("/admin/internal-netting/group/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const inspection = await deps.internalNettingAdminService.getGroupInspection(parsedParams.data.id);
      return reply.send(inspection);
    } catch (error) {
      if (error instanceof InternalNettingGroupNotFoundError) {
        return reply.status(404).send({ code: "GROUP_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalNettingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, groupId: parsedParams.data.id }, "Failed to inspect internal netting group.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to inspect internal netting group." });
    }
  });

  app.get("/admin/internal-netting/combo/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const inspection = await deps.internalNettingAdminService.getComboInspection(parsedParams.data.id);
      return reply.send(inspection);
    } catch (error) {
      if (error instanceof InternalNettingComboNotFoundError) {
        return reply.status(404).send({ code: "COMBO_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalNettingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, comboId: parsedParams.data.id }, "Failed to inspect internal netting combo.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to inspect internal netting combo." });
    }
  });

  app.post("/admin/internal-netting/group/:id/reconcile", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = reconcileBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalNettingAdminService.reconcileGroup({
        groupId: parsedParams.data.id,
        requestedBy: request.user.userId,
        dryRun: parsedBody.data.dryRun,
        force: parsedBody.data.force
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalNettingGroupNotFoundError) {
        return reply.status(404).send({ code: "GROUP_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalNettingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, groupId: parsedParams.data.id }, "Failed to reconcile internal netting group.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to reconcile internal netting group." });
    }
  });

  app.post("/admin/internal-netting/group/:id/force-fail", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = forceFailBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalNettingAdminService.createForceFailTask({
        groupId: parsedParams.data.id,
        requestedBy: request.user.userId,
        reason: parsedBody.data.reason
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalNettingGroupNotFoundError) {
        return reply.status(404).send({ code: "GROUP_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalNettingAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, groupId: parsedParams.data.id }, "Failed to create internal netting force-fail task.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to create internal netting force-fail task." });
    }
  });
};
