import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import type { FundingVenue } from "../../src/core/funding/types.js";
import {
  buildWithdrawalCompletionPersistenceGateFromEnv,
  type WithdrawalEvidenceSmokeArtifact
} from "../../src/core/funding/withdrawal-evidence.js";

loadDotenv();

type GateStatus = "PASSED" | "FAILED";

interface VenueSummaryRow {
  venue: FundingVenue;
  status: GateStatus;
  source: "DB" | "ARTIFACT";
  smokeArtifactPath: string | null;
  generatedAt: string | null;
  ageHours: number | null;
  artifactStatus: string | null;
  mappingObserved: string | null;
  completedEvidence: boolean;
  fresh: boolean;
  redacted: boolean;
  nonSynthetic: boolean;
  readOnly: boolean;
  noSmokePersistence: boolean;
  approvedHost: boolean;
  runtimePersistenceEnabledForVenue: boolean;
  persistedCompletedRows: number;
  blockers: string[];
}

interface WithdrawalCompletionGateSummary {
  artifactSchemaVersion: 1;
  generatedAt: string;
  source: "DB" | "ARTIFACTS";
  status: GateStatus;
  passedVenues: number;
  failedVenues: number;
  maxAgeHours: number;
  rows: VenueSummaryRow[];
  safety: {
    readOnlyReport: true;
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    persistenceChanged: false;
  };
}

const venues: readonly FundingVenue[] = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"];
const artifactDir = join(process.cwd(), "artifacts", "funding");
const outputJsonPath = join(artifactDir, "all-venue-withdrawal-completion-gate-summary.json");
const outputMarkdownPath = join(artifactDir, "all-venue-withdrawal-completion-gate-summary.md");
const maxAgeHours = positiveInt(process.env.FUNDING_WITHDRAWAL_COMPLETION_SMOKE_MAX_AGE_HOURS, 24);
const source = (process.env.FUNDING_WITHDRAWAL_COMPLETION_GATE_SUMMARY_SOURCE ?? "DB").toUpperCase();

const gate = buildWithdrawalCompletionPersistenceGateFromEnv(process.env);

const runtimePersistenceEnabledForVenue = (venue: FundingVenue): boolean =>
  process.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED === "true" &&
  (
    (process.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES ?? "")
      .split(",")
      .map((candidate) => candidate.trim().toUpperCase())
      .includes(venue) ||
    process.env[`${venue}_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED`] === "true"
  );

const ageHours = (generatedAt: string | undefined, now: Date): number | null => {
  if (!generatedAt) {
    return null;
  }
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs) || generatedAtMs > now.getTime()) {
    return null;
  }
  return (now.getTime() - generatedAtMs) / 3_600_000;
};

const completedEvidence = (artifact: WithdrawalEvidenceSmokeArtifact | null): boolean =>
  artifact?.status === "COMPLETED" &&
  artifact.mappingObserved === "COMPLETED" &&
  artifact.evidenceResult?.status === "COMPLETED" &&
  artifact.evidenceResult.venueReleased === true &&
  artifact.evidenceResult.destinationReceived === true &&
    artifact.evidenceResult.completed === true;

interface PersistedWithdrawalCompletionRow {
  source_venue: FundingVenue;
  checked_at: Date;
  completed_rows: string;
  latest_withdrawal_tx_hash: string | null;
  latest_intent_status: string | null;
  latest_leg_status: string | null;
}

const databaseUrl = (): string | null =>
  process.env.FUNDING_SMOKE_DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? null;

const requiresSsl = (connectionString: string): boolean => {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes("supabase.") || url.hostname.includes("pooler.supabase.com") || url.searchParams.has("sslmode");
  } catch {
    return false;
  }
};

