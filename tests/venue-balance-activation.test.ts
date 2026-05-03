import { describe, expect, it } from "vitest";
import { buildVenueBalanceActivationActions } from "../src/core/funding/venue-activation.js";
import type { VenueBalanceView } from "../src/core/funding/types.js";
import type { UserVenueAccount } from "../src/core/execution/user-venue-accounts.js";

const account = (venue: UserVenueAccount["venue"]): UserVenueAccount => ({
  venueAccountBindingId: `${venue.toLowerCase()}-binding`,
  userId: "user-1",
  venue,
  userWalletId: "wallet-1",
  walletAddress: "0x2222222222222222222222222222222222222222",
  venueAccountId: "0x1111111111111111111111111111111111111111",
  venueAccountAddress: "0x1111111111111111111111111111111111111111",
  venueAccountType: venue === "POLYMARKET" ? "DEPOSIT_WALLET" : "OAUTH_ACCOUNT",
  status: "ACTIVE",
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  lastVerifiedAt: "2026-05-03T00:00:00.000Z"
});

const balance = (venue: VenueBalanceView["venue"], token = "USDC"): VenueBalanceView => ({
  venue,
  token,
  readyAmount: "5",
  pendingWithdrawalAmount: "0",
  availableAmount: "5",
  updatedAt: "2026-05-03T00:00:00.000Z"
});

describe("venue balance activation actions", () => {
  it("defaults Polymarket to a safe relayer activation and Predict.fun to not required", () => {
    const activations = buildVenueBalanceActivationActions({
      balances: [balance("POLYMARKET", "pUSD"), balance("PREDICT_FUN", "USDT")],
      venueAccounts: [account("POLYMARKET"), account("PREDICT_FUN")],
      env: {}
    });

    expect(activations).toMatchObject([
      {
        venue: "POLYMARKET",
        activationRequired: true,
        mode: "VENUE_UI_OR_RELAYER",
        transactionRequest: null
      },
      {
        venue: "PREDICT_FUN",
        activationRequired: false,
        mode: "NOT_REQUIRED",
        transactionRequest: null
      }
    ]);
  });

  it("builds an ERC20 approval only when operator-approved spender config is present", () => {
    const activations = buildVenueBalanceActivationActions({
      balances: [balance("PREDICT_FUN", "USDT")],
      venueAccounts: [account("PREDICT_FUN")],
      env: {
        PREDICT_FUN_BALANCE_ACTIVATION_MODE: "ERC20_APPROVAL",
        PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_ADDRESS: "0x3333333333333333333333333333333333333333",
        PREDICT_FUN_BALANCE_ACTIVATION_SPENDER_ADDRESS: "0x4444444444444444444444444444444444444444",
        PREDICT_FUN_BALANCE_ACTIVATION_CHAIN_ID: "56",
        PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_SYMBOL: "USDT",
        PREDICT_FUN_BALANCE_ACTIVATION_AMOUNT_MODE: "EXACT_AVAILABLE"
      }
    });

    const predict = activations.find((activation) => activation.venue === "PREDICT_FUN");
    expect(predict).toMatchObject({
      activationRequired: true,
      mode: "ERC20_APPROVAL",
      status: "READY",
      tokenAddress: "0x3333333333333333333333333333333333333333",
      spenderAddress: "0x4444444444444444444444444444444444444444",
      chainId: 56,
      amount: "5000000",
      transactionRequest: {
        to: "0x3333333333333333333333333333333333333333",
        from: "0x2222222222222222222222222222222222222222",
        value: "0",
        chainId: 56
      }
    });
    expect(predict?.transactionRequest?.data).toContain("095ea7b3");
  });

  it("does not return an EOA approval when the activation owner is a venue account", () => {
    const activations = buildVenueBalanceActivationActions({
      balances: [balance("POLYMARKET", "pUSD")],
      venueAccounts: [account("POLYMARKET")],
      env: {
        POLYMARKET_BALANCE_ACTIVATION_MODE: "ERC20_APPROVAL",
        POLYMARKET_BALANCE_ACTIVATION_TOKEN_ADDRESS: "0x3333333333333333333333333333333333333333",
        POLYMARKET_BALANCE_ACTIVATION_SPENDER_ADDRESS: "0x4444444444444444444444444444444444444444",
        POLYMARKET_BALANCE_ACTIVATION_CHAIN_ID: "137",
        POLYMARKET_BALANCE_ACTIVATION_TOKEN_SYMBOL: "pUSD",
        POLYMARKET_BALANCE_ACTIVATION_OWNER_SOURCE: "VENUE_ACCOUNT"
      }
    });

    const polymarket = activations.find((activation) => activation.venue === "POLYMARKET");
    expect(polymarket).toMatchObject({
      activationRequired: true,
      mode: "ERC20_APPROVAL",
      status: "CONFIG_REQUIRED",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      signerAddress: "0x2222222222222222222222222222222222222222",
      transactionRequest: null
    });
    expect(polymarket?.blockers.join(" ")).toContain("use the official venue relayer/UI activation path");
  });

  it("fails closed when ERC20 approval mode is enabled without spender config", () => {
    const activations = buildVenueBalanceActivationActions({
      balances: [balance("POLYMARKET", "pUSD")],
      venueAccounts: [account("POLYMARKET")],
      env: {
        POLYMARKET_BALANCE_ACTIVATION_MODE: "ERC20_APPROVAL"
      }
    });

    const polymarket = activations.find((activation) => activation.venue === "POLYMARKET");
    expect(polymarket).toMatchObject({
      activationRequired: true,
      mode: "ERC20_APPROVAL",
      status: "CONFIG_REQUIRED",
      transactionRequest: null
    });
    expect(polymarket?.blockers).toContain("POLYMARKET_BALANCE_ACTIVATION_SPENDER_ADDRESS is not configured.");
  });
});
