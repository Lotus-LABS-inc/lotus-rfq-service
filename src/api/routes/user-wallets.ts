import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  UserWalletError,
  type TurnkeyWalletAccountRegistration,
  type UserWallet
} from "../../core/funding/user-wallets.js";
import type { UserWalletBalanceResult } from "../../core/funding/user-wallet-balances.js";

export interface UserWalletRouteHandlers {
  listWallets(userId: string): Promise<UserWallet[]>;
  readWalletBalances?(wallet: UserWallet): Promise<UserWalletBalanceResult>;
  ensureDefaultWallets(userId: string, email?: string | null, turnkeyOrganizationId?: string | null): Promise<UserWallet[]>;
  registerTurnkeyDefaultWallets(
    userId: string,
    turnkeyOrganizationId: string | null | undefined,
    accounts: TurnkeyWalletAccountRegistration[]
  ): Promise<UserWallet[]>;
}

const turnkeyAccountRegistrationSchema = z.object({
  accounts: z.array(z.object({
    providerWalletId: z.string().min(1),
    providerWalletAccountId: z.string().min(1),
    address: z.string().min(1),
    addressFormat: z.enum(["ADDRESS_FORMAT_SOLANA", "ADDRESS_FORMAT_ETHEREUM"])
  })).min(1).max(10)
});

export const registerUserWalletRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: UserWalletRouteHandlers
): Promise<void> => {
  app.get("/user/wallets", { preHandler: authMiddleware }, async (request, reply) => {
    const wallets = await handlers.listWallets(request.user.userId);
    const safeWallets = await toSafeWallets(wallets, handlers);
    return reply.status(200).send({ wallets: safeWallets });
  });

  app.post("/user/wallets/ensure-defaults", { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const wallets = await handlers.ensureDefaultWallets(
        request.user.userId,
        request.user.email ?? null,
        request.user.turnkeyOrganizationId ?? null
      );
      return reply.status(200).send({ wallets: await toSafeWallets(wallets, handlers) });
    } catch (error) {
      return handleWalletError(error, reply);
    }
  });

  app.post("/user/wallets/turnkey/defaults", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = turnkeyAccountRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const wallets = await handlers.registerTurnkeyDefaultWallets(
        request.user.userId,
        request.user.turnkeyOrganizationId ?? null,
        parsed.data.accounts
      );
      return reply.status(200).send({ wallets: await toSafeWallets(wallets, handlers) });
    } catch (error) {
      return handleWalletError(error, reply);
    }
  });
};

const toSafeWallets = async (
  wallets: UserWallet[],
  handlers: UserWalletRouteHandlers
): Promise<Array<Record<string, unknown>>> =>
  Promise.all(wallets.map(async (wallet) => {
    const balance = handlers.readWalletBalances
      ? await handlers.readWalletBalances(wallet)
      : null;
    return toSafeWallet(wallet, balance);
  }));

export const toSafeWallet = (wallet: UserWallet, balance?: UserWalletBalanceResult | null): Record<string, unknown> => ({
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
  updatedAt: wallet.updatedAt,
  balances: balance?.balances ?? [],
  balanceStatus: balance?.balanceStatus ?? "unavailable",
  balanceBlocker: balance?.balanceBlocker ?? "Funding wallet balance sync is not configured."
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
