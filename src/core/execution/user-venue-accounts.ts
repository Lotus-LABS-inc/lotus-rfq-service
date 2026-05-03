import type { FundingVenue } from "../funding/types.js";
import { UserWalletError, type UserWallet, type UserWalletService } from "../funding/user-wallets.js";

export type UserVenueAccountType = "SAFE" | "SMART_WALLET" | "OAUTH_ACCOUNT" | "EOA" | "PROXY_ACCOUNT" | "DEPOSIT_WALLET";
export type UserVenueAccountStatus = "PENDING" | "ACTIVE" | "DISABLED" | "REVOKED";
export type UserVenueAccountVenue = Extract<FundingVenue, "OPINION" | "PREDICT_FUN" | "LIMITLESS" | "MYRIAD" | "POLYMARKET">;

export interface UserVenueAccount {
  venueAccountBindingId: string;
  userId: string;
  venue: UserVenueAccountVenue;
  userWalletId: string;
  walletAddress: string;
  venueAccountId: string | null;
  venueAccountAddress: string | null;
  venueAccountType: UserVenueAccountType;
  status: UserVenueAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

export interface EnsureUserVenueAccountInput {
  userId: string;
  venue: UserVenueAccountVenue;
  venueAccountId?: string | null;
  venueAccountAddress?: string | null;
  venueAccountType?: UserVenueAccountType | null;
}

export interface UserVenueAccountRepository {
  listAccounts(userId: string): Promise<UserVenueAccount[]>;
  findAccount(input: { userId: string; venue: UserVenueAccountVenue }): Promise<UserVenueAccount | null>;
  upsertAccount(input: Omit<UserVenueAccount, "venueAccountBindingId" | "createdAt" | "updatedAt" | "lastVerifiedAt"> & {
    venueAccountBindingId?: string;
    lastVerifiedAt?: string | null;
  }): Promise<UserVenueAccount>;
  disableAccount(input: { userId: string; venue: UserVenueAccountVenue; reason: string }): Promise<UserVenueAccount | null>;
  countActiveAccountsByVenue(): Promise<Record<string, number>>;
  appendAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string>;
}

export interface PredictFunAccountClient {
  configured(): boolean;
  getAuthMessage(): Promise<string>;
  getJwtWithSignature(input: { signer: string; signature: string; message: string }): Promise<string>;
  getConnectedAccount(jwt: string): Promise<{ name: string | null; address: string }>;
}

export interface LimitlessPartnerAccountClient {
  configured(): boolean;
  getSigningMessage(): Promise<string>;
  createEoaPartnerAccount(input: {
    account: string;
    signingMessage: string;
    signature: string;
    displayName?: string | null;
  }): Promise<{ profileId: string; account: string }>;
}

export interface PolymarketDepositWalletClient {
  configured(): boolean;
  deriveOrCreateDepositWallet(input: { ownerAddress: string }): Promise<{
    walletAddress: string;
    deploymentStatus: "DERIVED_NOT_DEPLOYED";
  }>;
}

export interface UserVenueAccountSetupBatchItem {
  venue: UserVenueAccountVenue;
  account: UserVenueAccount;
  readinessBlockers: string[];
  setupInstructions: string[];
  setupMode: "NO_USER_SETUP_REQUIRED" | "MANUAL_LINK_REQUIRED" | "SIGNATURE_REQUIRED";
}

export interface UserVenueAccountSignatureRequest {
  venue: "PREDICT_FUN" | "LIMITLESS";
  requestType: "PREDICT_FUN_AUTH_MESSAGE" | "LIMITLESS_PARTNER_ACCOUNT_OWNERSHIP_MESSAGE";
  signer: string;
  message: string;
  venueAccount: UserVenueAccount;
}

export interface UserVenueAccountSetupBatch {
  venueAccounts: UserVenueAccountSetupBatchItem[];
  signatureRequests: UserVenueAccountSignatureRequest[];
}

export class UserVenueAccountError extends Error {
  public constructor(
    public readonly code:
      | "USER_VENUE_ACCOUNT_UNSUPPORTED"
      | "USER_VENUE_ACCOUNT_WALLET_REQUIRED"
      | "USER_VENUE_ACCOUNT_MISMATCH"
      | "USER_VENUE_ACCOUNT_INACTIVE"
      | "PREDICT_FUN_ACCOUNT_NOT_CONFIGURED"
      | "PREDICT_FUN_ACCOUNT_AUTH_FAILED"
      | "LIMITLESS_PARTNER_ACCOUNT_NOT_CONFIGURED"
      | "LIMITLESS_PARTNER_ACCOUNT_AUTH_FAILED"
      | "POLYMARKET_DEPOSIT_WALLET_NOT_CONFIGURED"
      | "POLYMARKET_DEPOSIT_WALLET_FAILED",
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
    this.name = "UserVenueAccountError";
  }
}

export class UserVenueAccountService {
  public constructor(
    private readonly repository: UserVenueAccountRepository,
    private readonly userWalletService: Pick<UserWalletService, "resolveUserTurnkeyEvmFundingWallet">,
    private readonly predictFunAccountClient?: PredictFunAccountClient,
    private readonly limitlessPartnerAccountClient?: LimitlessPartnerAccountClient,
    private readonly polymarketDepositWalletClient?: PolymarketDepositWalletClient
  ) {}

