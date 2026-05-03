import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";
import { registerUserVenueAccountRoutes } from "../src/api/routes/user-venue-accounts.js";
import {
  UserVenueAccountService,
  type UserVenueAccount,
  type UserVenueAccountRepository,
  type UserVenueAccountVenue
} from "../src/core/execution/user-venue-accounts.js";
import type { UserWallet } from "../src/core/funding/user-wallets.js";

class InMemoryVenueAccountRepository implements UserVenueAccountRepository {
  public accounts = new Map<string, UserVenueAccount>();
  public auditEvents: Array<{ userId: string; venueAccountBindingId?: string | null; eventType: string; payload: Record<string, unknown> }> = [];
  private counter = 0;

  public async listAccounts(userId: string): Promise<UserVenueAccount[]> {
    return [...this.accounts.values()].filter((account) => account.userId === userId);
  }

  public async findAccount(input: { userId: string; venue: UserVenueAccountVenue }): Promise<UserVenueAccount | null> {
    return [...this.accounts.values()].find((account) =>
      account.userId === input.userId &&
      account.venue === input.venue &&
      (account.status === "PENDING" || account.status === "ACTIVE")
    ) ?? null;
  }

  public async upsertAccount(input: Omit<UserVenueAccount, "venueAccountBindingId" | "createdAt" | "updatedAt" | "lastVerifiedAt"> & {
    venueAccountBindingId?: string;
    lastVerifiedAt?: string | null;
  }): Promise<UserVenueAccount> {
    const existing = input.venueAccountBindingId
      ? this.accounts.get(input.venueAccountBindingId)
      : await this.findAccount({ userId: input.userId, venue: input.venue });
    const now = "2026-05-03T00:00:00.000Z";
    const account: UserVenueAccount = {
      ...input,
      venueAccountBindingId: existing?.venueAccountBindingId ?? `venue-account-${++this.counter}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt: input.lastVerifiedAt ?? existing?.lastVerifiedAt ?? null
    };
    this.accounts.set(account.venueAccountBindingId, account);
    return account;
  }

  public async disableAccount(): Promise<UserVenueAccount | null> {
    return null;
  }

  public async countActiveAccountsByVenue(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const account of this.accounts.values()) {
      if (account.status === "ACTIVE") {
        counts[account.venue] = (counts[account.venue] ?? 0) + 1;
      }
    }
    return counts;
  }

  public async appendAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    this.auditEvents.push(input);
    return `audit-${this.auditEvents.length}`;
  }
}

const evmWallet = (overrides: Partial<UserWallet> = {}): UserWallet => ({
  walletId: "wallet-evm",
  userId: "user-1",
  provider: "TURNKEY",
  providerSubOrgId: "94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb",
  providerWalletId: "turnkey-wallet",
  providerWalletAccountId: "turnkey-account",
  chainFamily: "EVM",
  chain: "EVM",
  address: "0x1111111111111111111111111111111111111111",
  purpose: "DEFAULT_FUNDING",
  venue: null,
  exportable: true,
  status: "ACTIVE",
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  ...overrides
});

describe("user venue account service", () => {
  it("requires an active Turnkey EVM wallet before linking venue accounts", async () => {
    const service = new UserVenueAccountService(new InMemoryVenueAccountRepository(), {
      async resolveUserTurnkeyEvmFundingWallet() {
        return null;
      }
    });

    await expect(service.ensureAccount({ userId: "user-1", venue: "OPINION" })).rejects.toMatchObject({
      code: "USER_VENUE_ACCOUNT_WALLET_REQUIRED"
    });
  });

  it("ensures Opinion account bindings idempotently and validates signer ownership", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(repository, {
      async resolveUserTurnkeyEvmFundingWallet() {
        return evmWallet();
      }
    });

    const first = await service.ensureAccount({
      userId: "user-1",
      venue: "OPINION",
      venueAccountAddress: "0x2222222222222222222222222222222222222222",
      venueAccountType: "SAFE"
    });
    const second = await service.ensureAccount({ userId: "user-1", venue: "OPINION" });

    expect(first.account).toMatchObject({
      venue: "OPINION",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "SAFE",
      status: "ACTIVE"
    });
    expect(second.account.venueAccountBindingId).toBe(first.account.venueAccountBindingId);
    await expect(service.verifyUserSignedRelayBinding({
      userId: "user-1",
      venue: "OPINION",
      signerAddress: "0x1111111111111111111111111111111111111111",
      venueAccountAddress: "0x2222222222222222222222222222222222222222"
    })).resolves.toMatchObject({ venue: "OPINION" });
    await expect(service.verifyUserSignedRelayBinding({
      userId: "user-1",
      venue: "OPINION",
      signerAddress: "0x3333333333333333333333333333333333333333"
    })).rejects.toMatchObject({ code: "USER_VENUE_ACCOUNT_MISMATCH" });
    expect(JSON.stringify(repository.auditEvents)).not.toContain("turnkey-account");
  });
});

describe("user venue account routes", () => {
  it("requires auth and returns frontend-safe account metadata", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyJwt, { secret: "test-secret" });
    const service = new UserVenueAccountService(new InMemoryVenueAccountRepository(), {
      async resolveUserTurnkeyEvmFundingWallet() {
        return evmWallet();
      }
    });
    const auth = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ code: "UNAUTHORIZED" });
      }
    };
    await registerUserVenueAccountRoutes(app, auth, {
      listAccounts: (userId) => service.listAccounts(userId),
      getAccount: (userId, venue) => service.getAccount(userId, venue),
      ensureAccount: (input) => service.ensureAccount(input)
    });
    const token = app.jwt.sign({ userId: "user-1", role: "USER", email: "polymarket-funding-test@uselotus.xyz" });

    await expect(app.inject({ method: "GET", url: "/user/venue-accounts" }))
      .resolves.toMatchObject({ statusCode: 401 });
    const ensured = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/opinion/ensure",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        venueAccountAddress: "0x2222222222222222222222222222222222222222",
        venueAccountType: "SAFE"
      }
    });

    expect(ensured.statusCode).toBe(200);
    expect(ensured.json().venueAccount).toMatchObject({
      venue: "OPINION",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountAddress: "0x2222222222222222222222222222222222222222",
      venueAccountType: "SAFE",
      status: "ACTIVE"
    });
    expect(ensured.body).not.toContain("providerSubOrgId");
    expect(ensured.body).not.toContain("providerWalletAccountId");
    expect(ensured.body).not.toContain("turnkey-account");
    expect(ensured.body).not.toContain("privateKey");

    const listed = await app.inject({
      method: "GET",
      url: "/user/venue-accounts",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listed.json().venueAccounts).toHaveLength(1);
    await app.close();
  });
});
