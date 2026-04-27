import type { FundingVenue } from "./types.js";
import {
  validateWithdrawalEvidenceSmokeArtifact,
  type WithdrawalEvidenceSmokeArtifact
} from "./withdrawal-evidence.js";

type ReadinessStatus = "PASSED" | "FAILED";

export interface WithdrawalCompletionGateArtifact {
  status?: string;
  venue?: string;
  checks?: {
    completed?: boolean;
    fresh?: boolean;
    redacted?: boolean;
    nonSynthetic?: boolean;
    readOnly?: boolean;
    noPersistence?: boolean;
    approvedHost?: boolean;
  };
}

export interface WithdrawalControlledPersistenceArtifact {
  status?: string;
  venue?: string | null;
  completionPersisted?: boolean;
  gatePassed?: boolean;
}

export interface PredictFunWithdrawalProdReadinessArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: ReadinessStatus;
  venue: "PREDICT_FUN";
  smokeArtifactPath: string;
  completionGateArtifactPath: string;
  controlledPersistenceArtifactPath: string;
  checks: {
    smokeCompleted: boolean;
    completionGatePassed: boolean;
    controlledPersistenceScopedToPredictFun: boolean;
    defaultPersistenceDisabledOrControlled: boolean;
    redactionVerified: boolean;
    exactBscUsdtEvidence: boolean;
    approvedHost: boolean;
  };
  blockers: string[];
  safety: {
    readOnlyReport: true;
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    persistenceChanged: false;
    custodyModel: "MODEL_A_NON_CUSTODIAL";
  };
}

export interface WithdrawalRolloutStatusArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: "REVIEW_REQUIRED";
  venues: Array<{
    venue: FundingVenue;
    classification: string;
    rolloutStatus: string;
    executionAllowed: boolean;
    notes: string[];
  }>;
  safety: {
    readOnlyReport: true;
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    persistenceChanged: false;
  };
}

export const buildPredictFunWithdrawalProdReadiness = (input: {
  now: Date;
  env: NodeJS.ProcessEnv;
  smokeArtifactPath: string;
  smokeArtifact: WithdrawalEvidenceSmokeArtifact | null;
  completionGateArtifactPath: string;
  completionGateArtifact: WithdrawalCompletionGateArtifact | null;
  controlledPersistenceArtifactPath: string;
  controlledPersistenceArtifact: WithdrawalControlledPersistenceArtifact | null;
}): PredictFunWithdrawalProdReadinessArtifact => {
  const blockers: string[] = [];
  if (!input.smokeArtifact) {
    blockers.push(`Predict.fun withdrawal evidence smoke artifact is missing at ${input.smokeArtifactPath}.`);
  } else {
    validateWithdrawalEvidenceSmokeArtifact(input.smokeArtifact, {
      venue: "PREDICT_FUN",
      approvedHosts: approvedHosts(input.env, "PREDICT_FUN"),
      maxAgeHours: positiveInt(input.env.FUNDING_WITHDRAWAL_COMPLETION_SMOKE_MAX_AGE_HOURS, 24),
      production: isProductionEnv(input.env),
      now: input.now,
      blockers
    });
  }

  if (!input.completionGateArtifact) {
    blockers.push(`Predict.fun withdrawal completion gate artifact is missing at ${input.completionGateArtifactPath}.`);
  } else if (input.completionGateArtifact.status !== "PASSED" || input.completionGateArtifact.venue !== "PREDICT_FUN") {
    blockers.push("Predict.fun withdrawal completion gate artifact must be PASSED for PREDICT_FUN.");
  }

  const controlledPersistenceScopedToPredictFun = !input.controlledPersistenceArtifact ||
    (
      input.controlledPersistenceArtifact.status === "COMPLETED" &&
      input.controlledPersistenceArtifact.venue === "PREDICT_FUN" &&
      input.controlledPersistenceArtifact.gatePassed === true
    );
  if (!controlledPersistenceScopedToPredictFun) {
    blockers.push("Controlled persistence artifact, if present, must be scoped to PREDICT_FUN only.");
  }

  const selectedVenues = selectedPersistenceVenues(input.env);
  const defaultPersistenceDisabledOrControlled =
    input.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED !== "true" ||
    (selectedVenues.length === 1 && selectedVenues[0] === "PREDICT_FUN");
  if (!defaultPersistenceDisabledOrControlled) {
    blockers.push("Withdrawal completion persistence must be disabled by default or explicitly scoped to PREDICT_FUN for the controlled test.");
  }

  const artifact: PredictFunWithdrawalProdReadinessArtifact = {
    artifactSchemaVersion: 1,
    generatedAt: input.now.toISOString(),
    status: blockers.length === 0 ? "PASSED" : "FAILED",
    venue: "PREDICT_FUN",
    smokeArtifactPath: input.smokeArtifactPath,
    completionGateArtifactPath: input.completionGateArtifactPath,
    controlledPersistenceArtifactPath: input.controlledPersistenceArtifactPath,
    checks: {
      smokeCompleted: input.smokeArtifact?.status === "COMPLETED" && input.smokeArtifact.mappingObserved === "COMPLETED",
      completionGatePassed: input.completionGateArtifact?.status === "PASSED" && input.completionGateArtifact.venue === "PREDICT_FUN",
      controlledPersistenceScopedToPredictFun,
      defaultPersistenceDisabledOrControlled,
      redactionVerified: input.smokeArtifact?.redactionVerified === true,
      exactBscUsdtEvidence: hasExactPredictFunBscUsdtEvidence(input.smokeArtifact),
      approvedHost: input.smokeArtifact?.config?.evidenceUrlHost
        ? approvedHosts(input.env, "PREDICT_FUN").includes(input.smokeArtifact.config.evidenceUrlHost)
        : false
    },
    blockers,
    safety: {
      readOnlyReport: true,
      liveLifiExecutionEnabled: false,
      liveVenueWithdrawalExecutionEnabled: false,
      backendBroadcastedTransaction: false,
      backendSignedTransaction: false,
      persistenceChanged: false,
      custodyModel: "MODEL_A_NON_CUSTODIAL"
    }
  };
  return {
    ...artifact,
    status: blockers.length === 0 && redactionOk(artifact, input.env) ? "PASSED" : "FAILED",
    blockers: redactionOk(artifact, input.env) ? blockers : [...blockers, "Report redaction check failed."]
  };
};

