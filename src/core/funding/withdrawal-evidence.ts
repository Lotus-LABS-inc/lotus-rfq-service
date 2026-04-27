import type {
  WithdrawalCompletionEvidenceChecker,
  WithdrawalCompletionEvidenceResult,
  WithdrawalCompletionPersistenceGate
} from "./funding-service.js";
import type {
  FundingVenue,
  WithdrawalIntent,
  WithdrawalReconciliationRecord,
  WithdrawalRouteLeg
} from "./types.js";
import { FundingError as FundingDomainError } from "./types.js";
import type { FundingReadinessAuthMode, FundingReadinessMode, FundingReadinessRedactionPolicy } from "./venue-readiness.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WithdrawalEvidenceReadInput {
  userId: string;
  withdrawalIntentId: string;
  withdrawalRouteLegId: string;
  sourceVenue: FundingVenue;
  withdrawalTxHash: string;
}

export interface WithdrawalEvidenceReadClient {
  fetchEvidence(input: WithdrawalEvidenceReadInput): Promise<Record<string, unknown>>;
}

export interface PolymarketWithdrawalEvidenceReadClient {
  fetchEvidence(input: WithdrawalEvidenceReadInput & { sourceVenue: "POLYMARKET" }): Promise<Record<string, unknown>>;
}

export interface OperatorWithdrawalEvidenceConfig {
  enabled: boolean;
  mode: FundingReadinessMode;
  evidenceUrl: string | null;
  authMode: FundingReadinessAuthMode;
  timeoutMs: number;
  minimumConfirmations: number;
  redactionPolicy: FundingReadinessRedactionPolicy;
  configured: boolean;
}

export type WithdrawalEvidenceConfig = Partial<OperatorWithdrawalEvidenceConfig> & {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export type PolymarketWithdrawalEvidenceConfig = WithdrawalEvidenceConfig;

const withdrawalEvidenceVenues: readonly FundingVenue[] = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"];

export const isWithdrawalEvidenceVenueSupported = (venue: string): venue is FundingVenue =>
  withdrawalEvidenceVenues.includes(venue.toUpperCase() as FundingVenue);

export const withdrawalEvidenceSourceForVenue = (venue: FundingVenue): string =>
  `${venue.toLowerCase()}_withdrawal_evidence`;

export const getWithdrawalEvidenceConfigFromEnv = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): OperatorWithdrawalEvidenceConfig => {
  const configuredMode = env[`${venue}_WITHDRAWAL_EVIDENCE_MODE`]?.toUpperCase();
  const mode: FundingReadinessMode =
    configuredMode === "STUB" || configuredMode === "LIVE_READ" || configuredMode === "DISABLED"
      ? configuredMode
      : env[`${venue}_WITHDRAWAL_EVIDENCE_ENABLED`] === "true"
        ? "LIVE_READ"
        : "DISABLED";
  const evidenceUrl = env[`${venue}_WITHDRAWAL_EVIDENCE_URL`]?.trim() || null;
  const authMode = env[`${venue}_WITHDRAWAL_EVIDENCE_AUTH_MODE`] === "BEARER" ? "BEARER" : "NONE";
  const timeoutMs = Number.parseInt(env[`${venue}_WITHDRAWAL_EVIDENCE_TIMEOUT_MS`] ?? "5000", 10);
  const minimumConfirmations = Number.parseInt(env[`${venue}_WITHDRAWAL_MIN_CONFIRMATIONS`] ?? "1", 10);
  return {
    enabled: mode !== "DISABLED",
    mode,
    evidenceUrl,
    authMode,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000,
    minimumConfirmations: Number.isFinite(minimumConfirmations) && minimumConfirmations > 0 ? minimumConfirmations : 1,
    redactionPolicy: "SERVER_SAFE_DEFAULT",
    configured: mode === "STUB" || (mode === "LIVE_READ" && isValidHttpUrl(evidenceUrl))
  };
};

export const getPolymarketWithdrawalEvidenceConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorWithdrawalEvidenceConfig => getWithdrawalEvidenceConfigFromEnv("POLYMARKET", env);

export interface WithdrawalEvidenceSmokeArtifact {
  generatedAt?: string;
  venue?: string;
  status?: string;
  readOnly?: boolean;
  persistedCompletionResult?: boolean;
  reconciliationRecordsBefore?: number;
  reconciliationRecordsAfter?: number;
  liveLifiExecutionEnabled?: boolean;
  fundingPreflightEnforcementEnabled?: boolean;
  liveVenueWithdrawalExecutionEnabled?: boolean;
  backendBroadcastedTransaction?: boolean;
  backendSignedTransaction?: boolean;
  config?: {
    mode?: string;
    configured?: boolean;
    evidenceUrlConfigured?: boolean;
    evidenceUrlHost?: string;
    authMode?: string;
    apiKeyConfigured?: boolean;
    minimumConfirmations?: number;
  };
  selectedWithdrawal?: {
    synthetic?: boolean;
    sourceVenue?: string;
    withdrawalRouteLegId?: string;
    withdrawalTxHash?: string;
    destinationChain?: string;
    destinationWalletAddress?: string;
    requiredAmount?: string;
  };
  evidenceResult?: {
    status?: string;
    venueReleased?: boolean;
    destinationReceived?: boolean;
    completed?: boolean;
    withdrawalTxHash?: string | null;
    destinationChain?: string | null;
    destinationWalletAddress?: string | null;
    token?: string | null;
    amount?: string | null;
    evidence?: Record<string, unknown>;
  } | null;
  mappingObserved?: string;
  redactionVerified?: boolean;
  blockers?: string[];
}

export interface WithdrawalCompletionPersistenceGateConfig {
  enabled: boolean;
  persistenceEnabled: boolean;
  enabledVenues: readonly FundingVenue[];
  maxAgeHours: number;
  artifactPathByVenue?: Partial<Record<FundingVenue, string>>;
  approvedHostsByVenue?: Partial<Record<FundingVenue, string[]>>;
  production?: boolean;
  now?: () => Date;
}

export interface WithdrawalCompletionGateValidation {
  allowed: boolean;
  artifactPath: string;
  blockers: string[];
  artifact: WithdrawalEvidenceSmokeArtifact | null;
}

export class ArtifactBackedWithdrawalCompletionPersistenceGate implements WithdrawalCompletionPersistenceGate {
  private readonly now: () => Date;

  public constructor(private readonly config: WithdrawalCompletionPersistenceGateConfig) {
    this.now = config.now ?? (() => new Date());
  }

  public async assertCanPersist(input: {
    userId: string;
    intent: WithdrawalIntent;
    leg: WithdrawalRouteLeg;
    result: WithdrawalCompletionEvidenceResult;
  }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (this.config.persistenceEnabled && this.config.enabledVenues.length !== 1) {
      throw new FundingDomainError(
        "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED",
        "Withdrawal completion persistence must be scoped to exactly one reviewed venue for controlled persistence.",
        409
      );
    }
    if (!this.config.persistenceEnabled || !this.config.enabledVenues.includes(input.leg.sourceVenue)) {
      throw new FundingDomainError(
        "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED",
        `Withdrawal completion persistence is disabled for ${input.leg.sourceVenue}. Enable it explicitly for one reviewed venue before persisting completion.`,
        409
      );
    }
    const validation = await this.validate(input.leg.sourceVenue);
    if (!validation.allowed) {
      throw new FundingDomainError(
        "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED",
        `Withdrawal completion persistence is blocked for ${input.leg.sourceVenue}: ${validation.blockers.join("; ")}`,
        409
      );
    }
    const artifactTxHash = validation.artifact?.selectedWithdrawal?.withdrawalTxHash;
    const resultTxHash = input.result.withdrawalTxHash ?? input.leg.txHashes.at(-1);
    if (artifactTxHash && resultTxHash && artifactTxHash.toLowerCase() !== resultTxHash.toLowerCase()) {
      throw new FundingDomainError(
        "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED",
        `Withdrawal completion persistence is blocked for ${input.leg.sourceVenue}: smoke artifact tx hash does not match completion evidence.`,
        409
      );
    }
  }

