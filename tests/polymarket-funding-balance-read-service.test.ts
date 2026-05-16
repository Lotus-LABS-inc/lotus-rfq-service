import Fastify from "fastify";
import { AssetType, type BalanceAllowanceResponse } from "@polymarket/clob-client-v2";
import { describe, expect, it } from "vitest";
import { registerInternalPolymarketFundingBalanceRoute } from "../src/api/routes/internal-polymarket-funding-balance.js";
import {
  PolymarketFundingBalanceReadService,
  buildPolymarketFundingBalanceReadConfigFromEnv,
  type PolymarketBalanceAllowanceClient,
  type PolymarketFundingBalanceReadServiceConfig
} from "../src/core/funding/polymarket-balance-read-service.js";

class StubBalanceAllowanceClient implements PolymarketBalanceAllowanceClient {
  public lastAssetType: AssetType | null = null;
  public updateCalls = 0;

  public constructor(private readonly response: BalanceAllowanceResponse) {}

  public async getBalanceAllowance(params: { asset_type: AssetType }): Promise<BalanceAllowanceResponse> {
    this.lastAssetType = params.asset_type;
    return this.response;
  }

  public async updateBalanceAllowance(_params: { asset_type: AssetType }): Promise<unknown> {
    this.updateCalls += 1;
    return {};
  }
}

const completeConfig = {
  enabled: true,
  clobHost: "https://clob.polymarket.test",
  chainId: "137",
  apiKey: "server-side-key",
  apiSecret: "server-side-secret",
  apiPassphrase: "server-side-passphrase",
  privateKey: "0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f"
};

const requestUrl = "/internal/polymarket/funding-balance?userId=user-1&fundingIntentId=intent-1&routeLegId=leg-1";

