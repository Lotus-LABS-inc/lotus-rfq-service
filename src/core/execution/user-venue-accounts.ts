import type { FundingVenue } from "../funding/types.js";
import { UserWalletError, type UserWallet, type UserWalletService } from "../funding/user-wallets.js";

export type UserVenueAccountType = "SAFE" | "SMART_WALLET" | "OAUTH_ACCOUNT" | "EOA" | "PROXY_ACCOUNT" | "DEPOSIT_WALLET" | "SERVER_WALLET";
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

export interface PolymarketClobReadinessConfirmation {
  status: "READY";
  readinessReason: "POLYMARKET_CLOB_COLLATERAL_CONFIRMED";
  readyAmount: string;
  clobCollateralBalance: string;
  clobCollateralAllowance: string;
  clobAllowanceSpenders: Array<{ spenderAddress: string; allowance: string }>;
  ownerAddress: string;
  signerAddress: string;
  confirmedAt: string;
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
  findLatestAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId: string;
    eventType: string;
  }): Promise<{ eventType: string; payload: Record<string, unknown>; createdAt: string } | null>;
}

export interface PredictFunAccountClient {
  configured(): boolean;
  getAuthMessage(): Promise<string>;
  getJwtWithSignature(input: { signer: string; signature: string; message: string }): Promise<string>;
  getConnectedAccount(jwt: string): Promise<{ name: string | null; address: string }>;
}

export interface LimitlessPartnerAccountClient {
  configured(): boolean;
  serverWalletDelegationEnabled?(): boolean;
  eoaPartnerAccountRegistrationEnabled?(): boolean;
  getSigningMessage(): Promise<string>;
  getEoaPartnerAccount?(account: string): Promise<{ profileId: string; account: string } | null>;
  createServerWalletPartnerAccount?(input?: {
    displayName?: string | null;
  }): Promise<{ profileId: string; account: string }>;
  createEoaPartnerAccount(input: {
    account: string;
    signingMessage: string;
    signature: string;
    displayName?: string | null;
  }): Promise<{ profileId: string; account: string }>;
}

export interface PolymarketDepositWalletClient {
  configured(): boolean;
  deriveOrCreateDepositWallet(input: { ownerAddress: string; allowDeploy?: boolean }): Promise<{
    walletAddress: string;
    deploymentStatus: "DERIVED_NOT_DEPLOYED" | "DEPLOY_SUBMITTED" | "DEPLOY_CONFIRMED" | "ALREADY_DEPLOYED";
    relayerTransactionId?: string | undefined;
    relayerState?: string | undefined;
    transactionHash?: string | null | undefined;
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
  venue: "PREDICT_FUN" | "LIMITLESS" | "POLYMARKET" | "OPINION" | "MYRIAD";
  requestType: "PREDICT_FUN_AUTH_MESSAGE" | "LIMITLESS_PARTNER_ACCOUNT_OWNERSHIP_MESSAGE" | "ERC20_ALLOWANCE_APPROVAL";
  signer: string;
  message: string;
  venueAccount: UserVenueAccount;
  transactionRequest?: {
    to: string;
    from: string;
    data: string;
    value: "0";
    chainId: number;
  } | undefined;
  approval?: {
    tokenSymbol: string | null;
    tokenAddress: string;
    spenderAddress: string;
    amount: string;
    amountDisplay: string;
  } | undefined;
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
      | "USER_VENUE_ACCOUNT_INVALID_ADDRESS"
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
  private readonly predictFunJwtByUserId = new Map<string, { jwt: string; cachedAt: number }>();

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

  public getPredictFunJwt(userId: string): string | null {
    const cached = this.predictFunJwtByUserId.get(userId);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > 55 * 60_000) {
      this.predictFunJwtByUserId.delete(userId);
      return null;
    }
    return cached.jwt;
  }

  public async getAccount(userId: string, venue: string): Promise<UserVenueAccount | null> {
    const normalizedVenue = normalizeVenue(venue);
    const account = await this.repository.findAccount({ userId, venue: normalizedVenue });
    if (normalizedVenue !== "PREDICT_FUN" || !account || account.status !== "ACTIVE") {
      return account;
    }
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(userId);
    if (
      account.userWalletId === wallet.walletId &&
      equalsAddress(account.walletAddress, wallet.address) &&
      equalsAddress(account.venueAccountAddress, wallet.address) &&
      account.venueAccountType === "EOA"
    ) {
      return account;
    }
    return (await this.ensureWalletAddressVenueAccount(userId, normalizedVenue, wallet, account)).account;
  }