  public async validate(venue: FundingVenue): Promise<WithdrawalCompletionGateValidation> {
    const artifactPath = this.artifactPathFor(venue);
    const blockers: string[] = [];
    const artifact = await this.readArtifact(artifactPath, blockers);
    if (artifact) {
      validateWithdrawalEvidenceSmokeArtifact(artifact, {
        venue,
        approvedHosts: this.config.approvedHostsByVenue?.[venue] ?? [],
        maxAgeHours: this.config.maxAgeHours,
        production: this.config.production === true,
        now: this.now(),
        blockers
      });
    }
    return {
      allowed: blockers.length === 0,
      artifactPath,
      blockers,
      artifact
    };
  }

  private artifactPathFor(venue: FundingVenue): string {
    return this.config.artifactPathByVenue?.[venue] ??
      join(process.cwd(), "artifacts", "funding", `${venue.toLowerCase().replaceAll("_", "-")}-withdrawal-evidence-smoke-test.json`);
  }

  private async readArtifact(path: string, blockers: string[]): Promise<WithdrawalEvidenceSmokeArtifact | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as WithdrawalEvidenceSmokeArtifact;
    } catch (error) {
      blockers.push(`Withdrawal evidence smoke artifact is missing or unreadable at ${path}.`);
      if (error instanceof SyntaxError) {
        blockers.push("Withdrawal evidence smoke artifact is not valid JSON.");
      }
      return null;
    }
  }
}

