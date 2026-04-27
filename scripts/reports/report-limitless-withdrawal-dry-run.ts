import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  getLimitlessWithdrawalConfigFromEnv,
  HttpLimitlessWithdrawalClient,
  LimitlessWithdrawalHttpError,
  LimitlessWithdrawalAdapter,
  MockLimitlessWithdrawalClient
} from "../../src/core/funding/limitless-withdrawal-adapter.js";

loadDotenv();

type DryRunStatus = "COMPLETED" | "FAILED" | "REFUSED_LIVE_MUTATION_RISK";

interface DryRunArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: DryRunStatus;
  mode: "MOCK" | "HTTP_DRY_RUN";
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
    hmacSecretConfigured: boolean;
    onBehalfOfProfileIdConfigured: boolean;
    historyPathConfigured: boolean;
    historyQueryConfigured: boolean;
    timestampFormat: string;
    timeoutMs: number;
    dryRunOnly: boolean;
  };
  quote: null | {
    provider: string;
    sourceVenue: string;
    destinationChain: string;
    destinationToken: string;
    amount: string;
    amountBaseUnit: string;
    estimatedFees: string;
    estimatedTimeSeconds: number | null;
    expiresAt: string;
  };
  userAction: null | {
    actionType: string;
    destinationChain: string;
    destinationToken: string;
    amount: string;
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
    liveVenueWithdrawalEndpointCalled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    completionPersisted: false;
    userEndpointsChanged: false;
    liveLifiExecutionEnabled: false;
  };
  blockers: string[];
  providerError: null | {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "limitless-withdrawal-dry-run.json");
const artifactMdPath = join(artifactDir, "limitless-withdrawal-dry-run.md");
const destinationAddress = process.env.LIMITLESS_WITHDRAWAL_DRY_RUN_DESTINATION_ADDRESS?.trim() ||
  "0x2222222222222222222222222222222222222222";
const destinationChain = process.env.LIMITLESS_WITHDRAWAL_DRY_RUN_DESTINATION_CHAIN?.trim() || "BASE";
const destinationToken = process.env.LIMITLESS_WITHDRAWAL_DRY_RUN_DESTINATION_TOKEN?.trim() || "USDC";
const amount = process.env.LIMITLESS_WITHDRAWAL_DRY_RUN_AMOUNT?.trim() || "40";
const txHash = process.env.LIMITLESS_WITHDRAWAL_DRY_RUN_TX_HASH?.trim() ||
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const run = async (): Promise<DryRunArtifact> => {
  const config = getLimitlessWithdrawalConfigFromEnv(process.env);
  const useHttpDryRun = config.enabled && config.configured;
  const base = buildBaseArtifact(useHttpDryRun ? "HTTP_DRY_RUN" : "MOCK");
  if (config.enabled && !config.dryRunOnly) {
    return {
      ...base,
      status: "REFUSED_LIVE_MUTATION_RISK",
      blockers: ["LIMITLESS_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY must remain true for this operator dry-run."]
    };
  }

  const client = useHttpDryRun
    ? new HttpLimitlessWithdrawalClient({
      apiBaseUrl: config.apiBaseUrl ?? "",
      timeoutMs: config.timeoutMs,
      authMode: config.authMode,
      apiKey: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY ?? process.env.LIMITLESS_API_KEY,
      hmacSecret: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
      onBehalfOfProfileId: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID,
      historyPath: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_PATH,
      historyQuery: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_QUERY,
      timestampFormat: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_TIMESTAMP_FORMAT === "UNIX_MS" ? "UNIX_MS" : "ISO"
    })
    : new MockLimitlessWithdrawalClient();
  const adapter = new LimitlessWithdrawalAdapter(client, useHttpDryRun ? config : {
    ...config,
    enabled: true,
    mode: "DRY_RUN_READ_STATUS",
    dryRunOnly: true,
    configured: true
  });

  try {
    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain,
      destinationToken,
      destinationAddress,
      amount,
      tokenAddress: process.env.LIMITLESS_USDC_TOKEN_ADDRESS
    });
    const userAction = adapter.prepareUserAction(quote);
    const status = await adapter.fetchWithdrawalStatus({ txHash });
    const evidence = adapter.normalizeWithdrawalEvidence({
      ...status,
      completed: status.status === "COMPLETED"
    });
    const validation = adapter.validateCompletionEvidence({
      evidence,
      expectedScope: {
        sourceVenue: "LIMITLESS",
        destinationAddress,
        destinationChain,
        destinationToken,
        amount,
        txHash
      }
    });
    const validationBlockers = base.mode === "MOCK" && !validation.valid
      ? [validation.rejectionReason ?? "Limitless completion evidence did not validate."]
      : [];
    const completed: DryRunArtifact = {
      ...base,
      status: validationBlockers.length === 0 ? "COMPLETED" : "FAILED",
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
        amountBaseUnit: quote.amountBaseUnit,
        estimatedFees: quote.estimatedFees,
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
        expiresAt: quote.expiresAt
      },
      userAction: {
        actionType: userAction.actionType,
        destinationChain: userAction.destinationChain,
        destinationToken: userAction.destinationToken,
        amount: userAction.amount,
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
    const failed: DryRunArtifact = {
      ...base,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : "Unknown Limitless withdrawal dry-run failure."],
      providerError: error instanceof LimitlessWithdrawalHttpError
        ? {
          statusCode: error.statusCode,
          body: error.redactedBody
        }
        : null
    };
    return {
      ...failed,
      redactionVerified: verifyRedaction(failed)
    };
  }
};

