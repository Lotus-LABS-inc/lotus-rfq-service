import { createHmac, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/api/server.js";
import { ExecutionRouterService } from "../../src/core/execution-router/execution-router.js";
import { InMemoryRFQEventEmitter } from "../../src/core/rfq-engine/rfq-domain-events.js";
import { RFQStateMachine } from "../../src/core/rfq-engine/rfq-state-machine.js";
import { rankQuotesByEffectiveCost, type RankedQuote } from "../../src/core/ranking/quote-ranking.js";
import { createDrizzleDb } from "../../src/db/postgres.js";
import type { RedisClient } from "../../src/db/redis.js";
import { RFQExecutionRepository } from "../../src/db/repositories/rfq-execution-repository.js";
import { RFQQuoteRepository } from "../../src/db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../../src/db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "../../src/core/rfq-engine/rfq-session-manager.js";
import { CryptoAdminService } from "../../src/api/admin/crypto-admin-service.js";
import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import { FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import {
  LimitlessFundingReadinessChecker,
  PolymarketFundingReadinessChecker,
  type LimitlessFundingBalanceReadClient,
  type PolymarketFundingBalanceReadClient,
  type VenueFundingReadinessChecker
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import type { ExecutionScopeAuthorityRegistry } from "../../src/execution-control/execution-scope-token.js";
import { ExecutionSystemMetadataSchema } from "../../src/execution-system/index.js";
import { ExecutionRecordRepository } from "../../src/repositories/execution-record.repository.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";
import { Pool } from "pg";
import pino from "pino";

loadDotenv({
  path: path.resolve(process.cwd(), ".env"),
  override: true
});

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_CANONICAL_MARKET_ID = "a0eb58b9-a89c-48a7-bda8-b08a050ad95e";
const TEST_CANONICAL_EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_CRYPTO_LANE_ID = "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET";
const TEST_SINGLE_POLYMARKET_FUNDING_LANE_ID = "SANDBOX_SINGLE_POLYMARKET_FUNDING_ENFORCEMENT";
const TEST_CRYPTO_POLYMARKET_DRY_RUN_LANE_ID = "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT";
const ENV_READY = Boolean(TEST_DB_URL);

const logger = pino({ level: "silent" });
const RUN_PREFIX = `it:${Date.now()}:${randomUUID()}:`;
const makeUuid = (): string => randomUUID();

interface LPKeyFixture {
  lpId: string;
  apiKey: string;
  secret: string;
  keyDbId: string;
}

interface InMemoryRedisState {
  strings: Map<string, string>;
  hashes: Map<string, Map<string, string>>;
  sets: Map<string, Set<string>>;
  sortedSets: Map<string, Array<{ score: number; member: string }>>;
  expirations: Map<string, { expiresAt: number; timeout: ReturnType<typeof setTimeout> }>;
  clients: Set<InMemoryRedisClient>;
}

class InMemoryRedisClient implements RedisClient {
  private readonly emitter = new EventEmitter();
  private readonly subscribedChannels = new Set<string>();
  private readonly subscribedPatterns = new Set<string>();
  private connected = false;

  public constructor(private readonly state: InMemoryRedisState) {
    this.state.clients.add(this);
  }

  public async connect(): Promise<void> {
    this.connected = true;
    this.dispatchSimple("connect");
  }

  public async quit(): Promise<string> {
    this.connected = false;
    this.state.clients.delete(this);
    this.dispatchSimple("end");
    return "OK";
  }

  public duplicate(): RedisClient {
    return new InMemoryRedisClient(this.state);
  }

  public async publish(channel: string, message: string): Promise<number> {
    let delivered = 0;
    for (const client of this.state.clients) {
      if (client.subscribedChannels.has(channel)) {
        client.dispatchMessage(channel, message);
        delivered += 1;
      }
    }
    return delivered;
  }

  public async subscribe(...channels: string[]): Promise<number> {
    channels.forEach((channel) => this.subscribedChannels.add(channel));
    return this.subscribedChannels.size;
  }

  public async unsubscribe(...channels: string[]): Promise<number> {
    channels.forEach((channel) => this.subscribedChannels.delete(channel));
    return this.subscribedChannels.size;
  }

  public async set(
    key: string,
    value: string,
    mode: "EX" | "PX",
    duration: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    if (condition === "NX" && this.state.strings.has(key)) {
      return null;
    }
    this.state.strings.set(key, value);
    this.clearExpiration(key);
    this.scheduleExpiration(key, mode === "EX" ? duration * 1000 : duration);
    return "OK";
  }

  public async get(key: string): Promise<string | null> {
    this.evictIfExpired(key);
    return this.state.strings.get(key) ?? null;
  }

  public async incrbyfloat(key: string, increment: number): Promise<string> {
    const current = Number.parseFloat((await this.get(key)) ?? "0");
    const next = (current + increment).toString();
    this.state.strings.set(key, next);
    return next;
  }

  public async eval(_script: string, _numKeys: number, ..._args: string[]): Promise<unknown> {
    return 1;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    if (!this.exists(key)) {
      return 0;
    }
    this.clearExpiration(key);
    this.scheduleExpiration(key, seconds * 1000);
    return 1;
  }

  public async ttl(key: string): Promise<number> {
    this.evictIfExpired(key);
    const expiration = this.state.expirations.get(key);
    if (!expiration) {
      return this.exists(key) ? -1 : -2;
    }
    return Math.max(0, Math.ceil((expiration.expiresAt - Date.now()) / 1000));
  }

  public async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      deleted += Number(this.deleteKey(key));
    }
    return deleted;
  }

  public async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.state.sets.get(key) ?? new Set<string>();
    this.state.sets.set(key, set);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    return added;
  }

  public async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.state.sets.get(key);
    if (!set) {
      return 0;
    }
    let removed = 0;
    for (const member of members) {
      removed += Number(set.delete(member));
    }
    return removed;
  }

  public async smembers(key: string): Promise<string[]> {
    return [...(this.state.sets.get(key) ?? new Set<string>())];
  }

  public async sinter(...keys: string[]): Promise<string[]> {
    const [first, ...rest] = keys.map((key) => this.state.sets.get(key) ?? new Set<string>());
    if (!first) {
      return [];
    }
    return [...first].filter((member) => rest.every((set) => set.has(member)));
  }

  public async zadd(key: string, score: number, member: string): Promise<number> {
    const entries = this.state.sortedSets.get(key) ?? [];
    this.state.sortedSets.set(key, entries);
    const existing = entries.find((entry) => entry.member === member);
    if (existing) {
      existing.score = score;
      return 0;
    }
    entries.push({ score, member });
    return 1;
  }

  public async zrem(key: string, member: string): Promise<number> {
    const entries = this.state.sortedSets.get(key) ?? [];
    const next = entries.filter((entry) => entry.member !== member);
    this.state.sortedSets.set(key, next);
    return entries.length === next.length ? 0 : 1;
  }

  public async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.readSortedRange(key, start, stop, "asc");
  }

  public async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    limitLiteral?: "LIMIT",
    offset?: number,
    count?: number
  ): Promise<string[]> {
    const parsedMin = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    const parsedMax = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);
    const entries = [...(this.state.sortedSets.get(key) ?? [])]
      .filter((entry) => entry.score >= parsedMin && entry.score <= parsedMax)
      .sort((left, right) => left.score - right.score || left.member.localeCompare(right.member));
    if (limitLiteral === "LIMIT") {
      return entries.slice(offset ?? 0, (offset ?? 0) + (count ?? entries.length)).map((entry) => entry.member);
    }
    return entries.map((entry) => entry.member);
  }

  public async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.readSortedRange(key, start, stop, "desc");
  }

  public async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.state.hashes.get(key) ?? new Map<string, string>();
    this.state.hashes.set(key, hash);
    const existed = hash.has(field);
    hash.set(field, value);
    return existed ? 0 : 1;
  }

  public async hget(key: string, field: string): Promise<string | null> {
    return this.state.hashes.get(key)?.get(field) ?? null;
  }

  public async hdel(key: string, field: string): Promise<number> {
    return Number(this.state.hashes.get(key)?.delete(field) ?? false);
  }

  public async psubscribe(pattern: string): Promise<number> {
    this.subscribedPatterns.add(pattern);
    return this.subscribedPatterns.size;
  }

  public async punsubscribe(pattern: string): Promise<number> {
    this.subscribedPatterns.delete(pattern);
    return this.subscribedPatterns.size;
  }

  public on(event: "connect" | "end", listener: () => void): RedisClient;
  public on(event: "error", listener: (error: Error) => void): RedisClient;
  public on(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): RedisClient;
  public on(event: "message", listener: (channel: string, message: string) => void): RedisClient;
  public on(event: string, listener: (...args: any[]) => void): RedisClient {
    this.emitter.on(event, listener);
    return this;
  }

  public off(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): RedisClient;
  public off(
    event: "message",
    listener: (channel: string, message: string) => void
  ): RedisClient;
  public off(event: "pmessage" | "message", listener: (...args: any[]) => void): RedisClient {
    this.emitter.off(event, listener);
    return this;
  }

  private readSortedRange(key: string, start: number, stop: number, direction: "asc" | "desc"): string[] {
    const sorted = [...(this.state.sortedSets.get(key) ?? [])].sort((left, right) => {
      const scoreOrder = direction === "asc" ? left.score - right.score : right.score - left.score;
      return scoreOrder || left.member.localeCompare(right.member);
    });
    const safeStop = stop < 0 ? sorted.length - 1 : stop;
    return sorted.slice(start, safeStop + 1).map((entry) => entry.member);
  }

  private exists(key: string): boolean {
    this.evictIfExpired(key);
    return (
      this.state.strings.has(key) ||
      this.state.hashes.has(key) ||
      this.state.sets.has(key) ||
      this.state.sortedSets.has(key)
    );
  }

  private scheduleExpiration(key: string, durationMs: number): void {
    const expiresAt = Date.now() + durationMs;
    const timeout = setTimeout(() => {
      this.deleteKey(key);
      for (const client of this.state.clients) {
        for (const pattern of client.subscribedPatterns) {
          if (pattern === "__keyevent@*__:expired") {
            client.dispatchPMessage(pattern, "__keyevent@0__:expired", key);
          }
        }
      }
    }, durationMs);
    this.state.expirations.set(key, { expiresAt, timeout });
  }

  private clearExpiration(key: string): void {
    const expiration = this.state.expirations.get(key);
    if (expiration) {
      clearTimeout(expiration.timeout);
      this.state.expirations.delete(key);
    }
  }

  private evictIfExpired(key: string): void {
    const expiration = this.state.expirations.get(key);
    if (expiration && expiration.expiresAt <= Date.now()) {
      this.deleteKey(key);
    }
  }

  private deleteKey(key: string): boolean {
    this.clearExpiration(key);
    return (
      this.state.strings.delete(key) ||
      this.state.hashes.delete(key) ||
      this.state.sets.delete(key) ||
      this.state.sortedSets.delete(key)
    );
  }

  private dispatchSimple(event: "connect" | "end"): void {
    this.emitter.emit(event);
  }

  private dispatchMessage(channel: string, message: string): void {
    this.emitter.emit("message", channel, message);
  }

  private dispatchPMessage(pattern: string, channel: string, message: string): void {
    this.emitter.emit("pmessage", pattern, channel, message);
  }
}

