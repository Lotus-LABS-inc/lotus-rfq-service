import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { TriMatchReviewService, TriMatchReviewServiceError } from "./tri-match-review-service.js";
import { TriRouteClassDefinitions } from "../../rollout/tri-route-classes.js";
import type { TriRouteReadinessState } from "../../rollout/tri-route-classes.js";

const candidateParamsSchema = z.object({
  id: z.string().min(1)
});

export interface AdminTriMatchReviewRouteDeps {
  triMatchReviewService: TriMatchReviewService;
}

const resolveReadinessState = (eligible: number, total: number): TriRouteReadinessState => {
  if (total === 0) return "NOT_READY";
  if (eligible === 0) return "BLOCKED";
  if (eligible >= 3) return "SHADOW_READY";
  return "NOT_READY";
};

export const registerAdminTriMatchReviewRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminTriMatchReviewRouteDeps
): Promise<void> => {
  app.get("/admin/tri-match-review/summary", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const summary = await deps.triMatchReviewService.getSummary();
      return reply.send({ summary });
    } catch (error) {
      app.log.error({ err: error }, "Failed to get tri-match review summary.");
      return reply.status(500).send({ code: "TRI_MATCH_REVIEW_ERROR", message: "Failed to get tri-match review summary." });
    }
  });

  app.get("/admin/tri-match-review/route-classes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const summary = await deps.triMatchReviewService.getSummary();
      const readinessState = resolveReadinessState(summary.eligible, summary.total);
      return reply.send({
        routeClasses: TriRouteClassDefinitions.map((definition) => ({
          ...definition,
          totalCandidates: summary.total,
          eligibleCandidates: summary.eligible,
          blockedCandidates: summary.blocked,
          blockerReasonCounts: summary.blockerReasonCounts,
          currentReadinessState: readinessState
        }))
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list tri route classes.");
      return reply.status(500).send({ code: "TRI_MATCH_REVIEW_ERROR", message: "Failed to list tri route classes." });
    }
  });

  app.get("/admin/tri-match-review/candidates", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const candidates = await deps.triMatchReviewService.listCandidates();
      return reply.send({ candidates });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list tri candidates.");
      return reply.status(500).send({ code: "TRI_MATCH_REVIEW_ERROR", message: "Failed to list tri candidates." });
    }
  });

  app.get("/admin/tri-match-review/eligible", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const candidates = await deps.triMatchReviewService.listEligible();
      return reply.send({ candidates });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list eligible tri candidates.");
      return reply.status(500).send({ code: "TRI_MATCH_REVIEW_ERROR", message: "Failed to list eligible tri candidates." });
    }
  });

  app.get("/admin/tri-match-review/blocked", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const candidates = await deps.triMatchReviewService.listBlocked();
      return reply.send({ candidates });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list blocked tri candidates.");
      return reply.status(500).send({ code: "TRI_MATCH_REVIEW_ERROR", message: "Failed to list blocked tri candidates." });
    }
  });

  app.get("/admin/tri-match-review/candidate/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = candidateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const detail = await deps.triMatchReviewService.getCandidate(parsed.data.id);
      return reply.send(detail);
    } catch (error) {
      if (error instanceof TriMatchReviewServiceError) {
        return reply.status(404).send({ code: "TRI_CANDIDATE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to fetch tri candidate detail.");
      return reply.status(500).send({ code: "TRI_MATCH_REVIEW_ERROR", message: "Failed to fetch tri candidate detail." });
    }
  });
};
