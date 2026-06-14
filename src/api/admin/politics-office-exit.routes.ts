import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  PoliticsOfficeExitAdminService,
  PoliticsOfficeExitLaneNotFoundError,
  PoliticsOfficeExitLaneTransitionError
} from "./politics-office-exit-admin-service.js";
import { politicsOfficeExitLaneIds } from "../../operations/semantic-expansion/politics-office-exit-netanyahu-2026-limited-prod-shared.js";

const laneIdSchema = z.enum(politicsOfficeExitLaneIds);
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
  return false;
};

export interface AdminPoliticsOfficeExitRouteDeps {
  politicsOfficeExitAdminService: PoliticsOfficeExitAdminService;
}

export const registerAdminPoliticsOfficeExitRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPoliticsOfficeExitRouteDeps
): Promise<void> => {
  app.get("/admin/politics-office-exit-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.politicsOfficeExitAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list politics office-exit lanes.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to list politics office-exit lanes." });
    }
  });

  app.get("/admin/politics-office-exit-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.politicsOfficeExitAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsOfficeExitLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_EXIT_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics office-exit lane.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to load politics office-exit lane." });
    }
  });

  app.get("/admin/politics-office-exit-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.politicsOfficeExitAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsOfficeExitLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_EXIT_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics office-exit readiness.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to load politics office-exit readiness." });
    }
  });

  app.get("/admin/politics-office-exit-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.politicsOfficeExitAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsOfficeExitLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_EXIT_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics office-exit rollback plan.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to load politics office-exit rollback plan." });
    }
  });

  app.post("/admin/politics-office-exit-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
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
        approvalIntent: await deps.politicsOfficeExitAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof PoliticsOfficeExitLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_EXIT_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PoliticsOfficeExitLaneTransitionError) {
        return reply.status(409).send({ code: "POLITICS_OFFICE_EXIT_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record politics office-exit operator approval intent.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to record politics office-exit operator approval intent." });
    }
  });

  app.post("/admin/politics-office-exit-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsOfficeExitAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsOfficeExitLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_EXIT_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold politics office-exit lane.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to hold politics office-exit lane." });
    }
  });

  app.post("/admin/politics-office-exit-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsOfficeExitAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsOfficeExitLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_OFFICE_EXIT_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back politics office-exit lane.");
      return reply.status(500).send({ code: "POLITICS_OFFICE_EXIT_ADMIN_ERROR", message: "Failed to roll back politics office-exit lane." });
    }
  });
};
