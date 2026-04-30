import { createHash, createHmac } from "node:crypto";
import type { Logger } from "pino";
import type { RedisClient } from "../../db/redis.js";

export type AdminAuthRateLimitScope = "request_login_link" | "manual_login";

export interface AdminAuthRateLimitConfig {
  windowSeconds: number;
  maxPerEmail: number;
  maxPerIp: number;
}

export interface AdminAuthRateLimitInput {
  scope: AdminAuthRateLimitScope;
  email: string;
  ip: string;
}

export interface AdminAuthRateLimitResult {
  allowed: boolean;
  reason?: "EMAIL_LIMIT" | "IP_LIMIT" | "STORAGE_UNAVAILABLE";
}

export interface AdminAuthRateLimiter {
  consume(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult>;
}

export interface RedisAdminAuthRateLimiterConfig {
  redis: RedisClient;
  logger: Pick<Logger, "warn">;
  keyPepper?: string | undefined;
  operationTimeoutMs?: number | undefined;
  requestLoginLink: AdminAuthRateLimitConfig;
  manualLogin: AdminAuthRateLimitConfig;
}

export class RedisAdminAuthRateLimiter implements AdminAuthRateLimiter {
  public constructor(private readonly config: RedisAdminAuthRateLimiterConfig) {}

  public async consume(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult> {
    return withTimeout(
      this.consumeWithRedis(input),
      this.config.operationTimeoutMs ?? 1000,
      { allowed: false, reason: "STORAGE_UNAVAILABLE" }
    );
  }

  private async consumeWithRedis(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult> {
    const limits = input.scope === "request_login_link"
      ? this.config.requestLoginLink
      : this.config.manualLogin;

    try {
      const emailCount = await this.increment(
        `admin-auth:${input.scope}:email:${hashIdentifier(input.email, this.config.keyPepper)}`,
        limits.windowSeconds
      );
      if (emailCount > limits.maxPerEmail) {
        return { allowed: false, reason: "EMAIL_LIMIT" };
      }

      const ipCount = await this.increment(
        `admin-auth:${input.scope}:ip:${hashIdentifier(input.ip, this.config.keyPepper)}`,
        limits.windowSeconds
      );
      if (ipCount > limits.maxPerIp) {
        return { allowed: false, reason: "IP_LIMIT" };
      }

      return { allowed: true };
    } catch (error) {
      this.config.logger.warn({ err: error, scope: input.scope }, "Admin auth rate limit storage unavailable.");
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

export interface InMemoryAdminAuthRateLimiterConfig {
  keyPepper?: string | undefined;
  requestLoginLink: AdminAuthRateLimitConfig;
  manualLogin: AdminAuthRateLimitConfig;
  maxEntries?: number | undefined;
}

interface InMemoryRateLimitEntry {
  count: number;
  resetAtMs: number;
}

export class InMemoryAdminAuthRateLimiter implements AdminAuthRateLimiter {
  private readonly entries = new Map<string, InMemoryRateLimitEntry>();

  public constructor(private readonly config: InMemoryAdminAuthRateLimiterConfig) {}

  public async consume(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult> {
    const limits = input.scope === "request_login_link"
      ? this.config.requestLoginLink
      : this.config.manualLogin;
    const emailHash = hashIdentifier(input.email, this.config.keyPepper);
    const ipHash = hashIdentifier(input.ip, this.config.keyPepper);
    const emailKey = `admin-auth:${input.scope}:email:${emailHash}`;
    const ipKey = `admin-auth:${input.scope}:ip:${ipHash}`;

    this.cleanupExpiredEntries(Date.now());

    if (this.currentCount(emailKey) >= limits.maxPerEmail) {
      return { allowed: false, reason: "EMAIL_LIMIT" };
    }
    if (this.currentCount(ipKey) >= limits.maxPerIp) {
      return { allowed: false, reason: "IP_LIMIT" };
    }

    this.increment(emailKey, limits.windowSeconds);
    this.increment(ipKey, limits.windowSeconds);
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

export class FallbackAdminAuthRateLimiter implements AdminAuthRateLimiter {
  public constructor(
    private readonly primary: AdminAuthRateLimiter,
    private readonly fallback: AdminAuthRateLimiter
  ) {}

  public async consume(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult> {
    const primaryResult = await this.primary.consume(input);
    if (primaryResult.reason !== "STORAGE_UNAVAILABLE") {
      return primaryResult;
    }
    return this.fallback.consume(input);
  }
}

export const createAdminAuthRateLimitConfig = (env: NodeJS.ProcessEnv): {
  requestLoginLink: AdminAuthRateLimitConfig;
  manualLogin: AdminAuthRateLimitConfig;
} => ({
  requestLoginLink: {
    windowSeconds: parseIntEnv(env.ADMIN_LOGIN_LINK_RATE_LIMIT_WINDOW_SECONDS, 900),
    maxPerEmail: parseIntEnv(env.ADMIN_LOGIN_LINK_RATE_LIMIT_MAX_PER_EMAIL, 3),
    maxPerIp: parseIntEnv(env.ADMIN_LOGIN_LINK_RATE_LIMIT_MAX_PER_IP, 20)
  },
  manualLogin: {
    windowSeconds: parseIntEnv(env.ADMIN_LOGIN_LINK_RATE_LIMIT_WINDOW_SECONDS, 900),
    maxPerEmail: parseIntEnv(env.ADMIN_MANUAL_LOGIN_RATE_LIMIT_MAX_PER_EMAIL, 5),
    maxPerIp: parseIntEnv(env.ADMIN_MANUAL_LOGIN_RATE_LIMIT_MAX_PER_IP, 30)
  }
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
