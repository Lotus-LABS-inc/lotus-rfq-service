#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../src/canonical/canonical-graph-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../src/canonical/curated-canonical-graph.js";
import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput
} from "../src/core/historical-simulation/historical-simulation.types.js";
import { CanonicalGraphRepository } from "../src/repositories/canonical-graph.repository.js";
import { HistoricalMarketStateRepository } from "../src/repositories/historical-market-state.repository.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to sync live Predexon mappings.");
}

type LiveVenue = "POLYMARKET" | "LIMITLESS" | "OPINION";
type LiveCategory = "CRYPTO" | "POLITICS";

interface LiveMappingSeed {
  resolutionProfileId: string;
  canonicalEventId: string;
  canonicalMarketId: string;
  canonicalCategory: LiveCategory;
  venue: LiveVenue;
  venueMarketId: string;
  title: string;
  seededTimestamp: string;
}

const metadataVersion = "predexon-live-mapping-seed-v1";

// Live identifiers below were validated against the active official venue catalogs on 2026-03-19.
const liveMappings: readonly LiveMappingSeed[] = [
  {
    resolutionProfileId: "7e04af6d-e649-4a33-8780-4d376331a111",
    canonicalEventId: "6c6ca772-bf16-49f9-a4d5-b3b4fb26a111",
    canonicalMarketId: "LIVE-POLYMARKET-BTC-UPDOWN-2026-03-21",
    canonicalCategory: "CRYPTO",
    venue: "POLYMARKET",
    venueMarketId: "0xd1436b9fb82e252c5a1482c33920e68ff6e64c977ff1bec70585ce6586321917",
    title: "Bitcoin Up or Down on March 21?",
    seededTimestamp: "2026-03-19T16:06:08.883Z"
  },
  {
    resolutionProfileId: "7e04af6d-e649-4a33-8780-4d376331a222",
    canonicalEventId: "6c6ca772-bf16-49f9-a4d5-b3b4fb26a222",
    canonicalMarketId: "LIVE-LIMITLESS-BTC-ABOVE-2026-03-19T20Z",
    canonicalCategory: "CRYPTO",
    venue: "LIMITLESS",
    venueMarketId: "btc-above-dollar6982012-on-mar-19-2000-utc-1773946806488",
    title: "BTC above $69820.12 on Mar 19, 20:00 UTC?",
    seededTimestamp: "2026-03-19T19:00:00.000Z"
  },
  {
    resolutionProfileId: "7e04af6d-e649-4a33-8780-4d376331a333",
    canonicalEventId: "6c6ca772-bf16-49f9-a4d5-b3b4fb26a333",
    canonicalMarketId: "LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF",
    canonicalCategory: "POLITICS",
    venue: "OPINION",
    venueMarketId: "6808",
    title: "Democratic Presidential Nominee 2028: Jon Ossoff",
    seededTimestamp: "2026-02-06T00:00:00.000Z"
  }
] as const;

const toSeedState = (mapping: LiveMappingSeed): CreateHistoricalMarketStateInput => ({
  canonicalEventId: mapping.canonicalEventId,
  canonicalMarketId: mapping.canonicalMarketId,
  canonicalCategory: mapping.canonicalCategory,
  venue: mapping.venue,
  venueMarketId: mapping.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date(mapping.seededTimestamp),
  metadataVersion,
  sourceTimestamp: new Date(mapping.seededTimestamp),
  lastPrice: "0.5",
  orderbookSnapshot: {
    seeded: true,
    title: mapping.title
  }
});

const toCanonicalSeed = (mapping: LiveMappingSeed): CuratedCanonicalGraphSeed => ({
  canonicalEventId: mapping.canonicalEventId,
  canonicalMarketId: mapping.canonicalMarketId,
  canonicalCategory: mapping.canonicalCategory,
  venue: mapping.venue,
  venueMarketId: mapping.venueMarketId,
  title: mapping.title,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomeSchema: { yes: true, no: true },
  topics: [mapping.canonicalCategory.toLowerCase()],
  publishedAt: new Date(mapping.seededTimestamp),
  resolutionSource: mapping.venue,
  resolutionTitle: mapping.title,
  resolutionAuthorityType: "CENTRAL",
  disputeWindowHours: null,
  settlementType: "unknown",
  settlementLagHours: null,
  rawSourcePayload: {
    seeded: true,
    source: "sync-live-predexon-mappings",
    resolutionProfileId: mapping.resolutionProfileId
  },
  normalizedPayload: {
    canonicalEventId: mapping.canonicalEventId,
    canonicalMarketId: mapping.canonicalMarketId,
    category: mapping.canonicalCategory
  },
  mappingLineage: ["sync-live-predexon-mappings"],
  sourceMetadataVersion: metadataVersion,
  eventPropositionKey: `curated-live:${mapping.canonicalMarketId}`,
  propositionHints: {
    normalizedPropositionText: mapping.title,
    groupingHints: {
      canonicalMarketId: mapping.canonicalMarketId,
      resolutionProfileId: mapping.resolutionProfileId
    }
  },
  executableDisplayName: mapping.title,
  executableMetadata: {
    source: "sync-live-predexon-mappings",
    seeded: true
  }
});

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-live-predexon-mappings"
  });

  try {
    const repository = new HistoricalMarketStateRepository(pool);
    const graphRepository = new CanonicalGraphRepository(pool);
    const projector = new CanonicalGraphProjector(graphRepository);
    const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
    await projector.persistAndProject(snapshotBuilder.build(liveMappings.map(toCanonicalSeed)));

    const seedResult = await repository.insertManyIgnoreDuplicates(liveMappings.map(toSeedState));

    console.log("Synced live Predexon mappings.");
    console.log(`Canonical graph profiles upserted: ${liveMappings.length}`);
    console.log(`Category anchor rows inserted: ${seedResult.inserted}`);
    console.log(`Category anchor rows skipped: ${seedResult.skipped}`);
    for (const mapping of liveMappings) {
      console.log(
        `${mapping.venue} ${mapping.canonicalEventId} ${mapping.canonicalMarketId} -> ${mapping.venueMarketId}`
      );
    }
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync live Predexon mappings.");
  console.error(error);
  process.exit(1);
});
