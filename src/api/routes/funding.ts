import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  CreateWithdrawalIntentSchema,
  CreateFundingIntentSchema,
  FundingError,
  type FundingIntentView,
  type VenueBalanceView,
  type WithdrawalIntentView
} from "../../core/funding/types.js";

const submitFundingRouteLegSchema = z.object({
  routeLegId: z.string().min(1),
  txHash: z.string().min(1)
});

const submitWithdrawalRouteLegSchema = z.object({
  withdrawalRouteLegId: z.string().min(1),
  txHash: z.string().min(1)
});

export interface FundingRouteHandlers {
  createIntent(userId: string, request: z.infer<typeof CreateFundingIntentSchema>): Promise<FundingIntentView>;
  getIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  quoteIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  submitRouteLeg(userId: string, fundingIntentId: string, request: z.infer<typeof submitFundingRouteLegSchema>): Promise<FundingIntentView>;
  refreshIntentStatus(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  listVenueCapabilities(): Promise<unknown>;
  listVenueBalances(userId: string): Promise<VenueBalanceView[]>;
  createWithdrawalIntent(userId: string, request: z.infer<typeof CreateWithdrawalIntentSchema>): Promise<WithdrawalIntentView>;
  getWithdrawalIntent(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView>;
  quoteWithdrawalIntent(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView>;
  submitWithdrawalRouteLeg(userId: string, withdrawalIntentId: string, request: z.infer<typeof submitWithdrawalRouteLegSchema>): Promise<WithdrawalIntentView>;
  refreshWithdrawalStatus(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView>;
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

  app.get("/funding/venue-balances", { preHandler: authMiddleware }, async (request, reply) => {
    const balances = await handlers.listVenueBalances(request.user.userId);
    return reply.status(200).send({ balances });
  });

  app.post("/funding/withdrawals", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = CreateWithdrawalIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Withdrawal intent request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const result = await handlers.createWithdrawalIntent(request.user.userId, parsed.data);
      return reply.status(201).send(toWithdrawalResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/withdrawals/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.getWithdrawalIntent(request.user.userId, id);
      return reply.status(200).send(toWithdrawalResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.post("/funding/withdrawals/:id/quote", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.quoteWithdrawalIntent(request.user.userId, id);
      return reply.status(200).send(toWithdrawalResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.post("/funding/withdrawals/:id/submit", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = submitWithdrawalRouteLegSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Withdrawal route submission request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const result = await handlers.submitWithdrawalRouteLeg(request.user.userId, id, parsed.data);
      return reply.status(202).send(toWithdrawalResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/withdrawals/:id/status", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.refreshWithdrawalStatus(request.user.userId, id);
      return reply.status(200).send(toWithdrawalResponse(result));
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });
};

const toFundingResponse = (view: FundingIntentView): Record<string, unknown> => ({
  fundingIntentId: view.intent.fundingIntentId,
  currentStatus: view.intent.status,
  sourceChain: view.intent.sourceChain,
  sourceToken: view.intent.sourceToken,
  sourceAmount: view.intent.sourceAmount,
  sourceWalletId: view.intent.sourceWalletId ?? null,
  sourceWalletAddress: view.intent.sourceWalletAddress,
  routePreview: view.intent.aggregateRouteQuote,
  totalEstimatedFees: view.intent.totalEstimatedFees,
  totalEstimatedTimeSeconds: view.intent.totalEstimatedTimeSeconds,
  targets: view.targets,
  routeLegs: view.routeLegs,
  reconciliations: view.reconciliations,
  userSafeMessage: view.userSafeMessage
});

const toWithdrawalResponse = (view: WithdrawalIntentView): Record<string, unknown> => ({
  withdrawalIntentId: view.intent.withdrawalIntentId,
  currentStatus: view.intent.status,
  token: view.intent.token,
  amount: view.intent.amount,
  destinationChain: view.intent.destinationChain,
  destinationWalletAddress: view.intent.destinationWalletAddress,
  routePreview: view.intent.aggregateRouteQuote,
  totalEstimatedFees: view.intent.totalEstimatedFees,
  totalEstimatedTimeSeconds: view.intent.totalEstimatedTimeSeconds,
  sources: view.sources,
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
