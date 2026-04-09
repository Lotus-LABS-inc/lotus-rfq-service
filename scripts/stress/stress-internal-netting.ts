#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import pino from "pino";
import { Pool } from "pg";

import { ComboNettingCandidateRegistry } from "../src/core/combo-engine/combo-netting-candidate-registry.js";
import { ComboNettingCompatibilityEngine } from "../src/core/combo-engine/combo-netting-compatibility-engine.js";
import { MultiLegInternalNettingEngine } from "../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import { ResourceLockError, ResourceLocker } from "../src/core/combo-engine/resource-locker.js";
import { connectRedis, createRedisClient, disconnectRedis } from "../src/db/redis.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const logger = pino({ level: process.env.LOG_LEVEL ?? "warn" });
const COMBO_PAIRS = Number(process.env.INTERNAL_NETTING_STRESS_PAIRS ?? "12");
const TASKS = Number(process.env.INTERNAL_NETTING_STRESS_TASKS ?? "36");
const CONCURRENCY = Number(process.env.INTERNAL_NETTING_STRESS_CONCURRENCY ?? "4");

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientRedisError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Connection is closed") || error.message.includes("ECONNRESET");
};

const withRedisRetry = async <T>(
  redis: ReturnType<typeof createRedisClient>,
  operation: () => Promise<T>,
  attempt = 0
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (attempt < 3 && isTransientRedisError(error)) {
      try {
        await redis.connect();
      } catch {
        // reconnect attempt is best-effort
      }
      await sleep((attempt + 1) * 100);
      return withRedisRetry(redis, operation, attempt + 1);
    }

    throw error;
  }
};

const isTransientDbError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Query read timeout") ||
    error.message.includes("canceling statement due to statement timeout") ||
    error.message.includes("Connection terminated unexpectedly")
  );
};

const ensureSchema = async (pool: Pool): Promise<void> => {
  await pool.query("SELECT 1 FROM combo_rfqs LIMIT 1");
  await pool.query("SELECT 1 FROM combo_legs LIMIT 1");
  await pool.query("SELECT 1 FROM combo_netting_groups LIMIT 1");
  await pool.query("SELECT 1 FROM combo_netting_attempts LIMIT 1");
};

const runWithConcurrency = async <T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> => {
  const results: PromiseSettledResult<T>[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(tasks.length, concurrency) }, async () => {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      try {
        results[current] = { status: "fulfilled", value: await tasks[current]!() };
      } catch (error) {
        results[current] = { status: "rejected", reason: error };
      }
    }
  });

  await Promise.all(workers);
  return results;
};

const insertCombo = async (
  pool: Pool,
  comboId: string,
  userId: string,
  marketId: string,
  outcomeId: string,
  side: "buy" | "sell",
  size: string,
  priceHint: string
): Promise<{ comboId: string; legId: string; userId: string; marketId: string; outcomeId: string; side: "buy" | "sell"; size: string; priceHint: string }> => {
  const legId = randomUUID();
  await pool.query(
    `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata)
     VALUES ($1, $2, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"stress-internal-netting"}'::jsonb)`,
    [comboId, userId]
  );
  await pool.query(
    `INSERT INTO combo_legs
      (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, '{}'::jsonb)`,
    [legId, comboId, marketId, outcomeId, side, size, priceHint]
  );

  return { comboId, legId, userId, marketId, outcomeId, side, size, priceHint };
};

