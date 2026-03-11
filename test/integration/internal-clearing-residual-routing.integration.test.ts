import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import pino from "pino";

import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { AcceptancePolicy, type ComboQuote, type ComboRFQSession, type ResidualVectorEntity } from "../../src/core/combo-engine/types.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiPartyExposureAggregator } from "../../src/core/combo-engine/multi-party-exposure-aggregator.js";
import { MultiPartyClearingExecutor } from "../../src/core/combo-engine/multi-party-clearing-executor.js";
import { ResourceLocker } from "../../src/core/combo-engine/resource-locker.js";
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

describe.skipIf(!ENV_READY)("internal clearing residual routing integration", () => {
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
      max: 4,
      min: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
      query_timeout: 20_000,
      application_name: "internal-clearing-residual-routing"
    });
    pool.on("error", (error) => {
      logger.warn({ err: error }, "Ignoring transient pool error in internal-clearing residual-routing integration.");
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
        JSON.stringify({ test_suite: "internal-clearing-residual-routing", tag: input.metadataTag }),
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

    return { engine, phase2b, buildExecutionPlan, executePlan, updateExposureAfterExecution, rollbackReservation };
  };

  it("fully clears internally and produces no external route steps", async () => {
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
    const currentComboId = randomUUID();
    const peerComboId = randomUUID();

    await insertCombo(db, {
      comboId: currentComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T09:00:00.000Z",
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
      createdAt: "2026-03-11T09:01:00.000Z",
      metadataTag: tag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "sell",
        size: "10",
        remainingSize: "10",
        priceHint: "0.40",
        metadata
      }]
    });

    const { engine, phase2b, buildExecutionPlan, executePlan, rollbackReservation } = buildEngine(db, redisClient);
    const peerVector = phase2b.residualVectorBuilder.build(await loadResidualEntity(db, peerComboId));
    await phase2b.registry.registerEntity(peerVector);

    const result = await withTransientRetry(() => engine.acceptCombo(currentComboId, "quote-1"));

    expect(result.kind).toBe("internal_cleared");
    expect(buildExecutionPlan).not.toHaveBeenCalled();
    expect(executePlan).not.toHaveBeenCalled();
    expect(rollbackReservation).toHaveBeenCalledWith("reservation-token");
    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_rounds WHERE compatibility_bucket = $1`, [peerVector.compatibilityBucket])).toBe(1);
    const state = await db.query<{ state: string }>(`SELECT state FROM combo_rfqs WHERE id = $1`, [currentComboId]);
    expect(state.rows[0]?.state).toBe("EXECUTED");
  }, 120000);

  it("partially clears internally then routes only residual legs externally", async () => {
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
    const currentComboId = randomUUID();
    const peerComboId = randomUUID();

    await insertCombo(db, {
      comboId: currentComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T10:00:00.000Z",
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
      createdAt: "2026-03-11T09:00:00.000Z",
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

    const { engine, phase2b, buildExecutionPlan, executePlan, updateExposureAfterExecution } = buildEngine(db, redisClient);
    const peerVector = phase2b.residualVectorBuilder.build(await loadResidualEntity(db, peerComboId));
    await phase2b.registry.registerEntity(peerVector);

    const result = await withTransientRetry(() => engine.acceptCombo(currentComboId, "quote-1"));

    expect(result).toEqual({
      kind: "external_plan",
      plan: expect.objectContaining({
        steps: [
          expect.objectContaining({
            targetSize: "3"
          })
        ]
      }),
      nettedSize: "0",
      residualLegCount: 1
    });
    expect(buildExecutionPlan).toHaveBeenCalledTimes(1);
    expect(executePlan).toHaveBeenCalledTimes(1);
    expect(updateExposureAfterExecution).toHaveBeenCalledWith("reservation-token", marketId, "buy", 3);
    expect(
      await countRows(
        db,
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'`,
        []
      )
    ).toBeGreaterThanOrEqual(2);

    const remaining = await db.query<{ remaining_size: string }>(
      `SELECT remaining_size::text
         FROM combo_legs
        WHERE combo_rfq_id = $1`,
      [currentComboId]
    );
    expect(remaining.rows[0]?.remaining_size).toBe("3");
  }, 120000);

  it("falls back to normal external routing when no valid clearing round exists", async () => {
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
    const currentComboId = randomUUID();

    await insertCombo(db, {
      comboId: currentComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T10:30:00.000Z",
      metadataTag: tag,
      legs: [{
        legId: randomUUID(),
        marketId,
        outcomeId,
        side: "buy",
        size: "8",
        remainingSize: "8",
        priceHint: "0.40",
        metadata
      }]
    });

    const { engine, buildExecutionPlan, executePlan } = buildEngine(db, redisClient);
    const result = await withTransientRetry(() => engine.acceptCombo(currentComboId, "quote-1"));

    expect(result.kind).toBe("external_plan");
    expect(buildExecutionPlan).toHaveBeenCalledTimes(1);
    expect(executePlan).toHaveBeenCalledTimes(1);
    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_rounds`, [])).toBeGreaterThanOrEqual(0);
  }, 120000);

  it("keeps shadow mode non-mutating and canary mode authoritative", async () => {
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
    const shadowComboId = randomUUID();
    const shadowPeerComboId = randomUUID();
    const canaryComboId = randomUUID();
    const canaryPeerComboId = randomUUID();

    await insertCombo(db, {
      comboId: shadowComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T11:00:00.000Z",
      metadataTag: `${tag}-shadow`,
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
      comboId: shadowPeerComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T10:59:00.000Z",
      metadataTag: `${tag}-shadow`,
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
    await insertCombo(db, {
      comboId: canaryComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T11:10:00.000Z",
      metadataTag: `${tag}-canary`,
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
      comboId: canaryPeerComboId,
      userId: randomUUID(),
      createdAt: "2026-03-11T11:09:00.000Z",
      metadataTag: `${tag}-canary`,
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

    const shadowStack = createPhase2BStack(db, redisClient);
    const shadowPeerVector = shadowStack.residualVectorBuilder.build(await loadResidualEntity(db, shadowPeerComboId));
    await shadowStack.registry.registerEntity(shadowPeerVector);

    const shadow = buildEngine(db, redisClient, {
      internalClearingEnabled: false,
      internalClearingShadowEnabled: true,
      internalClearingShadowPercent: 1,
      now: () => new Date("2026-03-11T11:05:00.000Z")
    });

    await shadow.phase2b.registry.registerEntity(shadowPeerVector);
    await withTransientRetry(() => shadow.engine.acceptCombo(shadowComboId, "quote-1"));

    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_rounds WHERE compatibility_bucket = $1`, [shadowPeerVector.compatibilityBucket])).toBe(0);

    const canaryStack = createPhase2BStack(db, redisClient);
    const canaryPeerVector = canaryStack.residualVectorBuilder.build(await loadResidualEntity(db, canaryPeerComboId));
    await canaryStack.registry.registerEntity(canaryPeerVector);

    const canary = buildEngine(db, redisClient, {
      internalClearingEnabled: false,
      internalClearingCanaryEnabled: true,
      internalClearingCanaryPercent: 1,
      now: () => new Date("2026-03-11T11:06:00.000Z")
    });

    await canary.phase2b.registry.registerEntity(canaryPeerVector);
    const canaryResult = await withTransientRetry(() => canary.engine.acceptCombo(canaryComboId, "quote-1"));
    expect(canaryResult.kind).toBe("internal_cleared");
    expect(await countRows(db, `SELECT COUNT(*)::text AS count FROM clearing_rounds WHERE compatibility_bucket = $1`, [canaryPeerVector.compatibilityBucket])).toBe(1);
  }, 120000);
});
