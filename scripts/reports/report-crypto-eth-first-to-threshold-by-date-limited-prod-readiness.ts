#!/usr/bin/env tsx
import { runCryptoEthFirstToThresholdByDateLimitedProdReadiness } from "../../src/operations/semantic-expansion/crypto-eth-first-to-threshold-by-date-limited-prod-readiness.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const result = await runCryptoEthFirstToThresholdByDateLimitedProdReadiness({ repoRoot });
  console.log(JSON.stringify({
    laneId: result.readiness.laneId,
    finalReadinessLabel: result.readiness.finalReadinessLabel,
    adminDecision: result.adminSurfaceSummary.currentReadinessDecision
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto ETH first-to-threshold-by-date limited prod readiness.");
  console.error(error);
  process.exit(1);
});
