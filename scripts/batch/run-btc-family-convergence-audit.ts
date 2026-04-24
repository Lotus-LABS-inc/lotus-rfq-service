#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { CryptoMatchingPipeline } from "../../src/matching/crypto/crypto-matching-pipeline.js";
import { listRouteableCryptoPairEdges } from "../../src/matching/crypto/crypto-pair-graph.js";
import { runLimitlessLiveMarketIngestion } from "../../src/jobs/ingest-limitless-live-markets.job.js";
import { PairEdgeRepository } from "../../src/repositories/pair-edge.repository.js";
import { loadBtcAuditData } from "../../src/reports/btc-audit-shared.js";
import { buildBtcFamilyConvergenceSummary, buildBtcFamilyConvergenceSummaryMarkdown } from "../../src/reports/btc-family-convergence-summary.js";
import { buildBtcInventoryAlignmentMatrix, buildBtcInventoryAlignmentMatrixMarkdown } from "../../src/reports/btc-inventory-alignment-matrix.js";
import { buildBtcMissingEdgeRootCauseSummary, buildBtcMissingEdgeRootCauseSummaryMarkdown } from "../../src/reports/btc-missing-edge-root-cause-summary.js";
import { buildBtcNextStepDecision, buildBtcNextStepDecisionMarkdown } from "../../src/reports/btc-next-step-decision.js";
import { buildBtcSourceHygieneSummary } from "../../src/reports/btc-source-hygiene-summary.js";
import {
  buildBtcTargetedIngestionRecoverySummary,
  buildBtcTargetedIngestionRecoverySummaryMarkdown,
  type BtcRecoveryActionResult
} from "../../src/reports/btc-targeted-ingestion-recovery-summary.js";
import { buildCryptoMatchingQualitySummary } from "../../src/reports/crypto-matching-quality-summary.js";
import { buildCryptoPairRouteabilitySummary } from "../../src/reports/crypto-pair-routeability-summary.js";
import type { BtcAuditData, BtcMissingEdgeRootCauseSummary } from "../../src/reports/btc-audit-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const writeMarkdownArtifact = (repoRoot: string, relativePath: string, markdown: string): void => {
  const artifactPath = path.resolve(repoRoot, relativePath);
  writeFileSync(artifactPath, markdown, "utf8");
};

