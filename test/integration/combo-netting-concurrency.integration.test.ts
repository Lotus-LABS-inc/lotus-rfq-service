import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { pino } from "pino";

import { createRedisClient, type RedisClient } from "../../src/db/redis.js";
import { ComboNettingCompatibilityEngine } from "../../src/core/combo-engine/combo-netting-compatibility-engine.js";
import { MultiLegInternalNettingEngine } from "../../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import { ResourceLocker } from "../../src/core/combo-engine/resource-locker.js";
import type {
  MultiLegInternalNettingInput,
  MultiLegInternalNettingResult
} from "../../src/core/combo-engine/types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

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
        const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
        if (code === "42P07" || code === "42710") {
          continue;
        }
        throw error;
      }
    }
  }
};

const mkInput = (comboId: string, userId: string, legId: string, marketId: string, outcomeId: string): MultiLegInternalNettingInput => ({
  id: comboId,
  userId,
  state: "OPEN",
  legs: [
    {
      id: legId,
      canonicalMarketId: marketId,
      canonicalOutcomeId: outcomeId,
      side: "buy",
      remainingSize: "10",
      priceHint: "0.7"
    }
  ]
});

describe.skipIf(!ENV_READY)("combo netting concurrency integration", () => {
  let pool: Pool;
  let redis: RedisClient | undefined;

  beforeAll(async () => {
    if (!ENV_READY) {
      return;
    }
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
    redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger });
    await redis.connect();
  }, 180000);

  afterAll(async () => {
    if (redis) {
      await redis.quit().catch(() => undefined);
    }
    if (pool) {
      await pool.end();
    }
  }, 180000);

  beforeEach(async () => {
    if (!ENV_READY) {
      return;
    }
    const comboIds = await pool.query<{ id: string }>(
      `SELECT id
         FROM combo_rfqs
        WHERE metadata->>'test_suite' = 'combo-netting-concurrency'`
    );

    if (comboIds.rows.length > 0) {
      const ids = comboIds.rows.map((row) => row.id);
      await pool.query(`DELETE FROM combo_rfqs WHERE id = ANY($1::uuid[])`, [ids]);
    }
  });

  it("collapses concurrent same-pair attempts to one applied attempt", async () => {
    const incomingComboId = randomUUID();
    const candidateComboId = randomUUID();
    const incomingUserId = randomUUID();
    const candidateUserId = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const incomingLegId = randomUUID();
    const candidateLegId = randomUUID();

    await pool.query(
      `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata)
       VALUES
        ($1, $2, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"combo-netting-concurrency"}'::jsonb),
        ($3, $4, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"combo-netting-concurrency"}'::jsonb)`,
      [incomingComboId, incomingUserId, candidateComboId, candidateUserId]
    );
    await pool.query(
      `INSERT INTO combo_legs
        (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
       VALUES
        ($1, $2, $3, $4, 'buy', 10, 10, 0.70, '{}'::jsonb),
        ($5, $6, $3, $4, 'sell', 10, 10, 0.60, '{}'::jsonb)`,
      [incomingLegId, incomingComboId, marketId, outcomeId, candidateLegId, candidateComboId]
    );

    const candidateRegistry = {
      findCandidateCombos: vi.fn(async () => [candidateComboId]),
      registerComboCandidate: vi.fn(async (combo) => ({ comboId: combo.id, registeredKeys: [] as const })),
      unregisterComboCandidate: vi.fn(async (comboId: string) => ({ comboId, removedFromKeys: [] as const, removed: true }))
    };

    const engine = new MultiLegInternalNettingEngine(
      pool,
      candidateRegistry,
      new ComboNettingCompatibilityEngine(),
      new ResourceLocker(redis as RedisClient, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
      logger
    );

    const input = mkInput(incomingComboId, incomingUserId, incomingLegId, marketId, outcomeId);
    const results = await Promise.allSettled([engine.attemptNet(input), engine.attemptNet(input)]);

    const attempts = await pool.query<{ attempt_id: string }>(
      `SELECT attempt_id FROM combo_netting_attempts WHERE incoming_combo_id = $1 AND matched_combo_id = $2`,
      [incomingComboId, candidateComboId]
    );
    const groups = await pool.query<{ matched_size: string }>(
      `SELECT matched_size::text FROM combo_netting_groups WHERE incoming_combo_id = $1 AND matched_combo_id = $2`,
      [incomingComboId, candidateComboId]
    );
    const exposureCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM exposure_journal
        WHERE source = 'combo-internal-net'
          AND reference_id = (SELECT id FROM combo_netting_groups WHERE incoming_combo_id = $1 AND matched_combo_id = $2)`,
      [incomingComboId, candidateComboId]
    );

    expect(attempts.rows).toHaveLength(1);
    expect(groups.rows[0]?.matched_size).toBe("10");
    expect(Number(exposureCount.rows[0]?.count ?? "0")).toBe(2);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<MultiLegInternalNettingResult> => result.status === "fulfilled"
    );
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled.length + rejected.length).toBe(2);
    expect(fulfilled.some((result) => result.value.nettedSize === "10")).toBe(true);
    if (fulfilled.length === 2) {
      expect(fulfilled.some((result) => result.value.nettedSize === "0")).toBe(true);
    }
    for (const rejection of rejected) {
      expect(rejection.reason?.name).toBe("ResourceLockError");
    }
  }, 80000);

  it("retries cleanly after a rolled-back partial failure", async () => {
    const incomingComboId = randomUUID();
    const candidateComboId = randomUUID();
    const incomingUserId = randomUUID();
    const candidateUserId = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const incomingLegId = randomUUID();
    const candidateLegId = randomUUID();

    await pool.query(
      `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata)
       VALUES
        ($1, $2, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"combo-netting-concurrency"}'::jsonb),
        ($3, $4, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"combo-netting-concurrency"}'::jsonb)`,
      [incomingComboId, incomingUserId, candidateComboId, candidateUserId]
    );
    await pool.query(
      `INSERT INTO combo_legs
        (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
       VALUES
        ($1, $2, $3, $4, 'buy', 10, 10, 0.70, '{}'::jsonb),
        ($5, $6, $3, $4, 'sell', 10, 10, 0.60, '{}'::jsonb)`,
      [incomingLegId, incomingComboId, marketId, outcomeId, candidateLegId, candidateComboId]
    );

    const candidateRegistry = {
      findCandidateCombos: vi.fn(async () => [candidateComboId]),
      registerComboCandidate: vi.fn(async (combo) => ({ comboId: combo.id, registeredKeys: [] as const })),
      unregisterComboCandidate: vi.fn(async (comboId: string) => ({ comboId, removedFromKeys: [] as const, removed: true }))
    };

    const engine = new MultiLegInternalNettingEngine(
      pool,
      candidateRegistry,
      new ComboNettingCompatibilityEngine(),
      new ResourceLocker(redis as RedisClient, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
      logger
    );

    const originalApply = (engine as any).applyExposureAggregates.bind(engine);
    let shouldFail = true;
    vi.spyOn(engine as any, "applyExposureAggregates").mockImplementation(async (...args: unknown[]) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("forced_failure");
      }
      return originalApply(...args);
    });

    const input = mkInput(incomingComboId, incomingUserId, incomingLegId, marketId, outcomeId);

    await expect(engine.attemptNet(input)).rejects.toThrow("forced_failure");

    const afterFailureAttempts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM combo_netting_attempts WHERE incoming_combo_id = $1 AND matched_combo_id = $2`,
      [incomingComboId, candidateComboId]
    );
    expect(Number(afterFailureAttempts.rows[0]?.count ?? "0")).toBe(0);

    const retryResult = await engine.attemptNet(input);
    expect(retryResult.nettedSize).toBe("10");

    const finalAttempts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM combo_netting_attempts WHERE incoming_combo_id = $1 AND matched_combo_id = $2`,
      [incomingComboId, candidateComboId]
    );
    expect(Number(finalAttempts.rows[0]?.count ?? "0")).toBe(1);
  }, 80000);

  it("treats duplicate replay after success as a no-op", async () => {
    const incomingComboId = randomUUID();
    const candidateComboId = randomUUID();
    const incomingUserId = randomUUID();
    const candidateUserId = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const incomingLegId = randomUUID();
    const candidateLegId = randomUUID();

    await pool.query(
      `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata)
       VALUES
        ($1, $2, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"combo-netting-concurrency"}'::jsonb),
        ($3, $4, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', '{"test_suite":"combo-netting-concurrency"}'::jsonb)`,
      [incomingComboId, incomingUserId, candidateComboId, candidateUserId]
    );
    await pool.query(
      `INSERT INTO combo_legs
        (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
       VALUES
        ($1, $2, $3, $4, 'buy', 10, 10, 0.70, '{}'::jsonb),
        ($5, $6, $3, $4, 'sell', 10, 10, 0.60, '{}'::jsonb)`,
      [incomingLegId, incomingComboId, marketId, outcomeId, candidateLegId, candidateComboId]
    );

    const candidateRegistry = {
      findCandidateCombos: vi.fn(async () => [candidateComboId]),
      registerComboCandidate: vi.fn(async (combo) => ({ comboId: combo.id, registeredKeys: [] as const })),
      unregisterComboCandidate: vi.fn(async (comboId: string) => ({ comboId, removedFromKeys: [] as const, removed: true }))
    };

    const engine = new MultiLegInternalNettingEngine(
      pool,
      candidateRegistry,
      new ComboNettingCompatibilityEngine(),
      new ResourceLocker(redis as RedisClient, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
      logger
    );

    const input = mkInput(incomingComboId, incomingUserId, incomingLegId, marketId, outcomeId);
    const first = await engine.attemptNet(input);
    const second = await engine.attemptNet(input);

    const attempts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM combo_netting_attempts WHERE incoming_combo_id = $1 AND matched_combo_id = $2`,
      [incomingComboId, candidateComboId]
    );
    const exposureCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM exposure_journal
        WHERE source = 'combo-internal-net'
          AND reference_id = (SELECT id FROM combo_netting_groups WHERE incoming_combo_id = $1 AND matched_combo_id = $2)`,
      [incomingComboId, candidateComboId]
    );

    expect(first.nettedSize).toBe("10");
    expect(second.nettedSize).toBe("0");
    expect(Number(attempts.rows[0]?.count ?? "0")).toBe(1);
    expect(Number(exposureCount.rows[0]?.count ?? "0")).toBe(2);
  }, 80000);
});
