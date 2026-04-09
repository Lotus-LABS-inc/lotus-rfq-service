#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildSportsPocketAdmissionMarkdown,
  buildSportsPocketBasisSummaryMarkdown,
  buildSportsPocketCoverageMatrixMarkdown,
  buildSportsPocketDateRootCauseMarkdown,
  buildSportsPocketDateWindowMarkdown,
  buildSportsPocketEdgeMarkdown,
  buildSportsPocketEntityMarkdown,
  buildSportsPocketFinalDecisionMarkdown,
  buildSportsPocketMatchIdentityMarkdown,
  buildSportsPocketNextStepDecisionMarkdown,
  buildSportsPocketPassArtifacts,
  buildSportsPocketPrefilterMarkdown
  ,
  buildSportsPocketPriorityRecommendationMarkdown,
  buildSportsPocketRootCauseClassifierMarkdown,
  buildSportsPocketTargetedRecoveryPlanMarkdown
} from "../../src/reports/sports-pocket-pass.js";
import type {
  CryptoMultiAssetGraphSummary,
  CryptoMultiAssetPairRouteabilitySummary
} from "../../src/reports/crypto-multi-asset-expansion.js";
import type {
  SportsFamilyGraphSummary,
  SportsFamilyPairRouteabilitySummary
} from "../../src/reports/sports-family-pass.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const readJsonArtifact = <T>(artifactPath: string): T => {
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing required artifact: ${artifactPath}`);
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
    application_name: "report-sports-pocket-pass"
  });

  try {
    const priorSportsGraph = readJsonArtifact<SportsFamilyGraphSummary>(
      path.resolve(process.cwd(), "docs/sports-family-graph-summary.json")
    );
    const priorSportsRouteability = readJsonArtifact<SportsFamilyPairRouteabilitySummary>(
      path.resolve(process.cwd(), "docs/sports-family-pair-routeability-summary.json")
    );
    const cryptoGraph = readJsonArtifact<CryptoMultiAssetGraphSummary>(
      path.resolve(process.cwd(), "docs/crypto-multi-asset-graph-summary.json")
    );
    const cryptoRouteability = readJsonArtifact<CryptoMultiAssetPairRouteabilitySummary>(
      path.resolve(process.cwd(), "docs/crypto-multi-asset-pair-routeability-summary.json")
    );

    const artifacts = await buildSportsPocketPassArtifacts({
      pool,
      priorSportsGraph,
      priorSportsRouteability,
      cryptoGraph,
      cryptoRouteability
    });

    writeArtifact(process.cwd(), "docs/sports-pocket-admission-summary.json", artifacts.admissionSummary);
    writeMarkdownArtifact("docs/sports-pocket-admission-summary.md", buildSportsPocketAdmissionMarkdown(artifacts.admissionSummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-entity-summary.json", artifacts.entitySummary);
    writeMarkdownArtifact("docs/sports-pocket-entity-summary.md", buildSportsPocketEntityMarkdown(artifacts.entitySummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-date-window-summary.json", artifacts.dateWindowSummary);
    writeMarkdownArtifact("docs/sports-pocket-date-window-summary.md", buildSportsPocketDateWindowMarkdown(artifacts.dateWindowSummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-outcome-structure-summary.json", artifacts.outcomeStructureSummary);
    writeArtifact(process.cwd(), "docs/sports-pocket-coverage-matrix.json", artifacts.coverageMatrix);
    writeMarkdownArtifact("docs/sports-pocket-coverage-matrix.md", buildSportsPocketCoverageMatrixMarkdown(artifacts.coverageMatrix));
    writeArtifact(process.cwd(), "docs/sports-pocket-basis-summary.json", artifacts.basisSummary);
    writeMarkdownArtifact("docs/sports-pocket-basis-summary.md", buildSportsPocketBasisSummaryMarkdown(artifacts.basisSummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-match-identity-summary.json", artifacts.matchIdentitySummary);
    writeMarkdownArtifact("docs/sports-pocket-match-identity-summary.md", buildSportsPocketMatchIdentityMarkdown(artifacts.matchIdentitySummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-date-root-cause-summary.json", artifacts.dateRootCauseSummary);
    writeMarkdownArtifact("docs/sports-pocket-date-root-cause-summary.md", buildSportsPocketDateRootCauseMarkdown(artifacts.dateRootCauseSummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-prefilter-summary.json", artifacts.prefilterSummary);
    writeMarkdownArtifact("docs/sports-pocket-prefilter-summary.md", buildSportsPocketPrefilterMarkdown(artifacts.prefilterSummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-edge-summary.json", artifacts.edgeSummary);
    writeMarkdownArtifact("docs/sports-pocket-edge-summary.md", buildSportsPocketEdgeMarkdown(artifacts.edgeSummary));
    writeArtifact(process.cwd(), "docs/sports-pocket-routeability-summary.json", artifacts.routeabilitySummary);
    writeArtifact(process.cwd(), "docs/sports-pocket-delta-vs-prior-sports.json", artifacts.deltaVsPriorSports);
    writeArtifact(process.cwd(), "docs/sports-pocket-delta-vs-crypto.json", artifacts.deltaVsCrypto);
    writeArtifact(process.cwd(), "docs/sports-pocket-root-cause-classifier.json", artifacts.rootCauseClassifier);
    writeMarkdownArtifact("docs/sports-pocket-root-cause-classifier.md", buildSportsPocketRootCauseClassifierMarkdown(artifacts.rootCauseClassifier));
    writeArtifact(process.cwd(), "docs/sports-pocket-targeted-recovery-plan.json", artifacts.targetedRecoveryPlan);
    writeMarkdownArtifact("docs/sports-pocket-targeted-recovery-plan.md", buildSportsPocketTargetedRecoveryPlanMarkdown(artifacts.targetedRecoveryPlan));
    writeArtifact(process.cwd(), "docs/sports-pocket-priority-recommendation.json", artifacts.priorityRecommendation);
    writeMarkdownArtifact("docs/sports-pocket-priority-recommendation.md", buildSportsPocketPriorityRecommendationMarkdown(artifacts.priorityRecommendation));
    writeArtifact(process.cwd(), "docs/sports-pocket-source-hygiene-summary.json", artifacts.sourceHygieneSummary);
    writeArtifact(process.cwd(), "docs/sports-pocket-next-step-decision.json", artifacts.decision);
    writeMarkdownArtifact("docs/sports-pocket-next-step-decision.md", buildSportsPocketNextStepDecisionMarkdown(artifacts.decision));
    writeArtifact(process.cwd(), "docs/sports-pocket-final-decision.json", artifacts.finalDecision);
    writeMarkdownArtifact("docs/sports-pocket-final-decision.md", buildSportsPocketFinalDecisionMarkdown(artifacts.finalDecision));
    writeMarkdownArtifact("docs/sports-pocket-operator-summary.md", artifacts.operatorSummary);

    console.log(JSON.stringify({
      decision: artifacts.decision.decision,
      bestPerformingPocket: artifacts.decision.bestPerformingPocket,
      bestPerformingVenuePair: artifacts.decision.bestPerformingVenuePair,
      exactSafeApprovedEdges: artifacts.routeabilitySummary.exactSafeApprovedEdges
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build sports pocket pass artifacts.");
  console.error(error);
  process.exit(1);
});

