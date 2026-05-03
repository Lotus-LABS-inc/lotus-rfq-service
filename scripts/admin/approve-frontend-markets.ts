import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { buildStableUuid } from "../../src/canonical/canonicalization-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

type ApprovalStatus = "APPROVED" | "HIDDEN" | "DISABLED";

interface Options {
  eventIds: string[];
  propositionKeys: string[];
  search: string | null;
  category: string | null;
  fromHistoricalRouteCandidates: boolean;
  artifactPath: string;
  status: ApprovalStatus;
  actor: string;
  reason: string;
  displayTitle: string | null;
  sortPriority: number;
  limit: number;
  dryRun: boolean;
}

interface Candidate {
  canonicalEventId: string;
  displayTitle: string | null;
  source: string;
}

interface HistoricalRouteCandidatesArtifact {
  candidates?: Array<{
    historicalCanonicalEventId?: string;
    title?: string;
  }>;
}

const parseArgs = (): Options => {
  const options: Options = {
    eventIds: [],
    propositionKeys: [],
    search: null,
    category: null,
    fromHistoricalRouteCandidates: false,
    artifactPath: "docs/historical-route-candidates.json",
    status: "APPROVED",
    actor: process.env.FRONTEND_MARKET_APPROVAL_ACTOR ?? "operator",
    reason: process.env.FRONTEND_MARKET_APPROVAL_REASON ?? "operator-approved frontend market scope",
    displayTitle: null,
    sortPriority: 1000,
    limit: 20,
    dryRun: false
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--from-historical-route-candidates") {
      options.fromHistoricalRouteCandidates = true;
      continue;
    }
    const [rawKey, ...rest] = arg.replace(/^--/, "").split("=");
    const value = rest.join("=");
    if (rawKey === "event-id" && value) options.eventIds.push(value);
    else if (rawKey === "proposition-key" && value) options.propositionKeys.push(value);
    else if (rawKey === "search" && value) options.search = value;
    else if (rawKey === "category" && value) options.category = value.toUpperCase();
    else if (rawKey === "artifact" && value) options.artifactPath = value;
    else if (rawKey === "actor" && value) options.actor = value;
    else if (rawKey === "reason" && value) options.reason = value;
    else if (rawKey === "display-title" && value) options.displayTitle = value;
    else if (rawKey === "sort-priority" && value) options.sortPriority = parsePositiveInt("sort-priority", value);
    else if (rawKey === "limit" && value) options.limit = parsePositiveInt("limit", value);
    else if (rawKey === "status" && isApprovalStatus(value)) options.status = value;
    else throw new Error(`Unknown or invalid argument: ${arg}`);
  }

  if (!options.actor.trim()) throw new Error("actor is required.");
  if (!options.reason.trim()) throw new Error("reason is required.");
  if (
    options.eventIds.length === 0 &&
    options.propositionKeys.length === 0 &&
    !options.search &&
    !options.fromHistoricalRouteCandidates
  ) {
    throw new Error("Provide --event-id, --proposition-key, --search, or --from-historical-route-candidates.");
  }
  return options;
};

const parsePositiveInt = (name: string, value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
};

const isApprovalStatus = (value: string): value is ApprovalStatus =>
  value === "APPROVED" || value === "HIDDEN" || value === "DISABLED";

const loadArtifactCandidates = (repoRoot: string, artifactPath: string): Candidate[] => {
  const absolutePath = path.resolve(repoRoot, artifactPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as HistoricalRouteCandidatesArtifact;
  return (parsed.candidates ?? [])
    .filter((candidate) => typeof candidate.historicalCanonicalEventId === "string")
    .map((candidate) => ({
      canonicalEventId: buildStableUuid(`limitless-targeted-event:${candidate.historicalCanonicalEventId}`),
      displayTitle: typeof candidate.title === "string" ? candidate.title : null,
      source: artifactPath
    }));
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    application_name: "approve-frontend-markets"
  });

  try {
    const candidates = new Map<string, Candidate>();
    for (const eventId of options.eventIds) {
      candidates.set(eventId, { canonicalEventId: eventId, displayTitle: options.displayTitle, source: "event-id" });
    }
    if (options.fromHistoricalRouteCandidates) {
      for (const candidate of loadArtifactCandidates(process.cwd(), options.artifactPath)) {
        candidates.set(candidate.canonicalEventId, candidate);
      }
    }

    if (options.propositionKeys.length > 0 || options.search || options.category) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (options.propositionKeys.length > 0) {
        params.push(options.propositionKeys);
        conditions.push(`ce.proposition_key = ANY($${params.length}::text[])`);
      }
      if (options.search) {
        params.push(`%${options.search.toLowerCase()}%`);
        conditions.push(`(lower(ce.title) LIKE $${params.length} OR lower(ce.normalized_proposition_text) LIKE $${params.length})`);
      }
      if (options.category) {
        params.push(options.category);
        conditions.push(`ce.canonical_category = $${params.length}`);
      }
      params.push(options.limit);
      const result = await pool.query<{ id: string; title: string }>(
        `SELECT ce.id::text AS id, ce.title
           FROM canonical_events ce
          WHERE ${conditions.join(" AND ")}
          ORDER BY ce.updated_at DESC, ce.title ASC
          LIMIT $${params.length}`,
        params
      );
      for (const row of result.rows) {
        candidates.set(row.id, { canonicalEventId: row.id, displayTitle: options.displayTitle ?? row.title, source: "db-selector" });
      }
    }

    const existing = await pool.query<{ id: string; title: string; canonical_category: string }>(
      `SELECT id::text, title, canonical_category
         FROM canonical_events
        WHERE id = ANY($1::uuid[])
        ORDER BY canonical_category, title`,
      [[...candidates.keys()]]
    );
    const existingIds = new Set(existing.rows.map((row) => row.id));
    const missing = [...candidates.keys()].filter((id) => !existingIds.has(id));

    if (!options.dryRun && existing.rows.length > 0) {
      for (const row of existing.rows) {
        const candidate = candidates.get(row.id);
        await pool.query(
          `INSERT INTO frontend_market_approvals (
             canonical_event_id,
             status,
             display_title,
             sort_priority,
             approved_by,
             approval_reason,
             metadata,
             approved_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
           ON CONFLICT (canonical_event_id) DO UPDATE SET
             status = EXCLUDED.status,
             display_title = EXCLUDED.display_title,
             sort_priority = EXCLUDED.sort_priority,
             approved_by = EXCLUDED.approved_by,
             approval_reason = EXCLUDED.approval_reason,
             metadata = EXCLUDED.metadata,
             approved_at = now(),
             updated_at = now()`,
          [
            row.id,
            options.status,
            candidate?.displayTitle ?? options.displayTitle,
            options.sortPriority,
            options.actor,
            options.reason,
            JSON.stringify({ source: candidate?.source ?? "manual" })
          ]
        );
      }
    }

    const target = new URL(databaseUrl);
    console.log(JSON.stringify({
      database: { host: target.hostname, database: target.pathname.replace(/^\//, "") },
      dryRun: options.dryRun,
      status: options.status,
      matched: existing.rows,
      missing,
      mutated: options.dryRun ? 0 : existing.rows.length
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
