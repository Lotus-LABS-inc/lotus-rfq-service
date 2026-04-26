import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface PairRehearsalArtifact {
  generatedAt?: string;
  status?: string;
  persistedReadinessRows?: number;
  adminReadinessVisible?: boolean;
  executionPreflight?: {
    ok?: boolean;
  };
  sandboxLane?: {
    laneId?: string;
    venuePath?: string[];
  };
  routeLegs?: Array<{
    targetVenue?: string | null;
    routeLegStatus?: string | null;
    destinationStatus?: string | null;
    venueCreditStatus?: string | null;
  }>;
  venueEvidence?: Array<{
    targetVenue?: string;
    readyToTrade?: boolean;
  }>;
  safety?: {
    defaultFundingPreflightEnforcementEnabled?: boolean;
    scriptScopedFundingPreflightEnforcementOnly?: boolean;
    liveLifiExecutionEnabled?: boolean;
    backendBroadcastedTransaction?: boolean;
    liveVenueSubmissionEnabled?: boolean;
  };
  redactionVerified?: boolean;
}

const artifactPath = process.env.FUNDING_PAIR_REHEARSAL_ARTIFACT_PATH ??
  join(process.cwd(), "artifacts", "funding", "pair-funding-readiness-sandbox-preflight.json");
const maxAgeHours = Number.parseInt(process.env.FUNDING_PAIR_REHEARSAL_MAX_AGE_HOURS ?? "24", 10);
const requiredLaneId = "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET";
const requiredVenues = ["LIMITLESS", "POLYMARKET"];

const failures: string[] = [];

const readArtifact = async (): Promise<PairRehearsalArtifact | null> => {
  try {
    return JSON.parse(await readFile(artifactPath, "utf8")) as PairRehearsalArtifact;
  } catch (error) {
    failures.push(`Pair rehearsal artifact is missing or unreadable at ${artifactPath}.`);
    if (error instanceof SyntaxError) {
      failures.push("Pair rehearsal artifact is not valid JSON.");
    }
    return null;
  }
};

const assertFresh = (generatedAt: string | undefined): void => {
  if (!generatedAt) {
    failures.push("Artifact generatedAt is missing.");
    return;
  }
  const generatedAtMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(generatedAtMs)) {
    failures.push("Artifact generatedAt is invalid.");
    return;
  }
  const ageMs = Date.now() - generatedAtMs;
  const maxAgeMs = Math.max(maxAgeHours, 1) * 60 * 60 * 1000;
  if (ageMs < 0) {
    failures.push("Artifact generatedAt is in the future.");
  }
  if (ageMs > maxAgeMs) {
    failures.push(`Artifact is stale: ageHours=${(ageMs / 3_600_000).toFixed(2)} maxAgeHours=${maxAgeHours}.`);
  }
};

const assertArraySet = (label: string, actual: readonly string[] | undefined, expected: readonly string[]): void => {
  const normalized = [...(actual ?? [])].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(expectedSorted)) {
    failures.push(`${label} must be ${expectedSorted.join(",")} but was ${normalized.join(",") || "missing"}.`);
  }
};

const validateArtifact = (artifact: PairRehearsalArtifact): void => {
  assertFresh(artifact.generatedAt);
  if (artifact.status !== "COMPLETED") {
    failures.push(`Artifact status must be COMPLETED but was ${artifact.status ?? "missing"}.`);
  }
  if (artifact.sandboxLane?.laneId !== requiredLaneId) {
    failures.push(`Artifact laneId must be ${requiredLaneId} but was ${artifact.sandboxLane?.laneId ?? "missing"}.`);
  }
  assertArraySet("Artifact venuePath", artifact.sandboxLane?.venuePath, requiredVenues);
  if (artifact.persistedReadinessRows !== 2) {
    failures.push(`persistedReadinessRows must be 2 but was ${artifact.persistedReadinessRows ?? "missing"}.`);
  }
  if (artifact.adminReadinessVisible !== true) {
    failures.push("adminReadinessVisible must be true.");
  }
  if (artifact.executionPreflight?.ok !== true) {
    failures.push("executionPreflight.ok must be true.");
  }
  if (artifact.redactionVerified !== true) {
    failures.push("redactionVerified must be true.");
  }
  if (artifact.safety?.defaultFundingPreflightEnforcementEnabled !== false) {
    failures.push("defaultFundingPreflightEnforcementEnabled must be false.");
  }
  if (artifact.safety?.scriptScopedFundingPreflightEnforcementOnly !== true) {
    failures.push("scriptScopedFundingPreflightEnforcementOnly must be true.");
  }
  if (artifact.safety?.liveLifiExecutionEnabled !== false) {
    failures.push("liveLifiExecutionEnabled must be false.");
  }
  if (artifact.safety?.backendBroadcastedTransaction !== false) {
    failures.push("backendBroadcastedTransaction must be false.");
  }
  if (artifact.safety?.liveVenueSubmissionEnabled !== false) {
    failures.push("liveVenueSubmissionEnabled must be false.");
  }

  const readyVenues = (artifact.venueEvidence ?? [])
    .filter((row) => row.readyToTrade === true && row.targetVenue)
    .map((row) => row.targetVenue as string);
  assertArraySet("Ready venue evidence", readyVenues, requiredVenues);

  for (const venue of requiredVenues) {
    const leg = (artifact.routeLegs ?? []).find((candidate) => candidate.targetVenue === venue);
    if (!leg) {
      failures.push(`Missing route leg for ${venue}.`);
      continue;
    }
    if (leg.routeLegStatus !== "LEG_READY_TO_TRADE") {
      failures.push(`${venue} routeLegStatus must be LEG_READY_TO_TRADE but was ${leg.routeLegStatus ?? "missing"}.`);
    }
    if (leg.destinationStatus !== "CONFIRMED") {
      failures.push(`${venue} destinationStatus must be CONFIRMED but was ${leg.destinationStatus ?? "missing"}.`);
    }
    if (leg.venueCreditStatus !== "CONFIRMED") {
      failures.push(`${venue} venueCreditStatus must be CONFIRMED but was ${leg.venueCreditStatus ?? "missing"}.`);
    }
  }
};

const artifact = await readArtifact();
if (artifact) {
  validateArtifact(artifact);
}

if (failures.length > 0) {
  console.error("Pair funding enforcement gate: FAILED");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Pair funding enforcement gate: PASSED");
console.log(`artifact=${artifactPath}`);
console.log(`maxAgeHours=${maxAgeHours}`);
