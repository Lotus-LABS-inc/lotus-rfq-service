import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

loadDotenv();

const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL, DATABASE_URL, or TEST_DATABASE_URL is required to generate the market quote readiness drift report.");
}

const artifactDir = join(process.cwd(), "artifacts", "shared", "optional");
const pool = new Pool({
  connectionString: databaseUrl,
  ...(requiresSsl(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {}),
  connectionTimeoutMillis: 30_000
});

interface BlockerRow {
  venue: string;
  reason: string;
  affected_markets: string;
  affected_raw_snapshot_ids: string;
  latest_quote_at: Date | null;
}

interface AllBlockedRow {
  canonical_market_id: string;
  raw_canonical_market_ids: string[] | null;
  venues: string[];
  blockers: unknown;
  latest_quote_at: Date | null;
}

interface Report {
  generatedAt: string;
  sourceTable: string;
  activeLookbackMinutes: number;
  blockerGroups: Array<{
    venue: string;
    reason: string;
    affectedMarkets: number;
    affectedRawSnapshotIds: number;
    latestQuoteAt: string | null;
  }>;
  allBlockedMarkets: Array<{
    canonicalMarketId: string;
    rawCanonicalMarketIds: string[];
    venues: string[];
    blockers: Array<{ venue: string; reason: string }>;
    latestQuoteAt: string | null;
  }>;
  safetyNotes: string[];
}

const ACTIVE_LOOKBACK_MINUTES = 30;

function requiresSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes("supabase.") || url.hostname.includes("pooler.supabase.com") || url.searchParams.has("sslmode");
  } catch {
    return false;
  }
}

function renderMarkdown(report: Report): string {
  return [
    "# Market Quote Readiness Drift",
    "",
    `Generated: ${report.generatedAt}`,
    `Source table: ${report.sourceTable}`,
    `Active blocker lookback: ${report.activeLookbackMinutes} minutes`,
    "",
    "## Blocker Groups",
    "",
    ...renderBlockerGroups(report),
    "",
    "## All-Blocked Markets",
    "",
    ...renderAllBlockedMarkets(report),
    "",
    "## Safety Notes",
    "",
    ...report.safetyNotes.map((note) => `- ${note}`),
    ""
  ].join("\n");
}

function renderBlockerGroups(report: Report): string[] {
  if (report.blockerGroups.length === 0) {
    return ["- none"];
  }
  return report.blockerGroups.map((row) =>
    `- ${row.venue} / ${row.reason}: ${row.affectedMarkets} markets` +
    `${row.affectedRawSnapshotIds !== row.affectedMarkets ? ` (${row.affectedRawSnapshotIds} raw snapshot ids)` : ""}` +
    `${row.latestQuoteAt ? `, latest ${row.latestQuoteAt}` : ""}`);
}

function renderAllBlockedMarkets(report: Report): string[] {
  if (report.allBlockedMarkets.length === 0) {
    return ["- none"];
  }
  return report.allBlockedMarkets.map((row) =>
    `- ${row.canonicalMarketId}: ${row.venues.join(", ")} blocked by ${row.blockers.map((blocker) => `${blocker.venue}:${blocker.reason}`).join("; ")}`);
}

function parseBlockers(value: unknown): Array<{ venue: string; reason: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    const venue = typeof record.venue === "string" ? record.venue.trim().toUpperCase() : "";
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    return venue && reason ? [{ venue, reason }] : [];
  });
}

