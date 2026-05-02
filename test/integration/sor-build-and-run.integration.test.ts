import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { Pool } from "pg";
import { connectRedis, createRedisClient, disconnectRedis, type RedisClient } from "../../src/db/redis.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import { PlanComposer } from "../../src/core/sor/plan-composer.js";
import { PlanRunner } from "../../src/core/sor/plan-runner.js";
import { RouteScout } from "../../src/core/sor/route-scout.js";
import { InsufficientLiquidityError, Splitter } from "../../src/core/sor/splitter.js";
import type {
  CanonicalRFQInput,
  IExecutionRouter,
  OrderRouterBuildResult,
  PlanStep,
  SORAcceptancePolicy,
  SelectedQuoteInput
} from "../../src/core/sor/types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);

const logger = pino({ level: "silent" });
const RUN_PREFIX = `it:sor:${Date.now()}:${randomUUID()}:`;

interface CandidateFixture {
  providerId: string;
  availableSize: number;
  quotedPrice: number;
  fillProb: number;
  latencyMs?: number;
}

interface ScenarioFixtures {
  wholeComboQuotes?: CandidateFixture[];
  perLegQuotes: Readonly<Record<string, readonly CandidateFixture[]>>;
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
        if (code === "42P07" || code === "42710") {
          continue;
        }
        throw error;
      }
    }
  }
};

const clearState = async (pool: Pool): Promise<void> => {
  let attempts = 0;
  while (attempts < 5) {
    try {
      await pool.query(
        `TRUNCATE TABLE
          route_history,
          route_steps,
          route_candidates,
          routing_plans,
          rfq_executions,
          rfq_events,
          rfq_quotes,
          lp_keys,
          rfq_sessions
        RESTART IDENTITY CASCADE`
      );
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "40P01") {
        throw error;
      }
      attempts += 1;
      await sleep(100 * attempts);
    }
  }
  throw new Error("Unable to clear SOR integration state due to repeated deadlocks.");
};

const buildRouteScout = (redis: RedisClient, fixtures: ScenarioFixtures): RouteScout => {
  return new RouteScout({
    redis,
    lpSource: {
      getWholeComboQuotes: async () =>
        (fixtures.wholeComboQuotes ?? []).map((quote) => ({
          quoteId: `${RUN_PREFIX}whole-${quote.providerId}`,
          providerId: quote.providerId,
          availableSize: quote.availableSize,
          quotedPrice: quote.quotedPrice,
          fillProb: quote.fillProb,
          latencyMs: quote.latencyMs ?? 3,
          fees: { provider_fee: 0.001, protocol_fee: 0.0005 }
        })),
      getPerLegQuotes: async (_rfq, legId) =>
        (fixtures.perLegQuotes[legId] ?? []).map((quote) => ({
          quoteId: `${RUN_PREFIX}leg-${legId}-${quote.providerId}`,
          providerId: quote.providerId,
          legId,
          availableSize: quote.availableSize,
          quotedPrice: quote.quotedPrice,
          fillProb: quote.fillProb,
          latencyMs: quote.latencyMs ?? 5,
          fees: { provider_fee: 0.001, protocol_fee: 0.0005 }
        }))
    },
    canonicalClient: {
      getOrderbookSnapshot: async () => null
    },
    cacheTtlMs: 400
  });
};

const buildNoFillInternalEngine = () => ({
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
});

const expectPlanCreated = (result: OrderRouterBuildResult) => {
  expect(result.kind).toBe("plan_created");
  if (result.kind !== "plan_created") {
    throw new Error("Expected plan_created result.");
  }
  return result.plan;
};

