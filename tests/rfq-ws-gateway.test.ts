import { afterEach, describe, expect, it, vi } from "vitest";
import type { RedisClient } from "../src/db/redis.js";
import { marketOrderbookTopic } from "../src/services/orderbook-stream.service.js";
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

  public async incrbyfloat(): Promise<string> {
    return "0";
  }

  public async eval(): Promise<unknown> {
    return 1;
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

  public async zrem(): Promise<number> {
    return 1;
  }

  public async zrangebyscore(key: string, min: number | string, max: number | string, limitLiteral?: "LIMIT", offset?: number, count?: number): Promise<string[]> {
    return [];
  }

  public async zrevrange(): Promise<string[]> {
    return [];
  }

  public async hset(): Promise<number> {
    return 1;
  }

  public async hget(): Promise<string | null> {
    return null;
  }

  public async hdel(): Promise<number> {
    return 1;
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

class FlakyRedisSubscriber extends FakeRedisClient {
  public connectAttempts = 0;

  public async connect(): Promise<unknown> {
    this.connectAttempts += 1;
    if (this.connectAttempts === 1) {
      throw new Error("Connection is closed.");
    }
    return undefined;
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

  it("broadcasts execution status updates to subscribed execution quote topics", async () => {
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
    socket.emit("message", JSON.stringify({ action: "subscribe", topic: "execution:quote:exec_quote_123" }));

    await gateway.publishEvent({
      type: "EXECUTION_STATUS_UPDATE",
      topic: "execution:quote:exec_quote_123",
      emittedAt: "2026-02-25T10:00:00.000Z",
      payload: { executionId: "exec_quote_123", status: "FILLED" }
    });

    const payloads = socket.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    const executionEvent = payloads.find((entry) => entry.type === "EXECUTION_STATUS_UPDATE");
    expect(executionEvent).toBeTruthy();
    expect(executionEvent?.payload).toEqual({ executionId: "exec_quote_123", status: "FILLED" });

    await gateway.stop();
  });

  it("broadcasts notification and portfolio mark updates to subscribed user topics", async () => {
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
    socket.emit("message", JSON.stringify({ action: "subscribe", topic: "notifications:user:user-1" }));
    socket.emit("message", JSON.stringify({ action: "subscribe", topic: "execution:portfolio:user-1" }));

    await gateway.publishEvent({
      type: "USER_NOTIFICATION",
      topic: "notifications:user:user-1",
      emittedAt: "2026-02-25T10:00:00.000Z",
      payload: { notification: { notificationId: "notice-1" } }
    });
    await gateway.publishEvent({
      type: "EXECUTION_MARK_UPDATE",
      topic: "execution:portfolio:user-1",
      emittedAt: "2026-02-25T10:00:01.000Z",
      payload: { marketId: "market-1", positions: [] }
    });

    const payloads = socket.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    expect(payloads.find((entry) => entry.type === "USER_NOTIFICATION")?.payload)
      .toEqual({ notification: { notificationId: "notice-1" } });
    expect(payloads.find((entry) => entry.type === "EXECUTION_MARK_UPDATE")?.payload)
      .toEqual({ marketId: "market-1", positions: [] });

    await gateway.stop();
  });

  it("broadcasts market orderbook updates to subscribed market topics", async () => {
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
    const topic = marketOrderbookTopic("OFFICE_WINNER|SEOUL|MAYOR|2026", "YES");
    gateway.registerConnection(socket);
    socket.emit("message", JSON.stringify({ action: "subscribe", topic }));

    await gateway.publishEvent({
      type: "MARKET_ORDERBOOK_UPDATE",
      topic,
      emittedAt: "2026-05-23T10:00:00.000Z",
      payload: { venue: "POLYMARKET", bestBid: "0.49", bestAsk: "0.51" }
    });

    const payloads = socket.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    expect(payloads.find((entry) => entry.type === "MARKET_ORDERBOOK_UPDATE")?.payload)
      .toEqual({ venue: "POLYMARKET", bestBid: "0.49", bestAsk: "0.51" });

    await gateway.stop();
  });

  it("does not fail service startup when Redis subscriber is temporarily unavailable", async () => {
    vi.useFakeTimers();
    const bus = new FakeRedisBus();
    const subscriber = new FlakyRedisSubscriber(bus);
    const logger = { warn: vi.fn(), error: vi.fn() };
    const gateway = new RFQWebSocketGateway({
      publisher: new FakeRedisClient(bus),
      subscriber,
      logger
    });

    await expect(gateway.start()).resolves.toBeUndefined();
    expect(subscriber.connectAttempts).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ retryDelayMs: 5000 }),
      "RFQ WebSocket Redis subscription unavailable. Retrying in the background."
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(subscriber.connectAttempts).toBe(2);

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
