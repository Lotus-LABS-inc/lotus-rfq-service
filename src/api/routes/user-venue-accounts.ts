import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  normalizeVenue,
  toSafeVenueAccount,
  UserVenueAccountError,
  type EnsureUserVenueAccountInput,
  type UserVenueAccount
} from "../../core/execution/user-venue-accounts.js";

const paramsSchema = z.object({
  venue: z.string().min(1)
});

const ensureBodySchema = z.object({
  venueAccountId: z.string().min(1).optional(),
  venueAccountAddress: z.string().min(1).optional(),
  venueAccountType: z.enum(["SAFE", "SMART_WALLET", "OAUTH_ACCOUNT", "EOA", "PROXY_ACCOUNT", "DEPOSIT_WALLET", "SERVER_WALLET"]).optional()
}).default({});

const signedVenueMessageBodySchema = z.object({
  signer: z.string().min(1),
  signature: z.string().min(1),
  message: z.string().min(1)
});

const completeBatchBodySchema = z.object({
  predictFun: signedVenueMessageBodySchema.optional(),
  limitless: signedVenueMessageBodySchema.optional()
}).default({});

export interface UserVenueAccountRouteHandlers {
  listAccounts(userId: string): Promise<UserVenueAccount[]>;
  getAccount(userId: string, venue: string): Promise<UserVenueAccount | null>;
  ensureAccount(input: EnsureUserVenueAccountInput): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }>;
  preparePredictFunAccountAuth?(userId: string): Promise<{
    signer: string;
    message: string;
    venueAccount: UserVenueAccount;
  }>;
  prepareAccountSetupBatch?(userId: string): Promise<{
    venueAccounts: Array<{
      venue: string;
      account: UserVenueAccount;
      readinessBlockers: string[];
      setupInstructions: string[];
      setupMode: string;
    }>;
    signatureRequests: Array<{
      venue: string;
      requestType: string;
      signer: string;
      message: string;
      venueAccount: UserVenueAccount;
    }>;
  }>;
  completePredictFunAccountAuth?(input: {
    userId: string;
    signer: string;
    signature: string;
    message: string;
  }): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }>;
  completeAccountSetupBatch?(input: {
    userId: string;
    predictFun?: {
      signer: string;
      signature: string;
      message: string;
    } | null;
    limitless?: {
      signer: string;
      signature: string;
      message: string;
    } | null;
  }): Promise<{
    venueAccounts: Array<{
      venue: string;
      account: UserVenueAccount;
      readinessBlockers: string[];
      setupInstructions: string[];
      setupMode: string;
    }>;
    signatureRequests: Array<{
      venue: string;
      requestType: string;
      signer: string;
      message: string;
      venueAccount: UserVenueAccount;
    }>;
  }>;
}

export const registerUserVenueAccountRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: UserVenueAccountRouteHandlers
): Promise<void> => {
  app.get("/user/venue-accounts", { preHandler: authMiddleware }, async (request, reply) => {
    const accounts = await handlers.listAccounts(request.user.userId);
    return reply.status(200).send({ venueAccounts: accounts.map((account) => toSafeVenueAccount(account)) });
  });

  app.get("/user/venue-accounts/:venue", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const account = await handlers.getAccount(request.user.userId, parsed.data.venue);
      if (!account) {
        return reply.status(404).send({ code: "USER_VENUE_ACCOUNT_NOT_FOUND" });
      }
      return reply.status(200).send({ venueAccount: toSafeVenueAccount(account) });
    } catch (error) {
      return handleVenueAccountError(error, reply);
    }
  });

  app.post("/user/venue-accounts/:venue/ensure", { preHandler: authMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = ensureBodySchema.safeParse(request.body ?? {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }
    try {
      const ensured = await handlers.ensureAccount({
        userId: request.user.userId,
        venue: normalizeVenue(parsedParams.data.venue),
        venueAccountId: parsedBody.data.venueAccountId ?? null,
        venueAccountAddress: parsedBody.data.venueAccountAddress ?? null,
        venueAccountType: parsedBody.data.venueAccountType ?? null
      });
      return reply.status(200).send({
        venueAccount: toSafeVenueAccount(
          ensured.account,
          ensured.readinessBlockers,
          ensured.setupInstructions
        )
      });
    } catch (error) {
      return handleVenueAccountError(error, reply);
    }
  });

  app.post("/user/venue-accounts/setup-batch", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.prepareAccountSetupBatch) {
      return reply.status(503).send({ code: "USER_VENUE_ACCOUNT_BATCH_NOT_CONFIGURED" });
    }
    try {
      const batch = await handlers.prepareAccountSetupBatch(request.user.userId);
      return reply.status(200).send(toSafeBatch(batch));
    } catch (error) {
      return handleVenueAccountError(error, reply);
    }
  });

  app.post("/user/venue-accounts/complete-batch", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.completeAccountSetupBatch) {
      return reply.status(503).send({ code: "USER_VENUE_ACCOUNT_BATCH_NOT_CONFIGURED" });
    }
    const parsed = completeBatchBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const batch = await handlers.completeAccountSetupBatch({
        userId: request.user.userId,
        predictFun: parsed.data.predictFun ?? null,
        limitless: parsed.data.limitless ?? null
      });
      return reply.status(200).send(toSafeBatch(batch));
    } catch (error) {
      return handleVenueAccountError(error, reply);
    }
  });

  app.post("/user/venue-accounts/predict_fun/auth-message", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.preparePredictFunAccountAuth) {
      return reply.status(503).send({ code: "PREDICT_FUN_ACCOUNT_NOT_CONFIGURED" });
    }
    try {
      const prepared = await handlers.preparePredictFunAccountAuth(request.user.userId);
      return reply.status(200).send({
        venue: "PREDICT_FUN",
        signer: prepared.signer,
        message: prepared.message,
        venueAccount: toSafeVenueAccount(prepared.venueAccount)
      });
    } catch (error) {
      return handleVenueAccountError(error, reply);
    }
  });

  app.post("/user/venue-accounts/predict_fun/complete-auth", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.completePredictFunAccountAuth) {
      return reply.status(503).send({ code: "PREDICT_FUN_ACCOUNT_NOT_CONFIGURED" });
    }
    const parsed = signedVenueMessageBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const ensured = await handlers.completePredictFunAccountAuth({
        userId: request.user.userId,
        signer: parsed.data.signer,
        signature: parsed.data.signature,
        message: parsed.data.message
      });
      return reply.status(200).send({
        venueAccount: toSafeVenueAccount(
          ensured.account,
          ensured.readinessBlockers,
          ensured.setupInstructions
        )
      });
    } catch (error) {
      return handleVenueAccountError(error, reply);
    }
  });
};

const toSafeBatch = (batch: {
  venueAccounts: Array<{
    venue: string;
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
    setupMode: string;
  }>;
  signatureRequests: Array<{
    venue: string;
    requestType: string;
    signer: string;
    message: string;
    venueAccount: UserVenueAccount;
  }>;
}): Record<string, unknown> => ({
  venueAccounts: batch.venueAccounts.map((item) => ({
    venue: item.venue,
    setupMode: item.setupMode,
    venueAccount: toSafeVenueAccount(item.account, item.readinessBlockers, item.setupInstructions)
  })),
  signatureRequests: batch.signatureRequests.map((request) => ({
    venue: request.venue,
    requestType: request.requestType,
    signer: request.signer,
    message: request.message,
    venueAccount: toSafeVenueAccount(request.venueAccount)
  }))
});

const handleVenueAccountError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof UserVenueAccountError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message
    });
  }
  throw error;
};
