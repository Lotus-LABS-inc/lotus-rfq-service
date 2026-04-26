import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  CreateFundingIntentSchema,
  FundingError,
  type FundingIntentView
} from "../../core/funding/types.js";

const submitFundingRouteLegSchema = z.object({
  routeLegId: z.string().min(1),
  txHash: z.string().min(1)
});

export interface FundingRouteHandlers {
  createIntent(userId: string, request: z.infer<typeof CreateFundingIntentSchema>): Promise<FundingIntentView>;
  getIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  quoteIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  submitRouteLeg(userId: string, fundingIntentId: string, request: z.infer<typeof submitFundingRouteLegSchema>): Promise<FundingIntentView>;
  refreshIntentStatus(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  listVenueCapabilities(): Promise<unknown>;
}

export const registerFundingRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: FundingRouteHandlers
): Promise<void> => {
  app.post("/funding/intents", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = CreateFundingIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Funding intent request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const result = await handlers.createIntent(request.user.userId, parsed.data);
      return reply.status(201).send(toFundingResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/intents/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.getIntent(request.user.userId, id);
      return reply.status(200).send(toFundingResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.post("/funding/intents/:id/quote", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.quoteIntent(request.user.userId, id);
      return reply.status(200).send(toFundingResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.post("/funding/intents/:id/submit", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = submitFundingRouteLegSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Funding route submission request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const result = await handlers.submitRouteLeg(request.user.userId, id, parsed.data);
      return reply.status(202).send(toFundingResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/intents/:id/status", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.refreshIntentStatus(request.user.userId, id);
      return reply.status(200).send(toFundingResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/venues/capabilities", { preHandler: authMiddleware }, async (_request, reply) => {
    const capabilities = await handlers.listVenueCapabilities();
    return reply.status(200).send({ capabilities });
  });
};

const toFundingResponse = (view: FundingIntentView): Record<string, unknown> => ({
  fundingIntentId: view.intent.fundingIntentId,
  currentStatus: view.intent.status,
  sourceChain: view.intent.sourceChain,
  sourceToken: view.intent.sourceToken,
  sourceAmount: view.intent.sourceAmount,
  routePreview: view.intent.aggregateRouteQuote,
  totalEstimatedFees: view.intent.totalEstimatedFees,
  totalEstimatedTimeSeconds: view.intent.totalEstimatedTimeSeconds,
  targets: view.targets,
  routeLegs: view.routeLegs,
  reconciliations: view.reconciliations,
  userSafeMessage: view.userSafeMessage
});

const handleFundingError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof FundingError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message
    });
  }
  throw error;
};
