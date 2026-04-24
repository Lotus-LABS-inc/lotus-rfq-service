#!/usr/bin/env tsx
import {
  getCryptoFdvAfterLaunchProjectConfig,
  type CryptoFdvAfterLaunchProject
} from "../../src/matching/crypto/crypto-fdv-after-launch-assets.js";
import { runCryptoFdvAfterLaunchLimitedProdReadiness } from "../../src/operations/semantic-expansion/crypto-fdv-after-launch-limited-prod-readiness-shared.js";

const project = process.argv[2] as CryptoFdvAfterLaunchProject | undefined;
if (!project) {
  console.error("Usage: tsx scripts/reports/report-crypto-fdv-after-launch-limited-prod-readiness.ts <EXTENDED|METAMASK|OPENSEA|REYA>");
  process.exit(1);
}

const main = async (): Promise<void> => {
  const result = await runCryptoFdvAfterLaunchLimitedProdReadiness({
    repoRoot: process.cwd(),
    config: getCryptoFdvAfterLaunchProjectConfig(project)
  });
  console.log(JSON.stringify(result.adminSurfaceSummary, null, 2));
};

main().catch((error) => {
  console.error(`Failed to run crypto ${project} FDV after launch limited-prod readiness.`);
  console.error(error);
  process.exit(1);
});
