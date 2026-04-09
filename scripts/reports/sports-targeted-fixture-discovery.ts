#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact, writeMarkdownArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildSportsTargetedFixtureDiscoveryArtifacts,
  type SportsTargetedVenueInspectionStatus
} from "../../src/reports/sports-targeted-fixture-discovery.js";

for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-sports-targeted-fixture-discovery"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const venueInspection: readonly SportsTargetedVenueInspectionStatus[] = [
      {
        venue: "OPINION",
        inspectionMode: "LOCAL_INVENTORY_ONLY",
        fetchStatus: "NOT_ATTEMPTED",
        limitation: "This pass used the current local inventory snapshot instead of forcing a fresh scoped Opinion sync."
      },
      {
        venue: "POLYMARKET",
        inspectionMode: "SCOPED_REFRESH_UNAVAILABLE",
        fetchStatus: "NOT_ATTEMPTED",
        limitation: "Polymarket remains inventory-backed for this pass because no safe scoped sports refresh seam is wired."
      },
      {
        venue: "LIMITLESS",
        inspectionMode: "LOCAL_INVENTORY_ONLY",
        fetchStatus: "NOT_ATTEMPTED",
        limitation: "This pass used local Limitless live inventory rather than a fresh remote scoped fetch."
      },
      {
        venue: "PREDICT",
        inspectionMode: "LOCAL_INVENTORY_ONLY",
        fetchStatus: "NOT_ATTEMPTED",
        limitation: "This pass used the current local Predict inventory snapshot instead of forcing a fresh scoped sync."
      }
    ];
    const artifacts = await buildSportsTargetedFixtureDiscoveryArtifacts({ pool, repoRoot, venueInspection });
    mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
    writeArtifact(repoRoot, "docs/sports-targeted-ingestion-scope.json", artifacts.scope);
    writeArtifact(repoRoot, "docs/sports-targeted-pocket-config-summary.json", artifacts.pocketConfigSummary);
    writeArtifact(repoRoot, "docs/sports-live-window-summary.json", artifacts.liveWindowSummary);
    writeArtifact(repoRoot, "docs/sports-targeted-fixture-discovery-summary.json", artifacts.discoverySummary);
    writeArtifact(repoRoot, "docs/sports-targeted-ingestion-summary.json", artifacts.ingestionSummary);
    writeArtifact(repoRoot, "docs/sports-targeted-fixture-binding-summary.json", artifacts.fixtureBindingSummary);
    writeArtifact(repoRoot, "docs/sports-targeted-overlap-matrix.json", artifacts.overlapMatrix);
    writeArtifact(repoRoot, "docs/sports-missing-venue-rows-summary.json", artifacts.missingVenueSummary);
    writeArtifact(repoRoot, "docs/sports-targeted-supply-recovery-plan.json", artifacts.supplyRecoveryPlan);
    writeArtifact(repoRoot, "docs/sports-targeted-pocket-priority.json", artifacts.pocketPriority);
    writeArtifact(repoRoot, "docs/sports-targeted-delta-vs-prior-fixture-supply.json", artifacts.deltaVsPriorFixtureSupply);
    writeArtifact(repoRoot, "docs/sports-priority-shift-summary.json", artifacts.priorityShiftSummary);
    writeArtifact(repoRoot, "docs/sports-targeted-final-decision.json", artifacts.finalDecision);
    writeMarkdownArtifact(repoRoot, "docs/sports-targeted-operator-summary.md", `${artifacts.operatorSummary}\n`);
    console.log(JSON.stringify({
      sportsFrontierPosition: artifacts.pocketPriority.sportsFrontierPosition,
      pockets: artifacts.pocketPriority.pockets
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build sports targeted fixture discovery artifacts.");
  console.error(error);
  process.exit(1);
});
