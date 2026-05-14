import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveDepositWallet, RelayClient, TransactionType } from "@polymarket/builder-relayer-client";
import { PolymarketDepositWalletClient } from "../src/integrations/polymarket/polymarket-deposit-wallet-client.js";

const factoryAddress = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";
const implementationAddress = "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB";
const ownerAddress = "0x623Bc9cDf0937c50aa0CAa0D8806412359963A20";
const pUsdAddress = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const usdcAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const collateralOnrampAddress = "0x93070a847efEf7F70739046A929D47a521F5B8ee";
const conditionalTokensAddress = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const approvalSpenders = [
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  "0xe2222d279d744050d28e00520010520000310F59"
];

const client = () => new PolymarketDepositWalletClient({
  enabled: true,
  relayerUrl: "https://relayer.polymarket.test",
  chainId: 137,
  factoryAddress,
  implementationAddress,
  builderApiKey: "builder-key",
  builderApiSecret: "builder-secret",
  builderApiPassphrase: "builder-passphrase",
  deployEnabled: true,
  rpcUrl: "https://polygon-rpc.example",
  pUsdAddress,
  usdcAddress,
  collateralOnrampAddress,
  conditionalTokensAddress,
  ctfSpenderAddress: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
  negRiskSpenderAddress: null
});

const hexAmount = (amount: bigint) => `0x${amount.toString(16)}`;

describe("Polymarket deposit wallet activation client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prepares pUSD approvals for every CLOB-reported spender", async () => {
    const depositWalletAddress = deriveDepositWallet(ownerAddress, factoryAddress, implementationAddress);
    vi.spyOn(RelayClient.prototype, "getNonce").mockResolvedValue({ nonce: 42 } as never);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(`${init?.body ?? "{}"}`);
      const to = String(body.params?.[0]?.to ?? "").toLowerCase();
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: to === pUsdAddress.toLowerCase() ? hexAmount(8_957_410n) : "0x0"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const activation = await client().prepareActivation({
      ownerAddress,
      depositWalletAddress,
      approvalSpenders
    });

    expect(activation.approvalSpenders).toEqual(approvalSpenders);
    expect(activation.calls).toHaveLength(3);
    for (const spender of approvalSpenders) {
      expect(activation.calls.some((call) =>
        call.target.toLowerCase() === pUsdAddress.toLowerCase() &&
        call.data.toLowerCase().includes(spender.toLowerCase().replace(/^0x/, ""))
      )).toBe(true);
    }
    expect(activation.typedData.message.calls).toHaveLength(3);
  });

  it("rejects pUSD approvals to non-CLOB/non-configured spenders at submission validation", async () => {
    const depositWalletAddress = deriveDepositWallet(ownerAddress, factoryAddress, implementationAddress);

    await expect(client().submitActivation({
      ownerAddress,
      depositWalletAddress,
      nonce: "1",
      deadline: "1770000000",
      approvalSpenders,
      signature: "0x" + "11".repeat(65),
      calls: [{
        target: pUsdAddress,
        value: "0",
        data: `0x095ea7b3${"9".repeat(24)}${"4444444444444444444444444444444444444444"}${"f".repeat(64)}`
      }]
    })).rejects.toThrow("pUSD approval is not allowed");
  });

  it("allows wrap plus all CLOB pUSD approvals when USDC.e is present", async () => {
    const depositWalletAddress = deriveDepositWallet(ownerAddress, factoryAddress, implementationAddress);
    vi.spyOn(RelayClient.prototype, "getNonce").mockImplementation(async (_address, transactionType) => {
      expect(transactionType).toBe(TransactionType.WALLET);
      return { nonce: 7 } as never;
    });
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(`${init?.body ?? "{}"}`);
      const to = String(body.params?.[0]?.to ?? "").toLowerCase();
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: to === usdcAddress.toLowerCase() ? hexAmount(3_000_000n) : hexAmount(8_957_410n)
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const activation = await client().prepareActivation({
      ownerAddress,
      depositWalletAddress,
      approvalSpenders
    });

    expect(activation.wrapsUsdc).toBe(true);
    expect(activation.calls).toHaveLength(5);
    expect(activation.calls.filter((call) => call.target.toLowerCase() === pUsdAddress.toLowerCase())).toHaveLength(3);
    expect(activation.calls.filter((call) => call.target.toLowerCase() === usdcAddress.toLowerCase())).toHaveLength(1);
    expect(activation.calls.filter((call) => call.target.toLowerCase() === collateralOnrampAddress.toLowerCase())).toHaveLength(1);
  });

  it("prepares outcome-token setApprovalForAll for sell-side CLOB approval", async () => {
    const depositWalletAddress = deriveDepositWallet(ownerAddress, factoryAddress, implementationAddress);
    const conditionalSpender = "0xE111180000d2663C0091e4f400237545B87B996B";
    vi.spyOn(RelayClient.prototype, "getNonce").mockResolvedValue({ nonce: 42 } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x0"
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const activation = await client().prepareActivation({
      ownerAddress,
      depositWalletAddress,
      approvalSpenders,
      conditionalApprovalSpenders: [conditionalSpender]
    });

    expect(activation.conditionalApprovalSpenders).toEqual([conditionalSpender]);
    expect(activation.calls.some((call) =>
      call.target.toLowerCase() === conditionalTokensAddress.toLowerCase() &&
      call.data.toLowerCase().startsWith("0xa22cb465") &&
      call.data.toLowerCase().includes(conditionalSpender.toLowerCase().replace(/^0x/, ""))
    )).toBe(true);
  });
});
