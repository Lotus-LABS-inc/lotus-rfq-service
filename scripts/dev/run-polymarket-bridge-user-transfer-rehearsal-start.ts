import Decimal from "decimal.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  getPolymarketBridgeWithdrawalConfigFromEnv,
  HttpPolymarketBridgeWithdrawalClient,
  PolymarketBridgeWithdrawalAdapter
} from "../../src/core/funding/polymarket-bridge-withdrawal-adapter.js";

loadDotenv();

type RehearsalStatus = "ACTION_REQUIRED" | "REFUSED_CONFIG" | "FAILED";

interface RehearsalStartArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: RehearsalStatus;
  mode: "HTTP_USER_TRANSFER_REHEARSAL_START";
  config: {
    bridgeEnabled: boolean;
    bridgeConfigured: boolean;
    apiBaseUrlHost: string | null;
    authMode: string;
    apiKeyConfigured: boolean;
    dryRunOnly: boolean;
    rehearsalEnabled: boolean;
  };
  quote: null | {
    provider: string;
    sourceVenue: string;
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
    estimatedFees: string;
    estimatedTimeSeconds: number | null;
    expiresAt: string;
  };
  userAction: null | {
    actionType: string;
    bridgeAddress: string;
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
    expiresAt: string;
    usableTtlSeconds: number;
    warnings: string[];
  };
  operatorActionRequired: boolean;
  nextSteps: string[];
  redactionVerified: boolean;
  safety: {
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    backendSignedTransaction: false;
    backendBroadcastedTransaction: false;
    liveVenueWithdrawalExecutionEnabled: false;
    completionPersisted: false;
    fundingPreflightEnforcementEnabledByScript: false;
    productionConfigMutated: false;
  };
  blockers: string[];
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "polymarket-bridge-user-transfer-rehearsal-start.json");
const artifactMdPath = join(artifactDir, "polymarket-bridge-user-transfer-rehearsal-start.md");

const run = async (): Promise<RehearsalStartArtifact> => {
  const bridgeConfig = getPolymarketBridgeWithdrawalConfigFromEnv(process.env);
  const base = buildBaseArtifact();
  const blockers = validateConfig(bridgeConfig);
  if (blockers.length > 0) {
    return {
      ...base,
      status: "REFUSED_CONFIG",
      blockers
    };
  }

  const amount = process.env.POLYMARKET_BRIDGE_REHEARSAL_AMOUNT?.trim() ?? "1";
  const destinationChain = process.env.POLYMARKET_BRIDGE_REHEARSAL_DESTINATION_CHAIN?.trim() || "POLYGON";
  const destinationToken = process.env.POLYMARKET_BRIDGE_REHEARSAL_DESTINATION_TOKEN?.trim() || "USDC";
  const destinationAddress = process.env.POLYMARKET_BRIDGE_REHEARSAL_DESTINATION_ADDRESS?.trim() ?? "";
  const minimumTtlSeconds = positiveInt(process.env.POLYMARKET_BRIDGE_REHEARSAL_MIN_TTL_SECONDS, 45);

  try {
    const adapter = new PolymarketBridgeWithdrawalAdapter(
      new HttpPolymarketBridgeWithdrawalClient({
        apiBaseUrl: bridgeConfig.apiBaseUrl ?? "",
        timeoutMs: bridgeConfig.timeoutMs,
        authMode: bridgeConfig.authMode,
        apiKey: process.env.POLYMARKET_BRIDGE_API_KEY
      }),
      bridgeConfig
    );
    await adapter.getSupportedBridgeAssets();
    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain,
      destinationToken,
      destinationAddress,
      amount
    });
    const userAction = await adapter.prepareUserAction(quote);
    const usableTtlSeconds = Math.max(0, Math.floor((Date.parse(userAction.expiresAt) - Date.now()) / 1000));
    if (usableTtlSeconds < minimumTtlSeconds) {
      return {
        ...base,
        status: "REFUSED_CONFIG",
        blockers: [
          `Bridge action expires too soon. usableTtlSeconds=${usableTtlSeconds}, requiredMinimum=${minimumTtlSeconds}. Rerun immediately before sending or lower POLYMARKET_BRIDGE_REHEARSAL_MIN_TTL_SECONDS only for local rehearsal.`
        ]
      };
    }
    const artifact: RehearsalStartArtifact = {
      ...base,
      status: "ACTION_REQUIRED",
      quote: {
        provider: quote.provider,
        sourceVenue: quote.sourceVenue,
        destinationChain: quote.destinationChain,
        destinationToken: quote.destinationToken,
        destinationAddress: quote.destinationAddress,
        amount: quote.amount,
        estimatedFees: quote.estimatedFees,
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
        expiresAt: quote.expiresAt
      },
      userAction: {
        actionType: userAction.actionType,
        bridgeAddress: userAction.bridgeAddress,
        destinationChain: userAction.destinationChain,
        destinationToken: userAction.destinationToken,
        destinationAddress: userAction.destinationAddress,
        amount: userAction.amount,
        expiresAt: userAction.expiresAt,
        usableTtlSeconds,
        warnings: [
          ...userAction.warnings,
          "Operator must manually verify the bridge address, destination, token, amount, and expiry before sending.",
          "After sending, record the user-broadcast transaction hash/reference through the existing withdrawal submit/status path."
        ]
      },
      operatorActionRequired: true,
      nextSteps: [
        "Manually send the exact amount from the operator-approved Polymarket wallet before the action expires.",
        "Do not use Lotus backend to sign or broadcast.",
        "Record the user-broadcast tx hash/reference in the withdrawal flow.",
        "Run the Polymarket withdrawal evidence smoke and completion gate before any completion persistence."
      ],
      blockers: []
    };
    return {
      ...artifact,
      redactionVerified: verifyRedaction(artifact)
    };
  } catch (error) {
    return {
      ...base,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : "Unknown Polymarket Bridge user-transfer rehearsal start failure."]
    };
  }
};

