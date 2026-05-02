import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { QualificationRunManager } from "../../src/core/qualification/qualification-run-manager.js";
import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { QualificationHistoricalSimulationService } from "../../src/core/qualification/qualification-historical-simulation-service.js";
import { HistoricalMarketClass } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { HistoricalSimulationRunner, type HistoricalLotusPathEvaluatorBundle } from "../../src/simulation/historical-simulation-runner.js";
import { BestExternalOnlyBaselineEvaluator } from "../../src/simulation/baselines/best-external-only-baseline.js";
import { LimitlessOnlyBaselineEvaluator } from "../../src/simulation/baselines/limitless-only-baseline.js";
import { MyriadOnlyBaselineEvaluator } from "../../src/simulation/baselines/myriad-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../../src/simulation/baselines/no-internalization-baseline.js";
import { OpinionOnlyBaselineEvaluator } from "../../src/simulation/baselines/opinion-only-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "../../src/simulation/baselines/polymarket-only-baseline.js";
import { PredictOnlyBaselineEvaluator } from "../../src/simulation/baselines/predict-only-baseline.js";
import {
  QualificationAdminService,
  createDefaultPromotionGateConfig
} from "../../src/api/admin/qualification-admin-service.js";
import { PromotionGateEvaluator } from "../../src/core/qualification/promotion-gate-evaluator.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

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

const createLotusEvaluators = (): HistoricalLotusPathEvaluatorBundle => ({
  evaluateRFQGrouping: () => ({ grouped: true }),
  evaluateSOR: () => ({ route: "historical-sor" }),
  evaluateInternalCrossEligibility: () => ({ eligible: true }),
  evaluatePhase2ANettingEligibility: () => ({ eligible: true }),
  evaluateResolutionRiskGating: () => ({
    allowed: true,
    safeEquivalentEligible: true,
    reason: null
  }),
  evaluateFeeAdjustedLotusResult: () => ({
    effectiveCost: "0.45",
    slippage: "0.01",
    fees: "0.00",
    fillProbability: "1",
    fillProbabilityReason: null
  })
});