export const buildWithdrawalCompletionPersistenceGateFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): ArtifactBackedWithdrawalCompletionPersistenceGate => new ArtifactBackedWithdrawalCompletionPersistenceGate({
  enabled: env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_GATE_ENABLED !== "false",
  persistenceEnabled: env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED === "true",
  enabledVenues: uniqueVenues([
    ...parseVenueList(env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES),
    ...withdrawalEvidenceVenues.filter((venue) => env[`${venue}_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED`] === "true")
  ]),
  maxAgeHours: positiveInt(env.FUNDING_WITHDRAWAL_COMPLETION_SMOKE_MAX_AGE_HOURS, 24),
  production: isProductionEnv(env),
  artifactPathByVenue: Object.fromEntries(withdrawalEvidenceVenues.map((venue) => [
    venue,
    env[`${venue}_WITHDRAWAL_EVIDENCE_SMOKE_ARTIFACT_PATH`]
  ]).filter((entry): entry is [FundingVenue, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)),
  approvedHostsByVenue: Object.fromEntries(withdrawalEvidenceVenues.map((venue) => [
    venue,
    parseHostList(env[`${venue}_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS`] ?? env.FUNDING_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS)
  ]))
});

export const validateWithdrawalEvidenceSmokeArtifact = (
  artifact: WithdrawalEvidenceSmokeArtifact,
  input: {
    venue: FundingVenue;
    approvedHosts: readonly string[];
    maxAgeHours: number;
    production?: boolean;
    now: Date;
    blockers: string[];
  }
): void => {
  if (artifact.venue !== input.venue) {
    input.blockers.push(`Artifact venue must be ${input.venue} but was ${artifact.venue ?? "missing"}.`);
  }
  if (artifact.status !== "COMPLETED" || artifact.mappingObserved !== "COMPLETED") {
    input.blockers.push(`Artifact status and mappingObserved must both be COMPLETED.`);
  }
  if (artifact.readOnly !== true || artifact.persistedCompletionResult !== false) {
    input.blockers.push("Artifact must be read-only and must not have persisted completion.");
  }
  if (artifact.reconciliationRecordsBefore !== artifact.reconciliationRecordsAfter) {
    input.blockers.push("Artifact reconciliation record counts must be unchanged.");
  }
  if (artifact.selectedWithdrawal?.synthetic !== false) {
    input.blockers.push("Artifact must use a real submitted withdrawal row, not synthetic fallback.");
  }
  if (artifact.redactionVerified !== true) {
    input.blockers.push("Artifact redactionVerified must be true.");
  }
  if (artifact.blockers && artifact.blockers.length > 0) {
    input.blockers.push(`Artifact has blockers: ${artifact.blockers.join("; ")}`);
  }
  if (artifact.liveLifiExecutionEnabled !== false ||
    artifact.fundingPreflightEnforcementEnabled !== false ||
    artifact.liveVenueWithdrawalExecutionEnabled !== false ||
    artifact.backendBroadcastedTransaction !== false ||
    artifact.backendSignedTransaction !== false) {
    input.blockers.push("Artifact safety flags must show no live LI.FI execution, funding enforcement, venue withdrawal execution, backend broadcast, or backend signing.");
  }
  if (artifact.config?.mode !== "LIVE_READ" ||
    artifact.config.configured !== true ||
    artifact.config.evidenceUrlConfigured !== true) {
    input.blockers.push("Artifact must come from a configured LIVE_READ evidence service.");
  }
  if (artifact.config?.authMode === "BEARER" && artifact.config.apiKeyConfigured !== true) {
    input.blockers.push("Artifact BEARER auth mode must have an API key configured.");
  }
  if (artifact.config?.mode === "STUB" || JSON.stringify(artifact.evidenceResult?.evidence ?? {}).toLowerCase().includes("fixture")) {
    input.blockers.push("Artifact must not be fixture-backed for withdrawal completion persistence.");
  }
  const evidence = artifact.evidenceResult;
  if (!evidence ||
    evidence.status !== "COMPLETED" ||
    evidence.venueReleased !== true ||
    evidence.destinationReceived !== true ||
    evidence.completed !== true) {
    input.blockers.push("Artifact evidence must show exact venue release and destination receipt completion.");
  }
  if (!isArtifactFresh(artifact.generatedAt, input.maxAgeHours, input.now)) {
    input.blockers.push(`Artifact is missing, invalid, future-dated, or older than ${input.maxAgeHours} hour(s).`);
  }
  if (input.approvedHosts.length === 0) {
    input.blockers.push("No operator-approved withdrawal evidence host is configured for this venue.");
  } else if (!artifact.config?.evidenceUrlHost || !input.approvedHosts.includes(artifact.config.evidenceUrlHost)) {
    input.blockers.push(`Artifact evidenceUrlHost must match an operator-approved host. observed=${artifact.config?.evidenceUrlHost ?? "missing"}`);
  }
  if (input.production && artifact.config?.evidenceUrlHost && isLoopbackHost(artifact.config.evidenceUrlHost)) {
    input.blockers.push("Production withdrawal completion persistence must not use localhost or loopback evidence hosts.");
  }
  validateExactCompletionEvidence(artifact, input.venue, input.blockers);
};

export class ConfigurableVenueWithdrawalEvidenceChecker implements WithdrawalCompletionEvidenceChecker {
  private readonly now: () => Date;
  private readonly config: OperatorWithdrawalEvidenceConfig;

  public constructor(
    private readonly venue: FundingVenue,
    private readonly client: WithdrawalEvidenceReadClient,
    config: WithdrawalEvidenceConfig
  ) {
    this.now = config.now ?? (() => new Date());
    this.config = {
      enabled: config.mode ? config.mode !== "DISABLED" : config.enabled === true,
      mode: config.mode ?? (config.enabled ? "LIVE_READ" : "DISABLED"),
      evidenceUrl: config.evidenceUrl ?? null,
      authMode: config.authMode ?? "NONE",
      timeoutMs: config.timeoutMs ?? 5_000,
      minimumConfirmations: config.minimumConfirmations ?? 1,
      redactionPolicy: config.redactionPolicy ?? "SERVER_SAFE_DEFAULT",
      configured: config.mode === "STUB" || (config.mode === "LIVE_READ" && Boolean(config.evidenceUrl)) || config.enabled === true
    };
  }

  public async check(input: {
    userId: string;
    intent: WithdrawalIntent;
    leg: WithdrawalRouteLeg;
    reconciliations: WithdrawalReconciliationRecord[];
  }): Promise<WithdrawalCompletionEvidenceResult> {
    const withdrawalTxHash = input.leg.txHashes.at(-1);
    if (!withdrawalTxHash) {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_TX_HASH_MISSING`);
    }
    if (!this.config.enabled) {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_EVIDENCE_DISABLED`, { withdrawalTxHash });
    }
    if (!this.config.configured) {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_EVIDENCE_NOT_CONFIGURED`, { withdrawalTxHash });
    }
    try {
      const raw = await this.client.fetchEvidence({
        userId: input.userId,
        withdrawalIntentId: input.intent.withdrawalIntentId,
        withdrawalRouteLegId: input.leg.withdrawalRouteLegId,
        sourceVenue: this.venue,
        withdrawalTxHash
      });
      return this.normalize(raw, {
        userId: input.userId,
        withdrawalIntentId: input.intent.withdrawalIntentId,
        withdrawalRouteLegId: input.leg.withdrawalRouteLegId,
        submittedTxHash: withdrawalTxHash
      });
    } catch {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_EVIDENCE_READ_UNAVAILABLE`, { withdrawalTxHash });
    }
  }

  private normalize(raw: Record<string, unknown>, expected: {
    userId: string;
    withdrawalIntentId: string;
    withdrawalRouteLegId: string;
    submittedTxHash: string;
  }): WithdrawalCompletionEvidenceResult {
    const sourceVenue = raw.sourceVenue;
    const withdrawalTxHash = stringValue(raw.withdrawalTxHash);
    const userId = stringValue(raw.userId);
    const withdrawalIntentId = stringValue(raw.withdrawalIntentId);
    const withdrawalRouteLegId = stringValue(raw.withdrawalRouteLegId);
    const status = stringValue(raw.status)?.toUpperCase();
    const destinationChain = stringValue(raw.destinationChain);
    const destinationWalletAddress = stringValue(raw.destinationWalletAddress);
    const token = stringValue(raw.token);
    const amount = stringValue(raw.amount);
    const confirmations = numberValue(raw.confirmations);
    const reason = stringValue(raw.reason) ?? `${this.venue}_WITHDRAWAL_EVIDENCE_NORMALIZED`;
    const venueReleased = booleanValue(raw.venueReleased);
    const destinationReceived = booleanValue(raw.destinationReceived);
    const completedFlag = booleanValue(raw.completed);
    const safeProviderEvidence = compactEvidence({
      withdrawalTxHash,
      confirmations,
      recoveryReviewRequired: booleanValue(raw.recoveryReviewRequired),
      recoveryReason: stringValue(raw.recoveryReason),
      bridgeAddress: stringValue(raw.bridgeAddress),
      bridgeStatus: stringValue(raw.bridgeStatus),
      bridgeAmount: stringValue(raw.bridgeAmount),
      bridgeTxHash: stringValue(raw.bridgeTxHash)
    });

    if (sourceVenue !== this.venue || !withdrawalTxHash || !status) {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_EVIDENCE_MALFORMED`, {
        withdrawalTxHash: withdrawalTxHash ?? expected.submittedTxHash
      });
    }
    if (withdrawalTxHash.toLowerCase() !== expected.submittedTxHash.toLowerCase()) {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_TX_HASH_MISMATCH`, { withdrawalTxHash });
    }
    if ((userId && userId !== expected.userId) ||
      (withdrawalIntentId && withdrawalIntentId !== expected.withdrawalIntentId) ||
      (withdrawalRouteLegId && withdrawalRouteLegId !== expected.withdrawalRouteLegId)) {
      return this.result("UNKNOWN", false, false, false, `${this.venue}_WITHDRAWAL_EVIDENCE_SCOPE_MISMATCH`, { withdrawalTxHash });
    }
    if (status === "FAILED") {
      return this.result("FAILED", venueReleased, destinationReceived, false, reason, safeProviderEvidence);
    }
    if (status !== "PENDING" && status !== "VENUE_RELEASED" && status !== "DESTINATION_RECEIVED" && status !== "COMPLETED" && status !== "UNKNOWN") {
      return this.result("UNKNOWN", venueReleased, destinationReceived, false, `${this.venue}_WITHDRAWAL_STATUS_UNSUPPORTED`, { withdrawalTxHash });
    }
    if (status === "UNKNOWN") {
      return this.result("UNKNOWN", venueReleased, destinationReceived, false, reason, safeProviderEvidence);
    }
    if (status === "PENDING" || !venueReleased) {
      return this.result("VENUE_RELEASED", false, false, false, `${this.venue}_WITHDRAWAL_VENUE_RELEASE_PENDING`, { withdrawalTxHash });
    }
    if (!destinationReceived) {
      return this.result("VENUE_RELEASED", true, false, false, reason, safeProviderEvidence);
    }
    if (!destinationChain || !destinationWalletAddress || !token || !amount) {
      return this.result("UNKNOWN", true, true, false, `${this.venue}_WITHDRAWAL_DESTINATION_EVIDENCE_MALFORMED`, { withdrawalTxHash });
    }
    if ((confirmations ?? 0) < this.config.minimumConfirmations) {
      return {
        ...this.result("DESTINATION_RECEIVED", true, true, false, `${this.venue}_WITHDRAWAL_CONFIRMATIONS_PENDING`, { withdrawalTxHash, confirmations }),
        destinationChain,
        destinationWalletAddress,
        token,
        amount
      };
    }
    if (status === "COMPLETED" && !completedFlag) {
      return {
        ...this.result("DESTINATION_RECEIVED", true, true, false, `${this.venue}_WITHDRAWAL_COMPLETION_FLAG_MISSING`, {
          withdrawalTxHash,
          confirmations
        }),
        withdrawalTxHash,
        destinationChain,
        destinationWalletAddress,
        token,
        amount
      };
    }
    return {
      ...this.result(status === "COMPLETED" ? "COMPLETED" : "DESTINATION_RECEIVED", true, true, status === "COMPLETED" && completedFlag, reason, {
        withdrawalTxHash,
        confirmations
      }),
      withdrawalTxHash,
      destinationChain,
      destinationWalletAddress,
      token,
      amount
    };
  }

  private result(
    status: WithdrawalCompletionEvidenceResult["status"],
    venueReleased: boolean,
    destinationReceived: boolean,
    completed: boolean,
    reason: string,
    evidence: Record<string, string | number | boolean | null> = {}
  ): WithdrawalCompletionEvidenceResult {
    return {
      status,
      venueReleased,
      destinationReceived,
      completed,
      checkedAt: this.now().toISOString(),
      reason,
      evidence: {
        source: withdrawalEvidenceSourceForVenue(this.venue),
        checkerMode: this.config.mode,
        authMode: this.config.authMode,
        minimumConfirmations: this.config.minimumConfirmations,
        redactionPolicy: this.config.redactionPolicy,
        ...evidence
      }
    };
  }
}

