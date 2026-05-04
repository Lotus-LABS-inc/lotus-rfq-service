import type { FundingVenue, VenueBalanceView } from "./types.js";
import type { UserVenueAccount } from "../execution/user-venue-accounts.js";

export type VenueBalanceActivationMode = "NOT_REQUIRED" | "VENUE_UI_OR_RELAYER" | "ERC20_APPROVAL";
export type VenueBalanceActivationStatus = "NOT_REQUIRED" | "READY" | "CONFIG_REQUIRED" | "ACCOUNT_REQUIRED";

export interface VenueBalanceActivationTransactionRequest {
  to: string;
  from: string;
  data: string;
  value: "0";
  chainId: number;
}

export interface VenueBalanceActivationAction {
  venue: FundingVenue;
  activationRequired: boolean;
  mode: VenueBalanceActivationMode;
  status: VenueBalanceActivationStatus;
  tokenSymbol: string | null;
  tokenAddress: string | null;
  chainId: number | null;
  ownerAddress: string | null;
  signerAddress: string | null;
  spenderAddress: string | null;
  amount: string | null;
  transactionRequest: VenueBalanceActivationTransactionRequest | null;
  instructions: string[];
  blockers: string[];
}

export interface VenueBalanceActivationInput {
  balances: readonly VenueBalanceView[];
  venueAccounts: readonly UserVenueAccount[];
  env?: NodeJS.ProcessEnv | undefined;
}

const activationVenues: readonly FundingVenue[] = ["POLYMARKET", "PREDICT_FUN"];
const maxUint256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const envValue = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
};

const parseMode = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv
): VenueBalanceActivationMode => {
  const raw = envValue(env, `${venue}_BALANCE_ACTIVATION_MODE`)?.toUpperCase();
  if (venue === "POLYMARKET" && envValue(env, "POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED") === "true") {
    return "VENUE_UI_OR_RELAYER";
  }
  if (raw === "ERC20_APPROVAL" || raw === "VENUE_UI_OR_RELAYER" || raw === "NOT_REQUIRED") {
    return raw;
  }
  if (venue === "POLYMARKET") {
    return "VENUE_UI_OR_RELAYER";
  }
  return "NOT_REQUIRED";
};

const parsePositiveInt = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isHexAddress = (value: string | null): value is string =>
  Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));

const encodeApprove = (spender: string, amount: string): string => {
  const cleanSpender = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const cleanAmount = BigInt(amount).toString(16).padStart(64, "0");
  return `0x095ea7b3${cleanSpender}${cleanAmount}`;
};

const decimalToBaseUnits = (amount: string, decimals: number): string => {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  const normalizedWhole = whole.replace(/[^\d]/g, "") || "0";
  const normalizedFraction = fraction.replace(/[^\d]/g, "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0").toString();
};

const findVenueAccount = (
  accounts: readonly UserVenueAccount[],
  venue: FundingVenue
): UserVenueAccount | null =>
  accounts.find((account) => account.venue === venue && account.status === "ACTIVE") ?? null;

const findVenueBalance = (
  balances: readonly VenueBalanceView[],
  venue: FundingVenue
): VenueBalanceView | null =>
  balances.find((balance) => balance.venue === venue) ?? null;

const configuredAmount = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv,
  balance: VenueBalanceView | null
): string => {
  const mode = envValue(env, `${venue}_BALANCE_ACTIVATION_AMOUNT_MODE`)?.toUpperCase();
  if (mode === "EXACT_AVAILABLE" && balance?.availableAmount) {
    return balance.availableAmount;
  }
  if (mode === "EXACT_READY" && balance?.readyAmount) {
    return balance.readyAmount;
  }
  return envValue(env, `${venue}_BALANCE_ACTIVATION_AMOUNT`) ?? maxUint256;
};

