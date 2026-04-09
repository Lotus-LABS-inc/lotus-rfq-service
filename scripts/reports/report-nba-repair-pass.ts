#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { readArtifact, writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildNbaDateRepairSummaryMarkdown,
  buildNbaMatchIdentityRepairSummaryMarkdown,
  buildNbaMatchInstanceProofSummaryMarkdown,
  buildNbaPocketRepairedRouteabilitySummaryMarkdown,
  buildNbaRepairArtifacts,
  buildNbaRepairCurrentStateAuditMarkdown,
  buildNbaRepairDeltaSummaryMarkdown,
  buildNbaRepairFinalDecisionMarkdown,
  type NbaRepairBaseline
} from "../../src/reports/nba-repair-pass.js";

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

const buildBaseline = (): NbaRepairBaseline => {
  const dateRootCause = readJsonArtifact<{
    perPocket?: Record<string, { rows?: Array<{ eventDate?: string | null }>; pairRootCauseCounts?: Record<string, number> }>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-date-root-cause-summary.json"));
  const matchIdentity = readJsonArtifact<{
    perPocket?: Record<string, { pairRootCauseCounts?: Record<string, number> }>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-match-identity-summary.json"));
  const edgeSummary = readJsonArtifact<{
    perPocket?: Record<string, { candidatePairsConsidered?: number; exactSafeEdgesApproved?: number }>;
  }>(path.resolve(process.cwd(), "docs/sports-pocket-edge-summary.json"));

  const nbaDate = dateRootCause.perPocket?.["SPORTS|MATCHUP_WINNER|NBA"];
  const nbaIdentity = matchIdentity.perPocket?.["SPORTS|MATCHUP_WINNER|NBA"];
  const nbaEdge = edgeSummary.perPocket?.["SPORTS|MATCHUP_WINNER|NBA"];

  return {
    preRepairBadDateRows: (nbaDate?.rows ?? []).filter((row) => String(row.eventDate ?? "").startsWith("1970-")).length,
    preRepairCandidatePairsConsidered: nbaEdge?.candidatePairsConsidered ?? 0,
    preRepairMatchIdentityRejects:
      (nbaIdentity?.pairRootCauseCounts?.["SUBJECT_ENTITY_MISMATCH"] ?? 0)
      + (nbaIdentity?.pairRootCauseCounts?.["OPPONENT_MISMATCH"] ?? 0)
      + (nbaIdentity?.pairRootCauseCounts?.["MATCH_INSTANCE_AMBIGUOUS"] ?? 0),
    preRepairDateAlignmentRejects: nbaDate?.pairRootCauseCounts?.["DATE_WINDOW_MISMATCH"] ?? 0,
    preRepairExactSafeEdges: nbaEdge?.exactSafeEdgesApproved ?? 0,
    preRepairRouteableOpportunities: nbaEdge?.exactSafeEdgesApproved ?? 0
  };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-nba-repair-pass"
  });

  try {
    const artifacts = await buildNbaRepairArtifacts({
      pool,
      baseline: buildBaseline()
    });

    writeArtifact(process.cwd(), "docs/nba-repair-current-state-audit.json", artifacts.currentStateAudit);
    writeMarkdownArtifact("docs/nba-repair-current-state-audit.md", buildNbaRepairCurrentStateAuditMarkdown(artifacts.currentStateAudit));
    writeArtifact(process.cwd(), "docs/nba-date-repair-summary.json", artifacts.dateRepairSummary);
    writeMarkdownArtifact("docs/nba-date-repair-summary.md", buildNbaDateRepairSummaryMarkdown(artifacts.dateRepairSummary));
    writeArtifact(process.cwd(), "docs/nba-match-identity-repair-summary.json", artifacts.matchIdentityRepairSummary);
    writeMarkdownArtifact("docs/nba-match-identity-repair-summary.md", buildNbaMatchIdentityRepairSummaryMarkdown(artifacts.matchIdentityRepairSummary));
    writeArtifact(process.cwd(), "docs/nba-match-instance-proof-summary.json", artifacts.matchInstanceProofSummary);
    writeMarkdownArtifact("docs/nba-match-instance-proof-summary.md", buildNbaMatchInstanceProofSummaryMarkdown(artifacts.matchInstanceProofSummary));
    writeArtifact(process.cwd(), "docs/nba-pocket-repaired-routeability-summary.json", artifacts.routeabilitySummary);
    writeMarkdownArtifact("docs/nba-pocket-repaired-routeability-summary.md", buildNbaPocketRepairedRouteabilitySummaryMarkdown(artifacts.routeabilitySummary));
    writeArtifact(process.cwd(), "docs/nba-repair-delta-summary.json", artifacts.deltaSummary);
    writeMarkdownArtifact("docs/nba-repair-delta-summary.md", buildNbaRepairDeltaSummaryMarkdown(artifacts.deltaSummary));
    writeArtifact(process.cwd(), "docs/nba-repair-final-decision.json", artifacts.finalDecision);
    writeMarkdownArtifact("docs/nba-repair-final-decision.md", buildNbaRepairFinalDecisionMarkdown(artifacts.finalDecision));
    writeMarkdownArtifact("docs/nba-repair-operator-summary.md", artifacts.operatorSummary);

    console.log(JSON.stringify({
      decision: artifacts.finalDecision.decision,
      exactSafeApprovedEdges: artifacts.finalDecision.exactSafeApprovedEdges,
      dominantProofClass: artifacts.finalDecision.dominantProofClass,
      nextStep: artifacts.finalDecision.primaryNextStepRecommendation
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build NBA repair artifacts.");
  console.error(error);
  process.exit(1);
});

