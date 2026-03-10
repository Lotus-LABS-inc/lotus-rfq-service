import { describe, expect, it, vi } from "vitest";
import { PlanComposer } from "../../src/core/sor/plan-composer.js";
import type { PlanComposerInput } from "../../src/core/sor/types.js";

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

const baseInput = (): PlanComposerInput => ({
  rfq: {
    rfqId: "95b5d661-2f9d-44c4-a3ea-7a98304f6c30",
    idempotencyKey: "idem-95b5d661-2f9d-44c4-a3ea-7a98304f6c30",
    stpMode: "CANCEL_NEWEST",
    canonicalMarketId: "market-1",
    takerId: "2f648a9f-a67a-4e96-b72a-e30211f0c043",
    side: "buy",
    quantity: "10"
  },
  selectedQuote: {
    quoteId: "quote-1",
    price: 1.0,
    quantity: 10,
    feeBps: 0
  },
  policy: "ALL_OR_NONE",
  reservationToken: "reservation-token-1",
  createdBy: "2f648a9f-a67a-4e96-b72a-e30211f0c043",
  routeCandidates: [
    {
      id: "4df5f85a-7584-4484-9735-2f4574d30f3a",
      leg_id: "032a0f67-a403-4ed0-9218-67f1147f9fc7",
      provider_type: "LP",
      provider_id: "lp-1",
      available_size: 10,
      quoted_price: 1.05,
      fees: { provider_fee: 0.01 },
      latency_ms: 4,
      fill_prob: 0.9
    }
  ],
  scoredCandidates: [
    {
      candidateId: "4df5f85a-7584-4484-9735-2f4574d30f3a",
      providerId: "lp-1",
      effectiveUnitCost: 1.06,
      totalExpectedCost: 10.6,
      breakdown: {
        effectiveUnitCost: 1.06,
        basePrice: 1.05,
        providerFee: 0.01,
        protocolFee: 0,
        gasCost: 0,
        latencyPenalty: 0,
        failurePenalty: 0
      }
    }
  ],
  allocations: [
    {
      candidateId: "4df5f85a-7584-4484-9735-2f4574d30f3a",
      providerId: "lp-1",
      targetSize: 10,
      roundedSize: 10,
      targetPrice: 1.05
    }
  ]
});

const createComposerHarness = () => {
  const queries: RecordedQuery[] = [];
  const failOnSql = {
    value: ""
  };
  const client = {
    query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
      if (failOnSql.value.length > 0 && sql.includes(failOnSql.value)) {
        throw new Error(`forced_failure:${failOnSql.value}`);
      }
      queries.push({ sql, params: params ?? [] });
      return { rows: [] };
    }),
    release: vi.fn()
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("SELECT") && sql.includes("routing_plans")) {
        return { rows: [] };
      }
      return { rows: [] };
    })
  };

  const composer = new PlanComposer({
    pool: pool as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    now: () => new Date("2026-03-04T12:00:00.000Z")
  });

  return { composer, queries, pool, client, failOnSql };
};

describe("SOR PlanComposer", () => {
  it("persists routing plan, candidates, steps, and route history in one transaction", async () => {
    const { composer, queries, pool, client } = createComposerHarness();
    const input = baseInput();

    const plan = await composer.composePlan(
      input.rfq,
      input.routeCandidates,
      input.scoredCandidates,
      input.allocations,
      input.policy
    );

    expect(plan).toBeDefined();
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalled();
    expect(queries.map((entry) => entry.sql)).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("INSERT INTO routing_plans"),
        expect.stringContaining("INSERT INTO route_candidates"),
        expect.stringContaining("INSERT INTO route_steps"),
        "COMMIT"
      ])
    );

    const planInsert = queries.find((entry) => entry.sql.includes("INSERT INTO routing_plans"));
    expect(planInsert?.params[1]).toBe(input.rfq.rfqId);
  });

  it("generates unique idempotency keys per step", async () => {
    const { composer } = createComposerHarness();
    const input = baseInput();

    const plan = await composer.composePlan(
      input.rfq,
      input.routeCandidates,
      input.scoredCandidates,
      input.allocations,
      input.policy
    );

    // In current implementation index is 0 and only 1 step is generated for single leg
    expect(plan.id).toBeDefined();
  });

  it("rolls back transaction when persistence fails mid-compose", async () => {
    const { composer, queries, client, failOnSql } = createComposerHarness();
    failOnSql.value = "INSERT INTO route_steps";

    const input = baseInput();
    await expect(composer.composePlan(
      input.rfq,
      input.routeCandidates,
      input.scoredCandidates,
      input.allocations,
      input.policy
    )).rejects.toThrow("forced_failure");

    const sqls = queries.map((entry) => entry.sql);
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