const buildErc20ApprovalAction = (
  venue: FundingVenue,
  input: VenueBalanceActivationInput,
  account: UserVenueAccount | null,
  balance: VenueBalanceView | null
): VenueBalanceActivationAction => {
  const env = input.env ?? process.env;
  const tokenAddress = envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_ADDRESS`);
  const tokenSymbol = envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_SYMBOL`) ?? balance?.token ?? null;
  const spenderAddress = envValue(env, `${venue}_BALANCE_ACTIVATION_SPENDER_ADDRESS`);
  const chainId = parsePositiveInt(envValue(env, `${venue}_BALANCE_ACTIVATION_CHAIN_ID`));
  const decimals = parsePositiveInt(envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_DECIMALS`)) ?? 6;
  const ownerSource = envValue(env, `${venue}_BALANCE_ACTIVATION_OWNER_SOURCE`)?.toUpperCase();
  const ownerAddress = ownerSource === "VENUE_ACCOUNT"
    ? account?.venueAccountAddress ?? account?.walletAddress ?? null
    : account?.walletAddress ?? null;
  const signerAddress = account?.walletAddress ?? null;
  const ownerRequiresRelayer = isHexAddress(ownerAddress) &&
    isHexAddress(signerAddress) &&
    ownerAddress.toLowerCase() !== signerAddress.toLowerCase();
  const blockers = [
    !account ? `${venue} active venue account is required.` : null,
    !isHexAddress(tokenAddress) ? `${venue}_BALANCE_ACTIVATION_TOKEN_ADDRESS is not configured.` : null,
    !isHexAddress(spenderAddress) ? `${venue}_BALANCE_ACTIVATION_SPENDER_ADDRESS is not configured.` : null,
    !chainId ? `${venue}_BALANCE_ACTIVATION_CHAIN_ID is not configured.` : null,
    !isHexAddress(ownerAddress) ? `${venue} activation owner address is unavailable.` : null,
    ownerRequiresRelayer ? `${venue} activation owner is a venue account, not the Turnkey EVM signer; use the official venue relayer/UI activation path.` : null
  ].filter((value): value is string => value !== null);

  if (blockers.length > 0 || !tokenAddress || !spenderAddress || !chainId || !ownerAddress) {
    return {
      venue,
      activationRequired: true,
      mode: "ERC20_APPROVAL",
      status: account ? "CONFIG_REQUIRED" : "ACCOUNT_REQUIRED",
      tokenSymbol,
      tokenAddress: isHexAddress(tokenAddress) ? tokenAddress : null,
      chainId,
      ownerAddress: isHexAddress(ownerAddress) ? ownerAddress : null,
      signerAddress,
      spenderAddress: isHexAddress(spenderAddress) ? spenderAddress : null,
      amount: null,
      transactionRequest: null,
      instructions: ["Activation is enabled, but operator-approved approval config is incomplete."],
      blockers
    };
  }

  const rawAmount = configuredAmount(venue, env, balance);
  const amount = rawAmount === maxUint256 ? BigInt(rawAmount).toString() : decimalToBaseUnits(rawAmount, decimals);
  return {
    venue,
    activationRequired: true,
    mode: "ERC20_APPROVAL",
    status: "READY",
    tokenSymbol,
    tokenAddress,
    chainId,
    ownerAddress,
    signerAddress,
    spenderAddress,
    amount,
    transactionRequest: {
      to: tokenAddress,
      from: ownerAddress,
      data: encodeApprove(spenderAddress, amount),
      value: "0",
      chainId
    },
    instructions: [`Approve ${tokenSymbol ?? "venue collateral"} for the operator-approved ${venue} spender.`],
    blockers: []
  };
};

const buildRelayerAction = (
  venue: FundingVenue,
  account: UserVenueAccount | null,
  balance: VenueBalanceView | null,
  env: NodeJS.ProcessEnv
): VenueBalanceActivationAction => {
  const polymarketReady = venue === "POLYMARKET" &&
    envValue(env, "POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED") === "true" &&
    envValue(env, "POLYMARKET_RELAYER_URL") !== null &&
    envValue(env, "POLYMARKET_BUILDER_API_KEY") !== null &&
    envValue(env, "POLYMARKET_BUILDER_API_SECRET") !== null &&
    envValue(env, "POLYMARKET_BUILDER_API_PASSPHRASE") !== null;
  return {
    venue,
    activationRequired: true,
    mode: "VENUE_UI_OR_RELAYER",
    status: account && polymarketReady ? "READY" : account ? "CONFIG_REQUIRED" : "ACCOUNT_REQUIRED",
    tokenSymbol: venue === "POLYMARKET" ? "pUSD" : balance?.token ?? null,
    tokenAddress: envValue(env, `${venue}_BALANCE_ACTIVATION_TOKEN_ADDRESS`),
    chainId: parsePositiveInt(envValue(env, `${venue}_BALANCE_ACTIVATION_CHAIN_ID`)),
    ownerAddress: account?.venueAccountAddress ?? account?.walletAddress ?? null,
    signerAddress: account?.walletAddress ?? null,
    spenderAddress: envValue(env, `${venue}_BALANCE_ACTIVATION_SPENDER_ADDRESS`),
    amount: null,
    transactionRequest: null,
    instructions: polymarketReady
      ? ["Use the Polymarket activation button. Lotus will prepare a safe deposit-wallet relayer batch for your Turnkey wallet to sign."]
      : [
          `${venue} activation requires the official venue relayer/UI path or an operator-reviewed activation endpoint.`,
          "Lotus will not guess or accept arbitrary spender addresses from the frontend."
        ],
    blockers: account
      ? polymarketReady ? [] : [`${venue} activation transaction is not configured for backend-safe preparation.`]
      : [`${venue} active venue account is required before activation.`]
  };
};

const buildNotRequiredAction = (
  venue: FundingVenue,
  account: UserVenueAccount | null,
  balance: VenueBalanceView | null
): VenueBalanceActivationAction => ({
  venue,
  activationRequired: false,
  mode: "NOT_REQUIRED",
  status: "NOT_REQUIRED",
  tokenSymbol: balance?.token ?? null,
  tokenAddress: null,
  chainId: null,
  ownerAddress: account?.venueAccountAddress ?? account?.walletAddress ?? null,
  signerAddress: account?.walletAddress ?? null,
  spenderAddress: null,
  amount: null,
  transactionRequest: null,
  instructions: [`${venue} does not require a separate balance activation step in the current Lotus configuration.`],
  blockers: []
});

export const buildVenueBalanceActivationActions = (
  input: VenueBalanceActivationInput
): VenueBalanceActivationAction[] => {
  const env = input.env ?? process.env;
  return activationVenues.map((venue) => {
    const mode = parseMode(venue, env);
    const account = findVenueAccount(input.venueAccounts, venue);
    const balance = findVenueBalance(input.balances, venue);
    if (mode === "ERC20_APPROVAL") {
      return buildErc20ApprovalAction(venue, input, account, balance);
    }
    if (mode === "VENUE_UI_OR_RELAYER") {
      return buildRelayerAction(venue, account, balance, env);
    }
    return buildNotRequiredAction(venue, account, balance);
  });
};
