import type { Logger } from "pino";
import { z } from "zod";
import type { RedisClient } from "../db/redis.js";
import { wsConnectionsActive } from "../observability/metrics.js";

const SUBSCRIPTION_MESSAGE_SCHEMA = z.object({
  action: z.enum(["subscribe", "unsubscribe"]),
  topic: z.string().regex(/^rfq:[^:]+$/)
});

const BROADCAST_EVENT_SCHEMA = z.object({
  type: z.enum(["QUOTE_RECEIVED", "STATE_TRANSITION", "EXECUTION_UPDATE"]),
  topic: z.string().regex(/^rfq:[^:]+$/),
  emittedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown())
});

type SubscriptionMessage = z.infer<typeof SUBSCRIPTION_MESSAGE_SCHEMA>;
export type RFQBroadcastEvent = z.infer<typeof BROADCAST_EVENT_SCHEMA>;

interface GatewaySocket {
  readyState: number;
  bufferedAmount: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message" | "close" | "pong", listener: (...args: unknown[]) => void): void;
}

interface SocketState {
  isAlive: boolean;
  topics: Set<string>;
}

export interface RFQWebSocketGatewayConfig {
  publisher: RedisClient;
  subscriber: RedisClient;
  logger: Pick<Logger, "warn" | "error">;
  redisChannel?: string;
  heartbeatIntervalMs?: number;
  slowClientBufferedAmountBytes?: number;
}

const SOCKET_OPEN = 1;
const DEFAULT_REDIS_CHANNEL = "rfq:gateway:events";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_SLOW_CLIENT_BUFFER_BYTES = 256 * 1024;

export class RFQWebSocketGateway {
  private readonly publisher: RedisClient;
  private readonly subscriber: RedisClient;
  private readonly logger: Pick<Logger, "warn" | "error">;
  private readonly redisChannel: string;
  private readonly heartbeatIntervalMs: number;
  private readonly slowClientBufferedAmountBytes: number;
  private readonly topicSubscribers = new Map<string, Set<GatewaySocket>>();
  private readonly socketState = new Map<GatewaySocket, SocketState>();
  private readonly onRedisMessageBound: (channel: string, message: string) => void;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  public constructor(config: RFQWebSocketGatewayConfig) {
    this.publisher = config.publisher;
    this.subscriber = config.subscriber;
    this.logger = config.logger;
    this.redisChannel = config.redisChannel ?? DEFAULT_REDIS_CHANNEL;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.slowClientBufferedAmountBytes =
      config.slowClientBufferedAmountBytes ?? DEFAULT_SLOW_CLIENT_BUFFER_BYTES;
    this.onRedisMessageBound = (channel, message) => {
      this.onRedisMessage(channel, message);
    };
  }

  public async start(): Promise<void> {
    await this.subscriber.connect();
    await this.subscriber.subscribe(this.redisChannel);
    this.subscriber.on("message", this.onRedisMessageBound);
    this.heartbeatTimer = setInterval(() => {
      this.performHeartbeatSweep();
    }, this.heartbeatIntervalMs);
  }

  public async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    this.subscriber.off("message", this.onRedisMessageBound);
    await this.subscriber.unsubscribe(this.redisChannel);
    await this.subscriber.quit();

    for (const socket of this.socketState.keys()) {
      socket.close(1001, "Server shutdown");
    }

