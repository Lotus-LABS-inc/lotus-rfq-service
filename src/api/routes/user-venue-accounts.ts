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
  venueAccountType: z.enum(["SAFE", "SMART_WALLET", "OAUTH_ACCOUNT", "EOA", "PROXY_ACCOUNT"]).optional()
}).default({});

const predictCompleteAuthBodySchema = z.object({
  signer: z.string().min(1),
  signature: z.string().min(1),
  message: z.string().min(1)
});

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
    const parsed = predictCompleteAuthBodySchema.safeParse(request.body ?? {});
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

const handleVenueAccountError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof UserVenueAccountError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message
    });
  }
  throw error;
};
