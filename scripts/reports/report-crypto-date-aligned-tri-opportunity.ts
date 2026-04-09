#!/usr/bin/env tsx
import { buildCryptoDateAlignedTriOpportunitySummary } from "../../src/operations/semantic-expansion/crypto-date-aligned-tri-opportunity-summary.js";

const main = async (): Promise<void> => {
  const summary = buildCryptoDateAlignedTriOpportunitySummary({
    repoRoot: process.cwd()
  });
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("Failed to build crypto date-aligned tri opportunity summary.");
  console.error(error);
  process.exit(1);
});

