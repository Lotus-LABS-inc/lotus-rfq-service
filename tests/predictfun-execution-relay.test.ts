import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPredictfunExecutionRelayServer } from "../src/predictfun-execution-relay.js";
import {
  createPredictfunRelayNonce,
  predictfunRelayHeaders,
  signPredictfunRelayRequest
} from "../src/execution-system/predictfun-execution-relay-auth.js";
import { RelayPredictOauthOrderClient } from "../src/integrations/predict/predict-oauth-order-client.js";

const secret = "predictfun-relay-secret";
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Predict.fun execution relay", () => {
  it("accepts valid HMAC submit requests and forwards to Predict.fun /v1/orders with bearer JWT", async () => {
    process.env.PREDICT_FUN_EXECUTION_RELAY_SECRET = secret;
    process.env.PREDICT_MAINNET_BASE_URL = "https://api.predict.fun";
    process.env.PREDICT_API_KEY = "predict-api-key";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.predict.fun/v1/orders");
      expect(init.headers).toMatchObject({
        "x-api-key": "predict-api-key",
        authorization: "Bearer predict-user-jwt"
      });
      const body = JSON.parse(String(init.body));
      expect(body.data.order.signature).toBe(`0x${"a".repeat(130)}`);
      return jsonResponse(200, {
        success: true,
        data: {
          orderId: "predict-order-1",
          orderHash: "predict-hash-1"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildPredictfunExecutionRelayServer();
    const body = {
      payload: signedPayload(),
      jwt: "predict-user-jwt"
    };
    const response = await app.inject({
      method: "POST",
      url: "/internal/predictfun/v1/submit-order",
      headers: signedHeaders("/internal/predictfun/v1/submit-order", body),
      payload: body
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      orderId: "predict-order-1",
      orderHash: "predict-hash-1"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects missing, stale, and tampered HMAC requests", async () => {
    process.env.PREDICT_FUN_EXECUTION_RELAY_SECRET = secret;
    const app = buildPredictfunExecutionRelayServer();
    const body = { payload: signedPayload(), jwt: "predict-user-jwt" };

    const missing = await app.inject({
      method: "POST",
      url: "/internal/predictfun/v1/submit-order",
      payload: body
    });
    expect(missing.statusCode).toBe(401);

    const staleHeaders = signedHeaders("/internal/predictfun/v1/submit-order", body, new Date(0).toISOString());
    const stale = await app.inject({
      method: "POST",
      url: "/internal/predictfun/v1/submit-order",
      headers: staleHeaders,
      payload: body
    });
    expect(stale.statusCode).toBe(403);

    const tampered = await app.inject({
      method: "POST",
      url: "/internal/predictfun/v1/submit-order",
      headers: signedHeaders("/internal/predictfun/v1/submit-order", body),
      payload: { ...body, jwt: "different-jwt" }
    });
    expect(tampered.statusCode).toBe(403);
    await app.close();
  });

  it("exposes status and reserved cancel routes through the relay contract", async () => {
    process.env.PREDICT_FUN_EXECUTION_RELAY_SECRET = secret;
    process.env.PREDICT_MAINNET_BASE_URL = "https://api.predict.fun";
    process.env.PREDICT_API_KEY = "predict-api-key";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ authorization: "Bearer predict-user-jwt" });
      return jsonResponse(200, {
      success: true,
      data: {
        status: "SETTLED",
        size: "1",
        remainingSize: "0",
        price: "0.45"
      }
      });
    }));
    const app = buildPredictfunExecutionRelayServer();
    const stateBody = { orderHash: "predict-hash-1", jwt: "predict-user-jwt" };
    const state = await app.inject({
      method: "POST",
      url: "/internal/predictfun/v1/order-state",
      headers: signedHeaders("/internal/predictfun/v1/order-state", stateBody),
      payload: stateBody
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      orderHash: "predict-hash-1",
      status: "SETTLED"
    });

    const cancelBody = { orderHash: "predict-hash-1" };
    const cancel = await app.inject({
      method: "POST",
      url: "/internal/predictfun/v1/cancel-order",
      headers: signedHeaders("/internal/predictfun/v1/cancel-order", cancelBody),
      payload: cancelBody
    });
    expect(cancel.statusCode).toBe(501);
    expect(cancel.json()).toMatchObject({ code: "PREDICT_FUN_CANCEL_NOT_IMPLEMENTED" });
    await app.close();
  });

  it("relay client signs submit, status, and cancel requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new RelayPredictOauthOrderClient({
      relayUrl: "https://predict-relay.example",
      relaySecret: secret,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/cancel-order")) return jsonResponse(200, { cancelled: false });
        if (url.endsWith("/order-state")) {
          return jsonResponse(200, {
            orderHash: "hash-1",
            status: "OPEN",
            size: "1",
            remainingSize: "1",
            price: "0.45",
            raw: {}
          });
        }
        return jsonResponse(200, { orderId: "order-1", orderHash: "hash-1" });
      }) as typeof fetch
    });
    await client.createOauthOrder(signedPayload(), "predict-user-jwt");
    await client.getOrderByHash("hash-1", "predict-user-jwt");
    await expect(client.cancelOrder("hash-1")).resolves.toEqual({ cancelled: false });

    expect(calls.map((call) => call.url)).toEqual([
      "https://predict-relay.example/internal/predictfun/v1/submit-order",
      "https://predict-relay.example/internal/predictfun/v1/order-state",
      "https://predict-relay.example/internal/predictfun/v1/cancel-order"
    ]);
    for (const call of calls) {
      expect(call.init.headers).toMatchObject({
        [predictfunRelayHeaders.signature]: expect.any(String)
      });
      expect(JSON.stringify(call.init.headers)).not.toContain("predict-user-jwt");
    }
    expect(calls.map((call) => JSON.parse(String(call.init.body)))).toMatchObject([
      { jwt: "predict-user-jwt" },
      { jwt: "predict-user-jwt", orderHash: "hash-1" },
      { orderHash: "hash-1" }
    ]);
  });
});

const signedPayload = () => ({
  signer: "0x1111111111111111111111111111111111111111",
  account: "0x2222222222222222222222222222222222222222",
  signature: `0x${"a".repeat(130)}`,
  data: {
    timestamp: Date.now(),
    pricePerShare: "450000000000000000",
    strategy: "LIMIT",
    order: {
      hash: `0x${"b".repeat(64)}`,
      maker: "0x2222222222222222222222222222222222222222",
      signer: "0x2222222222222222222222222222222222222222",
      tokenId: "123456",
      makerAmount: "450000000000000000",
      takerAmount: "1000000000000000000",
      side: 0,
      signatureType: 0
    }
  }
});

const signedHeaders = (
  path: string,
  body: Record<string, unknown>,
  timestamp = new Date().toISOString()
): Record<string, string> => {
  const nonce = createPredictfunRelayNonce();
  return {
    [predictfunRelayHeaders.timestamp]: timestamp,
    [predictfunRelayHeaders.nonce]: nonce,
    [predictfunRelayHeaders.signature]: signPredictfunRelayRequest(secret, {
      timestamp,
      nonce,
      method: "POST",
      path,
      body
    })
  };
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as Response;