const buildBaseArtifact = (mode: DryRunArtifact["mode"]): DryRunArtifact => {
  const config = getLimitlessWithdrawalConfigFromEnv(process.env);
  return {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    mode,
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
      apiKeyConfigured: Boolean(process.env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY ?? process.env.LIMITLESS_API_KEY),
      hmacSecretConfigured: Boolean(process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET),
      onBehalfOfProfileIdConfigured: Boolean(process.env.LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID),
      historyPathConfigured: Boolean(process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_PATH),
      historyQueryConfigured: Boolean(process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HISTORY_QUERY),
      timestampFormat: process.env.LIMITLESS_WITHDRAWAL_ADAPTER_TIMESTAMP_FORMAT === "UNIX_MS" ? "UNIX_MS" : "ISO",
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
      liveVenueWithdrawalEndpointCalled: false,
      backendBroadcastedTransaction: false,
      backendSignedTransaction: false,
      completionPersisted: false,
      userEndpointsChanged: false,
      liveLifiExecutionEnabled: false
    },
    blockers: [],
    providerError: null
  };
};

const verifyRedaction = (artifact: DryRunArtifact): boolean => {
  const serialized = JSON.stringify(artifact);
  const forbidden = [
    process.env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
    process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
    process.env.LIMITLESS_API_KEY,
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
    "authorization",
    "lmts-signature",
    "rawProviderPayload",
    "privateKey"
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

const renderMarkdown = (artifact: DryRunArtifact): string => `# Limitless Withdrawal Dry Run

- generatedAt: ${artifact.generatedAt}
- status: ${artifact.status}
- mode: ${artifact.mode}
- quotePrepared: ${artifact.quotePrepared}
- userActionPrepared: ${artifact.userActionPrepared}
- statusFetched: ${artifact.statusFetched}
- evidenceNormalized: ${artifact.evidenceNormalized}
- redactionVerified: ${artifact.redactionVerified}
- backendSignedTransaction: ${artifact.safety.backendSignedTransaction}
- backendBroadcastedTransaction: ${artifact.safety.backendBroadcastedTransaction}
- liveVenueWithdrawalExecutionEnabled: ${artifact.safety.liveVenueWithdrawalExecutionEnabled}
- liveVenueWithdrawalEndpointCalled: ${artifact.safety.liveVenueWithdrawalEndpointCalled}
- completionPersisted: ${artifact.safety.completionPersisted}
- blockers: ${artifact.blockers.length ? artifact.blockers.join("; ") : "none"}
`;

const artifact = await run();
await writeArtifacts(artifact);
console.log(`Limitless withdrawal dry run: ${artifact.status}`);
console.log(`Artifact JSON: ${artifactJsonPath}`);
console.log(`Artifact MD: ${artifactMdPath}`);
if (artifact.status !== "COMPLETED") {
  process.exitCode = 1;
}
