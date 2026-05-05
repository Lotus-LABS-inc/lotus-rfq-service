import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getLimitlessExecutionAdapterEnvStatus,
  limitlessLiveSubmitOperatorConfirmation,
  runLimitlessLiveSubmitHarness
} from "../../src/execution-system/index.js";

const artifactDir = join(process.cwd(), "artifacts", "execution");
const checklistPath = join(artifactDir, "limitless-live-submit-checklist.json");
const markdownPath = join(artifactDir, "limitless-live-submit-checklist.md");

const result = await runLimitlessLiveSubmitHarness(process.env);
const status = getLimitlessExecutionAdapterEnvStatus(process.env);

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
    "# Limitless Live Submit Harness Checklist",
    "",
    "This harness is operator-controlled and is not part of normal CI or startup flow.",
    "",
    "## Required Operator Env",
    "",
    "- `LIMITLESS_EXECUTION_MODE=delegated_partner_server_wallet` or reviewed legacy `backend_signer`",
    "- delegated mode only: `LIMITLESS_PARTNER_ACCOUNT_ENABLED=true`, `LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID`, `LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET`, and `LIMITLESS_LIVE_SUBMIT_PROFILE_ID` or `LIMITLESS_DELEGATED_PROFILE_ID`",
    "- `LIMITLESS_LIVE_EXECUTION_ENABLED=true`",
    "- `LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED=true`",
    `- \`LIMITLESS_LIVE_SUBMIT_OPERATOR_CONFIRM=${limitlessLiveSubmitOperatorConfirmation}\``,
    "- `LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID=<market-slug>`",
    "- `LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID=<token-id>`",
    "- `LIMITLESS_LIVE_SUBMIT_SIDE=buy|sell`",
    "- `LIMITLESS_LIVE_SUBMIT_SIZE=<small-positive-size>`",
    "- `LIMITLESS_LIVE_SUBMIT_PRICE=<0-to-1-limit-price>`",
    "- `LIMITLESS_LIVE_SUBMIT_MAX_SIZE=<safety-cap>`",
    "",
    "## Current Result",
    "",
    `- Mode: ${result.plan.mode}`,
    `- Submitted: ${result.submitted}`,
    `- Error: ${result.error ? `${result.error.code}: ${result.error.message}` : "none"}`,
    `- Blockers: ${result.plan.blockers.length > 0 ? result.plan.blockers.join("; ") : "none"}`,
    `- Warnings: ${result.plan.warnings.length > 0 ? result.plan.warnings.join("; ") : "none"}`,
    "",
    "Secrets are intentionally omitted from this artifact.",
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Limitless live-submit harness artifact written to ${checklistPath}`);
if (!result.plan.allowed) {
  console.log(`Harness blocked: ${result.plan.blockers.join("; ")}`);
}
if (result.submitted) {
  console.log("Harness submitted one operator-confirmed Limitless order.");
}