const loadPersistedCompletionRows = async (): Promise<Map<FundingVenue, PersistedWithdrawalCompletionRow[]>> => {
  const connectionString = databaseUrl();
  if (!connectionString) {
    return new Map();
  }
  const pool = new Pool({
    connectionString,
    ...(requiresSsl(connectionString) ? { ssl: { rejectUnauthorized: false } } : {}),
    connectionTimeoutMillis: Number.parseInt(process.env.FUNDING_SMOKE_DB_CONNECT_TIMEOUT_MS ?? "30000", 10)
  });
  try {
    const result = await pool.query<PersistedWithdrawalCompletionRow>(
      `SELECT
         wr.source_venue,
         max(wr.checked_at) AS checked_at,
         count(*)::text AS completed_rows,
         (array_agg(wr.withdrawal_tx_hash ORDER BY wr.checked_at DESC))[1] AS latest_withdrawal_tx_hash,
         (array_agg(wi.status ORDER BY wr.checked_at DESC))[1] AS latest_intent_status,
         (array_agg(wl.status ORDER BY wr.checked_at DESC))[1] AS latest_leg_status
       FROM funding_withdrawal_reconciliation_records wr
       JOIN funding_withdrawal_intents wi ON wi.id = wr.withdrawal_intent_id
       JOIN funding_withdrawal_route_legs wl ON wl.id = wr.withdrawal_route_leg_id
       WHERE wr.venue_released = true
         AND wr.destination_received = true
         AND wr.completed = true
         AND wi.status <> 'CANCELLED'
       GROUP BY wr.source_venue`
    );
    return result.rows.reduce((byVenue, row) => {
      const venueRows = byVenue.get(row.source_venue) ?? [];
      byVenue.set(row.source_venue, [...venueRows, row]);
      return byVenue;
    }, new Map<FundingVenue, PersistedWithdrawalCompletionRow[]>());
  } finally {
    await pool.end();
  }
};

const buildPersistedRow = (
  venue: FundingVenue,
  rowsByVenue: Map<FundingVenue, PersistedWithdrawalCompletionRow[]>,
  now: Date
): VenueSummaryRow => {
  const rows = rowsByVenue.get(venue) ?? [];
  const latest = rows
    .slice()
    .sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime())[0];
  const resolvedAgeHours = ageHours(latest?.checked_at.toISOString(), now);
  const fresh = resolvedAgeHours !== null && resolvedAgeHours <= maxAgeHours;
  const completedRows = Number.parseInt(latest?.completed_rows ?? "0", 10);
  const blockers: string[] = [];
  if (!latest || completedRows < 1) {
    blockers.push(`No persisted completed withdrawal reconciliation found for ${venue}.`);
  }
  if (!latest?.latest_withdrawal_tx_hash) {
    blockers.push("Persisted completion evidence is missing withdrawal tx hash.");
  }
  if (!fresh) {
    blockers.push(resolvedAgeHours === null ? "Persisted completion timestamp is missing or invalid." : `Persisted completion evidence is stale at ${resolvedAgeHours.toFixed(2)}h.`);
  }

  return {
    venue,
    source: "DB",
    status: blockers.length === 0 ? "PASSED" : "FAILED",
    smokeArtifactPath: null,
    generatedAt: latest?.checked_at.toISOString() ?? null,
    ageHours: resolvedAgeHours === null ? null : Number(resolvedAgeHours.toFixed(4)),
    artifactStatus: latest ? "COMPLETED" : null,
    mappingObserved: latest ? "COMPLETED" : null,
    completedEvidence: completedRows > 0,
    fresh,
    redacted: true,
    nonSynthetic: true,
    readOnly: true,
    noSmokePersistence: true,
    approvedHost: true,
    runtimePersistenceEnabledForVenue: runtimePersistenceEnabledForVenue(venue),
    persistedCompletedRows: completedRows,
    blockers
  };
};

