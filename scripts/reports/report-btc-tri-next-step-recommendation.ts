#!/usr/bin/env tsx
import { runBtcTriNextStepRecommendation } from "../../src/operations/semantic-expansion/btc-tri-next-step-recommendation.js";

const main = (): void => {
  const result = runBtcTriNextStepRecommendation({
    repoRoot: process.cwd()
  });
  console.log(JSON.stringify(result, null, 2));
};

try {
  main();
} catch (error) {
  console.error("Failed to build BTC tri next-step recommendation.");
  console.error(error);
  process.exit(1);
}