const validateConfig = (bridgeConfig: ReturnType<typeof getPolymarketBridgeWithdrawalConfigFromEnv>): string[] => {
  const blockers: string[] = [];
  if (process.env.POLYMARKET_BRIDGE_USER_TRANSFER_REHEARSAL_ENABLED !== "true") {
    blockers.push("Set POLYMARKET_BRIDGE_USER_TRANSFER_REHEARSAL_ENABLED=true to start this controlled rehearsal.");
  }
  if (!bridgeConfig.enabled || !bridgeConfig.configured || !bridgeConfig.apiBaseUrl) {
    blockers.push("Polymarket Bridge config must be enabled and configured.");
  }
  if (!bridgeConfig.dryRunOnly) {
    blockers.push("POLYMARKET_BRIDGE_DRY_RUN_ONLY must remain true; backend live mutation is not allowed.");
  }
  const destinationAddress = process.env.POLYMARKET_BRIDGE_REHEARSAL_DESTINATION_ADDRESS?.trim();
  if (!destinationAddress) {
    blockers.push("Set POLYMARKET_BRIDGE_REHEARSAL_DESTINATION_ADDRESS to the operator-approved destination wallet.");
  }
  const amount = new Decimal(process.env.POLYMARKET_BRIDGE_REHEARSAL_AMOUNT?.trim() || "1");
  const maxAmount = new Decimal(process.env.POLYMARKET_BRIDGE_REHEARSAL_MAX_AMOUNT?.trim() || "5");
  if (!amount.gt(0)) {
    blockers.push("POLYMARKET_BRIDGE_REHEARSAL_AMOUNT must be greater than zero.");
  }
  if (amount.gt(maxAmount)) {
    blockers.push("POLYMARKET_BRIDGE_REHEARSAL_AMOUNT exceeds POLYMARKET_BRIDGE_REHEARSAL_MAX_AMOUNT.");
  }
  return blockers;
};

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const buildBaseArtifact = (): RehearsalStartArtifact => {
  const bridgeConfig = getPolymarketBridgeWithdrawalConfigFromEnv(process.env);
  return {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    mode: "HTTP_USER_TRANSFER_REHEARSAL_START",
    config: {
      bridgeEnabled: bridgeConfig.enabled,
      bridgeConfigured: bridgeConfig.configured,
      apiBaseUrlHost: safeUrlHost(bridgeConfig.apiBaseUrl),
      authMode: bridgeConfig.authMode,
      apiKeyConfigured: Boolean(process.env.POLYMARKET_BRIDGE_API_KEY),
      dryRunOnly: bridgeConfig.dryRunOnly,
      rehearsalEnabled: process.env.POLYMARKET_BRIDGE_USER_TRANSFER_REHEARSAL_ENABLED === "true"
    },
    quote: null,
    userAction: null,
    operatorActionRequired: false,
    nextSteps: [],
    redactionVerified: false,
    safety: {
      custodyModel: "MODEL_A_NON_CUSTODIAL",
      backendSignedTransaction: false,
      backendBroadcastedTransaction: false,
      liveVenueWithdrawalExecutionEnabled: false,
      completionPersisted: false,
      fundingPreflightEnforcementEnabledByScript: false,
      productionConfigMutated: false
    },
    blockers: []
  };
};

