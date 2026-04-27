import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  getOpinionWithdrawalConfigFromEnv,
  OpinionSafeWithdrawalAdapter,
  verifyOpinionWithdrawalRedaction
} from "../../src/core/funding/opinion-withdrawal-adapter.js";

loadDotenv();

type DryRunStatus = "COMPLETED" | "FAILED" | "REFUSED_LIVE_MUTATION_RISK";

interface OpinionDryRunArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: DryRunStatus;
  mode: "USER_SAFE_DRY_RUN";
  config: {
    enabled: boolean;
    configured: boolean;
    instructionsUrlHost: string | null;
    timeoutMs: number;
    dryRunOnly: boolean;
  };
  quotePrepared: boolean;
  userActionPrepared: boolean;
  redactionVerified: boolean;
  quote: null | {
    provider: "OPINION_SAFE_USER_ACTION";
    sourceVenue: "OPINION";
    destinationChain: "BSC";
    destinationToken: "USDT";
    amount: string;
    estimatedFees: string;
    estimatedTimeSeconds: number | null;
    expiresAt: string;
    instructionsUrl: string;
    warnings: string[];
  };
  userAction: null | {
    actionType: "USER_COMPLETE_OPINION_SAFE_WITHDRAWAL";
    walletModel: "GNOSIS_SAFE_OR_USER_EOA";
    instructionsUrl: string;
    destinationChain: "BSC";
    destinationToken: "USDT";
    amount: string;
    warnings: string[];
  };
  safety: {
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    backendPrivateKeyHandling: false;
    backendSafeOwnerSigning: false;
    completionPersisted: false;
    liveLifiExecutionEnabled: false;
    userEndpointsChanged: false;
  };
  blockers: string[];
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "opinion-withdrawal-dry-run.json");
const artifactMdPath = join(artifactDir, "opinion-withdrawal-dry-run.md");

const run = async (): Promise<OpinionDryRunArtifact> => {
  const config = getOpinionWithdrawalConfigFromEnv(process.env);
  const base = buildBaseArtifact();
  if (config.enabled && !config.dryRunOnly) {
    return {
      ...base,
      status: "REFUSED_LIVE_MUTATION_RISK",
      blockers: ["OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY must remain true for this operator dry-run."]
    };
  }

  const adapter = new OpinionSafeWithdrawalAdapter({
    ...config,
    enabled: true,
    mode: "USER_SAFE_DRY_RUN",
    dryRunOnly: true,
    configured: true
  });

  try {
    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain: process.env.OPINION_WITHDRAWAL_DRY_RUN_DESTINATION_CHAIN ?? "BSC",
      destinationToken: process.env.OPINION_WITHDRAWAL_DRY_RUN_DESTINATION_TOKEN ?? "USDT",
      destinationAddress: process.env.OPINION_WITHDRAWAL_DRY_RUN_DESTINATION_ADDRESS ??
        "0x1111111111111111111111111111111111111111",
      amount: process.env.OPINION_WITHDRAWAL_DRY_RUN_AMOUNT ?? "40"
    });
    const userAction = await adapter.prepareUserAction(quote);
    const completed: OpinionDryRunArtifact = {
      ...base,
      status: "COMPLETED",
      quotePrepared: true,
      userActionPrepared: true,
      quote: {
        provider: quote.provider,
        sourceVenue: quote.sourceVenue,
        destinationChain: quote.destinationChain,
        destinationToken: quote.destinationToken,
        amount: quote.amount,
        estimatedFees: quote.estimatedFees,
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
        expiresAt: quote.expiresAt,
        instructionsUrl: quote.instructionsUrl,
        warnings: quote.warnings
      },
      userAction: {
        actionType: userAction.actionType,
        walletModel: userAction.walletModel,
        instructionsUrl: userAction.instructionsUrl,
        destinationChain: userAction.destinationChain,
        destinationToken: userAction.destinationToken,
        amount: userAction.amount,
        warnings: userAction.warnings
      }
    };
    return {
      ...completed,
      redactionVerified: verifyOpinionWithdrawalRedaction(completed)
    };
  } catch (error) {
    return {
      ...base,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : "Unknown Opinion withdrawal dry-run failure."]
    };
  }
};

const buildBaseArtifact = (): OpinionDryRunArtifact => {
  const config = getOpinionWithdrawalConfigFromEnv(process.env);
  return {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    mode: "USER_SAFE_DRY_RUN",
    config: {
      enabled: config.enabled,
      configured: config.configured,
      instructionsUrlHost: safeUrlHost(config.instructionsUrl),
      timeoutMs: config.timeoutMs,
      dryRunOnly: config.dryRunOnly
    },
    quotePrepared: false,
    userActionPrepared: false,
    redactionVerified: false,
    quote: null,
    userAction: null,
    safety: {
      custodyModel: "MODEL_A_NON_CUSTODIAL",
      liveVenueWithdrawalExecutionEnabled: false,
      backendBroadcastedTransaction: false,
      backendSignedTransaction: false,
      backendPrivateKeyHandling: false,
      backendSafeOwnerSigning: false,
      completionPersisted: false,
      liveLifiExecutionEnabled: false,
      userEndpointsChanged: false
    },
    blockers: []
  };
};

const safeUrlHost = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const toMarkdown = (artifact: OpinionDryRunArtifact): string => [
  "# Opinion Withdrawal Dry-Run",
  "",
  `- Status: ${artifact.status}`,
  `- Generated At: ${artifact.generatedAt}`,
  `- Mode: ${artifact.mode}`,
  `- Quote Prepared: ${artifact.quotePrepared}`,
  `- User Action Prepared: ${artifact.userActionPrepared}`,
  `- Redaction Verified: ${artifact.redactionVerified}`,
  `- Instructions Host: ${artifact.config.instructionsUrlHost ?? "unavailable"}`,
  `- Backend Signed Transaction: ${artifact.safety.backendSignedTransaction}`,
  `- Backend Broadcasted Transaction: ${artifact.safety.backendBroadcastedTransaction}`,
  `- Backend Private Key Handling: ${artifact.safety.backendPrivateKeyHandling}`,
  `- Backend Safe Owner Signing: ${artifact.safety.backendSafeOwnerSigning}`,
  `- Completion Persisted: ${artifact.safety.completionPersisted}`,
  "",
  "## Blockers",
  artifact.blockers.length === 0 ? "- None" : artifact.blockers.map((blocker) => `- ${blocker}`).join("\n"),
  ""
].join("\n");

const main = async (): Promise<void> => {
  const artifact = await run();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(artifactMdPath, toMarkdown(artifact));
  console.log(`Opinion withdrawal dry-run: ${artifact.status}`);
  console.log(`Artifact JSON: ${artifactJsonPath}`);
  console.log(`Artifact MD: ${artifactMdPath}`);
  if (artifact.status !== "COMPLETED") {
    process.exitCode = 1;
  }
};

await main();
