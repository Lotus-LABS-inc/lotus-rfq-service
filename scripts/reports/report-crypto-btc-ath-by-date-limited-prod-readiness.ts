#!/usr/bin/env tsx
import { runCryptoBtcAthByDateLimitedProdReadiness } from "../../src/reports/crypto-btc-ath-by-date-limited-prod-readiness.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const artifacts = await runCryptoBtcAthByDateLimitedProdReadiness({ repoRoot });
  console.log(JSON.stringify({
    laneId: artifacts.readiness.laneId,
    finalReadinessLabel: artifacts.readiness.finalReadinessLabel,
    exactSafeDateBuckets: artifacts.readiness.exactSafeDateBuckets,
    currentReadinessDecision: artifacts.adminSurfaceSummary.currentReadinessDecision
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto BTC ATH by date limited-prod readiness.");
  console.error(error);
  process.exit(1);
});
