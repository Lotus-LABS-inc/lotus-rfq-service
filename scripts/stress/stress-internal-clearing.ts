#!/usr/bin/env tsx
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import pino from "pino";
import { Pool } from "pg";

import { ComboEngine } from "../../src/core/combo-engine/combo-engine.js";
import { connectRedis, createRedisClient, disconnectRedis } from "../../src/db/redis.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiPartyExposureAggregator } from "../../src/core/combo-engine/multi-party-exposure-aggregator.js";
import { MultiPartyClearingExecutor } from "../../src/core/combo-engine/multi-party-clearing-executor.js";
import { ResourceLocker, ResourceLockError } from "../../src/core/combo-engine/resource-locker.js";
import type { ComboQuote, ComboRFQSession, ResidualVector, ResidualVectorEntity } from "../../src/core/combo-engine/types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const logger = pino({ level: process.env.LOG_LEVEL ?? "warn" });

const ENTITY_COUNT = Number(process.env.INTERNAL_CLEARING_STRESS_ENTITY_COUNT ?? "500");
const CYCLE_GROUPS = Number(process.env.INTERNAL_CLEARING_STRESS_CYCLE_GROUPS ?? "8");
const PARTIAL_GROUPS = Number(process.env.INTERNAL_CLEARING_STRESS_PARTIAL_GROUPS ?? "8");
const ROUTING_GROUPS = Number(process.env.INTERNAL_CLEARING_STRESS_ROUTING_GROUPS ?? "8");
const WORKER_CONCURRENCY = Number(process.env.INTERNAL_CLEARING_STRESS_CONCURRENCY ?? "8");
const PLANNER_WINDOW_LIMIT = Number(process.env.INTERNAL_CLEARING_STRESS_BUCKET_WINDOW_LIMIT ?? "100");
const MAX_RUNTIME_MS = Number(process.env.INTERNAL_CLEARING_STRESS_MAX_RUNTIME_MS ?? "900000");
const SEED = process.env.INTERNAL_CLEARING_STRESS_SEED ?? "phase2b-internal-clearing-stress";
const RUN_ID = process.env.INTERNAL_CLEARING_STRESS_RUN_ID ?? randomUUID();

