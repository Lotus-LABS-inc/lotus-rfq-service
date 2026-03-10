import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  PlanNotFoundError,
  ProviderCandidateNotFoundError,
  SORAdminService,
  StepNotFoundError
} from "./sor-admin-service.js";

const planParamsSchema = z.object({
  id: z.string().uuid()
});

const forceUnwindBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

const retryStepBodySchema = z.object({
  stepId: z.string().uuid(),
  newProviderId: z.string().min(1),
  newProviderType: z.enum(["LP", "VENUE", "INTERNAL_CROSS"]).default("LP"),
  reason: z.string().min(1, "reason is required"),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

export interface AdminSORRouteDeps {
  sorAdminService: SORAdminService;
}

export const registerAdminSORRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminSORRouteDeps
): Promise<void> => {
  app.get("/admin/sor/plan/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = planParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const snapshot = await deps.sorAdminService.getPlanSnapshot(parsedParams.data.id);
      return reply.send(snapshot);
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        return reply.status(404).send({
          code: "PLAN_NOT_FOUND",
          message: error.message
        });
      }
      app.log.error({ err: error, planId: parsedParams.data.id }, "Failed to fetch SOR admin plan snapshot.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to fetch SOR plan snapshot." });
    }
  });

  app.post("/admin/sor/plan/:id/force-unwind", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = planParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = forceUnwindBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.sorAdminService.forceUnwind({
        planId: parsedParams.data.id,
        reason: parsedBody.data.reason,
        requestedBy: request.user.userId
      });
      return reply.send({
        ok: true,
        planId: result.planId,
        status: result.status
      });
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        return reply.status(404).send({
          code: "PLAN_NOT_FOUND",
          message: error.message
        });
      }
      app.log.error({ err: error, planId: parsedParams.data.id }, "Failed to force-unwind SOR plan.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to force-unwind SOR plan." });
    }
  });

  app.post("/admin/sor/plan/:id/retry-step", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = planParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = retryStepBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.sorAdminService.retryStep({
        planId: parsedParams.data.id,
        stepId: parsedBody.data.stepId,
        newProviderId: parsedBody.data.newProviderId,
        newProviderType: parsedBody.data.newProviderType,
        reason: parsedBody.data.reason,
        requestedBy: request.user.userId
      });
      return reply.send({
        ok: true,
        planId: result.planId,
        status: result.status
      });
    } catch (error) {
      if (error instanceof PlanNotFoundError) {
        return reply.status(404).send({
          code: "PLAN_NOT_FOUND",
          message: error.message
        });
      }
      if (error instanceof StepNotFoundError) {
        return reply.status(404).send({
          code: "STEP_NOT_FOUND",
          message: error.message
        });
      }
      if (error instanceof ProviderCandidateNotFoundError) {
        return reply.status(409).send({
          code: "PROVIDER_CANDIDATE_NOT_FOUND",
          message: error.message
        });
      }
      app.log.error(
        { err: error, planId: parsedParams.data.id, stepId: parsedBody.data.stepId },
        "Failed to retry SOR step."
      );
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to retry SOR step." });
    }
  });

  app.post("/admin/sor/config", { preHandler: adminMiddleware }, async (request, reply) => {
    const bodySchema = z.object({
      sorEnabled: z.boolean().optional(),
      sorCanaryShadowEnabled: z.boolean().optional(),
      sorCanaryPercent: z.number().min(0).max(100).optional(),
      twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
    });

    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      await deps.sorAdminService.updateConfig(parsedBody.data);
      return reply.send({ ok: true });
    } catch (error) {
      app.log.error({ err: error }, "Failed to update SOR runtime configuration.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to update SOR configuration." });
    }
  });
};