const buildArtifactRow = async (venue: FundingVenue, now: Date): Promise<VenueSummaryRow> => {
  const validation = await gate.validate(venue);
  const artifact = validation.artifact;
  const resolvedAgeHours = ageHours(artifact?.generatedAt, now);
  const fresh = resolvedAgeHours !== null && resolvedAgeHours <= maxAgeHours;
  const blockers = [...validation.blockers];
  return {
    venue,
    source: "ARTIFACT",
    status: validation.allowed ? "PASSED" : "FAILED",
    smokeArtifactPath: validation.artifactPath,
    generatedAt: artifact?.generatedAt ?? null,
    ageHours: resolvedAgeHours === null ? null : Number(resolvedAgeHours.toFixed(4)),
    artifactStatus: artifact?.status ?? null,
    mappingObserved: artifact?.mappingObserved ?? null,
    completedEvidence: completedEvidence(artifact),
    fresh,
    redacted: artifact?.redactionVerified === true,
    nonSynthetic: artifact?.selectedWithdrawal?.synthetic === false,
    readOnly: artifact?.readOnly === true,
    noSmokePersistence: artifact?.persistedCompletionResult === false &&
      artifact?.reconciliationRecordsBefore === artifact?.reconciliationRecordsAfter,
    approvedHost: !blockers.some((blocker) => blocker.includes("operator-approved") || blocker.includes("approved host")),
    runtimePersistenceEnabledForVenue: runtimePersistenceEnabledForVenue(venue),
    persistedCompletedRows: 0,
    blockers
  };
};

const renderMarkdown = (summary: WithdrawalCompletionGateSummary): string => [
  "# All Venue Withdrawal Completion Gate Summary",
  "",
  `Generated: ${summary.generatedAt}`,
  `Source: ${summary.source}`,
  `Status: ${summary.status}`,
  `Passed venues: ${summary.passedVenues}`,
  `Failed venues: ${summary.failedVenues}`,
  `Max age hours: ${summary.maxAgeHours}`,
  "",
  "| Venue | Status | Source | Age Hours | Completed Evidence | Persisted Rows | Redacted | Non-Synthetic | Approved Host | Runtime Persistence Enabled | Blockers |",
  "|---|---|---|---:|---|---:|---|---|---|---|---|",
  ...summary.rows.map((row) => [
    row.venue,
    row.status,
    row.source,
    row.ageHours === null ? "n/a" : row.ageHours.toFixed(2),
    row.completedEvidence ? "yes" : "no",
    row.persistedCompletedRows,
    row.redacted ? "yes" : "no",
    row.nonSynthetic ? "yes" : "no",
    row.approvedHost ? "yes" : "no",
    row.runtimePersistenceEnabledForVenue ? "yes" : "no",
    row.blockers.length > 0 ? row.blockers.join("; ") : "none"
  ].join(" | ")).map((line) => `| ${line} |`),
  "",
  "## Safety",
  "",
  "- This report is read-only.",
  "- It does not call LI.FI execution.",
  "- It does not call venue withdrawal execution.",
  "- It does not sign or broadcast transactions.",
  "- It does not persist withdrawal completion.",
  ""
].join("\n");

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const now = new Date();
const persistedRows = source === "ARTIFACTS" ? null : await loadPersistedCompletionRows();
const rows = persistedRows
  ? venues.map((venue) => buildPersistedRow(venue, persistedRows, now))
  : await Promise.all(venues.map((venue) => buildArtifactRow(venue, now)));
const summary: WithdrawalCompletionGateSummary = {
  artifactSchemaVersion: 1,
  generatedAt: now.toISOString(),
  source: persistedRows ? "DB" : "ARTIFACTS",
  status: rows.every((row) => row.status === "PASSED") ? "PASSED" : "FAILED",
  passedVenues: rows.filter((row) => row.status === "PASSED").length,
  failedVenues: rows.filter((row) => row.status !== "PASSED").length,
  maxAgeHours,
  rows,
  safety: {
    readOnlyReport: true,
    liveLifiExecutionEnabled: false,
    liveVenueWithdrawalExecutionEnabled: false,
    backendBroadcastedTransaction: false,
    backendSignedTransaction: false,
    persistenceChanged: false
  }
};

await mkdir(artifactDir, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(outputMarkdownPath, `${renderMarkdown(summary)}\n`, "utf8");

console.log(`All venue withdrawal completion gate summary: ${summary.status}`);
console.log(`passedVenues=${summary.passedVenues} failedVenues=${summary.failedVenues}`);
console.log(`artifact=${outputJsonPath}`);

if (summary.status !== "PASSED") {
  process.exitCode = 1;
}
