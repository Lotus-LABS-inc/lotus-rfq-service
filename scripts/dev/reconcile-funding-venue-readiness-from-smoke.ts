import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import {
  buildFundingVenueReadinessCheckersFromEnv,
  isFundingVenueReadinessSupported,
  type VenueFundingReadinessResult
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

interface SmokeArtifact {
  status?: string;
  venue?: string;
  persistedReadinessResult?: boolean;
  liveLifiExecutionEnabled?: boolean;
  fundingPreflightEnforcementEnabled?: boolean;
  selectedRow?: {
    fundingIntentId?: string;
    userId?: string;
    routeLegId?: string | null;
    targetVenue?: string;
  } | null;
  readinessResult?: (VenueFundingReadinessResult & { evidence: Record<string, unknown> }) | null;
  mappingObserved?: string | null;
  redactionVerified?: boolean;
}

class NoopLifiProvider implements LifiRouteProvider {
  public async quote(): Promise<FundingRouteQuote> {
    throw new Error("LI.FI quote is disabled for smoke-gated reconciliation.");
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    throw new Error("LI.FI status is disabled for smoke-gated reconciliation.");
  }
}

const requestedVenue = (process.argv[2] ?? "").toUpperCase();
if (!isFundingVenueReadinessSupported(requestedVenue)) {
  throw new Error("Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN.");
}

const venue: FundingVenue = requestedVenue;
const artifactDir = join(process.cwd(), "artifacts", "funding");
const smokeArtifactPath = join(artifactDir, `${venue.toLowerCase().replaceAll("_", "-")}-readiness-smoke-test.json`);
const reconciliationArtifactPath = join(artifactDir, `${venue.toLowerCase().replaceAll("_", "-")}-readiness-reconciliation.json`);
const reconciliationMarkdownPath = join(artifactDir, `${venue.toLowerCase().replaceAll("_", "-")}-readiness-reconciliation.md`);
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required to persist smoke-gated venue readiness.");
}

const readSmokeArtifact = async (): Promise<SmokeArtifact> => JSON.parse(await readFile(smokeArtifactPath, "utf8")) as SmokeArtifact;

const assertSmokeAllowsPersistence = (artifact: SmokeArtifact): void => {
  if (artifact.status !== "COMPLETED") {
    throw new Error(`Smoke artifact status must be COMPLETED before persisting readiness. Found ${artifact.status ?? "missing"}.`);
  }
  if (artifact.venue !== venue) {
    throw new Error(`Smoke artifact venue mismatch. Expected ${venue}, found ${artifact.venue ?? "missing"}.`);
  }
  if (artifact.mappingObserved !== "READY_TO_TRADE" || artifact.readinessResult?.readyToTrade !== true) {
    throw new Error("Smoke artifact must map to READY_TO_TRADE before persisting readiness.");
  }
  if (artifact.persistedReadinessResult !== false) {
    throw new Error("Smoke artifact must be read-only and not already persist readiness.");
  }
  if (artifact.liveLifiExecutionEnabled !== false || artifact.fundingPreflightEnforcementEnabled !== false) {
    throw new Error("Smoke artifact safety flags are not acceptable for persistence.");
  }
  if (artifact.redactionVerified !== true) {
    throw new Error("Smoke artifact redaction must be verified before persisting readiness.");
  }
  if (!artifact.selectedRow?.fundingIntentId || !artifact.selectedRow.routeLegId || !artifact.selectedRow.userId) {
    throw new Error("Smoke artifact must include selected funding intent, route leg, and user identifiers.");
  }
};

