#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact, writeMarkdownArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { PairEdgeRepository } from "../../src/repositories/pair-edge.repository.js";
import { buildPoliticsNomineeLivePassArtifactsFromRepository } from "../../src/reports/politics-nominee-live-pass.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-politics-nominee-live-pass"
  });

  try {
    const repoRoot = process.cwd();
    const repository = new PairEdgeRepository(pool);
    const artifacts = await buildPoliticsNomineeLivePassArtifactsFromRepository({
      repository,
      repoRoot
    });

    writeArtifact(repoRoot, "docs/politics-nominee-live-inventory-summary.json", artifacts.liveInventorySummary);
    writeArtifact(repoRoot, "docs/politics-nominee-live-inventory-by-venue.json", artifacts.liveInventoryByVenue);
    writeArtifact(repoRoot, "docs/politics-nominee-live-fetch-status.json", artifacts.liveFetchStatus);
    writeArtifact(repoRoot, "docs/politics-nominee-live-row-samples.json", artifacts.liveRowSamples);
    writeArtifact(repoRoot, "docs/politics-nominee-admission-summary.json", artifacts.admissionSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-admission-rejections.json", artifacts.admissionRejections);
    writeArtifact(repoRoot, "docs/politics-nominee-admitted-rows.json", artifacts.admittedRows);
    writeArtifact(repoRoot, "docs/politics-nominee-basis-schema-summary.json", artifacts.basisSchemaSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-basis-normalization-summary.json", artifacts.basisNormalizationSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-basis-samples.json", artifacts.basisSamples);
    writeArtifact(repoRoot, "docs/politics-nominee-basis-fragmentation-summary.json", artifacts.basisFragmentationSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-fragmentation-by-venue-pair.json", artifacts.fragmentationByVenuePair);
    writeArtifact(repoRoot, "docs/politics-nominee-comparable-clusters.json", artifacts.comparableClusters);
    writeArtifact(repoRoot, "docs/politics-nominee-eligibility-decision.json", artifacts.eligibilityDecision);
    writeArtifact(repoRoot, "docs/politics-nominee-eligibility-rationale.json", artifacts.eligibilityRationale);
    writeArtifact(repoRoot, "docs/politics-nominee-narrow-splits.json", artifacts.narrowSplits);
    writeArtifact(repoRoot, "docs/politics-nominee-prematch-readiness-summary.json", artifacts.prematchReadinessSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-candidate-pair-inputs.json", artifacts.candidatePairInputs);
    writeArtifact(repoRoot, "docs/politics-nominee-exact-safe-subgroup-summary.json", artifacts.exactSafeSubgroupSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-delta-vs-census.json", artifacts.deltaVsCensus);
    writeArtifact(repoRoot, "docs/politics-nominee-live-improvement-summary.json", artifacts.liveImprovementSummary);
    writeArtifact(repoRoot, "docs/politics-nominee-final-decision.json", artifacts.finalDecision);
    writeMarkdownArtifact(repoRoot, "docs/politics-nominee-operator-summary.md", `${artifacts.operatorSummary}\n`);

    console.log(JSON.stringify({
      finalDecision: artifacts.finalDecision,
      admittedRows: artifacts.admissionSummary.admittedCount,
      comparableClusters: artifacts.comparableClusters.length
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build politics nominee live pass artifacts.");
  console.error(error);
  process.exit(1);
});
