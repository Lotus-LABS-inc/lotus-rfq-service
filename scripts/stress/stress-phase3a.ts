#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import pino from "pino";
import { Pool } from "pg";

import { connectRedis, createRedisClient, type RedisClient } from "../../src/db/redis.js";
import { ReplayEnvelopeWriter } from "../../src/core/replay/replay-envelope-writer.js";
import { ReplayDecisionCaptureService } from "../../src/core/replay/replay-decision-capture-service.js";
import { ExactReplayRunner } from "../../src/core/replay/exact-replay-runner.js";
import { DiffReplayRunner } from "../../src/core/replay/diff-replay-runner.js";
import { replayNettingPhase2A } from "../../src/core/replay/evaluators/netting-phase2a-replay-evaluator.js";
import { replayClearingPhase2B } from "../../src/core/replay/evaluators/clearing-phase2b-replay-evaluator.js";
import { replaySORPlan } from "../../src/core/replay/evaluators/sor-plan-replay-evaluator.js";
import { ReplayAdminService } from "../../src/api/admin/replay-admin-service.js";
import { ControlPlaneAdminService } from "../../src/api/admin/control-plane-admin-service.js";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { Splitter } from "../../src/core/sor/splitter.js";
import { PlanComposer } from "../../src/core/sor/plan-composer.js";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import type {
  CanonicalRFQInput,
  RouteCandidate,
  SelectedQuoteInput,
  SORAcceptancePolicy
} from "../../src/core/sor/types.js";
import { ComboNettingCandidateRegistry } from "../../src/core/combo-engine/combo-netting-candidate-registry.js";
import { ComboNettingCompatibilityEngine } from "../../src/core/combo-engine/combo-netting-compatibility-engine.js";
import { ResourceLocker } from "../../src/core/combo-engine/resource-locker.js";
import { MultiLegInternalNettingEngine } from "../../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import type { MultiLegInternalNettingInput } from "../../src/core/combo-engine/types.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiPartyExposureAggregator } from "../../src/core/combo-engine/multi-party-exposure-aggregator.js";
import { MultiPartyClearingExecutor } from "../../src/core/combo-engine/multi-party-clearing-executor.js";
import { DegradationManager } from "../../src/guardrails/degradation-manager.js";
import { GuardrailEvaluator } from "../../src/guardrails/guardrail-evaluator.js";
import { createPerformanceGuardrailConfig } from "../../src/guardrails/guardrail-config.js";
import { OrderBook } from "../../src/core/internal-engine/order-book.js";
import { ReconciliationV2Job } from "../../src/jobs/reconciliation-v2.job.js";
import {
  applyMigrations,
  buildCreatedAt,
  buildResolutionMetadata,
  buildStableUuid,
  computeScopedComboFingerprint,
  countRows,
  insertCombo,
  loadResidualEntity,
  safeDisconnectRedis,
  scopeReconciliationJobToCombos
} from "../../test/support/phase3a-proof-support.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const ALT_ENGINE_VERSION = "phase3a-proof-alt-v1";

const SEED = process.env.PHASE3A_STRESS_SEED ?? "phase3a-stress";
const RUN_ID = process.env.PHASE3A_STRESS_RUN_ID ?? randomUUID();
const CAPTURE_CONCURRENCY = Number(process.env.PHASE3A_STRESS_CAPTURE_CONCURRENCY ?? "4");
const CAPTURE_SCENARIOS_PER_ENGINE = Number(process.env.PHASE3A_STRESS_CAPTURE_SCENARIOS_PER_ENGINE ?? "12");
const EXACT_BURST = Number(process.env.PHASE3A_STRESS_EXACT_BURST ?? "36");
const DIFF_BURST = Number(process.env.PHASE3A_STRESS_DIFF_BURST ?? "18");
const CONTROL_PLANE_OPS = Number(process.env.PHASE3A_STRESS_CONTROL_PLANE_OPS ?? "12");
const RECON_BATCH_SIZE = Number(process.env.PHASE3A_STRESS_RECON_BATCH_SIZE ?? "25");
const MAX_RUNTIME_MS = Number(process.env.PHASE3A_STRESS_MAX_RUNTIME_MS ?? "420000");

interface TaggedReplayEnvelopeRow {
  id: string;
  decision_type: string;
  entity_id: string;
}

const buildReplayCaptureConfig = (tag: string, engineVersion: string) => ({
  mode: "BEST_EFFORT" as const,
  configVersion: "phase3a-proof-cfg-v1",
  engineVersion,
  featureFlags: { proofRunTag: tag }
});

const buildRouteCandidates = (tag: string): RouteCandidate[] => [
  {
    id: buildStableUuid(tag, tag, "candidate-a"),
    leg_id: buildStableUuid(tag, tag, "leg-a"),
    provider_type: "LP",
    provider_id: buildStableUuid(tag, tag, "provider-a"),
    available_size: 10,
    quoted_price: 0.51,
    fees: {},
    latency_ms: 10,
    fill_prob: 1
  },
  {
    id: buildStableUuid(tag, tag, "candidate-b"),
    leg_id: buildStableUuid(tag, tag, "leg-a"),
    provider_type: "LP",
    provider_id: buildStableUuid(tag, tag, "provider-b"),
    available_size: 10,
    quoted_price: 0.53,
    fees: {},
    latency_ms: 12,
    fill_prob: 0.95
  }
];

