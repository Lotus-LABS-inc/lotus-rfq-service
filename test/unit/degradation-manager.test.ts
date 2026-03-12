import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DegradationManager,
  DegradationManagerError,
  selectMostConservativeExecutionMode,
} from "../../src/guardrails/degradation-manager.js";
import { degradedModeActivationsTotal } from "../../src/observability/metrics.js";
import type { GuardrailEvaluationResult } from "../../src/guardrails/guardrail-evaluator.js";

const buildManager = (options?: {
  overrideRows?: Array<Record<string, unknown>>;
  currentMode?: string;
}) => {
  const overrideRows = options?.overrideRows ?? [];
  const currentMode = options?.currentMode ?? "FULL_MODE";

  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM control_plane_overrides")) {
      return { rows: overrideRows, rowCount: overrideRows.length };
    }
    if (sql.includes("FROM planner_shard_state")) {
      return { rows: [{ mode: currentMode }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const clientQuery = vi.fn(async (sql: string) => {
    if (sql.startsWith("UPDATE planner_shard_state")) {
      return { rows: [{ mode: "DISABLE_PHASE2B" }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO control_plane_audit_events")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  });

  const release = vi.fn();
  const connect = vi.fn(async () => ({
    query: clientQuery,
    release,
  }));

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const manager = new DegradationManager({
    pool: { query, connect } as never,
    logger,
  });

  return { manager, query, connect, clientQuery, release, logger };
};

const overrideRow = (
  scopeType: string,
  scopeId: string,
  mode: string,
  createdAt: string,
  id: string,
) => ({
  id,
  scope_type: scopeType,
  scope_id: scopeId,
  override_type: "FORCE_MODE",
  payload: { mode },
  created_by: "ops@example.com",
  created_at: new Date(createdAt),
  expires_at: null,
});

describe("DegradationManager", () => {
  beforeEach(() => {
    degradedModeActivationsTotal.reset();
  });

  it("returns FULL_MODE by default", async () => {
    const { manager, connect } = buildManager();

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      engine: "SOR",
      guardrailEvaluation: null,
    });

    expect(result).toEqual({
      mode: "FULL_MODE",
      reason: "no_override_or_guardrail_violation",
      source: "default",
      violations: [],
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("uses guardrail suggested degradation when no override exists", async () => {
    const { manager } = buildManager();

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      engine: "SOR",
      guardrailEvaluation: {
        violated: true,
        violations: [
          {
            type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
            actual: 101,
            threshold: 100,
            reason: "planner latency exceeded budget",
          },
        ],
        suggestedDegradation: "SOR_ONLY",
      },
    });

    expect(result.mode).toBe("SOR_ONLY");
    expect(result.source).toBe("guardrail");
  });

  it("prefers engine override over bucket, shard, and market", async () => {
    const { manager } = buildManager({
      overrideRows: [
        overrideRow("MARKET", "market-a", "SAFE_FALLBACK", "2026-03-12T00:00:00.000Z", "1"),
        overrideRow("SHARD", "shard-a", "DISABLE_PHASE2B", "2026-03-12T00:00:01.000Z", "2"),
        overrideRow("BUCKET", "bucket-a", "DISABLE_PHASE2A_AND_2B", "2026-03-12T00:00:02.000Z", "3"),
        overrideRow("ENGINE", "SOR", "DISABLE_INTERNAL_CROSS", "2026-03-12T00:00:03.000Z", "4"),
      ],
    });

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      bucketId: "bucket-a",
      marketId: "market-a",
      engine: "SOR",
      guardrailEvaluation: null,
    });

    expect(result.mode).toBe("DISABLE_INTERNAL_CROSS");
    expect(result.source).toBe("override");
    expect(result.matchedOverrideId).toBe("4");
  });

  it("prefers bucket override over shard and market", async () => {
    const { manager } = buildManager({
      overrideRows: [
        overrideRow("MARKET", "market-a", "SAFE_FALLBACK", "2026-03-12T00:00:00.000Z", "1"),
        overrideRow("SHARD", "shard-a", "DISABLE_PHASE2B", "2026-03-12T00:00:01.000Z", "2"),
        overrideRow("BUCKET", "bucket-a", "DISABLE_PHASE2A_AND_2B", "2026-03-12T00:00:02.000Z", "3"),
      ],
    });

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      bucketId: "bucket-a",
      marketId: "market-a",
      engine: "SOR",
      guardrailEvaluation: null,
    });

    expect(result.mode).toBe("DISABLE_PHASE2A_AND_2B");
    expect(result.matchedOverrideId).toBe("3");
  });

  it("prefers shard override over market", async () => {
    const { manager } = buildManager({
      overrideRows: [
        overrideRow("MARKET", "market-a", "SAFE_FALLBACK", "2026-03-12T00:00:00.000Z", "1"),
        overrideRow("SHARD", "shard-a", "DISABLE_PHASE2B", "2026-03-12T00:00:01.000Z", "2"),
      ],
    });

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      marketId: "market-a",
      engine: "SOR",
      guardrailEvaluation: null,
    });

    expect(result.mode).toBe("DISABLE_PHASE2B");
    expect(result.matchedOverrideId).toBe("2");
  });

  it("uses the newest override within the same scope", async () => {
    const { manager } = buildManager({
      overrideRows: [
        overrideRow("ENGINE", "SOR", "DISABLE_PHASE2B", "2026-03-12T00:00:00.000Z", "older"),
        overrideRow("ENGINE", "SOR", "SAFE_FALLBACK", "2026-03-12T00:00:01.000Z", "newer"),
      ],
    });

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      engine: "SOR",
      guardrailEvaluation: null,
    });

    expect(result.mode).toBe("SAFE_FALLBACK");
    expect(result.matchedOverrideId).toBe("newer");
  });

  it("fails closed on malformed override payload", async () => {
    const { manager } = buildManager({
      overrideRows: [
        {
          ...overrideRow("ENGINE", "SOR", "DISABLE_PHASE2B", "2026-03-12T00:00:00.000Z", "bad"),
          payload: { mode: "NOT_A_MODE" },
        },
      ],
    });

    await expect(
      manager.getEffectiveExecutionMode({
        shardId: "shard-a",
        engine: "SOR",
        guardrailEvaluation: null,
      }),
    ).rejects.toMatchObject({
      code: "malformed_override_payload",
    });
  });

  it("does not emit duplicate activation when the effective mode is unchanged", async () => {
    const { manager, connect } = buildManager({ currentMode: "DISABLE_PHASE2B" });

    const result = await manager.getEffectiveExecutionMode({
      shardId: "shard-a",
      engine: "CLEARING_PHASE2B",
      guardrailEvaluation: {
        violated: true,
        violations: [
          {
            type: "GRAPH_TOO_DENSE",
            actual: 11,
            threshold: 10,
            reason: "graph edges exceeded threshold",
          },
        ],
        suggestedDegradation: "DISABLE_PHASE2B",
      },
    });

    expect(result.mode).toBe("DISABLE_PHASE2B");
    expect(connect).not.toHaveBeenCalled();
    const metric = await degradedModeActivationsTotal.get();
    expect(metric.values).toHaveLength(0);
  });

  it("selects the most conservative execution mode deterministically", () => {
    expect(
      selectMostConservativeExecutionMode([
        "SOR_ONLY",
        "DISABLE_PHASE2B",
        "SAFE_FALLBACK",
      ]),
    ).toBe("SAFE_FALLBACK");
    expect(
      selectMostConservativeExecutionMode([
        "FULL_MODE",
        "DISABLE_INTERNAL_CROSS",
      ]),
    ).toBe("DISABLE_INTERNAL_CROSS");
  });
});
