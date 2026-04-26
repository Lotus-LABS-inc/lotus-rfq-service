import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type GateStatus = "PASSED" | "FAILED" | "MISSING" | "STALE";
type CoverageSource = "single_venue_rehearsal" | "pair_rehearsal" | "missing";

interface RehearsalArtifact {
  generatedAt?: string;
  status?: string;
  persistedReadinessRows?: number;
  adminReadinessVisible?: boolean;
  executionPreflight?: { ok?: boolean };
  sandboxLane?: { laneId?: string; venuePath?: string[] };
  routeLegs?: Array<{
    targetVenue?: string | null;
    routeLegStatus?: string | null;
    destinationStatus?: string | null;
    venueCreditStatus?: string | null;
  }>;
  venueEvidence?: Array<{ targetVenue?: string; readyToTrade?: boolean }>;
  safety?: {
    defaultFundingPreflightEnforcementEnabled?: boolean;
    scriptScopedFundingPreflightEnforcementOnly?: boolean;
    liveLifiExecutionEnabled?: boolean;
    backendBroadcastedTransaction?: boolean;
    liveVenueSubmissionEnabled?: boolean;
  };
  redactionVerified?: boolean;
}

interface VenueGateRow {
  venue: string;
  status: GateStatus;
  coverageSource: CoverageSource;
  artifactPath: string | null;
  generatedAt: string | null;
  ageHours: number | null;
  maxAgeHours: number;
  artifactStatus: string | null;
  executionPreflightOk: boolean;
  persistedReadinessRows: number;
  adminReadinessVisible: boolean;
  redactionVerified: boolean;
  safetyOk: boolean;
  routeLegReady: boolean;
  venueEvidenceReady: boolean;
  blockers: string[];
}

interface GateSummary {
  generatedAt: string;
  maxAgeHours: number;
  status: "PASSED" | "FAILED";
  passedVenues: number;
  failedVenues: number;
  rows: VenueGateRow[];
  safety: {
    readOnlyReport: true;
    liveLifiExecutionEnabled: false;
    fundingPreflightEnforcementChanged: false;
    backendBroadcastedTransaction: false;
    liveVenueSubmissionEnabled: false;
  };
}

const venues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
const artifactDir = join(process.cwd(), "artifacts", "funding");
const summaryJsonPath = join(artifactDir, "all-venue-readiness-gate-summary.json");
const summaryMarkdownPath = join(artifactDir, "all-venue-readiness-gate-summary.md");
const maxAgeHours = Number.parseInt(process.env.FUNDING_VENUE_GATE_SUMMARY_MAX_AGE_HOURS ?? "24", 10);

const slug = (venue: string): string => venue.toLowerCase().replaceAll("_", "-");

const readArtifact = async (path: string): Promise<RehearsalArtifact | null> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RehearsalArtifact;
  } catch {
    return null;
  }
};

const ageHours = (generatedAt: string | undefined, now: Date): number | null => {
  if (!generatedAt) {
    return null;
  }
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return null;
  }
  return Math.max(0, now.getTime() - generatedAtMs) / 3_600_000;
};

const safetyOk = (artifact: RehearsalArtifact): boolean =>
  artifact.redactionVerified === true &&
  artifact.safety?.defaultFundingPreflightEnforcementEnabled === false &&
  artifact.safety?.scriptScopedFundingPreflightEnforcementOnly === true &&
  artifact.safety?.liveLifiExecutionEnabled === false &&
  artifact.safety?.backendBroadcastedTransaction === false &&
  artifact.safety?.liveVenueSubmissionEnabled === false;

const routeLegReady = (artifact: RehearsalArtifact, venue: string): boolean => {
  const leg = artifact.routeLegs?.find((candidate) => candidate.targetVenue === venue);
  return leg?.routeLegStatus === "LEG_READY_TO_TRADE" &&
    leg.destinationStatus === "CONFIRMED" &&
    leg.venueCreditStatus === "CONFIRMED";
};

const venueEvidenceReady = (artifact: RehearsalArtifact, venue: string): boolean =>
  artifact.venueEvidence?.some((row) => row.targetVenue === venue && row.readyToTrade === true) === true;

