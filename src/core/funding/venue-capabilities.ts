import type { FundingVenue, VenueCapability } from "./types.js";

export interface VenueCapabilityConfig {
  env?: NodeJS.ProcessEnv | undefined;
}

export type VenueFundingDestinationMode = "VENUE_DEPOSIT_ENV" | "USER_TURNKEY_EVM_WALLET" | "USER_VENUE_DEPOSIT_WALLET";

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
  const solanaUsdtAddress = envValue(env, "SOLANA_USDT_TOKEN_ADDRESS") ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY1p8ARw5ygP2Z7n";
  const polygonUsdcAddress = envValue(env, "POLYGON_USDC_TOKEN_ADDRESS") ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const bscUsdtAddress = envValue(env, "BSC_USDT_TOKEN_ADDRESS") ?? "0x55d398326f99059fF775485246999027B3197955";
  const limitlessPreferredChain = envValue(env, "LIMITLESS_FUNDING_PREFERRED_CHAIN") ?? "BASE";
  const limitlessPreferredChainId = Number.parseInt(envValue(env, "LIMITLESS_FUNDING_PREFERRED_CHAIN_ID") ?? "8453", 10);
  const limitlessUsdcAddress = envValue(env, "LIMITLESS_USDC_TOKEN_ADDRESS") ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const opinionPreferredChain = envValue(env, "OPINION_FUNDING_PREFERRED_CHAIN") ?? "POLYGON";
  const opinionPreferredChainId = Number.parseInt(envValue(env, "OPINION_FUNDING_PREFERRED_CHAIN_ID") ?? "137", 10);
  const opinionUsdcAddress = envValue(env, "OPINION_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;
  const opinionPreferredToken = envValue(env, "OPINION_FUNDING_PREFERRED_TOKEN") ?? "USDC";
  const opinionPreferredChainKey = normalizeChainKey(opinionPreferredChain);
  const opinionPreferredTokenAddress = opinionPreferredToken === "USDT"
    ? envValue(env, "OPINION_USDT_TOKEN_ADDRESS") ?? envValue(env, "OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS") ?? bscUsdtAddress
    : opinionUsdcAddress;
  const opinionSourceTokenAddress = opinionPreferredToken === "USDT" ? solanaUsdtAddress : solanaUsdcAddress;
  const opinionSourceTokenAddressByChain = {
    SOLANA: opinionSourceTokenAddress,
    ...(opinionPreferredToken === "USDT" && (opinionPreferredChainKey === "BNB" || opinionPreferredChainId === 56)
      ? {
        BNB: opinionPreferredTokenAddress,
        BSC: opinionPreferredTokenAddress,
        "56": opinionPreferredTokenAddress
      }
      : {})
  };
  const myriadPreferredChain = envValue(env, "MYRIAD_FUNDING_PREFERRED_CHAIN") ?? "POLYGON";
  const myriadPreferredChainId = Number.parseInt(envValue(env, "MYRIAD_FUNDING_PREFERRED_CHAIN_ID") ?? "137", 10);
  const myriadUsdcAddress = envValue(env, "MYRIAD_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;
  const myriadPreferredToken = envValue(env, "MYRIAD_FUNDING_PREFERRED_TOKEN") ?? "USDC";
  const myriadPreferredTokenAddress = myriadPreferredToken === "USD1"
    ? envValue(env, "MYRIAD_USD1_TOKEN_ADDRESS") ?? envValue(env, "MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_USD1_ADDRESS") ?? myriadUsdcAddress
    : myriadUsdcAddress;
  const predictFunPreferredChain = envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_CHAIN") ?? "POLYGON";
  const predictFunPreferredChainId = Number.parseInt(envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_CHAIN_ID") ?? "137", 10);
  const predictFunPreferredToken = envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_TOKEN") ?? "USDC";
  const predictFunPreferredChainKey = normalizeChainKey(predictFunPreferredChain);
  const predictFunPreferredTokenAddress = predictFunPreferredToken === "USDT"
    ? envValue(env, "PREDICT_FUN_USDT_TOKEN_ADDRESS") ?? bscUsdtAddress
    : envValue(env, "PREDICT_FUN_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;
  const predictFunSourceTokenAddress = predictFunPreferredToken === "USDT" ? solanaUsdtAddress : solanaUsdcAddress;
  const predictFunSourceTokenAddressByChain = {
    SOLANA: predictFunSourceTokenAddress,
    ...(predictFunPreferredToken === "USDT" && (predictFunPreferredChainKey === "BNB" || predictFunPreferredChainId === 56)
      ? {
        BNB: predictFunPreferredTokenAddress,
        BSC: predictFunPreferredTokenAddress,
        "56": predictFunPreferredTokenAddress
      }
      : {})
  };
  const supportsWithdrawal = (venue: FundingVenue): boolean => envValue(env, `${venue}_FUNDING_WITHDRAWALS_ENABLED`) === "true";

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
      supportsWithdrawal: supportsWithdrawal("POLYMARKET"),
      withdrawalMode: "USER_SIGNED",
      userSignedWithdrawalSupported: true,
      partnerManagedWithdrawal: null,
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
      withdrawalMode: "AUTO_RESOLUTION_ONLY",
      userSignedWithdrawalSupported: false,
      partnerManagedWithdrawal: {
        mode: "PARTNER_MANAGED_BACKEND",
        enabled: false,
        requiresHmacAuth: true,
        requiresWithdrawalScope: true,
        requiresCustodySecurityApproval: true,
        notes: "Limitless POST /portfolio/withdraw is partner-only, HMAC-authenticated, withdrawal-scope gated, and withdraws managed server-wallet sub-account funds to the partner address. Lotus user-signed withdrawal remains unsupported."
      },
      readinessStatus: limitlessDepositAddress ? "READY" : "DISABLED",
      depositAddressConfigured: Boolean(limitlessDepositAddress),
      notes: limitlessDepositAddress
        ? "Limitless funding quote path is configured. Withdrawal mode is AUTO_RESOLUTION_ONLY for EOA/user accounts; partner-managed backend withdrawal remains disabled."
        : "Set LIMITLESS_FUNDING_DESTINATION_ADDRESS before enabling Limitless funding quotes. Limitless user-signed withdrawals are not supported."
    },
    OPINION: configurableCapability({
      venue: "OPINION",
      depositAddress: opinionDepositAddress,
      preferredChain: opinionPreferredChain,
      preferredChainId: opinionPreferredChainId,
      preferredToken: opinionPreferredToken,
      preferredTokenAddress: opinionPreferredTokenAddress,
      sourceTokenAddressByChain: opinionSourceTokenAddressByChain,
      supportsWithdrawal: supportsWithdrawal("OPINION"),
      configuredNote: `Opinion funding quote path is configured for Solana ${opinionPreferredToken} to the operator-approved Opinion funding destination.`,
      missingNote: "Set OPINION_FUNDING_DESTINATION_ADDRESS before enabling Opinion funding quotes."
    }),
    MYRIAD: configurableCapability({
      venue: "MYRIAD",
      depositAddress: myriadDepositAddress,
      preferredChain: myriadPreferredChain,
      preferredChainId: myriadPreferredChainId,
      preferredToken: myriadPreferredToken,
      preferredTokenAddress: myriadPreferredTokenAddress,
      sourceTokenAddressByChain: { SOLANA: solanaUsdcAddress },
      supportsWithdrawal: supportsWithdrawal("MYRIAD"),
      configuredNote: `Myriad funding quote path is configured for Solana ${myriadPreferredToken} to the operator-approved Myriad funding destination.`,
      missingNote: "Set MYRIAD_FUNDING_DESTINATION_ADDRESS before enabling Myriad funding quotes."
    }),
    PREDICT_FUN: configurableCapability({
      venue: "PREDICT_FUN",
      depositAddress: predictFunDepositAddress,
      preferredChain: predictFunPreferredChain,
      preferredChainId: predictFunPreferredChainId,
      preferredToken: predictFunPreferredToken,
      preferredTokenAddress: predictFunPreferredTokenAddress,
      sourceTokenAddressByChain: predictFunSourceTokenAddressByChain,
      supportsWithdrawal: supportsWithdrawal("PREDICT_FUN"),
      configuredNote: `Predict.fun funding quote path is configured for approved ${predictFunPreferredToken} source chains to the operator-approved Predict.fun funding destination.`,
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

export const getVenueFundingDestinationMode = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): VenueFundingDestinationMode => {
  const value = envValue(env, `${venue}_FUNDING_DESTINATION_MODE`);
  if (value === "USER_TURNKEY_EVM_WALLET" || value === "USER_VENUE_DEPOSIT_WALLET") {
    return value;
  }
  return "VENUE_DEPOSIT_ENV";
};

const configurableCapability = (input: {
  venue: FundingVenue;
  depositAddress: string | null;
  preferredChain: string;
  preferredChainId: number;
  preferredToken?: string;
  preferredTokenAddress: string;
  sourceTokenAddressByChain: Record<string, string>;
  supportsWithdrawal: boolean;
  configuredNote: string;
  missingNote: string;
}): VenueCapability => ({
  venue: input.venue,
  supportedChains: Object.keys(input.sourceTokenAddressByChain),
  supportedTokens: [input.preferredToken ?? "USDC"],
  preferredChain: input.preferredChain,
  preferredToken: input.preferredToken ?? "USDC",
  preferredChainId: Number.isFinite(input.preferredChainId) && input.preferredChainId > 0 ? input.preferredChainId : 137,
  preferredTokenAddress: input.preferredTokenAddress,
  sourceTokenAddressByChain: input.sourceTokenAddressByChain,
  autoCreditSupported: false,
  requiresFinalizationStep: true,
  supportsDirectDeposit: true,
  supportsWithdrawal: input.supportsWithdrawal,
  withdrawalMode: "USER_SIGNED",
  userSignedWithdrawalSupported: true,
  partnerManagedWithdrawal: null,
  readinessStatus: input.depositAddress ? "READY" : "DISABLED",
  depositAddressConfigured: Boolean(input.depositAddress),
  notes: input.depositAddress ? input.configuredNote : input.missingNote
});

const normalizeChainKey = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "BSC" || normalized === "BNB_SMART_CHAIN" || normalized === "56") {
    return "BNB";
  }
  if (normalized === "SOL" || normalized === "SOLANA") {
    return "SOLANA";
  }
  return normalized;
};
