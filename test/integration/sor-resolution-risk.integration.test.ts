import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { Pool } from "pg";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { OrderRouter } from "../../src/core/sor/order-router.js";
import { PlanComposer } from "../../src/core/sor/plan-composer.js";
import { Splitter } from "../../src/core/sor/splitter.js";
import type { CanonicalRFQInput, RouteCandidate, SelectedQuoteInput } from "../../src/core/sor/types.js";
import { ResolutionRiskReadService } from "../../src/core/rfq-engine/resolution-risk-read-service.js";

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

const makeRFQ = (rfqId: string, quantity: string, legId: string): CanonicalRFQInput => ({
  rfqId,
  idempotencyKey: `idem-${rfqId}`,
  canonicalMarketId: `market-${rfqId}`,
  takerId: randomUUID(),
  side: "buy",
  quantity,
  stpMode: "CANCEL_NEWEST",
  metadata: {
    reservation_token: `reservation-${rfqId}`,
    legs: [
      {
        leg_id: legId,
        canonical_market_id: `market-${rfqId}`,
        side: "buy",
        quantity: Number.parseFloat(quantity)
      }
    ]
  }
});

const selectedQuote: SelectedQuoteInput = {
  quoteId: "selected-quote",
  price: 1,
  quantity: 10,
  feeBps: 0
};

describe("SOR resolution risk integration", () => {
  let pool: Pool | undefined;

  beforeAll(async () => {
    if (!ENV_READY) {
      return;
    }
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 60000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60000);

  it("enforces pooled routing behavior by equivalence class", async () => {
    if (!ENV_READY || !pool) {
      return;
    }

    const scenarios: Array<{
      equivalenceClass: "SAFE_EQUIVALENT" | "CAUTION" | "HIGH_RISK" | "DO_NOT_POOL";
      expectedSteps: number;
      expectedSecondTargetPrice?: number | null;
    }> = [
      { equivalenceClass: "SAFE_EQUIVALENT" as const, expectedSteps: 2 },
      { equivalenceClass: "CAUTION" as const, expectedSteps: 2 },
      { equivalenceClass: "HIGH_RISK" as const, expectedSteps: 1, expectedSecondTargetPrice: null },
      { equivalenceClass: "DO_NOT_POOL" as const, expectedSteps: 1, expectedSecondTargetPrice: null }
    ];
    let safeEquivalentSecondTargetPrice: number | null = null;

    for (const scenario of scenarios) {
      const canonicalEventId = randomUUID();
      const profileAId = randomUUID();
      const profileBId = randomUUID();
      const [marketAProfileId, marketBProfileId] = [profileAId, profileBId].sort((left, right) =>
        left.localeCompare(right)
      );
      const venueA = `venue-a-${randomUUID()}`;
      const venueB = `venue-b-${randomUUID()}`;

      await pool.query(
        `INSERT INTO resolution_profiles (
          id, venue, venue_market_id, canonical_event_id, oracle_type, resolution_authority_type,
          primary_resolution_text, market_type, outcome_schema, metadata
        ) VALUES
          ($1,$2,$3,$4,'oracle','authority','Resolves yes/no','binary',$5::jsonb,'{}'::jsonb),
          ($6,$7,$8,$4,'oracle','authority','Resolves yes/no','binary',$5::jsonb,'{}'::jsonb)`,
        [
          profileAId,
          venueA,
          `market-${profileAId}`,
          canonicalEventId,
          JSON.stringify({ type: "binary" }),
          profileBId,
          venueB,
          `market-${profileBId}`
        ]
      );

      await pool.query(
        `INSERT INTO resolution_risk_assessments (
          canonical_event_id, market_a_profile_id, market_b_profile_id, risk_score, confidence_score,
          equivalence_class, factor_breakdown, reasons, version
        ) VALUES ($1,$2,$3,'0.3','0.9',$4,'{}'::jsonb,'[]'::jsonb,'resolution-risk-v1')`,
        [canonicalEventId, marketAProfileId, marketBProfileId, scenario.equivalenceClass]
      );

      const legId = randomUUID();
      const rfqId = randomUUID();
      const router = new OrderRouter({
        routeScout: {
          discoverCandidates: async (): Promise<readonly RouteCandidate[]> => [
            {
              id: randomUUID(),
              leg_id: legId,
              provider_type: "LP",
              provider_id: `lp-${scenario.equivalenceClass}-1`,
              available_size: 5,
              quoted_price: 1,
              fees: {},
              latency_ms: 1,
              fill_prob: 0.95,
              metadata: { resolution_profile_id: profileAId }
            },
            {
              id: randomUUID(),
              leg_id: legId,
              provider_type: "VENUE",
              provider_id: `venue-${scenario.equivalenceClass}-2`,
              available_size: 5,
              quoted_price: 1.01,
              fees: {},
              latency_ms: 1,
              fill_prob: 0.95,
              metadata: { resolution_profile_id: profileBId }
            }
          ]
        },
        costModel: new CostModel(),
        splitter: new Splitter(),
        planComposer: new PlanComposer({ pool, logger }),
        internalEngine: {
          attemptCross: async () => ({ filledSize: 0, remainingSize: 10, trades: [] }),
          previewCross: async () => ({ fillableSize: 0, remainingSize: 10, matchedOrderIds: [], wouldSelfTrade: false })
        },
        logger,
        internalCrossingEnabled: true,
        resolutionRiskReadService: new ResolutionRiskReadService({
          pool,
          version: "resolution-risk-v1"
        }),
        resolutionRiskPenalty: 0.2
      });

      const result = await router.buildPlan(makeRFQ(rfqId, "10", legId), selectedQuote, "PARTIAL_ALLOWED");
      expect(result.kind).toBe("plan_created");
      if (result.kind !== "plan_created") {
        throw new Error("expected external plan");
      }

      expect(result.plan.steps).toHaveLength(scenario.expectedSteps);
      if (scenario.equivalenceClass === "SAFE_EQUIVALENT") {
        safeEquivalentSecondTargetPrice = result.plan.steps[1]?.targetPrice ?? null;
        expect(safeEquivalentSecondTargetPrice).not.toBeNull();
      }

      if (scenario.equivalenceClass === "CAUTION") {
        expect(safeEquivalentSecondTargetPrice).not.toBeNull();
        expect(result.plan.steps[1]?.targetPrice).toBeCloseTo((safeEquivalentSecondTargetPrice ?? 0) + 0.2, 10);
      }

      const expectedSecondTargetPrice = scenario.expectedSecondTargetPrice;
      if (
        (scenario.equivalenceClass === "HIGH_RISK" || scenario.equivalenceClass === "DO_NOT_POOL") &&
        expectedSecondTargetPrice != null
      ) {
        expect(result.plan.steps[1]?.targetPrice).toBeCloseTo(expectedSecondTargetPrice, 10);
      }
    }
  }, 60000);
});
