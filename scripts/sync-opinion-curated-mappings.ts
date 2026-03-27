#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { Pool } from "pg";
import { z } from "zod";

import { CanonicalGraphProjector } from "../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../src/canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../src/canonical/curated-canonical-graph.js";
import { CanonicalCompatibilityRepository } from "../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../src/repositories/compatibility-version.repository.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const predexonApiKey = process.env.PREDEXON_API_KEY;
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}

const curationPath = path.resolve(process.cwd(), "docs", "predexon-opinion-id-curation.json");

const curationEntrySchema = z.object({
  resolutionProfileId: z.string().uuid(),
  canonicalEventId: z.string(),
  canonicalMarketId: z.string(),
  category: z.enum(["SPORTS", "CRYPTO", "POLITICS", "ESPORTS"]),
  currentVenueMarketId: z.string(),
  currentResolutionText: z.string(),
  crossVenueAssessment: z.object({
    status: z.enum(["exact", "inconsistent"]),
    currentVenueMeanings: z.array(
      z.object({
        venue: z.enum(["POLYMARKET", "LIMITLESS", "OPINION"]),
        venueMarketId: z.string(),
        title: z.string()
      })
    )
  }),
  decision: z.object({
    status: z.enum(["accepted", "unresolved"]),
    reasonCode: z.string(),
    reason: z.string()
  }),
  searchedSources: z.array(
    z.object({
      type: z.enum(["public_site", "search_query", "predexon_validation"]),
      reference: z.string(),
      observation: z.string()
    })
  ),
  rejectedCandidates: z.array(
    z.object({
      marketId: z.string(),
      title: z.string(),
      reasonCode: z.string(),
      reason: z.string()
    })
  ),
  acceptedCandidate: z
    .object({
      marketId: z.string().regex(/^\d+$/),
      title: z.string(),
      evidenceReference: z.string()
    })
    .optional()
});

const curationSchema = z.object({
  version: z.number().int().positive(),
  observedAt: z.string(),
  policy: z.object({
    matchRule: z.string(),
    acceptedVenueMarketIdShape: z.string(),
    predexonValidation: z.object({
      endpoint: z.string(),
      successCriteria: z.string()
    }),
    mutationRule: z.string()
  }),
  pairs: z.array(curationEntrySchema)
});

type CurationEntry = z.infer<typeof curationEntrySchema>;

const loadCuration = (): z.infer<typeof curationSchema> =>
  curationSchema.parse(JSON.parse(readFileSync(curationPath, "utf8")));

const metadataVersion = process.env.PREDEXON_METADATA_VERSION ?? "predexon-v2";

const toCanonicalSeed = (entry: CurationEntry): CuratedCanonicalGraphSeed => ({
  canonicalEventId: entry.canonicalEventId,
  canonicalMarketId: entry.canonicalMarketId,
  canonicalCategory: entry.category,
  venue: "OPINION",
  venueMarketId: entry.acceptedCandidate!.marketId,
  title: entry.acceptedCandidate!.title,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomeSchema: { yes: true, no: true },
  topics: [entry.category.toLowerCase()],
  resolutionSource: "OPINION",
  resolutionTitle: entry.acceptedCandidate!.title,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "unknown",
  rawSourcePayload: {
    source: "sync-opinion-curated-mappings",
    evidenceReference: entry.acceptedCandidate!.evidenceReference
  },
  normalizedPayload: {
    canonicalEventId: entry.canonicalEventId,
    canonicalMarketId: entry.canonicalMarketId
  },
  mappingLineage: ["sync-opinion-curated-mappings"],
  sourceMetadataVersion: metadataVersion,
  eventPropositionKey: `curated-opinion:${entry.canonicalMarketId}`,
  propositionHints: {
    normalizedPropositionText: entry.acceptedCandidate!.title
  },
  executableDisplayName: entry.acceptedCandidate!.title,
  executableMetadata: {
    source: "sync-opinion-curated-mappings"
  }
});

