import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import Decimal from "decimal.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { pino } from "pino";

import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiLegInternalNettingEngine } from "../../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import type { MultiLegInternalNettingInput } from "../../src/core/combo-engine/types.js";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import type {
  CandidateScore,
  CanonicalRFQInput,
  ExecutionPlan,
  RouteCandidate,
  SelectedQuoteInput,
} from "../../src/core/sor/types.js";
import { createPerformanceGuardrailConfig } from "../../src/guardrails/guardrail-config.js";
import { DegradationManager } from "../../src/guardrails/degradation-manager.js";
import { Phase3AGuardrailShadowResolver } from "../../src/guardrails/phase3a-guardrail-shadow.js";
import {
  metricsRegistry,
  phase3aGuardrailShadowResolutionTotal,
  phase3aGuardrailShadowTotal,
} from "../../src/observability/metrics.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);
const logger = pino({ level: "silent" });

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

describe.skipIf(!ENV_READY)("Phase 3A guardrail shadow integration", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  beforeEach(async () => {
    metricsRegistry.resetMetrics();
    await pool.query(
      `DELETE FROM control_plane_audit_events WHERE scope_id LIKE 'shadow-%' OR payload->>'shardId' LIKE 'shadow-%'`
    );
    await pool.query(`DELETE FROM planner_shard_state WHERE shard_id LIKE 'shadow-%'`);
    await pool.query(`DELETE FROM bucket_state WHERE bucket_id LIKE 'shadow-%'`);
  });

  afterAll(async () => {
    await pool.end();
  }, 180000);

  it("keeps planner shard, bucket, and audit state unchanged while shadow evaluates SOR, Phase 2A, and Phase 2B", async () => {
    const resolver = new Phase3AGuardrailShadowResolver({
      pool,
      config: {
        enabled: true,
        percent: 1,
        startAt: "2026-03-12T00:00:00.000Z",
        endAt: "2026-03-13T00:00:00.000Z",
      },
    });
    const degradationManager = new DegradationManager({ pool, logger });
    const guardrailConfig = createPerformanceGuardrailConfig({
      version: "shadow-guardrails-v1",
      maxSorPlanningLatencyMs: 1,
      maxNettingPlanningLatencyMs: 1,
      maxClearingPlanningLatencyMs: 1,
      maxBucketEntityCount: 1,
      maxGraphEdges: 1,
      maxCandidateGroups: 1,
      maxLockWaitMs: 1,
      maxLockHoldMs: 1,
      maxReplayWriteFailuresBeforeDegrade: 1,
      degradationPolicyVersion: "shadow-policy-v1",
    });

    await pool.query(
      `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
       VALUES
         ('shadow-sor-main', 'FULL_MODE', 0, 0, 0, NULL),
         ('shadow-netting-main', 'FULL_MODE', 0, 0, 0, NULL),
         ('shadow-clearing-main', 'FULL_MODE', 0, 0, 0, NULL)`
    );
    await pool.query(
      `INSERT INTO bucket_state (bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason)
       VALUES ('shadow-bucket-1', 'CLEARING', 'NORMAL', 2, '0.10', NULL)`
    );

    const beforeShardModes = await pool.query<{ shard_id: string; mode: string }>(
      `SELECT shard_id, mode
         FROM planner_shard_state
        WHERE shard_id LIKE 'shadow-%'
        ORDER BY shard_id ASC`
    );
    const beforeBucketState = await pool.query<{ mode: string; entity_count: number; graph_density: string | null }>(
      `SELECT mode, entity_count, graph_density
         FROM bucket_state
        WHERE bucket_id = 'shadow-bucket-1'`
    );

    const rfqInput: CanonicalRFQInput = {
      rfqId: randomUUID(),
      idempotencyKey: `idem-${randomUUID()}`,
      stpMode: "CANCEL_NEWEST",
      canonicalMarketId: "shadow-market-1",
      takerId: randomUUID(),
      side: "buy",
      quantity: "10",
      metadata: {
        reservation_token: "shadow-reservation-token",
      },
    };
    const selectedQuote: SelectedQuoteInput = {
      quoteId: "shadow-quote-1",
      price: 1.1,
      quantity: 10,
      feeBps: 0,
    };
    const sorCandidates: RouteCandidate[] = [
      {
        id: randomUUID(),
        leg_id: randomUUID(),
        provider_type: "LP",
        provider_id: "lp-1",
        available_size: 10,
        quoted_price: 1.1,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.95,
      },
      {
        id: randomUUID(),
        leg_id: randomUUID(),
        provider_type: "VENUE",
        provider_id: "venue-2",
        available_size: 10,
        quoted_price: 1.12,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.95,
      },
    ];
    const sorScores: CandidateScore[] = sorCandidates.map((candidate, index) => ({
      candidateId: candidate.id,
      providerId: candidate.provider_id,
      effectiveUnitCost: index === 0 ? 1.1 : 1.12,
      totalExpectedCost: index === 0 ? 11 : 11.2,
      breakdown: {
        effectiveUnitCost: index === 0 ? 1.1 : 1.12,
        basePrice: index === 0 ? 1.1 : 1.12,
        providerFee: 0,
        protocolFee: 0,
        gasCost: 0,
        latencyPenalty: 0,
        failurePenalty: 0,
        resolutionRiskPenalty: 0,
      },
    }));

    const router = new OrderRouter({
      routeScout: { discoverCandidates: vi.fn(async () => sorCandidates) } as never,
      costModel: { evaluateCandidates: vi.fn(async () => sorScores) } as never,
      splitter: {
        split: vi.fn(async () => [
          {
            candidateId: sorCandidates[0]!.id,
            providerId: sorCandidates[0]!.provider_id,
            targetSize: 10,
            roundedSize: 10,
            targetPrice: 1.1,
          },
        ]),
      } as never,
      planComposer: {
        composePlan: vi.fn(async () =>
          ({
            id: randomUUID(),
            rfqId: rfqInput.rfqId,
            acceptancePolicy: "ALL_OR_NONE",
            steps: [],
            createdAt: new Date("2026-03-12T00:00:00.000Z"),
          }) satisfies ExecutionPlan
        ),
      } as never,
      internalEngine: {
        attemptCross: vi.fn(async () => ({ filledSize: 0, remainingSize: 10, trades: [] })),
        previewCross: vi.fn(async () => ({ fillableSize: 0, remainingSize: 10, matchedOrderIds: [], wouldSelfTrade: false })),
      },
      logger,
      internalCrossingEnabled: true,
      guardrailConfig,
      guardrailEvaluator: {
        evaluate: vi.fn(() => ({
          violated: true,
          violations: [
            {
              type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
              actual: 5,
              threshold: 1,
              reason: "planner latency exceeded budget",
            },
          ],
          suggestedDegradation: "SOR_ONLY",
        })),
      } as never,
      degradationManager,
      replayWriteFailureStatsSource: { getReplayWriteFailures: () => 0 },
      controlPlaneShardId: "shadow-sor-main",
      phase3AGuardrailShadowResolver: resolver,
    });

    const sorResult = await router.buildPlan(rfqInput, selectedQuote, "ALL_OR_NONE");
    expect(sorResult.kind).toBe("plan_created");

    const candidateRegistry = {
      findCandidateCombos: vi.fn(async () => ["candidate"]),
      registerComboCandidate: vi.fn(),
      unregisterComboCandidate: vi.fn(),
    };
    const compatibilityEngine = {
      evaluate: vi.fn(() => ({
        compatible: true,
        matchedLegPairs: [
          {
            incomingLegId: "in-leg-1",
            candidateLegId: "cand-leg-1",
            marketId: "shadow-market-1",
            outcomeId: "shadow-outcome-1",
            matchedSize: "5",
          },
        ],
        maxNettableSize: "5",
      })),
    };
    const resourceLocker = {
      acquireLocks: vi.fn(async () => ({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" })),
      releaseLocks: vi.fn(async () => undefined),
      comboLockId: vi.fn((comboId: string) => `lock:combo:${comboId}`),
      comboLegLockId: vi.fn((legId: string) => `lock:combo-leg:${legId}`),
    };
    const nettingEngine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry as never,
      compatibilityEngine as never,
      resourceLocker as never,
      logger,
      undefined,
      undefined,
      undefined,
      guardrailConfig,
      {
        evaluate: vi.fn(() => ({
          violated: true,
          violations: [
            {
              type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
              actual: 5,
              threshold: 1,
              reason: "planner latency exceeded budget",
            },
          ],
          suggestedDegradation: "DISABLE_PHASE2A_AND_2B",
        })),
      } as never,
      degradationManager,
      { getReplayWriteFailures: () => 0 },
      { getCurrentLockWaitMs: () => 0 },
      "shadow-netting-main",
      undefined,
      resolver
    );

    const incomingCombo = {
      id: "incoming",
      userId: "user-a",
      state: "OPEN",
      legs: [
        {
          id: "in-leg-1",
          canonicalMarketId: "shadow-market-1",
          canonicalOutcomeId: "shadow-outcome-1",
          side: "buy",
          remainingSize: "10",
          priceHint: "0.6",
        },
      ],
    } satisfies MultiLegInternalNettingInput;
    vi.spyOn(nettingEngine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId === "incoming") {
        return {
          id: "incoming",
          user_id: "user-a",
          state: "OPEN",
          legs: [
            {
              id: "in-leg-1",
              combo_rfq_id: "incoming",
              canonical_market_id: "shadow-market-1",
              canonical_outcome_id: "shadow-outcome-1",
              side: "buy",
              size: "10",
              remaining_size: "10",
              price_hint: "0.6",
              metadata: null,
            },
          ],
        };
      }

      if (comboId === "candidate") {
        return {
          id: "candidate",
          user_id: "user-b",
          state: "OPEN",
          legs: [
            {
              id: "cand-leg-1",
              combo_rfq_id: "candidate",
              canonical_market_id: "shadow-market-1",
              canonical_outcome_id: "shadow-outcome-1",
              side: "sell",
              size: "5",
              remaining_size: "5",
              price_hint: "0.55",
              metadata: null,
            },
          ],
        };
      }

      return null;
    });
    vi.spyOn(nettingEngine as never, "executeNettingTransaction").mockResolvedValue({
      nettingGroupId: "group-1",
      nettedSize: new Decimal(5),
      eventsWritten: 1,
      incomingResidualLegs: [],
      exhaustedComboIds: [],
    });

    const nettingResult = await nettingEngine.attemptNet(incomingCombo);
    expect(nettingResult.nettedSize).toBe("5");

    const planner = new ClearingRoundPlanner(
      {
        registerEntity: vi.fn(),
        unregisterEntity: vi.fn(),
        listBucketEntities: vi.fn(async () => ({
          entityIds: ["entity-a", "entity-b"],
          nextCursor: null,
        })),
        getEntitySnapshot: vi
          .fn()
          .mockResolvedValueOnce({
            entityId: "entity-a",
            userId: "user-a",
            compatibilityBucket: "shadow-bucket",
            vector: { "shadow-market-1:shadow-outcome-1": "2" },
            legCount: 1,
            grossAbsSize: "2",
            registeredAt: "2026-03-12T00:00:00.000Z",
          })
          .mockResolvedValueOnce({
            entityId: "entity-b",
            userId: "user-b",
            compatibilityBucket: "shadow-bucket",
            vector: { "shadow-market-1:shadow-outcome-1": "-2" },
            legCount: 1,
            grossAbsSize: "2",
            registeredAt: "2026-03-12T00:00:01.000Z",
          }),
      } as never,
      { build: vi.fn(() => ({ nodes: [], edges: [] })) } as never,
      {
        enumerate: vi.fn(() => [
          {
            participantIds: ["entity-a", "entity-b"],
            uniqueLegs: ["shadow-market-1:shadow-outcome-1"],
            estimatedCompressionScore: "1",
            residualAfterNetting: [],
            exactnessScore: "1",
          },
        ]),
      } as never,
      {
        score: vi.fn(() => ({
          compressionScore: "4",
          preNetAbsExposure: "4",
          postNetAbsResidual: "0",
          residualVectorByParticipant: {},
          rankingPenalty: "1",
          finalScore: "3",
          tieBreak: {
            smallestResidual: "0",
            oldestParticipantAt: "2026-03-12T00:00:00.000Z",
            participantCount: 2,
          },
        })),
      } as never,
      undefined,
      undefined,
      undefined,
      guardrailConfig,
      {
        evaluate: vi.fn(() => ({
          violated: true,
          violations: [
            {
              type: "BUCKET_TOO_LARGE",
              actual: 2,
              threshold: 1,
              reason: "bucket entity count exceeded threshold",
            },
          ],
          suggestedDegradation: "DISABLE_PHASE2B",
        })),
      } as never,
      degradationManager,
      { getReplayWriteFailures: vi.fn().mockResolvedValue(0) },
      "shadow-clearing-main",
      logger,
      undefined,
      resolver
    );

    const clearingPlan = await planner.plan("shadow-bucket-1");
    expect(clearingPlan?.selectedGroup.participantIds).toEqual(["entity-a", "entity-b"]);

    const afterShardModes = await pool.query<{ shard_id: string; mode: string }>(
      `SELECT shard_id, mode
         FROM planner_shard_state
        WHERE shard_id LIKE 'shadow-%'
        ORDER BY shard_id ASC`
    );
    const afterBucketState = await pool.query<{ mode: string; entity_count: number; graph_density: string | null }>(
      `SELECT mode, entity_count, graph_density
         FROM bucket_state
        WHERE bucket_id = 'shadow-bucket-1'`
    );
    const auditEvents = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM control_plane_audit_events
        WHERE scope_id LIKE 'shadow-%' OR payload->>'shardId' LIKE 'shadow-%'`
    );

    expect(afterShardModes.rows).toEqual(beforeShardModes.rows);
    expect(afterBucketState.rows).toEqual(beforeBucketState.rows);
    expect(auditEvents.rows[0]?.count).toBe("0");

    const shadowTotalMetric = await phase3aGuardrailShadowTotal.get();
    const shadowEngines = new Set(shadowTotalMetric.values.map((value) => value.labels.engine));
    expect(shadowEngines.has("SOR")).toBe(true);
    expect(shadowEngines.has("NETTING_PHASE2A")).toBe(true);
    expect(shadowEngines.has("CLEARING_PHASE2B")).toBe(true);

    const resolutionMetric = await phase3aGuardrailShadowResolutionTotal.get();
    const resolvedEngines = new Set(resolutionMetric.values.map((value) => value.labels.engine));
    expect(resolvedEngines.has("SOR")).toBe(true);
    expect(resolvedEngines.has("NETTING_PHASE2A")).toBe(true);
    expect(resolvedEngines.has("CLEARING_PHASE2B")).toBe(true);
  }, 180000);
});
