import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { UserWalletError, type UserWallet } from "../../core/funding/user-wallets.js";

export interface UserWalletRouteHandlers {
  listWallets(userId: string): Promise<UserWallet[]>;
  ensureDefaultWallets(userId: string, email?: string | null, turnkeyOrganizationId?: string | null): Promise<UserWallet[]>;
}

export const registerUserWalletRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: UserWalletRouteHandlers
): Promise<void> => {
  app.get("/user/wallets", { preHandler: authMiddleware }, async (request, reply) => {
    const wallets = await handlers.listWallets(request.user.userId);
    return reply.status(200).send({ wallets: wallets.map(toSafeWallet) });
  });

  app.post("/user/wallets/ensure-defaults", { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const wallets = await handlers.ensureDefaultWallets(
        request.user.userId,
        request.user.email ?? null,
        request.user.turnkeyOrganizationId ?? null
      );
      return reply.status(200).send({ wallets: wallets.map(toSafeWallet) });
    } catch (error) {
      return handleWalletError(error, reply);
    }
  });
};

export const toSafeWallet = (wallet: UserWallet): Record<string, unknown> => ({
  walletId: wallet.walletId,
  provider: wallet.provider,
  chainFamily: wallet.chainFamily,
  chain: wallet.chain,
  address: wallet.address,
  purpose: wallet.purpose,
  venue: wallet.venue,
  exportable: wallet.exportable,
  status: wallet.status,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt
});

const handleWalletError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof UserWalletError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message
    });
  }
  throw error;
};
