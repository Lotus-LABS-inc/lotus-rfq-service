import {
  defaultEthereumAccountAtIndex,
  defaultSolanaAccountAtIndex,
  Turnkey,
  type TurnkeyApiClient,
  type TurnkeySDKApiTypes
} from "@turnkey/sdk-server";
import type { ProvisionedUserWallet, TurnkeyWalletProvisioner } from "../../core/funding/user-wallets.js";

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
      disableEmailRecovery: true,
      disableEmailAuth: true,
      disableOtpEmailAuth: true,
      disableSmsAuth: true,
      wallet: {
        walletName: "Lotus Wallet",
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
      .map((account): ProvisionedUserWallet | null => {
        if (account.addressFormat === "ADDRESS_FORMAT_SOLANA") {
          return {
            provider: "TURNKEY",
            providerSubOrgId: subOrganizationId,
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
            providerSubOrgId: subOrganizationId,
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
      })
      .filter((wallet): wallet is ProvisionedUserWallet => wallet !== null);
  }
}