  public async listAccounts(userId: string): Promise<UserVenueAccount[]> {
    return this.repository.listAccounts(userId);
  }

  public async getAccount(userId: string, venue: string): Promise<UserVenueAccount | null> {
    return this.repository.findAccount({ userId, venue: normalizeVenue(venue) });
  }

  public async ensureAccount(input: EnsureUserVenueAccountInput): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    const venue = normalizeVenue(input.venue);
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(input.userId);
    const existing = await this.repository.findAccount({ userId: input.userId, venue });
    if (venue === "POLYMARKET" && !input.venueAccountId && !input.venueAccountAddress) {
      return this.ensurePolymarketDepositWalletAccount(input.userId, wallet, existing);
    }
    const venueAccountType = input.venueAccountType ?? defaultAccountTypeForVenue(venue);
    const hasVenueAccount = Boolean(input.venueAccountId?.trim() || input.venueAccountAddress?.trim());
    const account = await this.repository.upsertAccount({
      ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
      userId: input.userId,
      venue,
      userWalletId: wallet.walletId,
      walletAddress: wallet.address,
      venueAccountId: nonEmpty(input.venueAccountId) ?? existing?.venueAccountId ?? null,
      venueAccountAddress: nonEmpty(input.venueAccountAddress) ?? existing?.venueAccountAddress ?? null,
      venueAccountType,
      status: hasVenueAccount || existing?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
      lastVerifiedAt: hasVenueAccount ? new Date().toISOString() : existing?.lastVerifiedAt ?? null
    });
    await this.repository.appendAccountAuditEvent({
      userId: input.userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: existing ? "USER_VENUE_ACCOUNT_UPDATED" : "USER_VENUE_ACCOUNT_ENSURED",
      payload: {
        venue,
        accountType: account.venueAccountType,
        status: account.status,
        walletAddressMatches: equalsAddress(account.walletAddress, wallet.address)
      }
    });
    return {
      account,
      readinessBlockers: readinessBlockersForAccount(account),
      setupInstructions: setupInstructionsForVenue(venue, account)
    };
  }

