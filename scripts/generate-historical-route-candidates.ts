#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import {
  historicalRouteCandidatesSchema,
  type HistoricalCatalogManifestEntry
} from "../src/simulation/historical-route-catalog-manifest.js";

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

interface CandidateRow {
  canonical_event_id: string;
  canonical_market_id: string;
  venue: "POLYMARKET" | "LIMITLESS" | "OPINION";
  venue_market_id: string;
  primary_resolution_text: string | null;
  canonical_category: string | null;
  min_timestamp: Date | null;
  max_timestamp: Date | null;
}

const resolveHistorySource = (venue: CandidateRow["venue"]): "predexon_polymarket" | "predexon_limitless" | "predexon_opinion" => {
  switch (venue) {
    case "POLYMARKET":
      return "predexon_polymarket";
    case "LIMITLESS":
      return "predexon_limitless";
    case "OPINION":
      return "predexon_opinion";
  }
};

const buildHistoricalEventId = (canonicalMarketId: string): string => `HISTSIM::${canonicalMarketId}`;
const buildHistoricalMarketId = (canonicalMarketId: string): string => `HISTSIM-${canonicalMarketId}`;

const defaultWindow = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 24 * 60 * 60 * 1_000);
  return { start, end };
};

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "generate-historical-route-candidates"
  });

  try {
    const result = await pool.query<CandidateRow>(
      `WITH latest_state_category AS (
         SELECT DISTINCT ON (canonical_event_id, canonical_market_id, venue, venue_market_id)
                canonical_event_id,
                canonical_market_id,
                venue,
                venue_market_id,
                canonical_category
           FROM historical_market_states
          ORDER BY canonical_event_id, canonical_market_id, venue, venue_market_id, "timestamp" DESC
       ),
       state_windows AS (
         SELECT venue,
                venue_market_id,
                MIN("timestamp") AS min_timestamp,
                MAX("timestamp") AS max_timestamp
           FROM historical_market_states
          GROUP BY venue, venue_market_id
       )
       SELECT
         rp.canonical_event_id::text AS canonical_event_id,
         rp.canonical_market_id,
         rp.venue,
         rp.venue_market_id,
         rp.primary_resolution_text,
         COALESCE(ls.canonical_category, UPPER(NULLIF(rp.metadata->>'canonicalCategory', ''))) AS canonical_category,
         sw.min_timestamp,
         sw.max_timestamp
       FROM resolution_profiles rp
       LEFT JOIN latest_state_category ls
         ON ls.canonical_event_id::text = rp.canonical_event_id::text
        AND ls.canonical_market_id = rp.canonical_market_id
        AND ls.venue = rp.venue
        AND ls.venue_market_id = rp.venue_market_id
       LEFT JOIN state_windows sw
         ON sw.venue = rp.venue
        AND sw.venue_market_id = rp.venue_market_id
      ORDER BY rp.canonical_market_id, rp.venue`
    );

    const grouped = new Map<string, CandidateRow[]>();
    for (const row of result.rows) {
      const key = `${row.canonical_event_id}|${row.canonical_market_id}`;
      const current = grouped.get(key) ?? [];
      current.push(row);
      grouped.set(key, current);
    }

    const candidates: HistoricalCatalogManifestEntry[] = [...grouped.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([, rows]) => {
        const first = rows[0]!;
        return {
          historicalCanonicalEventId: buildHistoricalEventId(first.canonical_market_id),
          historicalCanonicalMarketId: buildHistoricalMarketId(first.canonical_market_id),
          canonicalCategory: (
            first.canonical_category === "SPORTS" ||
            first.canonical_category === "CRYPTO" ||
            first.canonical_category === "POLITICS" ||
            first.canonical_category === "ESPORTS" ||
            first.canonical_category === "OTHER"
          ) ? first.canonical_category : "OTHER",
          title: first.primary_resolution_text ?? first.canonical_market_id,
          decision: {
            status: "unresolved",
            reasonCode: "awaiting_curated_approval",
            reason: "Candidate generated from existing inventory and requires explicit historical curation approval."
          },
          discoveredFrom: [
            {
              type: "db_inventory",
              reference: `${first.canonical_event_id}:${first.canonical_market_id}`,
              observation: "Generated from existing live resolution_profiles and historical row windows."
            }
          ],
          venueProfiles: rows.map((row) => {
            const fallbackWindow = defaultWindow();
            return {
              venue: row.venue,
              venueMarketId: row.venue_market_id,
              title: row.primary_resolution_text ?? row.canonical_market_id,
              historySource: resolveHistorySource(row.venue),
              historyWindow: {
                start: (row.min_timestamp ?? fallbackWindow.start).toISOString(),
                end: (row.max_timestamp ?? fallbackWindow.end).toISOString()
              },
              copyFromLiveResolutionProfile: true
            };
          }),
          acceptedAssessments: []
        };
      });

    const payload = historicalRouteCandidatesSchema.parse({
      version: 1,
      observedAt: new Date().toISOString(),
      policy: {
        exactMatchRule: "exact_semantic_equivalence_only",
        approvalMode: "checked_in_curated_manifest",
        catalogScope: "historical_simulation"
      },
      candidates
    });

    const outputPath = path.resolve(process.cwd(), "docs", "historical-route-candidates.json");
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ outputPath, candidateCount: payload.candidates.length }));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to generate historical route candidates.");
  console.error(error);
  process.exit(1);
});
