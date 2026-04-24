#!/usr/bin/env tsx
import { runCryptoBtcFirstToThresholdByDateLimitedProdReadiness } from "../../src/operations/semantic-expansion/crypto-btc-first-to-threshold-by-date-limited-prod-readiness.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const result = await runCryptoBtcFirstToThresholdByDateLimitedProdReadiness({ repoRoot });
  console.log(JSON.stringify({
    laneId: result.readiness.laneId,
    finalReadinessLabel: result.readiness.finalReadinessLabel,
    adminDecision: result.adminSurfaceSummary.currentReadinessDecision
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto BTC first-to-threshold-by-date limited prod readiness.");
  console.error(error);
  process.exit(1);
});
