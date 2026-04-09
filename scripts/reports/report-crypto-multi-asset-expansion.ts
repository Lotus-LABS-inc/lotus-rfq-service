#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { readArtifact, writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { buildCryptoMatchingQualitySummary } from "../../src/reports/crypto-matching-quality-summary.js";
import { buildCryptoPairRouteabilitySummary } from "../../src/reports/crypto-pair-routeability-summary.js";
import {
  buildCryptoMultiAssetDeltaVsBtcMarkdown,
  buildCryptoMultiAssetExpansionArtifacts,
  buildCryptoMultiAssetNextStepDecisionMarkdown
} from "../../src/reports/crypto-multi-asset-expansion.js";
import type { CryptoMatchingQualitySummary } from "../../src/reports/crypto-matching-quality-summary.js";
import type { CryptoPairRouteabilitySummary } from "../../src/reports/crypto-pair-routeability-summary.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const readJsonArtifact = <T>(artifactPath: string): T | null => {
  if (!existsSync(artifactPath)) {
    return null;
  }
  return readArtifact<T>(process.cwd(), `docs/${path.basename(artifactPath)}`);
};

const writeMarkdownArtifact = (relativePath: string, content: string): void => {
  writeFileSync(path.resolve(process.cwd(), relativePath), content, "utf8");
};

const loadBaselineArtifacts = async (pool: Pool): Promise<{
  matchingQuality: CryptoMatchingQualitySummary;
  routeability: CryptoPairRouteabilitySummary;
}> => {
  const matchingQualityPath = path.resolve(process.cwd(), "docs/crypto-matching-quality-summary.json");
  const routeabilityPath = path.resolve(process.cwd(), "docs/crypto-pair-routeability-summary.json");
  const matchingQuality = readJsonArtifact<CryptoMatchingQualitySummary>(matchingQualityPath) ?? await buildCryptoMatchingQualitySummary(pool);
  const routeability = readJsonArtifact<CryptoPairRouteabilitySummary>(routeabilityPath) ?? await buildCryptoPairRouteabilitySummary(pool);
  return { matchingQuality, routeability };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-crypto-multi-asset-expansion"
  });

  try {
    const baseline = await loadBaselineArtifacts(pool);
    const artifacts = await buildCryptoMultiAssetExpansionArtifacts({
      pool,
      baseline
    });

    writeArtifact(process.cwd(), "docs/crypto-scope-activation-summary.json", artifacts.scopeActivation);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-family-summary.json", artifacts.familySummary);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-fingerprint-summary.json", artifacts.fingerprintSummary);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-prefilter-summary.json", artifacts.prefilterSummary);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-edge-summary.json", artifacts.edgeSummary);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-pair-routeability-summary.json", artifacts.pairRouteabilitySummary);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-graph-summary.json", artifacts.graphSummary);
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-delta-vs-btc.json", artifacts.deltaVsBtc);
    writeMarkdownArtifact("docs/crypto-multi-asset-delta-vs-btc.md", buildCryptoMultiAssetDeltaVsBtcMarkdown(artifacts.deltaVsBtc));
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-next-step-decision.json", artifacts.decision);
    writeMarkdownArtifact("docs/crypto-multi-asset-next-step-decision.md", buildCryptoMultiAssetNextStepDecisionMarkdown(artifacts.decision));
    writeArtifact(process.cwd(), "docs/crypto-multi-asset-source-hygiene-summary.json", artifacts.sourceHygiene);
    writeMarkdownArtifact("docs/crypto-multi-asset-operator-summary.md", artifacts.operatorSummary);

    console.log(JSON.stringify({
      decision: artifacts.decision.decision,
      bestPerformingAsset: artifacts.decision.bestPerformingAsset,
      bestPerformingFamily: artifacts.decision.bestPerformingFamily,
      exactSafeApprovedEdges: artifacts.pairRouteabilitySummary.exactSafeApprovedCount
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build crypto multi-asset expansion artifacts.");
  console.error(error);
  process.exit(1);
});

