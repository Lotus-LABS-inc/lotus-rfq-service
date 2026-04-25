import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  SportsAdminService,
  SportsLaneNotFoundError,
  SportsLaneTransitionError
} from "./sports-admin-service.js";
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

export interface AdminSportsRouteDeps {
  sportsAdminService: SportsAdminService;
}

export const registerAdminSportsRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminSportsRouteDeps
): Promise<void> => {
  app.get("/admin/sports-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.sportsAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list sports lanes.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to list sports lanes." });
    }
  });

  app.get("/admin/sports-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.sportsAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load sports lane.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to load sports lane." });
    }
  });

  app.get("/admin/sports-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.sportsAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load sports readiness.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to load sports readiness." });
    }
  });

  app.get("/admin/sports-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.sportsAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load sports rollback plan.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to load sports rollback plan." });
    }
  });

  app.get("/admin/sports-lanes/:laneId/authority-state", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ authorityState: await deps.sportsAdminService.getLaneAuthorityState(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load sports authority state.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to load sports authority state." });
    }
  });

  app.post("/admin/sports-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
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
        approvalIntent: await deps.sportsAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof SportsLaneTransitionError) {
        return reply.status(409).send({ code: "SPORTS_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record sports operator approval intent.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to record sports operator approval intent." });
    }
  });

  app.post("/admin/sports-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.sportsAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold sports lane.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to hold sports lane." });
    }
  });

  app.post("/admin/sports-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.sportsAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return reply.status(404).send({ code: "SPORTS_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back sports lane.");
      return reply.status(500).send({ code: "SPORTS_ADMIN_ERROR", message: "Failed to roll back sports lane." });
    }
  });
};
