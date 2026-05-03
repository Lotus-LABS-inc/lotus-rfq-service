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

export interface UserVenueAccountRouteHandlers {
  listAccounts(userId: string): Promise<UserVenueAccount[]>;
  getAccount(userId: string, venue: string): Promise<UserVenueAccount | null>;
  ensureAccount(input: EnsureUserVenueAccountInput): Promise<{
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
