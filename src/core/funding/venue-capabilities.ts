import type { FundingVenue, VenueCapability } from "./types.js";
import { resolvePolymarketBridgeDestinationAsset } from "./polymarket-bridge-withdrawal-adapter.js";

export interface VenueCapabilityConfig {
  env?: NodeJS.ProcessEnv | undefined;
}

export type VenueFundingDestinationMode = "VENUE_DEPOSIT_ENV" | "USER_TURNKEY_EVM_WALLET" | "USER_VENUE_DEPOSIT_WALLET";

const envValue = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
};

const venueDepositAddress = (env: NodeJS.ProcessEnv, venue: FundingVenue, chain?: string | null): string | null => {
  const chainKeys = chain ? fundingDestinationChainKeys(chain) : [];
  for (const chainKey of chainKeys) {
    const chainSpecific = envValue(env, `${venue}_FUNDING_DESTINATION_ADDRESS_${chainKey}`);
    if (chainSpecific) {
      return chainSpecific;
    }
  }
  return envValue(env, `${venue}_FUNDING_DESTINATION_ADDRESS`);
};

const configuredVenueDepositAddress = (
  env: NodeJS.ProcessEnv,
  venue: FundingVenue,
  preferredChain?: string,
  fallbackChains: string[] = []
): string | null => {
  const chains = [preferredChain, ...fallbackChains].filter((value): value is string => Boolean(value));
  for (const chain of chains) {
    const chainSpecific = venueDepositAddress(env, venue, chain);
    if (chainSpecific) {
      return chainSpecific;
    }
  }
  return venueDepositAddress(env, venue);
};

