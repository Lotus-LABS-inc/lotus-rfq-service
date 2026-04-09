#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { runBtcLimitlessCounterpartProofAudit } from "../../src/operations/semantic-expansion/btc-limitless-counterpart-proof-audit.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const opinionApiKey = process.env.OPINION_API_KEY;
  const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";
  const limitlessApiKey = process.env.LIMITLESS_API_KEY ?? null;
  const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";

  if (!opinionApiKey) {
    throw new Error("OPINION_API_KEY is required.");
  }

  const result = await runBtcLimitlessCounterpartProofAudit({
    repoRoot: process.cwd(),
    opinionBaseUrl,
    opinionApiKey,
    limitlessBaseUrl,
    limitlessApiKey
  });
  console.log(JSON.stringify(result.classificationCounts, null, 2));
};

main().catch((error) => {
  console.error("Failed to build BTC Limitless counterpart proof audit.");
  console.error(error);
  process.exit(1);
});

