import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { UserWallet } from "../../core/funding/user-wallets.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const upsertEvmWalletSchema = z.object({
  address: evmAddressSchema,
  label: z.string().trim().min(1).max(80).optional()
});

export interface UserWithdrawalWalletRouteHandlers {
  listWallets(userId: string): Promise<unknown[]>;
  upsertEvmWallet(userId: string, request: z.infer<typeof upsertEvmWalletSchema>): Promise<unknown>;
}

export const registerUserWithdrawalWalletRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: UserWithdrawalWalletRouteHandlers
): Promise<void> => {
  app.get("/user/withdrawal-wallets", { preHandler: authMiddleware }, async (request, reply) => {
    const wallets = await handlers.listWallets(request.user.userId);
    return reply.status(200).send({ wallets: wallets.map(toWithdrawalWalletResponse) });
  });

  app.put("/user/withdrawal-wallets/evm", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = upsertEvmWalletSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "EVM withdrawal wallet request validation failed.",
        details: parsed.error.flatten()
      });
    }
    const wallet = await handlers.upsertEvmWallet(request.user.userId, parsed.data);
    return reply.status(200).send({ wallet: toWithdrawalWalletResponse(wallet) });
  });
};

const toWithdrawalWalletResponse = (wallet: unknown): unknown => {
  if (!isUserWallet(wallet)) {
    return wallet;
  }
  return {
    userId: wallet.userId,
    chainFamily: wallet.chainFamily,
    address: wallet.address,
    label: null,
    verifiedAt: null,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt
  };
};

const isUserWallet = (value: unknown): value is UserWallet =>
  typeof value === "object"
  && value !== null
  && "walletId" in value
  && "provider" in value
  && "chainFamily" in value
  && "address" in value;
