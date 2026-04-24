#!/usr/bin/env tsx
import {
  getCryptoFdvAfterLaunchProjectConfig,
  type CryptoFdvAfterLaunchProject
} from "../../src/matching/crypto/crypto-fdv-after-launch-assets.js";
import { runCryptoFdvAfterLaunchMatcherPass } from "../../src/reports/crypto-fdv-after-launch-shared.js";

const project = process.argv[2] as CryptoFdvAfterLaunchProject | undefined;
if (!project) {
  console.error("Usage: tsx scripts/reports/report-crypto-fdv-after-launch-matcher.ts <EXTENDED|METAMASK|OPENSEA|REYA>");
  process.exit(1);
}

const main = async (): Promise<void> => {
  const result = await runCryptoFdvAfterLaunchMatcherPass({
    repoRoot: process.cwd(),
    config: getCryptoFdvAfterLaunchProjectConfig(project)
  });
  console.log(JSON.stringify(result.finalDecision, null, 2));
};

main().catch((error) => {
  console.error(`Failed to run crypto ${project} FDV after launch matcher.`);
  console.error(error);
  process.exit(1);
});