export class PolymarketWithdrawalEvidenceChecker extends ConfigurableVenueWithdrawalEvidenceChecker {
  public constructor(client: PolymarketWithdrawalEvidenceReadClient, config: PolymarketWithdrawalEvidenceConfig) {
    super("POLYMARKET", client as unknown as WithdrawalEvidenceReadClient, config);
  }
}

export class DisabledWithdrawalEvidenceReadClient implements WithdrawalEvidenceReadClient {
  public constructor(private readonly venue: FundingVenue) {}

  public async fetchEvidence(): Promise<Record<string, unknown>> {
    throw new Error(`${this.venue} withdrawal evidence read client is not configured.`);
  }
}

export class DisabledPolymarketWithdrawalEvidenceReadClient extends DisabledWithdrawalEvidenceReadClient implements PolymarketWithdrawalEvidenceReadClient {
  public constructor() {
    super("POLYMARKET");
  }
}

export class HttpWithdrawalEvidenceReadClient implements WithdrawalEvidenceReadClient {
  public constructor(
    private readonly venue: FundingVenue,
    private readonly config: {
      evidenceUrl?: string | undefined;
      timeoutMs?: number | undefined;
      authMode?: FundingReadinessAuthMode | undefined;
      apiKey?: string | undefined;
      fetchImpl?: typeof fetch | undefined;
    }
  ) {}

