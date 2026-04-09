import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { PairRouteAdminService, PairRouteNotFoundError } from "./pair-route-admin-service.js";

const paramsSchema = z.object({
  routeClass: z.enum(["PAIR_PM_LIMITLESS", "PAIR_PM_OPINION"])
});
const twoFactorTokenSchema = z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations");
const topUpBodySchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  canonicalMarketId: z.string().min(1),
  expectedNetPrice: z.number().optional(),
  expectedEffectiveCost: z.number().optional(),
  expectedSlippage: z.number().optional(),
  expectedFillability: z.number().optional(),
  reason: z.string().min(1).optional()
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return token.length >= 6;
};

export interface AdminPairShadowRouteDeps {
  pairRouteAdminService: PairRouteAdminService;
}

export const registerAdminPairShadowRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPairShadowRouteDeps
): Promise<void> => {
  app.get("/admin/pair-routes/:routeClass/shadow-evidence", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ evidence: await deps.pairRouteAdminService.getShadowEvidence(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair shadow evidence.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair shadow evidence." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/promotion-blockers", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ blockers: await deps.pairRouteAdminService.getPromotionBlockers(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair promotion blockers.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair promotion blockers." });
    }
  });

  app.post("/admin/pair-routes/:routeClass/top-up-runtime-observation", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = topUpBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send({
        observation: await deps.pairRouteAdminService.recordRuntimeTopUpObservation({
          routeClass: parsedParams.data.routeClass,
          canonicalMarketId: parsedBody.data.canonicalMarketId,
          operatorIdentity: request.user.userId,
          ...(typeof parsedBody.data.expectedNetPrice === "number" ? { expectedNetPrice: parsedBody.data.expectedNetPrice } : {}),
          ...(typeof parsedBody.data.expectedEffectiveCost === "number" ? { expectedEffectiveCost: parsedBody.data.expectedEffectiveCost } : {}),
          ...(typeof parsedBody.data.expectedSlippage === "number" ? { expectedSlippage: parsedBody.data.expectedSlippage } : {}),
          ...(typeof parsedBody.data.expectedFillability === "number" ? { expectedFillability: parsedBody.data.expectedFillability } : {}),
          ...(parsedBody.data.reason ? { reason: parsedBody.data.reason } : {})
        })
      });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      if (error instanceof Error) {
        return reply.status(409).send({ code: "PAIR_ROUTE_TOP_UP_BLOCKED", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record pair shadow top-up observation.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to record pair shadow top-up observation." });
    }
  });
};
