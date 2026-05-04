import {
  buildDepositWalletCreateRequest,
  deriveDepositWallet,
  RelayClient,
  TransactionType,
  type DepositWalletCreateRequest
} from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";

export interface PolymarketDepositWalletClientConfig {
  enabled: boolean;
  relayerUrl: string | null;
  chainId: number;
  factoryAddress: string | null;
  implementationAddress: string | null;
  builderApiKey: string | null;
  builderApiSecret: string | null;
  builderApiPassphrase: string | null;
  deployEnabled: boolean;
}

export interface PolymarketDerivedDepositWallet {
  walletAddress: string;
  deploymentStatus: "DERIVED_NOT_DEPLOYED" | "DEPLOY_SUBMITTED" | "DEPLOY_CONFIRMED" | "ALREADY_DEPLOYED";
  relayerTransactionId?: string | undefined;
  relayerState?: string | undefined;
  transactionHash?: string | null | undefined;
}

export const buildPolymarketDepositWalletClientConfigFromEnv = (
  env: NodeJS.ProcessEnv
): PolymarketDepositWalletClientConfig => ({
  enabled: env.POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED === "true",
  relayerUrl: nonEmpty(env.POLYMARKET_RELAYER_URL) ?? nonEmpty(env.POLYMARKET_RELAYER_HOST) ?? nonEmpty(env.POLY_RELAYER_HOST),
  chainId: parseChainId(env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID),
  factoryAddress: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_FACTORY_ADDRESS) ?? defaultFactoryAddress(env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID),
  implementationAddress: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_IMPLEMENTATION_ADDRESS) ?? defaultImplementationAddress(env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID),
  builderApiKey: nonEmpty(env.POLYMARKET_BUILDER_API_KEY) ?? nonEmpty(env.BUILDER_API_KEY),
  builderApiSecret: nonEmpty(env.POLYMARKET_BUILDER_API_SECRET) ?? nonEmpty(env.BUILDER_SECRET),
  builderApiPassphrase: nonEmpty(env.POLYMARKET_BUILDER_API_PASSPHRASE) ?? nonEmpty(env.BUILDER_PASS_PHRASE),
  deployEnabled: env.POLYMARKET_DEPOSIT_WALLET_DEPLOY_ENABLED !== "false"
});

export class PolymarketDepositWalletClient {
  public constructor(private readonly config: PolymarketDepositWalletClientConfig) {}

  public configured(): boolean {
    return this.config.enabled && isEvmAddress(this.config.factoryAddress) && isEvmAddress(this.config.implementationAddress);
  }

  public async deriveOrCreateDepositWallet(input: { ownerAddress: string }): Promise<PolymarketDerivedDepositWallet> {
    if (!this.configured()) {
      throw new Error("Polymarket deposit-wallet automation is not configured.");
    }
    if (!isEvmAddress(input.ownerAddress)) {
      throw new Error("Polymarket deposit-wallet owner address is invalid.");
    }
    const walletAddress = deriveDepositWallet(
      input.ownerAddress,
      this.config.factoryAddress!,
      this.config.implementationAddress!
    );
    if (!isEvmAddress(walletAddress)) {
      throw new Error("Polymarket deposit-wallet derivation returned an invalid address.");
    }
    if (!this.deploymentConfigured()) {
      return {
        walletAddress,
        deploymentStatus: "DERIVED_NOT_DEPLOYED"
      };
    }
    const relayer = this.buildRelayerClient();
    const deployed = await relayer.getDeployed(walletAddress, TransactionType.WALLET_CREATE);
    if (deployed) {
      return {
        walletAddress,
        deploymentStatus: "ALREADY_DEPLOYED"
      };
    }
    if (!this.config.deployEnabled) {
      return {
        walletAddress,
        deploymentStatus: "DERIVED_NOT_DEPLOYED"
      };
    }
    const request = buildDepositWalletCreateRequest(input.ownerAddress, {
      DepositWalletFactory: this.config.factoryAddress!,
      DepositWalletImplementation: this.config.implementationAddress!
    });
    const response = await submitDepositWalletCreate(relayer, request);
    const state = typeof response.state === "string" ? response.state : undefined;
    return {
      walletAddress,
      deploymentStatus: isConfirmedRelayerState(state) ? "DEPLOY_CONFIRMED" : "DEPLOY_SUBMITTED",
      relayerTransactionId: typeof response.transactionID === "string" ? response.transactionID : undefined,
      relayerState: state,
      transactionHash: typeof response.transactionHash === "string"
        ? response.transactionHash
        : typeof response.hash === "string"
          ? response.hash
          : null
    };
  }

  private deploymentConfigured(): boolean {
    return Boolean(
      nonEmpty(this.config.relayerUrl ?? undefined) &&
      nonEmpty(this.config.builderApiKey ?? undefined) &&
      nonEmpty(this.config.builderApiSecret ?? undefined) &&
      nonEmpty(this.config.builderApiPassphrase ?? undefined)
    );
  }

  private buildRelayerClient(): RelayClient {
    return new RelayClient(
      this.config.relayerUrl!,
      this.config.chainId,
      undefined,
      new BuilderConfig({
        localBuilderCreds: {
          key: this.config.builderApiKey!,
          secret: this.config.builderApiSecret!,
          passphrase: this.config.builderApiPassphrase!
        }
      })
    );
  }
}

interface RelayerSubmitResponse {
  transactionID?: unknown;
  state?: unknown;
  hash?: unknown;
  transactionHash?: unknown;
}

const submitDepositWalletCreate = async (
  relayer: RelayClient,
  request: DepositWalletCreateRequest
): Promise<RelayerSubmitResponse> => {
  const submitter = relayer as unknown as {
    sendAuthedRequest(method: "POST", path: "/submit", body: string): Promise<RelayerSubmitResponse>;
  };
  return submitter.sendAuthedRequest("POST", "/submit", JSON.stringify(request));
};

const isConfirmedRelayerState = (state: string | undefined): boolean =>
  state === "STATE_CONFIRMED" ||
  state === "STATE_MINED" ||
  state === "STATE_EXECUTED";

const parseChainId = (value: string | undefined): number => {
  const parsed = Number(value ?? "137");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 137;
};

const defaultFactoryAddress = (chainId: string | undefined): string | null => {
  const normalized = `${chainId ?? "137"}`.trim();
  if (normalized === "137" || normalized === "80002") {
    return "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";
  }
  return null;
};

const defaultImplementationAddress = (chainId: string | undefined): string | null => {
  const normalized = `${chainId ?? "137"}`.trim();
  if (normalized === "137") {
    return "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB";
  }
  if (normalized === "80002") {
    return "0x50a88fE9a441cB4c9c2aD6A2207CE2795C7D7Fbd";
  }
  return null;
};

const nonEmpty = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isEvmAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
