#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { PairRouteAdminService } from "../../src/api/admin/pair-route-admin-service.js";
import { writePairCanaryLaunchPlan } from "../../src/operations/semantic-expansion/pair-canary-launch-plan.js";
import { writePairCanaryReadinessArtifacts } from "../../src/operations/semantic-expansion/pair-canary-readiness-summary.js";
import { writePairShadowContinuePlan } from "../../src/operations/semantic-expansion/pair-shadow-continue-plan.js";
import { writeStagingShadowNextStepDecisionArtifact } from "../../src/operations/semantic-expansion/staging-shadow-next-step-decision.js";
import { writeStagingShadowObservationQualityArtifact } from "../../src/operations/semantic-expansion/staging-shadow-observation-quality-summary.js";
import { writeStagingShadowRuntimeCollectionArtifact } from "../../src/operations/semantic-expansion/staging-shadow-runtime-collection.js";
import { PairShadowObservationRepository } from "../../src/shadow/pair-shadow-observation-repository.js";
import { PairShadowRuntimeHooks } from "../../src/shadow/pair-shadow-runtime-hooks.js";
import { PairShadowRuntimeWriter } from "../../src/shadow/pair-shadow-runtime-writer.js";
import { PairShadowStagingReplayDriver } from "../../src/shadow/pair-shadow-staging-replay-driver.js";
import { writeStagingShadowWindowConfig } from "../../src/shadow/staging-shadow-window-config.js";

for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "run-staging-shadow-evidence-window"
  });
  const shadowPool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
    application_name: "run-staging-shadow-evidence-window-shadow"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const pairRouteAdminService = new PairRouteAdminService({ pool, shadowPool, repoRoot });
    const qualifications = await pairRouteAdminService.listPairRoutes();
    const config = writeStagingShadowWindowConfig(repoRoot, qualifications);
    const runtimeHooks = new PairShadowRuntimeHooks({
      writer: new PairShadowRuntimeWriter({
        repository: new PairShadowObservationRepository(shadowPool),
        repoRoot
      })
    });
    const replayDriver = new PairShadowStagingReplayDriver(runtimeHooks);
    const replayResult = await replayDriver.run(config);

    const runtimeCollection = await writeStagingShadowRuntimeCollectionArtifact(repoRoot, pairRouteAdminService);
    const quality = await writeStagingShadowObservationQualityArtifact(repoRoot, pairRouteAdminService);
    const readiness = await writePairCanaryReadinessArtifacts(repoRoot, pairRouteAdminService);
    const continuePlan = await writePairShadowContinuePlan(repoRoot, pairRouteAdminService);
    const launchPlan = await writePairCanaryLaunchPlan(repoRoot, pairRouteAdminService);
    const nextStep = await writeStagingShadowNextStepDecisionArtifact(repoRoot, pairRouteAdminService);

    console.log(JSON.stringify({
      stagingWindowId: replayResult.stagingWindowId,
      persistedObservations: replayResult.observations.length,
      runtimeCollection,
      quality,
      readiness: readiness.routes.map((route) => ({
        routeClass: route.routeClass,
        recommendation: route.canaryReadiness.recommendation,
        blockers: route.blockers
      })),
      continuePlan,
      launchPlan,
      nextStep
    }, null, 2));
  } finally {
    await shadowPool.end();
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run staging shadow evidence window.");
  console.error(error);
  process.exit(1);
});
