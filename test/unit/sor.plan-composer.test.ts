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
    connect: vi.fn(async () => client)
  };

  const composer = new PlanComposer({
    pool: pool as never,
    logger: {
      info: vi.fn(),
      error: vi.fn()
    },
    createUuid: (() => {
      let counter = 1;
      return () => `00000000-0000-4000-8000-${(counter++).toString().padStart(12, "0")}`;
    })(),
    now: () => new Date("2026-03-04T12:00:00.000Z")
  });

  return { composer, queries, pool, client, failOnSql };
};

describe("SOR PlanComposer", () => {
  it("persists routing plan, candidates, steps, and route history in one transaction", async () => {
    const { composer, queries, pool, client } = createComposerHarness();

    const plan = await composer.composePlan(baseInput());

    expect(plan.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(plan.metadata?.plan_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalled();
    expect(queries.map((entry) => entry.sql)).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("INSERT INTO routing_plans"),
        expect.stringContaining("INSERT INTO route_candidates"),
        expect.stringContaining("INSERT INTO route_steps"),
        expect.stringContaining("INSERT INTO route_history"),
        "COMMIT"
      ])
    );

    const planInsert = queries.find((entry) => entry.sql.includes("INSERT INTO routing_plans"));
    expect(planInsert?.params[3]).toBe("reservation-token-1");
  });

  it("generates unique idempotency keys and client_order_ids per step", async () => {
    const { composer } = createComposerHarness();
    const base = baseInput();
    const input: PlanComposerInput = {
      ...base,
      routeCandidates: [
        ...base.routeCandidates,
        {
          id: "af11ff12-5dc4-4edb-9cb7-04205c5fd3a5",
          leg_id: "8a5ea2cf-58e0-4f14-a5b8-3e7f2cf89d2d",
          provider_type: "LP",
          provider_id: "lp-2",
          available_size: 20,
          quoted_price: 1.01,
          fees: { provider_fee: 0.01 },
          latency_ms: 3,
          fill_prob: 0.95
        }
      ],
      allocations: [
        ...base.allocations,
        {
          candidateId: "af11ff12-5dc4-4edb-9cb7-04205c5fd3a5",
          providerId: "lp-2",
          targetSize: 5,
          roundedSize: 5,
          targetPrice: 1.01
        }
      ]
    };

    const plan = await composer.composePlan(input);

    const idempotencyKeys = plan.steps.map((step) => step.idempotencyKey);
    const clientOrderIds = plan.steps.map((step) => step.metadata?.client_order_id);

    expect(idempotencyKeys[0]).not.toBe(idempotencyKeys[1]);
    expect(clientOrderIds[0]).not.toBe(clientOrderIds[1]);
  });

  it("rolls back transaction when persistence fails mid-compose", async () => {
    const { composer, queries, client, failOnSql } = createComposerHarness();
    failOnSql.value = "INSERT INTO route_steps";

    await expect(composer.composePlan(baseInput())).rejects.toThrow("forced_failure");

    const sqls = queries.map((entry) => entry.sql);
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
