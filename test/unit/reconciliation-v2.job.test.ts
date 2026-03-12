import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  metricsRegistry,
  reconciliationV2InfraErrorTotal,
  reconciliationV2LockConflictTotal,
} from "../../src/observability/metrics.js";
import {
  ReconciliationV2InfraError,
  ReconciliationV2Job,
  ReconciliationV2LockConflictError,
} from "../../src/jobs/reconciliation-v2.job.js";

const makeJob = (overrides: {
  queryImpl?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
  getOrderSnapshot?: (orderId: string) => Promise<{ raw: unknown | null }>;
  addOrder?: (order: unknown) => Promise<void>;
  removeOrder?: (orderId: string) => Promise<void>;
  getCanonicalInspection?: (eventId: string) => Promise<{
    freshness: { isComplete: boolean; isStale: boolean; hasMixedVersions: boolean };
    scoringVersion: string;
  }>;
  redis?: Partial<{
    set: (...args: unknown[]) => Promise<unknown>;
    eval: (...args: unknown[]) => Promise<unknown>;
    get: (...args: unknown[]) => Promise<unknown>;
    smembers: (...args: unknown[]) => Promise<unknown>;
    scan: (...args: unknown[]) => Promise<unknown>;
    del: (...args: unknown[]) => Promise<unknown>;
  }>;
} = {}) => {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (overrides.queryImpl) {
      return overrides.queryImpl(sql, params);
    }
    return { rows: [], rowCount: 0 };
  });
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const redis = {
    get: overrides.redis?.get ?? vi.fn(async () => null),
    smembers: overrides.redis?.smembers ?? vi.fn(async () => []),
    scan: overrides.redis?.scan ?? vi.fn(async () => ["0", []]),
    set: overrides.redis?.set ?? vi.fn(async () => "OK"),
    eval: overrides.redis?.eval ?? vi.fn(async () => 1),
    del: overrides.redis?.del ?? vi.fn(async () => 1),
  };

  const job = new ReconciliationV2Job({
    pool: { query } as never,
    redis: redis as never,
    logger,
    resolutionRiskAdminService: {
      getCanonicalInspection:
        overrides.getCanonicalInspection ??
        vi.fn(async () => ({
          freshness: { isComplete: true, isStale: false, hasMixedVersions: false },
          scoringVersion: "resolution-risk-v1",
        })),
    } as never,
    orderBook: {
      getOrderSnapshot: overrides.getOrderSnapshot ?? vi.fn(async () => ({ raw: null })),
      addOrder: overrides.addOrder ?? vi.fn(async () => undefined),
      removeOrder: overrides.removeOrder ?? vi.fn(async () => undefined),
    } as never,
    comboNettingCandidateRegistry: {
      comboLegsKey: vi.fn((comboId: string) => `combo_net:combo:${comboId}:legs`),
      registerComboCandidate: vi.fn(async () => undefined),
    } as never,
    phase2bCandidateRegistry: {
      getEntitySnapshot: vi.fn(async () => null),
      registerEntity: vi.fn(async () => undefined),
    } as never,
    residualVectorBuilder: {
      build: vi.fn(),
    } as never,
  });

  return { job, query, logger, redis };
};

