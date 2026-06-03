import { describe, expect, it, vi } from "vitest";
import type { VenueOrderbookSubscriptionTarget } from "../src/services/orderbook-stream.service.js";

const limitlessSdkMock = vi.hoisted(() => ({
  instances: [] as Array<{
    connectCalls: number;
    subscribeCalls: number;
    subscriptions: unknown[];
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
