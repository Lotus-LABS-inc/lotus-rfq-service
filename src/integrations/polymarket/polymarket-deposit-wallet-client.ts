import { deriveDepositWallet } from "@polymarket/builder-relayer-client";

export interface PolymarketDepositWalletClientConfig {
  enabled: boolean;
  factoryAddress: string | null;
  implementationAddress: string | null;
}

export interface PolymarketDerivedDepositWallet {
  walletAddress: string;
  deploymentStatus: "DERIVED_NOT_DEPLOYED";
}

export const buildPolymarketDepositWalletClientConfigFromEnv = (
  env: NodeJS.ProcessEnv
): PolymarketDepositWalletClientConfig => ({
  enabled: env.POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED === "true",
  factoryAddress: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_FACTORY_ADDRESS),
  implementationAddress: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_IMPLEMENTATION_ADDRESS)
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
    return {
      walletAddress,
      deploymentStatus: "DERIVED_NOT_DEPLOYED"
    };
  }
}

const nonEmpty = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isEvmAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
