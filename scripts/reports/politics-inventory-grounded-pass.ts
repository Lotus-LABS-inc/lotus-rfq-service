#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact, writeMarkdownArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { buildPoliticsInventoryGroundedArtifacts } from "../../src/reports/politics-inventory-grounded-pass.js";

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
    application_name: "report-politics-inventory-grounded-pass"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const artifacts = await buildPoliticsInventoryGroundedArtifacts({ pool, repoRoot });
    mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
    writeArtifact(repoRoot, "docs/politics-inventory-census-summary.json", artifacts.inventoryCensusSummary);
    writeArtifact(repoRoot, "docs/politics-inventory-by-venue.json", artifacts.inventoryByVenue);
    writeArtifact(repoRoot, "docs/politics-row-shape-samples.json", artifacts.rowShapeSamples);
    writeArtifact(repoRoot, "docs/politics-extraction-failure-summary.json", artifacts.extractionFailureSummary);
    writeArtifact(repoRoot, "docs/politics-derived-family-taxonomy.json", artifacts.familyTaxonomy);
    writeArtifact(repoRoot, "docs/politics-family-proof-summary.json", artifacts.familyProofSummary);
    writeArtifact(repoRoot, "docs/politics-family-example-rows.json", artifacts.familyExampleRows);
    writeArtifact(repoRoot, "docs/politics-family-eligibility-summary.json", artifacts.familyEligibilitySummary);
    writeArtifact(repoRoot, "docs/politics-structural-fingerprint-summary.json", artifacts.structuralFingerprintSummary);
    writeArtifact(repoRoot, "docs/politics-structural-fingerprint-samples.json", artifacts.structuralFingerprintSamples);
    writeArtifact(repoRoot, "docs/politics-family-critical-fields.json", artifacts.familyCriticalFields);
    writeArtifact(repoRoot, "docs/politics-candidate-prefilter-summary.json", artifacts.candidatePrefilterSummary);
    writeArtifact(repoRoot, "docs/politics-prefilter-rejection-breakdown.json", artifacts.prefilterRejectionBreakdown);
    writeArtifact(repoRoot, "docs/politics-prefilter-by-family.json", artifacts.prefilterByFamily);
    writeArtifact(repoRoot, "docs/politics-match-quality-summary.json", artifacts.matchQualitySummary);
    writeArtifact(repoRoot, "docs/politics-family-edge-summary.json", artifacts.familyEdgeSummary);
    writeArtifact(repoRoot, "docs/politics-approved-exact-safe-edges.json", artifacts.approvedExactSafeEdges);
    writeArtifact(repoRoot, "docs/politics-pair-routeability-summary.json", artifacts.pairRouteabilitySummary);
    writeArtifact(repoRoot, "docs/politics-pair-sync-summary.json", artifacts.pairSyncSummary);
    writeArtifact(repoRoot, "docs/politics-tri-routeability-summary.json", artifacts.triRouteabilitySummary);
    writeArtifact(repoRoot, "docs/politics-review-queue-summary.json", artifacts.reviewQueueSummary);
    writeArtifact(repoRoot, "docs/politics-final-decision.json", artifacts.finalDecision);
    writeArtifact(repoRoot, "docs/politics-frontier-comparison-summary.json", artifacts.frontierComparisonSummary);
    writeArtifact(repoRoot, "docs/politics-vs-sports-summary.json", artifacts.vsSportsSummary);
    writeArtifact(repoRoot, "docs/politics-vs-crypto-summary.json", artifacts.vsCryptoSummary);
    writeMarkdownArtifact(repoRoot, "docs/politics-operator-summary.md", `${artifacts.operatorSummary}\n`);
    console.log(JSON.stringify({
      finalDecision: artifacts.finalDecision,
      pairRouteability: artifacts.pairRouteabilitySummary
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build politics inventory grounded artifacts.");
  console.error(error);
  process.exit(1);
});
