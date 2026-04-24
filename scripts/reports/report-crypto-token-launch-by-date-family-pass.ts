#!/usr/bin/env tsx
import {
  getCryptoTokenLaunchByDateProjectConfig,
  type CryptoTokenLaunchByDateProject
} from "../../src/matching/crypto/crypto-token-launch-by-date-assets.js";
import { runCryptoTokenLaunchByDateFamilyPass } from "../../src/reports/crypto-token-launch-by-date-shared.js";

const project = process.argv[2] as CryptoTokenLaunchByDateProject | undefined;
if (!project) {
  console.error("Usage: tsx scripts/reports/report-crypto-token-launch-by-date-family-pass.ts <METAMASK|BASE>");
  process.exit(1);
}

const main = async (): Promise<void> => {
  const result = await runCryptoTokenLaunchByDateFamilyPass({
    repoRoot: process.cwd(),
    config: getCryptoTokenLaunchByDateProjectConfig(project)
  });
  console.log(JSON.stringify({
    rowsFetchedByVenue: result.fetchSummary.rowsFetchedByVenue,
    rowsAdmittedByVenue: result.fetchSummary.rowsAdmittedByVenue,
    sharedCandidateTopicKeys: result.finalDecision.sharedCandidateTopicKeys,
    matcherFollowUpJustified: result.finalDecision.matcherFollowUpJustified
  }, null, 2));
};

main().catch((error) => {
  console.error(`Failed to run crypto ${project} token launch by date family pass.`);
  console.error(error);
  process.exit(1);
});
