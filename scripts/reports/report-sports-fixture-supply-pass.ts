#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildSportsFixtureBindingSummaryMarkdown,
  buildSportsFixtureCoverageMatrixMarkdown,
  buildSportsFixtureModelSummaryMarkdown,
  buildSportsFixtureSupplyArtifacts,
  buildSportsLiveFixtureIngestionReadinessMarkdown,
  buildSportsPocketSupplySummaryMarkdown,
  buildSportsTargetedSupplyRecoveryPlanMarkdown
} from "../../src/reports/sports-fixture-supply-pass.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const writeMarkdownArtifact = (relativePath: string, content: string): void => {
  writeFileSync(path.resolve(process.cwd(), relativePath), content, "utf8");
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-sports-fixture-supply-pass"
  });

  try {
    const artifacts = await buildSportsFixtureSupplyArtifacts({ pool });

    writeArtifact(process.cwd(), "docs/sports-fixture-model-summary.json", artifacts.fixtureModelSummary);
    writeMarkdownArtifact("docs/sports-fixture-model-summary.md", buildSportsFixtureModelSummaryMarkdown(artifacts.fixtureModelSummary));
    writeArtifact(process.cwd(), "docs/sports-fixture-binding-summary.json", artifacts.fixtureBindingSummary);
    writeMarkdownArtifact("docs/sports-fixture-binding-summary.md", buildSportsFixtureBindingSummaryMarkdown(artifacts.fixtureBindingSummary));
    writeArtifact(process.cwd(), "docs/sports-fixture-coverage-matrix.json", artifacts.fixtureCoverageMatrix);
    writeMarkdownArtifact("docs/sports-fixture-coverage-matrix.md", buildSportsFixtureCoverageMatrixMarkdown(artifacts.fixtureCoverageMatrix));
    writeArtifact(process.cwd(), "docs/sports-pocket-supply-summary.json", artifacts.pocketSupplySummary);
    writeMarkdownArtifact("docs/sports-pocket-supply-summary.md", buildSportsPocketSupplySummaryMarkdown(artifacts.pocketSupplySummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-gap-classifier.json", artifacts.pocketGapClassifier);
    writeArtifact(process.cwd(), "docs/sports-targeted-supply-recovery-plan.json", artifacts.targetedSupplyRecoveryPlan);
    writeMarkdownArtifact("docs/sports-targeted-supply-recovery-plan.md", buildSportsTargetedSupplyRecoveryPlanMarkdown(artifacts.targetedSupplyRecoveryPlan));
    writeArtifact(process.cwd(), "docs/sports-live-fixture-ingestion-readiness.json", artifacts.liveFixtureIngestionReadiness);
    writeMarkdownArtifact("docs/sports-live-fixture-ingestion-readiness.md", buildSportsLiveFixtureIngestionReadinessMarkdown(artifacts.liveFixtureIngestionReadiness));
    writeArtifact(process.cwd(), "docs/sports-fixture-final-decision.json", artifacts.finalDecision);
    writeMarkdownArtifact("docs/sports-fixture-operator-summary.md", artifacts.operatorSummary);

    console.log(JSON.stringify({
      decision: artifacts.finalDecision.decision,
      nextAction: artifacts.finalDecision.singleBestNextSportsAction,
      frontier: artifacts.finalDecision.sportsFrontierRecommendation
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build sports fixture supply pass artifacts.");
  console.error(error);
  process.exit(1);
});