  public async fetchEvidence(input: WithdrawalEvidenceReadInput): Promise<Record<string, unknown>> {
    if (!this.config.evidenceUrl) {
      throw new Error(`${this.venue}_WITHDRAWAL_EVIDENCE_URL is not configured.`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
    try {
      const url = new URL(this.config.evidenceUrl);
      url.searchParams.set("userId", input.userId);
      url.searchParams.set("withdrawalIntentId", input.withdrawalIntentId);
      url.searchParams.set("withdrawalRouteLegId", input.withdrawalRouteLegId);
      url.searchParams.set("sourceVenue", input.sourceVenue);
      url.searchParams.set("withdrawalTxHash", input.withdrawalTxHash);
      const response = await (this.config.fetchImpl ?? fetch)(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`${this.venue} withdrawal evidence read failed with ${response.status}.`);
      }
      return await response.json() as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    if (this.config.authMode === "BEARER" && this.config.apiKey) {
      return { authorization: `Bearer ${this.config.apiKey}` };
    }
    return {};
  }
}

export class HttpPolymarketWithdrawalEvidenceReadClient extends HttpWithdrawalEvidenceReadClient implements PolymarketWithdrawalEvidenceReadClient {
  public constructor(config: ConstructorParameters<typeof HttpWithdrawalEvidenceReadClient>[1]) {
    super("POLYMARKET", config);
  }
}

export const buildWithdrawalEvidenceCheckerFromEnv = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): ConfigurableVenueWithdrawalEvidenceChecker | null => {
  const config = getWithdrawalEvidenceConfigFromEnv(venue, env);
  if (!config.enabled) {
    return null;
  }
  const client = config.mode === "LIVE_READ"
    ? new HttpWithdrawalEvidenceReadClient(venue, {
      evidenceUrl: config.evidenceUrl ?? undefined,
      timeoutMs: config.timeoutMs,
      authMode: config.authMode,
      apiKey: env[`${venue}_WITHDRAWAL_EVIDENCE_API_KEY`]
    })
    : new DisabledWithdrawalEvidenceReadClient(venue);
  return new ConfigurableVenueWithdrawalEvidenceChecker(venue, client, { ...config, env });
};

export const buildPolymarketWithdrawalEvidenceCheckerFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): PolymarketWithdrawalEvidenceChecker | null => {
  const config = getPolymarketWithdrawalEvidenceConfigFromEnv(env);
  if (!config.enabled) {
    return null;
  }
  const client = config.mode === "LIVE_READ"
    ? new HttpPolymarketWithdrawalEvidenceReadClient({
      evidenceUrl: config.evidenceUrl ?? undefined,
      timeoutMs: config.timeoutMs,
      authMode: config.authMode,
      apiKey: env.POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY
    })
    : new DisabledPolymarketWithdrawalEvidenceReadClient();
  return new PolymarketWithdrawalEvidenceChecker(client, { ...config, env });
};

