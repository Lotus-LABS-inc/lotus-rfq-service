import { createRequire } from "node:module";
import type { Logger } from "pino";

export interface RedisModuleConfig {
  redisUrl: string;
  logger: Logger;
}

export interface RedisClient {
  connect(): Promise<unknown>;
  quit(): Promise<string>;
  duplicate(): RedisClient;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<number>;
  unsubscribe(...channels: string[]): Promise<number>;
  set(
    key: string,
    value: string,
    mode: "EX" | "PX",
    duration: number,
    condition?: "NX"
  ): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  incrbyfloat(key: string, increment: number): Promise<string>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  sadd?(key: string, ...members: string[]): Promise<number>;
  srem?(key: string, ...members: string[]): Promise<number>;
  smembers?(key: string): Promise<string[]>;
  sinter?(...keys: string[]): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  zrange?(key: string, start: number, stop: number): Promise<string[]>;
  zrangebyscore(key: string, min: number | string, max: number | string, limitLiteral?: "LIMIT", offset?: number, count?: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, field: string): Promise<number>;
  psubscribe(pattern: string): Promise<number>;
  punsubscribe(pattern: string): Promise<number>;
  on(event: "connect", listener: () => void): RedisClient;
  on(event: "error", listener: (error: Error) => void): RedisClient;
  on(event: "end", listener: () => void): RedisClient;
  on(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): RedisClient;
  off(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): RedisClient;
  on(event: "message", listener: (channel: string, message: string) => void): RedisClient;
  off(event: "message", listener: (channel: string, message: string) => void): RedisClient;
}

interface RedisOptions {
  lazyConnect: boolean;
  connectTimeout?: number;
  retryStrategy?: (times: number) => number | null;
}

interface RedisConstructor {
  new(url: string, options?: RedisOptions): RedisClient;
}

const require = createRequire(import.meta.url);
const RedisCtor = require("ioredis") as RedisConstructor;

const attachRedisLifecycleLogging = (
  client: RedisClient,
  logger: Logger,
  clientRole: "primary" | "duplicate"
): void => {
  client.on("connect", () => {
    logger.info({ redisClient: clientRole }, "Redis connection established.");
  });

  client.on("error", (error: Error) => {
    logger.error({ err: error, redisClient: clientRole }, "Redis connection error.");
  });

  client.on("end", () => {
    logger.warn({ redisClient: clientRole }, "Redis connection closed.");
  });
};

const attachDuplicateLifecycleLogging = (client: RedisClient, logger: Logger): RedisClient => {
  const duplicate = client.duplicate.bind(client);
  client.duplicate = (() => {
    const duplicatedClient = duplicate();
    attachRedisLifecycleLogging(duplicatedClient, logger, "duplicate");
    return attachDuplicateLifecycleLogging(duplicatedClient, logger);
  }) as RedisClient["duplicate"];
  return client;
};

export const createRedisClient = ({ redisUrl, logger }: RedisModuleConfig): RedisClient => {
  const options: RedisOptions = {
    lazyConnect: true,
    connectTimeout: 10_000,
    retryStrategy: (times: number) => Math.min(times * 500, 2_000)
  };

  const client = new RedisCtor(redisUrl, options);

  attachRedisLifecycleLogging(client, logger, "primary");
  return attachDuplicateLifecycleLogging(client, logger);
};

export const connectRedis = async (client: RedisClient): Promise<void> => {
  await client.connect();
};

export const disconnectRedis = async (client: RedisClient): Promise<void> => {
  await client.quit();
};