const createInMemoryRedisClient = (): RedisClient =>
  new InMemoryRedisClient({
    strings: new Map(),
    hashes: new Map(),
    sets: new Map(),
    sortedSets: new Map(),
    expirations: new Map(),
    clients: new Set()
  });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const createSignedHeaders = (
  apiKey: string,
  secret: string,
  method: string,
  url: string,
  body: Record<string, unknown>,
  nonce: string
): Record<string, string> => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${timestamp}.${nonce}.${method.toUpperCase()}.${url}.${JSON.stringify(body)}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  return {
    "x-api-key": apiKey,
    "x-signature": signature,
    "x-timestamp": timestamp,
    "x-nonce": nonce
  };
};

const fundingEnv = {
  POLYMARKET_FUNDING_DESTINATION_ADDRESS: "0x1111111111111111111111111111111111111111",
  LIMITLESS_FUNDING_DESTINATION_ADDRESS: "0x3333333333333333333333333333333333333333",
  SOLANA_FUNDING_ROUTE_BLOCKHASH_REFRESH_ENABLED: "false"
} as NodeJS.ProcessEnv;

const SANDBOX_EXECUTION_ENV_KEYS = [
  "POLYMARKET_EXECUTION_MODE",
  "LIMITLESS_EXECUTION_MODE",
  "OPINION_EXECUTION_MODE",
  "PREDICT_FUN_EXECUTION_MODE",
  "POLYMARKET_LIVE_EXECUTION_ENABLED",
  "LIMITLESS_LIVE_EXECUTION_ENABLED",
  "OPINION_LIVE_EXECUTION_ENABLED",
  "PREDICT_FUN_LIVE_EXECUTION_ENABLED"
] as const;

const withSandboxExecutionEnv = async <T>(
  callback: () => Promise<T>,
  overrides: Partial<Record<(typeof SANDBOX_EXECUTION_ENV_KEYS)[number], string>> = {}
): Promise<T> => {
  const originalEnv = Object.fromEntries(
    SANDBOX_EXECUTION_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof SANDBOX_EXECUTION_ENV_KEYS)[number], string | undefined>;
  for (const key of SANDBOX_EXECUTION_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      process.env[key as (typeof SANDBOX_EXECUTION_ENV_KEYS)[number]] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const key of SANDBOX_EXECUTION_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

class MockLifiProvider implements LifiRouteProvider {
  public nextStatus: Awaited<ReturnType<LifiRouteProvider["status"]>> = {
    status: "DONE_COMPLETED",
    raw: { status: "DONE", substatus: "COMPLETED", source: "rfq-funding-integration-test" }
  };
  public quoteCalls = 0;
  public statusCalls = 0;

  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    this.quoteCalls += 1;
    return {
      provider: "LIFI",
      providerRouteId: `mock-route-${randomUUID()}`,
      sourceChain: input.fromChain,
      sourceToken: input.fromToken,
      sourceAmount: input.fromAmount,
      destinationChain: input.toChain,
      destinationToken: input.toToken,
      destinationAmountEstimate: input.fromAmount,
      estimatedFees: "0",
      estimatedTimeSeconds: 120,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      transactionRequest: {
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        chainId: Number(input.toChain)
      },
      userSafeSummary: "Mock LI.FI route for RFQ funding integration."
    };
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    this.statusCalls += 1;
    return this.nextStatus;
  }
}

class MockPolymarketBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public constructor(public usableBalance = "0") {}

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    return { usableBalance: this.usableBalance, raw: { source: "rfq-funding-integration-test" } };
  }
}

class MockLimitlessBalanceReadClient implements LimitlessFundingBalanceReadClient {
  public constructor(public usableBalance = "0") {}

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    return { usableBalance: this.usableBalance, raw: { source: "rfq-funding-integration-test" } };
  }
}

const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationDirs = [
    path.resolve(process.cwd(), "sql", "migrations")
  ];

  for (const migrationsDir of migrationDirs) {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await pool.query(sql);
      } catch (error) {
        if (
          error instanceof Error &&
          (
            ("code" in error && (error as { code?: string }).code === "42P07") ||
            ("code" in error && (error as { code?: string }).code === "42710") ||
            ("code" in error && (error as { code?: string }).code === "42701")
          )
        ) {
          continue;
        }
        throw error;
      }
    }
  }
};

const clearPersistentState = async (pool: Pool): Promise<void> => {
  let attempts = 0;
  while (attempts < 5) {
    try {
      await pool.query(
        `TRUNCATE TABLE
          strategy_promotion_events,
          execution_control_audit_records,
          execution_submission_lineage,
          execution_replay_protection_records,
          execution_idempotency_keys,
          execution_approval_states,
          execution_control_decisions,
          execution_recovery_actions,
          execution_state_transitions,
          execution_records,
          execution_intents,
          funding_audit_events,
          funding_reconciliation_records,
          funding_route_legs,
          funding_targets,
          funding_intents,
          route_rejection_reasons,
          route_candidate_sets,
          route_selection_traces,
          route_history,
          route_steps,
          route_candidates,
          routing_plans,
          rfq_executions,
          rfq_events,
          rfq_quotes,
          rfq_sessions,
          lp_keys
        RESTART IDENTITY CASCADE`
      );
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "40P01") {
        throw error;
      }
      attempts += 1;
      await sleep(100 * attempts);
    }
  }
  throw new Error("Unable to clear persistent integration state due to repeated deadlocks.");
};

