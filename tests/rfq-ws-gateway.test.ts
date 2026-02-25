import { afterEach, describe, expect, it, vi } from "vitest";
import type { RedisClient } from "../src/db/redis.js";
import { RFQWebSocketGateway } from "../src/ws/rfq-ws-gateway.js";

class FakeRedisBus {
  public readonly subscribers = new Set<FakeRedisClient>();
}

class FakeRedisClient implements RedisClient {
  private readonly messageListeners = new Set<(channel: string, message: string) => void>();
  private readonly subscribedChannels = new Set<string>();

  public constructor(private readonly bus: FakeRedisBus) {
    this.bus.subscribers.add(this);
  }

  public async connect(): Promise<unknown> {
    return undefined;
  }

  public async quit(): Promise<string> {
    return "OK";
  }

  public duplicate(): RedisClient {
    return new FakeRedisClient(this.bus);
  }

  public async publish(channel: string, message: string): Promise<number> {
    for (const client of this.bus.subscribers) {
      if (!client.subscribedChannels.has(channel)) {
        continue;
      }

      client.emitMessage(channel, message);
    }

    return 1;
  }

  public async subscribe(...channels: string[]): Promise<number> {
    for (const channel of channels) {
      this.subscribedChannels.add(channel);
    }

    return this.subscribedChannels.size;
  }

  public async unsubscribe(...channels: string[]): Promise<number> {
    for (const channel of channels) {
      this.subscribedChannels.delete(channel);
    }

    return this.subscribedChannels.size;
  }

  public on(
    event: "connect" | "error" | "end" | "pmessage" | "message",
    listener:
      | (() => void)
      | ((error: Error) => void)
      | ((pattern: string, channel: string, message: string) => void)
      | ((channel: string, message: string) => void)
  ): RedisClient {
    if (event === "message") {
      this.messageListeners.add(listener as (channel: string, message: string) => void);
    }

    return this;
  }

  public off(
    event: "pmessage" | "message",
    listener:
      | ((pattern: string, channel: string, message: string) => void)
      | ((channel: string, message: string) => void)
  ): RedisClient {
    if (event === "message") {
      this.messageListeners.delete(listener as (channel: string, message: string) => void);
    }

    return this;
  }

  public async set(): Promise<"OK" | null> {
    return "OK";
  }

  public async get(): Promise<string | null> {
    return null;
  }

  public async expire(): Promise<number> {
    return 1;
  }

  public async ttl(): Promise<number> {
    return 60;
  }

  public async del(): Promise<number> {
    return 1;
  }

  public async zadd(): Promise<number> {
    return 1;
  }

  public async zrevrange(): Promise<string[]> {
    return [];
  }

  public async psubscribe(): Promise<number> {
    return 1;
  }

  public async punsubscribe(): Promise<number> {
    return 1;
  }

  private emitMessage(channel: string, message: string): void {
    for (const listener of this.messageListeners) {
      listener(channel, message);
    }
  }
}

class FakeSocket {
  public readyState = 1;
  public bufferedAmount = 0;
  public sent: string[] = [];
  public pinged = 0;
  public closed = 0;
  public terminated = 0;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  public send(data: string): void {
    this.sent.push(data);
  }

  public ping(): void {
    this.pinged += 1;
  }

  public close(): void {
    this.closed += 1;
    this.emit("close");
  }

  public terminate(): void {
    this.terminated += 1;
    this.emit("close");
  }

  public on(event: "message" | "close" | "pong", listener: (...args: unknown[]) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  public emit(event: "message" | "close" | "pong", ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }
}

describe("RFQWebSocketGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts QUOTE_RECEIVED to subscribed rfq topic through redis pub/sub", async () => {
    const bus = new FakeRedisBus();
    const publisher = new FakeRedisClient(bus);
    const subscriber = new FakeRedisClient(bus);
    const gateway = new RFQWebSocketGateway({
      publisher,
      subscriber,
      logger: { warn: vi.fn(), error: vi.fn() }
    });

    await gateway.start();
    const socket = new FakeSocket();
    gateway.registerConnection(socket);
    socket.emit("message", JSON.stringify({ action: "subscribe", topic: "rfq:session-1" }));

    await gateway.publishEvent({
      type: "QUOTE_RECEIVED",
      topic: "rfq:session-1",
      emittedAt: "2026-02-25T10:00:00.000Z",
      payload: { quoteId: "q1" }
    });

    const payloads = socket.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    const quoteEvent = payloads.find((entry) => entry.type === "QUOTE_RECEIVED");
    expect(quoteEvent).toBeTruthy();
    expect(quoteEvent?.payload).toEqual({ quoteId: "q1" });

    await gateway.stop();
  });

  it("terminates unresponsive and slow clients during heartbeat sweep", async () => {
    vi.useFakeTimers();
    const bus = new FakeRedisBus();
    const gateway = new RFQWebSocketGateway({
      publisher: new FakeRedisClient(bus),
      subscriber: new FakeRedisClient(bus),
      logger: { warn: vi.fn(), error: vi.fn() },
      heartbeatIntervalMs: 100,
      slowClientBufferedAmountBytes: 10
    });

    await gateway.start();
    const unresponsiveSocket = new FakeSocket();
    const slowSocket = new FakeSocket();
    slowSocket.bufferedAmount = 100;

    gateway.registerConnection(unresponsiveSocket);
    gateway.registerConnection(slowSocket);

    vi.advanceTimersByTime(250);

    expect(unresponsiveSocket.terminated).toBeGreaterThanOrEqual(1);
    expect(slowSocket.terminated).toBeGreaterThanOrEqual(1);

    await gateway.stop();
  });
});
