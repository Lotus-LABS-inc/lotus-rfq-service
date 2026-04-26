import type { FundingVenue, VenueCapability } from "./types.js";

export interface VenueCapabilityConfig {
  env?: NodeJS.ProcessEnv | undefined;
}

const envValue = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
};

export const buildVenueCapabilityMatrix = (config: VenueCapabilityConfig = {}): Record<FundingVenue, VenueCapability> => {
  const env = config.env ?? process.env;
  const polymarketDepositAddress = envValue(env, "POLYMARKET_FUNDING_DESTINATION_ADDRESS");
  const limitlessDepositAddress = envValue(env, "LIMITLESS_FUNDING_DESTINATION_ADDRESS");
  const solanaUsdcAddress = envValue(env, "SOLANA_USDC_TOKEN_ADDRESS") ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const polygonUsdcAddress = envValue(env, "POLYGON_USDC_TOKEN_ADDRESS") ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const limitlessPreferredChain = envValue(env, "LIMITLESS_FUNDING_PREFERRED_CHAIN") ?? "BASE";
  const limitlessPreferredChainId = Number.parseInt(envValue(env, "LIMITLESS_FUNDING_PREFERRED_CHAIN_ID") ?? "8453", 10);
  const limitlessUsdcAddress = envValue(env, "LIMITLESS_USDC_TOKEN_ADDRESS") ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  return {
    POLYMARKET: {
      venue: "POLYMARKET",
      supportedChains: ["SOLANA"],
      supportedTokens: ["USDC"],
      preferredChain: "POLYGON",
      preferredToken: "USDC",
      preferredChainId: 137,
      preferredTokenAddress: polygonUsdcAddress,
      sourceTokenAddressByChain: {
        SOLANA: solanaUsdcAddress
      },
      autoCreditSupported: false,
      requiresFinalizationStep: true,
      supportsDirectDeposit: true,
      supportsWithdrawal: false,
      readinessStatus: polymarketDepositAddress ? "READY" : "DISABLED",
      depositAddressConfigured: Boolean(polymarketDepositAddress),
      notes: polymarketDepositAddress
        ? "Polymarket funding quote path is configured for Solana USDC to Polygon USDC."
        : "Set POLYMARKET_FUNDING_DESTINATION_ADDRESS before enabling Polymarket funding quotes."
    },
    LIMITLESS: {
      venue: "LIMITLESS",
      supportedChains: ["SOLANA"],
      supportedTokens: ["USDC"],
      preferredChain: limitlessPreferredChain,
      preferredToken: "USDC",
      preferredChainId: Number.isFinite(limitlessPreferredChainId) && limitlessPreferredChainId > 0 ? limitlessPreferredChainId : 8453,
      preferredTokenAddress: limitlessUsdcAddress,
      sourceTokenAddressByChain: {
        SOLANA: solanaUsdcAddress
      },
      autoCreditSupported: false,
      requiresFinalizationStep: true,
      supportsDirectDeposit: true,
      supportsWithdrawal: false,
      readinessStatus: limitlessDepositAddress ? "READY" : "DISABLED",
      depositAddressConfigured: Boolean(limitlessDepositAddress),
      notes: limitlessDepositAddress
        ? "Limitless funding quote path is configured for Solana USDC to the operator-approved Limitless funding destination."
        : "Set LIMITLESS_FUNDING_DESTINATION_ADDRESS before enabling Limitless funding quotes."
    },
    OPINION: disabledCapability("OPINION", "Opinion funding is planned; first pass does not route live funds."),
    MYRIAD: disabledCapability("MYRIAD", "Myriad funding is planned; first pass does not route live funds."),
    PREDICT_FUN: disabledCapability("PREDICT_FUN", "Predict.fun funding is planned; do not confuse with PredictIt.")
  };
};

export const getVenueDepositAddress = (venue: FundingVenue, env: NodeJS.ProcessEnv = process.env): string | null => {
  if (venue === "POLYMARKET") {
    return envValue(env, "POLYMARKET_FUNDING_DESTINATION_ADDRESS");
  }
  if (venue === "LIMITLESS") {
    return envValue(env, "LIMITLESS_FUNDING_DESTINATION_ADDRESS");
  }
  return null;
};

const disabledCapability = (venue: FundingVenue, notes: string): VenueCapability => ({
  venue,
  supportedChains: [],
  supportedTokens: [],
  preferredChain: "UNCONFIGURED",
  preferredToken: "UNCONFIGURED",
  preferredChainId: 1,
  preferredTokenAddress: "UNCONFIGURED",
  sourceTokenAddressByChain: {},
  autoCreditSupported: false,
  requiresFinalizationStep: true,
  supportsDirectDeposit: false,
  supportsWithdrawal: false,
  readinessStatus: "PLANNED",
  depositAddressConfigured: false,
  notes
});
