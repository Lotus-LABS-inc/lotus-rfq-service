import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import type { FundingVenue } from "../../src/core/funding/types.js";
import {
  buildWithdrawalCompletionPersistenceGateFromEnv,
  isWithdrawalEvidenceVenueSupported
} from "../../src/core/funding/withdrawal-evidence.js";

loadDotenv();

type GateStatus = "PASSED" | "FAILED";

interface GateArtifact {
  generatedAt: string;
  status: GateStatus;
  venue: FundingVenue;
  smokeArtifactPath: string;
  blockers: string[];
  checks: {
    completed: boolean;
    fresh: boolean;
    redacted: boolean;
    nonSynthetic: boolean;
    readOnly: boolean;
    noPersistence: boolean;
    approvedHost: boolean;
    runtimePersistenceEnabledForVenue: boolean;
  };
  safety: {
    readOnlyValidator: true;
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    persistenceChanged: false;
  };
}

const rawVenue = (process.argv[2] ?? "").toUpperCase();
if (!isWithdrawalEvidenceVenueSupported(rawVenue)) {
  throw new Error("Usage: npm run funding:withdrawal-completion-gate -- POLYMARKET|LIMITLESS|OPINION|MYRIAD|PREDICT_FUN");
}

const venue = rawVenue as FundingVenue;
const artifactDir = join(process.cwd(), "artifacts", "funding");
const outputSlug = venue.toLowerCase().replaceAll("_", "-");
const outputJsonPath = join(artifactDir, `${outputSlug}-withdrawal-completion-persistence-gate.json`);
const outputMarkdownPath = join(artifactDir, `${outputSlug}-withdrawal-completion-persistence-gate.md`);

const gate = buildWithdrawalCompletionPersistenceGateFromEnv(process.env);
const validation = await gate.validate(venue);
const smoke = validation.artifact;
const blockers = validation.blockers;
const runtimePersistenceEnabledForVenue = process.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED === "true" &&
  (
    (process.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES ?? "")
      .split(",")
      .map((candidate) => candidate.trim().toUpperCase())
      .includes(venue) ||
    process.env[`${venue}_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED`] === "true"
  );
const artifact: GateArtifact = {
  generatedAt: new Date().toISOString(),
  status: validation.allowed ? "PASSED" : "FAILED",
  venue,
  smokeArtifactPath: validation.artifactPath,
  blockers,
  checks: {
    completed: smoke?.status === "COMPLETED" &&
      smoke.mappingObserved === "COMPLETED" &&
      smoke.evidenceResult?.status === "COMPLETED" &&
      smoke.evidenceResult.venueReleased === true &&
      smoke.evidenceResult.destinationReceived === true &&
      smoke.evidenceResult.completed === true,
    fresh: !blockers.some((blocker) => blocker.includes("older than") || blocker.includes("future-dated")),
    redacted: smoke?.redactionVerified === true,
    nonSynthetic: smoke?.selectedWithdrawal?.synthetic === false,
    readOnly: smoke?.readOnly === true,
    noPersistence: smoke?.persistedCompletionResult === false &&
      smoke?.reconciliationRecordsBefore === smoke?.reconciliationRecordsAfter,
    approvedHost: !blockers.some((blocker) => blocker.includes("operator-approved")),
    runtimePersistenceEnabledForVenue
  },
  safety: {
    readOnlyValidator: true,
    liveLifiExecutionEnabled: false,
    liveVenueWithdrawalExecutionEnabled: false,
    backendBroadcastedTransaction: false,
    backendSignedTransaction: false,
    persistenceChanged: false
  }
};

const markdown = [
  `# ${venue} Withdrawal Completion Persistence Gate`,
  "",
  `- Status: ${artifact.status}`,
  `- Generated at: ${artifact.generatedAt}`,
  `- Smoke artifact: ${artifact.smokeArtifactPath}`,
  `- Completed evidence: ${artifact.checks.completed}`,
  `- Fresh: ${artifact.checks.fresh}`,
  `- Redacted: ${artifact.checks.redacted}`,
  `- Non-synthetic: ${artifact.checks.nonSynthetic}`,
  `- Read-only smoke: ${artifact.checks.readOnly}`,
  `- No smoke persistence: ${artifact.checks.noPersistence}`,
  `- Approved host: ${artifact.checks.approvedHost}`,
  `- Runtime persistence enabled for venue: ${artifact.checks.runtimePersistenceEnabledForVenue}`,
  "",
  "## Blockers",
  ...(artifact.blockers.length === 0 ? ["- None"] : artifact.blockers.map((blocker) => `- ${blocker}`)),
  "",
  "## Safety",
  "- This validator is read-only.",
  "- It does not call LI.FI execution.",
  "- It does not call venue withdrawal execution.",
  "- It does not broadcast or sign transactions.",
  "- It does not persist withdrawal completion."
].join("\n");

await mkdir(artifactDir, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(outputMarkdownPath, `${markdown}\n`, "utf8");

if (artifact.status !== "PASSED") {
  console.error(`${venue} withdrawal completion persistence gate: FAILED`);
  for (const blocker of artifact.blockers) {
    console.error(`- ${blocker}`);
  }
  console.error(`artifact=${outputJsonPath}`);
  process.exit(1);
}

console.log(`${venue} withdrawal completion persistence gate: PASSED`);
console.log(`artifact=${outputJsonPath}`);