describe("Polymarket internal funding balance read service", () => {
  it("reads CLOB collateral balance and allowance through the SDK contract", async () => {
    const client = new StubBalanceAllowanceClient({
      balance: "125000000",
      allowance: "100000000"
    });
    const service = new PolymarketFundingBalanceReadService(
      completeConfig,
      () => client
    );

    const result = await service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    });

    expect(result).toMatchObject({
      usableBalance: "100",
      collateralBalance: "125",
      collateralAllowance: "100",
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
    });
    expect(client.lastAssetType).toBe(AssetType.COLLATERAL);
    expect(client.updateCalls).toBe(1);
  });

  it("reads CLOB v2 collateral balance with an allowances map", async () => {
    const client = new StubBalanceAllowanceClient({
      balance: "125000000",
      allowances: {
        "0x1111111111111111111111111111111111111111": "120000000",
        "0x2222222222222222222222222222222222222222": "90000000"
      }
    } as unknown as BalanceAllowanceResponse);
    const service = new PolymarketFundingBalanceReadService(
      completeConfig,
      () => client
    );

    const result = await service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    });

    expect(result).toMatchObject({
      usableBalance: "90",
      collateralBalance: "125",
      collateralAllowance: "90",
      approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
      clobAllowanceSpenders: [
        { spenderAddress: "0x1111111111111111111111111111111111111111", allowance: "120" },
        { spenderAddress: "0x2222222222222222222222222222222222222222", allowance: "90" }
      ],
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
    });
    expect(client.lastAssetType).toBe(AssetType.COLLATERAL);
  });

  it("stays disabled unless explicit internal balance-read config is enabled", () => {
    expect(buildPolymarketFundingBalanceReadConfigFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      clobHost: undefined
    });
  });

  it("falls back to default pUSD token and Polygon RPC when optional envs are blank", () => {
    expect(buildPolymarketFundingBalanceReadConfigFromEnv({
      POLYMARKET_BALANCE_ACTIVATION_TOKEN_ADDRESS: "",
      POLYMARKET_BRIDGED_USDC_TOKEN_ADDRESS: "",
      POLYGON_USDC_TOKEN_ADDRESS: "",
      POLYMARKET_POLYGON_RPC_URL: "",
      POLYGON_RPC_URL: ""
    } as NodeJS.ProcessEnv)).toMatchObject({
      polygonRpcUrl: "https://polygon-bor-rpc.publicnode.com",
      pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
      bridgedUsdcTokenAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
    });
  });

  it("uses the active user Polymarket deposit wallet as the CLOB funder address", async () => {
    const capturedConfigs: PolymarketFundingBalanceReadServiceConfig[] = [];
    const service = new PolymarketFundingBalanceReadService(
      completeConfig,
      (config) => {
        capturedConfigs.push(config);
        return new StubBalanceAllowanceClient({ balance: "100000000", allowance: "100000000" });
      },
      {
        findAccount: async () => ({
          status: "ACTIVE",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      }
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).resolves.toMatchObject({ usableBalance: "100" });

    expect(capturedConfigs[0]).toMatchObject({
      funderAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
    });
  });

  it("reports on-chain pUSD for active deposit wallets without treating it as CLOB-usable balance", async () => {
    const rpcCalls: unknown[] = [];
    const service = new PolymarketFundingBalanceReadService(
      {
        ...completeConfig,
        polygonRpcUrl: "https://polygon-rpc.example",
        pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
        recognizeBridgedUsdcAsUsable: false
      },
      () => new StubBalanceAllowanceClient({ balance: "0", allowance: "0" }),
      {
        findAccount: async () => ({
          status: "ACTIVE",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      },
      (async (_url, init) => {
        rpcCalls.push(JSON.parse(`${init?.body ?? "{}"}`));
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2901f2" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).resolves.toMatchObject({
      usableBalance: "0",
      onchainPusdBalance: "2.687474",
      bridgedUsdcBalance: null,
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
    });

    expect(rpcCalls).toHaveLength(1);
    expect(JSON.stringify(rpcCalls[0])).toContain("70a08231");
  });

  it("uses verified on-chain pUSD allowance as a readiness fallback while CLOB allowance cache lags", async () => {
    const rpcCalls: unknown[] = [];
    const service = new PolymarketFundingBalanceReadService(
      {
        ...completeConfig,
        polygonRpcUrl: "https://polygon-rpc.example",
        pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
        pusdApprovalSpenderAddress: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
        recognizeBridgedUsdcAsUsable: false
      },
      () => new StubBalanceAllowanceClient({ balance: "8957410", allowance: "0" }),
      {
        findAccount: async () => ({
          status: "ACTIVE",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      },
      (async (_url, init) => {
        const payload = JSON.parse(`${init?.body ?? "{}"}`);
        rpcCalls.push(payload);
        const data = String(payload.params?.[0]?.data ?? "");
        const result = data.startsWith("0xdd62ed3e") ? "0x895440" : "0x895741";
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).resolves.toMatchObject({
      usableBalance: "9",
      onchainPusdBalance: "9.000769",
      onchainPusdAllowance: "9",
      usableBalanceSource: "ONCHAIN_PUSD_ALLOWANCE"
    });

    expect(rpcCalls).toHaveLength(2);
    expect(JSON.stringify(rpcCalls[1])).toContain("dd62ed3e");
  });

  it("does not treat legacy env pUSD approval as ready when CLOB reports a different spender set", async () => {
    const rpcCalls: unknown[] = [];
    const legacySpender = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
    const clobSpender = "0xE111180000d2663C0091e4f400237545B87B996B";
    const service = new PolymarketFundingBalanceReadService(
      {
        ...completeConfig,
        polygonRpcUrl: "https://polygon-rpc.example",
        pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
        pusdApprovalSpenderAddress: legacySpender,
        recognizeBridgedUsdcAsUsable: false
      },
      () => new StubBalanceAllowanceClient({
        balance: "8957410",
        allowances: { [clobSpender]: "0" }
      } as unknown as BalanceAllowanceResponse),
      {
        findAccount: async () => ({
          status: "ACTIVE",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      },
      (async (_url, init) => {
        const payload = JSON.parse(`${init?.body ?? "{}"}`);
        rpcCalls.push(payload);
        const data = String(payload.params?.[0]?.data ?? "").toLowerCase();
        const result = data.startsWith("0xdd62ed3e")
          ? data.includes(legacySpender.toLowerCase().replace(/^0x/, ""))
            ? "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            : "0x0"
          : "0x895741";
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).resolves.toMatchObject({
      usableBalance: "0",
      onchainPusdBalance: "9.000769",
      onchainPusdAllowance: "0",
      approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
      clobAllowanceSpenders: [{ spenderAddress: clobSpender, allowance: "0" }],
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
    });

    expect(rpcCalls).toHaveLength(2);
    expect(JSON.stringify(rpcCalls[1]).toLowerCase()).toContain(clobSpender.toLowerCase().replace(/^0x/, ""));
    expect(JSON.stringify(rpcCalls[1]).toLowerCase()).not.toContain(legacySpender.toLowerCase().replace(/^0x/, ""));
  });

  it("uses verified on-chain CLOB spender approvals when the server-side CLOB cache is stale", async () => {
    const clobSpenders = [
      "0xE111180000d2663C0091e4f400237545B87B996B",
      "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
      "0xe2222d279d744050d28e00520010520000310F59"
    ];
    const rpcCalls: unknown[] = [];
    const service = new PolymarketFundingBalanceReadService(
      {
        ...completeConfig,
        polygonRpcUrl: "https://polygon-rpc.example",
        pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
        recognizeBridgedUsdcAsUsable: false
      },
      () => new StubBalanceAllowanceClient({
        balance: "8957410",
        allowances: Object.fromEntries(clobSpenders.map((spender) => [spender, "0"]))
      } as unknown as BalanceAllowanceResponse),
      {
        findAccount: async () => ({
          status: "ACTIVE",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      },
      (async (_url, init) => {
        const payload = JSON.parse(`${init?.body ?? "{}"}`);
        rpcCalls.push(payload);
        const data = String(payload.params?.[0]?.data ?? "");
        const result = data.startsWith("0xdd62ed3e") ? "0x895440" : "0x895741";
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).resolves.toMatchObject({
      usableBalance: "9",
      collateralBalance: "9.000769",
      collateralAllowance: "9",
      onchainPusdBalance: "9.000769",
      onchainPusdAllowance: "9",
      approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
      clobAllowanceSpenders: clobSpenders.map((spender) => ({ spenderAddress: spender, allowance: "0" })),
      usableBalanceSource: "ONCHAIN_CLOB_SPENDER_ALLOWANCE"
    });

    expect(rpcCalls).toHaveLength(4);
    const serializedAllowanceCalls = rpcCalls.slice(1).map((call) => JSON.stringify(call).toLowerCase()).join("\n");
    for (const spender of clobSpenders) {
      expect(serializedAllowanceCalls).toContain(spender.toLowerCase().replace(/^0x/, ""));
    }
  });

  it("reports bridged Polygon USDC.e on the active deposit wallet without marking it ready to trade", async () => {
    const rpcCalls: unknown[] = [];
    const service = new PolymarketFundingBalanceReadService(
      {
        ...completeConfig,
        polygonRpcUrl: "https://polygon-rpc.example",
        pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
        bridgedUsdcTokenAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
      },
      () => new StubBalanceAllowanceClient({ balance: "0", allowance: "0" }),
      {
        findAccount: async () => ({
          status: "ACTIVE",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      },
      (async (_url, init) => {
        rpcCalls.push(JSON.parse(`${init?.body ?? "{}"}`));
        const result = rpcCalls.length === 1 ? "0x0" : "0x895440";
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).resolves.toMatchObject({
      usableBalance: "0",
      onchainPusdBalance: "0",
      bridgedUsdcBalance: "9",
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
    });

    expect(rpcCalls).toHaveLength(2);
    const secondRpcCall = rpcCalls[1] as { params: Array<{ to: string }> } | undefined;
    expect(secondRpcCall?.params[0]?.to.toLowerCase()).toBe("0x2791bca1f2de4661ed88a30c99a7a9449aa84174");
  });

  it("fails closed when user-scoped balance reads do not have an active deposit wallet", async () => {
    const service = new PolymarketFundingBalanceReadService(
      completeConfig,
      () => new StubBalanceAllowanceClient({ balance: "100000000", allowance: "100000000" }),
      {
        findAccount: async () => ({
          status: "PENDING",
          venueAccountAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
        })
      }
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).rejects.toThrow("Active Polymarket deposit wallet account is required");
  });

  it("fails closed when deposit-wallet mode is enabled but the account reader is unavailable", async () => {
    const service = new PolymarketFundingBalanceReadService(
      { ...completeConfig, requireUserDepositWallet: true },
      () => new StubBalanceAllowanceClient({ balance: "100000000", allowance: "100000000" })
    );

    await expect(service.readUsableBalance({
      userId: "user-1",
      fundingIntentId: "intent-1",
      routeLegId: "leg-1"
    })).rejects.toThrow("Active Polymarket deposit wallet account is required");
  });

  it("serves only the safe usableBalance response over a local internal route", async () => {
    const app = Fastify();
    const service = new PolymarketFundingBalanceReadService(
      completeConfig,
      () => new StubBalanceAllowanceClient({ balance: "50000000", allowance: "100000000" })
    );
    await registerInternalPolymarketFundingBalanceRoute(app, service, { nodeEnv: "development" });

    const response = await app.inject({ method: "GET", url: requestUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ usableBalance: "50" });
    const serialized = response.body;
    expect(serialized).not.toContain("server-side-key");
    expect(serialized).not.toContain("server-side-secret");
    expect(serialized).not.toContain("allowance");
  });

  it("requires bearer auth when an internal read token is configured", async () => {
    const app = Fastify();
    const service = new PolymarketFundingBalanceReadService(
      completeConfig,
      () => new StubBalanceAllowanceClient({ balance: "100000000", allowance: "100000000" })
    );
    await registerInternalPolymarketFundingBalanceRoute(app, service, {
      bearerToken: "internal-read-token",
      nodeEnv: "production"
    });

    const unauthorized = await app.inject({ method: "GET", url: requestUrl });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: requestUrl,
      headers: { authorization: "Bearer internal-read-token" }
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({ usableBalance: "100" });
  });
});
