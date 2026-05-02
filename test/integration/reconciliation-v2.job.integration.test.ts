import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import pino from "pino";

import { ResolutionRiskAdminService } from "../../src/api/admin/resolution-risk-admin-service.js";
import { ComboNettingCandidateRegistry } from "../../src/core/combo-engine/combo-netting-candidate-registry.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { OrderBook } from "../../src/core/internal-engine/order-book.js";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskAssessmentService } from "../../src/core/rfq-engine/resolution-risk-assessment-service.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { connectRedis, createRedisClient, disconnectRedis, type RedisClient } from "../../src/db/redis.js";
import { ReconciliationV2Job, ReconciliationV2LockConflictError } from "../../src/jobs/reconciliation-v2.job.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });
const TEST_RUN_PREFIX = `reconciliation-v2:${randomUUID()}`;
const RESOLUTION_RISK_VERSION = "resolution-risk-v1";

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isTransientInfraError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Connection terminated unexpectedly") ||
    error.message.includes("Query read timeout") ||
    error.message.includes("Connection is closed") ||
    error.message.includes("socket hang up")
  );
};

const withTransientRetry = async <T>(operation: () => Promise<T>, attempt = 0): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (attempt < 2 && isTransientInfraError(error)) {
      await sleep((attempt + 1) * 250);
      return withTransientRetry(operation, attempt + 1);
    }

    throw error;
  }
};

const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationDirs = [
    path.resolve(process.cwd(), "sql", "migrations"),
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
        const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
        if (code === "42P07" || code === "42710") {
          continue;
        }
        throw error;
      }
    }
  }
};