describe.skipIf(!ENV_READY)("QualificationHistoricalSimulationService integration", () => {
  let pool: Pool | undefined;
  const qualificationRunIds = new Set<string>();

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM historical_simulation_runs WHERE scope_id = 'phase4-qualification-scope'`);
      if (qualificationRunIds.size > 0) {
        await pool.query(`DELETE FROM strategy_qualification_runs WHERE id = ANY($1::uuid[])`, [[...qualificationRunIds]]);
      }
      await pool.query(`DELETE FROM historical_market_states WHERE canonical_event_id LIKE 'phase4-qualification-%'`);
      await pool.end();
    }
  }, 180000);

  it("attaches persisted simulation outputs to a qualification run and feeds qualification evidence aggregation", async () => {
    const qualificationRunManager = new QualificationRunManager({ pool: pool as Pool });
    const qualificationRun = await qualificationRunManager.createRun(
      `phase4.qualification.${Date.now()}`,
      "EVENT",
      "phase4-qualification-scope",
      QualificationStage.SHADOW,
      "eng-v1",
      "cfg-v1"
    );
    qualificationRunIds.add(qualificationRun.id);

    await qualificationRunManager.mergeRunMetadata(qualificationRun.id, {
      promotionGateSignals: {
        replayStability: { matchRate: 0.999, diffRate: 0.001, errorRate: 0, consecutiveStableRuns: 20 },
        reconciliationHealth: { mismatchCount: 0, mismatchRate: 0, infraErrorCount: 0, lockConflictCount: 0 },
        plannerLatency: { p95Ms: 100, p99Ms: 180 },
        incidentCount: { incidents: 0, unresolvedIncidents: 0 },
        adverseSelection: { adverseFillRate: 0.01, postTradeMarkoutLoss: "0.01", lossRate: 0.005 }
      }
    });

    await (pool as Pool).query(
      `INSERT INTO historical_market_states (
         canonical_event_id,
         canonical_category,
         venue,
         venue_market_id,
         market_class,
         "timestamp",
         best_bid,
         best_ask,
         last_price,
         own_execution_history,
         orderbook_snapshot,
         metadata_version,
         source_timestamp
       ) VALUES
       ($1, 'SPORTS', 'POLYMARKET', 'sports-poly', 'BINARY', $2, '0.58', '0.60', '0.59', null, $3::jsonb, 'hist-v1', $2),
       ($1, 'SPORTS', 'LIMITLESS', 'sports-limitless', 'BINARY', $2, null, null, '0.57', $4::jsonb, null, 'hist-v1', $2)`,
      [
        "phase4-qualification-event",
        new Date("2026-03-13T00:00:00.000Z"),
        JSON.stringify({ bids: [{ price: "0.58", size: "2" }], asks: [{ price: "0.60", size: "2" }] }),
        JSON.stringify({ observedFilledCount: "4", observedOpportunityCount: "5" })
      ]
    );

    const runner = new HistoricalSimulationRunner({
      pool: pool as Pool,
      polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
      limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
      opinionOnlyBaselineEvaluator: new OpinionOnlyBaselineEvaluator(),
      myriadOnlyBaselineEvaluator: new MyriadOnlyBaselineEvaluator(),
      predictOnlyBaselineEvaluator: new PredictOnlyBaselineEvaluator(),
      bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
      noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
      lotusEvaluators: createLotusEvaluators()
    });

    const service = new QualificationHistoricalSimulationService({
      qualificationRunManager,
      historicalSimulationRunner: runner
    });

    const result = await service.runHistoricalSimulationForQualification({
      qualificationRunId: qualificationRun.id,
      attachToQualificationRun: true,
      populateDecisionEvaluations: true,
      scopeType: "EVENT",
      scopeId: qualificationRun.scopeId,
      routeMode: "POLYMARKET_LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      canonicalEventId: "phase4-qualification-event",
      side: "BUY",
      requestedNotional: "100",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:05:00.000Z"),
      configVersion: "cfg-v1",
      engineVersion: "eng-v1",
      dryRun: false
    });

    expect(result.simulationRunId).not.toBeNull();
    expect(result.populatedEvaluations).toHaveLength(1);
    expect(result.qualificationRun.metadata.historicalSimulationEvidence).toEqual(
      expect.objectContaining({
        latestSimulationRunId: result.simulationRunId
      })
    );

    const linkedRun = await (pool as Pool).query<{ qualification_run_id: string | null }>(
      `SELECT qualification_run_id
         FROM historical_simulation_runs
        WHERE id = $1`,
      [result.simulationRunId]
    );
    expect(linkedRun.rows[0]?.qualification_run_id).toBe(qualificationRun.id);

    const evaluationRows = await (pool as Pool).query<{ decision_type: string; entity_id: string; improvement_metrics: Record<string, unknown> }>(
      `SELECT decision_type, entity_id, improvement_metrics
         FROM strategy_decision_evaluations
        WHERE qualification_run_id = $1
        ORDER BY created_at ASC`,
      [qualificationRun.id]
    );
    expect(evaluationRows.rowCount).toBe(1);
    expect(evaluationRows.rows[0]?.decision_type).toBe("HISTORICAL_SIMULATION");
    expect(evaluationRows.rows[0]?.entity_id).toContain(result.simulationRunId as string);
    expect(evaluationRows.rows[0]?.improvement_metrics).toEqual(
      expect.objectContaining({
        supplementalEvidence: true
      })
    );

    const adminService = new QualificationAdminService({
      pool: pool as Pool,
      promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
    });
    const detail = await adminService.getRunDetail(qualificationRun.id);

    expect(detail.historicalSimulationSummary).toEqual(
      expect.objectContaining({
        latestSimulationRunId: result.simulationRunId
      })
    );
    expect(detail.summary.improvement.numericTotals.priceImprovement).toBe("0.12");
    expect(detail.summary.improvement.numericTotals.slippageSaved).toBe("-0.01");
    expect(detail.summary.improvement.numericTotals.feeSaved).toBe("0");
  }, 30000);
});
