import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import pino from "pino";

import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiPartyExposureAggregator } from "../../src/core/combo-engine/multi-party-exposure-aggregator.js";
import { MultiPartyClearingExecutor } from "../../src/core/combo-engine/multi-party-clearing-executor.js";
import { ResourceLocker, ResourceLockError } from "../../src/core/combo-engine/resource-locker.js";
import {
  AcceptancePolicy,
  type ComboQuote,
  type ComboRFQSession,
  type ResidualVector,
  type ResidualVectorEntity
} from "../../src/core/combo-engine/types.js";
import { connectRedis, createRedisClient, disconnectRedis, type RedisClient } from "../../src/db/redis.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isTransientDbError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Connection terminated unexpectedly") ||
    error.message.includes("Query read timeout") ||
    error.message.includes("canceling statement due to statement timeout")
  );
};

const withTransientRetry = async <T>(operation: () => Promise<T>, attempt = 0): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (attempt < 2 && isTransientDbError(error)) {
      await sleep((attempt + 1) * 250);
      return withTransientRetry(operation, attempt + 1);
    }

    throw error;
  }
};

interface InsertComboInput {
  comboId: string;
  userId: string;
  createdAt: string;
  state?: string;
  metadataTag: string;
  legs: Array<{
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    size: string;
    remainingSize: string;
    priceHint: string;
    metadata: Record<string, unknown>;
  }>;
}

class DbBackedComboRepo {
  public constructor(private readonly pool: Pool) {}

  public async createSession(): Promise<void> {
    throw new Error("not_used_in_integration");
  }

  public async getSession(sessionId: string): Promise<ComboRFQSession | null> {
    const sessionResult = await this.pool.query<{
      id: string;
      user_id: string;
      acceptance_policy: AcceptancePolicy;
      state: ComboRFQSession["state"];
      expires_at: Date;
      metadata: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT id,
              user_id,
              acceptance_policy,
              state,
              expires_at,
              metadata,
              created_at
         FROM combo_rfqs
        WHERE id = $1
        LIMIT 1`,
      [sessionId]
    );
    const sessionRow = sessionResult.rows[0];
    if (!sessionRow) {
      return null;
    }

    const legsResult = await this.pool.query<{
      id: string;
      combo_rfq_id: string;
      canonical_market_id: string;
      canonical_outcome_id: string;
      side: "buy" | "sell";
      size: string;
      remaining_size: string;
      price_hint: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id,
              combo_rfq_id,
              canonical_market_id::text,
              canonical_outcome_id::text,
              side,
              size::text,
              remaining_size::text,
              price_hint::text,
              metadata
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC`,
      [sessionId]
    );

    return {
      id: sessionRow.id,
      userId: sessionRow.user_id,
      acceptancePolicy: sessionRow.acceptance_policy,
      state: sessionRow.state,
      expiresAt: sessionRow.expires_at,
      createdAt: sessionRow.created_at,
      ...(sessionRow.metadata ? { metadata: sessionRow.metadata } : {}),
      legs: legsResult.rows.map((row) => ({
        id: row.id,
        comboSessionId: row.combo_rfq_id,
        canonicalMarketId: row.canonical_market_id,
        canonicalOutcomeId: row.canonical_outcome_id,
        side: row.side,
        quantity: row.size,
        remainingSize: row.remaining_size,
        ...(row.price_hint ? { priceHint: row.price_hint } : {}),
        ...(row.metadata ? { metadata: row.metadata } : {})
      }))
    };
  }

  public async updateSessionState(sessionId: string, state: ComboRFQSession["state"]): Promise<void> {
    await this.pool.query(`UPDATE combo_rfqs SET state = $2 WHERE id = $1`, [sessionId, state]);
  }
}