const buildSORInputs = (tag: string): { rfq: CanonicalRFQInput; selectedQuote: SelectedQuoteInput; policy: SORAcceptancePolicy } => ({
  rfq: {
    rfqId: buildStableUuid(tag, tag, "rfq"),
    idempotencyKey: buildStableUuid(tag, tag, "idempotency"),
    canonicalMarketId: buildStableUuid(tag, tag, "market"),
    takerId: buildStableUuid(tag, tag, "taker"),
    side: "buy",
    quantity: "10",
    stpMode: "CANCEL_NEWEST",
    metadata: {
      reservation_token: buildStableUuid(tag, tag, "reservation")
    }
  },
  selectedQuote: {
    quoteId: buildStableUuid(tag, tag, "quote"),
    price: 0.51,
    quantity: 10,
    feeBps: 0
  },
  policy: "BEST_EFFORT"
});

const createReplayAdminService = (db: Pool) => {
  const controlPlaneAdminService = new ControlPlaneAdminService({ pool: db, logger });
  const costModel = new CostModel();
  const splitter = new Splitter();
  const overlapGraphBuilder = new OverlapGraphBuilder();
  const candidateGroupEnumerator = new CandidateGroupEnumerator();
  const clearingCompressionScorer = new ClearingCompressionScorer();

  return new ReplayAdminService({
    replayMetadataReader: controlPlaneAdminService,
    exactReplayRunner: new ExactReplayRunner({
      pool: db,
      resolutionPairComparator: new ResolutionPairComparator(),
      resolutionRiskScoringEngine: new ResolutionRiskScoringEngine(),
      costModel,
      splitter,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer
    }),
    diffReplayRunner: new DiffReplayRunner({
      pool: db,
      resolutionPairComparator: new ResolutionPairComparator(),
      costModel,
      splitter,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer,
      engineRegistry: {
        SOR_PLAN: {
          [ALT_ENGINE_VERSION]: {
            evaluate: async (inputSnapshot) => {
              const replayed = await replaySORPlan(inputSnapshot, costModel, splitter);
              const decisionTrace = (replayed.decisionTrace ?? {}) as Record<string, unknown>;
              const allocations = Array.isArray(decisionTrace.allocations)
                ? [...decisionTrace.allocations, { candidateId: "phase3a-alt-route", targetSize: 0, roundedSize: 0 }]
                : [{ candidateId: "phase3a-alt-route", targetSize: 0, roundedSize: 0 }];

              return {
                ...replayed,
                decisionTrace: {
                  ...decisionTrace,
                  allocations
                }
              };
            }
          }
        },
        NETTING_PHASE2A: {
          [ALT_ENGINE_VERSION]: {
            evaluate: async (inputSnapshot, decisionTrace) => {
              const replayed = replayNettingPhase2A(inputSnapshot, decisionTrace);
              const result = (replayed.result ?? {}) as Record<string, unknown>;
              const residualLegs = Array.isArray(result.residualLegs) ? [...result.residualLegs] : [];

              return {
                result: {
                  ...result,
                  nettedSize: `${Number(result.nettedSize ?? "0") + 1}`,
                  residualLegs: [
                    ...residualLegs,
                    {
                      id: "phase3a-alt-leg",
                      canonicalMarketId: "alt-market",
                      canonicalOutcomeId: "alt-outcome",
                      side: "buy",
                      remainingSize: "1"
                    }
                  ],
                  residualRemaining: true
                }
              };
            }
          }
        },
        CLEARING_PHASE2B: {
          [ALT_ENGINE_VERSION]: {
            evaluate: async (inputSnapshot) => {
              const replayed = replayClearingPhase2B(
                inputSnapshot,
                overlapGraphBuilder,
                candidateGroupEnumerator,
                clearingCompressionScorer
              );
              const selectedPlan = replayed.selectedPlan as Record<string, unknown> | null;
              if (!selectedPlan) {
                return replayed;
              }

              const participantLockOrder = Array.isArray(selectedPlan.participantLockOrder)
                ? [...(selectedPlan.participantLockOrder as string[])].reverse()
                : [];

              return {
                ...replayed,
                selectedPlan: {
                  ...selectedPlan,
                  participantLockOrder
                }
              };
            }
          }
        }
      }
    }),
    logger
  });
};

const createReplayCaptureService = (db: Pool) =>
  new ReplayDecisionCaptureService(new ReplayEnvelopeWriter({ pool: db }), logger);

