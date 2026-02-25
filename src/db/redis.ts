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
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
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
}

interface RedisConstructor {
  new (url: string, options?: RedisOptions): RedisClient;
}

const require = createRequire(import.meta.url);
const RedisCtor = require("ioredis") as RedisConstructor;

export const createRedisClient = ({ redisUrl, logger }: RedisModuleConfig): RedisClient => {
  const options: RedisOptions = {
    lazyConnect: true
  };

  const client = new RedisCtor(redisUrl, options);

  client.on("connect", () => {
    logger.info("Redis connection established.");
  });

  client.on("error", (error: Error) => {
    logger.error({ err: error }, "Redis connection error.");
  });

  client.on("end", () => {
    logger.warn("Redis connection closed.");
  });

  return client;
};

export const connectRedis = async (client: RedisClient): Promise<void> => {
  await client.connect();
};

export const disconnectRedis = async (client: RedisClient): Promise<void> => {
  await client.quit();
};
