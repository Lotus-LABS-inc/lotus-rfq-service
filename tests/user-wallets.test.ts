import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";
import { registerUserWalletRoutes } from "../src/api/routes/user-wallets.js";
import {
  UserWalletService,
  type ProvisionedUserWallet,
  type TurnkeyWalletProvisioner,
  type UserWallet,
  type UserWalletChainFamily,
  type UserWalletPurpose,
  type UserWalletRepository
} from "../src/core/funding/user-wallets.js";
import { getTurnkeyWalletConfigFromEnv, isTurnkeyWalletConfigReady } from "../src/integrations/turnkey/turnkey-wallet-client.js";

class InMemoryUserWalletRepository implements UserWalletRepository {
  public wallets = new Map<string, UserWallet>();
  public auditEvents: Array<{ userId: string; walletId?: string | null; eventType: string; payload: Record<string, unknown> }> = [];
  private counter = 0;

  public async listWallets(userId: string): Promise<UserWallet[]> {
    return [...this.wallets.values()].filter((wallet) => wallet.userId === userId);
  }

  public async findWalletById(walletId: string): Promise<UserWallet | null> {
    return this.wallets.get(walletId) ?? null;
  }

  public async findActiveWallet(input: {
    userId: string;
    chainFamily: UserWalletChainFamily;
    purpose: UserWalletPurpose;
    venue?: string | null;
  }): Promise<UserWallet | null> {
    return [...this.wallets.values()].find((wallet) =>
      wallet.userId === input.userId
      && wallet.chainFamily === input.chainFamily
      && wallet.purpose === input.purpose
      && (input.venue === undefined || wallet.venue === input.venue)
      && wallet.status === "ACTIVE"
    ) ?? null;
  }

