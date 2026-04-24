#!/usr/bin/env tsx
import { runCryptoBtcAthByDateMatcherPass } from "../../src/reports/crypto-btc-ath-by-date-matcher.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const result = await runCryptoBtcAthByDateMatcherPass({ repoRoot });
  console.log(JSON.stringify({
    admittedVenues: result.inputSummary.admittedVenues,
    exactSafePairCandidateCount: result.finalDecision.exactSafePairCandidateCount,
    bestPair: result.finalDecision.bestPair,
    matcherFollowUpJustified: result.finalDecision.matcherFollowUpJustified
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto BTC ATH by date matcher pass.");
  console.error(error);
  process.exit(1);
});
