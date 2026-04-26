import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

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
  smokeArtifactPath: string;
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
  blockers: string[];
}

interface WithdrawalCompletionGateSummary {
  artifactSchemaVersion: 1;
  generatedAt: string;
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

const buildRow = async (venue: FundingVenue, now: Date): Promise<VenueSummaryRow> => {
  const validation = await gate.validate(venue);
  const artifact = validation.artifact;
  const resolvedAgeHours = ageHours(artifact?.generatedAt, now);
  const fresh = resolvedAgeHours !== null && resolvedAgeHours <= maxAgeHours;
  const blockers = [...validation.blockers];
  return {
    venue,
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
    blockers
  };
};

const renderMarkdown = (summary: WithdrawalCompletionGateSummary): string => [
  "# All Venue Withdrawal Completion Gate Summary",
  "",
  `Generated: ${summary.generatedAt}`,
  `Status: ${summary.status}`,
  `Passed venues: ${summary.passedVenues}`,
  `Failed venues: ${summary.failedVenues}`,
  `Max age hours: ${summary.maxAgeHours}`,
  "",
  "| Venue | Status | Age Hours | Completed Evidence | Redacted | Non-Synthetic | Approved Host | Runtime Persistence Enabled | Blockers |",
  "|---|---|---:|---|---|---|---|---|---|",
  ...summary.rows.map((row) => [
    row.venue,
    row.status,
    row.ageHours === null ? "n/a" : row.ageHours.toFixed(2),
    row.completedEvidence ? "yes" : "no",
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
const rows = await Promise.all(venues.map((venue) => buildRow(venue, now)));
const summary: WithdrawalCompletionGateSummary = {
  artifactSchemaVersion: 1,
  generatedAt: now.toISOString(),
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