const main = async (): Promise<void> => {
  if (!databaseUrl || !redisUrl) {
    throw new Error("TEST_DATABASE_URL/DATABASE_URL and TEST_REDIS_URL/REDIS_URL are required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 6,
    min: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 8_000,
    query_timeout: 8_000,
    application_name: "stress-internal-netting"
  });
  const redis = createRedisClient({ redisUrl, logger });

  await connectRedis(redis);
  await ensureSchema(pool);

  const resilientRedis = {
    get: async (key: string) => withRedisRetry(redis, () => redis.get(key)),
    set: async (...args: Parameters<typeof redis.set>) => withRedisRetry(redis, () => redis.set(...args)),
    del: async (...args: Parameters<typeof redis.del>) => withRedisRetry(redis, () => redis.del(...args)),
    sadd: async (...args: Parameters<NonNullable<typeof redis.sadd>>) =>
      withRedisRetry(redis, () => redis.sadd(...args)),
    srem: async (...args: Parameters<NonNullable<typeof redis.srem>>) =>
      withRedisRetry(redis, () => redis.srem(...args)),
    smembers: async (...args: Parameters<NonNullable<typeof redis.smembers>>) =>
      withRedisRetry(redis, () => redis.smembers(...args))
  };
  const registryWithRetry = new ComboNettingCandidateRegistry(resilientRedis as never);
  const locker = new ResourceLocker(resilientRedis as never, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 });
  const engine = new MultiLegInternalNettingEngine(
    pool,
    registryWithRetry,
    new ComboNettingCompatibilityEngine(),
    locker,
    logger
  );

  const insertedComboIds: string[] = [];
  const insertedLegIds: string[] = [];
  const incomingCombos: Array<{
    comboId: string;
    legId: string;
    userId: string;
    marketId: string;
    outcomeId: string;
    size: string;
    priceHint: string;
  }> = [];

  for (let index = 0; index < COMBO_PAIRS; index += 1) {
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const incoming = await insertCombo(
      pool,
      randomUUID(),
      randomUUID(),
      marketId,
      outcomeId,
      "buy",
      index % 3 === 0 ? "12" : "10",
      "0.70"
    );
    const candidate = await insertCombo(
      pool,
      randomUUID(),
      randomUUID(),
      marketId,
      outcomeId,
      "sell",
      index % 4 === 0 ? "6" : "10",
      "0.60"
    );

    insertedComboIds.push(incoming.comboId, candidate.comboId);
    insertedLegIds.push(incoming.legId, candidate.legId);
    incomingCombos.push(incoming);

    await registryWithRetry.registerComboCandidate({
      id: candidate.comboId,
      legs: [{ id: candidate.legId, marketId, outcomeId, side: "sell" }]
    });

    if (index % 5 === 0) {
      const incompatible = await insertCombo(
        pool,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        "sell",
        "10",
        "0.60"
      );
      insertedComboIds.push(incompatible.comboId);
      insertedLegIds.push(incompatible.legId);
      await registryWithRetry.registerComboCandidate({
        id: incompatible.comboId,
        legs: [{ id: incompatible.legId, marketId: incompatible.marketId, outcomeId: incompatible.outcomeId, side: "sell" }]
      });
    }
  }

  const tasks = Array.from({ length: TASKS }, (_, index) => async () => {
    const incoming = incomingCombos[index % incomingCombos.length]!;
    await sleep(Math.floor(Math.random() * 15));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await engine.attemptNet({
          id: incoming.comboId,
          userId: incoming.userId,
          state: "OPEN",
          legs: [
            {
              id: incoming.legId,
              canonicalMarketId: incoming.marketId,
              canonicalOutcomeId: incoming.outcomeId,
              side: "buy",
              remainingSize: incoming.size,
              priceHint: incoming.priceHint
            }
          ]
        });
      } catch (error) {
        if (attempt < 2 && isTransientDbError(error)) {
          await sleep((attempt + 1) * 150);
          continue;
        }

        throw error;
      }
    }

    throw new Error("Internal-netting stress exhausted retry loop.");
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const unexpectedRejections = results.filter(
    (result) =>
      result.status === "rejected" &&
      !(result.reason instanceof ResourceLockError) &&
      !(result.reason instanceof Error && result.reason.name === "ResourceLockError") &&
      !isTransientDbError(result.reason)
  );
  if (unexpectedRejections.length > 0) {
    throw new Error(`Unexpected stress failures: ${unexpectedRejections.length}`);
  }

  const duplicates = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM (
         SELECT incoming_combo_id, matched_combo_id, COUNT(*) AS group_count
           FROM combo_netting_groups
          WHERE incoming_combo_id = ANY($1::uuid[])
          GROUP BY incoming_combo_id, matched_combo_id
         HAVING COUNT(*) > 1
       ) duplicated_pairs`,
    [insertedComboIds]
  );
  const negativeResiduals = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM combo_legs
      WHERE id = ANY($1::uuid[])
        AND remaining_size < 0`,
    [insertedLegIds]
  );
  const invalidStates = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM combo_rfqs r
      WHERE r.id = ANY($1::uuid[])
        AND r.state = 'EXECUTED'
        AND EXISTS (
          SELECT 1
            FROM combo_legs l
           WHERE l.combo_rfq_id = r.id
             AND l.remaining_size > 0
        )`,
    [insertedComboIds]
  );
  const duplicateExposure = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM (
         SELECT payload->>'attemptId' AS attempt_id, COUNT(*) AS journal_count
           FROM exposure_journal
          WHERE source = 'combo-internal-net'
            AND payload ? 'attemptId'
          GROUP BY payload->>'attemptId'
         HAVING COUNT(*) > 2
       ) duplicate_attempts`
  );

  const sampleLockKeys = [
    ...insertedComboIds.slice(0, 10).map((comboId) => locker.comboLockId(comboId)),
    ...insertedLegIds.slice(0, 10).map((legId) => locker.comboLegLockId(legId))
  ];
  const orphanLocks = await Promise.all(sampleLockKeys.map((key) => redis.get(key)));

  logger.info(
    {
      tasks: TASKS,
      comboPairs: COMBO_PAIRS,
      duplicatePairs: Number(duplicates.rows[0]?.count ?? "0"),
      duplicateExposureAttempts: Number(duplicateExposure.rows[0]?.count ?? "0"),
      negativeResiduals: Number(negativeResiduals.rows[0]?.count ?? "0"),
      invalidStates: Number(invalidStates.rows[0]?.count ?? "0"),
      orphanLocks: orphanLocks.filter((value) => value !== null).length,
      lockRejections: results.filter((result) => result.status === "rejected").length
    },
    "Internal-netting stress summary."
  );

  if (Number(duplicates.rows[0]?.count ?? "0") > 0) {
    throw new Error("Duplicate combo_netting_groups detected under stress.");
  }
  if (Number(duplicateExposure.rows[0]?.count ?? "0") > 0) {
    throw new Error("Duplicate combo internal-net exposure mutation detected under stress.");
  }
  if (Number(negativeResiduals.rows[0]?.count ?? "0") > 0) {
    throw new Error("Negative combo leg remaining_size detected under stress.");
  }
  if (Number(invalidStates.rows[0]?.count ?? "0") > 0) {
    throw new Error("Combo state/residual mismatch detected under stress.");
  }
  if (orphanLocks.some((value) => value !== null)) {
    throw new Error("Orphan combo netting resource locks detected after stress.");
  }

  await disconnectRedis(redis);
  await pool.end();
};

main().catch((error) => {
  logger.error({ err: error }, "stress-internal-netting failed");
  process.exit(1);
});