const verifyRedaction = (artifact: RehearsalStartArtifact): boolean => {
  const serialized = JSON.stringify(artifact);
  const forbidden = [
    process.env.POLYMARKET_BRIDGE_API_KEY,
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
    "authorization",
    "rawProviderPayload",
    "privateKey",
    "secret"
  ].filter((value): value is string => Boolean(value));
  return forbidden.every((value) => !serialized.includes(value));
};

const safeUrlHost = (url: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const writeArtifacts = async (artifact: RehearsalStartArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMdPath, renderMarkdown(artifact), "utf8");
};

const renderMarkdown = (artifact: RehearsalStartArtifact): string => `# Polymarket Bridge User Transfer Rehearsal Start

- generatedAt: ${artifact.generatedAt}
- status: ${artifact.status}
- mode: ${artifact.mode}
- bridgeHost: ${artifact.config.apiBaseUrlHost ?? "not configured"}
- dryRunOnly: ${artifact.config.dryRunOnly}
- operatorActionRequired: ${artifact.operatorActionRequired}
- redactionVerified: ${artifact.redactionVerified}
- backendSignedTransaction: ${artifact.safety.backendSignedTransaction}
- backendBroadcastedTransaction: ${artifact.safety.backendBroadcastedTransaction}
- liveVenueWithdrawalExecutionEnabled: ${artifact.safety.liveVenueWithdrawalExecutionEnabled}
- completionPersisted: ${artifact.safety.completionPersisted}
- blockers: ${artifact.blockers.length ? artifact.blockers.join("; ") : "none"}

${artifact.userAction ? `## Manual Operator Action

- Send amount: ${artifact.userAction.amount} ${artifact.userAction.destinationToken}
- From: operator-approved Polymarket wallet
- To Bridge address: ${artifact.userAction.bridgeAddress}
- Final destination: ${artifact.userAction.destinationAddress}
- Destination chain: ${artifact.userAction.destinationChain}
- Expires at: ${artifact.userAction.expiresAt}
- Usable TTL seconds at artifact write: ${artifact.userAction.usableTtlSeconds}

Do not use Lotus backend to sign or broadcast this transfer.
` : ""}
`;

const artifact = await run();
await writeArtifacts(artifact);
console.log(`Polymarket Bridge user-transfer rehearsal start: ${artifact.status}`);
if (artifact.userAction) {
  console.log("");
  console.log("Manual transfer details:");
  console.log(`Bridge address: ${artifact.userAction.bridgeAddress}`);
  console.log(`Amount: ${artifact.userAction.amount} ${artifact.userAction.destinationToken}`);
  console.log(`Destination chain: ${artifact.userAction.destinationChain}`);
  console.log(`Final destination: ${artifact.userAction.destinationAddress}`);
  console.log(`Expires at: ${artifact.userAction.expiresAt}`);
  console.log(`Usable TTL seconds: ${artifact.userAction.usableTtlSeconds}`);
  console.log("");
  console.log("Warnings:");
  for (const warning of artifact.userAction.warnings) {
    console.log(`- ${warning}`);
  }
}
if (artifact.blockers.length > 0) {
  console.log("");
  console.log("Blockers:");
  for (const blocker of artifact.blockers) {
    console.log(`- ${blocker}`);
  }
}
console.log(`Artifact JSON: ${artifactJsonPath}`);
console.log(`Artifact MD: ${artifactMdPath}`);
if (artifact.status !== "ACTION_REQUIRED") {
  process.exitCode = 1;
}