const secretCandidates = [
  process.env[`${venue}_FUNDING_READ_API_KEY`],
  process.env[`${venue}_API_KEY`],
  process.env[`${venue}_API_SECRET`],
  process.env[`${venue}_PRIVATE_KEY`],
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const assertRedacted = (payload: unknown): boolean => {
  const serialized = JSON.stringify(payload);
  return !secretCandidates.some((secret) => serialized.includes(secret))
    && !serialized.includes("transactionRequest")
    && !serialized.toLowerCase().includes("authorization")
    && !serialized.toLowerCase().includes("privatekey");
};

const renderMarkdown = (artifact: Record<string, unknown>): string => [
  `# ${venue} Funding Readiness Reconciliation`,
  "",
  `Generated: ${artifact.generatedAt}`,
  `Status: ${artifact.status}`,
  "",
  "## Result",
  "",
  `- Funding intent: ${artifact.fundingIntentId}`,
  `- Route leg: ${artifact.routeLegId}`,
  `- Persisted readiness result: ${artifact.persistedReadinessResult}`,
  `- Route leg status: ${artifact.routeLegStatus}`,
  `- Reconciliation reason: ${artifact.reconciliationReason}`,
  "",
  "## Safety",
  "",
  `- Smoke artifact required READY_TO_TRADE: ${artifact.smokeReadyToTrade}`,
  `- Live LI.FI execution enabled: ${artifact.liveLifiExecutionEnabled}`,
  `- Funding preflight enforcement enabled: ${artifact.fundingPreflightEnforcementEnabled}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  ""
].join("\n");

const main = async (): Promise<void> => {
  const smokeArtifact = await readSmokeArtifact();
  assertSmokeAllowsPersistence(smokeArtifact);

  const selectedRow = smokeArtifact.selectedRow!;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new FundingRepository(pool);
    const service = new FundingService(
      repository,
      new NoopLifiProvider(),
      {
        lifiQuotesEnabled: false,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: process.env
      },
      buildFundingVenueReadinessCheckersFromEnv(process.env)
    );

    const reconciled = await service.verifyVenueReadiness(
      selectedRow.userId!,
      selectedRow.fundingIntentId!,
      selectedRow.routeLegId!
    );
    const routeLeg = reconciled.routeLegs.find((leg) => leg.routeLegId === selectedRow.routeLegId);
    const latestReconciliation = reconciled.reconciliations.find((row) => row.routeLegId === selectedRow.routeLegId);
    const artifact = {
      generatedAt: new Date().toISOString(),
      status: latestReconciliation?.readyToTrade === true ? "COMPLETED" : "FAILED",
      targetVenue: venue,
      fundingIntentId: selectedRow.fundingIntentId,
      routeLegId: selectedRow.routeLegId,
      userId: selectedRow.userId,
      routeLegStatus: routeLeg?.status ?? null,
      destinationStatus: routeLeg?.destinationStatus ?? null,
      venueCreditStatus: routeLeg?.venueCreditStatus ?? null,
      persistedReadinessResult: latestReconciliation?.readyToTrade === true,
      reconciliationReason: latestReconciliation?.notes ?? null,
      smokeReadyToTrade: smokeArtifact.readinessResult?.readyToTrade === true,
      liveLifiExecutionEnabled: false,
      fundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
      redactionVerified: false
    };
    const finalArtifact = { ...artifact, redactionVerified: assertRedacted(artifact) };
    if (!finalArtifact.redactionVerified) {
      throw new Error("Venue readiness reconciliation artifact failed redaction verification.");
    }
    await mkdir(artifactDir, { recursive: true });
    await writeFile(reconciliationArtifactPath, `${JSON.stringify(finalArtifact, null, 2)}\n`, "utf8");
    await writeFile(reconciliationMarkdownPath, renderMarkdown(finalArtifact), "utf8");
    console.log(JSON.stringify({
      status: finalArtifact.status,
      targetVenue: finalArtifact.targetVenue,
      fundingIntentId: finalArtifact.fundingIntentId,
      routeLegId: finalArtifact.routeLegId,
      persistedReadinessResult: finalArtifact.persistedReadinessResult,
      artifactPath: reconciliationArtifactPath
    }, null, 2));
  } finally {
    await pool.end();
  }
};

await main();