interface InsertComboInput {
  comboId: string;
  userId: string;
  createdAt: string;
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
    throw new Error("not_used_in_stress");
  }

  public async getSession(sessionId: string): Promise<ComboRFQSession | null> {
    const sessionResult = await this.pool.query<{
      id: string;
      user_id: string;
      acceptance_policy: ComboRFQSession["acceptancePolicy"];
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
    const session = sessionResult.rows[0];
    if (!session) {
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
      id: session.id,
      userId: session.user_id,
      acceptancePolicy: session.acceptance_policy,
      state: session.state,
      expiresAt: session.expires_at,
      createdAt: session.created_at,
      ...(session.metadata ? { metadata: session.metadata } : {}),
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

const stableUuid = (namespace: string): string => {
  const digest = createHash("sha256").update(`${SEED}:${RUN_ID}:${namespace}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
};

const createdAtFor = (prefix: string, index: number): string =>
  `2026-03-11T${prefix}:${String(index % 60).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}.000Z`;

const ensureSchema = async (pool: Pool): Promise<void> => {
  await pool.query("SELECT 1 FROM combo_rfqs LIMIT 1");
  await pool.query("SELECT 1 FROM combo_legs LIMIT 1");
  await pool.query("SELECT 1 FROM clearing_rounds LIMIT 1");
  await pool.query("SELECT 1 FROM exposure_journal LIMIT 1");
};

const insertCombo = async (pool: Pool, input: InsertComboInput): Promise<void> => {
  await pool.query(
    `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata, created_at)
     VALUES ($1, $2, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', $3::jsonb, $4)`,
    [
      input.comboId,
      input.userId,
      JSON.stringify({ test_suite: "stress-internal-clearing", tag: input.metadataTag }),
      input.createdAt
    ]
  );
  for (const leg of input.legs) {
    await pool.query(
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

const loadResidualEntity = async (pool: Pool, comboId: string): Promise<ResidualVectorEntity> => {
  const combo = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM combo_rfqs WHERE id = $1 LIMIT 1`,
    [comboId]
  );
  const comboRow = combo.rows[0];
  if (!comboRow) {
    throw new Error(`missing_combo:${comboId}`);
  }

  const legs = await pool.query<{
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

const countRows = async (pool: Pool, sql: string, params: readonly unknown[]): Promise<number> => {
  const result = await pool.query<{ count: string }>(sql, params as unknown[]);
  return Number(result.rows[0]?.count ?? "0");
};

const reconcileRegistryFromPostgres = async (
  pool: Pool,
  registry: Phase2BCandidateRegistry,
  residualVectorBuilder: ResidualVectorBuilder,
  comboIds: readonly string[],
  bucketId: string
): Promise<void> => {
  for (const comboId of comboIds) {
    await registry.unregisterEntity(comboId, bucketId);
    try {
      const vector = residualVectorBuilder.build(await loadResidualEntity(pool, comboId));
      await registry.registerEntity(vector);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message !== "no_residual_legs") {
        throw error;
      }
    }
  }
};

const createRuntimeStack = (pool: Pool, redisUrlValue: string) => {
  const redis = createRedisClient({ redisUrl: redisUrlValue, logger });
  const residualVectorBuilder = new ResidualVectorBuilder();
  const registry = new Phase2BCandidateRegistry(redis as never);
  const overlapGraphBuilder = new OverlapGraphBuilder();
  const enumerator = new CandidateGroupEnumerator();
  const scorer = new ClearingCompressionScorer();
  const planner = new ClearingRoundPlanner(registry, overlapGraphBuilder, enumerator, scorer);
  const executor = new MultiPartyClearingExecutor(
    pool,
    residualVectorBuilder,
    registry,
    overlapGraphBuilder,
    enumerator,
    scorer,
    new MultiPartyExposureAggregator(),
    new ResourceLocker(redis, { baseDelayMs: 10, maxRetries: 5, lockTtlMs: 3000 }),
    logger
  );

  return { redis, residualVectorBuilder, registry, planner, executor };
};

const buildComboEngine = (
  pool: Pool,
  redisClient: ReturnType<typeof createRedisClient>,
  phase2b: ReturnType<typeof createRuntimeStack>
) => {
  const comboRepo = new DbBackedComboRepo(pool);
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
  const buildExecutionPlanCalls: ComboRFQSession[] = [];
  const buildExecutionPlan = async (combo: ComboRFQSession) => {
    buildExecutionPlanCalls.push(combo);
    return {
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
    };
  };
  const executePlanCalls: number[] = [];
  const executePlan = async () => {
    executePlanCalls.push(1);
    return { status: "COMPLETED" as const };
  };
  const updateExposureAfterExecutionCalls: Array<[string, string, string, number]> = [];
  const updateExposureAfterExecution = async (
    token: string,
    marketId: string,
    side: string,
    amount: number
  ): Promise<void> => {
    updateExposureAfterExecutionCalls.push([token, marketId, side, amount]);
  };
  const engine = new ComboEngine(
      comboRepo as never,
      {
        saveQuote: async () => undefined,
        getQuotesForSession: async (sessionId: string) => [{ ...quote, comboSessionId: sessionId }]
      } as never,
      { normalizeLPQuote: () => quote } as never,
      { buildExecutionPlan, finalizePlan: async () => undefined } as never,
      {
        attemptNet: async (incoming: { legs: Array<Record<string, string>> }) => ({
          nettedSize: "0",
          residualLegs: incoming.legs,
          residualRemaining: true,
          nettingGroupIds: [],
          eventsWritten: 0
        }),
        previewNet: async (incoming: { legs: Array<Record<string, string>> }) => ({
          nettedSize: "0",
          residualLegs: incoming.legs,
          residualRemaining: true,
          nettingGroupIds: [],
          eventsWritten: 0
        })
      } as never,
      {
        validateRFQCreation: async () => undefined,
        validateBeforeExecution: async () => "reservation-token",
        updateExposureAfterExecution,
        rollbackReservation: async () => undefined
      } as never,
      { getMarketOutcomeProbabilities: async () => new Map() } as never,
      { executePlan } as never,
      redisClient as never,
      logger,
    { internalNettingEnabled: true, internalClearingEnabled: true },
    {
      residualVectorBuilder: phase2b.residualVectorBuilder,
      phase2bCandidateRegistry: phase2b.registry,
      clearingRoundPlanner: phase2b.planner,
      multiPartyClearingExecutor: phase2b.executor
    }
  );

  return {
    engine,
    buildExecutionPlanCalls,
    executePlanCalls,
    updateExposureAfterExecutionCalls
  };
};

const createPairResidualScenario = async (
  pool: Pool,
  registry: Phase2BCandidateRegistry,
  builder: ResidualVectorBuilder,
  index: number,
  trackedComboIds: string[],
  trackedLegIds: string[]
): Promise<void> => {
  const tag = stableUuid(`pair-scenario-${index}`);
  const marketId = stableUuid(`pair-market-${index}`);
  const outcomeId = stableUuid(`pair-outcome-${index}`);
  const metadata = {
    resolutionUniverse: `u-${tag}`,
    expiryClass: `e-${tag}`,
    settlementModel: `s-${tag}`,
    resolutionRuleClass: `r-${tag}`
  };
  const buyComboId = stableUuid(`pair-buy-combo-${index}`);
  const sellComboId = stableUuid(`pair-sell-combo-${index}`);
  const buyLegId = stableUuid(`pair-buy-leg-${index}`);
  const sellLegId = stableUuid(`pair-sell-leg-${index}`);

  trackedComboIds.push(buyComboId, sellComboId);
  trackedLegIds.push(buyLegId, sellLegId);

  await insertCombo(pool, {
    comboId: buyComboId,
    userId: stableUuid(`pair-buy-user-${index}`),
    createdAt: createdAtFor("09", index),
    metadataTag: tag,
    legs: [{
      legId: buyLegId,
      marketId,
      outcomeId,
      side: "buy",
      size: "5",
      remainingSize: "5",
      priceHint: "0.40",
      metadata
    }]
  });
  await insertCombo(pool, {
    comboId: sellComboId,
    userId: stableUuid(`pair-sell-user-${index}`),
    createdAt: createdAtFor("10", index),
    metadataTag: tag,
    legs: [{
      legId: sellLegId,
      marketId,
      outcomeId,
      side: "sell",
      size: "5",
      remainingSize: "5",
      priceHint: "0.40",
      metadata
    }]
  });

  await registry.registerEntity(builder.build(await loadResidualEntity(pool, buyComboId)));
  await registry.registerEntity(builder.build(await loadResidualEntity(pool, sellComboId)));
};

const createThreePartyCycle = async (
  pool: Pool,
  registry: Phase2BCandidateRegistry,
  builder: ResidualVectorBuilder,
  index: number,
  trackedComboIds: string[],
  trackedLegIds: string[]
): Promise<string> => {
  const tag = stableUuid(`cycle-tag-${index}`);
  const metadata = {
    resolutionUniverse: `u-${tag}`,
    expiryClass: `e-${tag}`,
    settlementModel: `s-${tag}`,
    resolutionRuleClass: `r-${tag}`
  };
  const marketA = stableUuid(`cycle-market-a-${index}`);
  const marketB = stableUuid(`cycle-market-b-${index}`);
  const marketC = stableUuid(`cycle-market-c-${index}`);
  const outcomeA = stableUuid(`cycle-outcome-a-${index}`);
  const outcomeB = stableUuid(`cycle-outcome-b-${index}`);
  const outcomeC = stableUuid(`cycle-outcome-c-${index}`);
  const comboA = stableUuid(`cycle-combo-a-${index}`);
  const comboB = stableUuid(`cycle-combo-b-${index}`);
  const comboC = stableUuid(`cycle-combo-c-${index}`);
  const legIds = [
    stableUuid(`cycle-a-leg1-${index}`),
    stableUuid(`cycle-a-leg2-${index}`),
    stableUuid(`cycle-b-leg1-${index}`),
    stableUuid(`cycle-b-leg2-${index}`),
    stableUuid(`cycle-c-leg1-${index}`),
    stableUuid(`cycle-c-leg2-${index}`)
  ];

  trackedComboIds.push(comboA, comboB, comboC);
  trackedLegIds.push(...legIds);

  await insertCombo(pool, {
    comboId: comboA,
    userId: stableUuid(`cycle-user-a-${index}`),
    createdAt: createdAtFor("11", index),
    metadataTag: tag,
    legs: [
      { legId: legIds[0]!, marketId: marketA, outcomeId: outcomeA, side: "buy", size: "5", remainingSize: "5", priceHint: "0.40", metadata },
      { legId: legIds[1]!, marketId: marketB, outcomeId: outcomeB, side: "sell", size: "5", remainingSize: "5", priceHint: "0.40", metadata }
    ]
  });
  await insertCombo(pool, {
    comboId: comboB,
    userId: stableUuid(`cycle-user-b-${index}`),
    createdAt: createdAtFor("12", index),
    metadataTag: tag,
    legs: [
      { legId: legIds[2]!, marketId: marketB, outcomeId: outcomeB, side: "buy", size: "5", remainingSize: "5", priceHint: "0.40", metadata },
      { legId: legIds[3]!, marketId: marketC, outcomeId: outcomeC, side: "sell", size: "5", remainingSize: "5", priceHint: "0.40", metadata }
    ]
  });
  await insertCombo(pool, {
    comboId: comboC,
    userId: stableUuid(`cycle-user-c-${index}`),
    createdAt: createdAtFor("13", index),
    metadataTag: tag,
    legs: [
      { legId: legIds[4]!, marketId: marketC, outcomeId: outcomeC, side: "buy", size: "5", remainingSize: "5", priceHint: "0.40", metadata },
      { legId: legIds[5]!, marketId: marketA, outcomeId: outcomeA, side: "sell", size: "5", remainingSize: "5", priceHint: "0.40", metadata }
    ]
  });

  const vectorA = builder.build(await loadResidualEntity(pool, comboA));
  await registry.registerEntity(vectorA);
  await registry.registerEntity(builder.build(await loadResidualEntity(pool, comboB)));
  await registry.registerEntity(builder.build(await loadResidualEntity(pool, comboC)));
  return vectorA.compatibilityBucket;
};

const createPartialOverlapScenario = async (
  pool: Pool,
  registry: Phase2BCandidateRegistry,
  builder: ResidualVectorBuilder,
  index: number,
  trackedComboIds: string[],
  trackedLegIds: string[]
): Promise<string> => {
  const tag = stableUuid(`partial-tag-${index}`);
  const metadata = {
    resolutionUniverse: `u-${tag}`,
    expiryClass: `e-${tag}`,
    settlementModel: `s-${tag}`,
    resolutionRuleClass: `r-${tag}`
  };
  const marketId = stableUuid(`partial-market-${index}`);
  const outcomeId = stableUuid(`partial-outcome-${index}`);
  const comboA = stableUuid(`partial-combo-a-${index}`);
  const comboB = stableUuid(`partial-combo-b-${index}`);
  const comboC = stableUuid(`partial-combo-c-${index}`);
  const legA = stableUuid(`partial-leg-a-${index}`);
  const legB = stableUuid(`partial-leg-b-${index}`);
  const legC = stableUuid(`partial-leg-c-${index}`);

  trackedComboIds.push(comboA, comboB, comboC);
  trackedLegIds.push(legA, legB, legC);

  await insertCombo(pool, {
    comboId: comboA,
    userId: stableUuid(`partial-user-a-${index}`),
    createdAt: createdAtFor("14", index),
    metadataTag: tag,
    legs: [{ legId: legA, marketId, outcomeId, side: "buy", size: "5", remainingSize: "5", priceHint: "0.40", metadata }]
  });
  await insertCombo(pool, {
    comboId: comboB,
    userId: stableUuid(`partial-user-b-${index}`),
    createdAt: createdAtFor("15", index),
    metadataTag: tag,
    legs: [{ legId: legB, marketId, outcomeId, side: "buy", size: "5", remainingSize: "5", priceHint: "0.40", metadata }]
  });
  await insertCombo(pool, {
    comboId: comboC,
    userId: stableUuid(`partial-user-c-${index}`),
    createdAt: createdAtFor("16", index),
    metadataTag: tag,
    legs: [{ legId: legC, marketId, outcomeId, side: "sell", size: "7", remainingSize: "7", priceHint: "0.40", metadata }]
  });

  const vectorA = builder.build(await loadResidualEntity(pool, comboA));
  await registry.registerEntity(vectorA);
  await registry.registerEntity(builder.build(await loadResidualEntity(pool, comboB)));
  await registry.registerEntity(builder.build(await loadResidualEntity(pool, comboC)));
  return vectorA.compatibilityBucket;
};

const createResidualRoutingScenario = async (
  pool: Pool,
  registry: Phase2BCandidateRegistry,
  builder: ResidualVectorBuilder,
  index: number,
  trackedComboIds: string[],
  trackedLegIds: string[]
): Promise<string> => {
  const tag = stableUuid(`routing-tag-${index}`);
  const metadata = {
    resolutionUniverse: `u-${tag}`,
    expiryClass: `e-${tag}`,
    settlementModel: `s-${tag}`,
    resolutionRuleClass: `r-${tag}`
  };
  const marketId = stableUuid(`routing-market-${index}`);
  const outcomeId = stableUuid(`routing-outcome-${index}`);
  const currentCombo = stableUuid(`routing-current-${index}`);
  const peerCombo = stableUuid(`routing-peer-${index}`);
  const currentLeg = stableUuid(`routing-current-leg-${index}`);
  const peerLeg = stableUuid(`routing-peer-leg-${index}`);

  trackedComboIds.push(currentCombo, peerCombo);
  trackedLegIds.push(currentLeg, peerLeg);

  await insertCombo(pool, {
    comboId: currentCombo,
    userId: stableUuid(`routing-user-current-${index}`),
    createdAt: createdAtFor("17", index),
    metadataTag: tag,
    legs: [{ legId: currentLeg, marketId, outcomeId, side: "buy", size: "10", remainingSize: "10", priceHint: "0.40", metadata }]
  });
  await insertCombo(pool, {
    comboId: peerCombo,
    userId: stableUuid(`routing-user-peer-${index}`),
    createdAt: createdAtFor("18", index),
    metadataTag: tag,
    legs: [{ legId: peerLeg, marketId, outcomeId, side: "sell", size: "7", remainingSize: "7", priceHint: "0.40", metadata }]
  });

  await registry.registerEntity(builder.build(await loadResidualEntity(pool, peerCombo)));
  return currentCombo;
};

const main = async (): Promise<void> => {
  if (!databaseUrl || !redisUrl) {
    throw new Error("TEST_DATABASE_URL/DATABASE_URL and TEST_REDIS_URL/REDIS_URL are required.");
  }

  const startedAt = Date.now();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Math.min(WORKER_CONCURRENCY + 2, 10),
    min: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 20_000,
    application_name: "stress-internal-clearing"
  });
  const phase2b = createRuntimeStack(pool, redisUrl);

  await connectRedis(phase2b.redis);
  await ensureSchema(pool);

  const trackedComboIds: string[] = [];
  const trackedLegIds: string[] = [];
  let deterministicBucket = "";
  const cycleBuckets: string[] = [];
  const partialBuckets: string[] = [];
  const routingCurrentComboIds: string[] = [];

  for (let index = 0; index < ENTITY_COUNT / 2; index += 1) {
    await createPairResidualScenario(pool, phase2b.registry, phase2b.residualVectorBuilder, index, trackedComboIds, trackedLegIds);
  }
  const firstCombo = stableUuid("pair-buy-combo-0");
  deterministicBucket = phase2b.residualVectorBuilder.build(await loadResidualEntity(pool, firstCombo)).compatibilityBucket;

  for (let index = 0; index < CYCLE_GROUPS; index += 1) {
    cycleBuckets.push(await createThreePartyCycle(pool, phase2b.registry, phase2b.residualVectorBuilder, index, trackedComboIds, trackedLegIds));
  }

  for (let index = 0; index < PARTIAL_GROUPS; index += 1) {
    partialBuckets.push(await createPartialOverlapScenario(pool, phase2b.registry, phase2b.residualVectorBuilder, index, trackedComboIds, trackedLegIds));
  }

  for (let index = 0; index < ROUTING_GROUPS; index += 1) {
    routingCurrentComboIds.push(await createResidualRoutingScenario(pool, phase2b.registry, phase2b.residualVectorBuilder, index, trackedComboIds, trackedLegIds));
  }

  const planned = await Promise.all([
    phase2b.planner.plan(deterministicBucket, { bucketWindowLimit: PLANNER_WINDOW_LIMIT, maxParticipants: 4, maxUniqueLegs: 6 }),
    phase2b.planner.plan(deterministicBucket, { bucketWindowLimit: PLANNER_WINDOW_LIMIT, maxParticipants: 4, maxUniqueLegs: 6 }),
    phase2b.planner.plan(deterministicBucket, { bucketWindowLimit: PLANNER_WINDOW_LIMIT, maxParticipants: 4, maxUniqueLegs: 6 })
  ]);
  const normalizedPlans = planned.map((plan) => JSON.stringify({
    participants: plan?.selectedGroup.participantIds ?? [],
    residuals: plan?.residuals ?? [],
    finalScore: plan?.score.finalScore ?? null,
    lockOrder: plan?.participantLockOrder ?? []
  }));
  const deterministicPlannerFailures = new Set(normalizedPlans).size === 1 ? 0 : 1;

  const cycleExecutions = await Promise.allSettled(
    cycleBuckets.map(async (bucket) => {
      const plan = await phase2b.planner.plan(bucket, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });
      if (!plan) {
        throw new Error(`missing_cycle_plan:${bucket}`);
      }
      return phase2b.executor.execute(plan);
    })
  );
  for (const execution of cycleExecutions) {
    if (execution.status === "rejected" && !(execution.reason instanceof ResourceLockError)) {
      throw execution.reason;
    }
  }

  const partialExecutions = await Promise.allSettled(
    partialBuckets.map(async (bucket) => {
      const plan = await phase2b.planner.plan(bucket, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });
      if (!plan) {
        throw new Error(`missing_partial_plan:${bucket}`);
      }
      return Promise.allSettled([phase2b.executor.execute(plan), phase2b.executor.execute(plan)]);
    })
  );
  for (const execution of partialExecutions) {
    if (execution.status === "rejected") {
      throw execution.reason;
    }
    for (const nested of execution.value) {
      if (nested.status === "rejected" && !(nested.reason instanceof ResourceLockError)) {
        throw nested.reason;
      }
    }
  }

  const comboEngineBundle = buildComboEngine(pool, phase2b.redis, phase2b);
  const routingResults = await Promise.all(
    routingCurrentComboIds.map((comboId) => comboEngineBundle.engine.acceptCombo(comboId, "quote-1"))
  );
  if (!routingResults.every((result) => result.kind === "external_plan")) {
    throw new Error("Residual routing did not stay on the current combo external execution path under load.");
  }
  const routedAmounts = comboEngineBundle.updateExposureAfterExecutionCalls.map((call) => Number(call[3]));
  if (!routedAmounts.every((amount) => amount === 3)) {
    throw new Error("Residual external routing applied an unexpected exposure amount under load.");
  }

  const driftBucket = partialBuckets[0];
  if (driftBucket) {
    const driftComboIds = [
      stableUuid("partial-combo-a-0"),
      stableUuid("partial-combo-b-0"),
      stableUuid("partial-combo-c-0")
    ];
    await phase2b.registry.unregisterEntity(driftComboIds[0]!, driftBucket);
    await phase2b.registry.unregisterEntity(driftComboIds[1]!, driftBucket);
    await phase2b.registry.unregisterEntity(driftComboIds[2]!, driftBucket);
    await phase2b.registry.registerEntity({
      entityId: driftComboIds[1]!,
      userId: stableUuid("drift-user"),
      compatibilityBucket: driftBucket,
      vector: { [`${stableUuid("partial-market-0")}:${stableUuid("partial-outcome-0")}`]: "999" },
      legCount: 1,
      grossAbsSize: "999"
    });
    await reconcileRegistryFromPostgres(pool, phase2b.registry, phase2b.residualVectorBuilder, driftComboIds, driftBucket);
  }

  const duplicateRounds = await countRows(
    pool,
    `SELECT COUNT(*)::text AS count
       FROM (
         SELECT participant_set_hash, match_signature_hash, COUNT(*) AS round_count
           FROM clearing_rounds
          WHERE created_at >= NOW() - INTERVAL '2 hours'
          GROUP BY participant_set_hash, match_signature_hash
         HAVING COUNT(*) > 1
       ) duplicate_rounds`,
    []
  );
  const duplicateExposure = await countRows(
    pool,
    `SELECT COUNT(*)::text AS count
       FROM (
         SELECT reference_id, COUNT(*) AS journal_count
           FROM exposure_journal
          WHERE source = 'combo-multi-party-clearing'
            AND created_at >= NOW() - INTERVAL '2 hours'
          GROUP BY reference_id
         HAVING COUNT(*) > 6
       ) duplicate_exposure`,
    []
  );
  const negativeResiduals = await countRows(
    pool,
    `SELECT COUNT(*)::text AS count
       FROM combo_legs
      WHERE id = ANY($1::uuid[])
        AND remaining_size < 0`,
    [trackedLegIds]
  );
  const stateValidatedComboIds = trackedComboIds.filter((comboId) => !routingCurrentComboIds.includes(comboId));
  const invalidStates = await countRows(
    pool,
    `SELECT COUNT(*)::text AS count
       FROM combo_rfqs r
      WHERE r.id = ANY($1::uuid[])
        AND (
          (r.state = 'EXECUTED' AND EXISTS (SELECT 1 FROM combo_legs l WHERE l.combo_rfq_id = r.id AND l.remaining_size > 0))
          OR
          (r.state = 'PARTIALLY_EXECUTED' AND NOT EXISTS (SELECT 1 FROM combo_legs l WHERE l.combo_rfq_id = r.id AND l.remaining_size > 0))
        )`,
    [stateValidatedComboIds]
  );
  const reconciledPage = driftBucket
    ? await phase2b.registry.listBucketEntities(driftBucket, 10)
    : { entityIds: [], nextCursor: null };
  const rebuildMismatch = driftBucket && reconciledPage.entityIds.length !== 1 ? 1 : 0;
  const elapsedMs = Date.now() - startedAt;
  const runtimeExceeded = elapsedMs > MAX_RUNTIME_MS ? 1 : 0;

  logger.info(
    {
      entityCount: ENTITY_COUNT,
      cycleGroups: CYCLE_GROUPS,
      partialGroups: PARTIAL_GROUPS,
      routingGroups: ROUTING_GROUPS,
      workerConcurrency: WORKER_CONCURRENCY,
      bucketWindowLimit: PLANNER_WINDOW_LIMIT,
      elapsedMs,
      duplicateRounds,
      duplicateExposure,
      negativeResiduals,
      invalidStates,
      deterministicPlannerFailures,
      rebuildMismatch,
      runtimeExceeded
    },
    "Internal-clearing stress summary."
  );

  if (deterministicPlannerFailures > 0) {
    throw new Error("Planner was not deterministic for the same bucket snapshot.");
  }
  if (duplicateRounds > 0) {
    throw new Error("Duplicate clearing_rounds detected under stress.");
  }
  if (duplicateExposure > 0) {
    throw new Error("Duplicate combo multi-party clearing exposure mutation detected under stress.");
  }
  if (negativeResiduals > 0) {
    throw new Error("Negative combo leg remaining_size detected under stress.");
  }
  if (invalidStates > 0) {
    throw new Error("Combo state/residual mismatch detected under stress.");
  }
  if (rebuildMismatch > 0) {
    throw new Error("Redis rebuild did not restore authoritative consistency.");
  }
  if (runtimeExceeded > 0) {
    throw new Error(`Stress runtime exceeded configured limit of ${MAX_RUNTIME_MS}ms.`);
  }

  await disconnectRedis(phase2b.redis);
  await pool.end();
};

main().catch((error) => {
  logger.error({ err: error }, "stress-internal-clearing failed");
  process.exit(1);
});
