#!/usr/bin/env tsx
import { runCryptoSolFirstToThresholdByDateMatcherPass } from "../../src/reports/crypto-sol-first-to-threshold-by-date-matcher.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const result = await runCryptoSolFirstToThresholdByDateMatcherPass({ repoRoot });
  console.log(JSON.stringify({
    bestPair: result.finalDecision.bestPair,
    exactSafePairCandidateCount: result.finalDecision.exactSafePairCandidateCount,
    ruleStatus: result.finalDecision.ruleStatus
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto SOL first-to-threshold-by-date matcher.");
  console.error(error);
  process.exit(1);
});
