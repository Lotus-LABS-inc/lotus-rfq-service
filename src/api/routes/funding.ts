import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  CreateWithdrawalIntentSchema,
  CreateFundingIntentSchema,
  FundingError,
  type FundingHistoryPage,
  type FundingIntentView,
  type VenueBalanceView,
  type WithdrawalIntentView
} from "../../core/funding/types.js";
import type { VenueBalanceActivationAction } from "../../core/funding/venue-activation.js";
import type { RateLimiter } from "../rate-limiter.js";

const submitFundingRouteLegSchema = z.object({
  routeLegId: z.string().min(1),
  txHash: z.string().min(1)
});

const submitWithdrawalRouteLegSchema = z.object({
  withdrawalRouteLegId: z.string().min(1),
  txHash: z.string().min(1)
});

const fundingHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const depositWalletCallSchema = z.object({
  target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  value: z.string().regex(/^\d+$/),
  data: z.string().regex(/^0x[a-fA-F0-9]*$/)
});

const submitPolymarketActivationSchema = z.object({
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  depositWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().regex(/^\d+$/),
  deadline: z.string().regex(/^\d+$/),
  calls: z.array(depositWalletCallSchema).min(1).max(4),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/)
});

export interface FundingRouteHandlers {
  createIntent(userId: string, request: z.infer<typeof CreateFundingIntentSchema>): Promise<FundingIntentView>;
  getIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  quoteIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  submitRouteLeg(userId: string, fundingIntentId: string, request: z.infer<typeof submitFundingRouteLegSchema>): Promise<FundingIntentView>;
  refreshIntentStatus(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  listVenueCapabilities(): Promise<unknown>;
  listVenueBalances(userId: string): Promise<VenueBalanceView[]>;
  listVenueActivations(userId: string): Promise<VenueBalanceActivationAction[]>;
  preparePolymarketActivation?(userId: string): Promise<unknown>;
  submitPolymarketActivation?(userId: string, request: z.infer<typeof submitPolymarketActivationSchema>): Promise<unknown>;
  listFundingHistory(userId: string, input?: { page?: number; pageSize?: number; limit?: number }): Promise<FundingHistoryPage>;
  createWithdrawalIntent(userId: string, request: z.infer<typeof CreateWithdrawalIntentSchema>): Promise<WithdrawalIntentView>;
  getWithdrawalIntent(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView>;
  quoteWithdrawalIntent(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView>;
  submitWithdrawalRouteLeg(userId: string, withdrawalIntentId: string, request: z.infer<typeof submitWithdrawalRouteLegSchema>): Promise<WithdrawalIntentView>;
  refreshWithdrawalStatus(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView>;
}

export interface FundingRouteOptions {
  intentCreateRateLimiter?: RateLimiter | undefined;
}

export const registerFundingRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: FundingRouteHandlers,
  options: FundingRouteOptions = {}
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
    const rateLimit = await consumeIntentCreateRateLimit(options.intentCreateRateLimiter, {
      scope: "funding_intent_create",
      userId: request.user.userId,
      ip: request.ip
    });
    if (!rateLimit.allowed) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "Too many funding intents created. Please reuse an existing intent or wait before creating another."
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

  app.get("/funding/venue-activations", { preHandler: authMiddleware }, async (request, reply) => {
    const activations = await handlers.listVenueActivations(request.user.userId);
    return reply.status(200).send({ activations });
  });

  app.post("/funding/venue-activations/polymarket/prepare", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.preparePolymarketActivation) {
      return reply.status(503).send({
        code: "ACTIVATION_UNAVAILABLE",
        message: "Polymarket deposit-wallet activation is not available."
      });
    }
    try {
      const activation = await handlers.preparePolymarketActivation(request.user.userId);
      return reply.status(200).send({ activation });
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.post("/funding/venue-activations/polymarket/submit", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.submitPolymarketActivation) {
      return reply.status(503).send({
        code: "ACTIVATION_UNAVAILABLE",
        message: "Polymarket deposit-wallet activation is not available."
      });
    }
    const parsed = submitPolymarketActivationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Polymarket activation submission validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const activation = await handlers.submitPolymarketActivation(request.user.userId, parsed.data);
      return reply.status(202).send({ activation });
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/history", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = fundingHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Funding history query validation failed.",
        details: parsed.error.flatten()
      });
    }
    const historyInput: { page?: number; pageSize?: number; limit?: number } = {};
    if (typeof parsed.data.page === "number") {
      historyInput.page = parsed.data.page;
    }
    if (typeof parsed.data.pageSize === "number") {
      historyInput.pageSize = parsed.data.pageSize;
    }
    if (typeof parsed.data.limit === "number") {
      historyInput.limit = parsed.data.limit;
    }
    const history = await handlers.listFundingHistory(request.user.userId, historyInput);
    return reply.status(200).send({
      asOf: new Date().toISOString(),
      refreshAfterSeconds: 10,
      ...history
    });
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
    const rateLimit = await consumeIntentCreateRateLimit(options.intentCreateRateLimiter, {
      scope: "withdrawal_intent_create",
      userId: request.user.userId,
      ip: request.ip
    });
    if (!rateLimit.allowed) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "Too many withdrawal intents created. Please reuse an existing intent or wait before creating another."
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

const consumeIntentCreateRateLimit = async (
  rateLimiter: RateLimiter | undefined,
  input: { scope: string; userId: string; ip: string }
) => {
  if (!rateLimiter) {
    return { allowed: true };
  }
  return rateLimiter.consume(input);
};