  public async recordPolymarketBalanceActivation(input: {
    userId: string;
    ownerAddress: string;
    depositWalletAddress: string;
    relayerTransactionId?: string | undefined;
    relayerState?: string | undefined;
    transactionHash?: string | null | undefined;
  }): Promise<void> {
    const account = await this.repository.findAccount({ userId: input.userId, venue: "POLYMARKET" });
    if (!account) {
      return;
    }
    await this.repository.appendAccountAuditEvent({
      userId: input.userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: "POLYMARKET_BALANCE_ACTIVATION_SUBMITTED",
      payload: {
        venue: "POLYMARKET",
        ownerAddressMatches: equalsAddress(account.walletAddress, input.ownerAddress),
        depositWalletMatches: equalsAddress(account.venueAccountAddress, input.depositWalletAddress),
        relayerTransactionId: input.relayerTransactionId ?? null,
        relayerState: input.relayerState ?? null,
        transactionHash: input.transactionHash ?? null,
        transactionHashPresent: Boolean(input.transactionHash),
        executed: input.relayerState === "STATE_EXECUTED" || Boolean(input.transactionHash)
      }
    });
  }

  public async hasExecutedPolymarketBalanceActivation(userId: string): Promise<boolean> {
    const account = await this.repository.findAccount({ userId, venue: "POLYMARKET" });
    if (!account || account.status !== "ACTIVE") {
      return false;
    }
    const event = await this.repository.findLatestAccountAuditEvent({
      userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: "POLYMARKET_BALANCE_ACTIVATION_SUBMITTED"
    });
    return event?.payload.executed === true;
  }

  public async recordPolymarketClobReadinessSync(input: {
    userId: string;
    status: "READY" | "SYNC_PENDING";
    readinessReason: "POLYMARKET_CLOB_COLLATERAL_CONFIRMED" | "POLYMARKET_CLOB_SYNC_PENDING";
    readyAmount: string;
    clobCollateralBalance: string;
    clobCollateralAllowance: string;
    clobAllowanceSpenders: Array<{ spenderAddress: string; allowance: string }>;
    ownerAddress: string;
    signerAddress: string;
  }): Promise<void> {
    if (input.status !== "READY" || input.readinessReason !== "POLYMARKET_CLOB_COLLATERAL_CONFIRMED") {
      return;
    }
    const account = await this.repository.findAccount({ userId: input.userId, venue: "POLYMARKET" });
    if (!account || account.status !== "ACTIVE") {
      return;
    }
    if (!equalsAddress(account.walletAddress, input.signerAddress) || !equalsAddress(account.venueAccountAddress, input.ownerAddress)) {
      return;
    }
    await this.repository.appendAccountAuditEvent({
      userId: input.userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: "POLYMARKET_CLOB_READINESS_SYNC_CONFIRMED",
      payload: {
        venue: "POLYMARKET",
        status: input.status,
        readinessReason: input.readinessReason,
        readyAmount: input.readyAmount,
        clobCollateralBalance: input.clobCollateralBalance,
        clobCollateralAllowance: input.clobCollateralAllowance,
        clobAllowanceSpenders: input.clobAllowanceSpenders.map((spender) => ({
          spenderAddress: spender.spenderAddress,
          allowance: spender.allowance
        })),
        ownerAddress: input.ownerAddress,
        signerAddress: input.signerAddress
      }
    });
  }

