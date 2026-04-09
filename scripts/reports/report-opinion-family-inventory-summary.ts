#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { OpinionClient } from "../../src/integrations/opinion/opinion-client.js";
import { buildOpinionFamilyInventoryMap } from "../../src/integrations/opinion/opinion-family-inventory-map.js";
import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const opinionApiKey = process.env.OPINION_API_KEY;
  const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";
  if (!opinionApiKey) {
    throw new Error("OPINION_API_KEY is required.");
  }

  const summary = await buildOpinionFamilyInventoryMap({
    client: new OpinionClient({
      baseUrl: opinionBaseUrl,
      apiKey: opinionApiKey
    })
  });

  writeArtifact(process.cwd(), "docs/opinion-family-inventory-summary.json", summary.summary);
  console.log(JSON.stringify(summary.summary, null, 2));
};

main().catch((error) => {
  console.error("Failed to build Opinion family inventory summary.");
  console.error(error);
  process.exit(1);
});