  public async preparePredictFunAccountAuth(userId: string): Promise<{
    signer: string;
    message: string;
    venueAccount: UserVenueAccount;
  }> {
    const client = this.requirePredictFunAccountClient();
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(userId);
    const ensured = await this.ensureAccount({ userId, venue: "PREDICT_FUN" });
    const message = await this.withPredictAccountFailureBoundary(() => client.getAuthMessage());
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: ensured.account.venueAccountBindingId,
      eventType: "PREDICT_FUN_ACCOUNT_AUTH_MESSAGE_CREATED",
      payload: {
        venue: "PREDICT_FUN",
        signer: wallet.address,
        messageLength: message.length
      }
    });
    return {
      signer: wallet.address,
      message,
      venueAccount: ensured.account
    };
  }

  public async prepareAccountSetupBatch(userId: string): Promise<UserVenueAccountSetupBatch> {
    const venueAccounts: UserVenueAccountSetupBatchItem[] = [];
    const signatureRequests: UserVenueAccountSignatureRequest[] = [];

    for (const venue of batchSetupVenues) {
      if (venue === "PREDICT_FUN") {
        const ensured = await this.ensureAccount({ userId, venue: "PREDICT_FUN" });
        if (ensured.account.status === "ACTIVE") {
          venueAccounts.push({
            venue,
            account: ensured.account,
            readinessBlockers: ensured.readinessBlockers,
            setupInstructions: ensured.setupInstructions,
            setupMode: "NO_USER_SETUP_REQUIRED"
          });
          continue;
        }
        if (this.predictFunAccountClient?.configured()) {
          const wallet = await this.resolveRequiredTurnkeyEvmWallet(userId);
          const message = await this.withPredictAccountFailureBoundary(() => this.predictFunAccountClient!.getAuthMessage());
          await this.repository.appendAccountAuditEvent({
            userId,
            venueAccountBindingId: ensured.account.venueAccountBindingId,
            eventType: "PREDICT_FUN_ACCOUNT_AUTH_MESSAGE_CREATED",
            payload: {
              venue: "PREDICT_FUN",
              signer: wallet.address,
              messageLength: message.length,
              source: "BATCH_SETUP"
            }
          });
          venueAccounts.push({
            venue,
            account: ensured.account,
            readinessBlockers: ensured.readinessBlockers,
            setupInstructions: ensured.setupInstructions,
            setupMode: "SIGNATURE_REQUIRED"
          });
          signatureRequests.push({
            venue,
            requestType: "PREDICT_FUN_AUTH_MESSAGE",
            signer: wallet.address,
            message,
            venueAccount: ensured.account
          });
          continue;
        }
        venueAccounts.push({
          venue,
          account: ensured.account,
          readinessBlockers: ensured.readinessBlockers,
          setupInstructions: ["Predict.fun account automation is not configured. Configure PREDICT_API_KEY before batch account linking."],
          setupMode: "MANUAL_LINK_REQUIRED"
        });
        continue;
      }

      if (venue === "LIMITLESS") {
        const ensured = await this.ensureAccount({ userId, venue: "LIMITLESS" });
        if (ensured.account.status === "ACTIVE") {
          venueAccounts.push({
            venue,
            account: ensured.account,
            readinessBlockers: [],
            setupInstructions: [],
            setupMode: "NO_USER_SETUP_REQUIRED"
          });
          continue;
        }
        if (this.limitlessPartnerAccountClient?.configured()) {
          const wallet = await this.resolveRequiredTurnkeyEvmWallet(userId);
          const message = await this.withLimitlessPartnerAccountFailureBoundary(() => this.limitlessPartnerAccountClient!.getSigningMessage());
          await this.repository.appendAccountAuditEvent({
            userId,
            venueAccountBindingId: ensured.account.venueAccountBindingId,
            eventType: "LIMITLESS_PARTNER_ACCOUNT_SIGNING_MESSAGE_CREATED",
            payload: {
              venue: "LIMITLESS",
              signer: wallet.address,
              messageLength: message.length,
              source: "BATCH_SETUP"
            }
          });
          venueAccounts.push({
            venue,
            account: ensured.account,
            readinessBlockers: ensured.readinessBlockers,
            setupInstructions: ["Sign the Limitless ownership message with the displayed Turnkey EVM wallet so Lotus can register the partner account."],
            setupMode: "SIGNATURE_REQUIRED"
          });
          signatureRequests.push({
            venue,
            requestType: "LIMITLESS_PARTNER_ACCOUNT_OWNERSHIP_MESSAGE",
            signer: wallet.address,
            message,
            venueAccount: ensured.account
          });
          continue;
        }
        venueAccounts.push({
          venue,
          account: ensured.account,
          readinessBlockers: [],
          setupInstructions: setupInstructionsForVenue(venue, ensured.account),
          setupMode: "NO_USER_SETUP_REQUIRED"
        });
        continue;
      }
      const ensured = await this.ensureAccount({ userId, venue });
      venueAccounts.push({
        venue,
        account: ensured.account,
        readinessBlockers: ensured.readinessBlockers,
        setupInstructions: setupInstructionsForVenue(venue, ensured.account),
        setupMode: setupModeForVenue(venue, ensured.account)
      });
    }

    return { venueAccounts, signatureRequests };
  }

  public async completeAccountSetupBatch(input: {
    userId: string;
    predictFun?: {
      signer: string;
      signature: string;
      message: string;
    } | null;
    limitless?: {
      signer: string;
      signature: string;
      message: string;
    } | null;
  }): Promise<UserVenueAccountSetupBatch> {
    if (input.predictFun) {
      await this.completePredictFunAccountAuth({
        userId: input.userId,
        signer: input.predictFun.signer,
        signature: input.predictFun.signature,
        message: input.predictFun.message
      });
    }
    if (input.limitless) {
      await this.completeLimitlessPartnerAccountAuth({
        userId: input.userId,
        signer: input.limitless.signer,
        signature: input.limitless.signature,
        message: input.limitless.message
      });
    }
    return this.prepareAccountSetupBatch(input.userId);
  }

  public async completePredictFunAccountAuth(input: {
    userId: string;
    signer: string;
    signature: string;
    message: string;
  }): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    const client = this.requirePredictFunAccountClient();
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(input.userId);
    if (!equalsAddress(input.signer, wallet.address)) {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_MISMATCH",
        "Predict.fun auth signer does not match the user's Turnkey EVM wallet.",
        403
      );
    }
    if (!isEvmSignature(input.signature)) {
      throw new UserVenueAccountError(
        "PREDICT_FUN_ACCOUNT_AUTH_FAILED",
        "Predict.fun auth signature is invalid.",
        400
      );
    }
    const jwt = await this.withPredictAccountFailureBoundary(() => client.getJwtWithSignature({
      signer: wallet.address,
      signature: input.signature,
      message: input.message
    }));
    const connectedAccount = await this.withPredictAccountFailureBoundary(() => client.getConnectedAccount(jwt));
    const ensured = await this.ensureAccount({
      userId: input.userId,
      venue: "PREDICT_FUN",
      venueAccountId: connectedAccount.name,
      venueAccountAddress: connectedAccount.address,
      venueAccountType: "SMART_WALLET"
    });
    await this.repository.appendAccountAuditEvent({
      userId: input.userId,
      venueAccountBindingId: ensured.account.venueAccountBindingId,
      eventType: "PREDICT_FUN_ACCOUNT_LINKED",
      payload: {
        venue: "PREDICT_FUN",
        signer: wallet.address,
        venueAccountAddress: connectedAccount.address,
        venueAccountIdPresent: connectedAccount.name !== null
      }
    });
    return ensured;
  }

  public async completeLimitlessPartnerAccountAuth(input: {
    userId: string;
    signer: string;
    signature: string;
    message: string;
  }): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    const client = this.requireLimitlessPartnerAccountClient();
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(input.userId);
    if (!equalsAddress(input.signer, wallet.address)) {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_MISMATCH",
        "Limitless partner account signer does not match the user's Turnkey EVM wallet.",
        403
      );
    }
    if (!isEvmSignature(input.signature)) {
      throw new UserVenueAccountError(
        "LIMITLESS_PARTNER_ACCOUNT_AUTH_FAILED",
        "Limitless partner account signature is invalid.",
        400
      );
    }
    const linked = await this.withLimitlessPartnerAccountFailureBoundary(() => client.createEoaPartnerAccount({
      account: wallet.address,
      signingMessage: input.message,
      signature: input.signature,
      displayName: `Lotus ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    }));
    if (!equalsAddress(linked.account, wallet.address)) {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_MISMATCH",
        "Limitless partner account response does not match the user's Turnkey EVM wallet.",
        403
      );
    }
    const ensured = await this.ensureAccount({
      userId: input.userId,
      venue: "LIMITLESS",
      venueAccountId: linked.profileId,
      venueAccountAddress: linked.account,
      venueAccountType: "EOA"
    });
    await this.repository.appendAccountAuditEvent({
      userId: input.userId,
      venueAccountBindingId: ensured.account.venueAccountBindingId,
      eventType: "LIMITLESS_PARTNER_ACCOUNT_LINKED",
      payload: {
        venue: "LIMITLESS",
        signer: wallet.address,
        venueAccountAddress: linked.account,
        venueAccountIdPresent: linked.profileId.length > 0
      }
    });
    return ensured;
  }

  public async verifyUserSignedRelayBinding(input: {
    userId: string;
    venue: UserVenueAccountVenue;
    signerAddress?: string | null;
    venueAccountId?: string | null;
    venueAccountAddress?: string | null;
  }): Promise<UserVenueAccount> {
    const venue = normalizeVenue(input.venue);
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(input.userId);
    const account = await this.repository.findAccount({ userId: input.userId, venue });
    if (!account || account.status !== "ACTIVE") {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_INACTIVE",
        `${venue} account is not active for this user.`,
        409
      );
    }
    if (account.userWalletId !== wallet.walletId || !equalsAddress(account.walletAddress, wallet.address)) {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_MISMATCH",
        `${venue} account does not match the user's active Turnkey EVM wallet.`,
        403
      );
    }
    if (input.signerAddress && !equalsAddress(input.signerAddress, wallet.address)) {
      throw new UserVenueAccountError("USER_VENUE_ACCOUNT_MISMATCH", "Signed order signer does not match the user's Turnkey EVM wallet.", 403);
    }
    if (input.venueAccountId && account.venueAccountId && input.venueAccountId !== account.venueAccountId) {
      throw new UserVenueAccountError("USER_VENUE_ACCOUNT_MISMATCH", "Signed order venue account id does not match the linked account.", 403);
    }
    if (input.venueAccountAddress && account.venueAccountAddress && !equalsAddress(input.venueAccountAddress, account.venueAccountAddress)) {
      throw new UserVenueAccountError("USER_VENUE_ACCOUNT_MISMATCH", "Signed order venue account address does not match the linked account.", 403);
    }
    return account;
  }

  private async resolveRequiredTurnkeyEvmWallet(userId: string): Promise<UserWallet> {
    try {
      const wallet = await this.userWalletService.resolveUserTurnkeyEvmFundingWallet(userId);
      if (!wallet || wallet.provider !== "TURNKEY" || wallet.chainFamily !== "EVM" || wallet.status !== "ACTIVE") {
        throw new UserVenueAccountError(
          "USER_VENUE_ACCOUNT_WALLET_REQUIRED",
          "An active Turnkey EVM wallet is required before linking venue accounts.",
          409
        );
      }
      return wallet;
    } catch (error) {
      if (error instanceof UserVenueAccountError) {
        throw error;
      }
      if (error instanceof UserWalletError) {
        throw new UserVenueAccountError("USER_VENUE_ACCOUNT_WALLET_REQUIRED", error.message, error.statusCode);
      }
      throw error;
    }
  }

  private requirePredictFunAccountClient(): PredictFunAccountClient {
    if (!this.predictFunAccountClient?.configured()) {
      throw new UserVenueAccountError(
        "PREDICT_FUN_ACCOUNT_NOT_CONFIGURED",
        "Predict.fun account automation is not configured.",
        503
      );
    }
    return this.predictFunAccountClient;
  }

  private requireLimitlessPartnerAccountClient(): LimitlessPartnerAccountClient {
    if (!this.limitlessPartnerAccountClient?.configured()) {
      throw new UserVenueAccountError(
        "LIMITLESS_PARTNER_ACCOUNT_NOT_CONFIGURED",
        "Limitless partner account automation is not configured.",
        503
      );
    }
    return this.limitlessPartnerAccountClient;
  }

  private async ensurePolymarketDepositWalletAccount(
    userId: string,
    wallet: UserWallet,
    existing: UserVenueAccount | null
  ): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    if (existing?.status === "ACTIVE" && existing.venueAccountAddress) {
      return {
        account: existing,
        readinessBlockers: readinessBlockersForAccount(existing),
        setupInstructions: setupInstructionsForVenue("POLYMARKET", existing)
      };
    }
    if (!this.polymarketDepositWalletClient?.configured()) {
      const pending = await this.repository.upsertAccount({
        ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
        userId,
        venue: "POLYMARKET",
        userWalletId: wallet.walletId,
        walletAddress: wallet.address,
        venueAccountId: existing?.venueAccountId ?? null,
        venueAccountAddress: existing?.venueAccountAddress ?? null,
        venueAccountType: "DEPOSIT_WALLET",
        status: existing?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
        lastVerifiedAt: existing?.lastVerifiedAt ?? null
      });
      await this.repository.appendAccountAuditEvent({
        userId,
        venueAccountBindingId: pending.venueAccountBindingId,
        eventType: existing ? "POLYMARKET_DEPOSIT_WALLET_ENSURE_SKIPPED" : "USER_VENUE_ACCOUNT_ENSURED",
        payload: {
          venue: "POLYMARKET",
          accountType: pending.venueAccountType,
          status: pending.status,
          automationConfigured: false,
          walletAddressMatches: equalsAddress(pending.walletAddress, wallet.address)
        }
      });
      return {
        account: pending,
        readinessBlockers: readinessBlockersForAccount(pending),
        setupInstructions: setupInstructionsForVenue("POLYMARKET", pending)
      };
    }
    let derived: Awaited<ReturnType<PolymarketDepositWalletClient["deriveOrCreateDepositWallet"]>>;
    try {
      derived = await this.polymarketDepositWalletClient.deriveOrCreateDepositWallet({ ownerAddress: wallet.address });
    } catch {
      throw new UserVenueAccountError(
        "POLYMARKET_DEPOSIT_WALLET_FAILED",
        "Polymarket deposit-wallet derivation failed.",
        502
      );
    }
    const account = await this.repository.upsertAccount({
      ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
      userId,
      venue: "POLYMARKET",
      userWalletId: wallet.walletId,
      walletAddress: wallet.address,
      venueAccountId: derived.walletAddress,
      venueAccountAddress: derived.walletAddress,
      venueAccountType: "DEPOSIT_WALLET",
      status: "ACTIVE",
      lastVerifiedAt: new Date().toISOString()
    });
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: "POLYMARKET_DEPOSIT_WALLET_DERIVED",
      payload: {
        venue: "POLYMARKET",
        accountType: account.venueAccountType,
        status: account.status,
        deploymentStatus: derived.deploymentStatus,
        walletAddressMatches: equalsAddress(account.walletAddress, wallet.address)
      }
    });
    return {
      account,
      readinessBlockers: readinessBlockersForAccount(account),
      setupInstructions: setupInstructionsForVenue("POLYMARKET", account)
    };
  }

  private async withPredictAccountFailureBoundary<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new UserVenueAccountError(
        "PREDICT_FUN_ACCOUNT_AUTH_FAILED",
        "Predict.fun account auth request failed.",
        502
      );
    }
  }

  private async withLimitlessPartnerAccountFailureBoundary<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new UserVenueAccountError(
        "LIMITLESS_PARTNER_ACCOUNT_AUTH_FAILED",
        "Limitless partner account request failed.",
        502
      );
    }
  }
}

