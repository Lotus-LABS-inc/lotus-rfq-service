import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

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
    return reply.status(200).send({ wallets });
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
    return reply.status(200).send({ wallet });
  });
};
