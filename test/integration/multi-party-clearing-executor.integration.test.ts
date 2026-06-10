import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import pino from "pino";

import { connectRedis, createRedisClient, disconnectRedis, type RedisClient } from "../../src/db/redis.js";
import { ResourceLocker, ResourceLockError } from "../../src/core/combo-engine/resource-locker.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiPartyExposureAggregator } from "../../src/core/combo-engine/multi-party-exposure-aggregator.js";
import { MultiPartyClearingExecutor } from "../../src/core/combo-engine/multi-party-clearing-executor.js";
import type {
  ClearingMatchSignature,
  ClearingRoundPlan,
  ResidualVector,
  ResidualVectorEntity
} from "../../src/core/combo-engine/types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const hasRequiredTables = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[
      "combo_rfqs",
      "combo_legs",
      "clearing_rounds",
      "clearing_round_participants",
      "clearing_round_leg_matches",
      "clearing_round_events",
      "exposure",
      "exposure_journal",
      "exposure_idempotency"
    ]]
  );

  return result.rows.length === 9;
};

const applyMigrations = async (pool: Pool): Promise<void> => {
  if (await hasRequiredTables(pool)) {
    return;
  }

  const migrationDirs = [
    path.resolve(process.cwd(), "sql", "migrations")
  ];

  for (const migrationsDir of migrationDirs) {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      let attempts = 0;
      while (attempts < 3) {
        try {
          await pool.query(sql);
          break;
        } catch (error) {
          const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
          const message = error instanceof Error ? error.message : "";
          if (code === "42P07" || code === "42710" || code === "42701" || code === "42P06" || code === "42723") {
            break;
          }
          attempts += 1;
          if (!message.includes("ECONNRESET") || attempts >= 3) {
            throw error;
          }
          await sleep(250 * attempts);
        }
      }
    }
  }
};

interface InsertComboInput {
  comboId: string;
  userId: string;
  createdAt: string;
  state?: string;
  metadataTag: string;
  leg: {
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    size: string;
    remainingSize: string;
    priceHint: string;
    metadata: Record<string, unknown>;
  };
}

interface ComboSnapshot {
  comboId: string;
  userId: string;
  state: string;
  createdAt: string;
  remainingByLegId: Record<string, string>;
}

interface Stack {
  residualVectorBuilder: ResidualVectorBuilder;
  registry: Phase2BCandidateRegistry;
  planner: ClearingRoundPlanner;
  executor: MultiPartyClearingExecutor;
}

