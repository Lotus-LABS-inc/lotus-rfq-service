import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getPolymarketExecutionAdapterV2EnvStatus,
  polymarketLiveSubmitOperatorConfirmation,
  runPolymarketLiveSubmitHarness
} from "../../src/execution-system/index.js";

const artifactDir = join(process.cwd(), "artifacts", "execution");
const checklistPath = join(artifactDir, "polymarket-live-submit-checklist.json");
const markdownPath = join(artifactDir, "polymarket-live-submit-checklist.md");

const result = await runPolymarketLiveSubmitHarness(process.env);
const status = getPolymarketExecutionAdapterV2EnvStatus(process.env);

const safeArtifact = {
  generatedAt: new Date().toISOString(),
  submitted: result.submitted,
  plan: result.plan,
  adapterStatus: {
    adapter: status.adapter,
    venue: status.venue,
    executionMode: status.executionMode,
    featureFlagSelected: status.featureFlagSelected,
    liveExecutionEnabled: status.liveExecutionEnabled,
    readinessState: status.readinessState,
    requiredEnvPresent: status.requiredEnvPresent,
    missingEnv: status.missingEnv,
    dryRunRequiredEnvPresent: status.dryRunRequiredEnvPresent,
    missingDryRunEnv: status.missingDryRunEnv,
    builderCodeConfigured: status.builderCodeConfigured,
    credentialsServerSideOnly: status.credentialsServerSideOnly,
    liveSubmissionStatus: status.liveSubmissionStatus
  },
  preparedOrder: result.preparedOrder ?? null,
  submitResult: result.submitResult ?? null,
  error: result.error ?? null
};

await mkdir(artifactDir, { recursive: true });
await writeFile(checklistPath, `${JSON.stringify(safeArtifact, null, 2)}\n`, "utf8");
await writeFile(
  markdownPath,
  [
    "# Polymarket Live Submit Harness Checklist",
    "",
    "This harness is operator-controlled and is not part of normal CI or startup flow.",
    "",
    "## Required Operator Env",
    "",
    "- `POLYMARKET_EXECUTION_MODE=v2`",
    "- `POLYMARKET_LIVE_EXECUTION_ENABLED=true`",
    "- `POLYMARKET_LIVE_SUBMIT_HARNESS_ENABLED=true`",
    `- \`POLYMARKET_LIVE_SUBMIT_OPERATOR_CONFIRM=${polymarketLiveSubmitOperatorConfirmation}\``,
    "- `POLYMARKET_LIVE_SUBMIT_MAINNET_ACK=true` if `POLYMARKET_CHAIN_ID=137`",
    "- `POLYMARKET_LIVE_SUBMIT_VENUE_MARKET_ID=<condition-or-market-id>`",
    "- `POLYMARKET_LIVE_SUBMIT_VENUE_OUTCOME_ID=<token-id>`",
    "- `POLYMARKET_LIVE_SUBMIT_SIDE=buy|sell`",
    "- `POLYMARKET_LIVE_SUBMIT_SIZE=<small-positive-size>`",
    "- `POLYMARKET_LIVE_SUBMIT_PRICE=<0-to-1-limit-price>`",
    "- `POLYMARKET_LIVE_SUBMIT_MAX_SIZE=<safety-cap>`",
    "",
    "## Current Result",
    "",
    `- Mode: ${result.plan.mode}`,
    `- Submitted: ${result.submitted}`,
    `- Error: ${result.error ? `${result.error.code}${result.error.status ? ` (${result.error.status})` : ""}: ${result.error.message}` : "none"}`,
    `- Blockers: ${result.plan.blockers.length > 0 ? result.plan.blockers.join("; ") : "none"}`,
    `- Warnings: ${result.plan.warnings.length > 0 ? result.plan.warnings.join("; ") : "none"}`,
    "",
    "Secrets are intentionally omitted from this artifact.",
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Polymarket live-submit harness artifact written to ${checklistPath}`);
if (!result.plan.allowed) {
  console.log(`Harness blocked: ${result.plan.blockers.join("; ")}`);
}
if (result.submitted) {
  console.log("Harness submitted one operator-confirmed Polymarket order.");
}
