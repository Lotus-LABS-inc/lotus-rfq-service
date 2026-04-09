#!/usr/bin/env tsx
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { decideTimeBasisDualTrackNextStep } from "../../src/operations/semantic-expansion/time-basis-dual-track-decision.js";
import { readArtifact, writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const readJson = <T>(relativePath: string): T =>
  readArtifact<T>(process.cwd(), relativePath);

const main = async (): Promise<void> => {
  const timeBasisSummary = readJson("docs/time-basis-routeability-summary.json");
  const limitlessLiveSummary = existsSync(path.resolve(process.cwd(), "docs/limitless-live-ingestion-summary.json"))
    ? readJson("docs/limitless-live-ingestion-summary.json")
    : null;
  const opinionHistoricalSummary = existsSync(path.resolve(process.cwd(), "docs/opinion-historical-ingestion-summary.json"))
    ? readJson("docs/opinion-historical-ingestion-summary.json")
    : null;

  const decision = decideTimeBasisDualTrackNextStep({
    timeBasisSummary,
    limitlessLiveSummary,
    opinionHistoricalSummary
  });

  const jsonPayload = {
    observedAt: new Date().toISOString(),
    decision: decision.decision,
    rationale: decision.rationale
  };
  writeArtifact(process.cwd(), "docs/time-basis-dual-track-next-step-decision.json", jsonPayload);
  const markdown = [
    "# Time-Basis Dual-Track Next Step",
    "",
    `Decision: ${decision.decision}`,
    "",
    ...decision.rationale.map((line) => `- ${line}`)
  ].join("\n");
  writeFileSync(
    path.resolve(process.cwd(), "docs/time-basis-dual-track-next-step-decision.md"),
    `${markdown}\n`,
    "utf8"
  );

  console.log(JSON.stringify(jsonPayload, null, 2));
};

main().catch((error) => {
  console.error("Failed to build time-basis dual-track decision.");
  console.error(error);
  process.exit(1);
});

