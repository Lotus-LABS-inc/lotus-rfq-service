import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";
import { registerUserWithdrawalWalletRoutes } from "../src/api/routes/user-withdrawal-wallets.js";

const buildApp = async () => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  const walletsByUser = new Map<string, unknown[]>();
  const auth = async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ code: "UNAUTHORIZED" });
    }
  };
  await registerUserWithdrawalWalletRoutes(app, auth, {
    listWallets: async (userId) => walletsByUser.get(userId) ?? [],
    upsertEvmWallet: async (userId, request) => {
      const wallet = {
        userId,
        chainFamily: "EVM",
        address: request.address,
        label: request.label ?? null,
        verifiedAt: null,
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z"
      };
      walletsByUser.set(userId, [wallet]);
      return wallet;
    }
  });
  return app;
};

describe("User withdrawal wallet routes", () => {
  it("requires user auth and stores only frontend-safe EVM wallet metadata", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ userId: "user-1", role: "USER" });
    const otherToken = app.jwt.sign({ userId: "user-2", role: "USER" });

    await expect(app.inject({ method: "GET", url: "/user/withdrawal-wallets" }))
      .resolves.toMatchObject({ statusCode: 401 });

    const upsert = await app.inject({
      method: "PUT",
      url: "/user/withdrawal-wallets/evm",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        address: "0x1111111111111111111111111111111111111111",
        label: "BSC USDT receiver"
      }
    });
    expect(upsert.statusCode).toBe(200);
    expect(upsert.json()).toMatchObject({
      wallet: {
        userId: "user-1",
        chainFamily: "EVM",
        address: "0x1111111111111111111111111111111111111111",
        label: "BSC USDT receiver",
        verifiedAt: null
      }
    });

    const ownWallets = await app.inject({
      method: "GET",
      url: "/user/withdrawal-wallets",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(ownWallets.json()).toMatchObject({
      wallets: [{ userId: "user-1", chainFamily: "EVM" }]
    });

    const otherWallets = await app.inject({
      method: "GET",
      url: "/user/withdrawal-wallets",
      headers: { authorization: `Bearer ${otherToken}` }
    });
    expect(otherWallets.json()).toEqual({ wallets: [] });
    expect(ownWallets.body).not.toContain("privateKey");
    expect(ownWallets.body).not.toContain("seedPhrase");
    expect(ownWallets.body).not.toContain("zeroDevSigner");
    expect(ownWallets.body).not.toContain("privySecret");
    await app.close();
  });

  it("rejects non-EVM withdrawal wallet addresses", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ userId: "user-1", role: "USER" });
    const response = await app.inject({
      method: "PUT",
      url: "/user/withdrawal-wallets/evm",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: "not-an-evm-address" }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