describe.skipIf(!ENV_READY)("reconciliation-v2 integration", () => {
  let pool: Pool | undefined;
  let redis: RedisClient | undefined;
  let orderBook: OrderBook | undefined;
  let currentTestTag = `${TEST_RUN_PREFIX}:${randomUUID()}`;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  const createResolutionRiskAdminService = () =>
    new ResolutionRiskAdminService({
      pool: must(pool, "pool"),
      redis: must(redis, "redis"),
      assessmentService: new ResolutionRiskAssessmentService({
        pool: must(pool, "pool"),
        comparator: new ResolutionPairComparator(),
        scoringEngine: new ResolutionRiskScoringEngine(),
        logger,
        config: { version: RESOLUTION_RISK_VERSION },
      }),
      logger,
      version: RESOLUTION_RISK_VERSION,
    });

  const createScopedPool = () =>
    ({
      query: async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes("FROM internal_orders") && text.includes("ORDER BY id::text ASC")) {
          return must(pool, "pool").query(
            `SELECT id::text, market_id::text, user_id::text, side, price::text, initial_size::text, remaining_size::text,
                    status, NULL::text AS resolution_profile_id, created_at, updated_at
               FROM internal_orders
              WHERE market_id LIKE $3
                AND ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [...(params ?? []), `${currentTestTag}:%`],
          );
        }
        if (text.includes("FROM trades") && text.includes("ORDER BY id::text ASC")) {
          return must(pool, "pool").query(
            `SELECT id::text, market_id::text, buy_order_id::text, sell_order_id::text
               FROM trades
              WHERE market_id LIKE $3
                AND ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [...(params ?? []), `${currentTestTag}:%`],
          );
        }
        if (text.includes("FROM routing_plans") && text.includes("ORDER BY id::text ASC")) {
          return must(pool, "pool").query(
            `SELECT id::text, rfq_id::text
               FROM routing_plans
              WHERE metadata->>'test_suite' = $3
                AND ($1::text IS NULL OR id::text > $1)
              ORDER BY id::text ASC
              LIMIT $2`,
            [...(params ?? []), currentTestTag],
          );
        }
        if (text.includes("FROM resolution_profiles") && text.includes("DISTINCT canonical_event_id::text AS canonical_event_id")) {
          return must(pool, "pool").query(
            `SELECT DISTINCT canonical_event_id::text AS canonical_event_id
               FROM resolution_profiles
              WHERE metadata->>'test_suite' = $3
                AND ($1::text IS NULL OR canonical_event_id::text > $1)
              ORDER BY canonical_event_id::text ASC
              LIMIT $2`,
            [...(params ?? []), currentTestTag],
          );
        }
        return must(pool, "pool").query(sql, params as unknown[] | undefined);
      },
    }) as Pool;

  const createScopedJob = (customOrderBook?: OrderBook | Record<string, unknown>) =>
    new ReconciliationV2Job({
      pool: createScopedPool(),
      redis: must(redis, "redis"),
      logger,
      resolutionRiskAdminService: createResolutionRiskAdminService(),
      orderBook: (customOrderBook ?? must(orderBook, "orderBook")) as never,
      comboNettingCandidateRegistry: new ComboNettingCandidateRegistry(must(redis, "redis") as never),
      phase2bCandidateRegistry: new Phase2BCandidateRegistry(must(redis, "redis") as never),
      residualVectorBuilder: new ResidualVectorBuilder(),
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await withTransientRetry(() => applyMigrations(must(pool, "pool")));
    redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger });
    try {
      await connectRedis(must(redis, "redis"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("already connecting/connected")) {
        throw error;
      }
    }

    orderBook = new OrderBook(must(redis, "redis"));
  }, 180000);

  beforeEach(async () => {
    currentTestTag = `${TEST_RUN_PREFIX}:${randomUUID()}`;
    if (redis) {
      await redis.del("phase3a:reconciliation_v2:lock");
    }
  });

  afterEach(async () => {
    const db = must(pool, "pool");
    const cache = must(redis, "redis");

    await cache.del("phase3a:reconciliation_v2:lock");

    await withTransientRetry(() => db.query(`DELETE FROM replay_envelopes WHERE correlation_id LIKE $1`, [`${currentTestTag}:%`]));
    await withTransientRetry(() => db.query(`DELETE FROM routing_plans WHERE metadata->>'test_suite' = $1`, [currentTestTag]));
    await withTransientRetry(() => db.query(`DELETE FROM trades WHERE market_id LIKE $1`, [`${currentTestTag}:%`]));
    await withTransientRetry(() => db.query(`DELETE FROM internal_orders WHERE market_id LIKE $1`, [`${currentTestTag}:%`]));
    await withTransientRetry(() =>
      db.query(
        `DELETE FROM resolution_risk_assessments
          WHERE canonical_event_id IN (
            SELECT canonical_event_id
              FROM resolution_profiles
             WHERE metadata->>'test_suite' = $1
          )`,
        [currentTestTag],
      ),
    );
    await withTransientRetry(() => db.query(`DELETE FROM resolution_profiles WHERE metadata->>'test_suite' = $1`, [currentTestTag]));

    const scanRedis = cache as RedisClient & {
      scan?: (cursor: string, option: "MATCH", pattern: string, countOption: "COUNT", count: number) => Promise<[string, string[]]>;
    };
    if (typeof scanRedis.scan === "function") {
      const patterns = [
        `book:${currentTestTag}:*`,
        `book:order:${currentTestTag}:*`,
      ];
      for (const pattern of patterns) {
        try {
          let cursor = "0";
          do {
            const [nextCursor, keys] = await scanRedis.scan(cursor, "MATCH", pattern, "COUNT", 200);
            cursor = nextCursor;
            if (keys.length > 0) {
              await cache.del(...keys);
            }
          } while (cursor !== "0");
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("Connection is closed")) {
            throw error;
          }
        }
      }
    }
  });

  afterAll(async () => {
    if (redis) {
      await disconnectRedis(redis).catch(() => undefined);
    }
    if (pool) {
      await pool.end();
    }
  }, 180000);

  it("detects and repairs missing internal-cross Redis state when Postgres row exists", async () => {
    const db = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const reconciliationJob = createScopedJob();
    const orderId = randomUUID();
    const marketId = `${currentTestTag}:${randomUUID()}`;
    const userId = randomUUID();

    await db.query(
      `INSERT INTO internal_orders
        (id, market_id, user_id, side, price, initial_size, remaining_size, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        orderId,
        marketId,
        userId,
        "buy",
        "0.55",
        "10",
        "10",
        "OPEN",
        new Date("2026-03-12T00:00:00.000Z"),
        new Date("2026-03-12T00:00:00.000Z"),
      ],
    );

    expect((await book.getOrderSnapshot(orderId)).raw).toBeNull();

    const dryRun = await reconciliationJob.run({
      batchSize: 100,
      domains: ["internal_cross"],
      dryRun: true,
      autoFix: true,
    });
    expect(dryRun.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "POSTGRES_ACTIVE_REDIS_MISSING",
          entityId: orderId,
        }),
      ]),
    );
    expect((await book.getOrderSnapshot(orderId)).raw).toBeNull();

    const fixed = await reconciliationJob.run({
      batchSize: 100,
      domains: ["internal_cross"],
      dryRun: false,
      autoFix: true,
    });
    expect(fixed.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "POSTGRES_ACTIVE_REDIS_MISSING",
          entityId: orderId,
          fixApplied: true,
        }),
      ]),
    );
    expect((await book.getOrderSnapshot(orderId)).raw).not.toBeNull();
  }, 120000);

  it("emits REPLAY_ENVELOPE_MISSING when persisted routing decision lacks replay envelope", async () => {
    const db = must(pool, "pool");
    const reconciliationJob = createScopedJob();
    const planId = randomUUID();
    const rfqId = randomUUID();

    await db.query(
      `INSERT INTO routing_plans
        (id, rfq_id, acceptance_policy, reservation_token, created_by, state, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        planId,
        rfqId,
        "FOK",
        null,
        null,
        "PLANNED",
        JSON.stringify({ test_suite: currentTestTag }),
      ],
    );

    const result = await reconciliationJob.run({
      batchSize: 100,
      domains: ["replay"],
    });

    expect(result.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "replay",
          code: "REPLAY_ENVELOPE_MISSING",
          entityId: rfqId,
          details: expect.objectContaining({ decisionType: "SOR_PLAN" }),
        }),
      ]),
    );
  }, 120000);

  it("emits stale and mixed resolution-risk discrepancies from canonical freshness inspection", async () => {
    const db = must(pool, "pool");
    const reconciliationJob = createScopedJob();
    const canonicalEventId = randomUUID();
    const profileAId = randomUUID();
    const profileBId = randomUUID();
    const olderComputedAt = new Date("2026-03-10T00:00:00.000Z");
    const newerProfileUpdatedAt = new Date("2026-03-12T00:00:00.000Z");

    await db.query(
      `INSERT INTO resolution_profiles
        (id, venue, venue_market_id, canonical_event_id, oracle_type, oracle_name, resolution_authority_type,
         primary_resolution_text, market_type, outcome_schema, metadata, created_at, updated_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13),
        ($14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25,$26)`,
      [
        profileAId,
        "venue-a",
        `market-${randomUUID()}`,
        canonicalEventId,
        "oracle",
        "oracle-a",
        "committee",
        "Resolves yes if event occurs.",
        "binary",
        JSON.stringify({ type: "binary" }),
        JSON.stringify({ test_suite: currentTestTag }),
        olderComputedAt,
        newerProfileUpdatedAt,
        profileBId,
        "venue-b",
        `market-${randomUUID()}`,
        canonicalEventId,
        "oracle",
        "oracle-b",
        "committee",
        "Resolves yes if event occurs.",
        "binary",
        JSON.stringify({ type: "binary" }),
        JSON.stringify({ test_suite: currentTestTag }),
        olderComputedAt,
        newerProfileUpdatedAt,
      ],
    );

    await db.query(
      `INSERT INTO resolution_risk_assessments
        (id, canonical_event_id, market_a_profile_id, market_b_profile_id, risk_score, confidence_score,
         equivalence_class, factor_breakdown, reasons, version, computed_at)
       VALUES
        ($1,$2,$3,$4,'0.10','0.90','SAFE_EQUIVALENT',$5::jsonb,$6::jsonb,$7,$8),
        ($9,$10,$11,$12,'0.20','0.80','CAUTION',$13::jsonb,$14::jsonb,$15,$16)`,
      [
        randomUUID(),
        canonicalEventId,
        profileAId,
        profileBId,
        JSON.stringify({ factor: "v1" }),
        JSON.stringify(["v1 reason"]),
        RESOLUTION_RISK_VERSION,
        olderComputedAt,
        randomUUID(),
        canonicalEventId,
        profileAId,
        profileBId,
        JSON.stringify({ factor: "v2" }),
        JSON.stringify(["v2 reason"]),
        "resolution-risk-v2",
        olderComputedAt,
      ],
    );

    const result = await reconciliationJob.run({
      batchSize: 100,
      domains: ["resolution_risk"],
    });

    expect(result.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RESOLUTION_RISK_STALE",
          entityId: canonicalEventId,
        }),
        expect.objectContaining({
          code: "RESOLUTION_RISK_MIXED_VERSIONS",
          entityId: canonicalEventId,
        }),
      ]),
    );
  }, 15000);

  it("allows only one concurrent reconciliation run to acquire the singleton lock", async () => {
    const db = must(pool, "pool");
    const cache = must(redis, "redis");
    const orderId = randomUUID();
    const marketId = `${currentTestTag}:${randomUUID()}`;
    const userId = randomUUID();

    await db.query(
      `INSERT INTO internal_orders
        (id, market_id, user_id, side, price, initial_size, remaining_size, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        orderId,
        marketId,
        userId,
        "buy",
        "0.55",
        "10",
        "10",
        "OPEN",
        new Date("2026-03-12T00:00:00.000Z"),
        new Date("2026-03-12T00:00:00.000Z"),
      ],
    );

    const realOrderBook = must(orderBook, "orderBook");
    const slowOrderBook = {
      getOrderSnapshot: vi.fn(async (targetOrderId: string) => {
        await sleep(250);
        return realOrderBook.getOrderSnapshot(targetOrderId);
      }),
      addOrder: vi.fn(async (order: Parameters<typeof realOrderBook.addOrder>[0]) => realOrderBook.addOrder(order)),
      removeOrder: vi.fn(async (targetOrderId: string) => realOrderBook.removeOrder(targetOrderId)),
    };

    const slowJob = createScopedJob(slowOrderBook);
    const fastJob = createScopedJob(realOrderBook);

    const slowRun = slowJob.run({
      batchSize: 1,
      domains: ["internal_cross"],
      dryRun: true,
    });
    const guardedSlowRun = slowRun.catch((error) => {
      throw error;
    });
    await sleep(50);

    await expect(
      fastJob.run({
        batchSize: 1,
        domains: ["internal_cross"],
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(ReconciliationV2LockConflictError);

    await expect(guardedSlowRun).resolves.toEqual(
      expect.objectContaining({
        discrepancies: expect.arrayContaining([
          expect.objectContaining({
            code: "POSTGRES_ACTIVE_REDIS_MISSING",
            entityId: orderId,
          }),
        ]),
      }),
    );
  }, 30000);
});