export const toSafeVenueAccount = (
  account: UserVenueAccount,
  readinessBlockers = readinessBlockersForAccount(account),
  setupInstructions = setupInstructionsForVenue(account.venue, account)
): Record<string, unknown> => ({
  venue: account.venue,
  walletAddress: account.walletAddress,
  venueAccountId: account.venueAccountId,
  venueAccountAddress: account.venueAccountAddress,
  venueAccountType: account.venueAccountType,
  status: account.status,
  readinessBlockers,
  setupInstructions,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
  lastVerifiedAt: account.lastVerifiedAt
});

export const normalizeVenue = (venue: string): UserVenueAccountVenue => {
  const normalized = venue.trim().toUpperCase();
  if (normalized === "OPINION" || normalized === "PREDICT_FUN" || normalized === "LIMITLESS" || normalized === "MYRIAD" || normalized === "POLYMARKET") {
    return normalized;
  }
  throw new UserVenueAccountError("USER_VENUE_ACCOUNT_UNSUPPORTED", `Venue ${venue} does not support user venue account binding.`, 400);
};

const defaultAccountTypeForVenue = (venue: UserVenueAccountVenue): UserVenueAccountType => {
  if (venue === "OPINION") {
    return "SAFE";
  }
  if (venue === "PREDICT_FUN") {
    return "OAUTH_ACCOUNT";
  }
  if (venue === "POLYMARKET") {
    return "DEPOSIT_WALLET";
  }
  return "EOA";
};