describe.skipIf(!ENV_READY)("multi-party clearing executor integration", () => {
  let pool: Pool | undefined;
  let redis: RedisClient | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));

    redis = createRedisClient({
      redisUrl: TEST_REDIS_URL as string,
      logger
    });
    await connectRedis(must(redis, "redis"));
  }, 180000);

  afterAll(async () => {
    if (redis) {
      try {
        await disconnectRedis(redis);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("Connection is closed")) {
          throw error;
        }
      }
    }
    if (pool) {
      await pool.end();
    }
  }, 180000);

  const insertCombo = async (db: Pool, input: InsertComboInput): Promise<void> => {
    await db.query(
      `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata, created_at)
       VALUES ($1, $2, 'ALL_OR_NONE', $3, NOW() + INTERVAL '1 hour', $4::jsonb, $5)`,
      [
        input.comboId,
        input.userId,
        input.state ?? "OPEN",
        JSON.stringify({ test_suite: "multi-party-clearing-executor", tag: input.metadataTag }),
        input.createdAt
      ]
    );

    await db.query(
      `INSERT INTO combo_legs
        (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        input.leg.legId,
        input.comboId,
        input.leg.marketId,
        input.leg.outcomeId,
        input.leg.side,
        input.leg.size,
        input.leg.remainingSize,
        input.leg.priceHint,
        JSON.stringify(input.leg.metadata)
      ]
    );
  };

  const loadResidualEntity = async (db: Pool, comboId: string): Promise<ResidualVectorEntity> => {
    const comboResult = await db.query<{ id: string; user_id: string }>(
      `SELECT id, user_id
         FROM combo_rfqs
        WHERE id = $1
        LIMIT 1`,
      [comboId]
    );
    const combo = comboResult.rows[0];
    if (!combo) {
      throw new Error(`missing_combo:${comboId}`);
    }

    const legResult = await db.query<{
      id: string;
      canonical_market_id: string;
      canonical_outcome_id: string;
      side: "buy" | "sell";
      remaining_size: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id,
              canonical_market_id::text,
              canonical_outcome_id::text,
              side,
              remaining_size::text,
              metadata
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC`,
      [comboId]
    );

    return {
      entityId: combo.id,
      userId: combo.user_id,
      legs: legResult.rows.map((row) => ({
        id: row.id,
        canonicalMarketId: row.canonical_market_id,
        canonicalOutcomeId: row.canonical_outcome_id,
        side: row.side,
        remainingSize: row.remaining_size,
        metadata: row.metadata
      }))
    };
  };

  const loadComboSnapshot = async (db: Pool, comboId: string): Promise<ComboSnapshot> => {
    const comboResult = await db.query<{ user_id: string; state: string; created_at: Date }>(
      `SELECT user_id, state, created_at
         FROM combo_rfqs
        WHERE id = $1
        LIMIT 1`,
      [comboId]
    );

    const combo = comboResult.rows[0];
    if (!combo) {
      throw new Error(`missing_combo:${comboId}`);
    }

    const legs = await db.query<{ id: string; remaining_size: string }>(
      `SELECT id, remaining_size::text
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC`,
      [comboId]
    );

    return {
      comboId,
      userId: combo.user_id,
      state: combo.state,
      createdAt: combo.created_at.toISOString(),
      remainingByLegId: Object.fromEntries(legs.rows.map((row) => [row.id, row.remaining_size]))
    };
  };

  const registerResiduals = async (
    db: Pool,
    registry: Phase2BCandidateRegistry,
    residualVectorBuilder: ResidualVectorBuilder,
    comboIds: readonly string[]
  ): Promise<ResidualVector[]> => {
    const vectors: ResidualVector[] = [];

    for (const comboId of comboIds) {
      const vector = residualVectorBuilder.build(await loadResidualEntity(db, comboId));
      await registry.registerEntity(vector);
      vectors.push(vector);
    }

    return vectors;
  };

  const createStack = (
    db: Pool,
    redisClient: RedisClient,
    registryOverride?: Phase2BCandidateRegistry
  ): Stack => {
    const residualVectorBuilder = new ResidualVectorBuilder();
    const registry = registryOverride ?? new Phase2BCandidateRegistry(redisClient as never);
    const overlapGraphBuilder = new OverlapGraphBuilder();
    const candidateGroupEnumerator = new CandidateGroupEnumerator();
    const clearingCompressionScorer = new ClearingCompressionScorer();
    const multiPartyExposureAggregator = new MultiPartyExposureAggregator();
    const planner = new ClearingRoundPlanner(
      registry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer
    );
    const executor = new MultiPartyClearingExecutor(
      db,
      residualVectorBuilder,
      registry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer,
      multiPartyExposureAggregator,
      new ResourceLocker(redisClient, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
      logger
    );

    return {
      residualVectorBuilder,
      registry,
      planner,
      executor
    };
  };

  const buildSignatures = (
    executor: MultiPartyClearingExecutor,
    roundPlan: ClearingRoundPlan
  ): ClearingMatchSignature => (
    (executor as unknown as {
      buildMatchSignatures: (
        compatibilityBucket: string,
        selectedGroup: ClearingRoundPlan["selectedGroup"],
        score: ClearingRoundPlan["score"]
      ) => ClearingMatchSignature;
    }).buildMatchSignatures(roundPlan.compatibilityBucket, roundPlan.selectedGroup, roundPlan.score)
  );

  const deriveExposureIdempotencyKey = (executor: MultiPartyClearingExecutor, roundPlan: ClearingRoundPlan): string => {
    const signatures = buildSignatures(executor, roundPlan);
    return (executor as unknown as {
      hashToUuid: (hash: string) => string;
    }).hashToUuid(signatures.matchSignatureHash);
  };

  const countRows = async (db: Pool, sql: string, params: readonly unknown[]): Promise<number> => {
    const result = await db.query<{ count: string }>(sql, params as unknown[]);
    return Number(result.rows[0]?.count ?? "0");
  };

  const reconcileRegistryFromPostgres = async (
    db: Pool,
    registry: Phase2BCandidateRegistry,
    residualVectorBuilder: ResidualVectorBuilder,
    comboIds: readonly string[],
    compatibilityBucket: string
  ): Promise<void> => {
    for (const comboId of comboIds) {
      await registry.unregisterEntity(comboId, compatibilityBucket);
      try {
        const vector = residualVectorBuilder.build(await loadResidualEntity(db, comboId));
        await registry.registerEntity(vector);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message !== "no_residual_legs") {
          throw error;
        }
      }
    }
  };

  it("prevents duplicate clearing rounds and double exposure mutation when two workers clear the same participant set", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };

    const comboA = randomUUID();
    const comboB = randomUUID();
    const legA = randomUUID();
    const legB = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:00:00.000Z",
      metadataTag: tag,
      leg: {
        legId: legA,
        marketId,
        outcomeId,
        side: "buy",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:01:00.000Z",
      metadataTag: tag,
      leg: {
        legId: legB,
        marketId,
        outcomeId,
        side: "sell",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });

    const { residualVectorBuilder, registry, planner, executor } = createStack(db, redisClient);
    const vectors = await registerResiduals(db, registry, residualVectorBuilder, [comboA, comboB]);
    const roundPlan = await planner.plan(vectors[0]!.compatibilityBucket);
    expect(roundPlan).not.toBeNull();

    const results = await Promise.allSettled([
      executor.execute(roundPlan!),
      executor.execute(roundPlan!)
    ]);
    const signatures = buildSignatures(executor, roundPlan!);

    const roundCount = await countRows(
      db,
      `SELECT COUNT(*)::text AS count
         FROM clearing_rounds
        WHERE participant_set_hash = $1
          AND match_signature_hash = $2`,
      [signatures.participantSetHash, signatures.matchSignatureHash]
    );
    const roundIdResult = await db.query<{ id: string }>(
      `SELECT id
         FROM clearing_rounds
        WHERE participant_set_hash = $1
          AND match_signature_hash = $2
        LIMIT 1`,
      [signatures.participantSetHash, signatures.matchSignatureHash]
    );
    const roundId = roundIdResult.rows[0]?.id;

    expect(roundCount).toBe(1);
    expect(roundId).toBeDefined();
    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_round_participants WHERE clearing_round_id = $1`, [roundId])).toBe(2);
    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_round_leg_matches WHERE clearing_round_id = $1`, [roundId])).toBe(2);
    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_round_events WHERE clearing_round_id = $1`, [roundId])).toBe(1);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND reference_id = $1`,
        [roundId]
      )
    ).toBe(2);

    const remainingSizes = await db.query<{ remaining_size: string }>(
      `SELECT remaining_size::text
         FROM combo_legs
        WHERE combo_rfq_id = ANY($1::uuid[])
        ORDER BY id ASC`,
      [[comboA, comboB]]
    );
    expect(remainingSizes.rows.every((row) => Number(row.remaining_size) >= 0)).toBe(true);

    const states = await db.query<{ state: string }>(
      `SELECT state
         FROM combo_rfqs
        WHERE id = ANY($1::uuid[])
        ORDER BY id ASC`,
      [[comboA, comboB]]
    );
    expect(states.rows.every((row) => row.state === "EXECUTED")).toBe(true);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof executor.execute>>> => result.status === "fulfilled"
    );
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

    expect(fulfilled.some((result) => result.value.applied)).toBe(true);
    if (fulfilled.length === 2) {
      expect(fulfilled.some((result) => result.value.replayed)).toBe(true);
    }
    for (const rejection of rejected) {
      expect(rejection.reason).toBeInstanceOf(ResourceLockError);
    }
  }, 120000);

  it("fails closed and rolls back when a participant changes state before transaction mutation", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };

    const comboA = randomUUID();
    const comboB = randomUUID();
    const legA = randomUUID();
    const legB = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:00:00.000Z",
      metadataTag: tag,
      leg: {
        legId: legA,
        marketId,
        outcomeId,
        side: "buy",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:01:00.000Z",
      metadataTag: tag,
      leg: {
        legId: legB,
        marketId,
        outcomeId,
        side: "sell",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });

    const { residualVectorBuilder, registry, planner, executor } = createStack(db, redisClient);
    const vectors = await registerResiduals(db, registry, residualVectorBuilder, [comboA, comboB]);
    const roundPlan = await planner.plan(vectors[0]!.compatibilityBucket);
    expect(roundPlan).not.toBeNull();
    const signatures = buildSignatures(executor, roundPlan!);

    const originalExecuteTransaction = (executor as unknown as {
      executeTransaction: (...args: unknown[]) => Promise<unknown>;
    }).executeTransaction.bind(executor);
    vi.spyOn(executor as never, "executeTransaction").mockImplementation(async (...args: unknown[]) => {
      await db.query(`UPDATE combo_rfqs SET state = 'FAILED' WHERE id = $1`, [comboB]);
      return await originalExecuteTransaction(...args);
    });

    await expect(executor.execute(roundPlan!)).rejects.toThrow(/invalid_clearing_participant_state|round_plan_invalidated/);

    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_rounds
          WHERE participant_set_hash = $1
            AND match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(0);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND payload->>'participantSetHash' = $1`,
        [signatures.participantSetHash]
      )
    ).toBe(0);

    const remaining = await db.query<{ id: string; remaining_size: string }>(
      `SELECT id, remaining_size::text
         FROM combo_legs
        WHERE id = ANY($1::uuid[])
        ORDER BY id ASC`,
      [[legA, legB]]
    );
    expect(remaining.rows).toEqual(
      [
        { id: legA, remaining_size: "10" },
        { id: legB, remaining_size: "10" }
      ].sort((left, right) => left.id.localeCompare(right.id))
    );
  }, 120000);

  it("retries cleanly after a rolled-back transactional failure", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };

    const comboA = randomUUID();
    const comboB = randomUUID();
    const legA = randomUUID();
    const legB = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:00:00.000Z",
      metadataTag: tag,
      leg: {
        legId: legA,
        marketId,
        outcomeId,
        side: "buy",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:01:00.000Z",
      metadataTag: tag,
      leg: {
        legId: legB,
        marketId,
        outcomeId,
        side: "sell",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });

    const { residualVectorBuilder, registry, planner, executor } = createStack(db, redisClient);
    const vectors = await registerResiduals(db, registry, residualVectorBuilder, [comboA, comboB]);
    const roundPlan = await planner.plan(vectors[0]!.compatibilityBucket);
    expect(roundPlan).not.toBeNull();
    const signatures = buildSignatures(executor, roundPlan!);
    const exposureId = deriveExposureIdempotencyKey(executor, roundPlan!);

    const applySpy = vi.spyOn(executor as never, "applyExposureMutations").mockImplementationOnce(async () => {
      throw new Error("forced_failure");
    });

    await expect(executor.execute(roundPlan!)).rejects.toThrow("forced_failure");

    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_rounds
          WHERE participant_set_hash = $1
            AND match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(0);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_round_participants p
           JOIN clearing_rounds r ON r.id = p.clearing_round_id
          WHERE r.participant_set_hash = $1
            AND r.match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(0);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_round_leg_matches m
           JOIN clearing_rounds r ON r.id = m.clearing_round_id
          WHERE r.participant_set_hash = $1
            AND r.match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(0);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_round_events e
           JOIN clearing_rounds r ON r.id = e.clearing_round_id
          WHERE r.participant_set_hash = $1
            AND r.match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(0);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND payload->>'participantSetHash' = $1`,
        [signatures.participantSetHash]
      )
    ).toBe(0);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_idempotency
          WHERE id = $1`,
        [exposureId]
      )
    ).toBe(0);

    applySpy.mockRestore();

    const retryResult = await executor.execute(roundPlan!);
    expect(retryResult.applied).toBe(true);
    expect(retryResult.replayed).toBe(false);

    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_rounds
          WHERE participant_set_hash = $1
            AND match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(1);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND reference_id = $1`,
        [retryResult.clearingRoundId]
      )
    ).toBe(2);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_idempotency
          WHERE id = $1`,
        [exposureId]
      )
    ).toBe(1);
  }, 120000);

  it("treats duplicate clearing round execution as replay-safe no-op", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };

    const comboA = randomUUID();
    const comboB = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:00:00.000Z",
      metadataTag: tag,
      leg: {
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:01:00.000Z",
      metadataTag: tag,
      leg: {
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "sell",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }
    });

    const { residualVectorBuilder, registry, planner, executor } = createStack(db, redisClient);
    const vectors = await registerResiduals(db, registry, residualVectorBuilder, [comboA, comboB]);
    const roundPlan = await planner.plan(vectors[0]!.compatibilityBucket);
    expect(roundPlan).not.toBeNull();
    const signatures = buildSignatures(executor, roundPlan!);

    const first = await executor.execute(roundPlan!);
    const second = await executor.execute(roundPlan!);

    expect(first.applied).toBe(true);
    expect(second.replayed).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.clearingRoundId).toBe(first.clearingRoundId);

    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_rounds
          WHERE participant_set_hash = $1
            AND match_signature_hash = $2`,
        [signatures.participantSetHash, signatures.matchSignatureHash]
      )
    ).toBe(1);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND reference_id = $1`,
        [first.clearingRoundId]
      )
    ).toBe(2);

    const remaining = await db.query<{ remaining_size: string }>(
      `SELECT remaining_size::text
         FROM combo_legs
        WHERE combo_rfq_id = ANY($1::uuid[])
        ORDER BY id ASC`,
      [[comboA, comboB]]
    );
    expect(remaining.rows.every((row) => row.remaining_size === "0")).toBe(true);
  }, 120000);

  it("keeps Postgres authoritative when Redis registry refresh fails after commit and allows safe reconciliation", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };

    const comboA = randomUUID();
    const comboB = randomUUID();
    const comboC = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:00:00.000Z",
      metadataTag: tag,
      leg: {
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      }
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:05:00.000Z",
      metadataTag: tag,
      leg: {
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      }
    });
    await insertCombo(db, {
      comboId: comboC,
      userId: randomUUID(),
      createdAt: "2026-03-10T09:10:00.000Z",
      metadataTag: tag,
      leg: {
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "sell",
        size: "7",
        remainingSize: "7",
        priceHint: "0.40",
        metadata
      }
    });

    const baseRegistry = new Phase2BCandidateRegistry(redisClient as never);
    const { residualVectorBuilder, planner } = createStack(db, redisClient, baseRegistry);
    const vectors = await registerResiduals(db, baseRegistry, residualVectorBuilder, [comboA, comboB, comboC]);
    const roundPlan = await planner.plan(vectors[0]!.compatibilityBucket);
    expect(roundPlan).not.toBeNull();
    expect(new Set(roundPlan?.selectedGroup.participantIds)).toEqual(new Set([comboA, comboB, comboC]));

    const flakyRegistry = {
      registerEntity: vi.fn(async () => {
        throw new Error("redis_refresh_failed");
      }),
      unregisterEntity: vi.fn(async () => {
        throw new Error("redis_refresh_failed");
      }),
      listBucketEntities: baseRegistry.listBucketEntities.bind(baseRegistry),
      getEntitySnapshot: baseRegistry.getEntitySnapshot.bind(baseRegistry)
    };

    const executor = new MultiPartyClearingExecutor(
      db,
      residualVectorBuilder,
      flakyRegistry as never,
      new OverlapGraphBuilder(),
      new CandidateGroupEnumerator(),
      new ClearingCompressionScorer(),
      new MultiPartyExposureAggregator(),
      new ResourceLocker(redisClient, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
      logger
    );

    const result = await executor.execute(roundPlan!);
    expect(result.applied).toBe(true);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM clearing_rounds
          WHERE id = $1`,
        [result.clearingRoundId]
      )
    ).toBe(1);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND reference_id = $1`,
        [result.clearingRoundId]
      )
    ).toBe(3);

    const snapshotA = await loadComboSnapshot(db, comboA);
    const snapshotB = await loadComboSnapshot(db, comboB);
    const snapshotC = await loadComboSnapshot(db, comboC);

    expect(snapshotA.state).toBe("PARTIALLY_EXECUTED");
    expect(Object.values(snapshotA.remainingByLegId)).toEqual(["3"]);
    expect(snapshotB.state).toBe("EXECUTED");
    expect(Object.values(snapshotB.remainingByLegId)).toEqual(["0"]);
    expect(snapshotC.state).toBe("EXECUTED");
    expect(Object.values(snapshotC.remainingByLegId)).toEqual(["0"]);

    const stalePage = await baseRegistry.listBucketEntities(roundPlan!.compatibilityBucket, 10);
    expect(new Set(stalePage.entityIds)).toEqual(new Set([comboA, comboB, comboC]));

    await reconcileRegistryFromPostgres(
      db,
      baseRegistry,
      residualVectorBuilder,
      [comboA, comboB, comboC],
      roundPlan!.compatibilityBucket
    );

    const reconciledPage = await baseRegistry.listBucketEntities(roundPlan!.compatibilityBucket, 10);
    expect(reconciledPage.entityIds).toEqual([comboA]);
    expect(await baseRegistry.getEntitySnapshot(comboB)).toBeNull();
    expect(await baseRegistry.getEntitySnapshot(comboC)).toBeNull();

    const residualSnapshot = await baseRegistry.getEntitySnapshot(comboA);
    expect(residualSnapshot).not.toBeNull();
    expect(residualSnapshot?.vector).toEqual({
      [`${marketId}:${outcomeId}`]: "3"
    });
  }, 120000);
});
