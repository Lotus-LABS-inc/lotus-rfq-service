import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  CryptoAdminService,
  CryptoLaneNotFoundError,
  CryptoLaneTransitionError
} from "./crypto-admin-service.js";

const laneIdSchema = z.string().min(1);
const paramsSchema = z.object({
  laneId: laneIdSchema
});
const bodySchema = z.object({
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations"),
  reason: z.string().min(1).optional()
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return token.length >= 6;
};

export interface AdminCryptoRouteDeps {
  cryptoAdminService: CryptoAdminService;
}

export const registerAdminCryptoRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminCryptoRouteDeps
): Promise<void> => {
  app.get("/admin/crypto-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.cryptoAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list crypto lanes.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to list crypto lanes." });
    }
  });

  app.get("/admin/crypto-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.cryptoAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto lane.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to load crypto lane." });
    }
  });

  app.get("/admin/crypto-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.cryptoAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto readiness.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to load crypto readiness." });
    }
  });

  app.get("/admin/crypto-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.cryptoAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto rollback plan.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to load crypto rollback plan." });
    }
  });

  app.get("/admin/crypto-lanes/:laneId/authority-state", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ authorityState: await deps.cryptoAdminService.getLaneAuthorityState(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto authority state.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to load crypto authority state." });
    }
  });

  app.post("/admin/crypto-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send({
        approvalIntent: await deps.cryptoAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof CryptoLaneTransitionError) {
        return reply.status(409).send({ code: "CRYPTO_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record crypto operator approval intent.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to record crypto operator approval intent." });
    }
  });

  app.post("/admin/crypto-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.cryptoAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold crypto lane.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to hold crypto lane." });
    }
  });

  app.post("/admin/crypto-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.cryptoAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return reply.status(404).send({ code: "CRYPTO_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back crypto lane.");
      return reply.status(500).send({ code: "CRYPTO_ADMIN_ERROR", message: "Failed to roll back crypto lane." });
    }
  });
};
