import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  PoliticsOfficeWinnerAdminService,
  PoliticsOfficeWinnerLaneNotFoundError,
  PoliticsOfficeWinnerLaneTransitionError
} from "./politics-office-winner-admin-service.js";
import { politicsOfficeWinnerLaneIds } from "../../operations/semantic-expansion/politics-office-winner-limited-prod-shared.js";

const laneIdSchema = z.enum(politicsOfficeWinnerLaneIds);
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

export interface AdminPoliticsOfficeWinnerRouteDeps {
  politicsOfficeWinnerAdminService: PoliticsOfficeWinnerAdminService;
}

export const registerAdminPoliticsOfficeWinnerRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPoliticsOfficeWinnerRouteDeps
): Promise<void> => {
  app.get("/admin/politics-office-winner-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.politicsOfficeWinnerAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list politics office-winner lanes.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to list politics office-winner lanes." });
    }
  });

  app.get("/admin/politics-office-winner-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.politicsOfficeWinnerAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsOfficeWinnerLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_WINNER_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics office-winner lane.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to load politics office-winner lane." });
    }
  });

  app.get("/admin/politics-office-winner-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.politicsOfficeWinnerAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsOfficeWinnerLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_WINNER_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics office-winner readiness.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to load politics office-winner readiness." });
    }
  });

  app.get("/admin/politics-office-winner-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.politicsOfficeWinnerAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsOfficeWinnerLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_WINNER_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics office-winner rollback plan.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to load politics office-winner rollback plan." });
    }
  });

  app.post("/admin/politics-office-winner-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
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
        approvalIntent: await deps.politicsOfficeWinnerAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof PoliticsOfficeWinnerLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_WINNER_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PoliticsOfficeWinnerLaneTransitionError) {
        return reply.status(409).send({ code: "POLITICS_OFFICE_WINNER_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record politics office-winner operator approval intent.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to record politics office-winner operator approval intent." });
    }
  });

  app.post("/admin/politics-office-winner-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsOfficeWinnerAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsOfficeWinnerLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_WINNER_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold politics office-winner lane.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to hold politics office-winner lane." });
    }
  });

  app.post("/admin/politics-office-winner-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsOfficeWinnerAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsOfficeWinnerLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_WINNER_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back politics office-winner lane.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_WINNER_ADMIN_ERROR", message: "Failed to roll back politics office-winner lane." });
    }
  });
};