const isValidHttpUrl = (url: string | null): boolean => {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;

const booleanValue = (value: unknown): boolean => value === true || value === "true";

const compactEvidence = (
  input: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean | null> =>
  Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined)
  );

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseHostList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

const parseVenueList = (value: string | undefined): FundingVenue[] =>
  (value ?? "")
    .split(",")
    .map((venue) => venue.trim().toUpperCase())
    .filter((venue): venue is FundingVenue => isWithdrawalEvidenceVenueSupported(venue));

const uniqueVenues = (venues: readonly FundingVenue[]): FundingVenue[] => [...new Set(venues)];

const isProductionEnv = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === "production" || env.LOTUS_ENV === "production";

const isLoopbackHost = (host: string): boolean => {
  const normalized = host.toLowerCase().split(":")[0] ?? "";
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost");
};

const validateExactCompletionEvidence = (
  artifact: WithdrawalEvidenceSmokeArtifact,
  venue: FundingVenue,
  blockers: string[]
): void => {
  const selected = artifact.selectedWithdrawal;
  const evidence = artifact.evidenceResult;
  if (!selected || !evidence) {
    return;
  }
  if (selected.sourceVenue !== venue) {
    blockers.push(`Selected withdrawal source venue must be ${venue}.`);
  }
  if (!selected.withdrawalTxHash || !evidence.withdrawalTxHash ||
    selected.withdrawalTxHash.toLowerCase() !== evidence.withdrawalTxHash.toLowerCase()) {
    blockers.push("Artifact completion evidence must match the submitted withdrawal tx hash.");
  }
  if (!evidence.destinationChain || !evidence.destinationWalletAddress || !evidence.token || !evidence.amount) {
    blockers.push("Artifact completion evidence must include destination chain, destination wallet, token, and amount.");
  }
  if (selected.destinationChain && evidence.destinationChain &&
    selected.destinationChain.toUpperCase() !== evidence.destinationChain.toUpperCase()) {
    blockers.push("Artifact completion evidence destination chain must match the selected withdrawal.");
  }
  if (selected.destinationWalletAddress && evidence.destinationWalletAddress &&
    selected.destinationWalletAddress.toLowerCase() !== evidence.destinationWalletAddress.toLowerCase()) {
    blockers.push("Artifact completion evidence destination wallet must match the selected withdrawal.");
  }
  const confirmations = numberValue(evidence.evidence?.confirmations);
  const minimumConfirmations = numberValue(artifact.config?.minimumConfirmations) ?? 1;
  if (confirmations === null || confirmations < minimumConfirmations) {
    blockers.push("Artifact completion evidence must include sufficient confirmations.");
  }
  if (venue === "PREDICT_FUN") {
    validatePredictFunBscUsdtEvidence(artifact, blockers);
  }
};

