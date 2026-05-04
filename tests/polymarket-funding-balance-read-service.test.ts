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

  public constructor(private readonly response: BalanceAllowanceResponse) {}

  public async getBalanceAllowance(params: { asset_type: AssetType }): Promise<BalanceAllowanceResponse> {
    this.lastAssetType = params.asset_type;
    return this.response;
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

    expect(result).toEqual({ usableBalance: "100" });
    expect(client.lastAssetType).toBe(AssetType.COLLATERAL);
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

    expect(result).toEqual({ usableBalance: "90" });
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
      POLYMARKET_POLYGON_RPC_URL: "",
      POLYGON_RPC_URL: ""
    } as NodeJS.ProcessEnv)).toMatchObject({
      polygonRpcUrl: "https://polygon-bor-rpc.publicnode.com",
      pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
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
    })).resolves.toEqual({ usableBalance: "100" });

    expect(capturedConfigs[0]).toMatchObject({
      funderAddress: "0x6867bD6B5fd147af7B7AFc7b4aee0bABb140e0cB"
    });
  });

  it("falls back to on-chain pUSD balance for active deposit wallets when CLOB usable balance is zero", async () => {
    const rpcCalls: unknown[] = [];
    const service = new PolymarketFundingBalanceReadService(
      {
        ...completeConfig,
        polygonRpcUrl: "https://polygon-rpc.example",
        pusdTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
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
    })).resolves.toEqual({ usableBalance: "2.687474" });

    expect(rpcCalls).toHaveLength(1);
    expect(JSON.stringify(rpcCalls[0])).toContain("70a08231");
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
