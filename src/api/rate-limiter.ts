import { createHash, createHmac } from "node:crypto";
import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";

export interface RateLimitRule {
  windowSeconds: number;
  maxPerUser: number;
  maxPerIp: number;
}

export interface RateLimitInput {
  scope: string;
  userId: string;
  ip: string;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "USER_LIMIT" | "IP_LIMIT" | "STORAGE_UNAVAILABLE";
}

export interface RateLimiter {
  consume(input: RateLimitInput): Promise<RateLimitResult>;
}

export interface RedisRateLimiterConfig {
  redis: RedisClient;
  logger: Pick<Logger, "warn">;
  keyPrefix: string;
  keyPepper?: string | undefined;
  operationTimeoutMs?: number | undefined;
  rules: Record<string, RateLimitRule>;
}

export class RedisRateLimiter implements RateLimiter {
  public constructor(private readonly config: RedisRateLimiterConfig) {}

  public async consume(input: RateLimitInput): Promise<RateLimitResult> {
    return withTimeout(
      this.consumeWithRedis(input),
      this.config.operationTimeoutMs ?? 250,
      { allowed: false, reason: "STORAGE_UNAVAILABLE" }
    );
  }

  private async consumeWithRedis(input: RateLimitInput): Promise<RateLimitResult> {
    const rule = this.config.rules[input.scope];
    if (!rule) {
      return { allowed: true };
    }

    try {
      const userCount = await this.increment(
        `${this.config.keyPrefix}:${input.scope}:user:${hashIdentifier(input.userId, this.config.keyPepper)}`,
        rule.windowSeconds
      );
      if (userCount > rule.maxPerUser) {
        return { allowed: false, reason: "USER_LIMIT" };
      }

      const ipCount = await this.increment(
        `${this.config.keyPrefix}:${input.scope}:ip:${hashIdentifier(input.ip, this.config.keyPepper)}`,
        rule.windowSeconds
      );
      if (ipCount > rule.maxPerIp) {
        return { allowed: false, reason: "IP_LIMIT" };
      }

      return { allowed: true };
    } catch (error) {
      this.config.logger.warn({ err: error, scope: input.scope }, "Rate limit storage unavailable.");
      return { allowed: false, reason: "STORAGE_UNAVAILABLE" };
    }
  }

  private async increment(key: string, windowSeconds: number): Promise<number> {
    const count = Number.parseFloat(await this.config.redis.incrbyfloat(key, 1));
    if (count === 1) {
      await this.config.redis.expire(key, windowSeconds);
    }
    return count;
  }
}

export interface InMemoryRateLimiterConfig {
  keyPrefix: string;
  keyPepper?: string | undefined;
  rules: Record<string, RateLimitRule>;
  maxEntries?: number | undefined;
}

interface InMemoryRateLimitEntry {
  count: number;
  resetAtMs: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, InMemoryRateLimitEntry>();

  public constructor(private readonly config: InMemoryRateLimiterConfig) {}

  public async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const rule = this.config.rules[input.scope];
    if (!rule) {
      return { allowed: true };
    }

    this.cleanupExpiredEntries(Date.now());
    const userKey = `${this.config.keyPrefix}:${input.scope}:user:${hashIdentifier(input.userId, this.config.keyPepper)}`;
    const ipKey = `${this.config.keyPrefix}:${input.scope}:ip:${hashIdentifier(input.ip, this.config.keyPepper)}`;

    if (this.currentCount(userKey) >= rule.maxPerUser) {
      return { allowed: false, reason: "USER_LIMIT" };
    }
    if (this.currentCount(ipKey) >= rule.maxPerIp) {
      return { allowed: false, reason: "IP_LIMIT" };
    }

    this.increment(userKey, rule.windowSeconds);
    this.increment(ipKey, rule.windowSeconds);
    return { allowed: true };
  }

  private currentCount(key: string): number {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAtMs <= Date.now()) {
      return 0;
    }
    return entry.count;
  }

  private increment(key: string, windowSeconds: number): void {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAtMs <= now) {
      this.entries.set(key, {
        count: 1,
        resetAtMs: now + windowSeconds * 1000
      });
      return;
    }
    this.entries.set(key, {
      count: existing.count + 1,
      resetAtMs: existing.resetAtMs
    });
  }

  private cleanupExpiredEntries(now: number): void {
    const maxEntries = this.config.maxEntries ?? 10_000;
    if (this.entries.size <= maxEntries) {
      return;
    }
    for (const [key, entry] of this.entries) {
      if (entry.resetAtMs <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export class FallbackRateLimiter implements RateLimiter {
  public constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter
  ) {}

  public async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const primaryResult = await this.primary.consume(input);
    if (primaryResult.reason !== "STORAGE_UNAVAILABLE") {
      return primaryResult;
    }
    return this.fallback.consume(input);
  }
}

export const parseRateLimitRule = (
  env: NodeJS.ProcessEnv,
  prefix: string,
  fallback: RateLimitRule
): RateLimitRule => ({
  windowSeconds: parseIntEnv(env[`${prefix}_WINDOW_SECONDS`], fallback.windowSeconds),
  maxPerUser: parseIntEnv(env[`${prefix}_MAX_PER_USER`], fallback.maxPerUser),
  maxPerIp: parseIntEnv(env[`${prefix}_MAX_PER_IP`], fallback.maxPerIp)
});

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const hashIdentifier = (value: string, pepper: string | undefined): string => {
  const normalized = value.trim().toLowerCase();
  if (pepper) {
    return createHmac("sha256", pepper).update(normalized).digest("hex");
  }
  return createHash("sha256").update(normalized).digest("hex");
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), timeoutMs);
      timer.unref?.();
    })
  ]);
