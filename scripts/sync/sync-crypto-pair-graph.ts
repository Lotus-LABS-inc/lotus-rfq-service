#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../src/operations/semantic-expansion/shared.js";
import { CryptoMatchingPipeline } from "../src/matching/crypto/crypto-matching-pipeline.js";
import { listRouteableCryptoPairEdges } from "../src/matching/crypto/crypto-pair-graph.js";
import { PairEdgeRepository } from "../src/repositories/pair-edge.repository.js";

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
    application_name: "sync-crypto-pair-graph"
  });

  try {
    const pipeline = new CryptoMatchingPipeline(new PairEdgeRepository(pool));
    const result = await pipeline.run();
    const routeablePairs = listRouteableCryptoPairEdges(result.pairGraph);
    const triFamilyPairs = new Map<string, Set<string>>();
    for (const edge of routeablePairs) {
      const venuePair = edge.leftVenue.localeCompare(edge.rightVenue) <= 0
        ? `${edge.leftVenue}_${edge.rightVenue}`
        : `${edge.rightVenue}_${edge.leftVenue}`;
      const pairs = triFamilyPairs.get(edge.family) ?? new Set<string>();
      pairs.add(venuePair);
      triFamilyPairs.set(edge.family, pairs);
    }
    const summary = {
      observedAt: new Date().toISOString(),
      matchingVersionId: result.matchingVersion.id,
      sourceCryptoMarkets: result.classifiedMarkets.length,
      btcMarkets: result.btcMarkets.length,
      pairEdges: result.pairEdges.length,
      exactSafeApprovedEdges: routeablePairs.length,
      routeablePairsByFamily: routeablePairs.reduce<Record<string, number>>((accumulator, edge) => {
        accumulator[edge.family] = (accumulator[edge.family] ?? 0) + 1;
        return accumulator;
      }, {}),
      routeablePairsByVenuePair: routeablePairs.reduce<Record<string, number>>((accumulator, edge) => {
        const key = edge.leftVenue.localeCompare(edge.rightVenue) <= 0
          ? `${edge.leftVenue}_${edge.rightVenue}`
          : `${edge.rightVenue}_${edge.leftVenue}`;
        accumulator[key] = (accumulator[key] ?? 0) + 1;
        return accumulator;
      }, {}),
      triCapableFamilies: [...triFamilyPairs.entries()].filter(([, pairs]) => pairs.size === 3).map(([family]) => family)
    };
    writeArtifact(process.cwd(), "docs/crypto-pair-matching-sync-summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync crypto pair graph.");
  console.error(error);
  process.exit(1);
});
