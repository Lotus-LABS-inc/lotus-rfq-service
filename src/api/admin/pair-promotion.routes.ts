import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { PairRouteAdminService, PairRouteNotFoundError, PairRouteStageTransitionError } from "./pair-route-admin-service.js";

const paramsSchema = z.object({
  routeClass: z.enum(["PAIR_PM_LIMITLESS", "PAIR_PM_OPINION"])
});
const twoFactorTokenSchema = z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations");
const bodySchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  reason: z.string().min(1)
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return false;
};

export interface AdminPairPromotionRouteDeps {
  pairRouteAdminService: PairRouteAdminService;
}

export const registerAdminPairPromotionRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPairPromotionRouteDeps
): Promise<void> => {
  app.get("/admin/pair-routes/:routeClass/promotion-decisions", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ decisions: await deps.pairRouteAdminService.listPromotionDecisions(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair promotion decisions.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair promotion decisions." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/canary-readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.pairRouteAdminService.getCanaryReadiness(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair canary readiness.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair canary readiness." });
    }
  });

  app.post("/admin/pair-routes/:routeClass/promote-canary", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.pairRouteAdminService.promoteCanary(parsedParams.data.routeClass, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      if (error instanceof Error) {
        return reply.status(409).send({ code: "PAIR_ROUTE_PROMOTION_BLOCKED", message: error.message });
      }
      app.log.error({ err: error }, "Failed to promote pair route to canary.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to promote pair route to canary." });
    }
  });

  app.post("/admin/pair-routes/:routeClass/revert-shadow-only", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.pairRouteAdminService.revertShadowOnly(parsedParams.data.routeClass, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PairRouteStageTransitionError || error instanceof Error) {
        return reply.status(409).send({ code: "PAIR_ROUTE_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to revert pair route to shadow-only.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to revert pair route to shadow-only." });
    }
  });
};