const makeRFQInput = (
  rfqId: string,
  takerId: string,
  quantity: string,
  legs: Array<{ leg_id: string; canonical_market_id: string; side: "buy" | "sell"; quantity: number }>
): CanonicalRFQInput => ({
  rfqId,
  idempotencyKey: `idem-${rfqId}`,
  stpMode: "CANCEL_NEWEST",
  canonicalMarketId: legs[0]?.canonical_market_id ?? "market-default",
  takerId,
  side: "buy",
  quantity,
  metadata: {
    reservation_token: `res-${rfqId}`,
    legs
  }
});

const makeSelectedQuote = (quantity: number): SelectedQuoteInput => ({
  quoteId: `${RUN_PREFIX}selected-${randomUUID()}`,
  price: 1.0,
  quantity,
  feeBps: 0
});

const insertRFQSession = async (
  pool: Pool,
  sessionId: string,
  takerId: string,
  quantity: string,
  policy: SORAcceptancePolicy
): Promise<void> => {
  await pool.query(
    `INSERT INTO rfq_sessions
      (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '10 minutes', $9::jsonb)`,
    [
      sessionId,
      randomUUID(),
      "market-1",
      takerId,
      "buy",
      quantity,
      "ACCEPTED",
      randomUUID(),
      JSON.stringify({ acceptance_policy: policy })
    ]
  );
};

