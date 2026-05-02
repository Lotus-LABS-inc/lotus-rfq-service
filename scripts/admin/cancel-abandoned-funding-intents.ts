import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool, type PoolClient } from "pg";

loadDotenv();

type FundingIntentStatus = "INTENT_CREATED" | "USER_SIGNATURE_REQUIRED" | "ROUTES_SUBMITTED" | "READY_TO_TRADE" | "CANCELLED" | string;

interface CandidateRow {
  funding_intent_id: string;
  user_id: string;
  status: FundingIntentStatus;
  target_venues: string[];
  route_leg_ids: string[];
  ready_reconciliation_count: string;
}

interface CancelResult {
  fundingIntentId: string;
  userId: string;
  previousStatus: FundingIntentStatus;
  targetVenues: string[];
  routeLegIds: string[];
  alreadyCancelled: boolean;
  cancelled: boolean;
  blocker?: string;
}

const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL, DATABASE_URL, or TEST_DATABASE_URL is required.");
}

const fundingIntentIds = parseList(process.env.ABANDONED_FUNDING_INTENT_IDS);
if (fundingIntentIds.length === 0) {
  throw new Error("ABANDONED_FUNDING_INTENT_IDS is required as a comma-separated list.");
}
const invalidFundingIntentIds = fundingIntentIds.filter((id) => !isUuid(id));
if (invalidFundingIntentIds.length > 0) {
  throw new Error(`ABANDONED_FUNDING_INTENT_IDS contains invalid UUID(s): ${invalidFundingIntentIds.join(", ")}`);
}

const expectedUserId = process.env.ABANDONED_FUNDING_USER_ID?.trim() || null;
const confirm = process.env.CANCEL_ABANDONED_FUNDING_CONFIRM === "YES";
const reason = process.env.CANCEL_ABANDONED_FUNDING_REASON?.trim() || "Operator cancelled abandoned funding intent.";
const generatedAt = new Date().toISOString();
const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifact = {
  generatedAt,
  dryRun: !confirm,
  expectedUserId,
  requestedFundingIntentIds: fundingIntentIds,
  safety: {
    readyToTradeRowsAreBlocked: true,
    readyReconciliationsAreBlocked: true,
    missingRowsFailClosed: true,
    writesRequireConfirmYes: true
  },
  results: [] as CancelResult[]
};

const pool = new Pool({
  connectionString: databaseUrl,
  ...(requiresSsl(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {}),
  connectionTimeoutMillis: Number.parseInt(process.env.SUPABASE_DB_CONNECT_TIMEOUT_MS ?? "30000", 10)
});

try {
  const rows = await loadCandidates(pool, fundingIntentIds);
  const found = new Set(rows.map((row) => row.funding_intent_id));
  for (const id of fundingIntentIds) {
    const row = rows.find((candidate) => candidate.funding_intent_id === id);
    if (!row) {
      artifact.results.push({
        fundingIntentId: id,
        userId: "",
        previousStatus: "MISSING",
        targetVenues: [],
        routeLegIds: [],
        alreadyCancelled: false,
        cancelled: false,
        blocker: "Funding intent was not found."
      });
      continue;
    }
    artifact.results.push(validateCandidate(row, expectedUserId));
  }

  const blockers = artifact.results.filter((result) => result.blocker);
  if (blockers.length > 0 || found.size !== fundingIntentIds.length) {
    await writeArtifacts(artifactDir, artifact);
    console.log(renderConsoleSummary(artifact));
    process.exitCode = 1;
  } else if (confirm) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const result of artifact.results) {
        if (!result.alreadyCancelled) {
          await cancelIntent(client, result.fundingIntentId, reason);
          result.cancelled = true;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await writeArtifacts(artifactDir, artifact);
    console.log(renderConsoleSummary(artifact));
  } else {
    await writeArtifacts(artifactDir, artifact);
    console.log(renderConsoleSummary(artifact));
  }
} finally {
  await pool.end();
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requiresSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes("supabase.") || url.hostname.includes("pooler.supabase.com") || url.searchParams.has("sslmode");
  } catch {
    return false;
  }
}

async function loadCandidates(pool: Pool, ids: string[]): Promise<CandidateRow[]> {
  const result = await pool.query<CandidateRow>(
    `SELECT fi.id::text AS funding_intent_id,
            fi.user_id,
            fi.status,
            COALESCE(array_agg(DISTINCT ft.target_venue) FILTER (WHERE ft.target_venue IS NOT NULL), '{}') AS target_venues,
            COALESCE(array_agg(DISTINCT fl.id::text) FILTER (WHERE fl.id IS NOT NULL), '{}') AS route_leg_ids,
            COUNT(fr.id) FILTER (WHERE fr.ready_to_trade = true)::text AS ready_reconciliation_count
       FROM funding_intents fi
       LEFT JOIN funding_targets ft ON ft.funding_intent_id = fi.id
       LEFT JOIN funding_route_legs fl ON fl.funding_intent_id = fi.id
       LEFT JOIN funding_reconciliation_records fr ON fr.funding_intent_id = fi.id
      WHERE fi.id = ANY($1::uuid[])
      GROUP BY fi.id, fi.user_id, fi.status`,
    [ids]
  );
  return result.rows;
}