const createOrderRouter = (
  db: Pool,
  tag: string,
  options?: {
    replayDecisionCaptureService?: ReplayDecisionCaptureService;
    guardrailConfig?: ReturnType<typeof createPerformanceGuardrailConfig>;
    guardrailEvaluator?: GuardrailEvaluator | { evaluate: (input: unknown) => unknown };
    degradationManager?: DegradationManager;
    replayWriteFailureStatsSource?: { getReplayWriteFailures(): number | Promise<number> };
    controlPlaneShardId?: string;
  }
) =>
  new OrderRouter({
    routeScout: {
      discoverCandidates: async (rfq: CanonicalRFQInput) => buildRouteCandidates(rfq.rfqId)
    } as never,
    costModel: new CostModel(),
    splitter: new Splitter(),
    planComposer: new PlanComposer({
      pool: db,
      logger,
      now: () => new Date("2026-03-12T00:00:00.000Z")
    }),
    internalEngine: {
      attemptCross: async (order: { remaining_size: string }) => ({
        filledSize: 0,
        remainingSize: Number.parseFloat(order.remaining_size),
        trades: []
      }),
      previewCross: async (order: { remaining_size: string }) => ({
        fillableSize: 0,
        remainingSize: Number.parseFloat(order.remaining_size),
        matchedOrderIds: [],
        wouldSelfTrade: false
      })
    },
    logger,
    replayDecisionCaptureService: options?.replayDecisionCaptureService,
    replayCaptureConfig: buildReplayCaptureConfig(tag, "sor-plan-v1"),
    guardrailConfig: options?.guardrailConfig,
    guardrailEvaluator: options?.guardrailEvaluator as never,
    degradationManager: options?.degradationManager,
    replayWriteFailureStatsSource: options?.replayWriteFailureStatsSource,
    controlPlaneShardId: options?.controlPlaneShardId
  });

const createNettingBundle = (
  db: Pool,
  redisClient: RedisClient,
  tag: string,
  options?: {
    replayDecisionCaptureService?: ReplayDecisionCaptureService;
    guardrailConfig?: ReturnType<typeof createPerformanceGuardrailConfig>;
    guardrailEvaluator?: GuardrailEvaluator | { evaluate: (input: unknown) => unknown };
    degradationManager?: DegradationManager;
    replayWriteFailureStatsSource?: { getReplayWriteFailures(): number | Promise<number> };
    controlPlaneShardId?: string;
  }
) => {
  const candidateRegistry = new ComboNettingCandidateRegistry(redisClient as never);
  const resourceLocker = new ResourceLocker(redisClient, { baseDelayMs: 10, maxRetries: 3, lockTtlMs: 3000 });

  return {
    candidateRegistry,
    engine: new MultiLegInternalNettingEngine(
      db,
      candidateRegistry,
      new ComboNettingCompatibilityEngine(),
      resourceLocker,
      logger,
      undefined,
      options?.replayDecisionCaptureService,
      buildReplayCaptureConfig(tag, "netting-phase2a-v1"),
      options?.guardrailConfig,
      options?.guardrailEvaluator as never,
      options?.degradationManager,
      options?.replayWriteFailureStatsSource,
      {
        getCurrentLockWaitMs: () => 0
      },
      options?.controlPlaneShardId ?? "phase3a-netting-main"
    )
  };
};

const createPhase2BBundle = (
  db: Pool,
  redisClient: RedisClient,
  tag: string,
  options?: {
    replayDecisionCaptureService?: ReplayDecisionCaptureService;
    guardrailConfig?: ReturnType<typeof createPerformanceGuardrailConfig>;
    guardrailEvaluator?: GuardrailEvaluator | { evaluate: (input: unknown) => unknown };
    degradationManager?: DegradationManager;
    replayWriteFailureStatsSource?: { getReplayWriteFailures(): number | Promise<number> };
    controlPlaneShardId?: string;
  }
) => {
  const residualVectorBuilder = new ResidualVectorBuilder();
  const registry = new Phase2BCandidateRegistry(redisClient as never);
  const overlapGraphBuilder = new OverlapGraphBuilder();
  const candidateGroupEnumerator = new CandidateGroupEnumerator();
  const clearingCompressionScorer = new ClearingCompressionScorer();
  const planner = new ClearingRoundPlanner(
    registry,
    overlapGraphBuilder,
    candidateGroupEnumerator,
    clearingCompressionScorer,
    undefined,
    options?.replayDecisionCaptureService,
    buildReplayCaptureConfig(tag, "clearing-phase2b-v1"),
    options?.guardrailConfig,
    options?.guardrailEvaluator as never,
    options?.degradationManager,
    options?.replayWriteFailureStatsSource,
    options?.controlPlaneShardId ?? "phase3a-clearing-main",
    logger
  );
  const executor = new MultiPartyClearingExecutor(
    db,
    residualVectorBuilder,
    registry,
    overlapGraphBuilder,
    candidateGroupEnumerator,
    clearingCompressionScorer,
    new MultiPartyExposureAggregator(),
    new ResourceLocker(redisClient, { baseDelayMs: 10, maxRetries: 3, lockTtlMs: 3000 }),
    logger
  );

  return {
    residualVectorBuilder,
    registry,
    planner,
    executor
  };
};