const buildCryptoSyncSummary = async (pool: Pool): Promise<Record<string, unknown>> => {
  const pipeline = new CryptoMatchingPipeline(new PairEdgeRepository(pool));
  const result = await pipeline.run();
  const routeablePairs = listRouteableCryptoPairEdges(result.pairGraph);
  const triFamilyPairs = new Map<string, Set<string>>();
  for (const edge of routeablePairs) {
    const venuePair = edge.leftVenue.localeCompare(edge.rightVenue) <= 0
      ? `${edge.leftVenue}_${edge.rightVenue}`
      : `${edge.rightVenue}_${edge.leftVenue}`;
    const pairs = triFamilyPairs.get(edge.family) ?? new Set<string>();
    pairs.add(venuePair);
    triFamilyPairs.set(edge.family, pairs);
  }

  return {
    observedAt: new Date().toISOString(),
    matchingVersionId: result.matchingVersion.id,
    sourceCryptoMarkets: result.classifiedMarkets.length,
    btcMarkets: result.btcMarkets.length,
    pairEdges: result.pairEdges.length,
    exactSafeApprovedEdges: routeablePairs.length,
    routeablePairsByFamily: routeablePairs.reduce<Record<string, number>>((accumulator, edge) => {
      accumulator[edge.family] = (accumulator[edge.family] ?? 0) + 1;
      return accumulator;
    }, {}),
    routeablePairsByVenuePair: routeablePairs.reduce<Record<string, number>>((accumulator, edge) => {
      const key = edge.leftVenue.localeCompare(edge.rightVenue) <= 0
        ? `${edge.leftVenue}_${edge.rightVenue}`
        : `${edge.rightVenue}_${edge.leftVenue}`;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {}),
    triCapableFamilies: [...triFamilyPairs.entries()].filter(([, pairs]) => pairs.size === 3).map(([family]) => family)
  };
};

const writeAuditArtifacts = (repoRoot: string, data: BtcAuditData): {
  familySummary: ReturnType<typeof buildBtcFamilyConvergenceSummary>;
  rootCauseSummary: ReturnType<typeof buildBtcMissingEdgeRootCauseSummary>;
} => {
  const matrix = buildBtcInventoryAlignmentMatrix(data);
  writeArtifact(repoRoot, "docs/btc-inventory-alignment-matrix.json", matrix);
  writeMarkdownArtifact(repoRoot, "docs/btc-inventory-alignment-matrix.md", buildBtcInventoryAlignmentMatrixMarkdown(matrix));

  const familySummary = buildBtcFamilyConvergenceSummary(data);
  writeArtifact(repoRoot, "docs/btc-family-convergence-summary.json", familySummary);
  writeMarkdownArtifact(repoRoot, "docs/btc-family-convergence-summary.md", buildBtcFamilyConvergenceSummaryMarkdown(familySummary));

  const rootCauseSummary = buildBtcMissingEdgeRootCauseSummary(data);
  writeArtifact(repoRoot, "docs/btc-missing-edge-root-cause-summary.json", rootCauseSummary);
  writeMarkdownArtifact(repoRoot, "docs/btc-missing-edge-root-cause-summary.md", buildBtcMissingEdgeRootCauseSummaryMarkdown(rootCauseSummary));

  const sourceHygieneSummary = buildBtcSourceHygieneSummary(data);
  writeArtifact(repoRoot, "docs/btc-source-hygiene-summary.json", sourceHygieneSummary);

  return { familySummary, rootCauseSummary };
};

const hasRecoverableLimitlessGap = (rootCauseSummary: BtcMissingEdgeRootCauseSummary): number =>
  new Set(
    rootCauseSummary.entries
      .filter((entry) =>
        entry.rootCause === "INGESTION_MISSING"
        && entry.venuePair.includes("LIMITLESS")
        && (entry.family === "THRESHOLD_BY_DATE" || entry.family === "SAME_DAY_DIRECTIONAL")
      )
      .map((entry) => `${entry.family}|${entry.windowLabel}`)
  ).size;

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const databaseUrl = process.env.DATABASE_URL;
  const opinionApiKey = process.env.OPINION_API_KEY;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!opinionApiKey) {
    throw new Error("OPINION_API_KEY is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "run-btc-family-convergence-audit"
  });

  try {
    let data = await loadBtcAuditData(pool, {
      repoRoot,
      opinionBaseUrl: process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi",
      opinionApiKey,
      predexonBaseUrl: process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com",
      predexonApiKey: process.env.PREDEXON_API_KEY ?? "",
      limitlessBaseUrl: process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
      limitlessApiKey: process.env.LIMITLESS_API_KEY ?? ""
    });

    let { familySummary, rootCauseSummary } = writeAuditArtifacts(repoRoot, data);
    const beforeRouteability = await buildCryptoPairRouteabilitySummary(pool);
    const recoveryActions: BtcRecoveryActionResult[] = [];
    let recoveryExecuted = false;
    let recoveryRationale = "";

    const recoverableLimitlessWindows = hasRecoverableLimitlessGap(rootCauseSummary);
    if (recoverableLimitlessWindows > 0) {
      recoveryExecuted = true;
      await runLimitlessLiveMarketIngestion({
        repoRoot,
        pool,
        categories: ["CRYPTO"],
        fetchRemote: true
      });
      recoveryActions.push({
        venue: "LIMITLESS",
        action: "refresh current-state crypto inventory from the live Limitless surface",
        candidateWindowCount: recoverableLimitlessWindows,
        newEligibleWindows: 0
      });
      recoveryRationale = "The audit found exact BTC counterpart windows on the live Limitless surface that were missing from local inventory, so a narrow Limitless crypto refresh was justified.";

      data = await loadBtcAuditData(pool, {
        repoRoot,
        opinionBaseUrl: process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi",
        opinionApiKey,
        predexonBaseUrl: process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com",
        predexonApiKey: process.env.PREDEXON_API_KEY ?? "",
        limitlessBaseUrl: process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
        limitlessApiKey: process.env.LIMITLESS_API_KEY ?? ""
      });
      ({ familySummary, rootCauseSummary } = writeAuditArtifacts(repoRoot, data));
    } else {
      recoveryRationale = "The remote BTC audit did not prove a narrow missing exact counterpart window on Limitless that would justify a scoped recovery pass without broadening inventory scope.";
    }

    const syncSummary = await buildCryptoSyncSummary(pool);
    writeArtifact(repoRoot, "docs/crypto-pair-matching-sync-summary.json", syncSummary);

    const matchingQuality = await buildCryptoMatchingQualitySummary(pool);
    writeArtifact(repoRoot, "docs/crypto-matching-quality-summary.json", matchingQuality);

    const routeability = await buildCryptoPairRouteabilitySummary(pool);
    writeArtifact(repoRoot, "docs/crypto-pair-routeability-summary.json", routeability);

    if (recoveryActions[0]) {
      recoveryActions[0].newEligibleWindows = Math.max(0, routeability.exactSafeApprovedCount - beforeRouteability.exactSafeApprovedCount);
    }

    const recoverySummary = buildBtcTargetedIngestionRecoverySummary({
      executed: recoveryExecuted,
      rationale: recoveryRationale,
      actions: recoveryActions,
      beforeExactSafeEdges: beforeRouteability.exactSafeApprovedCount,
      afterExactSafeEdges: routeability.exactSafeApprovedCount,
      rootCauseSummary
    });
    writeArtifact(repoRoot, "docs/btc-targeted-ingestion-recovery-summary.json", recoverySummary);
    writeMarkdownArtifact(repoRoot, "docs/btc-targeted-ingestion-recovery-summary.md", buildBtcTargetedIngestionRecoverySummaryMarkdown(recoverySummary));

    const nextStep = buildBtcNextStepDecision({
      familySummary,
      rootCauseSummary,
      routeability
    });
    writeArtifact(repoRoot, "docs/btc-next-step-decision.json", nextStep);
    writeMarkdownArtifact(repoRoot, "docs/btc-next-step-decision.md", buildBtcNextStepDecisionMarkdown(nextStep));

    console.log(JSON.stringify({
      family: nextStep.selectedFamily,
      decision: nextStep.decision,
      exactSafeEdges: nextStep.exactSafeEdges,
      limitlessOpinionExactPath: nextStep.limitlessOpinionExactPath,
      triCapableFamily: nextStep.triCapableFamily,
      dominantRootCause: rootCauseSummary.dominantRootCause
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run BTC family convergence audit.");
  console.error(error);
  process.exit(1);
});
