import { describe, expect, it, vi } from "vitest";

import { PredictWsClient } from "../../src/integrations/predict/predict-ws-client.js";
import { PredictOrderbookRecorder } from "../../src/recorders/predict-orderbook-recorder.js";

class FakeSocket {
  public readyState = 1;
  private readonly listeners = new Map<string, Array<(event: any) => void>>();
  public sent: string[] = [];

  public addEventListener(type: "open" | "close" | "error" | "message", listener: (event: any) => void): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {}

  public emit(type: "open" | "message", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(type === "message" ? { data } : {});
    }
  }
}

describe("Predict websocket recorder integration", () => {
  it("subscribes, handles websocket envelopes, and records normalized orderbooks", async () => {
    const socket = new FakeSocket();
    const wsClient = new PredictWsClient({
      environment: "testnet",
      url: "wss://example.invalid",
      webSocketFactory: () => socket
    });
    const recordSnapshot = vi.fn(async () => undefined);
    const recorder = new PredictOrderbookRecorder({
      wsClient,
      normalizeSnapshot: (envelope) => ({
        venue: "PREDICT",
        environment: "testnet",
        marketId: String(envelope.payload.marketId),
        sourceTimestamp: new Date("2026-03-27T10:00:00.000Z"),
        bids: [{ price: "0.40", size: "10", raw: {} }],
        asks: [{ price: "0.42", size: "12", raw: {} }],
        bestBid: "0.40",
        bestAsk: "0.42",
        spread: "0.02",
        midpoint: "0.41",
        topOfBookSize: "22",
        raw: envelope.payload
      }),
      subscriptionRequestFactory: (topics) => ({ action: "subscribe", topics })
    });
    recorder.recordSnapshot = recordSnapshot;

    recorder.start(["market:m-1:orderbook"]);
    socket.emit("open");
    socket.emit("message", JSON.stringify({ marketId: "m-1", bids: [], asks: [] }));

    await vi.waitFor(() => {
      expect(recordSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(socket.sent[0]).toContain("market:m-1:orderbook");
  });
});