    this.topicSubscribers.clear();
    this.socketState.clear();
  }

  public registerConnection(socket: GatewaySocket): void {
    this.socketState.set(socket, {
      isAlive: true,
      topics: new Set<string>()
    });
    wsConnectionsActive.inc();

    socket.on("pong", () => {
      const state = this.socketState.get(socket);
      if (state) {
        state.isAlive = true;
      }
    });

    socket.on("message", (raw) => {
      if (typeof raw !== "string" && !Buffer.isBuffer(raw)) {
        this.sendJson(socket, {
          type: "ERROR",
          code: "INVALID_MESSAGE_TYPE",
          message: "WebSocket message must be text or buffer."
        });
        return;
      }

      this.handleClientMessage(socket, raw);
    });

    socket.on("close", () => {
      this.unregisterConnection(socket);
    });

    this.sendJson(socket, {
      type: "GATEWAY_READY",
      message: "WebSocket connected."
    });
  }

  public async publishEvent(event: RFQBroadcastEvent): Promise<void> {
    const message = JSON.stringify(event);
    await this.publisher.publish(this.redisChannel, message);
  }

  private onRedisMessage(channel: string, message: string): void {
    if (channel !== this.redisChannel) {
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message);
    } catch {
      this.logger.warn({ message }, "Invalid JSON received from Redis pub/sub.");
      return;
    }

    const parsed = BROADCAST_EVENT_SCHEMA.safeParse(parsedJson);
    if (!parsed.success) {
      this.logger.warn(
        { details: parsed.error.flatten() },
        "Invalid RFQ WebSocket broadcast payload received."
      );
      return;
    }

    this.broadcastToTopic(parsed.data.topic, parsed.data);
  }

  private handleClientMessage(socket: GatewaySocket, raw: Buffer | string): void {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      this.sendJson(socket, {
        type: "ERROR",
        code: "INVALID_JSON",
        message: "Message must be valid JSON."
      });
      return;
    }

    const parsed = SUBSCRIPTION_MESSAGE_SCHEMA.safeParse(parsedJson);
    if (!parsed.success) {
      this.sendJson(socket, {
        type: "ERROR",
        code: "INVALID_SUBSCRIPTION_MESSAGE",
        message: "Message must include valid action and topic."
      });
      return;
    }

    this.applySubscription(socket, parsed.data);
  }

  private applySubscription(socket: GatewaySocket, message: SubscriptionMessage): void {
    const state = this.socketState.get(socket);
    if (!state) {
      return;
    }

    if (message.action === "subscribe") {
      state.topics.add(message.topic);
      const subscribers = this.topicSubscribers.get(message.topic) ?? new Set<GatewaySocket>();
      subscribers.add(socket);
      this.topicSubscribers.set(message.topic, subscribers);
      this.sendJson(socket, {
        type: "SUBSCRIBED",
        topic: message.topic
      });
      return;
    }

    state.topics.delete(message.topic);
    const subscribers = this.topicSubscribers.get(message.topic);
    if (subscribers) {
      subscribers.delete(socket);
      if (subscribers.size === 0) {
        this.topicSubscribers.delete(message.topic);
      }
    }

    this.sendJson(socket, {
      type: "UNSUBSCRIBED",
      topic: message.topic
    });
  }

  private broadcastToTopic(topic: string, event: RFQBroadcastEvent): void {
    const subscribers = this.topicSubscribers.get(topic);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const serialized = JSON.stringify({
      type: event.type,
      topic: event.topic,
      emittedAt: event.emittedAt,
      payload: event.payload
    });

    for (const socket of subscribers) {
      if (socket.readyState !== SOCKET_OPEN) {
        this.unregisterConnection(socket);
        continue;
      }

      if (socket.bufferedAmount > this.slowClientBufferedAmountBytes) {
        this.logger.warn(
          { topic, bufferedAmount: socket.bufferedAmount },
          "Closing slow WebSocket client."
        );
        socket.close(1013, "Slow consumer");
        this.unregisterConnection(socket);
        continue;
      }

      socket.send(serialized);
    }
  }

  private performHeartbeatSweep(): void {
    for (const [socket, state] of this.socketState.entries()) {
      if (socket.readyState !== SOCKET_OPEN) {
        this.unregisterConnection(socket);
        continue;
      }

      if (socket.bufferedAmount > this.slowClientBufferedAmountBytes) {
        this.logger.warn(
          { bufferedAmount: socket.bufferedAmount },
          "Terminating slow WebSocket client."
        );
        socket.terminate();
        this.unregisterConnection(socket);
        continue;
      }

      if (!state.isAlive) {
        socket.terminate();
        this.unregisterConnection(socket);
        continue;
      }

      state.isAlive = false;
      socket.ping();
    }
  }

  private unregisterConnection(socket: GatewaySocket): void {
    const state = this.socketState.get(socket);
    if (!state) {
      return;
    }

    for (const topic of state.topics.values()) {
      const subscribers = this.topicSubscribers.get(topic);
      if (!subscribers) {
        continue;
      }

      subscribers.delete(socket);
      if (subscribers.size === 0) {
        this.topicSubscribers.delete(topic);
      }
    }

    this.socketState.delete(socket);
    wsConnectionsActive.dec();
  }

  private sendJson(socket: GatewaySocket, payload: Record<string, unknown>): void {
    if (socket.readyState !== SOCKET_OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }
}
