#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { MatchingPipeline } from "../../src/matching/matching-pipeline.js";
import { PairEdgeRepository } from "../../src/repositories/pair-edge.repository.js";
import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-pair-matching-graph"
  });

  try {
    const pipeline = new MatchingPipeline(new PairEdgeRepository(pool));
    const result = await pipeline.run();
    writeArtifact(process.cwd(), "docs/pair-matching-sync-summary.json", {
      observedAt: new Date().toISOString(),
      matchingVersionId: result.matchingVersion.id,
      markets: result.markets.length,
      pairEdges: result.pairEdges.length,
      triCandidates: result.triCandidates.length
    });
    console.log(JSON.stringify({
      matchingVersionId: result.matchingVersion.id,
      markets: result.markets.length,
      pairEdges: result.pairEdges.length,
      triCandidates: result.triCandidates.length
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync pair matching graph.");
  console.error(error);
  process.exit(1);
});
