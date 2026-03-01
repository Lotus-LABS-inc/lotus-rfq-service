import { createHmac, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/api/server.js";
import { ExecutionRouterService } from "../../src/core/execution-router/execution-router.js";
import { InMemoryRFQEventEmitter } from "../../src/core/rfq-engine/rfq-domain-events.js";
import { RFQStateMachine } from "../../src/core/rfq-engine/rfq-state-machine.js";
import { rankQuotesByEffectiveCost, type RankedQuote } from "../../src/core/ranking/quote-ranking.js";
import { createDrizzleDb } from "../../src/db/postgres.js";
import { createRedisClient, connectRedis, disconnectRedis } from "../../src/db/redis.js";
import { RFQExecutionRepository } from "../../src/db/repositories/rfq-execution-repository.js";
import { RFQQuoteRepository } from "../../src/db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../../src/db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "../../src/core/rfq-engine/rfq-session-manager.js";
import { Pool } from "pg";
import pino from "pino";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const TEST_CANONICAL_MARKET_ID = "a0eb58b9-a89c-48a7-bda8-b08a050ad95e";
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);

const logger = pino({ level: "silent" });
const RUN_PREFIX = `it:${Date.now()}:${randomUUID()}:`;

interface LPKeyFixture {
  lpId: string;
  apiKey: string;
  secret: string;
  keyDbId: string;
}

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

const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationsDir = path.resolve(process.cwd(), "infra", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
  }
};

const clearPersistentState = async (pool: Pool): Promise<void> => {
  await pool.query(
    `TRUNCATE TABLE
      rfq_executions,
      rfq_events,
      rfq_quotes,
      rfq_sessions,
      lp_keys
    RESTART IDENTITY CASCADE`
  );
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
  let redisClient: ReturnType<typeof createRedisClient> | undefined;
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

  beforeAll(async () => {
    canonicalService = Fastify({ logger: false });
    canonicalService.get("/markets/:id", async (request) => {
      const params = request.params as { id: string };
      return {
        id: params.id,
        isActive: true
      };
    });
    await canonicalService.listen({ host: "127.0.0.1", port: 4101 });

    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
    await clearPersistentState(pool);

    redisClient = createRedisClient({
      redisUrl: TEST_REDIS_URL as string,
      logger
    });
    await connectRedis(redisClient);

    const jwtSecret = "test-secret-at-least-thirty-two-chars";
    app = await buildServer({
      logger,
      redisClient,
      pgPool: pool,
      db: createDrizzleDb(pool),
      canonicalServiceBaseUrl: "http://127.0.0.1:4101",
      jwtSecret
    });

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
        await disconnectRedis(redisClient);
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
        takerId: `${RUN_PREFIX}taker-1`,
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
      dbQuotes.map((quote) => ({
        quoteId: String(quote.quote_payload.quoteId),
        basePrice: Number.parseFloat(quote.price),
        venueFee: quote.fee_bps / 10000,
        protocolFee: 0,
        gasCost: 0,
        slippageEstimate: 0,
        reliabilityScore: 100,
        latencyScore: 100,
        expires_at: quote.valid_until.toISOString(),
        firm_until:
          typeof quote.quote_payload.firm_until === "string"
            ? quote.quote_payload.firm_until
            : undefined,
        soft_refresh_flag:
          typeof quote.quote_payload.soft_refresh_flag === "boolean"
            ? quote.quote_payload.soft_refresh_flag
            : false
      }))
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
      logger
    });

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
        takerId: `${RUN_PREFIX}taker-exp`,
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
        `${RUN_PREFIX}taker-cc`,
        "buy",
        "10",
        "COLLECTING_QUOTES",
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
      logger
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
    const pg = must(pool, "pool");
    const [lp] = await createLPKeys(pg);

    const createResponse = await testApp.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: TEST_CANONICAL_MARKET_ID,
        takerId: `${RUN_PREFIX}taker-dup`,
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
