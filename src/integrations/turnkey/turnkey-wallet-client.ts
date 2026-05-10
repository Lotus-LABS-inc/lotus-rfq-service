import {
  defaultEthereumAccountAtIndex,
  defaultSolanaAccountAtIndex,
  Turnkey,
  type TurnkeyApiClient,
  type TurnkeySDKApiTypes
} from "@turnkey/sdk-server";
import type { ProvisionedUserWallet, TurnkeyWalletProvisioner } from "../../core/funding/user-wallets.js";

const LOTUS_WALLET_NAME = "Lotus Wallet";

export interface TurnkeyWalletConfig {
  enabled: boolean;
  apiBaseUrl: string;
  organizationId: string | null;
  apiPublicKey: string | null;
  apiPrivateKey: string | null;
  defaultSolanaWalletEnabled: boolean;
  defaultEvmWalletEnabled: boolean;
}

export const getTurnkeyWalletConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): TurnkeyWalletConfig => ({
  enabled: env.TURNKEY_ENABLED === "true",
  apiBaseUrl: env.TURNKEY_API_BASE_URL?.trim() || "https://api.turnkey.com",
  organizationId: env.TURNKEY_ORGANIZATION_ID?.trim() || null,
  apiPublicKey: env.TURNKEY_API_PUBLIC_KEY?.trim() || null,
  apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY?.trim() || null,
  defaultSolanaWalletEnabled: env.TURNKEY_DEFAULT_SOLANA_WALLET_ENABLED !== "false",
  defaultEvmWalletEnabled: env.TURNKEY_DEFAULT_EVM_WALLET_ENABLED !== "false"
});

export const isTurnkeyWalletConfigReady = (config: TurnkeyWalletConfig): boolean =>
  config.enabled
  && Boolean(config.organizationId)
  && Boolean(config.apiPublicKey)
  && Boolean(config.apiPrivateKey);

export class TurnkeyUserWalletProvisioner implements TurnkeyWalletProvisioner {
  private readonly client: TurnkeyApiClient;

  public constructor(private readonly config: TurnkeyWalletConfig) {
    if (!isTurnkeyWalletConfigReady(config)) {
      throw new Error("Turnkey wallet provisioning requires complete server credentials.");
    }
    this.client = new Turnkey({
      apiBaseUrl: config.apiBaseUrl,
      apiPrivateKey: config.apiPrivateKey!,
      apiPublicKey: config.apiPublicKey!,
      defaultOrganizationId: config.organizationId!
    }).apiClient();
  }

  public async provisionDefaultWallets(input: {
    userId: string;
    email?: string | null;
    turnkeyOrganizationId?: string | null;
    includeSolana: boolean;
    includeEvm: boolean;
  }): Promise<ProvisionedUserWallet[]> {
    const accounts = [
      ...(input.includeSolana ? [defaultSolanaAccountAtIndex(0)] : []),
      ...(input.includeEvm ? [defaultEthereumAccountAtIndex(0)] : [])
    ];
    if (accounts.length === 0) {
      return [];
    }
    const existingOrganizationId = input.turnkeyOrganizationId?.trim();
    if (existingOrganizationId) {
      return this.provisionDefaultWalletsInExistingOrganization({
        organizationId: existingOrganizationId,
        accounts,
        includeSolana: input.includeSolana,
        includeEvm: input.includeEvm
      });
    }

    const response = await this.client.createSubOrganization({
      subOrganizationName: `lotus-user-${input.userId}`,
      rootQuorumThreshold: 1,
      rootUsers: [{
        userName: input.email ?? input.userId,
        ...(input.email ? { userEmail: input.email } : {}),
        apiKeys: [],
        authenticators: [],
        oauthProviders: []
      }],
      wallet: {
        walletName: LOTUS_WALLET_NAME,
        accounts
      }
    } satisfies TurnkeySDKApiTypes.TCreateSubOrganizationBody);

    const subOrganizationId = response.subOrganizationId;
    const walletId = response.wallet?.walletId;
    if (!subOrganizationId || !walletId) {
      throw new Error("Turnkey did not return a sub-organization wallet.");
    }
    const accountResponse = await this.client.getWalletAccounts({
      organizationId: subOrganizationId,
      walletId
    });
    return accountResponse.accounts
      .filter((account) => account.walletId === walletId)
      .map((account) => toProvisionedWallet(subOrganizationId, walletId, account))
      .filter((wallet): wallet is ProvisionedUserWallet => wallet !== null);
  }

  private async provisionDefaultWalletsInExistingOrganization(input: {
    organizationId: string;
    accounts: TurnkeySDKApiTypes.TCreateWalletBody["accounts"];
    includeSolana: boolean;
    includeEvm: boolean;
  }): Promise<ProvisionedUserWallet[]> {
    const walletResponse = await this.client.getWallets({ organizationId: input.organizationId });
    const wallet = walletResponse.wallets.find((entry) => entry.walletName === LOTUS_WALLET_NAME)
      ?? walletResponse.wallets[0];

    const walletId = wallet?.walletId
      ?? (await this.client.createWallet({
        organizationId: input.organizationId,
        walletName: LOTUS_WALLET_NAME,
        accounts: input.accounts
      })).walletId;

    let accountResponse = await this.client.getWalletAccounts({
      organizationId: input.organizationId,
      walletId
    });
    const missingAccounts = input.accounts.filter((requestedAccount) =>
      !accountResponse.accounts.some((account) =>
        account.walletId === walletId
        && account.addressFormat === requestedAccount.addressFormat
        && account.path === requestedAccount.path
      )
    );

    if (wallet && missingAccounts.length > 0) {
      await this.client.createWalletAccounts({
        organizationId: input.organizationId,
        walletId,
        accounts: missingAccounts
      });
      accountResponse = await this.client.getWalletAccounts({
        organizationId: input.organizationId,
        walletId
      });
    }

    return accountResponse.accounts
      .filter((account) => account.walletId === walletId)
      .filter((account) =>
        (input.includeSolana && account.addressFormat === "ADDRESS_FORMAT_SOLANA")
        || (input.includeEvm && account.addressFormat === "ADDRESS_FORMAT_ETHEREUM")
      )
      .map((account) => toProvisionedWallet(input.organizationId, walletId, account))
      .filter((wallet): wallet is ProvisionedUserWallet => wallet !== null);
  }
}

const toProvisionedWallet = (
  organizationId: string,
  walletId: string,
  account: TurnkeySDKApiTypes.TGetWalletAccountsResponse["accounts"][number]
): ProvisionedUserWallet | null => {
  if (account.addressFormat === "ADDRESS_FORMAT_SOLANA") {
    return {
      provider: "TURNKEY",
      providerSubOrgId: organizationId,
      providerWalletId: walletId,
      providerWalletAccountId: account.walletAccountId,
      chainFamily: "SOLANA",
      chain: "SOLANA",
      address: account.address,
      purpose: "DEFAULT_FUNDING",
      exportable: true
    };
  }
  if (account.addressFormat === "ADDRESS_FORMAT_ETHEREUM") {
    return {
      provider: "TURNKEY",
      providerSubOrgId: organizationId,
      providerWalletId: walletId,
      providerWalletAccountId: account.walletAccountId,
      chainFamily: "EVM",
      chain: "EVM",
      address: account.address,
      purpose: "DEFAULT_FUNDING",
      exportable: true
    };
  }
  return null;
};
