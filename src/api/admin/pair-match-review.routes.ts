import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { PairMatchReviewService, PairMatchReviewServiceError } from "./pair-match-review-service.js";

const edgeParamsSchema = z.object({
  id: z.string().min(1)
});

const mutationBodySchema = z.object({
  twoFactorToken: z.string().min(6),
  edgeId: z.string().min(1),
  reason: z.string().min(1)
});

export interface AdminPairMatchReviewRouteDeps {
  pairMatchReviewService: PairMatchReviewService;
}

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return token.length >= 6;
};

export const registerAdminPairMatchReviewRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPairMatchReviewRouteDeps
): Promise<void> => {
  app.get("/admin/pair-match-review/edges", { preHandler: adminMiddleware }, async (_request, reply) => {
    const edges = await deps.pairMatchReviewService.listEdges();
    return reply.send({ edges });
  });

  app.get("/admin/pair-match-review/pending", { preHandler: adminMiddleware }, async (_request, reply) => {
    const edges = await deps.pairMatchReviewService.listPendingReview();
    return reply.send({ edges });
  });

  app.get("/admin/pair-match-review/edge/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = edgeParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }

    try {
      const detail = await deps.pairMatchReviewService.getEdge(parsed.data.id);
      return reply.send(detail);
    } catch (error) {
      if (error instanceof PairMatchReviewServiceError) {
        return reply.status(404).send({ code: "PAIR_EDGE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to fetch pair-edge review detail.");
      return reply.status(500).send({ code: "PAIR_MATCH_REVIEW_ERROR", message: "Failed to fetch pair-edge review detail." });
    }
  });

  app.post("/admin/pair-match-review/approve", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = mutationBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    if (!validateTwoFactorToken(parsed.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }

    try {
      const detail = await deps.pairMatchReviewService.approveEdge(
        parsed.data.edgeId,
        request.user.userId,
        parsed.data.reason
      );
      return reply.send(detail);
    } catch (error) {
      if (error instanceof PairMatchReviewServiceError) {
        return reply.status(404).send({ code: "PAIR_EDGE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to approve pair-edge.");
      return reply.status(500).send({ code: "PAIR_MATCH_REVIEW_ERROR", message: "Failed to approve pair-edge." });
    }
  });

  app.post("/admin/pair-match-review/reject", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = mutationBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    if (!validateTwoFactorToken(parsed.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }

    try {
      const detail = await deps.pairMatchReviewService.rejectEdge(
        parsed.data.edgeId,
        request.user.userId,
        parsed.data.reason
      );
      return reply.send(detail);
    } catch (error) {
      if (error instanceof PairMatchReviewServiceError) {
        return reply.status(404).send({ code: "PAIR_EDGE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to reject pair-edge.");
      return reply.status(500).send({ code: "PAIR_MATCH_REVIEW_ERROR", message: "Failed to reject pair-edge." });
    }
  });
};
