import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  getPolymarketBridgeWithdrawalConfigFromEnv,
  HttpPolymarketBridgeWithdrawalClient,
  MockPolymarketBridgeWithdrawalClient,
  PolymarketBridgeWithdrawalAdapter
} from "../../src/core/funding/polymarket-bridge-withdrawal-adapter.js";

loadDotenv();

type DryRunStatus = "COMPLETED" | "FAILED" | "REFUSED_LIVE_MUTATION_RISK";

interface DryRunArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: DryRunStatus;
  mode: "MOCK" | "HTTP_DRY_RUN";
  supportedAssetsChecked: boolean;
  quotePrepared: boolean;
  userActionPrepared: boolean;
  statusFetched: boolean;
  evidenceNormalized: boolean;
  redactionVerified: boolean;
  config: {
    enabled: boolean;
    configured: boolean;
    apiBaseUrlConfigured: boolean;
    apiBaseUrlHost: string | null;
    authMode: string;
    apiKeyConfigured: boolean;
    timeoutMs: number;
    dryRunOnly: boolean;
  };
  quote: null | {
    provider: string;
    sourceVenue: string;
    destinationChain: string;
    destinationToken: string;
    amount: string;
    estimatedFees: string;
    estimatedTimeSeconds: number | null;
    expiresAt: string;
  };
  userAction: null | {
    actionType: string;
    bridgeAddressPresent: boolean;
    destinationChain: string;
    destinationToken: string;
    amount: string;
    expiresAt: string;
    warnings: string[];
  };
  normalizedEvidence: null | {
    completed: boolean;
    venue: string;
    sourceVenue: string;
    destinationChain: string | null;
    destinationToken: string | null;
    amount: string | null;
    txHashPresent: boolean;
    confidence: string;
    rejectionReason: string | null;
  };
  validation: null | {
    valid: boolean;
    rejectionReason: string | null;
  };
  safety: {
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    completionPersisted: false;
    userEndpointsChanged: false;
    liveLifiExecutionEnabled: false;
  };
  blockers: string[];
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "polymarket-bridge-withdrawal-dry-run.json");
const artifactMdPath = join(artifactDir, "polymarket-bridge-withdrawal-dry-run.md");

const run = async (): Promise<DryRunArtifact> => {
  const config = getPolymarketBridgeWithdrawalConfigFromEnv(process.env);
  const useHttpDryRun = config.enabled && config.configured;
  const base = buildBaseArtifact(useHttpDryRun ? "HTTP_DRY_RUN" : "MOCK");
  if (config.enabled && !config.dryRunOnly) {
    return {
      ...base,
      status: "REFUSED_LIVE_MUTATION_RISK",
      blockers: ["POLYMARKET_BRIDGE_DRY_RUN_ONLY must remain true for this operator dry-run."]
    };
  }

  const client = useHttpDryRun
    ? new HttpPolymarketBridgeWithdrawalClient({
      apiBaseUrl: config.apiBaseUrl ?? "",
      timeoutMs: config.timeoutMs,
      authMode: config.authMode,
      apiKey: process.env.POLYMARKET_BRIDGE_API_KEY
    })
    : new MockPolymarketBridgeWithdrawalClient();
  const adapter = new PolymarketBridgeWithdrawalAdapter(client, useHttpDryRun ? config : {
    ...config,
    enabled: true,
    mode: "DRY_RUN",
    dryRunOnly: true,
    configured: true
  });

  try {
    const assets = await adapter.getSupportedBridgeAssets();
    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    });
    const userAction = await adapter.prepareUserAction(quote);
    const status = await adapter.fetchWithdrawalStatus({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bridgeAddress: userAction.bridgeAddress
    });
    const evidence = adapter.normalizeWithdrawalEvidence({
      ...status,
      completed: status.status === "COMPLETED"
    });
    const validation = adapter.validateCompletionEvidence({
      evidence,
      expectedScope: {
        sourceVenue: "POLYMARKET",
        destinationAddress: "0x1111111111111111111111111111111111111111",
        destinationChain: "POLYGON",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });
    const validationBlockers = base.mode === "MOCK" && !validation.valid
      ? [validation.rejectionReason ?? "Polymarket Bridge completion evidence did not validate."]
      : [];
    const completed: DryRunArtifact = {
      ...base,
      status: validationBlockers.length === 0 ? "COMPLETED" : "FAILED",
      supportedAssetsChecked: assets.length > 0,
      quotePrepared: true,
      userActionPrepared: true,
      statusFetched: true,
      evidenceNormalized: true,
      quote: {
        provider: quote.provider,
        sourceVenue: quote.sourceVenue,
        destinationChain: quote.destinationChain,
        destinationToken: quote.destinationToken,
        amount: quote.amount,
        estimatedFees: quote.estimatedFees,
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
        expiresAt: quote.expiresAt
      },
      userAction: {
        actionType: userAction.actionType,
        bridgeAddressPresent: Boolean(userAction.bridgeAddress),
        destinationChain: userAction.destinationChain,
        destinationToken: userAction.destinationToken,
        amount: userAction.amount,
        expiresAt: userAction.expiresAt,
        warnings: userAction.warnings
      },
      normalizedEvidence: {
        completed: evidence.completed,
        venue: evidence.venue,
        sourceVenue: evidence.sourceVenue,
        destinationChain: evidence.destinationChain,
        destinationToken: evidence.destinationToken,
        amount: evidence.amount,
        txHashPresent: Boolean(evidence.txHash),
        confidence: evidence.confidence,
        rejectionReason: evidence.rejectionReason
      },
      validation,
      blockers: validationBlockers
    };
    return {
      ...completed,
      redactionVerified: verifyRedaction(completed)
    };
  } catch (error) {
    return {
      ...base,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : "Unknown Polymarket Bridge withdrawal dry-run failure."]
    };
  }
};

