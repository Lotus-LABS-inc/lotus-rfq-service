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

const submitSignedSolanaFundingRouteLegSchema = z.object({
  routeLegId: z.string().min(1),
  signedTransaction: z.string().min(1)
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
  calls: z.array(depositWalletCallSchema).min(1).max(12),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  tokenId: z.string().regex(/^\d+$/).optional()
});

const preparePolymarketActivationSchema = z.object({
  tokenId: z.string().regex(/^\d+$/).optional()
});

const polymarketClobSyncSignedPayloadSchema = z.object({
  signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  typedData: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()).optional()
});

const submitPolymarketClobSyncSchema = z.object({
  signedPayload: polymarketClobSyncSignedPayloadSchema
});

export interface FundingRouteHandlers {
  createIntent(userId: string, request: z.infer<typeof CreateFundingIntentSchema>): Promise<FundingIntentView>;
  getIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  quoteIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  submitRouteLeg(userId: string, fundingIntentId: string, request: z.infer<typeof submitFundingRouteLegSchema>): Promise<FundingIntentView>;
  submitSignedSolanaRouteLeg?(userId: string, fundingIntentId: string, request: z.infer<typeof submitSignedSolanaFundingRouteLegSchema>): Promise<FundingIntentView>;
  refreshIntentStatus(userId: string, fundingIntentId: string): Promise<FundingIntentView>;
  listVenueCapabilities(): Promise<unknown>;
  listVenueBalances(userId: string): Promise<VenueBalanceView[]>;
  listVenueActivations(userId: string): Promise<VenueBalanceActivationAction[]>;
  preparePolymarketActivation?(userId: string, input?: z.infer<typeof preparePolymarketActivationSchema>): Promise<unknown>;
  submitPolymarketActivation?(userId: string, request: z.infer<typeof submitPolymarketActivationSchema>): Promise<unknown>;
  preparePolymarketClobSync?(userId: string): Promise<unknown>;
  submitPolymarketClobSync?(userId: string, request: z.infer<typeof submitPolymarketClobSyncSchema>): Promise<unknown>;
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

const FUNDING_DISPLAY_CACHE_MS = 10_000;
const FUNDING_DISPLAY_STALE_MS = 90_000;

type FundingDisplayCacheEntry<T> = {
  expiresAt: number;
  staleUntil: number;
  value?: T | undefined;
  promise?: Promise<T> | undefined;
};

const venueBalanceDisplayCache = new Map<string, FundingDisplayCacheEntry<VenueBalanceView[]>>();
const venueActivationDisplayCache = new Map<string, FundingDisplayCacheEntry<VenueBalanceActivationAction[]>>();

export const registerFundingRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: FundingRouteHandlers,
  options: FundingRouteOptions = {}
): Promise<void> => {
  app.addHook("onClose", async () => {
    venueBalanceDisplayCache.clear();
    venueActivationDisplayCache.clear();
  });

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

  app.post("/funding/intents/:id/submit-signed-solana", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.submitSignedSolanaRouteLeg) {
      return reply.status(503).send({
        code: "SOLANA_BROADCAST_UNAVAILABLE",
        message: "Solana funding broadcast is not available."
      });
    }
    const { id } = request.params as { id: string };
    const parsed = submitSignedSolanaFundingRouteLegSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Signed Solana funding route submission request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const result = await handlers.submitSignedSolanaRouteLeg(request.user.userId, id, parsed.data);
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

  app.get("/funding/intents/:id/receipt", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.refreshIntentStatus(request.user.userId, id);
      return reply.status(200).send({
        generatedAt: new Date().toISOString(),
        receipt: toFundingReceipt(result)
      });
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.get("/funding/venues/capabilities", { preHandler: authMiddleware }, async (_request, reply) => {
    const capabilities = await handlers.listVenueCapabilities();
    return reply.status(200).send({ capabilities });
  });

  app.get("/funding/venue-balances", { preHandler: authMiddleware }, async (request, reply) => {
    const cacheKey = `venue-balances:${request.user.userId}`;
    const result = await getCachedFundingDisplayData(
      venueBalanceDisplayCache,
      cacheKey,
      () => handlers.listVenueBalances(request.user.userId)
    );
    return reply.status(200).send({
      balances: result.value,
      cache: result.cache,
      generatedAt: result.generatedAt
    });
  });

  app.get("/funding/venue-activations", { preHandler: authMiddleware }, async (request, reply) => {
    const cacheKey = `venue-activations:${request.user.userId}`;
    const result = await getCachedFundingDisplayData(
      venueActivationDisplayCache,
      cacheKey,
      () => handlers.listVenueActivations(request.user.userId)
    );
    return reply.status(200).send({
      activations: result.value,
      cache: result.cache,
      generatedAt: result.generatedAt
    });
  });

  app.post("/funding/venue-activations/polymarket/prepare", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.preparePolymarketActivation) {
      return reply.status(503).send({
        code: "ACTIVATION_UNAVAILABLE",
        message: "Polymarket deposit-wallet activation is not available."
      });
    }
    try {
      const parsed = preparePolymarketActivationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          code: "INVALID_REQUEST",
          message: "Polymarket activation preparation validation failed.",
          details: parsed.error.flatten()
        });
      }
      const activation = await handlers.preparePolymarketActivation(request.user.userId, parsed.data);
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

  app.post("/funding/venue-activations/polymarket/clob-sync/prepare", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.preparePolymarketClobSync) {
      return reply.status(503).send({
        code: "POLYMARKET_CLOB_SYNC_UNAVAILABLE",
        message: "Polymarket CLOB readiness sync is not available."
      });
    }
    try {
      const sync = await handlers.preparePolymarketClobSync(request.user.userId);
      return reply.status(200).send({ sync });
    } catch (error) {
      return handleFundingError(error, reply);
    }
  });

  app.post("/funding/venue-activations/polymarket/clob-sync/submit", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.submitPolymarketClobSync) {
      return reply.status(503).send({
        code: "POLYMARKET_CLOB_SYNC_UNAVAILABLE",
        message: "Polymarket CLOB readiness sync is not available."
      });
    }
    const parsed = submitPolymarketClobSyncSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Polymarket CLOB readiness sync submission validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const sync = await handlers.submitPolymarketClobSync(request.user.userId, parsed.data);
      return reply.status(202).send({ sync });
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

  app.get("/funding/withdrawals/:id/receipt", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await handlers.getWithdrawalIntent(request.user.userId, id);
      return reply.status(200).send({
        generatedAt: new Date().toISOString(),
        receipt: toWithdrawalReceipt(result)
      });
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

const toFundingReceipt = (view: FundingIntentView): Record<string, unknown> => ({
  fundingIntentId: view.intent.fundingIntentId,
  currentStatus: view.intent.status,
  sourceChain: view.intent.sourceChain,
  sourceToken: view.intent.sourceToken,
  sourceAmount: view.intent.sourceAmount,
  sourceWalletAddress: view.intent.sourceWalletAddress,
  totalEstimatedFees: view.intent.totalEstimatedFees,
  totalEstimatedTimeSeconds: view.intent.totalEstimatedTimeSeconds,
  createdAt: view.intent.createdAt,
  updatedAt: view.intent.updatedAt,
  targets: view.targets.map((target) => ({
    venue: target.targetVenue,
    token: target.targetToken,
    amount: target.targetAmount,
    chain: target.targetChain,
    status: target.status
  })),
  routeLegs: view.routeLegs.map((leg) => ({
    routeLegId: leg.routeLegId,
    provider: leg.routeProvider,
    sourceChain: leg.sourceChain,
    sourceToken: leg.sourceToken,
    sourceAmount: leg.sourceAmount,
    destinationChain: leg.destinationChain,
    destinationToken: leg.destinationToken,
    destinationAmountEstimate: leg.destinationAmountEstimate,
    txHashes: leg.txHashes,
    status: leg.status,
    errorReason: leg.errorReason,
    createdAt: leg.createdAt,
    updatedAt: leg.updatedAt
  })),
  reconciliations: view.reconciliations.map((record) => ({
    reconciliationId: record.reconciliationId,
    routeLegId: record.routeLegId,
    targetVenue: record.targetVenue,
    destinationTxHash: record.destinationTxHash,
    destinationReceived: record.destinationReceived,
    venueCreditConfirmed: record.venueCreditConfirmed,
    readyToTrade: record.readyToTrade,
    checkedAt: record.checkedAt,
    notes: record.notes
  })),
  userSafeMessage: view.userSafeMessage
});

const toWithdrawalReceipt = (view: WithdrawalIntentView): Record<string, unknown> => ({
  withdrawalIntentId: view.intent.withdrawalIntentId,
  currentStatus: view.intent.status,
  token: view.intent.token,
  amount: view.intent.amount,
  destinationChain: view.intent.destinationChain,
  destinationWalletAddress: view.intent.destinationWalletAddress,
  totalEstimatedFees: view.intent.totalEstimatedFees,
  totalEstimatedTimeSeconds: view.intent.totalEstimatedTimeSeconds,
  createdAt: view.intent.createdAt,
  updatedAt: view.intent.updatedAt,
  sources: view.sources.map((source) => ({
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    sourcePercentage: source.sourcePercentage,
    status: source.status,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
  })),
  routeLegs: view.routeLegs.map((leg) => ({
    withdrawalRouteLegId: leg.withdrawalRouteLegId,
    withdrawalSourceId: leg.withdrawalSourceId,
    sourceVenue: leg.sourceVenue,
    sourceToken: leg.sourceToken,
    sourceAmount: leg.sourceAmount,
    destinationChain: leg.destinationChain,
    destinationWalletAddress: leg.destinationWalletAddress,
    destinationAmountEstimate: leg.destinationAmountEstimate,
    txHashes: leg.txHashes,
    venueReleaseStatus: leg.venueReleaseStatus,
    destinationStatus: leg.destinationStatus,
    status: leg.status,
    errorReason: leg.errorReason,
    createdAt: leg.createdAt,
    updatedAt: leg.updatedAt
  })),
  reconciliations: view.reconciliations.map((record) => ({
    withdrawalReconciliationId: record.withdrawalReconciliationId,
    withdrawalRouteLegId: record.withdrawalRouteLegId,
    sourceVenue: record.sourceVenue,
    withdrawalTxHash: record.withdrawalTxHash,
    venueReleased: record.venueReleased,
    destinationReceived: record.destinationReceived,
    completed: record.completed,
    checkedAt: record.checkedAt,
    notes: record.notes
  })),
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

const getCachedFundingDisplayData = async <T>(
  cache: Map<string, FundingDisplayCacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
  now = Date.now()
): Promise<{ value: T; cache: "hit" | "miss" | "stale"; generatedAt: string }> => {
  const cached = cache.get(key);
  if (cached?.value !== undefined && cached.expiresAt > now) {
    return { value: cached.value, cache: "hit", generatedAt: new Date(now).toISOString() };
  }
  if (cached?.promise) {
    const value = await cached.promise;
    return { value, cache: "hit", generatedAt: new Date().toISOString() };
  }

  const promise = load()
    .then((value) => {
      const updatedAt = Date.now();
      cache.set(key, {
        value,
        expiresAt: updatedAt + FUNDING_DISPLAY_CACHE_MS,
        staleUntil: updatedAt + FUNDING_DISPLAY_STALE_MS
      });
      return value;
    })
    .catch((error) => {
      const fallback = cache.get(key);
      if (fallback?.value !== undefined && fallback.staleUntil > Date.now()) {
        cache.set(key, {
          ...fallback,
          promise: undefined
        });
        return fallback.value;
      }
      cache.delete(key);
      throw error;
    })
    .finally(() => {
      const current = cache.get(key);
      if (current?.promise === promise) {
        cache.set(key, {
          ...current,
          promise: undefined
        });
      }
    });

  cache.set(key, {
    ...(cached?.value !== undefined ? { value: cached.value } : {}),
    expiresAt: cached?.expiresAt ?? 0,
    staleUntil: cached?.staleUntil ?? 0,
    promise
  });

  try {
    const value = await promise;
    const current = cache.get(key);
    const servedStale = cached?.value !== undefined && current?.value === cached.value && current.expiresAt <= now && current.staleUntil > now;
    return {
      value,
      cache: servedStale ? "stale" : "miss",
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    const fallback = cached?.value !== undefined && cached.staleUntil > Date.now()
      ? cached.value
      : undefined;
    if (fallback !== undefined) {
      return { value: fallback, cache: "stale", generatedAt: new Date().toISOString() };
    }
    throw error;
  }
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