const validateAcceptedEntry = async (entry: CurationEntry): Promise<void> => {
  if (!entry.acceptedCandidate) {
    throw new Error(`Accepted entry ${entry.canonicalMarketId} is missing acceptedCandidate.`);
  }

  if (entry.crossVenueAssessment.status !== "exact") {
    throw new Error(`Accepted entry ${entry.canonicalMarketId} must have crossVenueAssessment.status = "exact".`);
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const startSeconds = nowSeconds - 86_400;
  const url = new URL("/v2/opinion/orderbooks", predexonBaseUrl);
  url.searchParams.set("market_id", entry.acceptedCandidate.marketId);
  url.searchParams.set("start_time", String(startSeconds));
  url.searchParams.set("end_time", String(nowSeconds));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": predexonApiKey
    }
  });

  if (response.status !== 200) {
    throw new Error(
      `Predexon validation failed for ${entry.canonicalMarketId} candidate ${entry.acceptedCandidate.marketId}: ${response.status}.`
    );
  }
};

const runOpinionIngestion = (entry: CurationEntry): void => {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 24 * 60 * 60 * 1_000);
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    command,
    [
      "tsx",
      "scripts/ingest-predexon-mapped-historical.ts",
      "--venue=OPINION",
      "--mode=backfill",
      `--category=${entry.category.toLowerCase()}`,
      `--canonicalEventId=${entry.canonicalEventId}`,
      `--canonicalMarketId=${entry.canonicalMarketId}`,
      `--start=${start.toISOString()}`,
      `--end=${end.toISOString()}`
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    throw new Error(`Opinion ingestion failed for ${entry.canonicalMarketId}.`);
  }
};

const main = async (): Promise<void> => {
  const curation = loadCuration();
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-opinion-curated-mappings"
  });
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(pool),
      new CompatibilityVersionRepository(pool)
    )
  );

  let updated = 0;
  let unresolved = 0;

  try {
    for (const entry of curation.pairs) {
      const before = await pool.query<{
        id: string;
        venue_market_id: string;
        primary_resolution_text: string | null;
      }>(
        `SELECT id, venue_market_id, primary_resolution_text
           FROM resolution_profiles
          WHERE id = $1
            AND venue = 'OPINION'
            AND canonical_event_id = $2
            AND canonical_market_id = $3`,
        [entry.resolutionProfileId, entry.canonicalEventId, entry.canonicalMarketId]
      );

      if (before.rowCount !== 1) {
        throw new Error(`Expected exactly one OPINION resolution_profile row for ${entry.canonicalMarketId}.`);
      }

      if (entry.decision.status !== "accepted") {
        unresolved += 1;
        console.log(
          JSON.stringify({
            status: "unresolved",
            canonicalMarketId: entry.canonicalMarketId,
            currentVenueMarketId: before.rows[0]?.venue_market_id,
            reasonCode: entry.decision.reasonCode,
            reason: entry.decision.reason
          })
        );
        continue;
      }

      await validateAcceptedEntry(entry);

      const acceptedCandidate = entry.acceptedCandidate!;
      await pool.query(
        `DELETE FROM resolution_risk_assessments
          WHERE market_a_profile_id = $1::uuid
             OR market_b_profile_id = $1::uuid`,
        [entry.resolutionProfileId]
      );
      await pool.query(`DELETE FROM resolution_profiles WHERE id = $1::uuid`, [entry.resolutionProfileId]);
      await projector.persistAndProject(snapshotBuilder.build([toCanonicalSeed(entry)]));

      runOpinionIngestion(entry);

      const verification = await pool.query<{ row_count: string }>(
        `SELECT COUNT(*)::text AS row_count
           FROM historical_market_states
          WHERE venue = 'OPINION'
            AND canonical_event_id = $1
            AND canonical_market_id = $2
            AND venue_market_id = $3`,
        [entry.canonicalEventId, entry.canonicalMarketId, acceptedCandidate.marketId]
      );

      const rowCount = Number.parseInt(verification.rows[0]?.row_count ?? "0", 10);
      if (rowCount <= 0) {
        throw new Error(`No OPINION historical rows were inserted for ${entry.canonicalMarketId}.`);
      }

      updated += 1;
      console.log(
        JSON.stringify({
          status: "accepted",
          canonicalMarketId: entry.canonicalMarketId,
          venueMarketId: acceptedCandidate.marketId,
          insertedRows: rowCount
        })
      );
    }

    console.log(JSON.stringify({ updated, unresolved, curationPath }));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync curated Opinion mappings.");
  console.error(error);
  process.exit(1);
});