export const buildWithdrawalRolloutStatus = (now: Date): WithdrawalRolloutStatusArtifact => ({
  artifactSchemaVersion: 1,
  generatedAt: now.toISOString(),
  status: "REVIEW_REQUIRED",
  venues: [
    {
      venue: "POLYMARKET",
      classification: "USER_TRANSFER_BRIDGE_VALIDATED",
      rolloutStatus: "SANDBOX_VALIDATED_REVIEW_REQUIRED",
      executionAllowed: false,
      notes: [
        "Bridge user-transfer path validated.",
        "Recovery-review edge case exists for late or aggregate Bridge completions.",
        "Not approved for broad live withdrawal execution."
      ]
    },
    {
      venue: "PREDICT_FUN",
      classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
      rolloutStatus: "BSC_USDT_EVIDENCE_VALIDATED_GATE_REQUIRED",
      executionAllowed: false,
      notes: [
        "User-wallet BSC USDT path validated.",
        "Requires user EVM receive wallet.",
        "Predict.fun production-readiness gate required before broader rollout."
      ]
    },
    {
      venue: "LIMITLESS",
      classification: "SERVER_INITIATED_WITHDRAWAL",
      rolloutStatus: "BLOCKED_SECURITY_CUSTODY_REVIEW_REQUIRED",
      executionAllowed: false,
      notes: [
        "Documented withdraw path is server-initiated.",
        "Blocked from user endpoint wiring and completion persistence."
      ]
    },
    {
      venue: "OPINION",
      classification: "UNCLASSIFIED_WITHDRAWAL_PATH",
      rolloutStatus: "READ_ONLY_EVIDENCE_COVERAGE_ONLY",
      executionAllowed: false,
      notes: [
        "Evidence coverage exists.",
        "Live/user-authorized withdrawal path not classified yet."
      ]
    },
    {
      venue: "MYRIAD",
      classification: "UNCLASSIFIED_WITHDRAWAL_PATH",
      rolloutStatus: "READ_ONLY_EVIDENCE_COVERAGE_ONLY",
      executionAllowed: false,
      notes: [
        "Evidence coverage exists.",
        "Live/user-authorized withdrawal path not classified yet."
      ]
    }
  ],
  safety: {
    readOnlyReport: true,
    liveLifiExecutionEnabled: false,
    liveVenueWithdrawalExecutionEnabled: false,
    backendBroadcastedTransaction: false,
    backendSignedTransaction: false,
    persistenceChanged: false
  }
});