describe.skipIf(!ENV_READY)("internal clearing rollout validation integration", () => {
  let pool: Pool | undefined;
  let redis: RedisClient | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name}_not_initialized`);
    }
    return value;
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: TEST_DB_URL as string,
      max: 6,
      min: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
      query_timeout: 20_000,
      application_name: "internal-clearing-rollout-validation"
    });
    pool.on("error", (error) => {
      logger.warn({ err: error }, "Ignoring transient pool error in internal-clearing rollout validation integration.");
    });
    redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger });
    await connectRedis(must(redis, "redis"));
    await must(pool, "pool").query("SELECT 1 FROM combo_rfqs LIMIT 1");
    await must(pool, "pool").query("SELECT 1 FROM clearing_rounds LIMIT 1");
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
        JSON.stringify({ test_suite: "internal-clearing-rollout-validation", tag: input.metadataTag }),
        input.createdAt
      ]
    );

    for (const leg of input.legs) {
      await db.query(
        `INSERT INTO combo_legs
          (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          leg.legId,
          input.comboId,
          leg.marketId,
          leg.outcomeId,
          leg.side,
          leg.size,
          leg.remainingSize,
          leg.priceHint,
          JSON.stringify(leg.metadata)
        ]
      );
    }
  };

  const loadResidualEntity = async (db: Pool, comboId: string): Promise<ResidualVectorEntity> => {
    const combo = await db.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM combo_rfqs WHERE id = $1 LIMIT 1`,
      [comboId]
    );
    const comboRow = combo.rows[0];
    if (!comboRow) {
      throw new Error(`missing_combo:${comboId}`);
    }

    const legs = await db.query<{
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
      entityId: comboRow.id,
      userId: comboRow.user_id,
      legs: legs.rows.map((row) => ({
        id: row.id,
        canonicalMarketId: row.canonical_market_id,
        canonicalOutcomeId: row.canonical_outcome_id,
        side: row.side,
        remainingSize: row.remaining_size,
        metadata: row.metadata
      }))
    };
  };

  const countRows = async (db: Pool, sql: string, params: readonly unknown[]): Promise<number> => {
    const result = await db.query<{ count: string }>(sql, params as unknown[]);
    return Number(result.rows[0]?.count ?? "0");
  };

  const createPhase2BStack = (db: Pool, redisClient: RedisClient) => {
    const residualVectorBuilder = new ResidualVectorBuilder();
    const registry = new Phase2BCandidateRegistry(redisClient as never);
    const overlapGraphBuilder = new OverlapGraphBuilder();
    const enumerator = new CandidateGroupEnumerator();
    const scorer = new ClearingCompressionScorer();
    const planner = new ClearingRoundPlanner(registry, overlapGraphBuilder, enumerator, scorer);
    const executor = new MultiPartyClearingExecutor(
      db,
      residualVectorBuilder,
      registry,
      overlapGraphBuilder,
      enumerator,
      scorer,
      new MultiPartyExposureAggregator(),
      new ResourceLocker(redisClient, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
      logger
    );

    return { residualVectorBuilder, registry, planner, executor };
  };

  const buildEngine = (
    db: Pool,
    redisClient: RedisClient,
    options?: {
      internalClearingEnabled?: boolean;
      internalClearingShadowEnabled?: boolean;
      internalClearingShadowPercent?: number;
      internalClearingCanaryEnabled?: boolean;
      internalClearingCanaryPercent?: number;
      now?: () => Date;
    }
  ) => {
    const comboRepo = new DbBackedComboRepo(db);
    const quote: ComboQuote = {
      id: "quote-1",
      comboSessionId: "unused",
      lpId: randomUUID(),
      isComboQuote: false,
      perLegPrices: [],
      effectiveCost: "1",
      expiresAt: new Date(Date.now() + 60_000),
      rawPayload: {},
      createdAt: new Date()
    };

    const phase2b = createPhase2BStack(db, redisClient);
    const buildExecutionPlan = vi.fn(async (combo: ComboRFQSession) => ({
      id: randomUUID(),
      comboSessionId: combo.id,
      reservationToken: "reservation-token",
      policy: combo.acceptancePolicy,
      steps: combo.legs.map((leg) => ({
        id: randomUUID(),
        legId: leg.id,
        targetSize: leg.remainingSize ?? leg.quantity,
        price: "0.4",
        lpId: "lp-1",
        connector: "TEST",
        clientOrderId: randomUUID(),
        idempotencyKey: randomUUID(),
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 0 },
        unwindStrategy: "REVERT_FILL" as const,
        metadata: {}
      })),
      totalCostBasis: "1",
      status: "DRAFT" as const
    }));

    const executePlan = vi.fn(async () => ({ status: "COMPLETED" as const }));
    const updateExposureAfterExecution = vi.fn(async () => undefined);
    const rollbackReservation = vi.fn(async () => undefined);

    const engine = new ComboEngine(
      comboRepo as never,
      {
        saveQuote: vi.fn(),
        getQuotesForSession: vi.fn(async (sessionId: string) => [{ ...quote, comboSessionId: sessionId }])
      } as never,
      { normalizeLPQuote: vi.fn() } as never,
      { buildExecutionPlan, finalizePlan: vi.fn() } as never,
      {
        attemptNet: vi.fn(async (incoming: { legs: Array<Record<string, string>> }) => ({
          nettedSize: "0",
          residualLegs: incoming.legs,
          residualRemaining: true,
          nettingGroupIds: [],
          eventsWritten: 0
        })),
        previewNet: vi.fn(async (incoming: { legs: Array<Record<string, string>> }) => ({
          nettedSize: "0",
          residualLegs: incoming.legs,
          residualRemaining: true,
          nettingGroupIds: [],
          eventsWritten: 0
        }))
      } as never,
      {
        validateRFQCreation: vi.fn(),
        validateBeforeExecution: vi.fn(async () => "reservation-token"),
        updateExposureAfterExecution,
        rollbackReservation
      } as never,
      { getMarketOutcomeProbabilities: vi.fn(async () => new Map()) } as never,
      { executePlan } as never,
      redisClient as never,
      logger,
      {
        internalNettingEnabled: true,
        internalClearingEnabled: options?.internalClearingEnabled ?? true,
        internalClearingShadowEnabled: options?.internalClearingShadowEnabled ?? false,
        internalClearingShadowPercent: options?.internalClearingShadowPercent ?? 0,
        internalClearingCanaryEnabled: options?.internalClearingCanaryEnabled ?? false,
        internalClearingCanaryPercent: options?.internalClearingCanaryPercent ?? 0,
        ...(options?.now ? { now: options.now } : {})
      },
      {
        residualVectorBuilder: phase2b.residualVectorBuilder,
        phase2bCandidateRegistry: phase2b.registry,
        clearingRoundPlanner: phase2b.planner,
        multiPartyClearingExecutor: phase2b.executor
      }
    );

    return { engine, phase2b, buildExecutionPlan, executePlan, updateExposureAfterExecution };
  };

  const registerVector = async (
    db: Pool,
    residualVectorBuilder: ResidualVectorBuilder,
    registry: Phase2BCandidateRegistry,
    comboId: string
  ): Promise<ResidualVector> => {
    const vector = residualVectorBuilder.build(await loadResidualEntity(db, comboId));
    await registry.registerEntity(vector);
    return vector;
  };

  const createPairBucket = async (
    db: Pool,
    residualVectorBuilder: ResidualVectorBuilder,
    registry: Phase2BCandidateRegistry,
    metadataTag: string,
    index: number
  ): Promise<void> => {
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${metadataTag}`,
      expiryClass: `e-${metadataTag}`,
      settlementModel: `s-${metadataTag}`,
      resolutionRuleClass: `r-${metadataTag}`
    };
    const buyComboId = randomUUID();
    const sellComboId = randomUUID();
    await insertCombo(db, {
      comboId: buyComboId,
      userId: randomUUID(),
      createdAt: `2026-03-11T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
      metadataTag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      }]
    });
    await insertCombo(db, {
      comboId: sellComboId,
      userId: randomUUID(),
      createdAt: `2026-03-11T09:${String(index % 60).padStart(2, "0")}:30.000Z`,
      metadataTag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "sell",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      }]
    });
    await registerVector(db, residualVectorBuilder, registry, buyComboId);
    await registerVector(db, residualVectorBuilder, registry, sellComboId);
  };

  const createThreePartyCycle = async (
    db: Pool,
    residualVectorBuilder: ResidualVectorBuilder,
    registry: Phase2BCandidateRegistry,
    tag: string
  ): Promise<{ bucket: string; comboIds: string[] }> => {
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };
    const marketA = randomUUID();
    const marketB = randomUUID();
    const marketC = randomUUID();
    const outcomeA = randomUUID();
    const outcomeB = randomUUID();
    const outcomeC = randomUUID();
    const comboA = randomUUID();
    const comboB = randomUUID();
    const comboC = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-11T08:00:00.000Z",
      metadataTag: tag,
      legs: [
        {
          legId: randomUUID(),
          marketId: marketA,
          outcomeId: outcomeA,
          side: "buy",
          size: "5",
          remainingSize: "5",
          priceHint: "0.40",
          metadata
        },
        {
          legId: randomUUID(),
          marketId: marketB,
          outcomeId: outcomeB,
          side: "sell",
          size: "5",
          remainingSize: "5",
          priceHint: "0.40",
          metadata
        }
      ]
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-11T08:01:00.000Z",
      metadataTag: tag,
      legs: [
        {
          legId: randomUUID(),
          marketId: marketB,
          outcomeId: outcomeB,
          side: "buy",
          size: "5",
          remainingSize: "5",
          priceHint: "0.40",
          metadata
        },
        {
          legId: randomUUID(),
          marketId: marketC,
          outcomeId: outcomeC,
          side: "sell",
          size: "5",
          remainingSize: "5",
          priceHint: "0.40",
          metadata
        }
      ]
    });
    await insertCombo(db, {
      comboId: comboC,
      userId: randomUUID(),
      createdAt: "2026-03-11T08:02:00.000Z",
      metadataTag: tag,
      legs: [
        {
          legId: randomUUID(),
          marketId: marketC,
          outcomeId: outcomeC,
          side: "buy",
          size: "5",
          remainingSize: "5",
          priceHint: "0.40",
          metadata
        },
        {
          legId: randomUUID(),
          marketId: marketA,
          outcomeId: outcomeA,
          side: "sell",
          size: "5",
          remainingSize: "5",
          priceHint: "0.40",
          metadata
        }
      ]
    });

    const vectorA = await registerVector(db, residualVectorBuilder, registry, comboA);
    await registerVector(db, residualVectorBuilder, registry, comboB);
    await registerVector(db, residualVectorBuilder, registry, comboC);

    return { bucket: vectorA.compatibilityBucket, comboIds: [comboA, comboB, comboC] };
  };

  const rebuildRegistryFromPostgres = async (
    db: Pool,
    residualVectorBuilder: ResidualVectorBuilder,
    registry: Phase2BCandidateRegistry,
    comboIds: readonly string[],
    bucketId: string
  ): Promise<void> => {
    for (const comboId of comboIds) {
      await registry.unregisterEntity(comboId, bucketId);
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

  it("remains deterministic for repeated planning over a 500-entity bucket window", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const { registry, planner } = createPhase2BStack(db, redisClient);
    const bucketId = `u-${tag}|e-${tag}|s-${tag}|r-${tag}`;
    const snapshots = Array.from({ length: 500 }, (_, index) => {
      const pairIndex = Math.floor(index / 2);
      const side = index % 2 === 0 ? "buy" : "sell";
      const entityId = randomUUID();
      return {
        entityId,
        snapshot: {
          entityId,
          userId: randomUUID(),
          compatibilityBucket: bucketId,
          vector: {
            [`planner-market-${pairIndex}:planner-outcome-${pairIndex}`]:
              side === "buy" ? "5" : "-5"
          },
          legCount: 1,
          grossAbsSize: "5",
          registeredAt: `2026-03-11T09:${String(Math.floor(index / 10) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
        }
      };
    });

    for (let index = 0; index < snapshots.length; index += 25) {
      const batch = snapshots.slice(index, index + 25);
      await Promise.all(
        batch.flatMap(({ entityId, snapshot }, offset) => {
          const registeredAtMs = Date.parse(snapshot.registeredAt) + offset;
          return [
            redisClient.set(
              `clearing:entity:${entityId}`,
              JSON.stringify(snapshot),
              "PX",
              24 * 60 * 60 * 1000
            ),
            redisClient.zadd(`clearing:bucket:${bucketId}`, registeredAtMs, entityId)
          ];
        })
      );
    }

    const planned = [
      await withTransientRetry(() => planner.plan(bucketId, { bucketWindowLimit: 100, maxParticipants: 4, maxUniqueLegs: 6 })),
      await withTransientRetry(() => planner.plan(bucketId, { bucketWindowLimit: 100, maxParticipants: 4, maxUniqueLegs: 6 })),
      await withTransientRetry(() => planner.plan(bucketId, { bucketWindowLimit: 100, maxParticipants: 4, maxUniqueLegs: 6 }))
    ];

    expect(planned.every((plan) => plan !== null)).toBe(true);
    const normalized = planned.map((plan) => JSON.stringify({
      compatibilityBucket: plan!.compatibilityBucket,
      participantIds: plan!.selectedGroup.participantIds,
      uniqueLegs: plan!.selectedGroup.uniqueLegs,
      residuals: plan!.residuals,
      participantLockOrder: plan!.participantLockOrder,
      finalScore: plan!.score.finalScore
    }));
    expect(new Set(normalized).size).toBe(1);
    expect(planned[0]?.participantLockOrder).toEqual(
      [...(planned[0]?.participantLockOrder ?? [])].sort((left, right) => left.localeCompare(right))
    );
  }, 300000);

  it("clears multiple 3-party cycles uniquely under concurrent execution", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const { residualVectorBuilder, registry, planner, executor } = createPhase2BStack(db, redisClient);

    const cycles = await Promise.all([
      createThreePartyCycle(db, residualVectorBuilder, registry, randomUUID()),
      createThreePartyCycle(db, residualVectorBuilder, registry, randomUUID()),
      createThreePartyCycle(db, residualVectorBuilder, registry, randomUUID())
    ]);

    const executions = await Promise.allSettled(
      cycles.map(async (cycle) => {
        const plan = await planner.plan(cycle.bucket, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });
        if (!plan) {
          throw new Error("missing_cycle_plan");
        }
        return executor.execute(plan);
      })
    );

    for (const execution of executions) {
      if (execution.status === "rejected") {
        if (!(execution.reason instanceof ResourceLockError)) {
          throw execution.reason;
        }
      }
    }

    const recentRoundCount = await countRows(
      db,
      `SELECT COUNT(*)::text AS count
         FROM clearing_rounds
        WHERE created_at >= NOW() - INTERVAL '15 minutes'`,
      []
    );
    expect(recentRoundCount).toBeGreaterThanOrEqual(3);

    const duplicateRounds = await countRows(
      db,
      `SELECT COUNT(*)::text AS count
         FROM (
           SELECT participant_set_hash, match_signature_hash
             FROM clearing_rounds
            WHERE created_at >= NOW() - INTERVAL '15 minutes'
            GROUP BY participant_set_hash, match_signature_hash
           HAVING COUNT(*) > 1
         ) duplicate_rounds`,
      []
    );
    expect(duplicateRounds).toBe(0);

    const duplicateExposure = await countRows(
      db,
      `SELECT COUNT(*)::text AS count
         FROM (
           SELECT reference_id, COUNT(*) AS journal_count
             FROM exposure_journal
            WHERE source = 'combo-multi-party-clearing'
              AND created_at >= NOW() - INTERVAL '15 minutes'
            GROUP BY reference_id
           HAVING COUNT(*) > 6
         ) duplicate_exposure`,
      []
    );
    expect(duplicateExposure).toBe(0);
  }, 180000);

  it("routes only residual legs externally under concurrent partial-clearing load", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");

    const currentCombos: string[] = [];
    const peers: string[] = [];

    for (let index = 0; index < 8; index += 1) {
      const tag = randomUUID();
      const marketId = randomUUID();
      const outcomeId = randomUUID();
      const metadata = {
        resolutionUniverse: `u-${tag}`,
        expiryClass: `e-${tag}`,
        settlementModel: `s-${tag}`,
        resolutionRuleClass: `r-${tag}`
      };
      const currentComboId = randomUUID();
      const peerComboId = randomUUID();
      currentCombos.push(currentComboId);
      peers.push(peerComboId);

      await insertCombo(db, {
        comboId: currentComboId,
        userId: randomUUID(),
        createdAt: `2026-03-11T10:${String(index).padStart(2, "0")}:00.000Z`,
        metadataTag: tag,
        legs: [{
          legId: randomUUID(),
          marketId,
          outcomeId,
          side: "buy",
          size: "10",
          remainingSize: "10",
          priceHint: "0.40",
          metadata
        }]
      });
      await insertCombo(db, {
        comboId: peerComboId,
        userId: randomUUID(),
        createdAt: `2026-03-11T10:${String(index).padStart(2, "0")}:10.000Z`,
        metadataTag: tag,
        legs: [{
          legId: randomUUID(),
          marketId,
          outcomeId,
          side: "sell",
          size: "7",
          remainingSize: "7",
          priceHint: "0.40",
          metadata
        }]
      });
    }

    const engineBundle = buildEngine(db, redisClient, { internalClearingEnabled: true });
    for (const peer of peers) {
      const vector = engineBundle.phase2b.residualVectorBuilder.build(await loadResidualEntity(db, peer));
      await engineBundle.phase2b.registry.registerEntity(vector);
    }

    const results = await Promise.all(
      currentCombos.map((comboId) => withTransientRetry(() => engineBundle.engine.acceptCombo(comboId, "quote-1")))
    );

    expect(results.every((result) => result.kind === "external_plan")).toBe(true);
    for (const result of results) {
      if (result.kind === "external_plan") {
        expect(result.plan.steps).toHaveLength(1);
        expect(result.plan.steps[0]?.targetSize).toBe("3");
      }
    }

    const routedAmounts = engineBundle.updateExposureAfterExecution.mock.calls.map(
      (call) => Number((call as unknown as [unknown, unknown, unknown, number])[3])
    );
    expect(routedAmounts).toHaveLength(currentCombos.length);
    expect(routedAmounts.every((amount) => amount === 3)).toBe(true);

    const duplicateClearingExposure = await countRows(
      db,
      `SELECT COUNT(*)::text AS count
         FROM (
           SELECT ej.reference_id, ej.exposure_id
             FROM exposure_journal ej
            WHERE ej.source = 'combo-multi-party-clearing'
              AND EXISTS (
                SELECT 1
                  FROM clearing_round_participants crp
                 WHERE crp.clearing_round_id = ej.reference_id::uuid
                   AND crp.combo_or_order_id = ANY($1::uuid[])
              )
            GROUP BY ej.reference_id, ej.exposure_id
           HAVING COUNT(*) > 1
         ) duplicate_clearing_exposure`,
      [[...currentCombos, ...peers]]
    );
    expect(duplicateClearingExposure).toBe(0);
  }, 180000);

  it("rebuilds Redis bucket state from Postgres truth after drift", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const tag = randomUUID();
    const metadata = {
      resolutionUniverse: `u-${tag}`,
      expiryClass: `e-${tag}`,
      settlementModel: `s-${tag}`,
      resolutionRuleClass: `r-${tag}`
    };
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const comboA = randomUUID();
    const comboB = randomUUID();
    const comboC = randomUUID();

    await insertCombo(db, {
      comboId: comboA,
      userId: randomUUID(),
      createdAt: "2026-03-11T12:00:00.000Z",
      metadataTag: tag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      }]
    });
    await insertCombo(db, {
      comboId: comboB,
      userId: randomUUID(),
      createdAt: "2026-03-11T12:01:00.000Z",
      metadataTag: tag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      }]
    });
    await insertCombo(db, {
      comboId: comboC,
      userId: randomUUID(),
      createdAt: "2026-03-11T12:02:00.000Z",
      metadataTag: tag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "sell",
        size: "7",
        remainingSize: "7",
        priceHint: "0.40",
        metadata
      }]
    });

    const { residualVectorBuilder, registry, planner, executor } = createPhase2BStack(db, redisClient);
    const vectorA = await registerVector(db, residualVectorBuilder, registry, comboA);
    await registerVector(db, residualVectorBuilder, registry, comboB);
    await registerVector(db, residualVectorBuilder, registry, comboC);

    const roundPlan = await planner.plan(vectorA.compatibilityBucket);
    expect(roundPlan).not.toBeNull();
    await executor.execute(roundPlan!);

    await registry.unregisterEntity(comboA, vectorA.compatibilityBucket);
    await registry.unregisterEntity(comboB, vectorA.compatibilityBucket);
    await registry.unregisterEntity(comboC, vectorA.compatibilityBucket);
    await registry.registerEntity({
      entityId: comboB,
      userId: randomUUID(),
      compatibilityBucket: vectorA.compatibilityBucket,
      vector: { [`${marketId}:${outcomeId}`]: "999" },
      legCount: 1,
      grossAbsSize: "999"
    });

    const stalePage = await registry.listBucketEntities(vectorA.compatibilityBucket, 10);
    expect(stalePage.entityIds.length).toBeGreaterThan(0);

    await rebuildRegistryFromPostgres(
      db,
      residualVectorBuilder,
      registry,
      [comboA, comboB, comboC],
      vectorA.compatibilityBucket
    );

    const reconciledPage = await registry.listBucketEntities(vectorA.compatibilityBucket, 10);
    expect(reconciledPage.entityIds).toEqual([comboA]);
    const reconciledSnapshot = await registry.getEntitySnapshot(comboA);
    expect(reconciledSnapshot?.vector).toEqual({
      [`${marketId}:${outcomeId}`]: "3"
    });
    expect(await registry.getEntitySnapshot(comboB)).toBeNull();
    expect(await registry.getEntitySnapshot(comboC)).toBeNull();
  }, 180000);
});
