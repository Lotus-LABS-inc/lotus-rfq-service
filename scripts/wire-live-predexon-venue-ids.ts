#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../src/canonical/canonical-graph-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../src/canonical/curated-canonical-graph.js";
import { CanonicalGraphRepository } from "../src/repositories/canonical-graph.repository.js";
import { CANONICAL_MARKET_REWRITE_SPEC } from "../src/simulation/canonical-market-rewrite-spec.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

type Venue = "POLYMARKET";

interface LiveVenueMapping {
  venue: Venue;
  canonicalEventId: string;
  canonicalCategory: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";
  canonicalMarketId: string;
  venueMarketId: string;
  title: string;
}

const LIVE_MAPPINGS: readonly LiveVenueMapping[] = [
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[0]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[0]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN",
    venueMarketId: "0x0954cc08de0ab8345bcf24f314d571e6a77d913ea9977ce2b4187983a70b450d",
    title: "Lakers vs. Magic"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[1]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[1]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31",
    venueMarketId: "0x3fd88dc4dde49dd20ceade22fda96dc345aa6932c46237ff7f47352e49475588",
    title: "Bitcoin all time high by March 31, 2026?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[2]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[2]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-2028-DEM-NOM-GAVIN-NEWSOM",
    venueMarketId: "0x0f49db97f71c68b1e42a6d16e3de93d85dbf7d4148e3f018eb79e88554be9f75",
    title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[3]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[3]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-2028-GOP-NOM-MIKE-PENCE",
    venueMarketId: "0x41c6341dd79903aca4bb0c29f5a7976946c3774d2fd72f38cbb7de7092144520",
    title: "Will Mike Pence win the 2028 Republican presidential nomination?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[4]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[4]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-LOL-WORLDS-2026-LCK-TEAM-WINS",
    venueMarketId: "0xbfc776a7f419fdc9bec5f026cb6bd115db75e22664f5d99873e4c330676015f8",
    title: "Will a team from LCK (South Korea) win LoL Worlds 2026?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[5]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[5]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-LOL-2026-GENG-GOLDEN-ROAD",
    venueMarketId: "0xfd17453f83cd10bf3fa5fc46b30d23a7abc3d66da7aa3dc961187d30506573db",
    title: "Will Gen.G complete the League of Legends \"Golden Road\" in 2026?"
  }
] as const;

const metadataVersion = process.env.PREDEXON_METADATA_VERSION ?? "predexon-v2";

const toCanonicalSeed = (mapping: LiveVenueMapping): CuratedCanonicalGraphSeed => ({
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
  resolutionSource: mapping.venue,
  resolutionTitle: mapping.title,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "unknown",
  rawSourcePayload: {
    source: "wire-live-predexon-venue-ids"
  },
  normalizedPayload: {
    canonicalEventId: mapping.canonicalEventId,
    canonicalMarketId: mapping.canonicalMarketId
  },
  mappingLineage: ["wire-live-predexon-venue-ids"],
  sourceMetadataVersion: metadataVersion,
  eventPropositionKey: `curated-live:${mapping.canonicalMarketId}`,
  propositionHints: {
    normalizedPropositionText: mapping.title
  },
  executableDisplayName: mapping.title,
  executableMetadata: {
    source: "wire-live-predexon-venue-ids"
  }
});

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    application_name: "wire-live-predexon-venue-ids"
  });

  try {
    const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
    const projector = new CanonicalGraphProjector(new CanonicalGraphRepository(pool));
    const snapshot = snapshotBuilder.build(LIVE_MAPPINGS.map(toCanonicalSeed));
    await projector.persistAndProject(snapshot);
    for (const mapping of LIVE_MAPPINGS) {
      console.log(JSON.stringify(mapping));
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Failed to wire live Predexon venue IDs.");
  console.error(error);
  process.exit(1);
});