describe("ReconciliationV2Job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsRegistry.resetMetrics();
  });

  it("emits REPLAY_ENVELOPE_MISSING for routing plans without replay envelopes", async () => {
    const { job } = makeJob({
      queryImpl: async (sql, params) => {
        if (sql.includes("FROM routing_plans")) {
          return { rows: [{ id: "plan-1", rfq_id: "rfq-1" }], rowCount: 1 };
        }
        if (sql.includes("decision_type = 'SOR_PLAN'")) {
          expect(params).toEqual(["rfq-1"]);
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const result = await job.run({ batchSize: 100, domains: ["replay"] });

    expect(result.discrepancyCount).toBe(1);
    expect(result.discrepancies[0]).toMatchObject({
      domain: "replay",
      code: "REPLAY_ENVELOPE_MISSING",
      entityId: "rfq-1",
    });
  });

  it("reports stale and mixed resolution-risk freshness from admin inspection", async () => {
    const getCanonicalInspection = vi.fn(async () => ({
      freshness: { isComplete: false, isStale: true, hasMixedVersions: true },
      scoringVersion: "mixed",
    }));
    const { job } = makeJob({
      getCanonicalInspection,
      queryImpl: async (sql) => {
        if (sql.includes("FROM resolution_profiles")) {
          return { rows: [{ canonical_event_id: "event-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const result = await job.run({ batchSize: 100, domains: ["resolution_risk"] });

    expect(result.discrepancies.map((item) => item.code)).toEqual([
      "RESOLUTION_RISK_INCOMPLETE",
      "RESOLUTION_RISK_STALE",
      "RESOLUTION_RISK_MIXED_VERSIONS",
    ]);
    expect(getCanonicalInspection).toHaveBeenCalledWith("event-1");
  });

  it("does not mutate Redis-backed indexes in dryRun mode", async () => {
    const addOrder = vi.fn(async () => undefined);
    const { job } = makeJob({
      addOrder,
      queryImpl: async (sql) => {
        if (sql.includes("FROM trades")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM internal_orders")) {
          return {
            rows: [
              {
                id: "order-1",
                market_id: "market-1",
                user_id: "user-1",
                side: "buy",
                price: "0.5",
                initial_size: "10",
                remaining_size: "10",
                status: "OPEN",
                resolution_profile_id: null,
                created_at: new Date("2026-03-12T00:00:00.000Z"),
                updated_at: new Date("2026-03-12T00:00:00.000Z"),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
      getOrderSnapshot: vi.fn(async () => ({ raw: null })),
    });

    const result = await job.run({ batchSize: 100, domains: ["internal_cross"], dryRun: true, autoFix: true });

    expect(result.discrepancyCount).toBe(1);
    expect(addOrder).not.toHaveBeenCalled();
    expect(result.discrepancies[0]?.fixApplied).toBe(false);
  });

  it("respects domain filtering and only runs requested scans", async () => {
    const { job, query } = makeJob({
      queryImpl: async (sql) => {
        if (sql.includes("FROM routing_plans")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await job.run({ batchSize: 100, domains: ["replay"] });

    const executedSql = query.mock.calls.map(([sql]) => String(sql));
    expect(executedSql.some((sql) => sql.includes("FROM routing_plans"))).toBe(true);
    expect(executedSql.some((sql) => sql.includes("FROM internal_orders"))).toBe(false);
    expect(executedSql.some((sql) => sql.includes("FROM resolution_profiles"))).toBe(false);
  });

  it("throws a typed error and increments metrics on lock conflict", async () => {
    const { job } = makeJob({
      redis: {
        set: vi.fn(async () => null),
      },
    });

    await expect(job.run({ batchSize: 10, domains: ["replay"] })).rejects.toBeInstanceOf(ReconciliationV2LockConflictError);

    const metric = await reconciliationV2LockConflictTotal.get();
    expect(metric.values[0]?.value).toBe(1);
  });

  it("surfaces Redis scan failures as infrastructure errors and aborts the run", async () => {
    const { job } = makeJob({
      queryImpl: async (sql) => {
        if (sql.includes("reservation_token IS NOT NULL")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      redis: {
        scan: vi.fn(async () => {
          throw new Error("Connection is closed");
        }),
      },
    });

    await expect(job.run({ batchSize: 5, domains: ["reservation"] })).rejects.toEqual(
      expect.objectContaining({
        domain: "reservation",
        operation: "reservation_lock_scan",
      }),
    );

    const metric = await reconciliationV2InfraErrorTotal.get();
    const scanValue = metric.values.find((entry) => entry.labels.domain === "reservation" && entry.labels.operation === "reservation_lock_scan");
    expect(scanValue?.value).toBe(1);
  });

  it("aborts immediately on pool failures and does not continue into later domains", async () => {
    const { job, query } = makeJob({
      queryImpl: async (sql) => {
        if (sql.includes("FROM routing_plans")) {
          throw new Error("db unavailable");
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await expect(job.run({ batchSize: 10, domains: ["replay", "resolution_risk"] })).rejects.toBeInstanceOf(ReconciliationV2InfraError);

    const executedSql = query.mock.calls.map(([sql]) => String(sql));
    expect(executedSql.some((sql) => sql.includes("FROM routing_plans"))).toBe(true);
    expect(executedSql.some((sql) => sql.includes("FROM resolution_profiles"))).toBe(false);
  });

  it("passes batchSize through to paginated database queries and Redis scans", async () => {
    const { job, query, redis } = makeJob({
      queryImpl: async (sql) => {
        if (sql.includes("FROM trades")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM internal_orders")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("reservation_token IS NOT NULL")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    await job.run({ batchSize: 7, domains: ["internal_cross", "reservation"] });

    const internalOrdersCall = query.mock.calls.find(([sql]) => String(sql).includes("FROM internal_orders"));
    expect(internalOrdersCall?.[1]).toEqual([null, 7]);
    expect(redis.scan).toHaveBeenCalledWith("0", "MATCH", "risk:lock:exec:*", "COUNT", 7);
  });
});
