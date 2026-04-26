import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isFundingVenueReadinessSupported } from "../../src/core/funding/venue-readiness.js";
import type { FundingVenue } from "../../src/core/funding/types.js";

interface SingleVenueRehearsalArtifact {
  generatedAt?: string;
  status?: string;
  persistedReadinessRows?: number;
  adminReadinessVisible?: boolean;
  executionPreflight?: { ok?: boolean };
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

const requestedVenue = (process.argv[2] ?? "").toUpperCase();
if (!isFundingVenueReadinessSupported(requestedVenue)) {
  throw new Error("Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN.");
}

const venue: FundingVenue = requestedVenue;
const artifactPath = process.env[`FUNDING_${venue}_REHEARSAL_ARTIFACT_PATH`] ??
  process.env.FUNDING_SINGLE_VENUE_REHEARSAL_ARTIFACT_PATH ??
  join(process.cwd(), "artifacts", "funding", `${venue.toLowerCase().replaceAll("_", "-")}-funding-readiness-sandbox-preflight.json`);
const maxAgeHours = Number.parseInt(
  process.env[`FUNDING_${venue}_REHEARSAL_MAX_AGE_HOURS`] ??
  process.env.FUNDING_SINGLE_VENUE_REHEARSAL_MAX_AGE_HOURS ??
  "24",
  10
);
const requiredLaneId = `CRYPTO_BTC_ATH_BY_DATE_SINGLE_${venue}`;
const requiredVenues = [venue];
const failures: string[] = [];

const readArtifact = async (): Promise<SingleVenueRehearsalArtifact | null> => {
  try {
    return JSON.parse(await readFile(artifactPath, "utf8")) as SingleVenueRehearsalArtifact;
  } catch (error) {
    failures.push(`${venue} rehearsal artifact is missing or unreadable at ${artifactPath}.`);
    if (error instanceof SyntaxError) {
      failures.push(`${venue} rehearsal artifact is not valid JSON.`);
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

const validateArtifact = (artifact: SingleVenueRehearsalArtifact): void => {
  assertFresh(artifact.generatedAt);
  if (artifact.status !== "COMPLETED") {
    failures.push(`Artifact status must be COMPLETED but was ${artifact.status ?? "missing"}.`);
  }
  if (artifact.sandboxLane?.laneId !== requiredLaneId) {
    failures.push(`Artifact laneId must be ${requiredLaneId} but was ${artifact.sandboxLane?.laneId ?? "missing"}.`);
  }
  assertArraySet("Artifact venuePath", artifact.sandboxLane?.venuePath, requiredVenues);
  if (artifact.persistedReadinessRows !== requiredVenues.length) {
    failures.push(`persistedReadinessRows must be ${requiredVenues.length} but was ${artifact.persistedReadinessRows ?? "missing"}.`);
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

  for (const requiredVenue of requiredVenues) {
    const leg = (artifact.routeLegs ?? []).find((candidate) => candidate.targetVenue === requiredVenue);
    if (!leg) {
      failures.push(`Missing route leg for ${requiredVenue}.`);
      continue;
    }
    if (leg.routeLegStatus !== "LEG_READY_TO_TRADE") {
      failures.push(`${requiredVenue} routeLegStatus must be LEG_READY_TO_TRADE but was ${leg.routeLegStatus ?? "missing"}.`);
    }
    if (leg.destinationStatus !== "CONFIRMED") {
      failures.push(`${requiredVenue} destinationStatus must be CONFIRMED but was ${leg.destinationStatus ?? "missing"}.`);
    }
    if (leg.venueCreditStatus !== "CONFIRMED") {
      failures.push(`${requiredVenue} venueCreditStatus must be CONFIRMED but was ${leg.venueCreditStatus ?? "missing"}.`);
    }
  }
};

const artifact = await readArtifact();
if (artifact) {
  validateArtifact(artifact);
}

if (failures.length > 0) {
  console.error(`${venue} funding enforcement gate: FAILED`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`${venue} funding enforcement gate: PASSED`);
console.log(`artifact=${artifactPath}`);
console.log(`maxAgeHours=${maxAgeHours}`);