const createLPKeys = async (pool: Pool): Promise<LPKeyFixture[]> => {
  const fixtures: LPKeyFixture[] = [
    {
      lpId: `${RUN_PREFIX}lp-1`,
      apiKey: `${RUN_PREFIX}lp-key-1`,
      secret: `${RUN_PREFIX}secret-1`,
      keyDbId: ""
    },
    {
      lpId: `${RUN_PREFIX}lp-2`,
      apiKey: `${RUN_PREFIX}lp-key-2`,
      secret: `${RUN_PREFIX}secret-2`,
      keyDbId: ""
    },
    {
      lpId: `${RUN_PREFIX}lp-3`,
      apiKey: `${RUN_PREFIX}lp-key-3`,
      secret: `${RUN_PREFIX}secret-3`,
      keyDbId: ""
    }
  ];

  for (const fixture of fixtures) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO lp_keys (lp_id, key_id, public_key, secret_hash, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [fixture.lpId, fixture.apiKey, `pub-${fixture.apiKey}`, fixture.secret, "ACTIVE", "{}"]
    );
    fixture.keyDbId = result.rows[0]?.id ?? "";
  }

  return fixtures;
};

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms.`);
};

describe.skipIf(!ENV_READY)("RFQ lifecycle integration harness", () => {
  let canonicalService: Awaited<ReturnType<typeof Fastify>> | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let pool: Pool | undefined;
  let redisClient: RedisClient | undefined;
  let sessionRepository: RFQSessionRepository | undefined;
  let quoteRepository: RFQQuoteRepository | undefined;
  let executionRepository: RFQExecutionRepository | undefined;
  let sessionManager: RFQSessionManager | undefined;
  let eventEmitter: InMemoryRFQEventEmitter | undefined;
  const trackedRedisKeys = new Set<string>();
  const trackedSessionIds = new Set<string>();

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} was not initialized.`);
    }
    return value;
  };

  const trackSessionKeys = (sessionId: string): void => {
    trackedSessionIds.add(sessionId);
    trackedRedisKeys.add(`rfq:${sessionId}:meta`);
    trackedRedisKeys.add(`rfq:${sessionId}:quotes`);
    trackedRedisKeys.add(`rfq:${sessionId}:lock`);
  };

  const trackQuoteIdempotencyKey = (sessionId: string, quoteId: string): void => {
    trackedRedisKeys.add(`rfq:${sessionId}:quote_id:${quoteId}`);
  };

  const trackNonceKey = (apiKey: string, nonce: string): void => {
    trackedRedisKeys.add(`lp:nonce:${apiKey}:${nonce}`);
  };

  const isConnectionClosedError = (error: unknown): boolean => {
    return error instanceof Error && error.message.includes("Connection is closed");
  };

  const cleanupTrackedRedisKeys = async (): Promise<void> => {
    const redis = redisClient;
    if (!redis) {
      trackedRedisKeys.clear();
      trackedSessionIds.clear();
      return;
    }

    const keysToDelete = new Set<string>(trackedRedisKeys);
    for (const sessionId of trackedSessionIds.values()) {
      keysToDelete.add(`rfq:${sessionId}:meta`);
      keysToDelete.add(`rfq:${sessionId}:quotes`);
      keysToDelete.add(`rfq:${sessionId}:lock`);
    }

    if (keysToDelete.size > 0) {
      const keyArray = Array.from(keysToDelete.values());
      const chunkSize = 200;
      for (let index = 0; index < keyArray.length; index += chunkSize) {
        const chunk = keyArray.slice(index, index + chunkSize);
        try {
          await redis.del(...chunk);
        } catch (error) {
          if (!isConnectionClosedError(error)) {
            throw error;
          }
          break;
        }
      }
    }

    trackedRedisKeys.clear();
    trackedSessionIds.clear();
  };

  const buildFundingService = (
    repository: FundingRepository,
    lifi: MockLifiProvider,
    polymarketBalance: MockPolymarketBalanceReadClient,
    limitlessBalance = new MockLimitlessBalanceReadClient("0")
  ): FundingService =>
    new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: fundingEnv
      },
      new Map<FundingVenue, VenueFundingReadinessChecker>([[
        "POLYMARKET",
        new PolymarketFundingReadinessChecker(polymarketBalance, {
          enabled: true,
          mode: "STUB",
          env: fundingEnv
        })
      ], [
        "LIMITLESS",
        new LimitlessFundingReadinessChecker(limitlessBalance, {
          enabled: true,
          mode: "STUB",
          env: fundingEnv
        })
      ]])
    );

  const seedVenueFundingThroughService = async (input: {
    userId: string;
    venue: "POLYMARKET" | "LIMITLESS";
    sourceAmount?: string;
    usableBalance?: string;
    status: "DESTINATION_RECEIVED" | "VENUE_CREDIT_PENDING" | "READY_TO_TRADE";
  }): Promise<{
    fundingIntentId: string;
    routeLegId: string;
    lifi: MockLifiProvider;
  }> => {
    const pg = must(pool, "pool");
    const repository = new FundingRepository(pg);
    const lifi = new MockLifiProvider();
    const polymarketBalance = new MockPolymarketBalanceReadClient(input.usableBalance ?? "0");
    const limitlessBalance = new MockLimitlessBalanceReadClient(input.usableBalance ?? "0");
    const service = buildFundingService(repository, lifi, polymarketBalance, limitlessBalance);
    const created = await service.createIntent(input.userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: input.sourceAmount ?? "100",
      sourceWalletAddress: "rfq-funding-test-solana-wallet",
      idempotencyKey: `rfq-funding-${randomUUID()}`,
      targets: [{ targetVenue: input.venue, targetPercentage: 100 }]
    });
    const quoted = await service.quoteIntent(input.userId, created.intent.fundingIntentId);
    const leg = quoted.routeLegs[0];
    if (!leg) {
      throw new Error("Funding quote did not create a route leg.");
    }
    await service.submitRouteLeg(input.userId, created.intent.fundingIntentId, {
      routeLegId: leg.routeLegId,
      txHash: `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66)
    });
    if (input.status === "DESTINATION_RECEIVED") {
      await repository.updateRouteLegProviderStatus({
        routeLegId: leg.routeLegId,
        status: "LEG_DESTINATION_RECEIVED",
        bridgeStatus: "DONE",
        destinationStatus: "CONFIRMED",
        venueCreditStatus: "NOT_CONFIRMED",
        providerStatus: { status: "DONE", source: "rfq-funding-integration-test" },
        errorReason: null
      });
      await repository.updateIntentStatus(created.intent.fundingIntentId, "ROUTES_SUBMITTED");
      await repository.createReconciliationRecord({
        fundingIntentId: created.intent.fundingIntentId,
        routeLegId: leg.routeLegId,
        targetVenue: input.venue,
        destinationTxHash: `0x${"d".repeat(64)}`,
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        notes: "DESTINATION_RECEIVED_ONLY"
      });
    } else {
      await service.refreshIntentStatus(input.userId, created.intent.fundingIntentId);
    }
    return {
      fundingIntentId: created.intent.fundingIntentId,
      routeLegId: leg.routeLegId,
      lifi
    };
  };

  const seedPolymarketFundingThroughService = async (input: {
    userId: string;
    sourceAmount?: string;
    usableBalance?: string;
    status: "DESTINATION_RECEIVED" | "VENUE_CREDIT_PENDING" | "READY_TO_TRADE";
  }) => seedVenueFundingThroughService({ ...input, venue: "POLYMARKET" });

  const seedLimitlessFundingThroughService = async (input: {
    userId: string;
    sourceAmount?: string;
    usableBalance?: string;
    status: "DESTINATION_RECEIVED" | "VENUE_CREDIT_PENDING" | "READY_TO_TRADE";
  }) => seedVenueFundingThroughService({ ...input, venue: "LIMITLESS" });

  const buildRfqAppWithFundingEnforcement = async (
    enabled: boolean,
    executionScopeAuthorities?: ExecutionScopeAuthorityRegistry
  ) => {
    const pg = must(pool, "pool");
    const redis = must(redisClient, "redisClient");
    const originalEnv = {
      FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED,
      FUNDING_LIVE_SUBMIT_ENABLED: process.env.FUNDING_LIVE_SUBMIT_ENABLED
    };
    process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED = enabled ? "true" : "false";
    process.env.FUNDING_LIVE_SUBMIT_ENABLED = "false";
    try {
      return await withSandboxExecutionEnv(() =>
        buildServer({
          logger,
          redisClient: redis,
          pgPool: pg,
          db: createDrizzleDb(pg),
          canonicalServiceBaseUrl: "http://127.0.0.1:4101",
          jwtSecret: "test-secret-at-least-thirty-two-chars",
          sorEnabled: true,
          executionSystemSandboxEnabled: true,
          ...(executionScopeAuthorities ? { executionScopeAuthorities } : {}),
          sorCanaryShadowEnabled: false,
          sorCanaryPercent: 0,
          reliabilityWeight: 0.05,
          latencyWeight: 0.03,
          failureWeight: 0.08,
          sorAcceptAonAwait: true,
          sorAcceptNonAonBackground: true
        })
      );
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };

  const resetFundingRfqScenario = async (): Promise<void> => {
    const pg = must(pool, "pool");
    await clearPersistentState(pg);
    await cleanupTrackedRedisKeys();
  };

  const singlePolymarketSandboxAuthority = (): ExecutionScopeAuthorityRegistry => ({
    CRYPTO_LANE: {
      getScopeSnapshot: async (scopeId) => scopeId === TEST_SINGLE_POLYMARKET_FUNDING_LANE_ID
        ? {
            scopeKind: "CRYPTO_LANE",
            scopeId,
            topicKey: "SANDBOX|FUNDING_ENFORCEMENT|POLYMARKET_SINGLE",
            laneType: "SINGLE",
            venueSet: ["POLYMARKET"],
            candidateSet: ["POLYMARKET_SANDBOX_READY"],
            operatorApprovedToOffer: true,
            readinessDecision: "OPERATOR_APPROVED_SANDBOX",
            authorityRef: "sandbox-single-polymarket-funding-enforcement"
      }
        : null
    }
  });

  const assertArtifactRedacted = (payload: unknown): void => {
    const serialized = JSON.stringify(payload);
    const secretCandidates = [
      process.env.LIFI_API_KEY,
      process.env.POLYMARKET_FUNDING_READ_API_KEY,
      process.env.POLYMARKET_API_KEY,
      process.env.POLYMARKET_API_SECRET,
      process.env.POLYMARKET_API_PASSPHRASE,
      process.env.POLYMARKET_PRIVATE_KEY,
      process.env.DATABASE_URL,
      process.env.TEST_DATABASE_URL
    ].filter((value): value is string => typeof value === "string" && value.length >= 8);
    expect(secretCandidates.some((secret) => serialized.includes(secret))).toBe(false);
    expect(serialized).not.toContain("transactionRequest");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized.toLowerCase()).not.toContain("privatekey");
  };

  const createScopedPolymarketRfq = async (rfqApp: Awaited<ReturnType<typeof buildServer>>, input: {
    takerId: string;
    quantity?: string;
    scopeId?: string;
    venues?: readonly ("POLYMARKET" | "LIMITLESS")[];
  }): Promise<{
    sessionId: string;
    quoteId: string;
    authHeader: Record<string, string>;
    token: string;
  }> => {
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);
    const scopeId = input.scopeId ?? TEST_CRYPTO_LANE_ID;
    if (scopeId === TEST_CRYPTO_LANE_ID) {
      await new CryptoAdminService({ pool: pg }).recordOperatorApprovalIntent(
        TEST_CRYPTO_LANE_ID,
        "integration-test",
        "approve BTC ATH pair lane for RFQ funding enforcement proof"
      );
    }
    const sessionId = randomUUID();
    const quoteId = `${RUN_PREFIX}funding-polymarket-quote-${randomUUID()}`;
    const venues = input.venues ?? ["POLYMARKET", "LIMITLESS"];
    const routeLegQuantity = (Number.parseFloat(input.quantity ?? "10") / venues.length).toString();
    await pg.query(
      `INSERT INTO rfq_sessions
        (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
       VALUES ($1, $2, $3, $4, 'buy', $5, 'AWAITING_USER', $6, NOW() + INTERVAL '5 minutes', $7::jsonb)`,
      [
        sessionId,
        `${RUN_PREFIX}${randomUUID()}`,
        TEST_CANONICAL_MARKET_ID,
        input.takerId,
        input.quantity ?? "10",
        `${RUN_PREFIX}${randomUUID()}`,
        JSON.stringify({ acceptance_policy: "ALL_OR_NONE" })
      ]
    );
    trackSessionKeys(sessionId);
    for (const venue of venues) {
      const candidateQuoteId = venue === "POLYMARKET"
        ? quoteId
        : `${RUN_PREFIX}funding-${venue.toLowerCase()}-quote-${randomUUID()}`;
      await pg.query(
        `INSERT INTO rfq_quotes
          (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
         VALUES ($1, $2, $3, 'RECEIVED', '1.00', $4, 1, NOW() + INTERVAL '5 minutes', $5::jsonb)`,
        [
          randomUUID(),
          sessionId,
          lp?.keyDbId ?? "",
          routeLegQuantity,
          JSON.stringify({ quoteId: candidateQuoteId, lpId: venue })
        ]
      );
    }

    const authHeader = {
      authorization: `Bearer ${rfqApp.jwt.sign({ userId: input.takerId })}`
    };
    const tokenResponse = await rfqApp.inject({
      method: "POST",
      url: `/rfq/${sessionId}/execution-scope-token`,
      payload: {
        quoteId,
        scopeKind: "CRYPTO_LANE",
        scopeId,
        ttlSeconds: 120
      },
      headers: authHeader
    });
    if (tokenResponse.statusCode !== 201) {
      throw new Error(`Funding RFQ execution-scope token failed with ${tokenResponse.statusCode}: ${tokenResponse.body}`);
    }
    return {
      sessionId,
      quoteId,
      authHeader,
      token: (tokenResponse.json() as { token: string }).token
    };
  };

  const acceptScopedRfq = async (
    rfqApp: Awaited<ReturnType<typeof buildServer>>,
    context: Awaited<ReturnType<typeof createScopedPolymarketRfq>>
  ) => {
    const acceptResponse = await rfqApp.inject({
      method: "POST",
      url: `/rfq/${context.sessionId}/accept`,
      payload: {
        quoteId: context.quoteId,
        executionScopeToken: context.token
      },
      headers: context.authHeader
    });
    if (acceptResponse.statusCode !== 202) {
      throw new Error(`Funding RFQ accept failed with ${acceptResponse.statusCode}: ${acceptResponse.body}`);
    }
    const body = acceptResponse.json() as {
      final_status?: "COMPLETED" | "FAILED";
      execution_id?: string | null;
    };
    const statusResponse = body.execution_id
      ? await rfqApp.inject({
          method: "GET",
          url: `/rfq/${context.sessionId}/executions/${body.execution_id}/status`,
          headers: context.authHeader
        })
      : null;
    return { acceptResponse, body, statusResponse };
  };

  const listExecutionAuditEvents = async (executionId: string) => {
    const result = await must(pool, "pool").query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload
         FROM execution_control_audit_records
        WHERE execution_record_id = $1::uuid
        ORDER BY created_at ASC`,
      [executionId]
    );
    return result.rows;
  };

  beforeAll(async () => {
    canonicalService = Fastify({ logger: false });
    canonicalService.get("/markets/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const params = request.params as { id: string };
      return {
        id: params.id,
        canonicalEventId: TEST_CANONICAL_EVENT_ID,
        isActive: true,
        resolutionMetadata: {
          canonicalMarketId: params.id
        }
      };
    });
    await canonicalService.listen({ host: "127.0.0.1", port: 4101 });

    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
    await clearPersistentState(pool);
    await pool.query(
      `INSERT INTO resolution_profiles (
        id,
        venue,
        venue_market_id,
        canonical_event_id,
        canonical_market_id,
        oracle_type,
        oracle_name,
        resolution_authority_type,
        primary_resolution_text,
        supplemental_rules_text,
        dispute_window_hours,
        settlement_lag_hours,
        market_type,
        outcome_schema,
        historical_divergence_rate,
        metadata
      ) VALUES (
        $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::jsonb
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        "10000000-0000-4000-8000-000000000001",
        "POLYMARKET",
        "integration-market-1",
        TEST_CANONICAL_EVENT_ID,
        TEST_CANONICAL_MARKET_ID,
        "manual_committee",
        "Integration Committee",
        "committee",
        "Resolves YES if the event occurs.",
        "Primary venue bulletin controls.",
        "24",
        "12",
        "binary",
        JSON.stringify({ outcomes: ["YES", "NO"] }),
        "0.01",
        JSON.stringify({ testSuite: "rfq-lifecycle" })
      ]
    );
    await pool.query(
      `INSERT INTO planner_shard_state (
        shard_id,
        mode,
        active_plans,
        active_buckets,
        stale_reservations,
        avg_planner_latency_ms
      ) VALUES ($1, $2, 0, 0, 0, NULL)
      ON CONFLICT (shard_id) DO NOTHING`,
      ["sor-main", "FULL_MODE"]
    );

    redisClient = createInMemoryRedisClient();
    await redisClient.connect();

    const jwtSecret = "test-secret-at-least-thirty-two-chars";
    const integrationRedis = redisClient;
    const integrationPool = pool;
    app = await withSandboxExecutionEnv(() =>
      buildServer({
        logger,
        redisClient: integrationRedis,
        pgPool: integrationPool,
        db: createDrizzleDb(integrationPool),
        canonicalServiceBaseUrl: "http://127.0.0.1:4101",
        jwtSecret,
        sorEnabled: true,
        sorCanaryShadowEnabled: false,
        sorCanaryPercent: 0,
        reliabilityWeight: 0.05,
        latencyWeight: 0.03,
        failureWeight: 0.08,
        sorAcceptAonAwait: true,
        sorAcceptNonAonBackground: true,
        executionSystemSandboxEnabled: true
      })
    );

    sessionRepository = new RFQSessionRepository(pool);
    quoteRepository = new RFQQuoteRepository(pool);
    executionRepository = new RFQExecutionRepository(pool);
    sessionManager = new RFQSessionManager({ redis: redisClient });
    eventEmitter = new InMemoryRFQEventEmitter();
  }, 60000);

  beforeEach(async () => {
    const pg = must(pool, "pool");
    await clearPersistentState(pg);
    try {
      await cleanupTrackedRedisKeys();
    } catch (error) {
      if (!isConnectionClosedError(error)) {
        throw error;
      }
    }
  });

  afterAll(async () => {
    try {
      await cleanupTrackedRedisKeys();
    } catch {
      // best-effort cleanup for managed redis
    }
    if (app) {
      try {
        await app.close();
      } catch (error) {
        if (!isConnectionClosedError(error)) {
          throw error;
        }
      }
    }
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (error) {
        if (!isConnectionClosedError(error)) {
          throw error;
        }
      }
    }
    if (pool) {
      await pool.end();
    }
    if (canonicalService) {
      await canonicalService.close();
    }
  }, 60000);

  it("SOR handoff: accept creates plan, persists reservation token, and runs plan", async () => {
    const testApp = must(app, "app");
    const sessions = must(sessionRepository, "sessionRepository");
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);

    const sessionId = randomUUID();
    const quoteId = `${RUN_PREFIX}sor-quote-1`;

    await pg.query(
      `INSERT INTO rfq_sessions
      (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes', $9::jsonb)`,
      [
        sessionId,
        `${RUN_PREFIX}${randomUUID()}`,
        TEST_CANONICAL_MARKET_ID,
        makeUuid(),
        "buy",
        "10",
        "AWAITING_USER",
        `${RUN_PREFIX}${randomUUID()}`,
        JSON.stringify({ acceptance_policy: "ALL_OR_NONE" })
      ]
    );
    trackSessionKeys(sessionId);

    await pg.query(
      `INSERT INTO rfq_quotes
      (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
      VALUES ($1, $2, $3, 'RECEIVED', '1.10', '10', 1, NOW() + INTERVAL '5 minutes', $4::jsonb)`,
      [
        randomUUID(),
        sessionId,
        lp?.keyDbId ?? "",
        JSON.stringify({ quoteId, lpId: lp?.lpId ?? "" })
      ]
    );

    const acceptResponse = await testApp.inject({
      method: "POST",
      url: `/rfq/${sessionId}/accept`,
      payload: { quoteId },
      headers: {
        authorization: `Bearer ${testApp.jwt.sign({ userId: "test-taker-sor" })}`
      }
    });

    if (acceptResponse.statusCode !== 202) {
      throw new Error(`Accept RFQ failed with ${acceptResponse.statusCode}: ${acceptResponse.body}`);
    }
    expect(acceptResponse.statusCode).toBe(202);
    const body = acceptResponse.json() as {
      status: string;
      plan_id: string;
    };
    expect(body.status).toBe("PLAN_ACCEPTED");
    expect(body.plan_id).toBeTruthy();

    const plan = await pg.query<{ id: string; reservation_token: string | null }>(
      "SELECT id, reservation_token FROM routing_plans WHERE id = $1 LIMIT 1",
      [body.plan_id]
    );
    expect(plan.rows[0]?.reservation_token).toBeTruthy();

    const stepCount = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM route_steps WHERE routing_plan_id = $1",
      [body.plan_id]
    );
    expect(Number.parseInt(stepCount.rows[0]?.count ?? "0", 10)).toBeGreaterThan(0);

    const runnerContextCount = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM route_history
       WHERE routing_plan_id = $1
         AND event_type = 'ROUTE_RUN_CONTEXT'
         AND payload->>'reservation_token' IS NOT NULL`,
      [body.plan_id]
    );
    expect(Number.parseInt(runnerContextCount.rows[0]?.count ?? "0", 10)).toBeGreaterThan(0);

    const finalSession = await sessions.findById(sessionId);
    expect(finalSession?.status).toBe("SETTLED");

    const executionIntentCount = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM execution_intents WHERE route_plan_id = $1",
      [body.plan_id]
    );
    expect(Number.parseInt(executionIntentCount.rows[0]?.count ?? "0", 10)).toBe(1);

    const executionRecordCount = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM execution_records er
       JOIN execution_intents ei ON ei.id = er.execution_intent_id
       WHERE ei.route_plan_id = $1`,
      [body.plan_id]
    );
    expect(Number.parseInt(executionRecordCount.rows[0]?.count ?? "0", 10)).toBe(1);

    const transitionCount = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM execution_state_transitions est
       JOIN execution_records er ON er.id = est.execution_record_id
       JOIN execution_intents ei ON ei.id = er.execution_intent_id
       WHERE ei.route_plan_id = $1`,
      [body.plan_id]
    );
    expect(Number.parseInt(transitionCount.rows[0]?.count ?? "0", 10)).toBeGreaterThanOrEqual(5);

    const routeTrace = await pg.query<{ compatibility_version_ids: unknown }>(
      "SELECT compatibility_version_ids FROM route_selection_traces WHERE route_plan_id = $1 LIMIT 1",
      [body.plan_id]
    );
    expect(routeTrace.rows[0]?.compatibility_version_ids).toBeDefined();
  }, 60000);

  it("Execution v0 sandbox: RFQ accept persists receipt metadata and exposes frontend status", async () => {
    const testApp = must(app, "app");
    const sessions = must(sessionRepository, "sessionRepository");
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);
    const cryptoAdmin = new CryptoAdminService({ pool: pg });
    const executionRecords = new ExecutionRecordRepository(pg);

    await cryptoAdmin.recordOperatorApprovalIntent(
      TEST_CRYPTO_LANE_ID,
      "integration-test",
      "approve BTC ATH pair lane for sandbox RFQ accept-to-receipt proof"
    );

    const takerId = makeUuid();
    const sessionId = randomUUID();
    const limitlessQuoteId = `${RUN_PREFIX}sandbox-limitless-quote`;
    const polymarketQuoteId = `${RUN_PREFIX}sandbox-polymarket-quote`;

    await pg.query(
      `INSERT INTO rfq_sessions
      (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes', $9::jsonb)`,
      [
        sessionId,
        `${RUN_PREFIX}${randomUUID()}`,
        TEST_CANONICAL_MARKET_ID,
        takerId,
        "buy",
        "10",
        "AWAITING_USER",
        `${RUN_PREFIX}${randomUUID()}`,
        JSON.stringify({ acceptance_policy: "ALL_OR_NONE" })
      ]
    );
    trackSessionKeys(sessionId);

    for (const [quoteId, venue] of [
      [limitlessQuoteId, "LIMITLESS"],
      [polymarketQuoteId, "POLYMARKET"]
    ] as const) {
      await pg.query(
        `INSERT INTO rfq_quotes
        (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
        VALUES ($1, $2, $3, 'RECEIVED', '1.00', '5', 1, NOW() + INTERVAL '5 minutes', $4::jsonb)`,
        [
          randomUUID(),
          sessionId,
          lp?.keyDbId ?? "",
          JSON.stringify({ quoteId, lpId: venue })
        ]
      );
    }

    const authHeader = {
      authorization: `Bearer ${testApp.jwt.sign({ userId: takerId })}`
    };
    const scopeTokenResponse = await testApp.inject({
      method: "POST",
      url: `/rfq/${sessionId}/execution-scope-token`,
      payload: {
        quoteId: limitlessQuoteId,
        scopeKind: "CRYPTO_LANE",
        scopeId: TEST_CRYPTO_LANE_ID,
        ttlSeconds: 120
      },
      headers: authHeader
    });

    if (scopeTokenResponse.statusCode !== 201) {
      throw new Error(`Execution scope token failed with ${scopeTokenResponse.statusCode}: ${scopeTokenResponse.body}`);
    }
    const scopeTokenBody = scopeTokenResponse.json() as {
      token: string;
      scope: {
        venueSet: string[];
        candidateSet: string[];
      };
    };
    expect(scopeTokenBody.scope.venueSet.sort()).toEqual(["LIMITLESS", "POLYMARKET"]);
    expect(scopeTokenBody.scope.candidateSet.length).toBeGreaterThan(0);

    const acceptResponse = await testApp.inject({
      method: "POST",
      url: `/rfq/${sessionId}/accept`,
      payload: {
        quoteId: limitlessQuoteId,
        executionScopeToken: scopeTokenBody.token
      },
      headers: authHeader
    });

    if (acceptResponse.statusCode !== 202) {
      throw new Error(`Sandbox accept RFQ failed with ${acceptResponse.statusCode}: ${acceptResponse.body}`);
    }
    const acceptBody = acceptResponse.json() as {
      status: string;
      final_status?: string;
      execution_id?: string | null;
    };
    expect(acceptBody.status).toBe("PLAN_ACCEPTED");
    expect(acceptBody.final_status).toBe("COMPLETED");
    expect(acceptBody.execution_id).toBeTruthy();

    const executionRecord = await executionRecords.findById(acceptBody.execution_id!);
    expect(executionRecord).not.toBeNull();
    const metadataCandidate = (executionRecord!.metadata as Record<string, unknown>).executionSystemV0;
    const metadata = ExecutionSystemMetadataSchema.parse(metadataCandidate);
    expect(metadata.executionId).toBe(acceptBody.execution_id);
    expect(metadata.rfqId).toBe(sessionId);
    expect(metadata.userId).toBe(takerId);
    expect(metadata.canonicalTopicKey).toBe("CRYPTO|ATH_BY_DATE|BTC");
    expect(metadata.selectedLaneId).toBe(TEST_CRYPTO_LANE_ID);
    expect(metadata.venuePath.sort()).toEqual(["LIMITLESS", "POLYMARKET"]);
    expect(metadata.executionMode).toBe("PAIR");
    expect(metadata.executionState).toBe("COMPLETED");
    expect(metadata.settlementState).toBe("SETTLEMENT_VERIFIED");
    expect(metadata.ghostFillState).toBe("CLEAR");
    expect(metadata.fallbackState).toBe("NOT_USED");
    expect(metadata.auditEventIds.length).toBeGreaterThanOrEqual(10);
    expect(metadata.receipt).toMatchObject({
      executionId: acceptBody.execution_id,
      userId: takerId,
      state: "COMPLETED",
      filledSize: "10",
      settlementStatus: "SETTLEMENT_VERIFIED",
      ghostFillStatus: "CLEAR"
    });

    const statusResponse = await testApp.inject({
      method: "GET",
      url: `/rfq/${sessionId}/executions/${acceptBody.execution_id}/status`,
      headers: authHeader
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      executionId: acceptBody.execution_id,
      currentState: "COMPLETED",
      userStatus: "completed",
      settlementStatus: "SETTLEMENT_VERIFIED",
      ghostFillStatus: "CLEAR",
      fallbackStatus: "not_used",
      receipt: {
        executionId: acceptBody.execution_id,
        filledSize: "10",
        settlementStatus: "SETTLEMENT_VERIFIED"
      }
    });

    const finalSession = await sessions.findById(sessionId);
    expect(finalSession?.status).toBe("SETTLED");

    const auditRows = await pg.query<{ event_type: string }>(
      `SELECT event_type
         FROM execution_control_audit_records
        WHERE execution_record_id = $1
        ORDER BY created_at ASC`,
      [acceptBody.execution_id]
    );
    expect(auditRows.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "EXECUTION_CREATED",
        "PREFLIGHT_STARTED",
        "PREFLIGHT_PASSED",
        "ORDER_SUBMITTED",
        "SETTLEMENT_VERIFIED",
        "ACCOUNTING_UPDATED",
        "USER_RECEIPT_EMITTED"
      ])
    );
  }, 60000);

  it("Execution v0 sandbox: RFQ accept funding enforcement blocks non-ready funding and passes exact venue-ready capital", async () => {
    const testApp = must(app, "app");
    const pg = must(pool, "pool");
    expect(process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED).not.toBe("true");
    expect(process.env.FUNDING_LIVE_SUBMIT_ENABLED).not.toBe("true");

    const assertFundingBlocked = async (
      label: string,
      setupFunding: (takerId: string) => Promise<void>
    ): Promise<void> => {
      await resetFundingRfqScenario();
      const takerId = makeUuid();
      await setupFunding(takerId);
      const context = await createScopedPolymarketRfq(enabledApp, { takerId });
      const accepted = await acceptScopedRfq(enabledApp, context);
      expect(accepted.body.final_status, label).toBe("FAILED");
      expect(accepted.body.execution_id, label).toBeTruthy();
      expect(accepted.statusResponse?.statusCode, label).toBe(200);
      expect(accepted.statusResponse?.json(), label).toMatchObject({
        currentState: "FAILED_CLOSED",
        userStatus: "failed closed"
      });
      const auditRows = await listExecutionAuditEvents(accepted.body.execution_id!);
      expect(auditRows.some((row) =>
        row.event_type === "PREFLIGHT_FAILED" &&
        row.payload.code === "FUNDING_UNAVAILABLE"
      ), label).toBe(true);
      expect(auditRows.some((row) => row.event_type === "ACCOUNTING_UPDATED"), label).toBe(false);
    };

    const enabledApp = await buildRfqAppWithFundingEnforcement(true);
    try {
      await resetFundingRfqScenario();
      const disabledTakerId = makeUuid();
      const disabledContext = await createScopedPolymarketRfq(testApp, { takerId: disabledTakerId });
      const disabledAccept = await acceptScopedRfq(testApp, disabledContext);
      expect(disabledAccept.body.final_status).toBe("COMPLETED");
      expect(disabledAccept.statusResponse?.json()).toMatchObject({
        currentState: "COMPLETED",
        userStatus: "completed"
      });

      await assertFundingBlocked("no funding row", async () => undefined);
      await assertFundingBlocked("destination received only", async (takerId) => {
        const limitlessSeed = await seedLimitlessFundingThroughService({
          userId: takerId,
          usableBalance: "100",
          status: "READY_TO_TRADE"
        });
        const seeded = await seedPolymarketFundingThroughService({
          userId: takerId,
          status: "DESTINATION_RECEIVED"
        });
        expect(limitlessSeed.lifi.quoteCalls).toBe(1);
        expect(limitlessSeed.lifi.statusCalls).toBe(1);
        expect(seeded.lifi.quoteCalls).toBe(1);
        expect(seeded.lifi.statusCalls).toBe(0);
      });
      await assertFundingBlocked("venue credit pending", async (takerId) => {
        const limitlessSeed = await seedLimitlessFundingThroughService({
          userId: takerId,
          usableBalance: "100",
          status: "READY_TO_TRADE"
        });
        const seeded = await seedPolymarketFundingThroughService({
          userId: takerId,
          usableBalance: "0",
          status: "VENUE_CREDIT_PENDING"
        });
        expect(limitlessSeed.lifi.quoteCalls).toBe(1);
        expect(limitlessSeed.lifi.statusCalls).toBe(1);
        expect(seeded.lifi.quoteCalls).toBe(1);
        expect(seeded.lifi.statusCalls).toBe(1);
      });
      await assertFundingBlocked("ready wrong venue", async (takerId) => {
        const limitlessSeed = await seedLimitlessFundingThroughService({
          userId: takerId,
          usableBalance: "100",
          status: "READY_TO_TRADE"
        });
        expect(limitlessSeed.lifi.quoteCalls).toBe(1);
        expect(limitlessSeed.lifi.statusCalls).toBe(1);
      });
      await assertFundingBlocked("ready wrong user", async () => {
        const wrongUserId = makeUuid();
        const limitlessSeed = await seedLimitlessFundingThroughService({
          userId: wrongUserId,
          usableBalance: "100",
          status: "READY_TO_TRADE"
        });
        const polymarketSeed = await seedPolymarketFundingThroughService({
          userId: wrongUserId,
          usableBalance: "100",
          status: "READY_TO_TRADE"
        });
        expect(limitlessSeed.lifi.statusCalls).toBe(1);
        expect(polymarketSeed.lifi.statusCalls).toBe(1);
      });
      await assertFundingBlocked("insufficient ready amount", async (takerId) => {
        const limitlessSeed = await seedLimitlessFundingThroughService({
          userId: takerId,
          usableBalance: "100",
          status: "READY_TO_TRADE"
        });
        const polymarketSeed = await seedPolymarketFundingThroughService({
          userId: takerId,
          sourceAmount: "5",
          usableBalance: "5",
          status: "READY_TO_TRADE"
        });
        expect(limitlessSeed.lifi.statusCalls).toBe(1);
        expect(polymarketSeed.lifi.statusCalls).toBe(1);
      });

      await resetFundingRfqScenario();
      const readyTakerId = makeUuid();
      const readySeed = await seedPolymarketFundingThroughService({
        userId: readyTakerId,
        usableBalance: "100",
        status: "READY_TO_TRADE"
      });
      const readyLimitlessSeed = await seedLimitlessFundingThroughService({
        userId: readyTakerId,
        usableBalance: "100",
        status: "READY_TO_TRADE"
      });
      expect(readySeed.lifi.quoteCalls).toBe(1);
      expect(readySeed.lifi.statusCalls).toBe(1);
      expect(readyLimitlessSeed.lifi.quoteCalls).toBe(1);
      expect(readyLimitlessSeed.lifi.statusCalls).toBe(1);

      const repository = new FundingRepository(pg);
      const adminReadiness = new FundingReadinessAdminService({
        repository,
        env: {
          FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true",
          POLYMARKET_FUNDING_READINESS_MODE: "STUB",
          LIMITLESS_FUNDING_READINESS_MODE: "STUB"
        } as NodeJS.ProcessEnv
      });
      const fundingSnapshot = async (): Promise<string> => {
        const result = await pg.query<{ snapshot: string }>(
          `SELECT jsonb_build_object(
            'auditCount', (SELECT count(*)::int FROM funding_audit_events),
            'reconciliationCount', (SELECT count(*)::int FROM funding_reconciliation_records),
            'intentStatuses', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id::text, 'status', status) ORDER BY id::text), '[]'::jsonb)
                FROM funding_intents
            ),
            'legStatuses', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id::text, 'status', status) ORDER BY id::text), '[]'::jsonb)
                FROM funding_route_legs
            )
          )::text AS snapshot`
        );
        return result.rows[0]!.snapshot;
      };
      const beforeAdminRead = await fundingSnapshot();
      const readinessRows = await adminReadiness.listByIntent(readySeed.fundingIntentId);
      expect(readinessRows).toHaveLength(1);
      expect(readinessRows[0]).toMatchObject({
        readinessStatus: "READY_TO_TRADE",
        readyToTrade: true
      });
      const limitlessReadinessRows = await adminReadiness.listByIntent(readyLimitlessSeed.fundingIntentId);
      expect(limitlessReadinessRows).toHaveLength(1);
      expect(limitlessReadinessRows[0]).toMatchObject({
        targetVenue: "LIMITLESS",
        readinessStatus: "READY_TO_TRADE",
        readyToTrade: true,
        checkerMode: "STUB"
      });
      const afterAdminRead = await fundingSnapshot();
      expect(afterAdminRead).toBe(beforeAdminRead);

      const readyContext = await createScopedPolymarketRfq(enabledApp, { takerId: readyTakerId });
      const readyAccept = await acceptScopedRfq(enabledApp, readyContext);
      expect(readyAccept.body.final_status).toBe("COMPLETED");
      expect(readyAccept.statusResponse?.json()).toMatchObject({
        currentState: "COMPLETED",
        userStatus: "completed",
        receipt: expect.objectContaining({
          filledSize: "10",
          settlementStatus: "SETTLEMENT_VERIFIED"
        })
      });
      const readyAuditRows = await listExecutionAuditEvents(readyAccept.body.execution_id!);
      expect(readyAuditRows.some((row) => row.event_type === "PREFLIGHT_PASSED")).toBe(true);
      expect(readyAuditRows.some((row) => row.event_type === "ACCOUNTING_UPDATED")).toBe(true);
    } finally {
      await enabledApp.close();
      expect(process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED).not.toBe("true");
      expect(process.env.FUNDING_LIVE_SUBMIT_ENABLED).not.toBe("true");
    }
  }, 120000);

  it("Execution v0 sandbox: single-venue Polymarket funding enforcement rehearsal passes exact route and blocks uncovered pair route", async () => {
    expect(process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED).not.toBe("true");
    expect(process.env.FUNDING_LIVE_SUBMIT_ENABLED).not.toBe("true");

    const singleAuthority = singlePolymarketSandboxAuthority();
    const disabledSingleApp = await buildRfqAppWithFundingEnforcement(false, singleAuthority);
    const enabledSingleApp = await buildRfqAppWithFundingEnforcement(true, singleAuthority);
    const enabledPairApp = await buildRfqAppWithFundingEnforcement(true);

    try {
      await resetFundingRfqScenario();
      const disabledTakerId = makeUuid();
      const disabledContext = await createScopedPolymarketRfq(disabledSingleApp, {
        takerId: disabledTakerId,
        scopeId: TEST_SINGLE_POLYMARKET_FUNDING_LANE_ID,
        venues: ["POLYMARKET"]
      });
      const disabledAccept = await acceptScopedRfq(disabledSingleApp, disabledContext);
      expect(disabledAccept.body.final_status).toBe("COMPLETED");

      await resetFundingRfqScenario();
      const wrongVenueTakerId = makeUuid();
      const wrongVenueSeed = await seedLimitlessFundingThroughService({
        userId: wrongVenueTakerId,
        usableBalance: "100",
        status: "READY_TO_TRADE"
      });
      expect(wrongVenueSeed.lifi.statusCalls).toBe(1);
      const wrongVenueContext = await createScopedPolymarketRfq(enabledSingleApp, {
        takerId: wrongVenueTakerId,
        scopeId: TEST_SINGLE_POLYMARKET_FUNDING_LANE_ID,
        venues: ["POLYMARKET"]
      });
      const wrongVenueAccept = await acceptScopedRfq(enabledSingleApp, wrongVenueContext);
      expect(wrongVenueAccept.body.final_status).toBe("FAILED");
      expect(wrongVenueAccept.statusResponse?.json()).toMatchObject({
        currentState: "FAILED_CLOSED",
        userStatus: "failed closed"
      });
      const wrongVenueAudit = await listExecutionAuditEvents(wrongVenueAccept.body.execution_id!);
      expect(wrongVenueAudit.some((row) =>
        row.event_type === "PREFLIGHT_FAILED" &&
        row.payload.code === "FUNDING_UNAVAILABLE"
      )).toBe(true);

      await resetFundingRfqScenario();
      const pairTakerId = makeUuid();
      const pairPolymarketSeed = await seedPolymarketFundingThroughService({
        userId: pairTakerId,
        usableBalance: "100",
        status: "READY_TO_TRADE"
      });
      const uncoveredPairContext = await createScopedPolymarketRfq(enabledPairApp, { takerId: pairTakerId });
      const uncoveredPairAccept = await acceptScopedRfq(enabledPairApp, uncoveredPairContext);
      expect(pairPolymarketSeed.lifi.statusCalls).toBe(1);
      expect(uncoveredPairAccept.body.final_status).toBe("FAILED");
      const uncoveredPairAudit = await listExecutionAuditEvents(uncoveredPairAccept.body.execution_id!);
      expect(uncoveredPairAudit.some((row) =>
        row.event_type === "PREFLIGHT_FAILED" &&
        row.payload.code === "FUNDING_UNAVAILABLE"
      )).toBe(true);

      await resetFundingRfqScenario();
      const readyTakerId = makeUuid();
      const readySeed = await seedPolymarketFundingThroughService({
        userId: readyTakerId,
        usableBalance: "100",
        status: "READY_TO_TRADE"
      });
      const readyContext = await createScopedPolymarketRfq(enabledSingleApp, {
        takerId: readyTakerId,
        scopeId: TEST_SINGLE_POLYMARKET_FUNDING_LANE_ID,
        venues: ["POLYMARKET"]
      });
      const readyAccept = await acceptScopedRfq(enabledSingleApp, readyContext);
      expect(readyAccept.body.final_status).toBe("COMPLETED");
      const readyStatus = readyAccept.statusResponse?.json();
      expect(readyStatus).toMatchObject({
        currentState: "COMPLETED",
        userStatus: "completed",
        venuePath: ["POLYMARKET"],
        receipt: expect.objectContaining({
          filledSize: "10",
          settlementStatus: "SETTLEMENT_VERIFIED"
        })
      });
      const readyAudit = await listExecutionAuditEvents(readyAccept.body.execution_id!);
      expect(readyAudit.some((row) => row.event_type === "PREFLIGHT_PASSED")).toBe(true);

      const artifact = {
        generatedAt: new Date().toISOString(),
        status: "COMPLETED",
        sandboxLane: {
          laneId: TEST_SINGLE_POLYMARKET_FUNDING_LANE_ID,
          laneState: "OPERATOR_APPROVED_SANDBOX",
          venuePath: ["POLYMARKET"],
          scopeKind: "CRYPTO_LANE"
        },
        fundingEvidence: {
          fundingIntentId: readySeed.fundingIntentId,
          routeLegId: readySeed.routeLegId,
          targetVenue: "POLYMARKET",
          readinessStatus: "READY_TO_TRADE",
          source: "funding_service_refreshIntentStatus",
          lifiQuoteCalls: readySeed.lifi.quoteCalls,
          lifiStatusCalls: readySeed.lifi.statusCalls
        },
        rfqAccept: {
          executionId: readyAccept.body.execution_id,
          finalStatus: readyAccept.body.final_status,
          venuePath: readyStatus?.venuePath ?? [],
          currentState: readyStatus?.currentState ?? null
        },
        pairRouteBlock: {
          tested: true,
          finalStatus: uncoveredPairAccept.body.final_status,
          reason: "FUNDING_UNAVAILABLE",
          missingVenueReadinessCoverage: ["LIMITLESS"]
        },
        safety: {
          defaultFundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
          scriptScopedFundingPreflightEnforcementOnly: true,
          liveLifiExecutionEnabled: false,
          backendBroadcastedTransaction: false,
          liveVenueSubmissionEnabled: false
        },
        redactionVerified: true
      };
      assertArtifactRedacted(artifact);

      const artifactDir = path.resolve(process.cwd(), "artifacts", "funding");
      const jsonPath = path.join(artifactDir, "polymarket-single-venue-funding-enforcement-rehearsal.json");
      const markdownPath = path.join(artifactDir, "polymarket-single-venue-funding-enforcement-rehearsal.md");
      await mkdir(artifactDir, { recursive: true });
      await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      await writeFile(markdownPath, [
        "# Polymarket Single-Venue Funding Enforcement Rehearsal",
        "",
        `Generated: ${artifact.generatedAt}`,
        "",
        "## Result",
        "",
        `- Status: ${artifact.status}`,
        `- Sandbox lane: ${artifact.sandboxLane.laneId}`,
        `- Venue path: ${artifact.sandboxLane.venuePath.join(", ")}`,
        `- Funding intent: ${artifact.fundingEvidence.fundingIntentId}`,
        `- Route leg: ${artifact.fundingEvidence.routeLegId}`,
        `- RFQ accept final status: ${artifact.rfqAccept.finalStatus}`,
        `- Pair route without Limitless readiness blocked: ${artifact.pairRouteBlock.finalStatus === "FAILED"}`,
        "",
        "## Safety",
        "",
        `- Default funding enforcement enabled: ${artifact.safety.defaultFundingPreflightEnforcementEnabled}`,
        `- Live LI.FI execution enabled: ${artifact.safety.liveLifiExecutionEnabled}`,
        `- Backend broadcasted transaction: ${artifact.safety.backendBroadcastedTransaction}`,
        `- Live venue submission enabled: ${artifact.safety.liveVenueSubmissionEnabled}`,
        `- Redaction verified: ${artifact.redactionVerified}`
      ].join("\n"), "utf8");
    } finally {
      await disabledSingleApp.close();
      await enabledSingleApp.close();
      await enabledPairApp.close();
      expect(process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED).not.toBe("true");
      expect(process.env.FUNDING_LIVE_SUBMIT_ENABLED).not.toBe("true");
    }
  }, 120000);

  it("Execution v0 sandbox: Polymarket V2 dry-run adapter fails closed and exposes safe status", async () => {
    const pg = must(pool, "pool");
    const redis = must(redisClient, "redisClient");
    const [lp] = await createLPKeys(pg);
    const cryptoAdmin = new CryptoAdminService({ pool: pg });
    const originalEnv = {
      POLYMARKET_EXECUTION_MODE: process.env.POLYMARKET_EXECUTION_MODE,
      POLYMARKET_LIVE_EXECUTION_ENABLED: process.env.POLYMARKET_LIVE_EXECUTION_ENABLED,
      POLYMARKET_CLOB_HOST: process.env.POLYMARKET_CLOB_HOST,
      POLYMARKET_CHAIN_ID: process.env.POLYMARKET_CHAIN_ID,
      POLYMARKET_BUILDER_CODE: process.env.POLYMARKET_BUILDER_CODE
    };

    process.env.POLYMARKET_EXECUTION_MODE = "v2";
    process.env.POLYMARKET_LIVE_EXECUTION_ENABLED = "false";
    process.env.POLYMARKET_CLOB_HOST = "https://clob.polymarket.test";
    process.env.POLYMARKET_CHAIN_ID = "137";
    process.env.POLYMARKET_BUILDER_CODE = "lotus-integration-builder";

    const dryRunApp = await withSandboxExecutionEnv(() =>
      buildServer({
        logger,
        redisClient: redis,
        pgPool: pg,
        db: createDrizzleDb(pg),
        canonicalServiceBaseUrl: "http://127.0.0.1:4101",
        jwtSecret: "test-secret-at-least-thirty-two-chars",
        sorEnabled: true,
        executionSystemSandboxEnabled: true,
        sorCanaryShadowEnabled: false,
        sorCanaryPercent: 0,
        reliabilityWeight: 0.05,
        latencyWeight: 0.03,
        failureWeight: 0.08,
        sorAcceptAonAwait: true,
        sorAcceptNonAonBackground: true
      }),
      {
        POLYMARKET_EXECUTION_MODE: "v2",
        POLYMARKET_LIVE_EXECUTION_ENABLED: "false"
      }
    );

    try {
      await cryptoAdmin.recordOperatorApprovalIntent(
        TEST_CRYPTO_POLYMARKET_DRY_RUN_LANE_ID,
        "integration-test",
        "approve BTC threshold pair lane for Polymarket V2 dry-run fail-closed proof"
      );

      const takerId = makeUuid();
      const sessionId = randomUUID();
      const polymarketQuoteId = `${RUN_PREFIX}sandbox-polymarket-v2-quote`;
      const predictQuoteId = `${RUN_PREFIX}sandbox-predict-quote`;

      await pg.query(
        `INSERT INTO rfq_sessions
        (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes', $9::jsonb)`,
        [
          sessionId,
          `${RUN_PREFIX}${randomUUID()}`,
          TEST_CANONICAL_MARKET_ID,
          takerId,
          "buy",
          "10",
          "AWAITING_USER",
          `${RUN_PREFIX}${randomUUID()}`,
          JSON.stringify({ acceptance_policy: "ALL_OR_NONE" })
        ]
      );
      trackSessionKeys(sessionId);

      for (const [quoteId, venue] of [
        [polymarketQuoteId, "POLYMARKET"],
        [predictQuoteId, "PREDICT"]
      ] as const) {
        await pg.query(
          `INSERT INTO rfq_quotes
          (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
          VALUES ($1, $2, $3, 'RECEIVED', $4, '5', 1, NOW() + INTERVAL '5 minutes', $5::jsonb)`,
          [
            randomUUID(),
            sessionId,
            lp?.keyDbId ?? "",
            venue === "POLYMARKET" ? "0.90" : "1.00",
            JSON.stringify({ quoteId, lpId: venue })
          ]
        );
      }

      const authHeader = {
        authorization: `Bearer ${dryRunApp.jwt.sign({ userId: takerId })}`
      };
      const tokenResponse = await dryRunApp.inject({
        method: "POST",
        url: `/rfq/${sessionId}/execution-scope-token`,
        payload: {
          quoteId: polymarketQuoteId,
          scopeKind: "CRYPTO_LANE",
          scopeId: TEST_CRYPTO_POLYMARKET_DRY_RUN_LANE_ID,
          ttlSeconds: 120
        },
        headers: authHeader
      });
      expect(tokenResponse.statusCode).toBe(201);
      const tokenBody = tokenResponse.json() as { token: string };

      const acceptResponse = await dryRunApp.inject({
        method: "POST",
        url: `/rfq/${sessionId}/accept`,
        payload: {
          quoteId: polymarketQuoteId,
          executionScopeToken: tokenBody.token
        },
        headers: authHeader
      });
      if (acceptResponse.statusCode !== 202) {
        throw new Error(`Polymarket V2 dry-run accept failed with ${acceptResponse.statusCode}: ${acceptResponse.body}`);
      }
      const acceptBody = acceptResponse.json() as {
        final_status?: string;
        execution_id?: string | null;
      };
      expect(acceptBody.final_status).toBe("FAILED");
      expect(acceptBody.execution_id).toBeTruthy();

      const statusResponse = await dryRunApp.inject({
        method: "GET",
        url: `/rfq/${sessionId}/executions/${acceptBody.execution_id}/status`,
        headers: authHeader
      });
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        executionId: acceptBody.execution_id,
        currentState: "FAILED_CLOSED",
        userStatus: "failed closed",
        filledAmount: "0",
        settlementStatus: "SETTLEMENT_PENDING",
        ghostFillStatus: "NOT_APPLICABLE",
        fallbackStatus: "unavailable",
        adapterStatus: expect.arrayContaining([
          expect.objectContaining({
            venue: "POLYMARKET",
            legStatus: "FAILED_CLOSED",
            settlementStatus: "SETTLEMENT_PENDING",
            errorCode: "POLYMARKET_LIVE_EXECUTION_DISABLED"
          })
        ])
      });

      const record = await new ExecutionRecordRepository(pg).findById(acceptBody.execution_id!);
      const metadata = ExecutionSystemMetadataSchema.parse((record!.metadata as Record<string, unknown>).executionSystemV0);
      expect(metadata.receipt).toBeUndefined();
      expect(JSON.stringify(metadata)).not.toContain("POLYMARKET_API_SECRET");
      expect(JSON.stringify(metadata)).not.toContain("POLYMARKET_API_KEY");
      expect(JSON.stringify(metadata)).not.toContain("POLYMARKET_API_PASSPHRASE");
    } finally {
      await dryRunApp.close();
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }, 60000);

  it("SOR handoff: risk rejection returns structured 409", async () => {
    const testApp = must(app, "app");
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);

    const sessionId = randomUUID();
    const quoteId = `${RUN_PREFIX}risk-reject-quote`;

    await pg.query(
      `INSERT INTO rfq_sessions
      (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes', $9::jsonb)`,
      [
        sessionId,
        `${RUN_PREFIX}${randomUUID()}`,
        TEST_CANONICAL_MARKET_ID,
        makeUuid(),
        "buy",
        "2000000",
        "AWAITING_USER",
        `${RUN_PREFIX}${randomUUID()}`,
        JSON.stringify({ acceptance_policy: "ALL_OR_NONE" })
      ]
    );

    await pg.query(
      `INSERT INTO rfq_quotes
      (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
      VALUES ($1, $2, $3, 'RECEIVED', '1.00', '2000000', 1, NOW() + INTERVAL '5 minutes', $4::jsonb)`,
      [
        randomUUID(),
        sessionId,
        lp?.keyDbId ?? "",
        JSON.stringify({ quoteId, lpId: lp?.lpId ?? "" })
      ]
    );

    const acceptResponse = await testApp.inject({
      method: "POST",
      url: `/rfq/${sessionId}/accept`,
      payload: { quoteId },
      headers: {
        authorization: `Bearer ${testApp.jwt.sign({ userId: "test-taker-risk" })}`
      }
    });

    expect(acceptResponse.statusCode).toBe(409);
    expect(acceptResponse.json()).toMatchObject({
      code: "PLAN_REJECTED",
      reason: "risk_rejected"
    });
  }, 60000);

  it("SOR feature flag disabled: accept uses legacy path and keeps 202 plan envelope", async () => {
    const pg = must(pool, "pool");
    const redis = must(redisClient, "redisClient");
    const [lp] = await createLPKeys(pg);

    const legacyApp = await buildServer({
      logger,
      redisClient: redis,
      pgPool: pg,
      db: createDrizzleDb(pg),
      canonicalServiceBaseUrl: "http://127.0.0.1:4101",
      jwtSecret: "test-secret-at-least-thirty-two-chars",
      sorEnabled: false,
      sorCanaryShadowEnabled: false,
      sorCanaryPercent: 0,
      reliabilityWeight: 0.05,
      latencyWeight: 0.03,
      failureWeight: 0.08,
      sorAcceptAonAwait: true,
      sorAcceptNonAonBackground: true
    });

    try {
      const sessionId = randomUUID();
      const quoteId = `${RUN_PREFIX}legacy-quote-1`;

      await pg.query(
        `INSERT INTO rfq_sessions
        (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes', $9::jsonb)`,
        [
          sessionId,
          `${RUN_PREFIX}${randomUUID()}`,
          TEST_CANONICAL_MARKET_ID,
          makeUuid(),
          "buy",
          "10",
          "AWAITING_USER",
          `${RUN_PREFIX}${randomUUID()}`,
          JSON.stringify({ acceptance_policy: "ALL_OR_NONE" })
        ]
      );

      await pg.query(
        `INSERT INTO rfq_quotes
        (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
        VALUES ($1, $2, $3, 'RECEIVED', '1.05', '10', 1, NOW() + INTERVAL '5 minutes', $4::jsonb)`,
        [randomUUID(), sessionId, lp?.keyDbId ?? "", JSON.stringify({ quoteId, lpId: lp?.lpId ?? "" })]
      );

      const acceptResponse = await legacyApp.inject({
        method: "POST",
        url: `/rfq/${sessionId}/accept`,
        payload: { quoteId },
        headers: {
          authorization: `Bearer ${legacyApp.jwt.sign({ userId: "test-taker-legacy" })}`
        }
      });

      if (acceptResponse.statusCode !== 202) {
        throw new Error(`Legacy accept RFQ failed with ${acceptResponse.statusCode}: ${acceptResponse.body}`);
      }
      expect(acceptResponse.statusCode).toBe(202);
      expect(acceptResponse.json()).toMatchObject({
        status: "PLAN_ACCEPTED",
        plan_state: "LEGACY_EXECUTED"
      });

      const routingPlanCount = await pg.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM routing_plans WHERE rfq_id = $1",
        [sessionId]
      );
      expect(Number.parseInt(routingPlanCount.rows[0]?.count ?? "0", 10)).toBe(1);

      const legacyIntentCount = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM execution_intents
         WHERE route_type = 'LEGACY_EXECUTION'
           AND metadata->>'sessionId' = $1`,
        [sessionId]
      );
      expect(Number.parseInt(legacyIntentCount.rows[0]?.count ?? "0", 10)).toBe(1);
    } finally {
      await legacyApp.close();
    }
  }, 60000);

  it("Scenario 1: Happy Path", async () => {
    const testApp = must(app, "app");
    const sessions = must(sessionRepository, "sessionRepository");
    const quotes = must(quoteRepository, "quoteRepository");
    const executions = must(executionRepository, "executionRepository");
    const manager = must(sessionManager, "sessionManager");
    const pg = must(pool, "pool");
    const emitter = must(eventEmitter, "eventEmitter");
    const lpKeys = await createLPKeys(pg);

    const createResponse = await testApp.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: TEST_CANONICAL_MARKET_ID,
        takerId: makeUuid(),
        side: "buy",
        quantity: "10",
        idempotencyKey: `${RUN_PREFIX}${randomUUID()}`,
        ttlSeconds: 120
      },
      headers: {
        authorization: `Bearer ${testApp.jwt.sign({ userId: "test-taker" })}`
      }
    });
    if (createResponse.statusCode !== 201) {
      throw new Error(`Create RFQ failed with ${createResponse.statusCode}: ${createResponse.body}`);
    }

    const created = createResponse.json() as { sessionId: string };
    const sessionId = created.sessionId;
    trackSessionKeys(sessionId);

    const transitionMachine = new RFQStateMachine({ logger });
    const transitionPath: string[] = [transitionMachine.getState()];
    transitionMachine.transitionTo("BROADCAST");
    transitionPath.push(transitionMachine.getState());
    transitionMachine.transitionTo("COLLECTING_QUOTES");
    transitionPath.push(transitionMachine.getState());
    await sessions.updateStatus(sessionId, "COLLECTING_QUOTES");
    await manager.setSessionMetadata(
      sessionId,
      {
        id: sessionId,
        state: "COLLECTING_QUOTES",
        expiresAt: new Date(Date.now() + 120000).toISOString()
      },
      120
    );

    const quotePayloads = [
      { quoteId: `${RUN_PREFIX}q-1`, price: "1.20", quantity: "10", feeBps: 5 },
      { quoteId: `${RUN_PREFIX}q-2`, price: "1.10", quantity: "10", feeBps: 4 },
      { quoteId: `${RUN_PREFIX}q-3`, price: "1.30", quantity: "10", feeBps: 3 }
    ];

    for (let index = 0; index < quotePayloads.length; index += 1) {
      const lp = lpKeys[index] as LPKeyFixture;
      const payload = {
        sessionId,
        quoteId: quotePayloads[index]?.quoteId ?? "",
        price: quotePayloads[index]?.price ?? "",
        quantity: quotePayloads[index]?.quantity ?? "",
        feeBps: quotePayloads[index]?.feeBps ?? 0,
        validUntil: new Date(Date.now() + 60000).toISOString(),
        payload: { lpId: lp.lpId }
      };
      const nonce = `${RUN_PREFIX}nonce:${randomUUID()}`;
      trackNonceKey(lp.apiKey, nonce);
      trackQuoteIdempotencyKey(sessionId, payload.quoteId);
      const headers = createSignedHeaders(lp.apiKey, lp.secret, "POST", `/lp/${lp.lpId}/quotes`, payload, nonce);

      const quoteResponse = await testApp.inject({
        method: "POST",
        url: `/lp/${lp.lpId}/quotes`,
        payload,
        headers
      });
      if (quoteResponse.statusCode !== 202) {
        throw new Error(`Quote submit failed with ${quoteResponse.statusCode}: ${quoteResponse.body}`);
      }
    }

    await waitFor(async () => {
      const count = await pg.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM rfq_quotes WHERE session_id = $1",
        [sessionId]
      );
      return Number.parseInt(count.rows[0]?.count ?? "0", 10) === 3;
    });

    const dbQuotes = await quotes.listBySessionId(sessionId, 10);
    const ranked = rankQuotesByEffectiveCost(
      dbQuotes.map((quote) => {
        const base = {
          quoteId: String(quote.quote_payload.quoteId),
          basePrice: Number.parseFloat(quote.price),
          venueFee: quote.fee_bps / 10000,
          protocolFee: 0,
          gasCost: 0,
          slippageEstimate: 0,
          reliabilityScore: 100,
          latencyScore: 100,
          expires_at: quote.valid_until.toISOString(),
          soft_refresh_flag:
            typeof quote.quote_payload.soft_refresh_flag === "boolean"
              ? quote.quote_payload.soft_refresh_flag
              : false
        };

        return typeof quote.quote_payload.firm_until === "string"
          ? { ...base, firm_until: quote.quote_payload.firm_until }
          : base;
      })
    );

    const executionRouter = new ExecutionRouterService({
      sessionRepository: sessions,
      quoteRepository: quotes,
      executionRepository: executions,
      sessionManager: manager,
      executionGateway: {
        execute: async () => ({ ok: true, venueExecutionRef: `${RUN_PREFIX}exec-ref-1`, transactionHash: "0x1" })
      },
      eventEmitter: emitter,
      logger,
      riskEngine: {
        validateRFQCreation: async () => undefined,
        validateBeforeExecution: async () => "reservation-token",
        updateExposureAfterExecution: async (_exec: Record<string, unknown>, _isInternal = false) => undefined,
        reconcileExposureSnapshot: async () => undefined
      }
    });
    await sessions.updateStatus(sessionId, "ACCEPTED");

    const executionResult = await executionRouter.execute({
      sessionId,
      rankedQuotes: ranked,
      fallbackToNextQuote: true
    });
    expect(executionResult.ok).toBe(true);
    expect(executionResult.executedQuoteId).toBe(`${RUN_PREFIX}q-2`);

    transitionMachine.transitionTo("RANKING");
    transitionPath.push(transitionMachine.getState());
    transitionMachine.transitionTo("AWAITING_USER");
    transitionPath.push(transitionMachine.getState());
    transitionMachine.transitionTo("ACCEPTED");
    transitionPath.push(transitionMachine.getState());
    transitionMachine.transitionTo("EXECUTING");
    transitionPath.push(transitionMachine.getState());
    transitionMachine.transitionTo("SETTLED");
    transitionPath.push(transitionMachine.getState());
    await sessions.updateStatus(sessionId, "SETTLED");

    expect(transitionPath).toEqual([
      "CREATED",
      "BROADCAST",
      "COLLECTING_QUOTES",
      "RANKING",
      "AWAITING_USER",
      "ACCEPTED",
      "EXECUTING",
      "SETTLED"
    ]);

    const executionCount = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM rfq_executions WHERE session_id = $1",
      [sessionId]
    );
    expect(Number.parseInt(executionCount.rows[0]?.count ?? "0", 10)).toBe(1);

    const settled = await sessions.findById(sessionId);
    expect(settled?.status).toBe("SETTLED");

    const persistedEvents = await pg.query<{ event_type: string }>(
      "SELECT event_type FROM rfq_events WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId]
    );
    const eventTypes = persistedEvents.rows.map((row) => row.event_type);
    expect(eventTypes.filter((type) => type === "RFQ_CREATED").length).toBe(1);
    expect(eventTypes.filter((type) => type === "QUOTE_RECEIVED").length).toBe(3);

    // TODO: settlement-time Redis cleanup is not implemented in current service logic.
    expect(await must(redisClient, "redisClient").get(manager.metaKey(sessionId))).not.toBeNull();
    expect((await must(redisClient, "redisClient").zrevrange(manager.quotesKey(sessionId), 0, -1)).length).toBe(3);
  }, 60000);

  it("Scenario 2: Expired Session", async () => {
    const testApp = must(app, "app");
    const sessions = must(sessionRepository, "sessionRepository");
    const manager = must(sessionManager, "sessionManager");
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);

    const createResponse = await testApp.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: TEST_CANONICAL_MARKET_ID,
        takerId: makeUuid(),
        side: "buy",
        quantity: "5",
        idempotencyKey: `${RUN_PREFIX}${randomUUID()}`,
        ttlSeconds: 1
      },
      headers: {
        authorization: `Bearer ${testApp.jwt.sign({ userId: "test-taker-exp" })}`
      }
    });
    if (createResponse.statusCode !== 201) {
      throw new Error(`Create RFQ failed with ${createResponse.statusCode}: ${createResponse.body}`);
    }

    const created = createResponse.json() as { sessionId: string };
    const sessionId = created.sessionId;
    trackSessionKeys(sessionId);

    const stateMachine = new RFQStateMachine({ initialState: "CREATED", logger });
    stateMachine.transitionTo("BROADCAST");
    stateMachine.transitionTo("COLLECTING_QUOTES");
    await sessions.updateStatus(sessionId, "COLLECTING_QUOTES");
    await manager.setSessionMetadata(
      sessionId,
      {
        id: sessionId,
        state: "COLLECTING_QUOTES",
        expiresAt: new Date(Date.now() + 1000).toISOString()
      },
      1
    );

    await sleep(1500);
    stateMachine.transitionTo("EXPIRED");
    await sessions.updateStatus(sessionId, "EXPIRED");

    const payload = {
      sessionId,
      quoteId: `${RUN_PREFIX}expired-quote`,
      price: "1.10",
      quantity: "5",
      feeBps: 1,
      validUntil: new Date(Date.now() + 10000).toISOString()
    };
    const nonce = `${RUN_PREFIX}nonce:${randomUUID()}`;
    trackNonceKey(lp?.apiKey ?? "", nonce);
    const headers = createSignedHeaders(lp?.apiKey ?? "", lp?.secret ?? "", "POST", `/lp/${lp?.lpId}/quotes`, payload, nonce);

    const response = await testApp.inject({
      method: "POST",
      url: `/lp/${lp?.lpId}/quotes`,
      payload,
      headers
    });

    expect(response.statusCode).toBe(409);
    expect((await sessions.findById(sessionId))?.status).toBe("EXPIRED");

    const quoteCount = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM rfq_quotes WHERE session_id = $1",
      [sessionId]
    );
    expect(Number.parseInt(quoteCount.rows[0]?.count ?? "0", 10)).toBe(0);
  }, 60000);

  it("Scenario 3: Concurrent Accept", async () => {
    const sessions = must(sessionRepository, "sessionRepository");
    const quotes = must(quoteRepository, "quoteRepository");
    const executions = must(executionRepository, "executionRepository");
    const manager = must(sessionManager, "sessionManager");
    const pg = must(pool, "pool");
    const emitter = must(eventEmitter, "eventEmitter");

    const lpKeys = await createLPKeys(pg);
    const sessionId = randomUUID();
    trackSessionKeys(sessionId);
    await pg.query(
      `INSERT INTO rfq_sessions
      (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '5 minutes', '{}'::jsonb)`,
      [
        sessionId,
        `${RUN_PREFIX}${randomUUID()}`,
        TEST_CANONICAL_MARKET_ID,
        makeUuid(),
        "buy",
        "10",
        "ACCEPTED",
        `${RUN_PREFIX}${randomUUID()}`
      ]
    );

    const externalQuoteId = `${RUN_PREFIX}cq-1`;
    await pg.query(
      `INSERT INTO rfq_quotes
      (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '5 minutes', $8::jsonb)`,
      [
        randomUUID(),
        sessionId,
        lpKeys[0]?.keyDbId ?? "",
        "RECEIVED",
        "1.15",
        "10",
        1,
        JSON.stringify({ quoteId: externalQuoteId })
      ]
    );
    const rankedQuote = rankQuotesByEffectiveCost([
      {
        quoteId: externalQuoteId,
        basePrice: 1.15,
        venueFee: 0,
        protocolFee: 0,
        gasCost: 0,
        slippageEstimate: 0,
        reliabilityScore: 100,
        latencyScore: 100,
        expires_at: new Date(Date.now() + 300000).toISOString(),
        firm_until: new Date(Date.now() + 240000).toISOString(),
        soft_refresh_flag: false
      }
    ])[0] as RankedQuote;

    const executionRouter = new ExecutionRouterService({
      sessionRepository: sessions,
      quoteRepository: quotes,
      executionRepository: executions,
      sessionManager: manager,
      executionGateway: {
        execute: async () => {
          await sleep(3000);
          return { ok: true, venueExecutionRef: `${RUN_PREFIX}exec-concurrent` } as const;
        }
      },
      eventEmitter: emitter,
      logger,
      riskEngine: {
        validateRFQCreation: async () => undefined,
        validateBeforeExecution: async () => "reservation-token",
        updateExposureAfterExecution: async (_exec: any, _isInternal = false) => undefined,
        reconcileExposureSnapshot: async () => undefined
      }
    });

    let releaseStart = (): void => undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    const attemptsPromise = Promise.allSettled(
      Array.from({ length: 5 }, async () => {
        await startGate;
        return executionRouter.execute({
          sessionId,
          rankedQuotes: [rankedQuote],
          fallbackToNextQuote: false
        });
      })
    );
    releaseStart();
    const attempts = await attemptsPromise;

    const successCount = attempts.filter(
      (attempt) => attempt.status === "fulfilled" && attempt.value.ok
    ).length;
    const rejectedCount = attempts.filter((attempt) => attempt.status === "rejected").length;
    expect(successCount).toBe(1);
    expect(rejectedCount).toBe(4);

    const executionCount = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM rfq_executions WHERE session_id = $1",
      [sessionId]
    );
    expect(Number.parseInt(executionCount.rows[0]?.count ?? "0", 10)).toBe(1);
  }, 60000);

  it("Scenario 4: Duplicate Quote ID", async () => {
    const testApp = must(app, "app");
    const sessions = must(sessionRepository, "sessionRepository");
    const manager = must(sessionManager, "sessionManager");
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);

    const createResponse = await testApp.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: TEST_CANONICAL_MARKET_ID,
        takerId: makeUuid(),
        side: "buy",
        quantity: "4",
        idempotencyKey: `${RUN_PREFIX}${randomUUID()}`,
        ttlSeconds: 120
      },
      headers: {
        authorization: `Bearer ${testApp.jwt.sign({ userId: "test-taker-dup" })}`
      }
    });
    if (createResponse.statusCode !== 201) {
      throw new Error(`Create RFQ failed with ${createResponse.statusCode}: ${createResponse.body}`);
    }
    const created = createResponse.json() as { sessionId: string };
    const sessionId = created.sessionId;
    trackSessionKeys(sessionId);
    await sessions.updateStatus(sessionId, "COLLECTING_QUOTES");
    await manager.setSessionMetadata(
      sessionId,
      {
        id: sessionId,
        state: "COLLECTING_QUOTES",
        expiresAt: new Date(Date.now() + 120000).toISOString()
      },
      120
    );

    const quoteId = `${RUN_PREFIX}dup-quote-1`;
    trackQuoteIdempotencyKey(sessionId, quoteId);
    const payload = {
      sessionId,
      quoteId,
      price: "1.11",
      quantity: "4",
      feeBps: 1,
      validUntil: new Date(Date.now() + 60000).toISOString()
    };

    const firstNonce = `${RUN_PREFIX}nonce:${randomUUID()}`;
    const secondNonce = `${RUN_PREFIX}nonce:${randomUUID()}`;
    trackNonceKey(lp?.apiKey ?? "", firstNonce);
    trackNonceKey(lp?.apiKey ?? "", secondNonce);

    const first = await testApp.inject({
      method: "POST",
      url: `/lp/${lp?.lpId}/quotes`,
      payload,
      headers: createSignedHeaders(
        lp?.apiKey ?? "",
        lp?.secret ?? "",
        "POST",
        `/lp/${lp?.lpId}/quotes`,
        payload,
        firstNonce
      )
    });
    if (first.statusCode !== 202) {
      throw new Error(`First duplicate-quote submission failed with ${first.statusCode}: ${first.body}`);
    }

    const second = await testApp.inject({
      method: "POST",
      url: `/lp/${lp?.lpId}/quotes`,
      payload,
      headers: createSignedHeaders(
        lp?.apiKey ?? "",
        lp?.secret ?? "",
        "POST",
        `/lp/${lp?.lpId}/quotes`,
        payload,
        secondNonce
      )
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);

    const quoteCount = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rfq_quotes
       WHERE session_id = $1 AND quote_payload->>'quoteId' = $2`,
      [sessionId, quoteId]
    );
    expect(Number.parseInt(quoteCount.rows[0]?.count ?? "0", 10)).toBe(1);

    const eventCount = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rfq_events
       WHERE session_id = $1 AND event_type = 'QUOTE_RECEIVED'`,
      [sessionId]
    );
    expect(Number.parseInt(eventCount.rows[0]?.count ?? "0", 10)).toBe(1);
  }, 60000);
});