export const buildVenueCapabilityMatrix = (config: VenueCapabilityConfig = {}): Record<FundingVenue, VenueCapability> => {
  const env = config.env ?? process.env;
  const polymarketDepositAddress = configuredVenueDepositAddress(env, "POLYMARKET", "POLYGON", ["SOLANA"]);
  const polymarketUserDepositWalletEnabled = envValue(env, "POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED") === "true"
    || envValue(env, "POLYMARKET_FUNDING_DESTINATION_MODE") === "USER_VENUE_DEPOSIT_WALLET";
  const limitlessDepositAddress = configuredVenueDepositAddress(env, "LIMITLESS", "BASE", ["SOLANA"]);
  const opinionDepositAddress = configuredVenueDepositAddress(env, "OPINION", "BSC", ["SOLANA", "POLYGON"]);
  const opinionUserWalletDestinationEnabled = envValue(env, "OPINION_FUNDING_DESTINATION_MODE") === "USER_TURNKEY_EVM_WALLET"
    || envValue(env, "OPINION_FUNDING_DESTINATION_MODE") === "USER_VENUE_DEPOSIT_WALLET";
  const myriadDepositAddress = configuredVenueDepositAddress(env, "MYRIAD", "BSC", ["SOLANA", "POLYGON"]);
  const predictFunDepositAddress = configuredVenueDepositAddress(env, "PREDICT_FUN", "BSC", ["SOLANA", "POLYGON"]);
  const predictFunFundingDestinationMode = envValue(env, "PREDICT_FUN_FUNDING_DESTINATION_MODE") ?? "USER_TURNKEY_EVM_WALLET";
  const predictFunUserWalletDestinationEnabled = predictFunFundingDestinationMode === "USER_TURNKEY_EVM_WALLET"
    || predictFunFundingDestinationMode === "USER_VENUE_DEPOSIT_WALLET";
  const solanaUsdcAddress = envValue(env, "SOLANA_USDC_TOKEN_ADDRESS") ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const solanaUsdtAddress = envValue(env, "SOLANA_USDT_TOKEN_ADDRESS") ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY1p8ARw5ygP2Z7n";
  const polygonUsdcAddress = envValue(env, "POLYGON_USDC_TOKEN_ADDRESS") ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const baseUsdcAddress = envValue(env, "BASE_USDC_TOKEN_ADDRESS")
    ?? envValue(env, "LIMITLESS_USDC_TOKEN_ADDRESS")
    ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const bscUsdtAddress = envValue(env, "BSC_USDT_TOKEN_ADDRESS") ?? "0x55d398326f99059fF775485246999027B3197955";
  const baseUsdcSourceTokenAddressByChain = {
    BASE: baseUsdcAddress,
    "8453": baseUsdcAddress
  };
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
    ...(opinionPreferredToken === "USDC" ? baseUsdcSourceTokenAddressByChain : {}),
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
  const myriadPreferredChainKey = normalizeChainKey(myriadPreferredChain);
  const myriadPreferredTokenAddress = myriadPreferredToken === "USD1"
    ? envValue(env, "MYRIAD_USD1_TOKEN_ADDRESS") ?? envValue(env, "MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_USD1_ADDRESS") ?? myriadUsdcAddress
    : myriadPreferredToken === "USDT"
      ? envValue(env, "MYRIAD_USDT_TOKEN_ADDRESS") ?? envValue(env, "MYRIAD_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS") ?? bscUsdtAddress
      : myriadUsdcAddress;
  const myriadSourceTokenAddressByChain = {
    SOLANA: solanaUsdcAddress,
    ...(myriadPreferredToken === "USDC" ? baseUsdcSourceTokenAddressByChain : {}),
    ...(myriadPreferredToken === "USDC" && (myriadPreferredChainKey === "POLYGON" || myriadPreferredChainId === 137)
      ? {
        POLYGON: myriadPreferredTokenAddress,
        "137": myriadPreferredTokenAddress
      }
      : {}),
    ...((myriadPreferredToken === "USDT" || myriadPreferredToken === "USD1") && (myriadPreferredChainKey === "BNB" || myriadPreferredChainId === 56)
      ? {
        BNB: myriadPreferredTokenAddress,
        BSC: myriadPreferredTokenAddress,
        "56": myriadPreferredTokenAddress
      }
      : {})
  };
  const predictFunPreferredChain = envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_CHAIN") ?? "BSC";
  const predictFunPreferredChainId = Number.parseInt(envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_CHAIN_ID") ?? "56", 10);
  const predictFunPreferredToken = envValue(env, "PREDICT_FUN_FUNDING_PREFERRED_TOKEN") ?? "USDT";
  const predictFunPreferredChainKey = normalizeChainKey(predictFunPreferredChain);
  const predictFunPreferredTokenAddress = predictFunPreferredToken === "USDT"
    ? envValue(env, "PREDICT_FUN_USDT_TOKEN_ADDRESS") ?? bscUsdtAddress
    : envValue(env, "PREDICT_FUN_USDC_TOKEN_ADDRESS") ?? polygonUsdcAddress;
  const predictFunSourceTokenAddress = predictFunPreferredToken === "USDT" ? solanaUsdtAddress : solanaUsdcAddress;
  const predictFunSourceTokenAddressByChain = {
    SOLANA: predictFunSourceTokenAddress,
    ...(predictFunPreferredToken === "USDC" ? baseUsdcSourceTokenAddressByChain : {}),
    ...(predictFunPreferredToken === "USDT" && (predictFunPreferredChainKey === "BNB" || predictFunPreferredChainId === 56)
      ? {
        BNB: predictFunPreferredTokenAddress,
        BSC: predictFunPreferredTokenAddress,
        "56": predictFunPreferredTokenAddress
      }
      : {})
  };
  const supportsWithdrawal = (venue: FundingVenue): boolean => envValue(env, `${venue}_FUNDING_WITHDRAWALS_ENABLED`) === "true";
  const limitlessBridgeBackEnabled = supportsWithdrawal("LIMITLESS") && envValue(env, "LIMITLESS_WITHDRAWAL_BRIDGE_BACK_ENABLED") === "true";
  const polymarketWithdrawalDestinations = ["POLYGON", "BASE"].map((chain) =>
    toWithdrawalDestination(resolvePolymarketBridgeDestinationAsset(chain, "USDC"), supportsWithdrawal("POLYMARKET"))
  );

  return {
    POLYMARKET: {
      venue: "POLYMARKET",
      supportedChains: ["SOLANA", "BASE", "8453"],
      supportedTokens: ["USDC"],
      preferredChain: "POLYGON",
      preferredToken: "USDC",
      preferredChainId: 137,
      preferredTokenAddress: polygonUsdcAddress,
      sourceTokenAddressByChain: {
        SOLANA: solanaUsdcAddress,
        ...baseUsdcSourceTokenAddressByChain
      },
      autoCreditSupported: false,
      requiresFinalizationStep: true,
      supportsDirectDeposit: true,
      supportsWithdrawal: supportsWithdrawal("POLYMARKET"),
      withdrawalDestinations: polymarketWithdrawalDestinations,
      withdrawalMode: "USER_SIGNED",
      userSignedWithdrawalSupported: true,
      partnerManagedWithdrawal: null,
      readinessStatus: polymarketDepositAddress || polymarketUserDepositWalletEnabled ? "READY" : "DISABLED",
      depositAddressConfigured: Boolean(polymarketDepositAddress || polymarketUserDepositWalletEnabled),
      notes: polymarketUserDepositWalletEnabled
        ? "Polymarket funding quote path is configured for user-specific deposit wallets."
        : polymarketDepositAddress
          ? "Polymarket funding quote path is configured for Solana USDC to Polygon USDC."
          : "Set POLYMARKET_FUNDING_DESTINATION_ADDRESS or enable Polymarket deposit-wallet automation before enabling Polymarket funding quotes."
    },
    LIMITLESS: {
      venue: "LIMITLESS",
      supportedChains: ["SOLANA", "BASE", "8453"],
      supportedTokens: ["USDC"],
      preferredChain: limitlessPreferredChain,
      preferredToken: "USDC",
      preferredChainId: Number.isFinite(limitlessPreferredChainId) && limitlessPreferredChainId > 0 ? limitlessPreferredChainId : 8453,
      preferredTokenAddress: limitlessUsdcAddress,
      sourceTokenAddressByChain: {
        SOLANA: solanaUsdcAddress,
        ...baseUsdcSourceTokenAddressByChain
      },
      autoCreditSupported: false,
      requiresFinalizationStep: true,
      supportsDirectDeposit: true,
      supportsWithdrawal: limitlessBridgeBackEnabled,
      withdrawalDestinations: [toWithdrawalDestination({
        chain: "SOLANA",
        chainId: 101,
        token: "USDC",
        tokenAddress: solanaUsdcAddress,
        decimals: 6
      }, limitlessBridgeBackEnabled, "Limitless beta withdrawals bridge venue-ready Base USDC back to Solana USDC.")],
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
        ? limitlessBridgeBackEnabled
          ? "Limitless funding quote path is configured. Beta withdrawal support is limited to user-signed Base USDC bridge-back to Solana; partner-managed backend withdrawal remains disabled."
          : "Limitless funding quote path is configured. Withdrawal mode is AUTO_RESOLUTION_ONLY for EOA/user accounts; partner-managed backend withdrawal remains disabled."
        : "Set LIMITLESS_FUNDING_DESTINATION_ADDRESS before enabling Limitless funding quotes. Limitless user-signed withdrawals are not supported."
    },
    OPINION: configurableCapability({
      venue: "OPINION",
      depositAddress: opinionUserWalletDestinationEnabled ? "USER_WALLET" : opinionDepositAddress,
      preferredChain: opinionPreferredChain,
      preferredChainId: opinionPreferredChainId,
      preferredToken: opinionPreferredToken,
      preferredTokenAddress: opinionPreferredTokenAddress,
      sourceTokenAddressByChain: opinionSourceTokenAddressByChain,
      supportsWithdrawal: supportsWithdrawal("OPINION"),
      configuredNote: opinionUserWalletDestinationEnabled
        ? `Opinion funding quote path is configured for user-specific ${opinionPreferredToken} venue balances.`
        : `Opinion funding quote path is configured for Solana ${opinionPreferredToken} to the operator-approved Opinion funding destination.`,
      missingNote: "Set OPINION_FUNDING_DESTINATION_ADDRESS before enabling Opinion funding quotes."
    }),
    MYRIAD: configurableCapability({
      venue: "MYRIAD",
      depositAddress: myriadDepositAddress,
      preferredChain: myriadPreferredChain,
      preferredChainId: myriadPreferredChainId,
      preferredToken: myriadPreferredToken,
      preferredTokenAddress: myriadPreferredTokenAddress,
      sourceTokenAddressByChain: myriadSourceTokenAddressByChain,
      supportsWithdrawal: supportsWithdrawal("MYRIAD"),
      configuredNote: `Myriad funding quote path is configured for approved ${myriadPreferredToken} source chains to the operator-approved Myriad funding destination.`,
      missingNote: "Set MYRIAD_FUNDING_DESTINATION_ADDRESS before enabling Myriad funding quotes."
    }),
    PREDICT_FUN: {
      ...configurableCapability({
        venue: "PREDICT_FUN",
        depositAddress: predictFunUserWalletDestinationEnabled ? "USER_WALLET" : predictFunDepositAddress,
        preferredChain: predictFunPreferredChain,
        preferredChainId: predictFunPreferredChainId,
        preferredToken: predictFunPreferredToken,
        preferredTokenAddress: predictFunPreferredTokenAddress,
        sourceTokenAddressByChain: predictFunSourceTokenAddressByChain,
        supportsWithdrawal: supportsWithdrawal("PREDICT_FUN"),
        configuredNote: predictFunUserWalletDestinationEnabled
          ? `Predict.fun funding quote path is configured for user-specific ${predictFunPreferredToken} venue balances.`
          : `Predict.fun funding quote path is configured for approved ${predictFunPreferredToken} source chains to the operator-approved Predict.fun funding destination.`,
        missingNote: "Set PREDICT_FUN_FUNDING_DESTINATION_ADDRESS or PREDICT_FUN_FUNDING_DESTINATION_MODE=USER_VENUE_DEPOSIT_WALLET before enabling Predict.fun funding quotes; do not confuse Predict.fun with PredictIt."
      }),
      ...(predictFunUserWalletDestinationEnabled
        ? {
          readinessStatus: "READY" as const,
          depositAddressConfigured: true,
          notes: "Predict.fun funding quote path is configured for the active user-specific Turnkey EVM wallet."
        }
        : {})
    }
  };
};

export const getVenueDepositAddress = (venue: FundingVenue, env: NodeJS.ProcessEnv = process.env): string | null => {
  return venueDepositAddress(env, venue);
};

export const getVenueDepositAddressForChain = (
  venue: FundingVenue,
  chain: string,
  env: NodeJS.ProcessEnv = process.env
): string | null => {
  return venueDepositAddress(env, venue, chain);
};

export const getVenueFundingDestinationMode = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): VenueFundingDestinationMode => {
  const value = envValue(env, `${venue}_FUNDING_DESTINATION_MODE`);
  if (value === "USER_TURNKEY_EVM_WALLET" || value === "USER_VENUE_DEPOSIT_WALLET") {
    return value;
  }
  if (venue === "PREDICT_FUN") {
    return "USER_TURNKEY_EVM_WALLET";
  }
  if (venue === "POLYMARKET" && envValue(env, "POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED") === "true") {
    return "USER_VENUE_DEPOSIT_WALLET";
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
  withdrawalDestinations: [toWithdrawalDestination({
    chain: input.preferredChain,
    chainId: Number.isFinite(input.preferredChainId) && input.preferredChainId > 0 ? input.preferredChainId : 137,
    token: input.preferredToken ?? "USDC",
    tokenAddress: input.preferredTokenAddress,
    decimals: 6
  }, input.supportsWithdrawal)],
  withdrawalMode: "USER_SIGNED",
  userSignedWithdrawalSupported: true,
  partnerManagedWithdrawal: null,
  readinessStatus: input.depositAddress ? "READY" : "DISABLED",
  depositAddressConfigured: Boolean(input.depositAddress),
  notes: input.depositAddress ? input.configuredNote : input.missingNote
});

const toWithdrawalDestination = (
  input: { chain: string; chainId: string | number; token: string; tokenAddress: string; decimals?: number },
  supported: boolean,
  notes?: string
): NonNullable<VenueCapability["withdrawalDestinations"]>[number] => ({
  chain: normalizeChainKey(input.chain),
  chainId: typeof input.chainId === "number" ? input.chainId : Number.parseInt(input.chainId, 10),
  token: input.token,
  tokenAddress: input.tokenAddress,
  supported,
  ...(notes ? { notes } : {})
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

const fundingDestinationChainKeys = (value: string): string[] => {
  const normalized = normalizeChainKey(value);
  if (normalized === "BNB") {
    return ["BSC", "BNB", "56"];
  }
  if (normalized === "SOLANA") {
    return ["SOLANA", "SOL"];
  }
  if (normalized === "POLYGON") {
    return ["POLYGON", "137"];
  }
  if (normalized === "BASE") {
    return ["BASE", "8453"];
  }
  return [normalized];
};