  public async upsertWallet(input: Omit<UserWallet, "walletId" | "createdAt" | "updatedAt"> & { walletId?: string }): Promise<UserWallet> {
    const existing = [...this.wallets.values()].find((wallet) =>
      wallet.userId === input.userId
      && wallet.chainFamily === input.chainFamily
      && wallet.purpose === input.purpose
      && wallet.venue === input.venue
      && wallet.status === "ACTIVE"
    );
    const now = "2026-05-01T00:00:00.000Z";
    const wallet: UserWallet = {
      ...input,
      walletId: existing?.walletId ?? input.walletId ?? `wallet-${++this.counter}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.wallets.set(wallet.walletId, wallet);
    return wallet;
  }

  public async appendWalletAuditEvent(input: {
    userId: string;
    walletId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    this.auditEvents.push(input);
    return `audit-${this.auditEvents.length}`;
  }
}

class MockTurnkeyProvisioner implements TurnkeyWalletProvisioner {
  public calls = 0;

  public async provisionDefaultWallets(input: {
    includeSolana: boolean;
    includeEvm: boolean;
  }): Promise<ProvisionedUserWallet[]> {
    this.calls += 1;
    return [
      ...(input.includeSolana ? [{
        provider: "TURNKEY" as const,
        providerSubOrgId: "suborg-1",
        providerWalletId: "turnkey-wallet-1",
        providerWalletAccountId: "sol-account-1",
        chainFamily: "SOLANA" as const,
        chain: "SOLANA",
        address: "So11111111111111111111111111111111111111111",
        purpose: "DEFAULT_FUNDING" as const,
        exportable: true
      }] : []),
      ...(input.includeEvm ? [{
        provider: "TURNKEY" as const,
        providerSubOrgId: "suborg-1",
        providerWalletId: "turnkey-wallet-1",
        providerWalletAccountId: "evm-account-1",
        chainFamily: "EVM" as const,
        chain: "EVM",
        address: "0x1111111111111111111111111111111111111111",
        purpose: "DEFAULT_FUNDING" as const,
        exportable: true
      }] : [])
    ];
  }
}

class FailingTurnkeyProvisioner implements TurnkeyWalletProvisioner {
  public async provisionDefaultWallets(): Promise<ProvisionedUserWallet[]> {
    throw new Error("Turnkey error 3: user missing valid credential: internal-id");
  }
}

describe("user wallet service", () => {
  it("parses Turnkey config with disabled defaults and validates complete credentials", () => {
    const disabled = getTurnkeyWalletConfigFromEnv({});
    expect(disabled.enabled).toBe(false);
    expect(isTurnkeyWalletConfigReady(disabled)).toBe(false);
    const enabled = getTurnkeyWalletConfigFromEnv({
      TURNKEY_ENABLED: "true",
      TURNKEY_ORGANIZATION_ID: "org",
      TURNKEY_API_PUBLIC_KEY: "public",
      TURNKEY_API_PRIVATE_KEY: "private"
    });
    expect(isTurnkeyWalletConfigReady(enabled)).toBe(true);
  });

  it("ensures Solana and EVM Turnkey defaults idempotently without storing secrets", async () => {
    const repository = new InMemoryUserWalletRepository();
    const provisioner = new MockTurnkeyProvisioner();
    const service = new UserWalletService(repository, {
      turnkeyEnabled: true,
      defaultSolanaWalletEnabled: true,
      defaultEvmWalletEnabled: true
    }, provisioner);

    const first = await service.ensureDefaultWallets("user-1", "user@example.com");
    const second = await service.ensureDefaultWallets("user-1", "user@example.com");

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(provisioner.calls).toBe(1);
    expect(JSON.stringify(second)).not.toContain("private");
    expect(JSON.stringify(second)).not.toContain("seed");
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("USER_WALLET_PROVISIONED");
  });

  it("resolves default Solana and rejects another user's wallet", async () => {
    const repository = new InMemoryUserWalletRepository();
    const service = new UserWalletService(repository, {
      turnkeyEnabled: true,
      defaultSolanaWalletEnabled: true,
      defaultEvmWalletEnabled: true
    }, new MockTurnkeyProvisioner());
    const [solana] = await service.ensureDefaultWallets("user-1");
    await expect(service.resolveFundingSourceWallet({
      userId: "user-2",
      sourceChain: "SOLANA",
      sourceWalletId: solana?.walletId
    })).rejects.toMatchObject({ code: "USER_WALLET_FORBIDDEN" });
    await expect(service.resolveFundingSourceWallet({
      userId: "user-1",
      sourceChain: "SOLANA"
    })).resolves.toMatchObject({ address: solana?.address });
  });

  it("resolves user-specific venue target wallets without exposing provider internals", async () => {
    const repository = new InMemoryUserWalletRepository();
    const service = new UserWalletService(repository, {
      turnkeyEnabled: true,
      defaultSolanaWalletEnabled: true,
      defaultEvmWalletEnabled: true
    }, new MockTurnkeyProvisioner());
    const wallet = await repository.upsertWallet({
      userId: "user-1",
      provider: "EXTERNAL",
      providerSubOrgId: null,
      providerWalletId: null,
      providerWalletAccountId: null,
      chainFamily: "EVM",
      chain: "POLYGON",
      address: "0xEc556c0AcfcF18A424c250B2a19f58b9b8641400",
      purpose: "VENUE_TARGET",
      venue: "OPINION",
      exportable: true,
      status: "ACTIVE"
    });

    await expect(service.resolveVenueTargetWallet("user-1", "OPINION"))
      .resolves.toMatchObject({ walletId: wallet.walletId, address: wallet.address, purpose: "VENUE_TARGET", venue: "OPINION" });
    await expect(service.resolveVenueTargetWallet("user-1", "MYRIAD"))
      .resolves.toBeNull();
    expect(JSON.stringify(wallet)).not.toContain("privateKey");
    expect(JSON.stringify(wallet)).not.toContain("seed");
  });

  it("converts provider provisioning failures into safe unavailable errors", async () => {
    const repository = new InMemoryUserWalletRepository();
    const service = new UserWalletService(repository, {
      turnkeyEnabled: true,
      defaultSolanaWalletEnabled: true,
      defaultEvmWalletEnabled: true
    }, new FailingTurnkeyProvisioner());

    await expect(service.ensureDefaultWallets("user-1", "user@example.com")).rejects.toMatchObject({
      code: "USER_WALLET_UNAVAILABLE",
      message: "Turnkey wallet provisioning is temporarily unavailable.",
      statusCode: 503
    });
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("USER_WALLET_PROVISIONING_FAILED");
    expect(JSON.stringify(repository.auditEvents)).not.toContain("internal-id");
  });
});

describe("user wallet routes", () => {
  it("requires auth and returns frontend-safe wallet metadata", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: "test-secret" });
    const repository = new InMemoryUserWalletRepository();
    const service = new UserWalletService(repository, {
      turnkeyEnabled: true,
      defaultSolanaWalletEnabled: true,
      defaultEvmWalletEnabled: true
    }, new MockTurnkeyProvisioner());
    const auth = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ code: "UNAUTHORIZED" });
      }
    };
    await registerUserWalletRoutes(app, auth, {
      listWallets: (userId) => service.listWallets(userId),
      ensureDefaultWallets: (userId, email) => service.ensureDefaultWallets(userId, email)
    });
    const token = app.jwt.sign({ userId: "user-1", role: "USER", email: "user@example.com" });

    await expect(app.inject({ method: "GET", url: "/user/wallets" }))
      .resolves.toMatchObject({ statusCode: 401 });
    const ensured = await app.inject({
      method: "POST",
      url: "/user/wallets/ensure-defaults",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(ensured.statusCode).toBe(200);
    expect(ensured.json().wallets).toHaveLength(2);
    expect(ensured.body).not.toContain("providerSubOrgId");
    expect(ensured.body).not.toContain("providerWalletAccountId");
    expect(ensured.body).not.toContain("privateKey");
    const listed = await app.inject({
      method: "GET",
      url: "/user/wallets",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listed.json().wallets[0]).toMatchObject({ provider: "TURNKEY", exportable: true });
    await app.close();
  });
});