const seedNettingPair = async (
  db: Pool,
  candidateRegistry: ComboNettingCandidateRegistry,
  seed: string,
  runId: string,
  namespace: string
): Promise<MultiLegInternalNettingInput> => {
  const tag = buildStableUuid(seed, runId, `${namespace}:tag`);
  const marketId = buildStableUuid(seed, runId, `${namespace}:market`);
  const outcomeId = buildStableUuid(seed, runId, `${namespace}:outcome`);
  const incomingComboId = buildStableUuid(seed, runId, `${namespace}:incoming`);
  const candidateComboId = buildStableUuid(seed, runId, `${namespace}:candidate`);
  const incomingLegId = buildStableUuid(seed, runId, `${namespace}:incoming-leg`);
  const candidateLegId = buildStableUuid(seed, runId, `${namespace}:candidate-leg`);
  const incomingUserId = buildStableUuid(seed, runId, `${namespace}:incoming-user`);
  const metadata = buildResolutionMetadata(tag);

  await insertCombo(db, {
    comboId: incomingComboId,
    userId: incomingUserId,
    createdAt: buildCreatedAt("09", 1),
    metadataTag: tag,
    legs: [{
      legId: incomingLegId,
      marketId,
      outcomeId,
      side: "buy",
      size: "5",
      remainingSize: "5",
      priceHint: "0.60",
      metadata
    }]
  });
  await insertCombo(db, {
    comboId: candidateComboId,
    userId: buildStableUuid(seed, runId, `${namespace}:candidate-user`),
    createdAt: buildCreatedAt("09", 2),
    metadataTag: tag,
    legs: [{
      legId: candidateLegId,
      marketId,
      outcomeId,
      side: "sell",
      size: "5",
      remainingSize: "5",
      priceHint: "0.55",
      metadata
    }]
  });

  await candidateRegistry.registerComboCandidate({
    id: candidateComboId,
    legs: [{
      id: candidateLegId,
      marketId,
      outcomeId,
      side: "sell"
    }]
  });

  return {
    id: incomingComboId,
    userId: incomingUserId,
    state: "OPEN",
    legs: [{
      id: incomingLegId,
      canonicalMarketId: marketId,
      canonicalOutcomeId: outcomeId,
      side: "buy",
      remainingSize: "5",
      priceHint: "0.60"
    }]
  };
};