function validateCandidate(row: CandidateRow, expectedUserId: string | null): CancelResult {
  const result: CancelResult = {
    fundingIntentId: row.funding_intent_id,
    userId: row.user_id,
    previousStatus: row.status,
    targetVenues: row.target_venues,
    routeLegIds: row.route_leg_ids,
    alreadyCancelled: row.status === "CANCELLED",
    cancelled: false
  };
  if (expectedUserId && row.user_id !== expectedUserId) {
    return { ...result, blocker: `Funding intent belongs to ${row.user_id}, not ${expectedUserId}.` };
  }
  if (row.status === "READY_TO_TRADE") {
    return { ...result, blocker: "READY_TO_TRADE funding intent cannot be cancelled by this cleanup script." };
  }
  if (Number(row.ready_reconciliation_count) > 0) {
    return { ...result, blocker: "Funding intent has ready-to-trade reconciliation evidence." };
  }
  return result;
}

async function cancelIntent(client: PoolClient, fundingIntentId: string, reason: string): Promise<void> {
  await client.query(
    `UPDATE funding_route_legs
        SET status = 'LEG_CANCELLED',
            error_reason = COALESCE(error_reason, $2),
            updated_at = now()
      WHERE funding_intent_id = $1::uuid
        AND status NOT IN ('LEG_READY_TO_TRADE', 'LEG_FAILED', 'LEG_CANCELLED')`,
    [fundingIntentId, reason]
  );
  await client.query(
    `UPDATE funding_targets
        SET status = 'LEG_CANCELLED',
            updated_at = now()
      WHERE funding_intent_id = $1::uuid
        AND status NOT IN ('LEG_READY_TO_TRADE', 'LEG_FAILED', 'LEG_CANCELLED')`,
    [fundingIntentId]
  );
  await client.query(
    `UPDATE funding_intents
        SET status = 'CANCELLED',
            updated_at = now()
      WHERE id = $1::uuid
        AND status <> 'CANCELLED'`,
    [fundingIntentId]
  );
  const auditResult = await client.query<{ id: string }>(
    `INSERT INTO funding_audit_events (funding_intent_id, route_leg_id, event_type, payload)
     VALUES ($1::uuid, NULL, 'FUNDING_CANCELLED', $2::jsonb)
     RETURNING id::text`,
    [
      fundingIntentId,
      JSON.stringify({
        reason,
        source: "operator_abandoned_funding_cleanup",
        cancelledAt: new Date().toISOString()
      })
    ]
  );
  await client.query(
    `UPDATE funding_intents
        SET audit_event_ids = audit_event_ids || jsonb_build_array($2::text),
            updated_at = now()
      WHERE id = $1::uuid`,
    [fundingIntentId, auditResult.rows[0]!.id]
  );
}

async function writeArtifacts(dir: string, report: typeof artifact): Promise<void> {
  await mkdir(dir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  await writeFile(join(dir, `abandoned-funding-intent-cancel-${timestamp}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "abandoned-funding-intent-cancel-latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "abandoned-funding-intent-cancel-latest.md"), renderMarkdown(report), "utf8");
}

function renderConsoleSummary(report: typeof artifact): string {
  const cancelled = report.results.filter((result) => result.cancelled).length;
  const blocked = report.results.filter((result) => result.blocker).length;
  const alreadyCancelled = report.results.filter((result) => result.alreadyCancelled).length;
  return `abandonedFundingCleanup dryRun=${report.dryRun} cancelled=${cancelled} alreadyCancelled=${alreadyCancelled} blocked=${blocked}`;
}

function renderMarkdown(report: typeof artifact): string {
  return [
    "# Abandoned Funding Intent Cleanup",
    "",
    `Generated: ${report.generatedAt}`,
    `Dry run: ${report.dryRun}`,
    `Expected user: ${report.expectedUserId ?? "not enforced"}`,
    "",
    "## Results",
    "",
    ...report.results.map((result) =>
      `- ${result.fundingIntentId}: previous=${result.previousStatus}, cancelled=${result.cancelled}, alreadyCancelled=${result.alreadyCancelled}, blocker=${result.blocker ?? "none"}`
    ),
    ""
  ].join("\n");
}