  public async getLatestPolymarketClobReadinessConfirmation(
    userId: string
  ): Promise<PolymarketClobReadinessConfirmation | null> {
    const account = await this.repository.findAccount({ userId, venue: "POLYMARKET" });
    if (!account || account.status !== "ACTIVE") {
      return null;
    }
    const event = await this.repository.findLatestAccountAuditEvent({
      userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: "POLYMARKET_CLOB_READINESS_SYNC_CONFIRMED"
    });
    if (!event) {
      return null;
    }
    const payload = event.payload;
    const readyAmount = safeString(payload.readyAmount);
    const clobCollateralBalance = safeString(payload.clobCollateralBalance);
    const clobCollateralAllowance = safeString(payload.clobCollateralAllowance);
    const ownerAddress = safeString(payload.ownerAddress);
    const signerAddress = safeString(payload.signerAddress);
    if (
      payload.status !== "READY" ||
      payload.readinessReason !== "POLYMARKET_CLOB_COLLATERAL_CONFIRMED" ||
      !isPositiveDecimalString(readyAmount) ||
      !isPositiveDecimalString(clobCollateralBalance) ||
      !isPositiveDecimalString(clobCollateralAllowance) ||
      !equalsAddress(account.venueAccountAddress, ownerAddress) ||
      !equalsAddress(account.walletAddress, signerAddress)
    ) {
      return null;
    }
    return {
      status: "READY",
      readinessReason: "POLYMARKET_CLOB_COLLATERAL_CONFIRMED",
      readyAmount,
      clobCollateralBalance,
      clobCollateralAllowance,
      clobAllowanceSpenders: safeClobAllowanceSpenders(payload.clobAllowanceSpenders),
      ownerAddress,
      signerAddress,
      confirmedAt: event.createdAt
    };
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
    if (venue === "LIMITLESS" && !input.venueAccountId && !input.venueAccountAddress && this.limitlessPartnerAccountClient?.serverWalletDelegationEnabled?.() === true) {
      return this.ensureLimitlessServerWalletAccount(input.userId, wallet, existing);
    }
    if (
      venue === "LIMITLESS"
      && !input.venueAccountId
      && !input.venueAccountAddress
      && this.limitlessPartnerAccountClient?.eoaPartnerAccountRegistrationEnabled?.() === true
    ) {
      return this.ensureLimitlessEoaPartnerAccount(input.userId, wallet, existing);
    }
    if (
      venue === "LIMITLESS"
      && !input.venueAccountId
      && !input.venueAccountAddress
      && this.limitlessPartnerAccountClient?.eoaPartnerAccountRegistrationEnabled?.() !== true
    ) {
      return this.ensureWalletAddressVenueAccount(input.userId, venue, wallet, existing, "EOA");
    }
    if ((venue === "MYRIAD" || venue === "PREDICT_FUN") && !input.venueAccountId && !input.venueAccountAddress) {
      return this.ensureWalletAddressVenueAccount(input.userId, venue, wallet, existing);
    }
    if (venue === "OPINION") {
      return this.ensureOpinionSafeAccount(input.userId, wallet, existing, {
        venueAccountId: input.venueAccountId ?? null,
        venueAccountAddress: input.venueAccountAddress ?? null,
        venueAccountType: input.venueAccountType ?? null,
        eventType: existing ? "USER_VENUE_ACCOUNT_UPDATED" : "USER_VENUE_ACCOUNT_ENSURED"
      });
    }
    const venueAccountType = input.venueAccountType ?? existing?.venueAccountType ?? defaultAccountTypeForVenue(venue);
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

  public async completeOpinionAccountLink(input: {
    userId: string;
    venueAccountAddress: string;
    venueAccountId?: string | null;
  }): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    const wallet = await this.resolveRequiredTurnkeyEvmWallet(input.userId);
    const existing = await this.repository.findAccount({ userId: input.userId, venue: "OPINION" });
    return this.ensureOpinionSafeAccount(input.userId, wallet, existing, {
      venueAccountId: input.venueAccountId ?? null,
      venueAccountAddress: input.venueAccountAddress,
      venueAccountType: "SAFE",
      eventType: "OPINION_ACCOUNT_LINKED"
    });
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
    const maybeAddApproval = async (venue: UserVenueAccountVenue, account: UserVenueAccount): Promise<void> => {
      const approval = buildSetupApprovalRequest(venue, account, process.env);
      if (!approval) {
        return;
      }
      signatureRequests.push(approval);
      await this.repository.appendAccountAuditEvent({
        userId,
        venueAccountBindingId: account.venueAccountBindingId,
        eventType: "USER_VENUE_ACCOUNT_SETUP_APPROVAL_REQUEST_CREATED",
        payload: {
          venue,
          signer: approval.signer,
          tokenSymbol: approval.approval?.tokenSymbol ?? null,
          tokenAddress: approval.approval?.tokenAddress,
          spenderAddress: approval.approval?.spenderAddress,
          amountDisplay: approval.approval?.amountDisplay
        }
      });
    };

    for (const venue of batchSetupVenues) {
      if (venue === "PREDICT_FUN") {
        const ensured = await this.ensureAccount({ userId, venue: "PREDICT_FUN" });
        await maybeAddApproval(venue, ensured.account);
        if (ensured.account.status === "ACTIVE" && this.getPredictFunJwt(userId)) {
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
            setupInstructions: ensured.account.status === "ACTIVE"
              ? ["Sign the Predict.fun authentication message to refresh the short-lived live-submit token."]
              : ensured.setupInstructions,
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
        await maybeAddApproval(venue, ensured.account);
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
        if (this.limitlessPartnerAccountClient?.serverWalletDelegationEnabled?.() === true) {
          venueAccounts.push({
            venue,
            account: ensured.account,
            readinessBlockers: ensured.readinessBlockers,
            setupInstructions: ensured.setupInstructions,
            setupMode: "NO_USER_SETUP_REQUIRED"
          });
          continue;
        }
        if (
          this.limitlessPartnerAccountClient?.eoaPartnerAccountRegistrationEnabled?.() === true
          && this.limitlessPartnerAccountClient.configured()
        ) {
          const wallet = await this.resolveRequiredTurnkeyEvmWallet(userId);
          const message = await this.prepareLimitlessPartnerSigningMessage({
            userId,
            signer: wallet.address,
            venueAccountBindingId: ensured.account.venueAccountBindingId
          });
          if (!message) {
            venueAccounts.push({
              venue,
              account: ensured.account,
              readinessBlockers: [
                ...ensured.readinessBlockers,
                "LIMITLESS_PARTNER_ACCOUNT_REQUEST_FAILED"
              ],
              setupInstructions: ["Limitless partner account setup is temporarily unavailable. Lotus will retry this venue setup; other venues remain usable."],
              setupMode: "MANUAL_LINK_REQUIRED"
            });
            continue;
          }
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
      await maybeAddApproval(venue, ensured.account);
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
    this.predictFunJwtByUserId.set(input.userId, { jwt, cachedAt: Date.now() });
    const connectedAccount = await this.withPredictAccountFailureBoundary(() => client.getConnectedAccount(jwt));
    const ensured = await this.ensureAccount({
      userId: input.userId,
      venue: "PREDICT_FUN",
      venueAccountId: connectedAccount.name ?? wallet.address,
      venueAccountAddress: wallet.address,
      venueAccountType: "EOA"
    });
    await this.repository.appendAccountAuditEvent({
      userId: input.userId,
      venueAccountBindingId: ensured.account.venueAccountBindingId,
      eventType: "PREDICT_FUN_ACCOUNT_LINKED",
      payload: {
        venue: "PREDICT_FUN",
        signer: wallet.address,
        venueAccountAddress: wallet.address,
        connectedAccountAddress: connectedAccount.address,
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
    const linked = await this.createOrRecoverLimitlessPartnerAccount({
      userId: input.userId,
      walletAddress: wallet.address,
      signingMessage: input.message,
      signature: input.signature,
      client
    });
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

  private async ensureOpinionSafeAccount(
    userId: string,
    wallet: UserWallet,
    existing: UserVenueAccount | null,
    input: {
      venueAccountId?: string | null;
      venueAccountAddress?: string | null;
      venueAccountType?: UserVenueAccountType | null;
      eventType: string;
    }
  ): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    if (input.venueAccountType && input.venueAccountType !== "SAFE") {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_MISMATCH",
        "Opinion account links must use an Opinion Safe account.",
        400
      );
    }
    const providedAddress = nonEmpty(input.venueAccountAddress);
    if (providedAddress && !isEvmAddress(providedAddress)) {
      throw new UserVenueAccountError(
        "USER_VENUE_ACCOUNT_INVALID_ADDRESS",
        "Opinion Safe address must be a valid EVM address.",
        400
      );
    }
    const venueAccountAddress = providedAddress ?? existing?.venueAccountAddress ?? null;
    const venueAccountId = nonEmpty(input.venueAccountId) ?? existing?.venueAccountId ?? null;
    const hasValidSafeAddress = Boolean(venueAccountAddress && isEvmAddress(venueAccountAddress));
    const account = await this.repository.upsertAccount({
      ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
      userId,
      venue: "OPINION",
      userWalletId: wallet.walletId,
      walletAddress: wallet.address,
      venueAccountId,
      venueAccountAddress,
      venueAccountType: "SAFE",
      status: hasValidSafeAddress ? "ACTIVE" : "PENDING",
      lastVerifiedAt: hasValidSafeAddress ? new Date().toISOString() : existing?.lastVerifiedAt ?? null
    });
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: input.eventType,
      payload: {
        venue: "OPINION",
        accountType: "SAFE",
        status: account.status,
        venueAccountAddress: account.venueAccountAddress,
        venueAccountIdPresent: Boolean(account.venueAccountId),
        walletAddressMatches: equalsAddress(account.walletAddress, wallet.address)
      }
    });
    return {
      account,
      readinessBlockers: readinessBlockersForAccount(account),
      setupInstructions: setupInstructionsForVenue("OPINION", account)
    };
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
    if (existing?.status === "ACTIVE" && existing.venueAccountAddress && !this.polymarketDepositWalletClient?.configured()) {
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
      derived = await this.polymarketDepositWalletClient.deriveOrCreateDepositWallet({
        ownerAddress: wallet.address,
        allowDeploy: existing?.status !== "ACTIVE"
      });
    } catch {
      throw new UserVenueAccountError(
        "POLYMARKET_DEPOSIT_WALLET_FAILED",
        "Polymarket deposit-wallet derivation failed.",
        502
      );
    }
    const deploymentReady = isPolymarketDepositWalletDeploymentReady(derived.deploymentStatus);
    const account = await this.repository.upsertAccount({
      ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
      userId,
      venue: "POLYMARKET",
      userWalletId: wallet.walletId,
      walletAddress: wallet.address,
      venueAccountId: derived.walletAddress,
      venueAccountAddress: derived.walletAddress,
      venueAccountType: "DEPOSIT_WALLET",
      status: deploymentReady ? "ACTIVE" : "PENDING",
      lastVerifiedAt: deploymentReady ? new Date().toISOString() : null
    });
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: deploymentReady ? "POLYMARKET_DEPOSIT_WALLET_READY" : "POLYMARKET_DEPOSIT_WALLET_PENDING",
      payload: {
        venue: "POLYMARKET",
        accountType: account.venueAccountType,
        status: account.status,
        deploymentStatus: derived.deploymentStatus,
        relayerTransactionPresent: Boolean(derived.relayerTransactionId),
        transactionHashPresent: Boolean(derived.transactionHash),
        relayerTransactionId: derived.relayerTransactionId ?? null,
        relayerState: derived.relayerState ?? null,
        transactionHash: derived.transactionHash ?? null,
        walletAddressMatches: equalsAddress(account.walletAddress, wallet.address)
      }
    });
    return {
      account,
      readinessBlockers: readinessBlockersForAccount(account),
      setupInstructions: setupInstructionsForVenue("POLYMARKET", account)
    };
  }

  private async ensureLimitlessServerWalletAccount(
    userId: string,
    wallet: UserWallet,
    existing: UserVenueAccount | null
  ): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    if (existing?.status === "ACTIVE" && existing.venueAccountType === "SERVER_WALLET" && existing.venueAccountId && existing.venueAccountAddress) {
      return {
        account: existing,
        readinessBlockers: [],
        setupInstructions: []
      };
    }
    if (!this.limitlessPartnerAccountClient?.configured() || !this.limitlessPartnerAccountClient.createServerWalletPartnerAccount) {
      const pending = await this.repository.upsertAccount({
        ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
        userId,
        venue: "LIMITLESS",
        userWalletId: wallet.walletId,
        walletAddress: wallet.address,
        venueAccountId: existing?.venueAccountId ?? null,
        venueAccountAddress: existing?.venueAccountAddress ?? null,
        venueAccountType: "SERVER_WALLET",
        status: existing?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
        lastVerifiedAt: existing?.lastVerifiedAt ?? null
      });
      await this.repository.appendAccountAuditEvent({
        userId,
        venueAccountBindingId: pending.venueAccountBindingId,
        eventType: "LIMITLESS_SERVER_WALLET_ENSURE_SKIPPED",
        payload: {
          venue: "LIMITLESS",
          accountType: pending.venueAccountType,
          status: pending.status,
          automationConfigured: false,
          walletAddressMatches: equalsAddress(pending.walletAddress, wallet.address)
        }
      });
      return {
        account: pending,
        readinessBlockers: readinessBlockersForAccount(pending),
        setupInstructions: setupInstructionsForVenue("LIMITLESS", pending)
      };
    }
    let linked: { profileId: string; account: string };
    try {
      linked = await this.limitlessPartnerAccountClient.createServerWalletPartnerAccount({
        displayName: `Lotus ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      });
    } catch {
      const pending = await this.repository.upsertAccount({
        ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
        userId,
        venue: "LIMITLESS",
        userWalletId: wallet.walletId,
        walletAddress: wallet.address,
        venueAccountId: existing?.venueAccountId ?? null,
        venueAccountAddress: existing?.venueAccountAddress ?? null,
        venueAccountType: "SERVER_WALLET",
        status: "PENDING",
        lastVerifiedAt: existing?.lastVerifiedAt ?? null
      });
      await this.repository.appendAccountAuditEvent({
        userId,
        venueAccountBindingId: pending.venueAccountBindingId,
        eventType: "LIMITLESS_SERVER_WALLET_ENSURE_FAILED",
        payload: {
          venue: "LIMITLESS",
          accountType: "SERVER_WALLET",
          status: pending.status,
          automationConfigured: true,
          walletAddressMatches: equalsAddress(pending.walletAddress, wallet.address)
        }
      });
      return {
        account: pending,
        readinessBlockers: [
          ...readinessBlockersForAccount(pending),
          "Limitless delegated server-wallet account request failed. Check partner HMAC scopes and retry account setup."
        ],
        setupInstructions: setupInstructionsForVenue("LIMITLESS", pending)
      };
    }
    const ensured = await this.ensureAccount({
      userId,
      venue: "LIMITLESS",
      venueAccountId: linked.profileId,
      venueAccountAddress: linked.account,
      venueAccountType: "SERVER_WALLET"
    });
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: ensured.account.venueAccountBindingId,
      eventType: "LIMITLESS_SERVER_WALLET_LINKED",
      payload: {
        venue: "LIMITLESS",
        accountType: "SERVER_WALLET",
        venueAccountAddress: linked.account,
        venueAccountIdPresent: linked.profileId.length > 0,
        ownerWalletAddress: wallet.address
      }
    });
    return ensured;
  }

  private async ensureLimitlessEoaPartnerAccount(
    userId: string,
    wallet: UserWallet,
    existing: UserVenueAccount | null
  ): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    const existingProfileId = nonEmpty(existing?.venueAccountId);
    if (
      existing?.status === "ACTIVE" &&
      existing.venueAccountType === "EOA" &&
      equalsAddress(existing.walletAddress, wallet.address) &&
      equalsAddress(existing.venueAccountAddress, wallet.address) &&
      isPositiveIntegerString(existingProfileId)
    ) {
      return {
        account: existing,
        readinessBlockers: readinessBlockersForAccount(existing),
        setupInstructions: setupInstructionsForVenue("LIMITLESS", existing)
      };
    }

    if (this.limitlessPartnerAccountClient?.configured() && this.limitlessPartnerAccountClient.getEoaPartnerAccount) {
      try {
        const linked = await this.limitlessPartnerAccountClient.getEoaPartnerAccount(wallet.address);
        if (linked && equalsAddress(linked.account, wallet.address) && isPositiveIntegerString(linked.profileId)) {
          const ensured = await this.ensureAccount({
            userId,
            venue: "LIMITLESS",
            venueAccountId: linked.profileId,
            venueAccountAddress: linked.account,
            venueAccountType: "EOA"
          });
          await this.repository.appendAccountAuditEvent({
            userId,
            venueAccountBindingId: ensured.account.venueAccountBindingId,
            eventType: "LIMITLESS_PARTNER_ACCOUNT_DISCOVERED",
            payload: {
              venue: "LIMITLESS",
              accountType: "EOA",
              venueAccountAddress: linked.account,
              profileIdPresent: true,
              ownerWalletAddress: wallet.address
            }
          });
          return ensured;
        }
      } catch {
        await this.repository.appendAccountAuditEvent({
          userId,
          venueAccountBindingId: existing?.venueAccountBindingId ?? null,
          eventType: "LIMITLESS_PARTNER_ACCOUNT_DISCOVERY_FAILED",
          payload: {
            venue: "LIMITLESS",
            accountType: "EOA",
            ownerWalletAddress: wallet.address
          }
        });
      }
    }

    const pending = await this.repository.upsertAccount({
      ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
      userId,
      venue: "LIMITLESS",
      userWalletId: wallet.walletId,
      walletAddress: wallet.address,
      venueAccountId: isPositiveIntegerString(existingProfileId) ? existingProfileId : null,
      venueAccountAddress: wallet.address,
      venueAccountType: "EOA",
      status: isPositiveIntegerString(existingProfileId) ? "ACTIVE" : "PENDING",
      lastVerifiedAt: isPositiveIntegerString(existingProfileId) ? existing?.lastVerifiedAt ?? new Date().toISOString() : null
    });
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: pending.venueAccountBindingId,
      eventType: "LIMITLESS_EOA_PARTNER_ACCOUNT_SETUP_REQUIRED",
      payload: {
        venue: "LIMITLESS",
        accountType: "EOA",
        status: pending.status,
        profileIdPresent: isPositiveIntegerString(pending.venueAccountId),
        walletAddressMatches: equalsAddress(pending.walletAddress, wallet.address)
      }
    });
    return {
      account: pending,
      readinessBlockers: readinessBlockersForAccount(pending),
      setupInstructions: setupInstructionsForVenue("LIMITLESS", pending)
    };
  }

  private async ensureWalletAddressVenueAccount(
    userId: string,
    venue: UserVenueAccountVenue,
    wallet: UserWallet,
    existing: UserVenueAccount | null,
    venueAccountType: UserVenueAccountType = defaultAccountTypeForVenue(venue)
  ): Promise<{
    account: UserVenueAccount;
    readinessBlockers: string[];
    setupInstructions: string[];
  }> {
    const account = await this.repository.upsertAccount({
      ...(existing?.venueAccountBindingId ? { venueAccountBindingId: existing.venueAccountBindingId } : {}),
      userId,
      venue,
      userWalletId: wallet.walletId,
      walletAddress: wallet.address,
      venueAccountId: wallet.address,
      venueAccountAddress: wallet.address,
      venueAccountType,
      status: "ACTIVE",
      lastVerifiedAt: new Date().toISOString()
    });
    await this.repository.appendAccountAuditEvent({
      userId,
      venueAccountBindingId: account.venueAccountBindingId,
      eventType: existing ? "USER_VENUE_ACCOUNT_UPDATED" : "USER_VENUE_ACCOUNT_ENSURED",
      payload: {
        venue,
        accountType: account.venueAccountType,
        status: account.status,
        accountSource: "TURNKEY_EVM_WALLET_ADDRESS",
        walletAddressMatches: equalsAddress(account.walletAddress, wallet.address)
      }
    });
    return {
      account,
      readinessBlockers: readinessBlockersForAccount(account),
      setupInstructions: setupInstructionsForVenue(venue, account)
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

  private async prepareLimitlessPartnerSigningMessage(input: {
    userId: string;
    signer: string;
    venueAccountBindingId: string;
  }): Promise<string | null> {
    try {
      return await this.limitlessPartnerAccountClient!.getSigningMessage();
    } catch (error) {
      await this.repository.appendAccountAuditEvent({
        userId: input.userId,
        venueAccountBindingId: input.venueAccountBindingId,
        eventType: "LIMITLESS_PARTNER_ACCOUNT_SIGNING_MESSAGE_FAILED",
        payload: {
          venue: "LIMITLESS",
          signer: input.signer,
          source: "BATCH_SETUP",
          failure: safeLimitlessPartnerAccountFailureCode(error)
        }
      });
      return null;
    }
  }

  private async createOrRecoverLimitlessPartnerAccount(input: {
    userId: string;
    walletAddress: string;
    signingMessage: string;
    signature: string;
    client: LimitlessPartnerAccountClient;
  }): Promise<{ profileId: string; account: string }> {
    try {
      return await input.client.createEoaPartnerAccount({
        account: input.walletAddress,
        signingMessage: input.signingMessage,
        signature: input.signature,
        displayName: `Lotus ${input.walletAddress.slice(0, 6)}...${input.walletAddress.slice(-4)}`
      });
    } catch (error) {
      const discovered = await this.tryDiscoverLimitlessPartnerAccount(input.client, input.walletAddress);
      if (discovered) {
        await this.repository.appendAccountAuditEvent({
          userId: input.userId,
          venueAccountBindingId: null,
          eventType: "LIMITLESS_PARTNER_ACCOUNT_CREATE_RECOVERED_BY_DISCOVERY",
          payload: {
            venue: "LIMITLESS",
            signer: input.walletAddress,
            venueAccountAddress: discovered.account,
            profileIdPresent: discovered.profileId.length > 0,
            failure: safeLimitlessPartnerAccountFailureCode(error)
          }
        });
        return discovered;
      }
      await this.repository.appendAccountAuditEvent({
        userId: input.userId,
        venueAccountBindingId: null,
        eventType: "LIMITLESS_PARTNER_ACCOUNT_CREATE_FAILED",
        payload: {
          venue: "LIMITLESS",
          signer: input.walletAddress,
          source: "BATCH_COMPLETE",
          ...safeLimitlessPartnerAccountFailureDetails(error)
        }
      });
      throw new UserVenueAccountError(
        "LIMITLESS_PARTNER_ACCOUNT_AUTH_FAILED",
        safeLimitlessPartnerAccountFailureMessage(error),
        502
      );
    }
  }

  private async tryDiscoverLimitlessPartnerAccount(
    client: LimitlessPartnerAccountClient,
    walletAddress: string
  ): Promise<{ profileId: string; account: string } | null> {
    if (!client.getEoaPartnerAccount) {
      return null;
    }
    try {
      const linked = await client.getEoaPartnerAccount(walletAddress);
      if (linked && equalsAddress(linked.account, walletAddress) && isPositiveIntegerString(linked.profileId)) {
        return linked;
      }
    } catch {
      return null;
    }
    return null;
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
    return "EOA";
  }
  if (venue === "POLYMARKET") {
    return "DEPOSIT_WALLET";
  }
  if (venue === "LIMITLESS") {
    return "EOA";
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
  if (account.venue === "LIMITLESS" && account.venueAccountType === "EOA" && !isPositiveIntegerString(account.venueAccountId)) {
    blockers.push("Limitless trading requires a linked Limitless profile id before live relay.");
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
    return ["Sign the Predict.fun auth message with the displayed Turnkey EVM wallet so Lotus can refresh the venue JWT for the active wallet."];
  }
  if (venue === "MYRIAD") {
    return ["Myriad uses wallet-call user-signed actions. Lotus does not create or link a separate Myriad account in the venue-account setup batch."];
  }
  if (venue === "POLYMARKET") {
    if (account.venueAccountAddress) {
      return ["Polymarket deposit-wallet deployment has been requested or derived, but it is not confirmed active yet. Retry account setup after relayer confirmation before funding or trading."];
    }
    return ["Polymarket deposit-wallet automation is not configured. Configure the Polymarket relayer, builder credentials, factory, and implementation addresses so Lotus can deploy the user's deposit wallet from their Turnkey EVM owner address."];
  }
  if (venue === "LIMITLESS") {
    if (account.venueAccountType === "EOA") {
      return ["Sign the Limitless ownership message with your Turnkey EVM wallet so Lotus can link the Limitless profile required for live relay."];
    }
    return ["Limitless delegated server-wallet automation is not configured or has not completed. Configure the partner HMAC account-creation/delegated-signing credentials, then retry account setup."];
  }
  return [`Link the ${venue} account created from the displayed Turnkey EVM wallet.`];
};

const setupModeForVenue = (
  venue: UserVenueAccountVenue,
  account: UserVenueAccount
): UserVenueAccountSetupBatchItem["setupMode"] => {
  if (account.status === "ACTIVE" || venue === "LIMITLESS" || venue === "POLYMARKET") {
    return "NO_USER_SETUP_REQUIRED";
  }
  if (venue === "PREDICT_FUN") {
    return "SIGNATURE_REQUIRED";
  }
  return "MANUAL_LINK_REQUIRED";
};

const batchSetupVenues = ["POLYMARKET", "OPINION", "PREDICT_FUN", "LIMITLESS", "MYRIAD"] as const satisfies readonly UserVenueAccountVenue[];

const nonEmpty = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const equalsAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

const safeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const isPositiveDecimalString = (value: string | null | undefined): boolean => {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const safeClobAllowanceSpenders = (value: unknown): Array<{ spenderAddress: string; allowance: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const spenderAddress = safeString(record.spenderAddress);
    const allowance = safeString(record.allowance);
    if (!isEvmAddress(spenderAddress) || !/^\d+(?:\.\d+)?$/.test(allowance)) {
      return [];
    }
    return [{ spenderAddress, allowance }];
  });
};

const isEvmSignature = (value: string): boolean =>
  /^0x[a-fA-F0-9]{130}$/.test(value.trim());

const isEvmAddress = (value: string): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const safeLimitlessPartnerAccountFailureCode = (error: unknown): string => {
  const reasonCode = readErrorStringField(error, "reasonCode");
  if (reasonCode) {
    return reasonCode.slice(0, 80);
  }
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name.slice(0, 80);
  }
  return "LIMITLESS_PARTNER_ACCOUNT_REQUEST_FAILED";
};

const safeLimitlessPartnerAccountFailureMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.includes("timed out")) {
    return "Limitless partner account request timed out. Try again shortly; other venues remain usable.";
  }
  const statusCode = readErrorNumberField(error, "statusCode");
  if (statusCode === 401 || statusCode === 403) {
    return "Limitless partner account credentials were rejected. Other venues remain usable while the operator checks the Limitless account-creation scope.";
  }
  return "Limitless partner account request failed. Try again shortly; other venues remain usable.";
};

const safeLimitlessPartnerAccountFailureDetails = (error: unknown): Record<string, unknown> => {
  const statusCode = readErrorNumberField(error, "statusCode");
  const reasonCode = readErrorStringField(error, "reasonCode");
  const providerMessage = error instanceof Error && error.message.trim().length > 0
    ? error.message.trim().slice(0, 240)
    : null;
  return {
    failure: safeLimitlessPartnerAccountFailureCode(error),
    ...(statusCode ? { statusCode } : {}),
    ...(reasonCode ? { reasonCode: reasonCode.slice(0, 80) } : {}),
    ...(providerMessage ? { providerMessage } : {})
  };
};

const readErrorStringField = (error: unknown, field: string): string | null => {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readErrorNumberField = (error: unknown, field: string): number | null => {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const defaultSetupApprovalAmount = "100000";

const envValue = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
};

const parsePositiveInt = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isPositiveIntegerString = (value: string | null | undefined): boolean =>
  typeof value === "string" && /^[1-9]\d*$/.test(value.trim());

const decimalToBaseUnits = (amount: string, decimals: number): string => {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  const normalizedWhole = whole.replace(/[^\d]/g, "") || "0";
  const normalizedFraction = fraction.replace(/[^\d]/g, "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0").toString();
};

const encodeErc20Approve = (spender: string, amount: string): string => {
  const cleanSpender = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const cleanAmount = BigInt(amount).toString(16).padStart(64, "0");
  return `0x095ea7b3${cleanSpender}${cleanAmount}`;
};

const buildSetupApprovalRequest = (
  venue: UserVenueAccountVenue,
  account: UserVenueAccount,
  env: NodeJS.ProcessEnv
): UserVenueAccountSignatureRequest | null => {
  const mode = envValue(env, `${venue}_BALANCE_ACTIVATION_MODE`)?.toUpperCase();
  const tokenAddress = envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_ADDRESS`) ??
    (venue === "PREDICT_FUN" ? "0x55d398326f99059fF775485246999027B3197955" : null);
  const spenderAddress = envValue(env, `${venue}_BALANCE_ACTIVATION_SPENDER_ADDRESS`);
  const chainId = parsePositiveInt(envValue(env, `${venue}_BALANCE_ACTIVATION_CHAIN_ID`)) ??
    (venue === "PREDICT_FUN" ? 56 : null);
  const tokenSymbol = envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_SYMBOL`) ??
    (venue === "PREDICT_FUN" ? "USDT" : null);
  const decimals = parsePositiveInt(envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_DECIMALS`)) ?? 18;
  const amountDisplay = envValue(env, `${venue}_SETUP_APPROVAL_AMOUNT`)
    ?? envValue(env, "VENUE_SETUP_APPROVAL_AMOUNT")
    ?? defaultSetupApprovalAmount;
  const shouldBuild = mode === "ERC20_APPROVAL" ||
    (venue === "PREDICT_FUN" && tokenAddress !== null && spenderAddress !== null && chainId !== null);
  if (!shouldBuild || account.status !== "ACTIVE") {
    return null;
  }
  if (!tokenAddress || !spenderAddress || !chainId || !isEvmAddress(tokenAddress) || !isEvmAddress(spenderAddress)) {
    return null;
  }
  if (!isEvmAddress(account.walletAddress) || !equalsAddress(account.walletAddress, account.venueAccountAddress ?? account.walletAddress)) {
    return null;
  }
  const amount = decimalToBaseUnits(amountDisplay, decimals);
  return {
    venue,
    requestType: "ERC20_ALLOWANCE_APPROVAL",
    signer: account.walletAddress,
    message: `Approve ${amountDisplay} ${tokenSymbol ?? "venue collateral"} for ${venue}`,
    venueAccount: account,
    transactionRequest: {
      to: tokenAddress,
      from: account.walletAddress,
      data: encodeErc20Approve(spenderAddress, amount),
      value: "0",
      chainId
    },
    approval: {
      tokenSymbol,
      tokenAddress,
      spenderAddress,
      amount,
      amountDisplay
    }
  };
};

const isPolymarketDepositWalletDeploymentReady = (
  status: Awaited<ReturnType<PolymarketDepositWalletClient["deriveOrCreateDepositWallet"]>>["deploymentStatus"]
): boolean => status === "ALREADY_DEPLOYED" || status === "DEPLOY_CONFIRMED";
