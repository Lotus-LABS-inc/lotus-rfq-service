import { describe, expect, it } from "vitest";
import {
  findUnexpectedWalletKeys,
  scanForTurnkeySmokeSecrets,
  summarizeSafeWallet
} from "../src/core/funding/turnkey-wallet-smoke-safety.js";

describe("Turnkey wallet production smoke safety", () => {
  it("passes frontend-safe wallet metadata", () => {
    const wallet = {
      walletId: "wallet-1",
      provider: "TURNKEY",
      chainFamily: "SOLANA",
      chain: "SOLANA",
      address: "So11111111111111111111111111111111111111111",
      purpose: "DEFAULT_FUNDING",
      venue: null,
      exportable: true,
      status: "ACTIVE",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    };

    expect(scanForTurnkeySmokeSecrets({ wallets: [wallet] })).toEqual({ passed: true, findings: [] });
    expect(findUnexpectedWalletKeys([wallet])).toEqual([]);
    expect(summarizeSafeWallet(wallet)).toMatchObject({
      walletId: "wallet-1",
      provider: "TURNKEY",
      chainFamily: "SOLANA",
      exportable: true
    });
  });

  it("flags Turnkey internals and secret-like response keys", () => {
    const payload = {
      wallets: [{
        walletId: "wallet-1",
        provider: "TURNKEY",
        providerSubOrgId: "sub-org",
        providerWalletId: "provider-wallet",
        providerWalletAccountId: "provider-account",
        privateKey: "secret",
        exportBundle: "bundle",
        signWith: "signer"
      }],
      token: "jwt"
    };

    const scan = scanForTurnkeySmokeSecrets(payload);
    expect(scan.passed).toBe(false);
    expect(scan.findings).toEqual(expect.arrayContaining([
      "$.wallets[0].providerSubOrgId",
      "$.wallets[0].providerWalletId",
      "$.wallets[0].providerWalletAccountId",
      "$.wallets[0].privateKey",
      "$.wallets[0].exportBundle",
      "$.wallets[0].signWith",
      "$.token"
    ]));
    expect(findUnexpectedWalletKeys((payload.wallets))).toEqual(expect.arrayContaining([
      "wallets[0].providerSubOrgId",
      "wallets[0].providerWalletId",
      "wallets[0].providerWalletAccountId",
      "wallets[0].privateKey",
      "wallets[0].exportBundle",
      "wallets[0].signWith"
    ]));
  });
});