const readinessBlockersForAccount = (account: UserVenueAccount): string[] => {
  const blockers: string[] = [];
  if (account.status !== "ACTIVE") {
    blockers.push(`${account.venue} account is not active yet.`);
  }
  if (!account.venueAccountId && !account.venueAccountAddress) {
    blockers.push(`${account.venue} venue account id/address is not linked yet.`);
  }
  return blockers;
};

const setupInstructionsForVenue = (venue: UserVenueAccountVenue, account: UserVenueAccount): string[] => {
  if (account.status === "ACTIVE") {
    return [];
  }
  if (venue === "OPINION") {
    return ["Create or link the Opinion Safe using the displayed Turnkey EVM wallet, then submit the Safe address to Lotus."];
  }
  if (venue === "PREDICT_FUN") {
    return ["Sign the Predict.fun auth message with the displayed Turnkey EVM wallet so Lotus can link the returned Predict smart-wallet address."];
  }
  if (venue === "MYRIAD") {
    return ["Myriad uses wallet-call user-signed actions. Lotus does not create or link a separate Myriad account in the venue-account setup batch."];
  }
  if (venue === "POLYMARKET") {
    return ["Polymarket deposit-wallet automation is not configured. Configure the Polymarket deposit-wallet factory and implementation addresses so Lotus can derive the user's deposit wallet from their Turnkey EVM wallet."];
  }
  if (venue === "LIMITLESS") {
    return ["Limitless partner-account setup is optional and user-signed. If automation is configured, sign the Limitless ownership message with the displayed Turnkey EVM wallet."];
  }
  return [`Link the ${venue} account created from the displayed Turnkey EVM wallet.`];
};

const setupModeForVenue = (
  venue: UserVenueAccountVenue,
  account: UserVenueAccount
): UserVenueAccountSetupBatchItem["setupMode"] => {
  if (account.status === "ACTIVE" || venue === "LIMITLESS") {
    return "NO_USER_SETUP_REQUIRED";
  }
  if (venue === "PREDICT_FUN") {
    return "SIGNATURE_REQUIRED";
  }
  return "MANUAL_LINK_REQUIRED";
};

const batchSetupVenues = ["POLYMARKET", "OPINION", "PREDICT_FUN", "LIMITLESS"] as const satisfies readonly UserVenueAccountVenue[];

const nonEmpty = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const equalsAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

const isEvmSignature = (value: string): boolean =>
  /^0x[a-fA-F0-9]{130}$/.test(value.trim());