const seedClearingCycle = async (
  db: Pool,
  residualVectorBuilder: ResidualVectorBuilder,
  registry: Phase2BCandidateRegistry,
  seed: string,
  runId: string,
  namespace: string
): Promise<{ bucketId: string; comboIds: string[] }> => {
  const tag = buildStableUuid(seed, runId, `${namespace}:tag`);
  const metadata = buildResolutionMetadata(tag);
  const marketA = buildStableUuid(seed, runId, `${namespace}:market-a`);
  const marketB = buildStableUuid(seed, runId, `${namespace}:market-b`);
  const marketC = buildStableUuid(seed, runId, `${namespace}:market-c`);
  const outcomeA = buildStableUuid(seed, runId, `${namespace}:outcome-a`);
  const outcomeB = buildStableUuid(seed, runId, `${namespace}:outcome-b`);
  const outcomeC = buildStableUuid(seed, runId, `${namespace}:outcome-c`);
  const comboA = buildStableUuid(seed, runId, `${namespace}:combo-a`);
  const comboB = buildStableUuid(seed, runId, `${namespace}:combo-b`);
  const comboC = buildStableUuid(seed, runId, `${namespace}:combo-c`);

  await insertCombo(db, {
    comboId: comboA,
    userId: buildStableUuid(seed, runId, `${namespace}:user-a`),
    createdAt: buildCreatedAt("10", 1),
    metadataTag: tag,
    legs: [
      {
        legId: buildStableUuid(seed, runId, `${namespace}:combo-a-leg-1`),
        marketId: marketA,
        outcomeId: outcomeA,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      },
      {
        legId: buildStableUuid(seed, runId, `${namespace}:combo-a-leg-2`),
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
    userId: buildStableUuid(seed, runId, `${namespace}:user-b`),
    createdAt: buildCreatedAt("10", 2),
    metadataTag: tag,
    legs: [
      {
        legId: buildStableUuid(seed, runId, `${namespace}:combo-b-leg-1`),
        marketId: marketB,
        outcomeId: outcomeB,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      },
      {
        legId: buildStableUuid(seed, runId, `${namespace}:combo-b-leg-2`),
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
    userId: buildStableUuid(seed, runId, `${namespace}:user-c`),
    createdAt: buildCreatedAt("10", 3),
    metadataTag: tag,
    legs: [
      {
        legId: buildStableUuid(seed, runId, `${namespace}:combo-c-leg-1`),
        marketId: marketC,
        outcomeId: outcomeC,
        side: "buy",
        size: "5",
        remainingSize: "5",
        priceHint: "0.40",
        metadata
      },
      {
        legId: buildStableUuid(seed, runId, `${namespace}:combo-c-leg-2`),
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

  const vectorA = residualVectorBuilder.build(await loadResidualEntity(db, comboA));
  await registry.registerEntity(vectorA);
  await registry.registerEntity(residualVectorBuilder.build(await loadResidualEntity(db, comboB)));
  await registry.registerEntity(residualVectorBuilder.build(await loadResidualEntity(db, comboC)));

  return {
    bucketId: vectorA.compatibilityBucket,
    comboIds: [comboA, comboB, comboC]
  };
};

const loadTaggedReplayEnvelopes = async (db: Pool, tag: string): Promise<TaggedReplayEnvelopeRow[]> => {
  const result = await db.query<TaggedReplayEnvelopeRow>(
    `SELECT id::text, decision_type, entity_id::text
       FROM replay_envelopes
      WHERE feature_flags->>'proofRunTag' = $1
      ORDER BY created_at ASC, id ASC`,
    [tag]
  );
  return result.rows;
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push([...items.slice(index, index + size)]);
  }
  return batches;
};

const runWithConcurrency = async <T>(
  operations: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> => {
  const results: T[] = [];
  for (const batch of chunk(operations, Math.max(1, concurrency))) {
    results.push(...(await Promise.all(batch.map((operation) => operation()))));
  }
  return results;
};

const assertInvariant = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async (): Promise<void> => {
  if (!TEST_DB_URL || !TEST_REDIS_URL) {
    throw new Error("TEST_DATABASE_URL/DATABASE_URL and TEST_REDIS_URL/REDIS_URL are required.");
  }

  const startedAt = Date.now();
  const pool = new Pool({
    connectionString: TEST_DB_URL,
    max: Math.min(CAPTURE_CONCURRENCY + 6, 12),
    min: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 20_000,
    application_name: "stress-phase3a"
  });
  pool.on("error", (error) => {
    logger.warn({ err: error }, "Ignoring transient pool error in stress-phase3a.");
  });

  const redis = createRedisClient({ redisUrl: TEST_REDIS_URL, logger });

  try {
    await connectRedis(redis);
    await applyMigrations(pool);

    const replayAdminService = createReplayAdminService(pool);
    const captureTag = `phase3a-stress-${RUN_ID}`;
    const replayCaptureService = createReplayCaptureService(pool);
    const orderRouter = createOrderRouter(pool, captureTag, { replayDecisionCaptureService: replayCaptureService });
    const nettingBundle = createNettingBundle(pool, redis, captureTag, {
      replayDecisionCaptureService: replayCaptureService
    });
    const phase2bBundle = createPhase2BBundle(pool, redis, captureTag, {
      replayDecisionCaptureService: replayCaptureService
    });

    const captureOps: Array<() => Promise<unknown>> = [];
    for (let index = 0; index < CAPTURE_SCENARIOS_PER_ENGINE; index += 1) {
      captureOps.push(async () => {
        const inputs = buildSORInputs(`${captureTag}-sor-${index}`);
        return orderRouter.buildPlan(inputs.rfq, inputs.selectedQuote, inputs.policy);
      });
      captureOps.push(async () => {
        const incoming = await seedNettingPair(pool, nettingBundle.candidateRegistry, SEED, RUN_ID, `stress-netting-${index}`);
        return nettingBundle.engine.attemptNet(incoming);
      });
      captureOps.push(async () => {
        const seeded = await seedClearingCycle(
          pool,
          phase2bBundle.residualVectorBuilder,
          phase2bBundle.registry,
          SEED,
          RUN_ID,
          `stress-clearing-${index}`
        );
        return phase2bBundle.planner.plan(seeded.bucketId, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });
      });
    }

    await runWithConcurrency(captureOps, CAPTURE_CONCURRENCY);
    const envelopes = await loadTaggedReplayEnvelopes(pool, captureTag);
    const attemptedCaptures = CAPTURE_SCENARIOS_PER_ENGINE * 3;
    assertInvariant(envelopes.length === attemptedCaptures, "Replay capture count mismatch.");

    const exactReplayInputs = envelopes.slice(0, Math.min(EXACT_BURST, envelopes.length));
    const exactReplayResults = await runWithConcurrency(
      exactReplayInputs.map((envelope) => () =>
        replayAdminService.runExactReplay({
          envelopeId: envelope.id,
          requestedBy: "stress-phase3a"
        })
      ),
      CAPTURE_CONCURRENCY
    );
    const exactReplayDiffs = exactReplayResults.filter((result) => result.status === "DIFF").length;
    const exactReplayErrors = exactReplayResults.filter((result) => result.status === "ERROR").length;
    assertInvariant(exactReplayDiffs === 0, "Same-version exact replay produced DIFF.");
    assertInvariant(exactReplayErrors === 0, "Same-version exact replay produced ERROR.");

    const diffReplayInputs = envelopes.slice(0, Math.min(DIFF_BURST, envelopes.length));
    const diffReplayResults = await runWithConcurrency(
      diffReplayInputs.map((envelope) => () =>
        replayAdminService.runDiffReplay({
          envelopeId: envelope.id,
          requestedBy: "stress-phase3a",
          engineVersion: ALT_ENGINE_VERSION
        })
      ),
      CAPTURE_CONCURRENCY
    );
    const diffReplayErrors = diffReplayResults.filter((result) => result.status === "ERROR").length;
    assertInvariant(diffReplayErrors === 0, "Alternate-version diff replay produced ERROR.");

    const diffByType = new Map<string, number>();
    diffReplayInputs.forEach((envelope, index) => {
      if (diffReplayResults[index]?.status === "DIFF") {
        diffByType.set(envelope.decision_type, (diffByType.get(envelope.decision_type) ?? 0) + 1);
      }
    });
    assertInvariant((diffByType.get("SOR_PLAN") ?? 0) > 0, "Expected alternate SOR_PLAN diffs were missing.");
    assertInvariant((diffByType.get("NETTING_PHASE2A") ?? 0) > 0, "Expected alternate NETTING_PHASE2A diffs were missing.");
    assertInvariant((diffByType.get("CLEARING_PHASE2B") ?? 0) > 0, "Expected alternate CLEARING_PHASE2B diffs were missing.");

    const runTag = `phase3a-stress-guardrail-${RUN_ID}`;
    const degradationManager = new DegradationManager({ pool, logger });
    const controlPlaneAdminService = new ControlPlaneAdminService({ pool, logger });
    const sorShardId = `${runTag}-sor-shard`;
    const nettingShardId = `${runTag}-netting-shard`;
    const clearingShardId = `${runTag}-clearing-shard`;
    const adminShardId = `${runTag}-admin-shard`;
    const adminBucketIds = [`${runTag}-bucket-a`, `${runTag}-bucket-b`];

    await pool.query(
      `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
       VALUES
         ($1, 'FULL_MODE', 0, 0, 0, NULL),
         ($2, 'FULL_MODE', 0, 0, 0, NULL),
         ($3, 'FULL_MODE', 0, 0, 0, NULL),
         ($4, 'FULL_MODE', 0, 0, 0, NULL)`,
      [sorShardId, nettingShardId, clearingShardId, adminShardId]
    );
    await pool.query(
      `INSERT INTO bucket_state (bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason)
       VALUES
         ($1, 'CLEARING', 'FULL_MODE', 0, NULL, NULL),
         ($2, 'CLEARING', 'FULL_MODE', 0, NULL, NULL)`,
      adminBucketIds
    );

    const guardrailOrderRouter = createOrderRouter(pool, `${runTag}-sor`, {
      guardrailConfig: createPerformanceGuardrailConfig({
        version: "phase3a-guardrails-v1",
        maxSorPlanningLatencyMs: 1,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 100,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 100,
        degradationPolicyVersion: "phase3a-guardrails-v1"
      }),
      guardrailEvaluator: {
        evaluate: ({ stats }: { stats: { candidateGroups: number } }) =>
          stats.candidateGroups > 0
            ? {
                violated: true,
                violations: [{
                  type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
                  actual: 5,
                  threshold: 1,
                  reason: "planner latency exceeded budget"
                }],
                suggestedDegradation: "SOR_ONLY"
              }
            : { violated: false, violations: [] }
      } as never,
      degradationManager,
      replayWriteFailureStatsSource: { getReplayWriteFailures: () => 0 },
      controlPlaneShardId: sorShardId
    });
    const guardrailNettingBundle = createNettingBundle(pool, redis, `${runTag}-netting`, {
      guardrailConfig: createPerformanceGuardrailConfig({
        version: "phase3a-guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 100,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 1,
        degradationPolicyVersion: "phase3a-guardrails-v1"
      }),
      guardrailEvaluator: new GuardrailEvaluator(),
      degradationManager,
      replayWriteFailureStatsSource: { getReplayWriteFailures: () => 3 },
      controlPlaneShardId: nettingShardId
    });
    const guardrailPhase2BBundle = createPhase2BBundle(pool, redis, `${runTag}-clearing`, {
      guardrailConfig: createPerformanceGuardrailConfig({
        version: "phase3a-guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 1,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 100,
        degradationPolicyVersion: "phase3a-guardrails-v1"
      }),
      guardrailEvaluator: new GuardrailEvaluator(),
      degradationManager,
      replayWriteFailureStatsSource: { getReplayWriteFailures: () => 0 },
      controlPlaneShardId: clearingShardId
    });

    const guardrailInputs = buildSORInputs(`${runTag}-sor`);
    await guardrailOrderRouter.buildPlan(guardrailInputs.rfq, guardrailInputs.selectedQuote, guardrailInputs.policy);
    const guardrailIncoming = await seedNettingPair(pool, guardrailNettingBundle.candidateRegistry, runTag, RUN_ID, "guardrail-netting");
    await guardrailNettingBundle.engine.attemptNet(guardrailIncoming);
    const guardrailCycle = await seedClearingCycle(
      pool,
      guardrailPhase2BBundle.residualVectorBuilder,
      guardrailPhase2BBundle.registry,
      runTag,
      RUN_ID,
      "guardrail-clearing"
    );
    const guardrailPlan = await guardrailPhase2BBundle.planner.plan(guardrailCycle.bucketId, {
      bucketWindowLimit: 10,
      maxParticipants: 4,
      maxUniqueLegs: 6
    });

    const adminOps = Array.from({ length: CONTROL_PLANE_OPS }, (_, index) => {
      const bucketId = adminBucketIds[index % adminBucketIds.length]!;
      const expiresAt = new Date(Date.now() + 60_000 + index * 1000);
      if (index % 4 === 0) {
        return controlPlaneAdminService.pauseBucket(bucketId, `${runTag}-ops`);
      }
      if (index % 4 === 1) {
        return controlPlaneAdminService.drainBucket(bucketId, `${runTag}-ops`);
      }
      if (index % 4 === 2) {
        return controlPlaneAdminService.pauseShard(adminShardId, `${runTag}-ops`);
      }
      return controlPlaneAdminService.createOverride({
        scopeType: "BUCKET",
        scopeId: bucketId,
        overrideType: "SAFE_FALLBACK",
        payload: { mode: "SAFE_FALLBACK", reason: "phase3a-proof-admin" },
        createdBy: `${runTag}-ops`,
        expiresAt
      });
    });
    await Promise.all(adminOps);

    const shardModes = await pool.query<{ shard_id: string; mode: string }>(
      `SELECT shard_id, mode
         FROM planner_shard_state
        WHERE shard_id = ANY($1::text[])`,
      [[sorShardId, nettingShardId, clearingShardId, adminShardId]]
    );
    const shardModeMap = new Map(shardModes.rows.map((row) => [row.shard_id, row.mode]));
    assertInvariant(shardModeMap.get(sorShardId) === "SOR_ONLY", "SOR guardrail degradation did not persist.");
    assertInvariant(shardModeMap.get(nettingShardId) === "SAFE_FALLBACK", "Netting guardrail degradation did not persist.");
    assertInvariant(shardModeMap.get(clearingShardId) === "DISABLE_PHASE2B", "Clearing guardrail degradation did not persist.");
    assertInvariant(shardModeMap.get(adminShardId) === "PAUSED", "Admin shard pause did not persist.");
    assertInvariant(guardrailPlan === null, "Clearing guardrail did not fail closed.");

    const noOpAudits = await countRows(
      pool,
      `SELECT COUNT(*)::text AS count
         FROM control_plane_audit_events
        WHERE event_type = 'execution_mode_changed'
          AND scope_id = ANY($1::text[])
          AND previous_mode = new_mode`,
      [[sorShardId, nettingShardId, clearingShardId]]
    );
    assertInvariant(noOpAudits === 0, "Contradictory control-plane audit rows detected.");

    const overrideCount = await countRows(
      pool,
      `SELECT COUNT(*)::text AS count
         FROM control_plane_overrides
        WHERE created_by = $1`,
      [`${runTag}-ops`]
    );
    assertInvariant(overrideCount === Math.floor(CONTROL_PLANE_OPS / 4), "Unexpected override count under concurrent control-plane activity.");

    const clearingExecSeed = await seedClearingCycle(
      pool,
      phase2bBundle.residualVectorBuilder,
      phase2bBundle.registry,
      SEED,
      RUN_ID,
      "stress-clearing-exec"
    );
    const clearingExecPlan = await phase2bBundle.planner.plan(clearingExecSeed.bucketId, {
      bucketWindowLimit: 10,
      maxParticipants: 4,
      maxUniqueLegs: 6
    });
    assertInvariant(clearingExecPlan !== null, "Expected executable clearing plan was missing.");
    await phase2bBundle.executor.execute(clearingExecPlan!);

    const duplicateRounds = await countRows(
      pool,
      `SELECT COUNT(*)::text AS count
         FROM (
           SELECT participant_set_hash, match_signature_hash
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
           SELECT reference_id, exposure_id
             FROM exposure_journal
            WHERE source = 'combo-multi-party-clearing'
              AND created_at >= NOW() - INTERVAL '2 hours'
            GROUP BY reference_id, exposure_id
           HAVING COUNT(*) > 1
         ) duplicate_exposure`,
      []
    );
    const negativeResiduals = await countRows(
      pool,
      `SELECT COUNT(*)::text AS count
         FROM combo_legs
        WHERE combo_rfq_id = ANY($1::uuid[])
          AND remaining_size < 0`,
      [clearingExecSeed.comboIds]
    );
    assertInvariant(duplicateRounds === 0, "Duplicate clearing_rounds detected.");
    assertInvariant(duplicateExposure === 0, "Duplicate clearing exposure journal rows detected.");
    assertInvariant(negativeResiduals === 0, "Negative residual legs detected.");

    const comboNettingRegistry = new ComboNettingCandidateRegistry(redis as never);
    const phase2bRegistry = new Phase2BCandidateRegistry(redis as never);
    const residualVectorBuilder = new ResidualVectorBuilder();
    const nettingIncoming = await seedNettingPair(pool, comboNettingRegistry, SEED, RUN_ID, "stress-recon-netting");
    await comboNettingRegistry.registerComboCandidate({
      id: nettingIncoming.id,
      legs: nettingIncoming.legs.map((leg) => ({
        id: leg.id,
        marketId: leg.canonicalMarketId,
        outcomeId: leg.canonicalOutcomeId,
        side: leg.side
      }))
    });
    const reconClearingSeed = await seedClearingCycle(
      pool,
      residualVectorBuilder,
      phase2bRegistry,
      SEED,
      RUN_ID,
      "stress-recon-clearing"
    );
    const scopedComboIds = [nettingIncoming.id, ...reconClearingSeed.comboIds];
    const fingerprintBefore = await computeScopedComboFingerprint(pool, scopedComboIds);

    await comboNettingRegistry.unregisterComboCandidate(nettingIncoming.id);
    await phase2bRegistry.unregisterEntity(reconClearingSeed.comboIds[0]!, reconClearingSeed.bucketId);

    const reconciliationJob = new ReconciliationV2Job({
      pool,
      redis,
      logger,
      resolutionRiskAdminService: {
        getCanonicalInspection: async () => ({
          canonicalEventId: "unused",
          profiles: [],
          assessments: [],
          scoringVersion: "resolution-risk-v1",
          freshness: {
            profileCount: 0,
            expectedPairCount: 0,
            persistedPairCount: 0,
            lastComputedAt: null,
            latestProfileUpdatedAt: null,
            isComplete: true,
            isStale: false,
            hasMixedVersions: false
          }
        })
      } as never,
      orderBook: new OrderBook(redis),
      comboNettingCandidateRegistry: comboNettingRegistry,
      phase2bCandidateRegistry: phase2bRegistry,
      residualVectorBuilder
    });
    scopeReconciliationJobToCombos(reconciliationJob, pool, scopedComboIds);

    const dryRun = await reconciliationJob.run({
      batchSize: RECON_BATCH_SIZE,
      dryRun: true,
      autoFix: false,
      domains: ["netting_phase2a", "clearing_phase2b"]
    });
    assertInvariant(dryRun.discrepancyCount >= 2, "Reconciliation dry-run did not detect injected drift.");

    const autoFix = await reconciliationJob.run({
      batchSize: RECON_BATCH_SIZE,
      dryRun: false,
      autoFix: true,
      domains: ["netting_phase2a", "clearing_phase2b"]
    });
    assertInvariant(autoFix.discrepancies.every((item) => item.fixApplied === true), "Reconciliation auto-fix did not repair all injected drift.");

    const rerun = await reconciliationJob.run({
      batchSize: RECON_BATCH_SIZE,
      dryRun: true,
      autoFix: false,
      domains: ["netting_phase2a", "clearing_phase2b"]
    });
    assertInvariant(rerun.discrepancyCount === 0, "Reconciliation rerun still found discrepancies after auto-fix.");

    const fingerprintAfter = await computeScopedComboFingerprint(pool, scopedComboIds);
    assertInvariant(fingerprintAfter === fingerprintBefore, "Reconciliation auto-fix mutated authoritative Postgres truth.");
    const reconciliationLockPresent = (await redis.get("phase3a:reconciliation_v2:lock")) !== null;
    assertInvariant(!reconciliationLockPresent, "Reconciliation lock leaked after run.");

    const reverseKey = comboNettingRegistry.comboLegsKey(nettingIncoming.id);
    const reverseMembers = (await redis.smembers?.(reverseKey)) ?? [];
    assertInvariant(reverseMembers.length > 0, "Netting reverse index was not rebuilt.");
    assertInvariant(
      (await phase2bRegistry.getEntitySnapshot(reconClearingSeed.comboIds[0]!)) !== null,
      "Clearing entity snapshot was not rebuilt."
    );

    const elapsedMs = Date.now() - startedAt;
    assertInvariant(elapsedMs <= MAX_RUNTIME_MS, `Stress runtime exceeded configured limit of ${MAX_RUNTIME_MS}ms.`);

    logger.info(
      {
        runId: RUN_ID,
        seed: SEED,
        capture: {
          attempted: attemptedCaptures,
          persisted: envelopes.length
        },
        exactReplay: {
          attempted: exactReplayInputs.length,
          matchCount: exactReplayResults.filter((result) => result.status === "MATCH").length,
          diffCount: exactReplayDiffs,
          errorCount: exactReplayErrors
        },
        diffReplay: {
          attempted: diffReplayInputs.length,
          diffCount: diffReplayResults.filter((result) => result.status === "DIFF").length,
          matchCount: diffReplayResults.filter((result) => result.status === "MATCH").length,
          errorCount: diffReplayErrors,
          classifications: Object.fromEntries(diffByType.entries())
        },
        guardrails: {
          sorShardMode: shardModeMap.get(sorShardId),
          nettingShardMode: shardModeMap.get(nettingShardId),
          clearingShardMode: shardModeMap.get(clearingShardId),
          adminShardMode: shardModeMap.get(adminShardId),
          contradictoryAuditRows: noOpAudits
        },
        controlPlane: {
          operations: CONTROL_PLANE_OPS,
          overridesCreated: overrideCount
        },
        clearing: {
          duplicateRounds,
          duplicateExposure,
          negativeResiduals
        },
        reconciliation: {
          dryRunDiscrepancies: dryRun.discrepancyCount,
          autoFixDiscrepancies: autoFix.discrepancyCount,
          rerunDiscrepancies: rerun.discrepancyCount,
          fingerprintBefore,
          fingerprintAfter,
          lockPresent: reconciliationLockPresent
        },
        runtimeMs: elapsedMs
      },
      "Phase 3A stress proof summary."
    );
  } finally {
    await safeDisconnectRedis(redis);
    await pool.end();
  }
};

main().catch((error) => {
  logger.error({ err: error, runId: RUN_ID }, "stress-phase3a failed");
  process.exit(1);
});
