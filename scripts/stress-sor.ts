#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import pino from "pino";
import { connectRedis, createRedisClient, disconnectRedis } from "../src/db/redis.js";
import { CostModel } from "../src/core/sor/cost-model.js";
import { OrderRouter } from "../src/core/sor/order-router.js";
import { PlanComposer } from "../src/core/sor/plan-composer.js";
import { PlanRunner } from "../src/core/sor/plan-runner.js";
import { RouteScout } from "../src/core/sor/route-scout.js";
import { Splitter } from "../src/core/sor/splitter.js";
import type {
  CanonicalRFQInput,
  IExecutionRouter,
  PlanStep,
  SORAcceptancePolicy,
  SelectedQuoteInput
} from "../src/core/sor/types.js";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env")
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const logger = pino({ level: "info" });
const RUN_PREFIX = `stress:sor:${Date.now()}:${randomUUID()}:`;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationDirs = [
    path.resolve(process.cwd(), "infra", "migrations"),
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

const insertRFQSession = async (
  pool: Pool,
  rfqId: string,
  takerId: string,
  quantity: string,
  policy: SORAcceptancePolicy
): Promise<void> => {
  await pool.query(
    `INSERT INTO rfq_sessions
      (id, request_id, canonical_market_id, taker_id, side, quantity, status, idempotency_key, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '10 minutes', $9::jsonb)`,
    [
      rfqId,
      `${RUN_PREFIX}${randomUUID()}`,
      `${RUN_PREFIX}market`,
      takerId,
      "buy",
      quantity,
      "ACCEPTED",
      `${RUN_PREFIX}${randomUUID()}`,
      JSON.stringify({ acceptance_policy: policy, run_tag: RUN_PREFIX })
    ]
  );
};

const randomPolicy = (): SORAcceptancePolicy => {
  const sample = Math.random();
  if (sample < 0.34) {
    return "ALL_OR_NONE";
  }
  if (sample < 0.67) {
    return "PARTIAL_ALLOWED";
  }
  return "BEST_EFFORT";
};

const buildRFQ = (
  rfqId: string,
  takerId: string,
  qty: number,
  legs: Array<{ leg_id: string; canonical_market_id: string; side: "buy" | "sell"; quantity: number }>
): CanonicalRFQInput => ({
  rfqId,
  canonicalMarketId: legs[0]?.canonical_market_id ?? `${RUN_PREFIX}market`,
  takerId,
  side: "buy",
  quantity: qty.toString(),
  metadata: {
    reservation_token: `${RUN_PREFIX}reservation-${rfqId}`,
    legs
  }
});

const buildSelectedQuote = (qty: number): SelectedQuoteInput => ({
  quoteId: `${RUN_PREFIX}quote-${randomUUID()}`,
  price: 1.0,
  quantity: qty,
  feeBps: 0
});

const run = async (): Promise<void> => {
  if (!DATABASE_URL || !REDIS_URL) {
    throw new Error("TEST_DATABASE_URL/DATABASE_URL and TEST_REDIS_URL/REDIS_URL are required.");
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const redis = createRedisClient({ redisUrl: REDIS_URL, logger });
  await connectRedis(redis);
  await applyMigrations(pool);

  const executionFailures = new Map<string, number>();
  const exposureApplied = new Set<string>();
  let duplicateExposureUpdates = 0;
  const executedPlanIds: string[] = [];

  const executionRouter: IExecutionRouter = {
    executeStep: async (step: PlanStep) => {
      await sleep(Math.floor(Math.random() * 25));

      const failChance = step.providerId.includes("primary") ? 0.35 : 0.08;
      const failedAttempts = executionFailures.get(step.id) ?? 0;
      const shouldFail = Math.random() < failChance && failedAttempts < 1;

      if (shouldFail) {
        executionFailures.set(step.id, failedAttempts + 1);
        return { ok: false, error: "simulated_provider_failure" };
      }
      return { ok: true, executionRef: `${RUN_PREFIX}exec-${step.id}` };
    }
  };

  const riskEngine = {
    validateRFQCreation: async () => undefined,
    validateBeforeExecution: async () => `${RUN_PREFIX}unused`,
    updateExposureAfterExecution: async (payload: Record<string, unknown>) => {
      const executionId = String(payload.executionId);
      if (exposureApplied.has(executionId)) {
        duplicateExposureUpdates += 1;
        return;
      }
      exposureApplied.add(executionId);
    },
    reconcileExposureSnapshot: async () => undefined
  };

  const routeScout = new RouteScout({
    redis,
    lpSource: {
      getWholeComboQuotes: async () => [],
      getPerLegQuotes: async (_rfq, legId) => [
        {
          quoteId: `${RUN_PREFIX}${legId}-primary`,
          providerId: `${legId}-primary`,
          legId,
          availableSize: 100,
          quotedPrice: 1.0,
          fillProb: 0.95,
          latencyMs: 3,
          fees: { provider_fee: 0.001, protocol_fee: 0.0005 }
        },
        {
          quoteId: `${RUN_PREFIX}${legId}-fallback`,
          providerId: `${legId}-fallback`,
          legId,
          availableSize: 100,
          quotedPrice: 1.01,
          fillProb: 0.85,
          latencyMs: 5,
          fees: { provider_fee: 0.0015, protocol_fee: 0.0005 }
        }
      ]
    },
    canonicalClient: {
      getOrderbookSnapshot: async () => null
    },
    cacheTtlMs: 300
  });

  const orderRouter = new OrderRouter({
    routeScout,
    costModel: new CostModel(),
    splitter: new Splitter(),
    planComposer: new PlanComposer({
      pool,
      logger
    })
  });

  const planRunner = new PlanRunner({
    pool,
    redis,
    executionRouter,
    riskEngine,
    logger,
    config: {
      concurrency: 8,
      retry: {
        maxRetries: 2,
        baseDelayMs: 10
      },
      stepTimeoutMs: 5000
    }
  });

  const scenarios = Array.from({ length: 200 }, async () => {
    const rfqId = randomUUID();
    const takerId = randomUUID();
    const policy = randomPolicy();
    const size = 2 + Math.floor(Math.random() * 15);
    const legs = Math.random() > 0.65 ? 2 : 1;
    const legDefs = Array.from({ length: legs }, () => ({
      leg_id: randomUUID(),
      canonical_market_id: `${RUN_PREFIX}market-${randomUUID()}`,
      side: "buy" as const,
      quantity: size
    }));

    await insertRFQSession(pool, rfqId, takerId, size.toString(), policy);
    const plan = await orderRouter.buildPlan(
      buildRFQ(rfqId, takerId, size, legDefs),
      buildSelectedQuote(size),
      policy
    );
    executedPlanIds.push(plan.id);

    const result = await planRunner.run(plan);
    return { planId: plan.id, status: result.status };
  });

  const settled = await Promise.allSettled(scenarios);
  const failedPromises = settled.filter((entry) => entry.status === "rejected");
  if (failedPromises.length > 0) {
    logger.error({ failed: failedPromises.length }, "Some stress scenarios rejected.");
  }

  const plans = await pool.query<{ id: string; state: string }>(
    "SELECT id, state FROM routing_plans WHERE id = ANY($1::uuid[])",
    [executedPlanIds]
  );
  const nonTerminal = plans.rows.filter(
    (row) => !["COMPLETED", "FAILED", "UNWOUND"].includes(row.state)
  );

  const steps = await pool.query<{ id: string; routing_plan_id: string; state: string }>(
    "SELECT id, routing_plan_id, state FROM route_steps WHERE routing_plan_id = ANY($1::uuid[])",
    [executedPlanIds]
  );

  let orphanLocks = 0;
  for (const step of steps.rows) {
    const lock = await redis.get(`route_step:${step.id}:lock`);
    if (lock !== null) {
      orphanLocks += 1;
    }
  }

  const fallbackHistory = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM route_history
     WHERE routing_plan_id = ANY($1::uuid[])
       AND event_type = 'ROUTE_STEP_FALLBACK_CREATED'`,
    [executedPlanIds]
  );

  logger.info(
    {
      plans: executedPlanIds.length,
      rejectedScenarios: failedPromises.length,
      duplicateExposureUpdates,
      nonTerminalPlans: nonTerminal.length,
      orphanLocks,
      fallbackEvents: Number.parseInt(fallbackHistory.rows[0]?.count ?? "0", 10)
    },
    "SOR stress summary"
  );

  await disconnectRedis(redis);
  await pool.end();

  if (duplicateExposureUpdates > 0 || nonTerminal.length > 0 || orphanLocks > 0) {
    process.exit(1);
  }

  process.exit(0);
};

run().catch((error: unknown) => {
  logger.error({ err: error }, "stress-sor failed");
  process.exit(1);
});
