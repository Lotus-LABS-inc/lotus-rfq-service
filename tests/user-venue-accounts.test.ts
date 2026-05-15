import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";
import { registerUserVenueAccountRoutes } from "../src/api/routes/user-venue-accounts.js";
import {
  UserVenueAccountService,
  type UserVenueAccount,
  type LimitlessPartnerAccountClient,
  type PolymarketDepositWalletClient,
  type PredictFunAccountClient,
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

  public async findLatestAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId: string;
    eventType: string;
  }): Promise<{ eventType: string; payload: Record<string, unknown>; createdAt: string } | null> {
    const event = [...this.auditEvents].reverse().find((candidate) =>
      candidate.userId === input.userId &&
      candidate.venueAccountBindingId === input.venueAccountBindingId &&
      candidate.eventType === input.eventType
    );
    return event
      ? { eventType: event.eventType, payload: event.payload, createdAt: "2026-05-03T00:00:00.000Z" }
      : null;
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

const predictAccountClient = (): PredictFunAccountClient => ({
  configured: () => true,
  getAuthMessage: async () => "Please sign this Predict auth message",
  getJwtWithSignature: async () => "predict-jwt-redacted",
  getConnectedAccount: async () => ({
    name: "predict-test-account",
    address: "0x4444444444444444444444444444444444444444"
  })
});

const limitlessPartnerAccountClient = (): LimitlessPartnerAccountClient => ({
  configured: () => true,
  eoaPartnerAccountRegistrationEnabled: () => true,
  getEoaPartnerAccount: async () => null,
  getSigningMessage: async () => "Please sign this Limitless ownership message",
  createEoaPartnerAccount: async (input) => ({
    profileId: "12345",
    account: input.account
  })
});

const limitlessPartnerAccountDiscoveryClient = (): LimitlessPartnerAccountClient => ({
  configured: () => true,
  eoaPartnerAccountRegistrationEnabled: () => true,
  getEoaPartnerAccount: async (account) => ({
    profileId: "67890",
    account
  }),
  getSigningMessage: async () => "Please sign this Limitless ownership message",
  createEoaPartnerAccount: async (input) => ({
    profileId: "67890",
    account: input.account
  })
});

const failingLimitlessEoaSigningMessageClient = (): LimitlessPartnerAccountClient => ({
  configured: () => true,
  eoaPartnerAccountRegistrationEnabled: () => true,
  getEoaPartnerAccount: async () => null,
  getSigningMessage: async () => {
    throw new Error("provider unavailable");
  },
  createEoaPartnerAccount: async (input) => ({
    profileId: "12345",
    account: input.account
  })
});

const recoveringLimitlessEoaPartnerAccountClient = (): LimitlessPartnerAccountClient => ({
  configured: () => true,
  eoaPartnerAccountRegistrationEnabled: () => true,
  getEoaPartnerAccount: async (account) => ({
    profileId: "67890",
    account
  }),
  getSigningMessage: async () => "Please sign this Limitless ownership message",
  createEoaPartnerAccount: async () => {
    throw new Error("partner account already exists");
  }
});

const limitlessServerWalletPartnerAccountClient = (): LimitlessPartnerAccountClient => ({
  configured: () => true,
  serverWalletDelegationEnabled: () => true,
  getSigningMessage: async () => {
    throw new Error("server wallet mode does not need a user signing message");
  },
  createServerWalletPartnerAccount: async () => ({
    profileId: "12345",
    account: "0x6666666666666666666666666666666666666666"
  }),
  createEoaPartnerAccount: async () => {
    throw new Error("server wallet mode must not create EOA partner accounts");
  }
});

const failingLimitlessServerWalletPartnerAccountClient = (): LimitlessPartnerAccountClient => ({
  configured: () => true,
  serverWalletDelegationEnabled: () => true,
  getSigningMessage: async () => {
    throw new Error("server wallet mode does not need a user signing message");
  },
  createServerWalletPartnerAccount: async () => {
    throw new Error("Limitless HMAC auth failed");
  },
  createEoaPartnerAccount: async () => {
    throw new Error("server wallet mode must not create EOA partner accounts");
  }
});

const polymarketDepositWalletClient = (
  deploymentStatus: Awaited<ReturnType<PolymarketDepositWalletClient["deriveOrCreateDepositWallet"]>>["deploymentStatus"] = "ALREADY_DEPLOYED"
): PolymarketDepositWalletClient => ({
  configured: () => true,
  deriveOrCreateDepositWallet: async () => ({
    walletAddress: "0x5555555555555555555555555555555555555555",
    deploymentStatus
  })
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

  it("keeps Opinion pending without a valid Safe address and links it explicitly", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(repository, {
      async resolveUserTurnkeyEvmFundingWallet() {
        return evmWallet();
      }
    });

    const pending = await service.ensureAccount({
      userId: "user-1",
      venue: "OPINION",
      venueAccountId: "opinion-safe-id"
    });
    await expect(service.ensureAccount({
      userId: "user-1",
      venue: "OPINION",
      venueAccountAddress: "not-an-address",
      venueAccountType: "SAFE"
    })).rejects.toMatchObject({ code: "USER_VENUE_ACCOUNT_INVALID_ADDRESS" });
    await expect(service.ensureAccount({
      userId: "user-1",
      venue: "OPINION",
      venueAccountAddress: "0x2222222222222222222222222222222222222222",
      venueAccountType: "EOA"
    })).rejects.toMatchObject({ code: "USER_VENUE_ACCOUNT_MISMATCH" });

    const linked = await service.completeOpinionAccountLink({
      userId: "user-1",
      venueAccountId: "opinion-safe-id",
      venueAccountAddress: "0x2222222222222222222222222222222222222222"
    });
    const relinked = await service.completeOpinionAccountLink({
      userId: "user-1",
      venueAccountAddress: "0x2222222222222222222222222222222222222222"
    });

    expect(pending.account).toMatchObject({
      venue: "OPINION",
      venueAccountId: "opinion-safe-id",
      venueAccountAddress: null,
      venueAccountType: "SAFE",
      status: "PENDING"
    });
    expect(pending.readinessBlockers).toContain("OPINION account is not active yet.");
    expect(linked.account).toMatchObject({
      venue: "OPINION",
      venueAccountId: "opinion-safe-id",
      venueAccountAddress: "0x2222222222222222222222222222222222222222",
      venueAccountType: "SAFE",
      status: "ACTIVE"
    });
    expect(relinked.account.venueAccountBindingId).toBe(linked.account.venueAccountBindingId);
    expect(repository.auditEvents.at(-1)).toMatchObject({
      eventType: "OPINION_ACCOUNT_LINKED",
      payload: {
        venue: "OPINION",
        accountType: "SAFE",
        status: "ACTIVE",
        venueAccountAddress: "0x2222222222222222222222222222222222222222",
        venueAccountIdPresent: true
      }
    });
    const serialized = JSON.stringify(repository.auditEvents);
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("providerWalletAccountId");
  });

  it("links Predict.fun connected account after Turnkey wallet auth signature", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient()
    );

    const prepared = await service.preparePredictFunAccountAuth("user-1");
    const completed = await service.completePredictFunAccountAuth({
      userId: "user-1",
      signer: prepared.signer,
      signature: `0x${"a".repeat(130)}`,
      message: prepared.message
    });

    expect(prepared).toMatchObject({
      signer: "0x1111111111111111111111111111111111111111",
      message: "Please sign this Predict auth message"
    });
    expect(completed.account).toMatchObject({
      venue: "PREDICT_FUN",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountId: "predict-test-account",
      venueAccountAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "EOA",
      status: "ACTIVE"
    });
    expect(JSON.stringify(repository.auditEvents)).not.toContain("predict-jwt-redacted");
  });

  it("derives and links Polymarket deposit wallet without requiring user signature", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      undefined,
      undefined,
      polymarketDepositWalletClient()
    );

    const first = await service.ensureAccount({ userId: "user-1", venue: "POLYMARKET" });
    const second = await service.ensureAccount({ userId: "user-1", venue: "POLYMARKET" });

    expect(first.account).toMatchObject({
      venue: "POLYMARKET",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountId: "0x5555555555555555555555555555555555555555",
      venueAccountAddress: "0x5555555555555555555555555555555555555555",
      venueAccountType: "DEPOSIT_WALLET",
      status: "ACTIVE"
    });
    expect(second.account.venueAccountBindingId).toBe(first.account.venueAccountBindingId);
    expect(first.readinessBlockers).toEqual([]);
    expect(first.setupInstructions).toEqual([]);
    expect(JSON.stringify(repository.auditEvents)).not.toContain("privateKey");
    expect(JSON.stringify(repository.auditEvents)).not.toContain("signature");
  });

  it("does not mark a Polymarket deposit wallet active until deployment is confirmed", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const calls: Array<{ allowDeploy?: boolean }> = [];
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      undefined,
      undefined,
      {
        configured: () => true,
        deriveOrCreateDepositWallet: async (input) => {
          calls.push(input.allowDeploy === undefined ? {} : { allowDeploy: input.allowDeploy });
          return {
            walletAddress: "0x5555555555555555555555555555555555555555",
            deploymentStatus: "DEPLOY_SUBMITTED",
            relayerTransactionId: "relayer-tx-123",
            relayerState: "STATE_NEW",
            transactionHash: "0xabc123"
          };
        }
      }
    );

    const ensured = await service.ensureAccount({ userId: "user-1", venue: "POLYMARKET" });
    const retried = await service.ensureAccount({ userId: "user-1", venue: "POLYMARKET" });

    expect(ensured.account).toMatchObject({
      venue: "POLYMARKET",
      venueAccountAddress: "0x5555555555555555555555555555555555555555",
      venueAccountType: "DEPOSIT_WALLET",
      status: "PENDING",
      lastVerifiedAt: null
    });
    expect(ensured.readinessBlockers).toContain("POLYMARKET account is not active yet.");
    expect(ensured.setupInstructions[0]).toContain("not confirmed active yet");
    expect(repository.auditEvents.at(-1)).toMatchObject({
      eventType: "POLYMARKET_DEPOSIT_WALLET_PENDING",
      payload: {
        deploymentStatus: "DEPLOY_SUBMITTED",
        relayerTransactionId: "relayer-tx-123",
        relayerState: "STATE_NEW",
        transactionHash: "0xabc123"
      }
    });
    expect(repository.auditEvents.at(-2)).toMatchObject({
      eventType: "POLYMARKET_DEPOSIT_WALLET_PENDING",
      payload: {
        deploymentStatus: "DEPLOY_SUBMITTED",
        relayerTransactionId: "relayer-tx-123",
        relayerState: "STATE_NEW",
        transactionHash: "0xabc123"
      }
    });
    expect(retried.account.status).toBe("PENDING");
    expect(calls).toEqual([{ allowDeploy: true }, { allowDeploy: true }]);
  });

  it("marks Myriad as an active wallet-address account without manual linking", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(repository, {
      async resolveUserTurnkeyEvmFundingWallet() {
        return evmWallet();
      }
    });

    const first = await service.ensureAccount({ userId: "user-1", venue: "MYRIAD" });
    const second = await service.ensureAccount({ userId: "user-1", venue: "MYRIAD" });

    expect(first.account).toMatchObject({
      venue: "MYRIAD",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountId: "0x1111111111111111111111111111111111111111",
      venueAccountAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "EOA",
      status: "ACTIVE"
    });
    expect(second.account.venueAccountBindingId).toBe(first.account.venueAccountBindingId);
    expect(first.readinessBlockers).toEqual([]);
    expect(first.setupInstructions).toEqual([]);
    await expect(service.verifyUserSignedRelayBinding({
      userId: "user-1",
      venue: "MYRIAD",
      signerAddress: "0x1111111111111111111111111111111111111111",
      venueAccountAddress: "0x1111111111111111111111111111111111111111"
    })).resolves.toMatchObject({ venue: "MYRIAD" });
    expect(JSON.stringify(repository.auditEvents)).not.toContain("privateKey");
    expect(JSON.stringify(repository.auditEvents)).not.toContain("signature");
  });

  it("prepares and completes a batch setup without requiring signatures for unsupported venues", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient()
    );

    const prepared = await service.prepareAccountSetupBatch("user-1");
    expect(prepared.venueAccounts.map((item) => item.venue)).toEqual([
      "POLYMARKET",
      "OPINION",
      "PREDICT_FUN",
      "LIMITLESS",
      "MYRIAD"
    ]);
    expect(prepared.signatureRequests).toHaveLength(1);
    expect(prepared.signatureRequests[0]).toMatchObject({
      venue: "PREDICT_FUN",
      requestType: "PREDICT_FUN_AUTH_MESSAGE",
      signer: "0x1111111111111111111111111111111111111111"
    });
    expect(prepared.venueAccounts.find((item) => item.venue === "LIMITLESS")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      readinessBlockers: []
    });
    expect(prepared.venueAccounts.find((item) => item.venue === "POLYMARKET")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      account: {
        venueAccountType: "DEPOSIT_WALLET",
        status: "PENDING"
      }
    });
    expect(prepared.venueAccounts.find((item) => item.venue === "OPINION")).toMatchObject({
      setupMode: "MANUAL_LINK_REQUIRED",
      readinessBlockers: [
        "OPINION account is not active yet.",
        "OPINION venue account id/address is not linked yet."
      ]
    });
    expect(prepared.venueAccounts.find((item) => item.venue === "MYRIAD")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      readinessBlockers: [],
      account: {
        venueAccountType: "EOA",
        venueAccountAddress: "0x1111111111111111111111111111111111111111",
        status: "ACTIVE"
      }
    });

    const completed = await service.completeAccountSetupBatch({
      userId: "user-1",
      predictFun: {
        signer: prepared.signatureRequests[0]!.signer,
        signature: `0x${"c".repeat(130)}`,
        message: prepared.signatureRequests[0]!.message
      }
    });
    expect(completed.signatureRequests).toHaveLength(0);
    expect(completed.venueAccounts.find((item) => item.venue === "PREDICT_FUN")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      account: {
        status: "ACTIVE",
        venueAccountType: "EOA",
        venueAccountAddress: "0x1111111111111111111111111111111111111111"
      }
    });

    await service.completeOpinionAccountLink({
      userId: "user-1",
      venueAccountAddress: "0x2222222222222222222222222222222222222222"
    });
    const afterOpinionLink = await service.prepareAccountSetupBatch("user-1");
    expect(afterOpinionLink.venueAccounts.find((item) => item.venue === "OPINION")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      readinessBlockers: [],
      setupInstructions: [],
      account: {
        status: "ACTIVE",
        venueAccountType: "SAFE",
        venueAccountAddress: "0x2222222222222222222222222222222222222222"
      }
    });
  });

  it("moves Predict.fun binding to the active Turnkey wallet instead of preserving an old account address", async () => {
    const repository = new InMemoryVenueAccountRepository();
    await repository.upsertAccount({
      userId: "user-1",
      venue: "PREDICT_FUN",
      userWalletId: "old-wallet",
      walletAddress: "0x2222222222222222222222222222222222222222",
      venueAccountId: "old-predict-account",
      venueAccountAddress: "0x3333333333333333333333333333333333333333",
      venueAccountType: "SMART_WALLET",
      status: "ACTIVE",
      lastVerifiedAt: "2026-05-01T00:00:00.000Z"
    });
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet({ walletId: "new-wallet", address: "0x1111111111111111111111111111111111111111" });
        }
      },
      predictAccountClient()
    );

    const prepared = await service.prepareAccountSetupBatch("user-1");
    const predict = prepared.venueAccounts.find((item) => item.venue === "PREDICT_FUN");

    expect(predict).toMatchObject({
      setupMode: "SIGNATURE_REQUIRED",
      account: {
        userWalletId: "new-wallet",
        walletAddress: "0x1111111111111111111111111111111111111111",
        venueAccountType: "EOA",
        venueAccountAddress: "0x1111111111111111111111111111111111111111",
        status: "ACTIVE"
      }
    });

    const healed = await service.getAccount("user-1", "PREDICT_FUN");
    expect(healed).toMatchObject({
      userWalletId: "new-wallet",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "EOA",
      venueAccountAddress: "0x1111111111111111111111111111111111111111",
      status: "ACTIVE"
    });
  });

  it("adds operator-configured ERC20 approval transactions to setup batch for EOA venues", async () => {
    const previousEnv = { ...process.env };
    process.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_ADDRESS = "0x5555555555555555555555555555555555555555";
    process.env.PREDICT_FUN_BALANCE_ACTIVATION_SPENDER_ADDRESS = "0x6666666666666666666666666666666666666666";
    process.env.PREDICT_FUN_BALANCE_ACTIVATION_CHAIN_ID = "56";
    process.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_SYMBOL = "USDT";
    process.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_DECIMALS = "18";
    process.env.PREDICT_FUN_SETUP_APPROVAL_AMOUNT = "100000";
    try {
      const repository = new InMemoryVenueAccountRepository();
      const service = new UserVenueAccountService(
        repository,
        {
          async resolveUserTurnkeyEvmFundingWallet() {
            return evmWallet();
          }
        },
        predictAccountClient()
      );

      const prepared = await service.prepareAccountSetupBatch("user-1");
      const approval = prepared.signatureRequests.find((request) => request.requestType === "ERC20_ALLOWANCE_APPROVAL");
      expect(approval).toMatchObject({
        venue: "PREDICT_FUN",
        signer: "0x1111111111111111111111111111111111111111",
        approval: {
          tokenSymbol: "USDT",
          tokenAddress: "0x5555555555555555555555555555555555555555",
          spenderAddress: "0x6666666666666666666666666666666666666666",
          amountDisplay: "100000"
        },
        transactionRequest: {
          to: "0x5555555555555555555555555555555555555555",
          from: "0x1111111111111111111111111111111111111111",
          value: "0",
          chainId: 56
        }
      });
      expect(approval?.approval?.amount).toBe("100000000000000000000000");
      expect(approval?.transactionRequest?.data).toContain("6666666666666666666666666666666666666666");
    } finally {
      process.env = previousEnv;
    }
  });

  it("prepares and completes Limitless partner account registration when configured", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient(),
      limitlessPartnerAccountClient(),
      polymarketDepositWalletClient()
    );

    const prepared = await service.prepareAccountSetupBatch("user-1");
    expect(prepared.venueAccounts.map((item) => item.venue)).toEqual([
      "POLYMARKET",
      "OPINION",
      "PREDICT_FUN",
      "LIMITLESS",
      "MYRIAD"
    ]);
    expect(prepared.signatureRequests.map((request) => request.requestType)).toEqual([
      "PREDICT_FUN_AUTH_MESSAGE",
      "LIMITLESS_PARTNER_ACCOUNT_OWNERSHIP_MESSAGE"
    ]);
    expect(prepared.venueAccounts.find((item) => item.venue === "POLYMARKET")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      account: {
        status: "ACTIVE",
        venueAccountType: "DEPOSIT_WALLET",
        venueAccountAddress: "0x5555555555555555555555555555555555555555"
      }
    });
    const limitlessRequest = prepared.signatureRequests.find((request) => request.venue === "LIMITLESS")!;
    expect(limitlessRequest).toMatchObject({
      venue: "LIMITLESS",
      signer: "0x1111111111111111111111111111111111111111",
      message: "Please sign this Limitless ownership message"
    });

    const completed = await service.completeAccountSetupBatch({
      userId: "user-1",
      limitless: {
        signer: limitlessRequest.signer,
        signature: `0x${"d".repeat(130)}`,
        message: limitlessRequest.message
      }
    });
    expect(completed.venueAccounts.find((item) => item.venue === "LIMITLESS")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      account: {
        status: "ACTIVE",
        venueAccountId: "12345",
        venueAccountAddress: "0x1111111111111111111111111111111111111111",
        venueAccountType: "EOA"
      }
    });
    expect(JSON.stringify(repository.auditEvents)).not.toContain("signature");
  });

  it("keeps setup batch usable when Limitless signing-message preparation fails", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient(),
      failingLimitlessEoaSigningMessageClient(),
      polymarketDepositWalletClient()
    );

    const prepared = await service.prepareAccountSetupBatch("user-1");
    const limitless = prepared.venueAccounts.find((item) => item.venue === "LIMITLESS");

    expect(prepared.signatureRequests.map((request) => request.requestType)).toEqual(["PREDICT_FUN_AUTH_MESSAGE"]);
    expect(limitless).toMatchObject({
      setupMode: "MANUAL_LINK_REQUIRED",
      account: {
        venue: "LIMITLESS",
        venueAccountAddress: "0x1111111111111111111111111111111111111111",
        venueAccountType: "EOA",
        status: "PENDING"
      }
    });
    expect(limitless?.readinessBlockers).toContain("LIMITLESS_PARTNER_ACCOUNT_REQUEST_FAILED");
    const serialized = JSON.stringify(repository.auditEvents);
    expect(serialized).toContain("LIMITLESS_PARTNER_ACCOUNT_SIGNING_MESSAGE_FAILED");
    expect(serialized).not.toContain("provider unavailable");
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("hmac");
  });

  it("recovers Limitless partner completion by rediscovering an existing profile", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient(),
      recoveringLimitlessEoaPartnerAccountClient(),
      polymarketDepositWalletClient()
    );

    const completed = await service.completeLimitlessPartnerAccountAuth({
      userId: "user-1",
      signer: "0x1111111111111111111111111111111111111111",
      signature: `0x${"d".repeat(130)}`,
      message: "Please sign this Limitless ownership message"
    });

    expect(completed.account).toMatchObject({
      venue: "LIMITLESS",
      venueAccountId: "67890",
      venueAccountAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "EOA",
      status: "ACTIVE"
    });
    const serialized = JSON.stringify(repository.auditEvents);
    expect(serialized).toContain("LIMITLESS_PARTNER_ACCOUNT_CREATE_RECOVERED_BY_DISCOVERY");
    expect(serialized).not.toContain("partner account already exists");
    expect(serialized).not.toContain("signature");
  });

  it("discovers a numeric Limitless EOA profile instead of treating the wallet address as a relay-ready profile id", async () => {
    const repository = new InMemoryVenueAccountRepository();
    await repository.upsertAccount({
      userId: "user-1",
      venue: "LIMITLESS",
      userWalletId: "wallet-evm",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountId: "0x1111111111111111111111111111111111111111",
      venueAccountAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "EOA",
      status: "ACTIVE"
    });
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient(),
      limitlessPartnerAccountDiscoveryClient(),
      polymarketDepositWalletClient()
    );

    const ensured = await service.ensureAccount({ userId: "user-1", venue: "LIMITLESS" });

    expect(ensured).toMatchObject({
      account: {
        status: "ACTIVE",
        venueAccountId: "67890",
        venueAccountAddress: "0x1111111111111111111111111111111111111111",
        venueAccountType: "EOA"
      },
      readinessBlockers: []
    });
    expect(JSON.stringify(repository.auditEvents)).toContain("LIMITLESS_PARTNER_ACCOUNT_DISCOVERED");
  });

  it("automatically creates a Limitless delegated server-wallet account with safe metadata only", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient(),
      limitlessServerWalletPartnerAccountClient(),
      polymarketDepositWalletClient()
    );

    const first = await service.ensureAccount({ userId: "user-1", venue: "LIMITLESS" });
    const second = await service.ensureAccount({ userId: "user-1", venue: "LIMITLESS" });
    const batch = await service.prepareAccountSetupBatch("user-1");

    expect(first.account).toMatchObject({
      venue: "LIMITLESS",
      walletAddress: "0x1111111111111111111111111111111111111111",
      venueAccountId: "12345",
      venueAccountAddress: "0x6666666666666666666666666666666666666666",
      venueAccountType: "SERVER_WALLET",
      status: "ACTIVE"
    });
    expect(second.account.venueAccountBindingId).toBe(first.account.venueAccountBindingId);
    expect(batch.signatureRequests.map((request) => request.venue)).toEqual(["PREDICT_FUN"]);
    expect(batch.venueAccounts.find((item) => item.venue === "LIMITLESS")).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      readinessBlockers: [],
      setupInstructions: []
    });
    const serialized = JSON.stringify(repository.auditEvents);
    expect(serialized).toContain("LIMITLESS_SERVER_WALLET_LINKED");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("hmac");
    expect(serialized).not.toContain("providerWalletAccountId");
  });

  it("keeps setup batch fail-closed when Limitless server-wallet creation fails", async () => {
    const repository = new InMemoryVenueAccountRepository();
    const service = new UserVenueAccountService(
      repository,
      {
        async resolveUserTurnkeyEvmFundingWallet() {
          return evmWallet();
        }
      },
      predictAccountClient(),
      failingLimitlessServerWalletPartnerAccountClient(),
      polymarketDepositWalletClient()
    );

    const batch = await service.prepareAccountSetupBatch("user-1");
    const limitless = batch.venueAccounts.find((item) => item.venue === "LIMITLESS");

    expect(limitless).toMatchObject({
      setupMode: "NO_USER_SETUP_REQUIRED",
      account: {
        venue: "LIMITLESS",
        walletAddress: "0x1111111111111111111111111111111111111111",
        venueAccountId: null,
        venueAccountAddress: null,
        venueAccountType: "SERVER_WALLET",
        status: "PENDING"
      }
    });
    expect(limitless?.readinessBlockers).toEqual([
      "LIMITLESS account is not active yet.",
      "LIMITLESS venue account id/address is not linked yet.",
      "Limitless delegated server-wallet account request failed. Check partner HMAC scopes and retry account setup."
    ]);
    expect(batch.signatureRequests.map((request) => request.venue)).toEqual(["PREDICT_FUN"]);
    const serialized = JSON.stringify(repository.auditEvents);
    expect(serialized).toContain("LIMITLESS_SERVER_WALLET_ENSURE_FAILED");
    expect(serialized).not.toContain("Limitless HMAC auth failed");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("hmac");
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
    }, predictAccountClient());
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
      ensureAccount: (input) => service.ensureAccount(input),
      prepareAccountSetupBatch: (userId) => service.prepareAccountSetupBatch(userId),
      completeAccountSetupBatch: (input) => service.completeAccountSetupBatch(input),
      preparePredictFunAccountAuth: (userId) => service.preparePredictFunAccountAuth(userId),
      completePredictFunAccountAuth: (input) => service.completePredictFunAccountAuth(input),
      completeOpinionAccountLink: (input) => service.completeOpinionAccountLink(input)
    });
    const token = app.jwt.sign({ userId: "user-1", role: "USER", email: "polymarket-funding-test@uselotus.xyz" });

    await expect(app.inject({ method: "GET", url: "/user/venue-accounts" }))
      .resolves.toMatchObject({ statusCode: 401 });
    await expect(app.inject({
      method: "POST",
      url: "/user/venue-accounts/opinion/complete-link",
      payload: { venueAccountAddress: "0x2222222222222222222222222222222222222222" }
    })).resolves.toMatchObject({ statusCode: 401 });
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

    const invalidOpinionLink = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/opinion/complete-link",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        venueAccountAddress: "not-an-address"
      }
    });
    expect(invalidOpinionLink.statusCode).toBe(400);
    expect(invalidOpinionLink.json()).toMatchObject({ code: "USER_VENUE_ACCOUNT_INVALID_ADDRESS" });

    const linkedOpinion = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/opinion/complete-link",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        venueAccountAddress: "0x2222222222222222222222222222222222222222",
        venueAccountId: "opinion-safe-id"
      }
    });
    expect(linkedOpinion.statusCode).toBe(200);
    expect(linkedOpinion.json().venueAccount).toMatchObject({
      venue: "OPINION",
      venueAccountId: "opinion-safe-id",
      venueAccountAddress: "0x2222222222222222222222222222222222222222",
      venueAccountType: "SAFE",
      status: "ACTIVE",
      readinessBlockers: [],
      setupInstructions: []
    });
    expect(linkedOpinion.body).not.toContain("signature");
    expect(linkedOpinion.body).not.toContain("apiKey");

    const listed = await app.inject({
      method: "GET",
      url: "/user/venue-accounts",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(listed.json().venueAccounts).toHaveLength(1);

    const predictPrepared = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/predict_fun/auth-message",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(predictPrepared.statusCode).toBe(200);
    expect(predictPrepared.json()).toMatchObject({
      venue: "PREDICT_FUN",
      signer: "0x1111111111111111111111111111111111111111",
      message: "Please sign this Predict auth message"
    });

    const predictCompleted = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/predict_fun/complete-auth",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        signer: "0x1111111111111111111111111111111111111111",
        signature: `0x${"b".repeat(130)}`,
        message: "Please sign this Predict auth message"
      }
    });
    expect(predictCompleted.statusCode).toBe(200);
    expect(predictCompleted.body).not.toContain("predict-jwt-redacted");
    expect(predictCompleted.json().venueAccount).toMatchObject({
      venue: "PREDICT_FUN",
      venueAccountAddress: "0x1111111111111111111111111111111111111111",
      venueAccountType: "EOA",
      status: "ACTIVE"
    });

    const batchPrepared = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/setup-batch",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(batchPrepared.statusCode).toBe(200);
    expect(batchPrepared.json().venueAccounts.map((item: { venue: string }) => item.venue)).toEqual([
      "POLYMARKET",
      "OPINION",
      "PREDICT_FUN",
      "LIMITLESS",
      "MYRIAD"
    ]);
    expect(batchPrepared.body).not.toContain("predict-jwt-redacted");
    expect(batchPrepared.body).not.toContain("providerWalletAccountId");

    const batchCompleted = await app.inject({
      method: "POST",
      url: "/user/venue-accounts/complete-batch",
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect(batchCompleted.statusCode).toBe(200);
    expect(batchCompleted.body).not.toContain("predict-jwt-redacted");
    await app.close();
  });
});