const buildBaseArtifact = (mode: DryRunArtifact["mode"]): DryRunArtifact => {
  const config = getPolymarketBridgeWithdrawalConfigFromEnv(process.env);
  return {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    mode,
    supportedAssetsChecked: false,
    quotePrepared: false,
    userActionPrepared: false,
    statusFetched: false,
    evidenceNormalized: false,
    redactionVerified: false,
    config: {
      enabled: config.enabled,
      configured: config.configured,
      apiBaseUrlConfigured: Boolean(config.apiBaseUrl),
      apiBaseUrlHost: safeUrlHost(config.apiBaseUrl),
      authMode: config.authMode,
      apiKeyConfigured: Boolean(process.env.POLYMARKET_BRIDGE_API_KEY),
      timeoutMs: config.timeoutMs,
      dryRunOnly: config.dryRunOnly
    },
    quote: null,
    userAction: null,
    normalizedEvidence: null,
    validation: null,
    safety: {
      custodyModel: "MODEL_A_NON_CUSTODIAL",
      liveVenueWithdrawalExecutionEnabled: false,
      backendBroadcastedTransaction: false,
      backendSignedTransaction: false,
      completionPersisted: false,
      userEndpointsChanged: false,
      liveLifiExecutionEnabled: false
    },
    blockers: []
  };
};

const verifyRedaction = (artifact: DryRunArtifact): boolean => {
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

const writeArtifacts = async (artifact: DryRunArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMdPath, renderMarkdown(artifact), "utf8");
};

const renderMarkdown = (artifact: DryRunArtifact): string => `# Polymarket Bridge Withdrawal Dry Run

- generatedAt: ${artifact.generatedAt}
- status: ${artifact.status}
- mode: ${artifact.mode}
- supportedAssetsChecked: ${artifact.supportedAssetsChecked}
- quotePrepared: ${artifact.quotePrepared}
- userActionPrepared: ${artifact.userActionPrepared}
- statusFetched: ${artifact.statusFetched}
- evidenceNormalized: ${artifact.evidenceNormalized}
- redactionVerified: ${artifact.redactionVerified}
- backendSignedTransaction: ${artifact.safety.backendSignedTransaction}
- backendBroadcastedTransaction: ${artifact.safety.backendBroadcastedTransaction}
- liveVenueWithdrawalExecutionEnabled: ${artifact.safety.liveVenueWithdrawalExecutionEnabled}
- completionPersisted: ${artifact.safety.completionPersisted}
- blockers: ${artifact.blockers.length ? artifact.blockers.join("; ") : "none"}
`;

const artifact = await run();
await writeArtifacts(artifact);
console.log(`Polymarket Bridge withdrawal dry run: ${artifact.status}`);
console.log(`Artifact JSON: ${artifactJsonPath}`);
console.log(`Artifact MD: ${artifactMdPath}`);
if (artifact.status !== "COMPLETED") {
  process.exitCode = 1;
}
