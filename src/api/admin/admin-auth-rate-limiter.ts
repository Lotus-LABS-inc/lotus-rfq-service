import { createHash, createHmac } from "node:crypto";
import type { Logger } from "pino";
import type { Pool, PoolClient } from "pg";
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

export interface PgAdminAuthRateLimiterConfig {
  pool: Pool;
  logger: Pick<Logger, "warn">;
  keyPepper?: string | undefined;
  requestLoginLink: AdminAuthRateLimitConfig;
  manualLogin: AdminAuthRateLimitConfig;
}

export class PgAdminAuthRateLimiter implements AdminAuthRateLimiter {
  public constructor(private readonly config: PgAdminAuthRateLimiterConfig) {}

  public async consume(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult> {
    const limits = input.scope === "request_login_link"
      ? this.config.requestLoginLink
      : this.config.manualLogin;
    const emailHash = hashIdentifier(input.email, this.config.keyPepper);
    const ipHash = hashIdentifier(input.ip, this.config.keyPepper);

    let client: PoolClient | null = null;
    try {
      client = await this.config.pool.connect();
      await client.query("BEGIN");
      const emailCount = await this.countRecent(client, input.scope, "email", emailHash, limits.windowSeconds);
      const ipCount = await this.countRecent(client, input.scope, "ip", ipHash, limits.windowSeconds);
      if (emailCount >= limits.maxPerEmail) {
        await client.query("COMMIT");
        return { allowed: false, reason: "EMAIL_LIMIT" };
      }
      if (ipCount >= limits.maxPerIp) {
        await client.query("COMMIT");
        return { allowed: false, reason: "IP_LIMIT" };
      }
      await this.insertConsumed(client, input.scope, "email", emailHash);
      await this.insertConsumed(client, input.scope, "ip", ipHash);
      await client.query("COMMIT");
      return { allowed: true };
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      this.config.logger.warn({ err: error, scope: input.scope }, "Admin auth Postgres rate limit storage unavailable.");
      return { allowed: false, reason: "STORAGE_UNAVAILABLE" };
    } finally {
      client?.release();
    }
  }

  private async countRecent(
    client: PoolClient,
    scope: AdminAuthRateLimitScope,
    kind: "email" | "ip",
    identifierHash: string,
    windowSeconds: number
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM admin_audit_events
        WHERE event_type = 'ADMIN_AUTH_RATE_LIMIT_CONSUMED'
          AND created_at >= now() - ($1::int * interval '1 second')
          AND metadata->>'scope' = $2
          AND metadata->>'kind' = $3
          AND metadata->>'identifierHash' = $4`,
      [windowSeconds, scope, kind, identifierHash]
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  private async insertConsumed(
    client: PoolClient,
    scope: AdminAuthRateLimitScope,
    kind: "email" | "ip",
    identifierHash: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO admin_audit_events (
          actor_admin_member_id,
          event_type,
          target_type,
          target_id,
          metadata
       ) VALUES (NULL, 'ADMIN_AUTH_RATE_LIMIT_CONSUMED', 'admin_auth', NULL, $1::jsonb)`,
      [JSON.stringify({ scope, kind, identifierHash })]
    );
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
