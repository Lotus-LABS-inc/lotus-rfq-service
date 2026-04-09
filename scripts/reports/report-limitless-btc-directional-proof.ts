#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import {
  buildLimitlessBtcDirectionalAlignmentMatrix,
  buildKnownDirectionalWindows,
  buildLimitlessBtcDirectionalAlignmentMatrixMarkdown
} from "../../src/reports/limitless-btc-directional-alignment-matrix.js";
import {
  buildLimitlessBtcDirectionalDecisionArtifact,
  buildLimitlessBtcDirectionalDecisionMarkdown,
  buildLimitlessBtcDirectionalNextStepPlan,
  buildLimitlessBtcDirectionalNextStepPlanMarkdown,
  buildLimitlessBtcDirectionalOperatorSummary,
  buildLimitlessBtcDirectionalSourceHygieneSummary
} from "../../src/reports/limitless-btc-directional-decision.js";
import {
  buildLimitlessBtcDirectionalDiscoveryMap,
  buildLimitlessBtcDirectionalDiscoveryMapMarkdown
} from "../../src/reports/limitless-btc-directional-discovery-map.js";
import {
  buildLimitlessBtcDirectionalInventoryArtifact,
  buildLimitlessBtcDirectionalInventoryMarkdown
} from "../../src/reports/limitless-btc-directional-inventory.js";
import type { BtcInventoryAlignmentRow } from "../../src/reports/btc-audit-types.js";
import type { LimitlessBtcDirectionalAlignmentMatrix } from "../../src/reports/limitless-btc-directional-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const writeMarkdownArtifact = (repoRoot: string, relativePath: string, markdown: string): void => {
  writeFileSync(path.resolve(repoRoot, relativePath), markdown, "utf8");
};

const main = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const btcInventoryArtifactPath = path.resolve(repoRoot, "docs/btc-inventory-alignment-matrix.json");
  if (!existsSync(btcInventoryArtifactPath)) {
    throw new Error("docs/btc-inventory-alignment-matrix.json is required. Run the BTC family convergence audit first.");
  }

  const btcInventoryArtifact = JSON.parse(readFileSync(btcInventoryArtifactPath, "utf8")) as {
    rows: readonly BtcInventoryAlignmentRow[];
  };

    const discoveryMap = buildLimitlessBtcDirectionalDiscoveryMap({
      limitlessApiKeyPresent: Boolean(process.env.LIMITLESS_API_KEY)
    });
    writeArtifact(repoRoot, "docs/limitless-btc-directional-discovery-map.json", discoveryMap);
    writeMarkdownArtifact(repoRoot, "docs/limitless-btc-directional-discovery-map.md", buildLimitlessBtcDirectionalDiscoveryMapMarkdown(discoveryMap));

    const inventory = await buildLimitlessBtcDirectionalInventoryArtifact({
      repoRoot,
      limitlessBaseUrl: process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange",
      limitlessApiKey: process.env.LIMITLESS_API_KEY ?? null
    });
    writeArtifact(repoRoot, "docs/limitless-btc-directional-inventory.json", inventory);
    writeMarkdownArtifact(repoRoot, "docs/limitless-btc-directional-inventory.md", buildLimitlessBtcDirectionalInventoryMarkdown(inventory));

    const knownWindows = buildKnownDirectionalWindows(btcInventoryArtifact.rows);
    const alignment: LimitlessBtcDirectionalAlignmentMatrix = {
      observedAt: new Date().toISOString(),
      knownWindows,
      limitlessCandidateCount: inventory.candidates.length,
      rows: buildLimitlessBtcDirectionalAlignmentMatrix({
        btcAuditData: {
          localMarkets: [],
          remoteMarkets: btcInventoryArtifact.rows,
          pairEdges: []
        },
        inventory
      }).rows
    };
    writeArtifact(repoRoot, "docs/limitless-btc-directional-alignment-matrix.json", alignment);
    writeMarkdownArtifact(repoRoot, "docs/limitless-btc-directional-alignment-matrix.md", buildLimitlessBtcDirectionalAlignmentMatrixMarkdown(alignment));

    const decision = buildLimitlessBtcDirectionalDecisionArtifact({
      inventory,
      alignment
    });
    writeArtifact(repoRoot, "docs/limitless-btc-directional-decision.json", decision);
    writeMarkdownArtifact(repoRoot, "docs/limitless-btc-directional-decision.md", buildLimitlessBtcDirectionalDecisionMarkdown(decision));

    const nextStepPlan = buildLimitlessBtcDirectionalNextStepPlan(decision);
    writeArtifact(repoRoot, "docs/limitless-btc-directional-next-step-plan.json", nextStepPlan);
    writeMarkdownArtifact(repoRoot, "docs/limitless-btc-directional-next-step-plan.md", buildLimitlessBtcDirectionalNextStepPlanMarkdown(nextStepPlan));

    const hygiene = buildLimitlessBtcDirectionalSourceHygieneSummary(inventory);
    writeArtifact(repoRoot, "docs/limitless-btc-directional-source-hygiene-summary.json", hygiene);

    writeMarkdownArtifact(
      repoRoot,
      "docs/limitless-btc-directional-operator-summary.md",
      buildLimitlessBtcDirectionalOperatorSummary({
        inventory,
        decision,
        alignment
      })
    );

    console.log(JSON.stringify({
      decision: decision.decision,
      exactSafeCounterpartExists: decision.exactSafeCounterpartExists,
      limitlessCandidateCount: inventory.candidates.length,
      alignmentRows: alignment.rows.length
    }, null, 2));
};

main().catch((error) => {
  console.error("Failed to run Limitless BTC directional proof.");
  console.error(error);
  process.exit(1);
});