export const renderPredictFunWithdrawalProdReadinessMarkdown = (
  artifact: PredictFunWithdrawalProdReadinessArtifact
): string => [
  "# Predict.fun Withdrawal Production Readiness",
  "",
  `- Status: ${artifact.status}`,
  `- Generated at: ${artifact.generatedAt}`,
  `- Smoke artifact: ${artifact.smokeArtifactPath}`,
  `- Completion gate artifact: ${artifact.completionGateArtifactPath}`,
  `- Controlled persistence artifact: ${artifact.controlledPersistenceArtifactPath}`,
  "",
  "## Checks",
  ...Object.entries(artifact.checks).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Blockers",
  ...(artifact.blockers.length ? artifact.blockers.map((blocker) => `- ${blocker}`) : ["- None"]),
  "",
  "This report is read-only and does not persist completion, sign, broadcast, custody, or call live venue withdrawal execution."
].join("\n");

export const renderWithdrawalRolloutStatusMarkdown = (artifact: WithdrawalRolloutStatusArtifact): string => [
  "# Withdrawal Rollout Status",
  "",
  `- Status: ${artifact.status}`,
  `- Generated at: ${artifact.generatedAt}`,
  "",
  "| Venue | Classification | Rollout Status | Execution Allowed | Notes |",
  "|---|---|---|---|---|",
  ...artifact.venues.map((row) =>
    `| ${row.venue} | ${row.classification} | ${row.rolloutStatus} | ${row.executionAllowed} | ${row.notes.join("; ")} |`
  ),
  "",
  "This report is read-only and does not call evidence services, venue APIs, LI.FI, or mutate the database."
].join("\n");

const hasExactPredictFunBscUsdtEvidence = (artifact: WithdrawalEvidenceSmokeArtifact | null): boolean =>
  artifact?.venue === "PREDICT_FUN" &&
  artifact.selectedWithdrawal?.synthetic === false &&
  artifact.selectedWithdrawal.destinationChain?.toUpperCase() === "BSC" &&
  artifact.evidenceResult?.destinationChain?.toUpperCase() === "BSC" &&
  artifact.evidenceResult.token?.toUpperCase() === "USDT" &&
  Boolean(artifact.evidenceResult.withdrawalTxHash) &&
  Boolean(artifact.evidenceResult.destinationWalletAddress) &&
  Boolean(artifact.evidenceResult.amount);

const approvedHosts = (env: NodeJS.ProcessEnv, venue: FundingVenue): string[] =>
  (env[`${venue}_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS`] ?? env.FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

const selectedPersistenceVenues = (env: NodeJS.ProcessEnv): FundingVenue[] => {
  if (env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED !== "true") {
    return [];
  }
  const venues: FundingVenue[] = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"];
  return Array.from(new Set([
    ...(env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES ?? "")
      .split(",")
      .map((venue) => venue.trim().toUpperCase())
      .filter((venue): venue is FundingVenue => venues.includes(venue as FundingVenue)),
    ...venues.filter((venue) => env[`${venue}_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED`] === "true")
  ]));
};

const isProductionEnv = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === "production" || env.LOTUS_ENV === "production";

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const redactionOk = (artifact: unknown, env: NodeJS.ProcessEnv): boolean => {
  const serialized = JSON.stringify(artifact);
  const secrets = [
    env.DATABASE_URL,
    env.TEST_DATABASE_URL,
    env.LIFI_API_KEY,
    env.PREDICT_FUN_WITHDRAWAL_EVIDENCE_API_KEY,
    env.PREDICT_FUN_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL
  ].filter((secret): secret is string => typeof secret === "string" && secret.length >= 8);
  return !secrets.some((secret) => serialized.includes(secret)) &&
    !/authorization|privateKey|seed phrase|privy secret|zerodev signer|session cookie|transactionRequest/i.test(serialized);
};
