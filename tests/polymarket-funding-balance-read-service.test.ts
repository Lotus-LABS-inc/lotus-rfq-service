import Fastify from "fastify";
import { AssetType, type BalanceAllowanceResponse } from "@polymarket/clob-client-v2";
import { describe, expect, it } from "vitest";
import { registerInternalPolymarketFundingBalanceRoute } from "../src/api/routes/internal-polymarket-funding-balance.js";
import {
  PolymarketFundingBalanceReadService,
  buildPolymarketFundingBalanceReadConfigFromEnv,
  type PolymarketBalanceAllowanceClient
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

  it("stays disabled unless explicit internal balance-read config is enabled", () => {
    expect(buildPolymarketFundingBalanceReadConfigFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      clobHost: undefined
    });
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
