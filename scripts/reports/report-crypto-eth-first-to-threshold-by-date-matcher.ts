#!/usr/bin/env tsx
import { runCryptoEthFirstToThresholdByDateMatcherPass } from "../../src/reports/crypto-eth-first-to-threshold-by-date-matcher.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const result = await runCryptoEthFirstToThresholdByDateMatcherPass({ repoRoot });
  console.log(JSON.stringify({
    bestPair: result.finalDecision.bestPair,
    exactSafePairCandidateCount: result.finalDecision.exactSafePairCandidateCount,
    ruleStatus: result.finalDecision.ruleStatus
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto ETH first-to-threshold-by-date matcher.");
  console.error(error);
  process.exit(1);
});
