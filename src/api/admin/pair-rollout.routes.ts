import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import { PairRoutePromotionBlockedError } from "../../rollout/pair-route-promotion-policy.js";
import { PairRouteAdminService, PairRouteNotFoundError, PairRouteStageTransitionError } from "./pair-route-admin-service.js";

const routeClassSchema = z.enum(["PAIR_PM_LIMITLESS", "PAIR_PM_OPINION"]);
const paramsSchema = z.object({
  routeClass: routeClassSchema
});
const twoFactorTokenSchema = z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations");
const mutateSchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  reason: z.string().min(1).optional()
});
const demoteSchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  reason: z.string().min(1),
  targetStage: z.nativeEnum(QualificationStage)
});
const approvalIntentSchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  reason: z.string().min(1).optional()
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return token.length >= 6;
};

export interface AdminPairRolloutRouteDeps {
  pairRouteAdminService: PairRouteAdminService;
}

export const registerAdminPairRolloutRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPairRolloutRouteDeps
): Promise<void> => {
  app.get("/admin/pair-routes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ routes: await deps.pairRouteAdminService.listPairRoutes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list pair routes.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to list pair routes." });
    }
  });

  app.get("/admin/pair-routes/:routeClass", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ route: await deps.pairRouteAdminService.getPairRoute(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair route.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair route." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/launch-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ launchPlan: await deps.pairRouteAdminService.getCryptoLaunchPlan(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto launch plan.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load crypto launch plan." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.pairRouteAdminService.getCryptoRollbackPlan(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto rollback plan.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load crypto rollback plan." });
    }
  });

  app.post("/admin/pair-routes/:routeClass/promote-shadow", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = mutateSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      const result = await deps.pairRouteAdminService.promoteShadow(
        parsedParams.data.routeClass,
        request.user.userId,
        parsedBody.data.reason ?? null
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PairRoutePromotionBlockedError) {
        return reply.status(409).send({ code: "PAIR_ROUTE_PROMOTION_BLOCKED", reasons: error.reasons });
      }
      if (error instanceof PairRouteStageTransitionError) {
        return reply.status(409).send({ code: "PAIR_ROUTE_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to promote pair route to shadow.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to promote pair route." });
    }
  });

  app.post("/admin/pair-routes/:routeClass/demote", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = demoteSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      const result = await deps.pairRouteAdminService.demote(
        parsedParams.data.routeClass,
        parsedBody.data.targetStage,
        request.user.userId,
        parsedBody.data.reason
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      if (error instanceof Error) {
        return reply.status(409).send({ code: "PAIR_ROUTE_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to demote pair route.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to demote pair route." });
    }
  });

  app.post("/admin/pair-routes/:routeClass/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = approvalIntentSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send({
        approvalIntent: await deps.pairRouteAdminService.recordOperatorApprovalIntent(
          parsedParams.data.routeClass,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PairRouteStageTransitionError) {
        return reply.status(409).send({ code: "PAIR_ROUTE_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record operator approval intent.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to record operator approval intent." });
    }
  });
};
