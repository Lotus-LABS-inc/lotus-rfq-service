import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  DuplicateQuoteIdError,
  InvalidRFQSessionStateError,
  LPFlowSegmentNotSubscribedError,
  LPIdentityMismatchError,
  ReceiveLPQuoteService,
  RFQSessionNotFoundError,
  ResolutionRiskQuoteRejectedError
} from "../receive-lp-quote-service.js";
import type { LPAuthenticatedRequest } from "../lp-auth-middleware.js";

const lpQuoteBodySchema = z.object({
  sessionId: z.string().uuid(),
  quoteId: z.string().min(1),
  price: z.string().regex(/^\d+(\.\d+)?$/),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  feeBps: z.number().int().min(0).max(10000),
  validUntil: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).optional()
});

type LPQuoteBody = z.infer<typeof lpQuoteBodySchema>;

export const registerLPQuotesRoute = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  receiveLPQuoteService: ReceiveLPQuoteService
): Promise<void> => {
  app.post("/lp/:id/quotes", { preHandler: authMiddleware }, async (request, reply) => {
    const lpRequest = request as LPAuthenticatedRequest;
    const parsedBody = lpQuoteBodySchema.safeParse(lpRequest.body);
    if (!parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_LP_QUOTE_REQUEST",
        message: "LP quote request validation failed.",
        details: parsedBody.error.flatten()
      });
    }

    const paramsSchema = z.object({ id: z.string().min(1) });
    const parsedParams = paramsSchema.safeParse(lpRequest.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        code: "INVALID_LP_ROUTE_PARAMS",
        message: "Invalid LP route parameters."
      });
    }

    try {
      const command: LPQuoteBody = parsedBody.data;
      const result = await receiveLPQuoteService.execute({
        routeLpId: parsedParams.data.id,
        authenticatedLpId: lpRequest.lpAuth.lpId,
        authenticatedLpKeyId: lpRequest.lpAuth.keyId,
        authenticatedLpKeyDbId: lpRequest.lpAuth.lpKeyDbId,
        sessionId: command.sessionId,
        quoteId: command.quoteId,
        price: command.price,
        quantity: command.quantity,
        feeBps: command.feeBps,
        validUntil: command.validUntil,
        ...(command.payload ? { payload: command.payload } : {})
      });

      return reply.status(202).send(result);
    } catch (error) {
      if (error instanceof LPIdentityMismatchError) {
        return reply.status(403).send({
          code: "LP_IDENTITY_MISMATCH",
          message: error.message
        });
      }

      if (error instanceof RFQSessionNotFoundError) {
        return reply.status(404).send({
          code: "RFQ_SESSION_NOT_FOUND",
          message: error.message
        });
      }

      if (error instanceof InvalidRFQSessionStateError) {
        return reply.status(409).send({
          code: "RFQ_SESSION_STATE_INVALID",
          message: error.message
        });
      }

      if (error instanceof DuplicateQuoteIdError) {
        return reply.status(409).send({
          code: "QUOTE_IDEMPOTENCY_CONFLICT",
          message: error.message
        });
      }

      if (error instanceof ResolutionRiskQuoteRejectedError) {
        return reply.status(409).send({
          code: "RESOLUTION_RISK_QUOTE_REJECTED",
          message: error.message
        });
      }

      if (error instanceof LPFlowSegmentNotSubscribedError) {
        return reply.status(409).send({
          code: error.code,
          message: error.message
        });
      }

      throw error;
    }
  });
};
