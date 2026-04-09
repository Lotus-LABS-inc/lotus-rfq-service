import type { Logger } from "pino";
import type { Pool } from "pg";

import { HistoricalSimulationCatalogService } from "../../api/admin/historical-simulation-catalog-service.js";
import { ResolutionRiskAdminService } from "../../api/admin/resolution-risk-admin-service.js";
import { SimulationAdminService } from "../../api/admin/simulation-admin-service.js";
import type { IResolutionRiskAssessmentService } from "../../core/rfq-engine/resolution-risk-assessment-service.js";
import type { RedisClient } from "../../db/redis.js";
import { BestExternalOnlyBaselineEvaluator } from "../../simulation/baselines/best-external-only-baseline.js";
import { LimitlessOnlyBaselineEvaluator } from "../../simulation/baselines/limitless-only-baseline.js";
import { MyriadOnlyBaselineEvaluator } from "../../simulation/baselines/myriad-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../../simulation/baselines/no-internalization-baseline.js";
import { OpinionOnlyBaselineEvaluator } from "../../simulation/baselines/opinion-only-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "../../simulation/baselines/polymarket-only-baseline.js";
import { PredictOnlyBaselineEvaluator } from "../../simulation/baselines/predict-only-baseline.js";
import { createDefaultHistoricalLotusEvaluators } from "../../simulation/default-historical-lotus-evaluators.js";
import { HistoricalSimulationRunner } from "../../simulation/historical-simulation-runner.js";

const DEFAULT_CONFIG_VERSION = "historical-sim-v1";
const DEFAULT_ENGINE_VERSION = "historical-sim-v1";

const createNoopLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});

const noopResolutionRiskAssessmentService: IResolutionRiskAssessmentService = {
  buildAssessmentsForCanonicalEvent: async () => [],
  comparePair: async () => {
    throw new Error("Resolution risk comparison is not available in the fast-testing service factory.");
  },
  recomputeProfileAssessments: async () => []
};

export interface CreateSimulationAdminServiceInput {
  pool: Pool;
  configVersion?: string;
  engineVersion?: string;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export const createSimulationAdminService = (
  input: CreateSimulationAdminServiceInput
): SimulationAdminService => {
  const logger = input.logger ?? createNoopLogger();
  const historicalSimulationCatalogService = new HistoricalSimulationCatalogService({
    pool: input.pool,
    version: "historical-sim-catalog-v1",
    logger
  });
  const resolutionRiskAdminService = new ResolutionRiskAdminService({
    pool: input.pool,
    redis: {} as RedisClient,
    assessmentService: noopResolutionRiskAssessmentService,
    logger,
    version: "resolution-risk-v1"
  });

  return new SimulationAdminService({
    pool: input.pool,
    historicalSimulationRunner: new HistoricalSimulationRunner({
      pool: input.pool,
      polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
      limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
      opinionOnlyBaselineEvaluator: new OpinionOnlyBaselineEvaluator(),
      myriadOnlyBaselineEvaluator: new MyriadOnlyBaselineEvaluator(),
      predictOnlyBaselineEvaluator: new PredictOnlyBaselineEvaluator(),
      bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
      noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
      lotusEvaluators: createDefaultHistoricalLotusEvaluators(),
      logger
    }),
    resolutionRiskAdminService,
    historicalSimulationCatalogService,
    configVersion: input.configVersion ?? DEFAULT_CONFIG_VERSION,
    engineVersion: input.engineVersion ?? DEFAULT_ENGINE_VERSION,
    logger
  });
};
