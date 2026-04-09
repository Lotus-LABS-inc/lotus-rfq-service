#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildSportsCompetitionContextMarkdown,
  buildSportsFamilyDeltaVsCryptoMarkdown,
  buildSportsFamilyEdgeMarkdown,
  buildSportsFamilyNextStepDecisionMarkdown,
  buildSportsFamilyPassArtifacts,
  buildSportsFamilyTaxonomyMarkdown,
  buildSportsPrefilterMarkdown,
  buildSportsSubjectEntityMarkdown
} from "../../src/reports/sports-family-pass.js";
import type {
  CryptoMultiAssetGraphSummary,
  CryptoMultiAssetPairRouteabilitySummary
} from "../../src/reports/crypto-multi-asset-expansion.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const readJsonArtifact = <T>(artifactPath: string): T => {
  if (!existsSync(artifactPath)) {
    throw new Error(`Required artifact missing: ${artifactPath}`);
  }
  return JSON.parse(readFileSync(artifactPath, "utf8")) as T;
};

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
    application_name: "report-sports-family-pass"
  });

  try {
    const cryptoGraph = readJsonArtifact<CryptoMultiAssetGraphSummary>(
      path.resolve(process.cwd(), "docs/crypto-multi-asset-graph-summary.json")
    );
    const cryptoRouteability = readJsonArtifact<CryptoMultiAssetPairRouteabilitySummary>(
      path.resolve(process.cwd(), "docs/crypto-multi-asset-pair-routeability-summary.json")
    );

    const artifacts = await buildSportsFamilyPassArtifacts({
      pool,
      cryptoGraph,
      cryptoRouteability
    });

    writeArtifact(process.cwd(), "docs/sports-family-taxonomy-summary.json", artifacts.taxonomySummary);
    writeMarkdownArtifact("docs/sports-family-taxonomy-summary.md", buildSportsFamilyTaxonomyMarkdown(artifacts.taxonomySummary));
    writeArtifact(process.cwd(), "docs/sports-competition-context-summary.json", artifacts.competitionSummary);
    writeMarkdownArtifact("docs/sports-competition-context-summary.md", buildSportsCompetitionContextMarkdown(artifacts.competitionSummary));
    writeArtifact(process.cwd(), "docs/sports-subject-entity-summary.json", artifacts.subjectSummary);
    writeMarkdownArtifact("docs/sports-subject-entity-summary.md", buildSportsSubjectEntityMarkdown(artifacts.subjectSummary));
    writeArtifact(process.cwd(), "docs/sports-structural-fingerprint-summary.json", artifacts.fingerprintSummary);
    writeArtifact(process.cwd(), "docs/sports-prefilter-summary.json", artifacts.prefilterSummary);
    writeMarkdownArtifact("docs/sports-prefilter-summary.md", buildSportsPrefilterMarkdown(artifacts.prefilterSummary));
    writeArtifact(process.cwd(), "docs/sports-family-edge-summary.json", artifacts.edgeSummary);
    writeMarkdownArtifact("docs/sports-family-edge-summary.md", buildSportsFamilyEdgeMarkdown(artifacts.edgeSummary));
    writeArtifact(process.cwd(), "docs/sports-family-pair-routeability-summary.json", artifacts.pairRouteabilitySummary);
    writeArtifact(process.cwd(), "docs/sports-family-graph-summary.json", artifacts.graphSummary);
    writeArtifact(process.cwd(), "docs/sports-family-delta-vs-crypto.json", artifacts.deltaVsCrypto);
    writeMarkdownArtifact("docs/sports-family-delta-vs-crypto.md", buildSportsFamilyDeltaVsCryptoMarkdown(artifacts.deltaVsCrypto));
    writeArtifact(process.cwd(), "docs/sports-family-next-step-decision.json", artifacts.decision);
    writeMarkdownArtifact("docs/sports-family-next-step-decision.md", buildSportsFamilyNextStepDecisionMarkdown(artifacts.decision));
    writeArtifact(process.cwd(), "docs/sports-family-source-hygiene-summary.json", artifacts.sourceHygiene);
    writeMarkdownArtifact("docs/sports-family-operator-summary.md", artifacts.operatorSummary);

    console.log(JSON.stringify({
      decision: artifacts.decision.decision,
      bestPerformingFamily: artifacts.decision.bestPerformingFamily,
      bestPerformingVenuePair: artifacts.decision.bestPerformingVenuePair,
      exactSafeApprovedEdges: artifacts.pairRouteabilitySummary.exactSafeApprovedCount
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build sports family pass artifacts.");
  console.error(error);
  process.exit(1);
});

