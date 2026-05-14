import type { FundingVenue } from "./types.js";

export type UserWalletProvider = "TURNKEY" | "EXTERNAL";
export type UserWalletChainFamily = "SOLANA" | "EVM";
export type UserWalletPurpose = "DEFAULT_FUNDING" | "VENUE_TARGET" | "WITHDRAWAL_DESTINATION";
export type UserWalletStatus = "ACTIVE" | "DISABLED";

export interface UserWallet {
  walletId: string;
  userId: string;
  provider: UserWalletProvider;
  providerSubOrgId: string | null;
  providerWalletId: string | null;
  providerWalletAccountId: string | null;
  chainFamily: UserWalletChainFamily;
  chain: string;
  address: string;
  purpose: UserWalletPurpose;
  venue: FundingVenue | null;
  exportable: boolean;
  status: UserWalletStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionedUserWallet {
  provider: "TURNKEY";
  providerSubOrgId: string;
  providerWalletId: string;
  providerWalletAccountId: string | null;
  chainFamily: UserWalletChainFamily;
  chain: string;
  address: string;
  purpose: UserWalletPurpose;
  venue?: FundingVenue | null;
  exportable: boolean;
}

export interface TurnkeyWalletAccountRegistration {
  providerWalletId: string;
  providerWalletAccountId: string;
  address: string;
  addressFormat: "ADDRESS_FORMAT_SOLANA" | "ADDRESS_FORMAT_ETHEREUM";
}

export interface UserWalletRepository {
  listWallets(userId: string): Promise<UserWallet[]>;
  findWalletById(walletId: string): Promise<UserWallet | null>;
  findActiveWallet(input: {
    userId: string;
    chainFamily: UserWalletChainFamily;
    purpose: UserWalletPurpose;
    venue?: FundingVenue | null;
  }): Promise<UserWallet | null>;
  upsertWallet(input: Omit<UserWallet, "walletId" | "createdAt" | "updatedAt"> & { walletId?: string }): Promise<UserWallet>;
  appendWalletAuditEvent(input: {
    userId: string;
    walletId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string>;
}

export interface TurnkeyWalletProvisioner {
  provisionDefaultWallets(input: {
    userId: string;
    email?: string | null;
    turnkeyOrganizationId?: string | null;
    includeSolana: boolean;
    includeEvm: boolean;
  }): Promise<ProvisionedUserWallet[]>;
  verifyDefaultWalletAccounts(input: {
    turnkeyOrganizationId: string;
    accounts: TurnkeyWalletAccountRegistration[];
  }): Promise<ProvisionedUserWallet[]>;
}

export interface UserWalletServiceConfig {
  turnkeyEnabled: boolean;
  defaultSolanaWalletEnabled: boolean;
  defaultEvmWalletEnabled: boolean;
}

export class UserWalletError extends Error {
  public constructor(
    public readonly code: "TURNKEY_DISABLED" | "USER_WALLET_NOT_FOUND" | "USER_WALLET_FORBIDDEN" | "USER_WALLET_UNAVAILABLE",
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
  }
}

export class UserWalletService {
  public constructor(
    private readonly repository: UserWalletRepository,
    private readonly config: UserWalletServiceConfig,
    private readonly turnkeyProvisioner: TurnkeyWalletProvisioner | null = null
  ) {}

  public async listWallets(userId: string): Promise<UserWallet[]> {
    return this.repository.listWallets(userId);
  }

  public async ensureDefaultWallets(
    userId: string,
    email?: string | null,
    turnkeyOrganizationId?: string | null
  ): Promise<UserWallet[]> {
    const existing = await this.repository.listWallets(userId);
    const hasSolana = existing.some((wallet) => isActiveDefault(wallet, "SOLANA", turnkeyOrganizationId));
    const hasEvm = existing.some((wallet) => isActiveDefault(wallet, "EVM", turnkeyOrganizationId));
    const needsSolana = this.config.defaultSolanaWalletEnabled && !hasSolana;
    const needsEvm = this.config.defaultEvmWalletEnabled && !hasEvm;
    if (!needsSolana && !needsEvm) {
      return existing;
    }
    if (!this.config.turnkeyEnabled || !this.turnkeyProvisioner) {
      await this.repository.appendWalletAuditEvent({
        userId,
        eventType: "USER_WALLET_DEFAULTS_BLOCKED",
        payload: { reason: "TURNKEY_DISABLED", needsSolana, needsEvm }
      });
      throw new UserWalletError("TURNKEY_DISABLED", "Turnkey wallet provisioning is disabled.", 503);
    }

    const provisioned = await this.provisionDefaultWallets({
      userId,
      ...(email !== undefined ? { email } : {}),
      ...(turnkeyOrganizationId !== undefined ? { turnkeyOrganizationId } : {}),
      needsSolana,
      needsEvm
    });
    for (const wallet of provisioned) {
      const stored = await this.repository.upsertWallet({
        userId,
        provider: wallet.provider,
        providerSubOrgId: wallet.providerSubOrgId,
        providerWalletId: wallet.providerWalletId,
        providerWalletAccountId: wallet.providerWalletAccountId,
        chainFamily: wallet.chainFamily,
        chain: wallet.chain,
        address: wallet.address,
        purpose: wallet.purpose,
        venue: wallet.venue ?? null,
        exportable: wallet.exportable,
        status: "ACTIVE"
      });
      await this.repository.appendWalletAuditEvent({
        userId,
        walletId: stored.walletId,
        eventType: "USER_WALLET_PROVISIONED",
        payload: {
          provider: stored.provider,
          chainFamily: stored.chainFamily,
          chain: stored.chain,
          purpose: stored.purpose,
          venue: stored.venue,
          exportable: stored.exportable
        }
      });
    }
    return this.repository.listWallets(userId);
  }

  public async registerTurnkeyDefaultWallets(
    userId: string,
    turnkeyOrganizationId: string | null | undefined,
    accounts: TurnkeyWalletAccountRegistration[]
  ): Promise<UserWallet[]> {
    const organizationId = turnkeyOrganizationId?.trim();
    if (!organizationId) {
      throw new UserWalletError("USER_WALLET_UNAVAILABLE", "Turnkey wallet session is missing an organization.", 409);
    }
    if (!this.config.turnkeyEnabled || !this.turnkeyProvisioner) {
      throw new UserWalletError("TURNKEY_DISABLED", "Turnkey wallet provisioning is disabled.", 503);
    }

    let verified: ProvisionedUserWallet[];
    try {
      verified = await this.turnkeyProvisioner.verifyDefaultWalletAccounts({
        turnkeyOrganizationId: organizationId,
        accounts
      });
    } catch (error) {
      await this.repository.appendWalletAuditEvent({
        userId,
        eventType: "USER_WALLET_SESSION_REGISTRATION_FAILED",
        payload: {
          provider: "TURNKEY",
          requestedAccounts: accounts.length,
          turnkeyOrganizationProvided: true,
          ...safeProvisioningError(error)
        }
      });
      throw new UserWalletError(
        "USER_WALLET_UNAVAILABLE",
        "Turnkey wallet registration is temporarily unavailable.",
        503
      );
    }
    if (verified.length === 0) {
      throw new UserWalletError("USER_WALLET_UNAVAILABLE", "Turnkey wallet session did not include a usable funding wallet.", 409);
    }

    for (const wallet of verified) {
      const stored = await this.repository.upsertWallet({
        userId,
        provider: wallet.provider,
        providerSubOrgId: wallet.providerSubOrgId,
        providerWalletId: wallet.providerWalletId,
        providerWalletAccountId: wallet.providerWalletAccountId,
        chainFamily: wallet.chainFamily,
        chain: wallet.chain,
        address: wallet.address,
        purpose: wallet.purpose,
        venue: wallet.venue ?? null,
        exportable: wallet.exportable,
        status: "ACTIVE"
      });
      await this.repository.appendWalletAuditEvent({
        userId,
        walletId: stored.walletId,
        eventType: "USER_WALLET_REGISTERED_FROM_TURNKEY_SESSION",
        payload: {
          provider: stored.provider,
          chainFamily: stored.chainFamily,
          chain: stored.chain,
          purpose: stored.purpose,
          exportable: stored.exportable,
          turnkeyOrganizationMatched: stored.providerSubOrgId === organizationId
        }
      });
    }

    return this.repository.listWallets(userId);
  }

  private async provisionDefaultWallets(input: {
    userId: string;
    email?: string | null;
    turnkeyOrganizationId?: string | null;
    needsSolana: boolean;
    needsEvm: boolean;
  }): Promise<ProvisionedUserWallet[]> {
    try {
      return await this.turnkeyProvisioner!.provisionDefaultWallets({
        userId: input.userId,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.turnkeyOrganizationId !== undefined ? { turnkeyOrganizationId: input.turnkeyOrganizationId } : {}),
        includeSolana: input.needsSolana,
        includeEvm: input.needsEvm
      });
    } catch (error) {
      await this.repository.appendWalletAuditEvent({
        userId: input.userId,
        eventType: "USER_WALLET_PROVISIONING_FAILED",
        payload: {
          provider: "TURNKEY",
          needsSolana: input.needsSolana,
          needsEvm: input.needsEvm,
          turnkeyOrganizationProvided: Boolean(input.turnkeyOrganizationId?.trim()),
          ...safeProvisioningError(error)
        }
      });
      throw new UserWalletError(
        "USER_WALLET_UNAVAILABLE",
        "Turnkey wallet provisioning is temporarily unavailable.",
        503
      );
    }
  }

  public async upsertExternalEvmWithdrawalWallet(input: {
    userId: string;
    address: string;
    label?: string | null;
  }): Promise<UserWallet> {
    const wallet = await this.repository.upsertWallet({
      userId: input.userId,
      provider: "EXTERNAL",
      providerSubOrgId: null,
      providerWalletId: null,
      providerWalletAccountId: null,
      chainFamily: "EVM",
      chain: "EVM",
      address: input.address,
      purpose: "WITHDRAWAL_DESTINATION",
      venue: null,
      exportable: true,
      status: "ACTIVE"
    });
    await this.repository.appendWalletAuditEvent({
      userId: input.userId,
      walletId: wallet.walletId,
      eventType: "USER_WITHDRAWAL_WALLET_UPSERTED",
      payload: { chainFamily: "EVM", hasLabel: Boolean(input.label) }
    });
    return wallet;
  }

  public async hasEvmWithdrawalWallet(userId: string, address?: string | null): Promise<boolean> {
    const wallet = await this.repository.findActiveWallet({
      userId,
      chainFamily: "EVM",
      purpose: "WITHDRAWAL_DESTINATION"
    });
    if (!wallet) {
      return false;
    }
    return !address || wallet.address.toLowerCase() === address.toLowerCase();
  }

  public async resolveFundingSourceWallet(input: {
    userId: string;
    sourceChain: string;
    sourceWalletId?: string | null;
  }): Promise<UserWallet | null> {
    if (input.sourceWalletId) {
      const wallet = await this.repository.findWalletById(input.sourceWalletId);
      if (!wallet) {
        throw new UserWalletError("USER_WALLET_NOT_FOUND", "Funding source wallet was not found.", 404);
      }
      if (wallet.userId !== input.userId) {
        throw new UserWalletError("USER_WALLET_FORBIDDEN", "Funding source wallet does not belong to this user.", 403);
      }
      if (wallet.status !== "ACTIVE" || !chainMatches(wallet, input.sourceChain)) {
        throw new UserWalletError("USER_WALLET_UNAVAILABLE", "Funding source wallet is not available for this source chain.", 409);
      }
      return wallet;
    }
    if (isSolanaFundingChain(input.sourceChain)) {
      return this.repository.findActiveWallet({
        userId: input.userId,
        chainFamily: "SOLANA",
        purpose: "DEFAULT_FUNDING"
      });
    }
    if (isEvmFundingChain(input.sourceChain)) {
      return this.repository.findActiveWallet({
        userId: input.userId,
        chainFamily: "EVM",
        purpose: "DEFAULT_FUNDING"
      });
    }
    return null;
  }

  public async resolveUserTurnkeyEvmFundingWallet(userId: string): Promise<UserWallet | null> {
    return this.repository.findActiveWallet({
      userId,
      chainFamily: "EVM",
      purpose: "DEFAULT_FUNDING"
    });
  }

  public async resolveVenueTargetWallet(userId: string, venue: FundingVenue): Promise<UserWallet | null> {
    return this.repository.findActiveWallet({
      userId,
      chainFamily: "EVM",
      purpose: "VENUE_TARGET",
      venue
    });
  }
}

const isActiveDefault = (
  wallet: UserWallet,
  chainFamily: UserWalletChainFamily,
  turnkeyOrganizationId?: string | null
): boolean => {
  if (wallet.status !== "ACTIVE" || wallet.purpose !== "DEFAULT_FUNDING" || wallet.chainFamily !== chainFamily) {
    return false;
  }
  const expectedOrganizationId = turnkeyOrganizationId?.trim();
  if (wallet.provider === "TURNKEY" && expectedOrganizationId) {
    return wallet.providerSubOrgId === expectedOrganizationId;
  }
  return true;
};

const chainMatches = (wallet: UserWallet, sourceChain: string): boolean => {
  const normalized = sourceChain.toUpperCase();
  if (wallet.chainFamily === "SOLANA") {
    return isSolanaFundingChain(normalized) || wallet.chain.toUpperCase() === normalized;
  }
  return wallet.chainFamily === "EVM" && (wallet.chain.toUpperCase() === normalized || wallet.chain === "EVM" || isEvmFundingChain(normalized));
};

const isSolanaFundingChain = (value: string): boolean => {
  const normalized = value.trim().toUpperCase();
  return normalized === "SOL" || normalized === "SOLANA" || normalized === "1151111081099710";
};

const isEvmFundingChain = (value: string): boolean => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "1151111081099710") {
    return false;
  }
  return [
    "EVM",
    "ETH",
    "ETHEREUM",
    "POLYGON",
    "MATIC",
    "BASE",
    "BSC",
    "BNB",
    "BNB_SMART_CHAIN"
  ].includes(normalized) || /^\d+$/.test(normalized);
};

const safeProvisioningError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { errorName: "UnknownError" };
  }

  const record = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  return {
    errorName: error.name,
    errorMessage: safeErrorMessage(error.message),
    ...(isPrimitiveErrorValue(record.code) ? { errorCode: record.code } : {}),
    ...(isPrimitiveErrorValue(record.status) ? { errorStatus: record.status } : {}),
    ...(isPrimitiveErrorValue(record.statusCode) ? { errorStatusCode: record.statusCode } : {}),
    ...(record.cause instanceof Error ? { causeName: record.cause.name, causeMessage: safeErrorMessage(record.cause.message) } : {})
  };
};

const isPrimitiveErrorValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const safeErrorMessage = (message: string): string =>
  message
    .replace(/credential:\s*[^)\]\s,]+/gi, "credential: [redacted]")
    .replace(/0x[a-fA-F0-9]{32,}/g, "[hex]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[token]")
    .slice(0, 500);
