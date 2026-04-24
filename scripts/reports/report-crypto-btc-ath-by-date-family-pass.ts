#!/usr/bin/env tsx
import { runCryptoBtcAthByDateFamilyPass } from "../../src/reports/crypto-btc-ath-by-date-family-pass.js";

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const result = await runCryptoBtcAthByDateFamilyPass({ repoRoot });
  console.log(JSON.stringify({
    rowsFetchedByVenue: result.fetchSummary.rowsFetchedByVenue,
    rowsAdmittedByVenue: result.fetchSummary.rowsAdmittedByVenue,
    sharedCandidateTopicKeys: result.finalDecision.sharedCandidateTopicKeys,
    matcherFollowUpJustified: result.finalDecision.matcherFollowUpJustified
  }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run crypto BTC ATH by date family pass.");
  console.error(error);
  process.exit(1);
});
