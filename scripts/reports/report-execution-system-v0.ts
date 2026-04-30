import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  executableLaneStates,
  executionAuditEventsV0,
  executionStates,
  getPolymarketExecutionAdapterV2EnvStatus,
  settlementStatuses
} from "../../src/execution-system/index.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "execution");

const summary = {
  generatedAt: new Date().toISOString(),
  version: "execution-system-v0",
  polymarketExecutionAdapterV2: getPolymarketExecutionAdapterV2EnvStatus(process.env),
  authority: {
    matcherEvidenceExecutableByItself: false,
    executableLaneStates,
    scopeTokenRequiredForMarketLanes: true
  },
  lifecycle: {
    executionStates,
    settlementStatuses,
    auditEvents: executionAuditEventsV0
  },
  adapters: {
    liveVenueSubmissionDefault: "NOT_CONFIGURED_FAIL_CLOSED",
    testAdapterAvailable: true,
    polymarketGhostFillProtectionHook: true,
    polymarketV2AdapterSkeletonAvailable: true,
    polymarketV2LiveSubmissionDefault: "DISABLED"
  },
  controls: {
    approvedLaneEnforcement: true,
    preflightRevalidation: true,
    rfqAcceptMetadataPersistence: true,
    fallbackFailClosedPolicy: true,
    accountingAfterSettlementOnly: true,
    feeReceiptHooks: true,
    frontendStatusMapping: true
  },
  remainingBlockers: [
    "Configure real venue execution clients before live venue submission.",
    "Implement and review a real Polymarket CLOB V2 submit/fill/finality client before enabling live Polymarket execution.",
    "Keep POLYMARKET_LIVE_EXECUTION_ENABLED=false until credentials, builder code, settlement proof, and runbook signoff are complete.",
    "Expand dedicated execution tables only after v0 metadata shape stabilizes."
  ]
};

await mkdir(artifactDir, { recursive: true });
await writeFile(
  join(artifactDir, "execution-system-v0-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);
await writeFile(
  join(artifactDir, "execution-system-v0-operator-summary.md"),
  [
    "# Execution System v0 Operator Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Authority",
    "",
    "- Matcher/readiness evidence is not executable authority.",
    "- Only operator-approved sandbox or limited-prod lanes can execute.",
    "- Execution-scope tokens are required for market-lane execution.",
    "",
    "## Safety Posture",
    "",
    "- Live venue submission fails closed unless a venue adapter is explicitly configured.",
    `- Polymarket V2 adapter status: ${summary.polymarketExecutionAdapterV2.liveSubmissionStatus}.`,
    `- Polymarket V2 feature flag selected: ${summary.polymarketExecutionAdapterV2.featureFlagSelected}.`,
    `- Polymarket live execution enabled: ${summary.polymarketExecutionAdapterV2.liveExecutionEnabled}.`,
    `- Polymarket env readiness: ${summary.polymarketExecutionAdapterV2.requiredEnvPresent ? "complete" : `missing ${summary.polymarketExecutionAdapterV2.missingEnv.join(", ")}`}.`,
    "- Accounting updates only after settlement/finality verification.",
    "- Polymarket ghost-fill protection hooks are present for protected modes.",
    "- Fallback can only use approved fallback scope; otherwise execution fails closed.",
    "",
    "## Remaining Blockers",
    "",
    ...summary.remainingBlockers.map((blocker) => `- ${blocker}`),
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Execution System v0 summary written to ${artifactDir}`);
