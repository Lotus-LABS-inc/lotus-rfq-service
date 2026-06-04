import { describe, expect, it, vi } from "vitest";
import type { VenueOrderbookSubscriptionTarget } from "../src/services/orderbook-stream.service.js";

class FakeSocket {
  public readyState = 1;
  public sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event?: any) => void>>();

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {}

  public addEventListener(type: "open" | "close" | "error" | "message", listener: (event?: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  public emit(type: "open" | "close" | "error" | "message", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(type === "message" ? { data } : data);
    }
  }
}

const limitlessSdkMock = vi.hoisted(() => ({
  instances: [] as Array<{
    connectCalls: number;
    subscribeCalls: number;
    subscriptions: unknown[];
  }>,
  failSubscribeOnce: false
}));

const opinionSdkMock = vi.hoisted(() => ({
  instances: [] as Array<{
    connectCalls: number;
    subscribeCalls: number;
    subscriptions: number[];
    isConnected: boolean;
  }>,
  failSubscribeOnce: false
}));

vi.mock("@limitless-exchange/sdk", () => ({
  DEFAULT_WS_URL: "wss://limitless.test/ws",
  WebSocketClient: class {
    public connectCalls = 0;
    public subscribeCalls = 0;
    public subscriptions: unknown[] = [];

    public constructor() {
      limitlessSdkMock.instances.push(this);
    }

    public on(): void {}

    public async connect(): Promise<void> {
      this.connectCalls += 1;
    }

    public async subscribe(_topic: string, payload: unknown): Promise<void> {
      this.subscribeCalls += 1;
      if (limitlessSdkMock.failSubscribeOnce) {
        limitlessSdkMock.failSubscribeOnce = false;
        throw new Error("WebSocket not connected. Call connect() first.");
      }
      this.subscriptions.push(payload);
    }

    public async unsubscribe(): Promise<void> {}

    public async disconnect(): Promise<void> {}
  }
}));

vi.mock("@opinion-labs/opinion-clob-sdk", () => ({
  WebSocketClient: class {
    public connectCalls = 0;
    public subscribeCalls = 0;
    public subscriptions: number[] = [];
    public isConnected = false;

    public constructor() {
      opinionSdkMock.instances.push(this);
    }

    public async connect(): Promise<void> {
      this.connectCalls += 1;
      this.isConnected = true;
    }

    public subscribeMarketDepthDiff(marketId: number): void {
      this.subscribeCalls += 1;
      if (opinionSdkMock.failSubscribeOnce) {
        opinionSdkMock.failSubscribeOnce = false;
        this.isConnected = false;
        throw new Error("WebSocket is not connected. Call connect() first.");
      }
      if (!this.isConnected) {
        throw new Error("WebSocket is not connected. Call connect() first.");
      }
      this.subscriptions.push(marketId);
    }

    public unsubscribeMarketDepthDiff(): void {}

    public close(): void {
      this.isConnected = false;
    }
  }
}));

describe("LimitlessSdkOrderbookConnector", () => {
  it("reconnects once when the SDK reports a dropped websocket during subscribe", async () => {
    const { LimitlessSdkOrderbookConnector } = await import("../src/integrations/orderbook-stream-connectors.js");
    limitlessSdkMock.instances.length = 0;
    limitlessSdkMock.failSubscribeOnce = true;
    const warn = vi.fn();
    const connector = new LimitlessSdkOrderbookConnector({
      logger: { warn }
    });
    const target: VenueOrderbookSubscriptionTarget = {
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      venue: "LIMITLESS",
      venueMarketId: "limitless-market-1",
      venueOutcomeId: "YES"
    };

    await connector.subscribe([target], vi.fn());

    const client = limitlessSdkMock.instances[0];
    expect(client).toBeTruthy();
    expect(client?.connectCalls).toBe(2);
    expect(client?.subscribeCalls).toBe(2);
    expect(client?.subscriptions).toEqual([
      { marketSlugs: ["limitless-market-1"] }
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ venue: "LIMITLESS", targetCount: 1 }),
      "Limitless websocket disconnected during subscribe; reconnecting once."
    );
  });
});

describe("OpinionSdkOrderbookConnector", () => {
  it("reconnects once when the SDK reports a dropped websocket during subscribe", async () => {
    const { OpinionSdkOrderbookConnector } = await import("../src/integrations/orderbook-stream-connectors.js");
    opinionSdkMock.instances.length = 0;
    opinionSdkMock.failSubscribeOnce = true;
    const warn = vi.fn();
    const connector = new OpinionSdkOrderbookConnector({
      apiKey: "opinion-key",
      walletAddress: "0x0000000000000000000000000000000000000001",
      logger: { warn }
    });
    const target: VenueOrderbookSubscriptionTarget = {
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      venue: "OPINION",
      venueMarketId: "6818",
      venueOutcomeId: "61908768"
    };

    await connector.subscribe([target], vi.fn());

    const client = opinionSdkMock.instances[0];
    expect(client).toBeTruthy();
    expect(client?.connectCalls).toBe(2);
    expect(client?.subscribeCalls).toBe(2);
    expect(client?.subscriptions).toEqual([6818]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ venue: "OPINION", targetCount: 1 }),
      "Opinion websocket disconnected during subscribe; reconnecting once."
    );
  });
});

describe("PredictWebSocketOrderbookConnector", () => {
  it("uses Predict's documented websocket params and unwraps predictOrderbook messages", async () => {
    const { PredictWebSocketOrderbookConnector } = await import("../src/integrations/orderbook-stream-connectors.js");
    const socket = new FakeSocket();
    const connector = new PredictWebSocketOrderbookConnector({
      url: "wss://ws.predict.fun/ws",
      environment: "mainnet",
      webSocketFactory: () => socket
    });
    const target: VenueOrderbookSubscriptionTarget = {
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      venue: "PREDICT_FUN",
      venueMarketId: "14344",
      venueOutcomeId: "YES"
    };
    const onSnapshot = vi.fn();

    await connector.subscribe([target], onSnapshot);
    socket.emit("open");

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      method: "subscribe",
      params: ["predictOrderbook/14344"],
      requestId: 1
    });

    socket.emit("message", JSON.stringify({
      type: "M",
      topic: "predictOrderbook/14344",
      data: {
        marketId: "14344",
        bids: [[0.41, 10]],
        asks: [[0.43, 12]],
        timestamp: "2026-05-23T12:00:00.000Z"
      }
    }));

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    const firstSnapshot = onSnapshot.mock.calls[0]?.[0];
    expect(firstSnapshot).toMatchObject({
      venue: "PREDICT_FUN",
      venueMarketId: "14344",
      bids: [{ price: "0.41", size: "10" }],
      asks: [{ price: "0.43", size: "12" }],
      source: "STREAM"
    });
  });
});
