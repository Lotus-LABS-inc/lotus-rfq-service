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
  const opinionDepositAddress = envValue(env, "OPINION_FUNDING_DESTINATION_ADDRESS");
  const myriadDepositAddress = envValue(env, "MYRIAD_FUNDING_DESTINATION_ADDRESS");
  const predictFunDepositAddress = envValue(env, "PREDICT_FUN_FUNDING_DESTINATION_ADDRESS");
  const solanaUsdcAddress = envValue(env, "SOLANA_USDC_TOKEN_ADDRESS") ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const polygonUsdcAddress = envValue(env, "POLYGON_USDC_TOKEN_ADDRESS") ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const limitlessPreferredChain = envValue(env, "LIMITLESS_FUNDING_PREFERRED_CHAIN") ?? "BASE";
  const limitlessPreferredChainId = Number.parseInt(envValue(env, "LIMITLESS_FUNDING_PREFERRED_CHAIN_ID") ?? "8453", 10);
  const limitlessUsdcAddress = envValue(env, "LIMITLESS_USDC_TOKEN_ADDRESS") ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const opinionPreferredChain = envValue(env, "OPINION_FUNDING_PREFERRED_CHAIN") ?? "POLYGON";
  const opinionPreferredChainId = Number.parseInt(envValue(env, "OPINION_FUNDING_PREFERRED_CHAIN_ID") ?? "137", 10);
  const opinionUsdcAddress = envValue(env, "OPINION_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;
  const myriadPreferredChain = envValue(env, "MYRIAD_FUNDING_PREFERRED_CHAIN") ?? "POLYGON";
  const myriadPreferredChainId = Number.parseInt(envValue(env, "MYRIAD_FUNDING_PREFERRED_CHAIN_ID") ?? "137", 10);
  const myriadUsdcAddress = envValue(env, "MYRIAD_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;
  const predictFunPreferredChain = envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_CHAIN") ?? "POLYGON";
  const predictFunPreferredChainId = Number.parseInt(envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_CHAIN_ID") ?? "137", 10);
  const predictFunUsdcAddress = envValue(env, "PREDICT_FUN_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;

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
    OPINION: configurableCapability({
      venue: "OPINION",
      depositAddress: opinionDepositAddress,
      preferredChain: opinionPreferredChain,
      preferredChainId: opinionPreferredChainId,
      preferredTokenAddress: opinionUsdcAddress,
      sourceTokenAddressByChain: { SOLANA: solanaUsdcAddress },
      configuredNote: "Opinion funding quote path is configured for Solana USDC to the operator-approved Opinion funding destination.",
      missingNote: "Set OPINION_FUNDING_DESTINATION_ADDRESS before enabling Opinion funding quotes."
    }),
    MYRIAD: configurableCapability({
      venue: "MYRIAD",
      depositAddress: myriadDepositAddress,
      preferredChain: myriadPreferredChain,
      preferredChainId: myriadPreferredChainId,
      preferredTokenAddress: myriadUsdcAddress,
      sourceTokenAddressByChain: { SOLANA: solanaUsdcAddress },
      configuredNote: "Myriad funding quote path is configured for Solana USDC to the operator-approved Myriad funding destination.",
      missingNote: "Set MYRIAD_FUNDING_DESTINATION_ADDRESS before enabling Myriad funding quotes."
    }),
    PREDICT_FUN: configurableCapability({
      venue: "PREDICT_FUN",
      depositAddress: predictFunDepositAddress,
      preferredChain: predictFunPreferredChain,
      preferredChainId: predictFunPreferredChainId,
      preferredTokenAddress: predictFunUsdcAddress,
      sourceTokenAddressByChain: { SOLANA: solanaUsdcAddress },
      configuredNote: "Predict.fun funding quote path is configured for Solana USDC to the operator-approved Predict.fun funding destination.",
      missingNote: "Set PREDICT_FUN_FUNDING_DESTINATION_ADDRESS before enabling Predict.fun funding quotes; do not confuse Predict.fun with PredictIt."
    })
  };
};

export const getVenueDepositAddress = (venue: FundingVenue, env: NodeJS.ProcessEnv = process.env): string | null => {
  if (venue === "POLYMARKET") {
    return envValue(env, "POLYMARKET_FUNDING_DESTINATION_ADDRESS");
  }
  if (venue === "LIMITLESS") {
    return envValue(env, "LIMITLESS_FUNDING_DESTINATION_ADDRESS");
  }
  if (venue === "OPINION") {
    return envValue(env, "OPINION_FUNDING_DESTINATION_ADDRESS");
  }
  if (venue === "MYRIAD") {
    return envValue(env, "MYRIAD_FUNDING_DESTINATION_ADDRESS");
  }
  if (venue === "PREDICT_FUN") {
    return envValue(env, "PREDICT_FUN_FUNDING_DESTINATION_ADDRESS");
  }
  return null;
};

const configurableCapability = (input: {
  venue: FundingVenue;
  depositAddress: string | null;
  preferredChain: string;
  preferredChainId: number;
  preferredTokenAddress: string;
  sourceTokenAddressByChain: Record<string, string>;
  configuredNote: string;
  missingNote: string;
}): VenueCapability => ({
  venue: input.venue,
  supportedChains: ["SOLANA"],
  supportedTokens: ["USDC"],
  preferredChain: input.preferredChain,
  preferredToken: "USDC",
  preferredChainId: Number.isFinite(input.preferredChainId) && input.preferredChainId > 0 ? input.preferredChainId : 137,
  preferredTokenAddress: input.preferredTokenAddress,
  sourceTokenAddressByChain: input.sourceTokenAddressByChain,
  autoCreditSupported: false,
  requiresFinalizationStep: true,
  supportsDirectDeposit: true,
  supportsWithdrawal: false,
  readinessStatus: input.depositAddress ? "READY" : "DISABLED",
  depositAddressConfigured: Boolean(input.depositAddress),
  notes: input.depositAddress ? input.configuredNote : input.missingNote
});
