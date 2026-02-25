import { EventEmitter } from "node:events";
import { activeRFQSessions, rfqExpiredTotal } from "../../observability/metrics.js";
import { withSpanSync } from "../../observability/tracing.js";

export interface SessionExpiredEvent {
  sessionId: string;
  expiredKey: string;
  observedAt: Date;
}

export interface RFQSessionRedisClient {
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
  on(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): RFQSessionRedisClient;
  off(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): RFQSessionRedisClient;
}

export interface SessionMetadata {
  id: string;
  state: string;
  expiresAt: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface QuoteRecord {
  quoteId: string;
  score: number;
  payload: Readonly<Record<string, unknown>>;
}

export interface SessionManagerOptions {
  redis: RFQSessionRedisClient;
  lockTtlMs?: number;
  onSessionExpired?: (event: SessionExpiredEvent) => void;
  now?: () => Date;
}

interface PersistedQuote {
  quoteId: string;
  score: number;
  payload: Record<string, unknown>;
}

const EXPIRED_PATTERN = "__keyevent@*__:expired";

export class RFQSessionManager extends EventEmitter {
  private readonly redis: RFQSessionRedisClient;
  private readonly lockTtlMs: number;
  private readonly onSessionExpired: ((event: SessionExpiredEvent) => void) | undefined;
  private readonly now: () => Date;
  private readonly expirationListener: (
    pattern: string,
    channel: string,
    message: string
  ) => void;
  private listenerActive = false;

  public constructor(options: SessionManagerOptions) {
    super();
    this.redis = options.redis;
    this.lockTtlMs = options.lockTtlMs ?? 5000;
    this.onSessionExpired = options.onSessionExpired;
    this.now = options.now ?? (() => new Date());
    this.expirationListener = (_pattern, _channel, message) => {
      this.handleExpiredKey(message);
    };
  }

  public metaKey(sessionId: string): string {
    return `rfq:${sessionId}:meta`;
  }

  public quotesKey(sessionId: string): string {
    return `rfq:${sessionId}:quotes`;
  }

  public lockKey(sessionId: string): string {
    return `rfq:${sessionId}:lock`;
  }

  public async setSessionMetadata(
    sessionId: string,
    metadata: SessionMetadata,
    ttlSeconds: number
  ): Promise<void> {
    await this.redis.set(this.metaKey(sessionId), JSON.stringify(metadata), "EX", ttlSeconds);
    await this.redis.expire(this.quotesKey(sessionId), ttlSeconds);
  }

  public async getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const value = await this.redis.get(this.metaKey(sessionId));
    if (!value) {
      return null;
    }

    return JSON.parse(value) as SessionMetadata;
  }

  public async addQuote(
    sessionId: string,
    quote: QuoteRecord,
    ttlSeconds?: number
  ): Promise<void> {
    const payload: PersistedQuote = {
      quoteId: quote.quoteId,
      score: quote.score,
      payload: { ...quote.payload }
    };
    await this.redis.zadd(this.quotesKey(sessionId), quote.score, JSON.stringify(payload));

    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.expire(this.quotesKey(sessionId), ttlSeconds);
    }
  }

  public async listQuotes(sessionId: string, limit = 100): Promise<QuoteRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const entries = await this.redis.zrevrange(this.quotesKey(sessionId), 0, safeLimit - 1);

    return entries.map((entry) => {
      const parsed = JSON.parse(entry) as PersistedQuote;
      return {
        quoteId: parsed.quoteId,
        score: parsed.score,
        payload: parsed.payload
      };
    });
  }

  public async getSessionTtl(sessionId: string): Promise<number> {
    return this.redis.ttl(this.metaKey(sessionId));
  }

  public async refreshSessionTtl(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(this.metaKey(sessionId), ttlSeconds);
    await this.redis.expire(this.quotesKey(sessionId), ttlSeconds);
  }

  public async acquireLock(sessionId: string, ownerId: string, ttlMs?: number): Promise<boolean> {
    const duration = ttlMs ?? this.lockTtlMs;
    const result = await this.redis.set(
      this.lockKey(sessionId),
      ownerId,
      "PX",
      duration,
      "NX"
    );

    return result === "OK";
  }

  public async releaseLock(sessionId: string): Promise<void> {
    await this.redis.del(this.lockKey(sessionId));
  }

  public async startExpirationListener(): Promise<void> {
    if (this.listenerActive) {
      return;
    }

    this.redis.on("pmessage", this.expirationListener);
    await this.redis.psubscribe(EXPIRED_PATTERN);
    this.listenerActive = true;
  }

  public async stopExpirationListener(): Promise<void> {
    if (!this.listenerActive) {
      return;
    }

    await this.redis.punsubscribe(EXPIRED_PATTERN);
    this.redis.off("pmessage", this.expirationListener);
    this.listenerActive = false;
  }

  private handleExpiredKey(expiredKey: string): void {
    withSpanSync(
      "rfq.lifecycle.expiration",
      {
        rfq_id: this.parseSessionIdFromMetaKey(expiredKey) ?? "unknown",
        lp_id: "n/a",
        state: "EXPIRED"
      },
      () => {
        const sessionId = this.parseSessionIdFromMetaKey(expiredKey);
        if (!sessionId) {
          return;
        }

        const event: SessionExpiredEvent = {
          sessionId,
          expiredKey,
          observedAt: this.now()
        };

        rfqExpiredTotal.inc();
        activeRFQSessions.dec();
        this.emit("sessionExpired", event);
        this.onSessionExpired?.(event);
      }
    );
  }

  private parseSessionIdFromMetaKey(key: string): string | null {
    const match = /^rfq:([^:]+):meta$/.exec(key);
    return match?.[1] ?? null;
  }
}
