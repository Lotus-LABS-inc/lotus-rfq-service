import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import pino from "pino";

import { createRedisClient, connectRedis, type RedisClient } from "../../src/db/redis.js";
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
  insertCombo,
  loadResidualEntity,
  safeDisconnectRedis,
  scopeReconciliationJobToCombos
} from "../support/phase3a-proof-support.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });
const ALT_ENGINE_VERSION = "phase3a-proof-alt-v1";

interface TaggedReplayEnvelopeRow {
  id: string;
  decision_type: string;
  entity_id: string;
}

describe.skipIf(!ENV_READY)("phase3a rollout validation integration", () => {
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
      max: 8,
      min: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
      query_timeout: 20_000,
      application_name: "phase3a-rollout-validation"
    });
    pool.on("error", (error) => {
      logger.warn({ err: error }, "Ignoring transient pool error in phase3a rollout validation integration.");
    });

    redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger });
    await connectRedis(must(redis, "redis"));
    await applyMigrations(must(pool, "pool"));
  }, 180000);

  afterAll(async () => {
    if (redis) {
      await safeDisconnectRedis(redis);
    }
    if (pool) {
      await pool.end();
    }
  }, 180000);

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
                  ? [...selectedPlan.participantLockOrder as string[]].reverse()
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
        discoverCandidates: vi.fn(async (rfq: CanonicalRFQInput) => buildRouteCandidates(rfq.rfqId))
      } as never,
      costModel: new CostModel(),
      splitter: new Splitter(),
      planComposer: new PlanComposer({
        pool: db,
        logger,
        now: () => new Date("2026-03-12T00:00:00.000Z")
      }),
      internalEngine: {
        attemptCross: vi.fn(async (order: { remaining_size: string }) => ({
          filledSize: 0,
          remainingSize: Number.parseFloat(order.remaining_size),
          trades: []
        })),
        previewCross: vi.fn(async (order: { remaining_size: string }) => ({
          fillableSize: 0,
          remainingSize: Number.parseFloat(order.remaining_size),
          matchedOrderIds: [],
          wouldSelfTrade: false
        }))
      },
      logger,
      ...(options?.replayDecisionCaptureService
        ? { replayDecisionCaptureService: options.replayDecisionCaptureService }
        : {}),
      ...(options?.replayDecisionCaptureService
        ? { replayCaptureConfig: buildReplayCaptureConfig(tag, "sor-plan-v1") }
        : {}),
      ...(options?.guardrailConfig ? { guardrailConfig: options.guardrailConfig } : {}),
      ...(options?.guardrailEvaluator ? { guardrailEvaluator: options.guardrailEvaluator as never } : {}),
      ...(options?.degradationManager ? { degradationManager: options.degradationManager } : {}),
      ...(options?.replayWriteFailureStatsSource
        ? { replayWriteFailureStatsSource: options.replayWriteFailureStatsSource }
        : {}),
      ...(options?.controlPlaneShardId ? { controlPlaneShardId: options.controlPlaneShardId } : {})
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

  it("captures bounded SOR, Phase 2A, and Phase 2B decisions and exact-replays them to MATCH", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const seed = "phase3a-rollout-capture";
    const runId = randomUUID();
    const tag = `phase3a-capture-${runId}`;
    const replayCaptureService = createReplayCaptureService(db);
    const replayAdminService = createReplayAdminService(db);
    const orderRouter = createOrderRouter(db, tag, { replayDecisionCaptureService: replayCaptureService });
    const nettingBundle = createNettingBundle(db, redisClient, tag, {
      replayDecisionCaptureService: replayCaptureService
    });
    const phase2bBundle = createPhase2BBundle(db, redisClient, tag, {
      replayDecisionCaptureService: replayCaptureService
    });

    const sorRuns = Array.from({ length: 2 }, (_, index) => {
      const inputs = buildSORInputs(`${tag}-sor-${index}`);
      return orderRouter.buildPlan(inputs.rfq, inputs.selectedQuote, inputs.policy);
    });
    const nettingRuns = Array.from({ length: 2 }, async (_, index) => {
      const incoming = await seedNettingPair(db, nettingBundle.candidateRegistry, seed, runId, `capture-netting-${index}`);
      return nettingBundle.engine.attemptNet(incoming);
    });
    const clearingRuns = Array.from({ length: 2 }, async (_, index) => {
      const seeded = await seedClearingCycle(
        db,
        phase2bBundle.residualVectorBuilder,
        phase2bBundle.registry,
        seed,
        runId,
        `capture-clearing-${index}`
      );
      return phase2bBundle.planner.plan(seeded.bucketId, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });
    });

    await Promise.all([...sorRuns, ...nettingRuns, ...clearingRuns]);

    const envelopes = await loadTaggedReplayEnvelopes(db, tag);
    expect(envelopes).toHaveLength(6);

    const exactResults = await Promise.all(
      envelopes.map((envelope) => replayAdminService.runExactReplay({
        envelopeId: envelope.id,
        requestedBy: "phase3a-rollout-validation"
      }))
    );

    expect(exactResults.every((result) => result.status === "MATCH")).toBe(true);
    expect(new Set(envelopes.map((row) => row.decision_type))).toEqual(
      new Set(["SOR_PLAN", "NETTING_PHASE2A", "CLEARING_PHASE2B"])
    );
  }, 240000);

  it("returns bounded alternate-version diffs for SOR, Phase 2A, and Phase 2B without replay errors", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const seed = "phase3a-rollout-diff";
    const runId = randomUUID();
    const tag = `phase3a-diff-${runId}`;
    const replayCaptureService = createReplayCaptureService(db);
    const replayAdminService = createReplayAdminService(db);
    const orderRouter = createOrderRouter(db, tag, { replayDecisionCaptureService: replayCaptureService });
    const nettingBundle = createNettingBundle(db, redisClient, tag, {
      replayDecisionCaptureService: replayCaptureService
    });
    const phase2bBundle = createPhase2BBundle(db, redisClient, tag, {
      replayDecisionCaptureService: replayCaptureService
    });

    const sorInputs = buildSORInputs(`${tag}-sor`);
    await orderRouter.buildPlan(sorInputs.rfq, sorInputs.selectedQuote, sorInputs.policy);
    const incoming = await seedNettingPair(db, nettingBundle.candidateRegistry, seed, runId, "diff-netting");
    await nettingBundle.engine.attemptNet(incoming);
    const seeded = await seedClearingCycle(
      db,
      phase2bBundle.residualVectorBuilder,
      phase2bBundle.registry,
      seed,
      runId,
      "diff-clearing"
    );
    await phase2bBundle.planner.plan(seeded.bucketId, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });

    const envelopes = await loadTaggedReplayEnvelopes(db, tag);
    expect(envelopes).toHaveLength(3);

    const diffResults = await Promise.all(
      envelopes.map((envelope) =>
        replayAdminService.runDiffReplay({
          envelopeId: envelope.id,
          requestedBy: "phase3a-rollout-validation",
          engineVersion: ALT_ENGINE_VERSION
        })
      )
    );

    expect(diffResults.every((result) => result.status !== "ERROR")).toBe(true);

    const byType = new Map(envelopes.map((envelope, index) => [envelope.decision_type, diffResults[index]!]));
    expect(byType.get("SOR_PLAN")?.status).toBe("DIFF");
    expect((byType.get("SOR_PLAN")?.diffSummary?.changedRouteChoices.length ?? 0)).toBeGreaterThan(0);
    expect(byType.get("NETTING_PHASE2A")?.status).toBe("DIFF");
    expect((byType.get("NETTING_PHASE2A")?.diffSummary?.fieldDiffs.length ?? 0)).toBeGreaterThan(0);
    expect(byType.get("CLEARING_PHASE2B")?.status).toBe("DIFF");
    expect(
      (byType.get("CLEARING_PHASE2B")?.diffSummary?.changedRanking.length ?? 0) +
      (byType.get("CLEARING_PHASE2B")?.diffSummary?.changedClearingSelection.length ?? 0)
    ).toBeGreaterThan(0);
  }, 240000);

  it("persists valid guardrail degradations and keeps concurrent control-plane mutations consistent", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const runTag = `phase3a-guardrail-${randomUUID()}`;
    const degradationManager = new DegradationManager({ pool: db, logger });
    const controlPlaneAdminService = new ControlPlaneAdminService({ pool: db, logger });

    const sorShardId = `${runTag}-sor-shard`;
    const nettingShardId = `${runTag}-netting-shard`;
    const clearingShardId = `${runTag}-clearing-shard`;
    const adminShardId = `${runTag}-admin-shard`;
    const adminBucketIds = [`${runTag}-bucket-a`, `${runTag}-bucket-b`];

    await db.query(
      `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
       VALUES
         ($1, 'FULL_MODE', 0, 0, 0, NULL),
         ($2, 'FULL_MODE', 0, 0, 0, NULL),
         ($3, 'FULL_MODE', 0, 0, 0, NULL),
         ($4, 'FULL_MODE', 0, 0, 0, NULL)`,
      [sorShardId, nettingShardId, clearingShardId, adminShardId]
    );
    await db.query(
      `INSERT INTO bucket_state (bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason)
       VALUES
         ($1, 'CLEARING', 'FULL_MODE', 0, NULL, NULL),
         ($2, 'CLEARING', 'FULL_MODE', 0, NULL, NULL)`,
      adminBucketIds
    );

    const orderRouter = createOrderRouter(db, `${runTag}-sor`, {
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
        evaluate: vi.fn(({ stats }: any) =>
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
        )
      },
      degradationManager,
      replayWriteFailureStatsSource: { getReplayWriteFailures: () => 0 },
      controlPlaneShardId: sorShardId
    });
    const nettingBundle = createNettingBundle(db, redisClient, `${runTag}-netting`, {
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
    const phase2bBundle = createPhase2BBundle(db, redisClient, `${runTag}-clearing`, {
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

    const sorInputs = buildSORInputs(`${runTag}-sor`);
    await orderRouter.buildPlan(sorInputs.rfq, sorInputs.selectedQuote, sorInputs.policy);
    const incoming = await seedNettingPair(db, nettingBundle.candidateRegistry, runTag, runTag, "guardrail-netting");
    await nettingBundle.engine.attemptNet(incoming);
    const seeded = await seedClearingCycle(
      db,
      phase2bBundle.residualVectorBuilder,
      phase2bBundle.registry,
      runTag,
      runTag,
      "guardrail-clearing"
    );
    await phase2bBundle.planner.plan(seeded.bucketId, { bucketWindowLimit: 10, maxParticipants: 4, maxUniqueLegs: 6 });

    const adminOps = Array.from({ length: 12 }, (_, index) => {
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

    const shardModes = await db.query<{ shard_id: string; mode: string }>(
      `SELECT shard_id, mode
         FROM planner_shard_state
        WHERE shard_id = ANY($1::text[])
        ORDER BY shard_id ASC`,
      [[sorShardId, nettingShardId, clearingShardId, adminShardId]]
    );
    expect(new Map(shardModes.rows.map((row) => [row.shard_id, row.mode]))).toEqual(new Map([
      [adminShardId, "PAUSED"],
      [clearingShardId, "DISABLE_PHASE2B"],
      [nettingShardId, "SAFE_FALLBACK"],
      [sorShardId, "SOR_ONLY"]
    ]));

    const noOpAudits = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM control_plane_audit_events
        WHERE event_type = 'execution_mode_changed'
          AND scope_id = ANY($1::text[])
          AND previous_mode = new_mode`,
      [[sorShardId, nettingShardId, clearingShardId]]
    );
    expect(Number(noOpAudits.rows[0]?.count ?? "0")).toBe(0);

    const overrides = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM control_plane_overrides
        WHERE created_by = $1`,
      [`${runTag}-ops`]
    );
    expect(Number(overrides.rows[0]?.count ?? "0")).toBe(3);

    const bucketModes = await db.query<{ bucket_id: string; mode: string }>(
      `SELECT bucket_id, mode
         FROM bucket_state
        WHERE bucket_id = ANY($1::text[])`,
      [adminBucketIds]
    );
    expect(bucketModes.rows).toHaveLength(2);
    expect(bucketModes.rows.every((row) => row.mode === "PAUSED" || row.mode === "DRAINING")).toBe(true);
  }, 240000);

  it("reconciles Redis drift without mutating scoped authoritative Postgres truth", async () => {
    const db = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const seed = "phase3a-rollout-reconciliation";
    const runId = randomUUID();
    const comboNettingRegistry = new ComboNettingCandidateRegistry(redisClient as never);
    const phase2bRegistry = new Phase2BCandidateRegistry(redisClient as never);
    const residualVectorBuilder = new ResidualVectorBuilder();

    await redisClient.del("phase3a:reconciliation_v2:lock");

    const nettingIncoming = await seedNettingPair(db, comboNettingRegistry, seed, runId, "recon-netting");
    await comboNettingRegistry.registerComboCandidate({
      id: nettingIncoming.id,
      legs: nettingIncoming.legs.map((leg) => ({
        id: leg.id,
        marketId: leg.canonicalMarketId,
        outcomeId: leg.canonicalOutcomeId,
        side: leg.side
      }))
    });
    const clearingSeed = await seedClearingCycle(
      db,
      residualVectorBuilder,
      phase2bRegistry,
      seed,
      runId,
      "recon-clearing"
    );
    const scopedComboIds = [nettingIncoming.id, ...clearingSeed.comboIds];
    const fingerprintBefore = await computeScopedComboFingerprint(db, scopedComboIds);

    await comboNettingRegistry.unregisterComboCandidate(nettingIncoming.id);
    await phase2bRegistry.unregisterEntity(clearingSeed.comboIds[0]!, clearingSeed.bucketId);

    const job = new ReconciliationV2Job({
      pool: db,
      redis: redisClient,
      logger,
      resolutionRiskAdminService: {
        getCanonicalInspection: vi.fn(async () => ({
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
        }))
      } as never,
      orderBook: new OrderBook(redisClient),
      comboNettingCandidateRegistry: comboNettingRegistry,
      phase2bCandidateRegistry: phase2bRegistry,
      residualVectorBuilder
    });
    scopeReconciliationJobToCombos(job, db, scopedComboIds);

    const dryRun = await job.run({
      batchSize: 25,
      dryRun: true,
      autoFix: false,
      domains: ["netting_phase2a", "clearing_phase2b"]
    });
    expect(dryRun.discrepancyCount).toBeGreaterThanOrEqual(2);
    const dryRunCodes = new Set(dryRun.discrepancies.map((item) => item.code));
    expect(dryRunCodes.has("COMBO_NET_REGISTRY_MISSING")).toBe(true);
    expect(dryRunCodes.has("CLEARING_REGISTRY_MISSING")).toBe(true);

    const autoFix = await job.run({
      batchSize: 25,
      dryRun: false,
      autoFix: true,
      domains: ["netting_phase2a", "clearing_phase2b"]
    });
    expect(autoFix.discrepancies.every((item) => item.fixApplied === true)).toBe(true);

    const rerun = await job.run({
      batchSize: 25,
      dryRun: true,
      autoFix: false,
      domains: ["netting_phase2a", "clearing_phase2b"]
    });
    expect(rerun.discrepancyCount).toBe(0);

    const fingerprintAfter = await computeScopedComboFingerprint(db, scopedComboIds);
    expect(fingerprintAfter).toBe(fingerprintBefore);
    expect(await redisClient.get("phase3a:reconciliation_v2:lock")).toBeNull();

    const reverseKey = comboNettingRegistry.comboLegsKey(nettingIncoming.id);
    expect((await redisClient.smembers?.(reverseKey)) ?? []).not.toHaveLength(0);
    expect(await phase2bRegistry.getEntitySnapshot(clearingSeed.comboIds[0]!)).not.toBeNull();
  }, 600000);
});