describe("SOR build and run integration", () => {
  let pool: Pool | undefined;
  let redis: RedisClient | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  beforeAll(async () => {
    if (!ENV_READY) {
      return;
    }
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));
    await clearState(must(pool, "pool"));

    redis = createRedisClient({
      redisUrl: TEST_REDIS_URL as string,
      logger
    });
    await connectRedis(must(redis, "redis"));
  }, 60000);

  beforeEach(async () => {
    if (!ENV_READY) {
      return;
    }
    await clearState(must(pool, "pool"));
  });

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
  }, 60000);

  it("happy path single-leg: one LP fills entire size", async () => {
    const pg = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const rfqId = randomUUID();
    const takerId = randomUUID();
    const legId = randomUUID();

    await insertRFQSession(pg, rfqId, takerId, "10", "ALL_OR_NONE");

    const routeScout = buildRouteScout(redisClient, {
      perLegQuotes: {
        [legId]: [
          { providerId: "lp-alpha", availableSize: 100, quotedPrice: 1.01, fillProb: 0.95 }
        ]
      }
    });

    const router = new OrderRouter({
      routeScout,
      costModel: new CostModel(),
      splitter: new Splitter(),
      planComposer: new PlanComposer({
        pool: pg,
        logger
      }),
      internalEngine: buildNoFillInternalEngine(),
      logger
    });

    const riskUpdates = new Set<string>();
    const riskEngine = {
      validateRFQCreation: async () => undefined,
      validateBeforeExecution: async () => `${RUN_PREFIX}unused`,
      updateExposureAfterExecution: async (payload: Record<string, unknown>, _isInternal = false) => {
        const executionId = String(payload.executionId);
        if (riskUpdates.has(executionId)) {
          throw new Error(`duplicate exposure update ${executionId}`);
        }
        riskUpdates.add(executionId);
      },
      reconcileExposureSnapshot: async () => undefined
    };

    const executionRouter: IExecutionRouter = {
      executeStep: async (_step: PlanStep) => ({
        ok: true,
        executionRef: `${RUN_PREFIX}exec-${randomUUID()}`
      })
    };

    const runner = new PlanRunner({
      pool: pg,
      redis: redisClient,
      executionRouter,
      riskEngine,
      logger,
      config: {
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const plan = expectPlanCreated(await router.buildPlan(
      makeRFQInput(rfqId, takerId, "10", [
        {
          leg_id: legId,
          canonical_market_id: `${RUN_PREFIX}market-1`,
          side: "buy",
          quantity: 10
        }
      ]),
      makeSelectedQuote(10),
      "ALL_OR_NONE"
    ));
    const result = await runner.run(plan);

    expect(result.status).toBe("COMPLETED");

    const steps = await pg.query<{ id: string; state: string }>(
      "SELECT id, state FROM route_steps WHERE routing_plan_id = $1 ORDER BY step_index ASC",
      [plan.id]
    );
    expect(steps.rows).toHaveLength(1);
    expect(steps.rows[0]?.state).toBe("FILLED");
    expect(riskUpdates.size).toBe(1);

    const lockValue = await redisClient.get(`route_step:${steps.rows[0]?.id}:lock`);
    expect(lockValue).toBeNull();
  }, 60000);

  it("multi-candidate flow executes across two providers", async () => {
    const pg = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const rfqId = randomUUID();
    const takerId = randomUUID();
    const legA = randomUUID();
    const legB = randomUUID();

    await insertRFQSession(pg, rfqId, takerId, "10", "PARTIAL_ALLOWED");

    const routeScout = buildRouteScout(redisClient, {
      perLegQuotes: {
        [legA]: [
          { providerId: "lp-leg-a", availableSize: 100, quotedPrice: 1.0, fillProb: 0.95 },
          { providerId: "lp-leg-a-alt", availableSize: 100, quotedPrice: 1.05, fillProb: 0.9 }
        ],
        [legB]: [
          { providerId: "lp-leg-b", availableSize: 100, quotedPrice: 1.0, fillProb: 0.95 },
          { providerId: "lp-leg-b-alt", availableSize: 100, quotedPrice: 1.05, fillProb: 0.9 }
        ]
      }
    });

    const router = new OrderRouter({
      routeScout,
      costModel: new CostModel(),
      splitter: new Splitter(),
      planComposer: new PlanComposer({
        pool: pg,
        logger
      }),
      internalEngine: buildNoFillInternalEngine(),
      logger
    });

    const executionRouter: IExecutionRouter = {
      executeStep: async (step: PlanStep) => ({
        ok: true,
        executionRef: `${RUN_PREFIX}${step.providerId}`
      })
    };

    const runner = new PlanRunner({
      pool: pg,
      redis: redisClient,
      executionRouter,
      riskEngine: {
        validateRFQCreation: async () => undefined,
        validateBeforeExecution: async () => `${RUN_PREFIX}unused`,
        updateExposureAfterExecution: async (_exec: Record<string, unknown>, _isInternal = false) => undefined,
        reconcileExposureSnapshot: async () => undefined
      },
      logger,
      config: {
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const plan = expectPlanCreated(await router.buildPlan(
      makeRFQInput(rfqId, takerId, "10", [
        { leg_id: legA, canonical_market_id: `${RUN_PREFIX}market-a`, side: "buy", quantity: 10 },
        { leg_id: legB, canonical_market_id: `${RUN_PREFIX}market-b`, side: "buy", quantity: 10 }
      ]),
      makeSelectedQuote(10),
      "PARTIAL_ALLOWED"
    ));
    const result = await runner.run(plan);

    expect(result.status).toBe("COMPLETED");

    const steps = await pg.query<{ provider_id: string; state: string }>(
      "SELECT provider_id, state FROM route_steps WHERE routing_plan_id = $1 ORDER BY step_index ASC",
      [plan.id]
    );
    expect(steps.rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(steps.rows.map((row) => row.provider_id)).size).toBeGreaterThanOrEqual(2);
    expect(steps.rows.every((row) => row.state === "FILLED")).toBe(true);
  }, 60000);

  it("ALL_OR_NONE fail: insufficient liquidity is rejected at plan build", async () => {
    const pg = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const rfqId = randomUUID();
    const takerId = randomUUID();
    const legId = randomUUID();

    await insertRFQSession(pg, rfqId, takerId, "0.0000005", "ALL_OR_NONE");

    const routeScout = buildRouteScout(redisClient, {
      perLegQuotes: {
        [legId]: [
          { providerId: "lp-low-liq", availableSize: 0.0000005, quotedPrice: 1.0, fillProb: 0.95 }
        ]
      }
    });

    const router = new OrderRouter({
      routeScout,
      costModel: new CostModel(),
      splitter: new Splitter(),
      planComposer: new PlanComposer({
        pool: pg,
        logger
      }),
      internalEngine: buildNoFillInternalEngine(),
      logger
    });

    await expect(
      router.buildPlan(
        makeRFQInput(rfqId, takerId, "0.0000005", [
          {
            leg_id: legId,
            canonical_market_id: `${RUN_PREFIX}market-small`,
            side: "buy",
            quantity: 0.0000005
          }
        ]),
        makeSelectedQuote(0.0000005),
        "ALL_OR_NONE"
      )
    ).rejects.toBeInstanceOf(InsufficientLiquidityError);

    const count = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM routing_plans WHERE rfq_id = $1",
      [rfqId]
    );
    expect(Number.parseInt(count.rows[0]?.count ?? "0", 10)).toBe(0);
  }, 60000);

  it("fallback provider is used after primary fails", async () => {
    const pg = must(pool, "pool");
    const redisClient = must(redis, "redis");
    const rfqId = randomUUID();
    const takerId = randomUUID();
    const legId = randomUUID();

    await insertRFQSession(pg, rfqId, takerId, "10", "BEST_EFFORT");

    const routeScout = buildRouteScout(redisClient, {
      perLegQuotes: {
        [legId]: [
          { providerId: "lp-primary", availableSize: 100, quotedPrice: 1.0, fillProb: 0.95 },
          { providerId: "lp-fallback", availableSize: 100, quotedPrice: 1.05, fillProb: 0.9 }
        ]
      }
    });

    const router = new OrderRouter({
      routeScout,
      costModel: new CostModel(),
      splitter: new Splitter(),
      planComposer: new PlanComposer({
        pool: pg,
        logger
      }),
      internalEngine: buildNoFillInternalEngine(),
      logger
    });

    const executionRouter: IExecutionRouter = {
      executeStep: async (step: PlanStep) => {
        if (step.providerId === "lp-primary") {
          return { ok: false, error: "primary_failure" };
        }
        return { ok: true, executionRef: `${RUN_PREFIX}fallback-exec` };
      }
    };

    const runner = new PlanRunner({
      pool: pg,
      redis: redisClient,
      executionRouter,
      riskEngine: {
        validateRFQCreation: async () => undefined,
        validateBeforeExecution: async () => `${RUN_PREFIX}unused`,
        updateExposureAfterExecution: async (_exec: Record<string, unknown>, _isInternal = false) => undefined,
        reconcileExposureSnapshot: async () => undefined
      },
      logger,
      config: {
        retry: { maxRetries: 0, baseDelayMs: 1 }
      }
    });

    const plan = expectPlanCreated(await router.buildPlan(
      makeRFQInput(rfqId, takerId, "10", [
        {
          leg_id: legId,
          canonical_market_id: `${RUN_PREFIX}market-fb`,
          side: "buy",
          quantity: 10
        }
      ]),
      makeSelectedQuote(10),
      "BEST_EFFORT"
    ));
    const result = await runner.run(plan);

    expect(["COMPLETED", "PARTIAL"]).toContain(result.status);

    const fallbackHistory = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM route_history
       WHERE routing_plan_id = $1
         AND event_type = 'ROUTE_STEP_FALLBACK_CREATED'`,
      [plan.id]
    );
    expect(Number.parseInt(fallbackHistory.rows[0]?.count ?? "0", 10)).toBeGreaterThan(0);

    const fallbackStep = await pg.query<{ provider_id: string; state: string }>(
      `SELECT provider_id, state
       FROM route_steps
       WHERE routing_plan_id = $1
       ORDER BY step_index DESC
       LIMIT 1`,
      [plan.id]
    );
    expect(fallbackStep.rows[0]?.provider_id).toBe("lp-fallback");
    expect(fallbackStep.rows[0]?.state).toBe("FILLED");
  }, 60000);
});