const validatePredictFunBscUsdtEvidence = (
  artifact: WithdrawalEvidenceSmokeArtifact,
  blockers: string[]
): void => {
  const selected = artifact.selectedWithdrawal;
  const evidence = artifact.evidenceResult;
  if (!selected || !evidence) {
    return;
  }
  if (selected.destinationChain?.toUpperCase() !== "BSC" || evidence.destinationChain?.toUpperCase() !== "BSC") {
    blockers.push("Predict.fun withdrawal evidence must be for destinationChain=BSC.");
  }
  if (evidence.token?.toUpperCase() !== "USDT") {
    blockers.push("Predict.fun withdrawal evidence must be for token=USDT.");
  }
  const observedAmount = decimalValue(evidence.amount);
  const requiredAmount = decimalValue(selected.requiredAmount);
  if (observedAmount === null || requiredAmount === null || observedAmount < requiredAmount) {
    blockers.push("Predict.fun withdrawal evidence amount must be greater than or equal to the selected withdrawal amount.");
  }
};

const decimalValue = (value: string | null | undefined): number | null => {
  if (!value || !value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const isArtifactFresh = (generatedAt: string | undefined, maxAgeHours: number, now: Date): boolean => {
  if (!generatedAt) {
    return false;
  }
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return false;
  }
  const ageMs = now.getTime() - generatedAtMs;
  return ageMs >= 0 && ageMs <= Math.max(maxAgeHours, 1) * 3_600_000;
};
