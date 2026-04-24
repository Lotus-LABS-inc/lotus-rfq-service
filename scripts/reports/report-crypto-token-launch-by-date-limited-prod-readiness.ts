#!/usr/bin/env tsx
import {
  getCryptoTokenLaunchByDateProjectConfig,
  type CryptoTokenLaunchByDateProject
} from "../../src/matching/crypto/crypto-token-launch-by-date-assets.js";
import { runCryptoTokenLaunchByDateLimitedProdReadiness } from "../../src/operations/semantic-expansion/crypto-token-launch-by-date-limited-prod-readiness-shared.js";

const project = process.argv[2] as CryptoTokenLaunchByDateProject | undefined;
if (!project) {
  console.error("Usage: tsx scripts/reports/report-crypto-token-launch-by-date-limited-prod-readiness.ts <METAMASK|BASE>");
  process.exit(1);
}

const main = async (): Promise<void> => {
  const result = await runCryptoTokenLaunchByDateLimitedProdReadiness({
    repoRoot: process.cwd(),
    config: getCryptoTokenLaunchByDateProjectConfig(project)
  });
  console.log(JSON.stringify(result.adminSurfaceSummary, null, 2));
};

main().catch((error) => {
  console.error(`Failed to run crypto ${project} token launch by date limited-prod readiness.`);
  console.error(error);
  process.exit(1);
});
