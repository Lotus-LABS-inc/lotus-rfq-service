#!/usr/bin/env tsx
import { buildOpinionConstrainedTriOpportunitySummary } from "../../src/operations/semantic-expansion/opinion-constrained-tri-opportunity-summary.js";

const main = async (): Promise<void> => {
  const summary = buildOpinionConstrainedTriOpportunitySummary({
    repoRoot: process.cwd()
  });
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("Failed to build Opinion-constrained tri opportunity summary.");
  console.error(error);
  process.exit(1);
});