const validateVenue = (
  venue: string,
  artifact: RehearsalArtifact | null,
  artifactPath: string,
  coverageSource: CoverageSource,
  now: Date
): VenueGateRow => {
  if (!artifact) {
    return {
      venue,
      status: "MISSING",
      coverageSource: "missing",
      artifactPath: null,
      generatedAt: null,
      ageHours: null,
      maxAgeHours,
      artifactStatus: null,
      executionPreflightOk: false,
      persistedReadinessRows: 0,
      adminReadinessVisible: false,
      redactionVerified: false,
      safetyOk: false,
      routeLegReady: false,
      venueEvidenceReady: false,
      blockers: [`No rehearsal artifact found for ${venue}.`]
    };
  }

  const blockers: string[] = [];
  const resolvedAgeHours = ageHours(artifact.generatedAt, now);
  const fresh = resolvedAgeHours !== null && resolvedAgeHours <= maxAgeHours;
  const rowSafetyOk = safetyOk(artifact);
  const rowRouteLegReady = routeLegReady(artifact, venue);
  const rowVenueEvidenceReady = venueEvidenceReady(artifact, venue);

  if (artifact.status !== "COMPLETED") {
    blockers.push(`Artifact status is ${artifact.status ?? "missing"}, expected COMPLETED.`);
  }
  if (!fresh) {
    blockers.push(resolvedAgeHours === null ? "Artifact generatedAt is missing or invalid." : `Artifact is stale at ${resolvedAgeHours.toFixed(2)}h.`);
  }
  if (artifact.executionPreflight?.ok !== true) {
    blockers.push("Execution preflight did not pass.");
  }
  if ((artifact.persistedReadinessRows ?? 0) < 1) {
    blockers.push("No persisted readiness row is recorded.");
  }
  if (artifact.adminReadinessVisible !== true) {
    blockers.push("Admin readiness visibility is not confirmed.");
  }
  if (!rowSafetyOk) {
    blockers.push("Safety flags or redaction are not acceptable.");
  }
  if (!rowRouteLegReady) {
    blockers.push("Route leg is not fully ready.");
  }
  if (!rowVenueEvidenceReady) {
    blockers.push("Venue evidence does not show READY_TO_TRADE.");
  }

  return {
    venue,
    status: blockers.length === 0 ? "PASSED" : fresh ? "FAILED" : "STALE",
    coverageSource,
    artifactPath,
    generatedAt: artifact.generatedAt ?? null,
    ageHours: resolvedAgeHours === null ? null : Number(resolvedAgeHours.toFixed(4)),
    maxAgeHours,
    artifactStatus: artifact.status ?? null,
    executionPreflightOk: artifact.executionPreflight?.ok === true,
    persistedReadinessRows: artifact.persistedReadinessRows ?? 0,
    adminReadinessVisible: artifact.adminReadinessVisible === true,
    redactionVerified: artifact.redactionVerified === true,
    safetyOk: rowSafetyOk,
    routeLegReady: rowRouteLegReady,
    venueEvidenceReady: rowVenueEvidenceReady,
    blockers
  };
};

const loadVenueRow = async (venue: string, now: Date): Promise<VenueGateRow> => {
  const singlePath = join(artifactDir, `${slug(venue)}-funding-readiness-sandbox-preflight.json`);
  const singleArtifact = await readArtifact(singlePath);
  if (singleArtifact) {
    return validateVenue(venue, singleArtifact, singlePath, "single_venue_rehearsal", now);
  }

  const pairPath = join(artifactDir, "pair-funding-readiness-sandbox-preflight.json");
  const pairArtifact = await readArtifact(pairPath);
  if (pairArtifact?.sandboxLane?.venuePath?.includes(venue)) {
    return validateVenue(venue, pairArtifact, pairPath, "pair_rehearsal", now);
  }

  return validateVenue(venue, null, singlePath, "missing", now);
};

const renderMarkdown = (summary: GateSummary): string => [
  "# All Venue Funding Readiness Gate Summary",
  "",
  `Generated: ${summary.generatedAt}`,
  `Status: ${summary.status}`,
  `Max age hours: ${summary.maxAgeHours}`,
  "",
  "| Venue | Status | Source | Age Hours | Preflight | Ready Evidence | Blockers |",
  "|---|---|---|---:|---|---|---|",
  ...summary.rows.map((row) => [
    row.venue,
    row.status,
    row.coverageSource,
    row.ageHours === null ? "n/a" : row.ageHours.toFixed(2),
    row.executionPreflightOk ? "yes" : "no",
    row.venueEvidenceReady && row.routeLegReady ? "yes" : "no",
    row.blockers.length > 0 ? row.blockers.join("; ") : "none"
  ].join(" | ")).map((line) => `| ${line} |`),
  "",
  "## Safety",
  "",
  `- Read-only report: ${summary.safety.readOnlyReport}`,
  `- Live LI.FI execution enabled: ${summary.safety.liveLifiExecutionEnabled}`,
  `- Funding preflight enforcement changed: ${summary.safety.fundingPreflightEnforcementChanged}`,
  `- Backend broadcasted transaction: ${summary.safety.backendBroadcastedTransaction}`,
  `- Live venue submission enabled: ${summary.safety.liveVenueSubmissionEnabled}`,
  ""
].join("\n");

const now = new Date();
const rows = await Promise.all(venues.map((venue) => loadVenueRow(venue, now)));
const summary: GateSummary = {
  generatedAt: now.toISOString(),
  maxAgeHours,
  status: rows.every((row) => row.status === "PASSED") ? "PASSED" : "FAILED",
  passedVenues: rows.filter((row) => row.status === "PASSED").length,
  failedVenues: rows.filter((row) => row.status !== "PASSED").length,
  rows,
  safety: {
    readOnlyReport: true,
    liveLifiExecutionEnabled: false,
    fundingPreflightEnforcementChanged: false,
    backendBroadcastedTransaction: false,
    liveVenueSubmissionEnabled: false
  }
};

await mkdir(artifactDir, { recursive: true });
await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(summaryMarkdownPath, renderMarkdown(summary), "utf8");

console.log(`All venue funding readiness gate summary: ${summary.status}`);
console.log(`passedVenues=${summary.passedVenues} failedVenues=${summary.failedVenues}`);
console.log(`artifact=${summaryJsonPath}`);
if (summary.status !== "PASSED") {
  process.exitCode = 1;
}
