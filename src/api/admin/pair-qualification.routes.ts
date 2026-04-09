import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { PairRouteAdminService, PairRouteNotFoundError } from "./pair-route-admin-service.js";

const paramsSchema = z.object({
  routeClass: z.enum(["PAIR_PM_LIMITLESS", "PAIR_PM_OPINION"])
});

export interface AdminPairQualificationRouteDeps {
  pairRouteAdminService: PairRouteAdminService;
}

export const registerAdminPairQualificationRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPairQualificationRouteDeps
): Promise<void> => {
  app.get("/admin/pair-routes/:routeClass/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const route = await deps.pairRouteAdminService.getPairRoute(parsed.data.routeClass);
      return reply.send({
        routeClass: route.routeClassId,
        currentStage: route.currentStage,
        readinessState: route.readinessState,
        recommendation: route.recommendation,
        historicalQualification: route.historicalQualification,
        liveQualification: route.liveQualification,
        mixedBasisDiagnostic: route.mixedBasisDiagnostic,
        riskProfile: route.riskProfile,
        evidenceRefs: route.evidenceRefs
      });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair route readiness.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair route readiness." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/coverage", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send(await deps.pairRouteAdminService.getPairRouteCoverage(parsed.data.routeClass));
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load pair route coverage.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load pair route coverage." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/crypto-prod-readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.pairRouteAdminService.getCryptoProdReadiness(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load crypto production readiness.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load crypto production readiness." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/canary-scope-lock", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ scopeLock: await deps.pairRouteAdminService.getCanaryScopeLock(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load canary scope lock.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load canary scope lock." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/canary-approval-state", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ approvalState: await deps.pairRouteAdminService.getCanaryApprovalState(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load canary approval state.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load canary approval state." });
    }
  });

  app.get("/admin/pair-routes/:routeClass/final-canary-package", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ package: await deps.pairRouteAdminService.getFinalCanaryPackage(parsed.data.routeClass) });
    } catch (error) {
      if (error instanceof PairRouteNotFoundError) {
        return reply.status(404).send({ code: "PAIR_ROUTE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load final canary package.");
      return reply.status(500).send({ code: "PAIR_ROUTE_ADMIN_ERROR", message: "Failed to load final canary package." });
    }
  });
};
