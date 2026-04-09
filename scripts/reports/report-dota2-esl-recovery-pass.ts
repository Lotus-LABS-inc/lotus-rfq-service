#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { readArtifact, writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildDota2EslArtifacts,
  buildDota2EslCurrentStateAuditMarkdown,
  buildDota2EslDateWindowMarkdown,
  buildDota2EslDeltaMarkdown,
  buildDota2EslFinalDecisionMarkdown,
  buildDota2EslMatchIdentityMarkdown,
  buildDota2EslRouteabilityMarkdown,
  buildDota2EslSourceHygieneMarkdown,
  buildDota2EslTargetedRecoveryMarkdown,
  type Dota2EslBaseline
} from "../../src/reports/dota2-esl-recovery-pass.js";

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
  return readArtifact<T>(process.cwd(), `docs/${path.basename(artifactPath)}`);
};

const writeMarkdownArtifact = (relativePath: string, content: string): void => {
  writeFileSync(path.resolve(process.cwd(), relativePath), content, "utf8");
};

const buildBaseline = (): Dota2EslBaseline => {
  const admissionSummary = readJsonArtifact<{
    admittedCountsByPocket?: Record<string, number>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-admission-summary.json"));
  const edgeSummary = readJsonArtifact<{
    perPocket?: Record<string, {
      candidatePairsConsidered?: number;
      exactSafeEdgesApproved?: number;
      dominantBlockers?: Record<string, number>;
    }>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-edge-summary.json"));
  const routeabilitySummary = readJsonArtifact<{
    exactSafeApprovedEdges?: number;
    pairRouteableOpportunities?: number;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-routeability-summary.json"));
  const dateRootCauseSummary = readJsonArtifact<{
    perPocket?: Record<string, { pairRootCauseCounts?: Record<string, number> }>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-date-root-cause-summary.json"));
  const identitySummary = readJsonArtifact<{
    perPocket?: Record<string, { pairRootCauseCounts?: Record<string, number> }>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-match-identity-summary.json"));

  const pocketKey = "ESPORTS|MATCHUP_WINNER|DOTA2_ESL";
  const edge = edgeSummary.perPocket?.[pocketKey];
  const blockers = {
    ...(identitySummary.perPocket?.[pocketKey]?.pairRootCauseCounts ?? {}),
    ...(dateRootCauseSummary.perPocket?.[pocketKey]?.pairRootCauseCounts ?? {}),
    ...(edge?.dominantBlockers ?? {})
  };

  return {
    admittedRows: admissionSummary.admittedCountsByPocket?.[pocketKey] ?? 0,
    candidatePairs: edge?.candidatePairsConsidered ?? 0,
    exactSafeEdges: edge?.exactSafeEdgesApproved ?? 0,
    routeableOpportunities: routeabilitySummary.exactSafeApprovedEdges ?? 0,
    blockerCounts: blockers
  };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-dota2-esl-recovery-pass"
  });

  try {
    const artifacts = await buildDota2EslArtifacts({
      pool,
      baseline: buildBaseline()
    });

    writeArtifact(process.cwd(), "docs/dota2-esl-current-state-audit.json", artifacts.currentStateAudit);
    writeMarkdownArtifact("docs/dota2-esl-current-state-audit.md", buildDota2EslCurrentStateAuditMarkdown(artifacts.currentStateAudit));
    writeArtifact(process.cwd(), "docs/dota2-esl-source-hygiene-summary.json", artifacts.sourceHygieneSummary);
    writeMarkdownArtifact("docs/dota2-esl-source-hygiene-summary.md", buildDota2EslSourceHygieneMarkdown(artifacts.sourceHygieneSummary));
    writeArtifact(process.cwd(), "docs/dota2-esl-match-identity-summary.json", artifacts.matchIdentitySummary);
    writeMarkdownArtifact("docs/dota2-esl-match-identity-summary.md", buildDota2EslMatchIdentityMarkdown(artifacts.matchIdentitySummary));
    writeArtifact(process.cwd(), "docs/dota2-esl-date-window-summary.json", artifacts.dateWindowSummary);
    writeMarkdownArtifact("docs/dota2-esl-date-window-summary.md", buildDota2EslDateWindowMarkdown(artifacts.dateWindowSummary));
    writeArtifact(process.cwd(), "docs/dota2-esl-targeted-recovery-summary.json", artifacts.targetedRecoverySummary);
    writeMarkdownArtifact("docs/dota2-esl-targeted-recovery-summary.md", buildDota2EslTargetedRecoveryMarkdown(artifacts.targetedRecoverySummary));
    writeArtifact(process.cwd(), "docs/dota2-esl-routeability-summary.json", artifacts.routeabilitySummary);
    writeMarkdownArtifact("docs/dota2-esl-routeability-summary.md", buildDota2EslRouteabilityMarkdown(artifacts.routeabilitySummary));
    writeArtifact(process.cwd(), "docs/dota2-esl-delta-summary.json", artifacts.deltaSummary);
    writeMarkdownArtifact("docs/dota2-esl-delta-summary.md", buildDota2EslDeltaMarkdown(artifacts.deltaSummary));
    writeArtifact(process.cwd(), "docs/dota2-esl-final-decision.json", artifacts.finalDecision);
    writeMarkdownArtifact("docs/dota2-esl-final-decision.md", buildDota2EslFinalDecisionMarkdown(artifacts.finalDecision));
    writeMarkdownArtifact("docs/dota2-esl-operator-summary.md", artifacts.operatorSummary);

    console.log(JSON.stringify({
      decision: artifacts.finalDecision.decision,
      nextStep: artifacts.finalDecision.nextStepRecommendation,
      admittedRowsAfter: artifacts.routeabilitySummary.admittedRows,
      exactSafeEdgesAfter: artifacts.routeabilitySummary.exactSafeApprovedEdges
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build DOTA2_ESL recovery artifacts.");
  console.error(error);
  process.exit(1);
});