try {
  const [blockerGroups, allBlockedMarkets] = await Promise.all([
    pool.query<BlockerRow>(
      `WITH latest_blockers AS (
         SELECT regexp_replace(canonical_market_id, ':(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$', '') AS normalized_canonical_market_id,
                canonical_market_id,
                venue,
                jsonb_array_elements_text(blockers) AS reason,
                received_at
           FROM venue_orderbook_latest_snapshots
          WHERE jsonb_array_length(blockers) > 0
            AND received_at >= now() - ($1::int * interval '1 minute')
       )
       SELECT venue,
              reason,
              COUNT(DISTINCT normalized_canonical_market_id)::text AS affected_markets,
              COUNT(DISTINCT canonical_market_id)::text AS affected_raw_snapshot_ids,
              MAX(received_at) AS latest_quote_at
         FROM latest_blockers
        GROUP BY venue, reason
        ORDER BY COUNT(DISTINCT normalized_canonical_market_id) DESC, venue, reason
        LIMIT 100`,
      [ACTIVE_LOOKBACK_MINUTES]
    ),
    pool.query<AllBlockedRow>(
      `WITH annotated AS (
         SELECT regexp_replace(canonical_market_id, ':(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$', '') AS normalized_canonical_market_id,
                canonical_market_id,
                venue,
                received_at,
                COALESCE(jsonb_array_length(blockers), 0) = 0
                  AND COALESCE(midpoint, best_bid, best_ask) IS NOT NULL AS display_ready,
                blockers
          FROM venue_orderbook_latest_snapshots
          WHERE received_at >= now() - ($1::int * interval '1 minute')
       ),
       rolled AS (
         SELECT normalized_canonical_market_id AS canonical_market_id,
                array_agg(DISTINCT canonical_market_id ORDER BY canonical_market_id) AS raw_canonical_market_ids,
                array_agg(DISTINCT venue ORDER BY venue) AS venues,
                COUNT(*) FILTER (WHERE display_ready) AS ready_count,
                jsonb_agg(DISTINCT jsonb_build_object(
                  'venue', venue,
                  'reason', COALESCE(NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(blockers)), ','), ''), 'QUOTE_SNAPSHOT_UNAVAILABLE')
                )) FILTER (WHERE NOT display_ready) AS blockers,
                MAX(received_at) AS latest_quote_at
           FROM annotated
          GROUP BY normalized_canonical_market_id
       )
       SELECT canonical_market_id,
              raw_canonical_market_ids,
              venues,
              COALESCE(blockers, '[]'::jsonb) AS blockers,
              latest_quote_at
         FROM rolled
        WHERE ready_count = 0
        ORDER BY latest_quote_at DESC
        LIMIT 100`,
      [ACTIVE_LOOKBACK_MINUTES]
    )
  ]);

  const report: Report = {
    generatedAt: new Date().toISOString(),
    sourceTable: "venue_orderbook_latest_snapshots",
    activeLookbackMinutes: ACTIVE_LOOKBACK_MINUTES,
    blockerGroups: blockerGroups.rows.map((row) => ({
      venue: row.venue,
      reason: row.reason,
      affectedMarkets: Number(row.affected_markets),
      affectedRawSnapshotIds: Number(row.affected_raw_snapshot_ids),
      latestQuoteAt: row.latest_quote_at?.toISOString() ?? null
    })),
    allBlockedMarkets: allBlockedMarkets.rows.map((row) => ({
      canonicalMarketId: row.canonical_market_id,
      rawCanonicalMarketIds: row.raw_canonical_market_ids ?? [],
      venues: row.venues,
      blockers: parseBlockers(row.blockers),
      latestQuoteAt: row.latest_quote_at?.toISOString() ?? null
    })),
    safetyNotes: [
      "This report is read-only.",
      "Affected market counts normalize venue-suffixed canonical ids before grouping.",
      "Blockers are typed display/readiness evidence only.",
      "Stale or blocked snapshots must never authorize route preview, RFQ accept, or execution submit.",
      "Provider secrets, auth headers, HMACs, signatures, and raw payloads are not included."
    ]
  };

  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "market-quote-readiness-drift-latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(artifactDir, "market-quote-readiness-drift-latest.md"), renderMarkdown(report), "utf8");
  console.log(`Market quote readiness drift report written to ${artifactDir}`);
} finally {
  await pool.end();
}
