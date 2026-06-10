import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { pino } from "pino";

import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { MultiLegInternalNettingEngine } from "../../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import { createPerformanceGuardrailConfig } from "../../src/guardrails/guardrail-config.js";
import { GuardrailEvaluator } from "../../src/guardrails/guardrail-evaluator.js";
import { DegradationManager } from "../../src/guardrails/degradation-manager.js";
import type {
  CandidateScore,
  CanonicalRFQInput,
  ExecutionPlan,
  RouteCandidate,
  SelectedQuoteInput
} from "../../src/core/sor/types.js";
import type { MultiLegInternalNettingInput } from "../../src/core/combo-engine/types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);
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
        if (code === "42P07" || code === "42710" || code === "42701" || code === "42P06" || code === "42723") {
          continue;
        }
        throw error;
      }
    }
  }
};

describe.skipIf(!ENV_READY)("guardrail planning integration", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM control_plane_audit_events WHERE scope_id LIKE 'guardrail-%' OR payload->>'shardId' LIKE 'guardrail-%'`
    );
    await pool.query(`DELETE FROM planner_shard_state WHERE shard_id LIKE 'guardrail-%'`);
  });

  afterAll(async () => {
    await pool.end();
  }, 180000);

  it("large bucket triggers DISABLE_PHASE2B and persists the degradation audit", async () => {
    const shardId = "guardrail-clearing-shard";
    await pool.query(
      `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
       VALUES ($1, 'FULL_MODE', 0, 0, 0, NULL)`,
      [shardId]
    );

    const candidateRegistry = {
      listBucketEntities: vi.fn(async () => ({
        entityIds: ["entity-a", "entity-b"],
        nextCursor: null
      })),
      getEntitySnapshot: vi.fn(),
      registerEntity: vi.fn(),
      unregisterEntity: vi.fn()
    };

    const planner = new ClearingRoundPlanner(
      candidateRegistry as never,
      { build: vi.fn() } as never,
      { enumerate: vi.fn() } as never,
      { score: vi.fn() } as never,
      undefined,
      undefined,
      undefined,
      createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 1,
        maxGraphEdges: 10,
        maxCandidateGroups: 10,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 10,
        degradationPolicyVersion: "degradation-v1"
      }),
      new GuardrailEvaluator(),
      new DegradationManager({ pool, logger }),
      { getReplayWriteFailures: () => 0 },
      shardId,
      logger
    );

    const result = await planner.plan("bucket-large");

    expect(result).toBeNull();
    expect(candidateRegistry.getEntitySnapshot).not.toHaveBeenCalled();

    const shardState = await pool.query<{ mode: string }>(
      `SELECT mode FROM planner_shard_state WHERE shard_id = $1`,
      [shardId]
    );
    expect(shardState.rows[0]?.mode).toBe("DISABLE_PHASE2B");

    const audit = await pool.query<{ new_mode: string; reason: string }>(
      `SELECT new_mode, reason
         FROM control_plane_audit_events
        WHERE scope_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [shardId]
    );
    expect(audit.rows[0]?.new_mode).toBe("DISABLE_PHASE2B");
    expect(audit.rows[0]?.reason).toContain("BUCKET_TOO_LARGE");
  });

  it("high planner latency triggers SOR_ONLY downgrade and follows the isolated route path", async () => {
    const shardId = "guardrail-sor-shard";
    await pool.query(
      `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
       VALUES ($1, 'FULL_MODE', 0, 0, 0, NULL)`,
      [shardId]
    );

    const rfqInput: CanonicalRFQInput = {
      rfqId: randomUUID(),
      idempotencyKey: `idem-${randomUUID()}`,
      stpMode: "CANCEL_NEWEST",
      canonicalMarketId: "market-1",
      takerId: randomUUID(),
      side: "buy",
      quantity: "10",
      metadata: {
        reservation_token: "reservation-token-1"
      }
    };
    const selectedQuote: SelectedQuoteInput = {
      quoteId: "quote-1",
      price: 1.1,
      quantity: 10,
      feeBps: 0
    };
    const candidates: RouteCandidate[] = [
      {
        id: randomUUID(),
        leg_id: randomUUID(),
        provider_type: "LP",
        provider_id: "lp-1",
        available_size: 10,
        quoted_price: 1.1,
        fees: {},
        latency_ms: 1,
        fill_prob: 0.9
      }
    ];
    const scores: CandidateScore[] = [
      {
        candidateId: candidates[0]!.id,
        providerId: "lp-1",
        effectiveUnitCost: 1.12,
        totalExpectedCost: 11.2,
        breakdown: {
          effectiveUnitCost: 1.12,
          basePrice: 1.1,
          providerFee: 0,
          protocolFee: 0,
          gasCost: 0,
          latencyPenalty: 0,
          failurePenalty: 0.02,
          resolutionRiskPenalty: 0
        }
      }
    ];
    const split = vi.fn();
    const composePlan = vi.fn(async () => ({
      id: randomUUID(),
      rfqId: rfqInput.rfqId,
      acceptancePolicy: "ALL_OR_NONE",
      steps: [],
      createdAt: new Date("2026-03-12T00:00:00.000Z")
    } satisfies ExecutionPlan));

    const router = new OrderRouter({
      routeScout: { discoverCandidates: vi.fn(async () => candidates) } as never,
      costModel: { evaluateCandidates: vi.fn(async () => scores) } as never,
      splitter: { split } as never,
      planComposer: { composePlan } as never,
      internalEngine: {
        attemptCross: vi.fn(async () => ({ filledSize: 0, remainingSize: 10, trades: [] })),
        previewCross: vi.fn(async () => ({
          fillableSize: 0,
          remainingSize: 10,
          matchedOrderIds: [],
          wouldSelfTrade: false
        }))
      },
      logger,
      internalCrossingEnabled: true,
      guardrailConfig: createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 100,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 100,
        degradationPolicyVersion: "degradation-v1"
      }),
      guardrailEvaluator: {
        evaluate: vi.fn(({ stats }) =>
          stats.candidateGroups > 0
            ? {
                violated: true,
                violations: [
                  {
                    type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
                    actual: 200,
                    threshold: 100,
                    reason: "planner latency exceeded budget"
                  }
                ],
                suggestedDegradation: "SOR_ONLY"
              }
            : { violated: false, violations: [] }
        )
      } as never,
      degradationManager: new DegradationManager({ pool, logger }),
      replayWriteFailureStatsSource: { getReplayWriteFailures: () => 0 },
      controlPlaneShardId: shardId
    });

    const result = await router.buildPlan(rfqInput, selectedQuote, "ALL_OR_NONE");

    expect(result.kind).toBe("plan_created");
    expect(split).not.toHaveBeenCalled();

    const shardState = await pool.query<{ mode: string }>(
      `SELECT mode FROM planner_shard_state WHERE shard_id = $1`,
      [shardId]
    );
    expect(shardState.rows[0]?.mode).toBe("SOR_ONLY");

    const audit = await pool.query<{ new_mode: string; reason: string }>(
      `SELECT new_mode, reason
         FROM control_plane_audit_events
        WHERE scope_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [shardId]
    );
    expect(audit.rows[0]?.new_mode).toBe("SOR_ONLY");
    expect(audit.rows[0]?.reason).toContain("PLANNER_LATENCY_BUDGET_EXCEEDED");
  });

  it("replay write failure threshold triggers SAFE_FALLBACK and skips Phase 2A before mutation", async () => {
    const shardId = "guardrail-netting-shard";
    await pool.query(
      `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
       VALUES ($1, 'FULL_MODE', 0, 0, 0, NULL)`,
      [shardId]
    );

    const candidateRegistry = {
      findCandidateCombos: vi.fn(async () => ["candidate"]),
      registerComboCandidate: vi.fn(),
      unregisterComboCandidate: vi.fn()
    };
    const resourceLocker = {
      acquireLocks: vi.fn(),
      releaseLocks: vi.fn(),
      comboLockId: vi.fn((comboId: string) => `lock:combo:${comboId}`),
      comboLegLockId: vi.fn((legId: string) => `lock:combo-leg:${legId}`)
    };

    const engine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry as never,
      { evaluate: vi.fn() } as never,
      resourceLocker as never,
      logger,
      undefined,
      undefined,
      undefined,
      createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 100,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 1,
        degradationPolicyVersion: "degradation-v1"
      }),
      new GuardrailEvaluator(),
      new DegradationManager({ pool, logger }),
      { getReplayWriteFailures: () => 2 },
      undefined,
      shardId
    );

    const incomingCombo = {
      id: "incoming-combo",
      userId: "user-a",
      state: "OPEN",
      legs: [
        {
          id: "leg-1",
          canonicalMarketId: "m1",
          canonicalOutcomeId: "o1",
          side: "buy",
          remainingSize: "10",
          priceHint: "0.6"
        }
      ]
    } satisfies MultiLegInternalNettingInput;

    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId !== "incoming-combo") {
        throw new Error(`unexpected_combo:${String(comboId)}`);
      }

      return {
        id: "incoming-combo",
        user_id: "user-a",
        state: "OPEN",
        legs: [
          {
            id: "leg-1",
            combo_rfq_id: "incoming-combo",
            canonical_market_id: "m1",
            canonical_outcome_id: "o1",
            side: "buy",
            size: "10",
            remaining_size: "10",
            price_hint: "0.6",
            metadata: null
          }
        ]
      };
    });

    const result = await engine.attemptNet(incomingCombo);

    expect(result.nettedSize).toBe("0");
    expect(result.residualRemaining).toBe(true);
    expect(resourceLocker.acquireLocks).not.toHaveBeenCalled();

    const shardState = await pool.query<{ mode: string }>(
      `SELECT mode FROM planner_shard_state WHERE shard_id = $1`,
      [shardId]
    );
    expect(shardState.rows[0]?.mode).toBe("SAFE_FALLBACK");

    const audit = await pool.query<{ new_mode: string; reason: string }>(
      `SELECT new_mode, reason
         FROM control_plane_audit_events
        WHERE scope_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [shardId]
    );
    expect(audit.rows[0]?.new_mode).toBe("SAFE_FALLBACK");
    expect(audit.rows[0]?.reason).toContain("REPLAY_WRITE_FAILURE_RATE_TOO_HIGH");
  });
});
