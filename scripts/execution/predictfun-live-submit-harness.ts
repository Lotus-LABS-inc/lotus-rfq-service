import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getPredictFunExecutionAdapterEnvStatus,
  predictFunLiveSubmitOperatorConfirmation,
  runPredictFunLiveSubmitHarness
} from "../../src/execution-system/index.js";

const artifactDir = join(process.cwd(), "artifacts", "execution");
const checklistPath = join(artifactDir, "predictfun-live-submit-checklist.json");
const markdownPath = join(artifactDir, "predictfun-live-submit-checklist.md");

const result = await runPredictFunLiveSubmitHarness(process.env);
const status = getPredictFunExecutionAdapterEnvStatus(process.env);

const safeArtifact = {
  generatedAt: new Date().toISOString(),
  submitted: result.submitted,
  plan: result.plan,
  adapterStatus: {
    adapter: status.adapter,
    venue: status.venue,
    executionSigningModel: status.executionSigningModel,
    featureFlagSelected: status.featureFlagSelected,
    liveExecutionEnabled: status.liveExecutionEnabled,
    readinessState: status.readinessState,
    requiredEnvPresent: status.requiredEnvPresent,
    missingEnv: status.missingEnv,
    dryRunRequiredEnvPresent: status.dryRunRequiredEnvPresent,
    missingDryRunEnv: status.missingDryRunEnv,
    credentialsServerSideOnly: status.credentialsServerSideOnly,
    liveSubmissionStatus: status.liveSubmissionStatus,
    relayImplementationStatus: status.relayImplementationStatus
  },
  preparedOrder: result.preparedOrder ?? null,
  submitResult: result.submitResult ?? null,
  fillState: result.fillState ?? null,
  settlementState: result.settlementState ?? null,
  settlementVerified: result.settlementVerified ?? false,
  error: result.error ?? null
};

await mkdir(artifactDir, { recursive: true });
await writeFile(checklistPath, `${JSON.stringify(safeArtifact, null, 2)}\n`, "utf8");
await writeFile(
  markdownPath,
  [
    "# Predict.fun Live Submit Harness Checklist",
    "",
    "This harness is operator-controlled and is not part of normal CI or startup flow.",
    "",
    "## Required Operator Env",
    "",
    "- `PREDICT_FUN_EXECUTION_MODE=user_signed_backend_relay`",
    "- `PREDICT_FUN_LIVE_EXECUTION_ENABLED=true`",
    "- `PREDICT_FUN_LIVE_SUBMIT_HARNESS_ENABLED=true`",
    `- \`PREDICT_FUN_LIVE_SUBMIT_OPERATOR_CONFIRM=${predictFunLiveSubmitOperatorConfirmation}\``,
    "- `PREDICT_FUN_LIVE_SUBMIT_VENUE_MARKET_ID=<market-id>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_VENUE_OUTCOME_ID=<token-or-outcome-id>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_SIDE=buy|sell`",
    "- `PREDICT_FUN_LIVE_SUBMIT_SIZE=<small-positive-size>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_PRICE=<0-to-1-limit-price>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_MAX_SIZE=<safety-cap>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_SIGNER_ADDRESS=<active Turnkey EVM wallet>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_VENUE_ACCOUNT_ADDRESS=<active Predict.fun account>`",
    "- `PREDICT_FUN_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON=<frontend Turnkey-signed Predict.fun create-order payload>`",
    "",
    "## Current Result",
    "",
    `- Mode: ${result.plan.mode}`,
    `- Submitted: ${result.submitted}`,
    `- Settlement verified: ${result.settlementVerified ?? false}`,
    `- Error: ${result.error ? `${result.error.code}: ${result.error.message}` : "none"}`,
    `- Blockers: ${result.plan.blockers.length > 0 ? result.plan.blockers.join("; ") : "none"}`,
    `- Warnings: ${result.plan.warnings.length > 0 ? result.plan.warnings.join("; ") : "none"}`,
    "",
    "Secrets, signatures, and signed payloads are intentionally omitted from this artifact.",
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Predict.fun live-submit harness artifact written to ${checklistPath}`);
if (!result.plan.allowed) {
  console.log(`Harness blocked: ${result.plan.blockers.join("; ")}`);
}
if (result.submitted) {
  console.log("Harness relayed one operator-confirmed Predict.fun user-signed order.");
}
