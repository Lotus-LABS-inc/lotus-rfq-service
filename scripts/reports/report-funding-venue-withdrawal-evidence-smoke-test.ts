import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import type { WithdrawalCompletionEvidenceResult } from "../../src/core/funding/funding-service.js";
import type { FundingVenue, WithdrawalIntent, WithdrawalRouteLeg } from "../../src/core/funding/types.js";
import {
  ConfigurableVenueWithdrawalEvidenceChecker,
  getWithdrawalEvidenceConfigFromEnv,
  HttpWithdrawalEvidenceReadClient,
  isWithdrawalEvidenceVenueSupported
} from "../../src/core/funding/withdrawal-evidence.js";

loadDotenv();

type SmokeStatus =
  | "REFUSED_UNSUPPORTED_VENUE"
  | "REFUSED_CONFIG_INCOMPLETE"
  | "REFUSED_PREFLIGHT_ENFORCEMENT_ENABLED"
  | "COMPLETED"
  | "FAILED";

interface WithdrawalCandidateRow {
  synthetic?: boolean;
  withdrawal_intent_id: string;
  user_id: string;
  token: string;
  amount: string;
  destination_chain: string;
  destination_wallet_address: string;
  aggregate_status: string;
  idempotency_key: string;
  aggregate_route_quote: Record<string, unknown>;
  total_estimated_fees: string;
  total_estimated_time_seconds: number | null;
  audit_event_ids: string[];
  intent_created_at: Date;
  intent_updated_at: Date;
  route_leg_id: string;
  withdrawal_source_id: string;
  source_venue: FundingVenue;
  source_token: string;
  source_amount: string;
  destination_amount_estimate: string;
  route_provider: "LOTUS_WITHDRAWAL_V0";
  route_quote: WithdrawalRouteLeg["routeQuote"];
  tx_hashes: string[];
  provider_status: Record<string, unknown>;
  venue_release_status: string;
  destination_status: string;
  leg_status: string;
  error_reason: string | null;
  leg_created_at: Date;
  leg_updated_at: Date;
}

interface SmokeArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  venue: FundingVenue | string;
  status: SmokeStatus;
  readOnly: true;
  persistedCompletionResult: false;
  reconciliationRecordsBefore: number | null;
  reconciliationRecordsAfter: number | null;
  liveLifiExecutionEnabled: boolean;
  fundingPreflightEnforcementEnabled: boolean;
  liveVenueWithdrawalExecutionEnabled: false;
  backendBroadcastedTransaction: false;
  backendSignedTransaction: false;
  config: {
    mode: string;
    configured: boolean;
    evidenceUrlConfigured: boolean;
    evidenceUrlHost: string | null;
    authMode: string;
    apiKeyConfigured: boolean;
    timeoutMs: number;
    minimumConfirmations: number;
  };
  selectedWithdrawal: null | {
    withdrawalIntentId: string;
    userId: string;
    sourceVenue: string;
    withdrawalRouteLegId: string;
    synthetic: boolean;
    withdrawalStatus: string;
    routeLegStatus: string;
    venueReleaseStatus: string;
    destinationStatus: string;
    withdrawalTxHash: string | null;
    destinationChain: string;
    destinationWalletAddress: string;
    requiredAmount: string;
  };
  evidenceResult: null | Omit<WithdrawalCompletionEvidenceResult, "evidence"> & {
    evidence: Record<string, unknown>;
  };
  mappingObserved: string | null;
  redactionVerified: boolean;
  blockers: string[];
  warnings: string[];
}

const requestedVenue = (process.argv[2] ?? "POLYMARKET").toUpperCase();
const artifactDir = join(process.cwd(), "artifacts", "funding");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const buildBaseArtifact = (venue: FundingVenue | string): SmokeArtifact => {
  const config = isWithdrawalEvidenceVenueSupported(venue)
    ? getWithdrawalEvidenceConfigFromEnv(venue, process.env)
    : null;
  return {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    venue,
    status: "FAILED",
    readOnly: true,
    persistedCompletionResult: false,
    reconciliationRecordsBefore: null,
    reconciliationRecordsAfter: null,
    liveLifiExecutionEnabled: process.env.FUNDING_LIVE_SUBMIT_ENABLED === "true",
    fundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
    liveVenueWithdrawalExecutionEnabled: false,
    backendBroadcastedTransaction: false,
    backendSignedTransaction: false,
    config: {
      mode: config?.mode ?? "UNSUPPORTED",
      configured: config?.configured ?? false,
      evidenceUrlConfigured: Boolean(config?.evidenceUrl),
      evidenceUrlHost: safeUrlHost(config?.evidenceUrl ?? null),
      authMode: config?.authMode ?? "NONE",
      apiKeyConfigured: isWithdrawalEvidenceVenueSupported(venue) ? Boolean(process.env[`${venue}_WITHDRAWAL_EVIDENCE_API_KEY`]) : false,
      timeoutMs: config?.timeoutMs ?? 0,
      minimumConfirmations: config?.minimumConfirmations ?? 0
    },
    selectedWithdrawal: null,
    evidenceResult: null,
    mappingObserved: null,
    redactionVerified: false,
    blockers: [],
    warnings: []
  };
};

const run = async (): Promise<SmokeArtifact> => {
  if (!isWithdrawalEvidenceVenueSupported(requestedVenue)) {
    return {
      ...buildBaseArtifact(requestedVenue || "UNKNOWN"),
      status: "REFUSED_UNSUPPORTED_VENUE",
      blockers: ["Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN."]
    };
  }

  const artifact = buildBaseArtifact(requestedVenue);
  const config = getWithdrawalEvidenceConfigFromEnv(requestedVenue, process.env);
  const apiKey = process.env[`${requestedVenue}_WITHDRAWAL_EVIDENCE_API_KEY`];
  if (artifact.fundingPreflightEnforcementEnabled) {
    return {
      ...artifact,
      status: "REFUSED_PREFLIGHT_ENFORCEMENT_ENABLED",
      blockers: ["FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED must remain false for this read-only withdrawal evidence smoke test."]
    };
  }
  if (config.mode !== "LIVE_READ" || !config.configured || (config.authMode === "BEARER" && !apiKey)) {
    return {
      ...artifact,
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers: [
        `${requestedVenue}_WITHDRAWAL_EVIDENCE_MODE must be LIVE_READ.`,
        `${requestedVenue}_WITHDRAWAL_EVIDENCE_URL must be configured as a valid http(s) URL.`,
        `${requestedVenue}_WITHDRAWAL_EVIDENCE_API_KEY is required when auth mode is BEARER.`
      ].filter((blocker) =>
        blocker.includes("MODE") ? config.mode !== "LIVE_READ" :
          blocker.includes("URL") ? !config.configured :
            config.authMode === "BEARER" && !apiKey
      )
    };
  }
  if (!databaseUrl) {
    return {
      ...artifact,
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers: ["TEST_DATABASE_URL or DATABASE_URL is required to select a safe submitted withdrawal row."]
    };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const candidate = await selectCandidate(pool, requestedVenue) ?? syntheticCandidate(requestedVenue);
    const beforeCount = candidate.synthetic ? null : await countReconciliations(pool, candidate.withdrawal_intent_id);
    const checker = new ConfigurableVenueWithdrawalEvidenceChecker(
      requestedVenue,
      new HttpWithdrawalEvidenceReadClient(requestedVenue, {
        evidenceUrl: config.evidenceUrl ?? undefined,
        timeoutMs: config.timeoutMs,
        authMode: config.authMode,
        apiKey
      }),
      { ...config, env: process.env }
    );
    const result = await checker.check({
      userId: candidate.user_id,
      intent: toIntent(candidate),
      leg: toLeg(candidate),
      reconciliations: []
    });
    const afterCount = candidate.synthetic ? null : await countReconciliations(pool, candidate.withdrawal_intent_id);
    const completed = {
      ...artifact,
      status: "COMPLETED" as const,
      selectedWithdrawal: toSelectedWithdrawal(candidate),
      evidenceResult: sanitizeResult(result),
      mappingObserved: result.status,
      reconciliationRecordsBefore: beforeCount,
      reconciliationRecordsAfter: afterCount,
      warnings: result.completed
        ? ["COMPLETED was observed by the read-only smoke test but was not persisted."]
        : candidate.synthetic
          ? [`No submitted ${requestedVenue} withdrawal row existed; smoke used synthetic sandbox identifiers and expected a fail-closed mapping.`]
          : []
    };
    return {
      ...completed,
      redactionVerified: verifyRedaction(completed, requestedVenue)
    };
  } catch (error) {
    return {
      ...artifact,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : `Unknown ${requestedVenue} withdrawal evidence smoke-test failure.`]
    };
  } finally {
    await pool.end();
  }
};

const selectCandidate = async (pool: Pool, venue: FundingVenue): Promise<WithdrawalCandidateRow | null> => {
  const result = await pool.query<WithdrawalCandidateRow>(
    `SELECT
       wi.id::text AS withdrawal_intent_id,
       wi.user_id,
       wi.token,
       wi.amount,
       wi.destination_chain,
       wi.destination_wallet_address,
       wi.status AS aggregate_status,
       wi.idempotency_key,
       wi.aggregate_route_quote,
       wi.total_estimated_fees,
       wi.total_estimated_time_seconds,
       wi.audit_event_ids,
       wi.created_at AS intent_created_at,
       wi.updated_at AS intent_updated_at,
       wl.id::text AS route_leg_id,
       wl.withdrawal_source_id::text,
       wl.source_venue,
       wl.source_token,
       wl.source_amount,
       wl.destination_amount_estimate,
       wl.route_provider,
       wl.route_quote,
       wl.tx_hashes,
       wl.provider_status,
       wl.venue_release_status,
       wl.destination_status,
       wl.status AS leg_status,
       wl.error_reason,
       wl.created_at AS leg_created_at,
       wl.updated_at AS leg_updated_at
     FROM funding_withdrawal_route_legs wl
     JOIN funding_withdrawal_intents wi ON wi.id = wl.withdrawal_intent_id
     WHERE wl.source_venue = $1
       AND jsonb_array_length(wl.tx_hashes) > 0
     ORDER BY wl.updated_at DESC
     LIMIT 1`,
    [venue]
  );
  return result.rows[0] ?? null;
};

const syntheticCandidate = (venue: FundingVenue): WithdrawalCandidateRow => {
  const now = new Date();
  const destinationChain = venue === "LIMITLESS" ? "BASE" : "POLYGON";
  const destinationWalletAddress = "0x1111111111111111111111111111111111111111";
  return {
    synthetic: true,
    withdrawal_intent_id: "00000000-0000-4000-8000-000000000001",
    user_id: `synthetic-${venue.toLowerCase()}-withdrawal-smoke-user`,
    token: "USDC",
    amount: "1",
    destination_chain: destinationChain,
    destination_wallet_address: destinationWalletAddress,
    aggregate_status: "WITHDRAWING",
    idempotency_key: `synthetic-${venue.toLowerCase()}-withdrawal-evidence-smoke`,
    aggregate_route_quote: {},
    total_estimated_fees: "0",
    total_estimated_time_seconds: null,
    audit_event_ids: [],
    intent_created_at: now,
    intent_updated_at: now,
    route_leg_id: "00000000-0000-4000-8000-000000000002",
    withdrawal_source_id: "00000000-0000-4000-8000-000000000003",
    source_venue: venue,
    source_token: "USDC",
    source_amount: "1",
    destination_amount_estimate: "1",
    route_provider: "LOTUS_WITHDRAWAL_V0",
    route_quote: {
      provider: "LOTUS_WITHDRAWAL_V0",
      providerRouteId: `synthetic-${venue.toLowerCase()}-withdrawal-evidence-smoke`,
      sourceVenue: venue,
      sourceToken: "USDC",
      sourceAmount: "1",
      destinationChain,
      destinationWalletAddress,
      destinationAmountEstimate: "1",
      estimatedFees: "0",
      estimatedTimeSeconds: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      transactionRequest: null,
      userSafeSummary: "Synthetic withdrawal evidence smoke route. Lotus does not sign or broadcast this transaction."
    },
    tx_hashes: ["0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],
    provider_status: {},
    venue_release_status: "PENDING",
    destination_status: "PENDING",
    leg_status: "VENUE_RELEASE_PENDING",
    error_reason: null,
    leg_created_at: now,
    leg_updated_at: now
  };
};

const countReconciliations = async (pool: Pool, withdrawalIntentId: string): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM funding_withdrawal_reconciliation_records WHERE withdrawal_intent_id = $1::uuid",
    [withdrawalIntentId]
  );
  return Number(result.rows[0]?.count ?? "0");
};

const toIntent = (row: WithdrawalCandidateRow): WithdrawalIntent => ({
  withdrawalIntentId: row.withdrawal_intent_id,
  userId: row.user_id,
  token: row.token,
  amount: row.amount,
  destinationChain: row.destination_chain,
  destinationWalletAddress: row.destination_wallet_address,
  status: row.aggregate_status as WithdrawalIntent["status"],
  idempotencyKey: row.idempotency_key,
  aggregateRouteQuote: row.aggregate_route_quote ?? {},
  totalEstimatedFees: row.total_estimated_fees,
  totalEstimatedTimeSeconds: row.total_estimated_time_seconds,
  auditEventIds: row.audit_event_ids ?? [],
  createdAt: row.intent_created_at.toISOString(),
  updatedAt: row.intent_updated_at.toISOString()
});

const toLeg = (row: WithdrawalCandidateRow): WithdrawalRouteLeg => ({
  withdrawalRouteLegId: row.route_leg_id,
  withdrawalIntentId: row.withdrawal_intent_id,
  withdrawalSourceId: row.withdrawal_source_id,
  sourceVenue: row.source_venue,
  sourceToken: row.source_token,
  sourceAmount: row.source_amount,
  destinationChain: row.destination_chain,
  destinationWalletAddress: row.destination_wallet_address,
  destinationAmountEstimate: row.destination_amount_estimate,
  routeProvider: row.route_provider,
  routeQuote: row.route_quote,
  txHashes: row.tx_hashes ?? [],
  providerStatus: row.provider_status ?? {},
  venueReleaseStatus: row.venue_release_status,
  destinationStatus: row.destination_status,
  status: row.leg_status as WithdrawalRouteLeg["status"],
  errorReason: row.error_reason,
  createdAt: row.leg_created_at.toISOString(),
  updatedAt: row.leg_updated_at.toISOString()
});

const toSelectedWithdrawal = (row: WithdrawalCandidateRow): SmokeArtifact["selectedWithdrawal"] => ({
  withdrawalIntentId: row.withdrawal_intent_id,
  userId: row.user_id,
  sourceVenue: row.source_venue,
  withdrawalRouteLegId: row.route_leg_id,
  synthetic: row.synthetic === true,
  withdrawalStatus: row.aggregate_status,
  routeLegStatus: row.leg_status,
  venueReleaseStatus: row.venue_release_status,
  destinationStatus: row.destination_status,
  withdrawalTxHash: row.tx_hashes.at(-1) ?? null,
  destinationChain: row.destination_chain,
  destinationWalletAddress: row.destination_wallet_address,
  requiredAmount: row.destination_amount_estimate
});

const sanitizeResult = (result: WithdrawalCompletionEvidenceResult): SmokeArtifact["evidenceResult"] => ({
  ...result,
  evidence: result.evidence ?? {}
});

const verifyRedaction = (artifact: SmokeArtifact, venue: FundingVenue | string): boolean => {
  const serialized = JSON.stringify(artifact);
  const secretCandidates = [
    process.env[`${venue}_WITHDRAWAL_EVIDENCE_API_KEY`],
    process.env[`${venue}_API_KEY`],
    process.env[`${venue}_API_SECRET`],
    process.env[`${venue}_PRIVATE_KEY`],
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL
  ].filter((value): value is string => Boolean(value) && value.length >= 8);
  return !secretCandidates.some((secret) => serialized.includes(secret)) &&
    !/authorization/i.test(serialized) &&
    !/privateKey/i.test(serialized) &&
    !/transactionRequest/i.test(serialized);
};

const safeUrlHost = (url: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return "INVALID_URL";
  }
};

const artifactBaseName = (venue: FundingVenue | string): string =>
  `${venue.toLowerCase().replaceAll("_", "-")}-withdrawal-evidence-smoke-test`;

const writeArtifacts = async (artifact: SmokeArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  const baseName = artifactBaseName(artifact.venue);
  await writeFile(join(artifactDir, `${baseName}.json`), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(join(artifactDir, `${baseName}.md`), `${renderMarkdown(artifact)}\n`, "utf8");
};

const renderMarkdown = (artifact: SmokeArtifact): string => [
  `# ${artifact.venue} Withdrawal Evidence Smoke Test`,
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  `- Status: ${artifact.status}`,
  `- Read only: ${artifact.readOnly}`,
  `- Persisted completion result: ${artifact.persistedCompletionResult}`,
  `- Reconciliation records before: ${artifact.reconciliationRecordsBefore ?? "unknown"}`,
  `- Reconciliation records after: ${artifact.reconciliationRecordsAfter ?? "unknown"}`,
  `- Mapping observed: ${artifact.mappingObserved ?? "none"}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  `- Live LI.FI execution enabled: ${artifact.liveLifiExecutionEnabled}`,
  `- Funding preflight enforcement enabled: ${artifact.fundingPreflightEnforcementEnabled}`,
  `- Live venue withdrawal execution enabled: ${artifact.liveVenueWithdrawalExecutionEnabled}`,
  `- Backend broadcasted transaction: ${artifact.backendBroadcastedTransaction}`,
  `- Backend signed transaction: ${artifact.backendSignedTransaction}`,
  "",
  "## Blockers",
  "",
  ...(artifact.blockers.length ? artifact.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
  "",
  "## Warnings",
  "",
  ...(artifact.warnings.length ? artifact.warnings.map((warning) => `- ${warning}`) : ["- none"])
].join("\n");

const artifact = await run();
await writeArtifacts(artifact);
console.log(JSON.stringify({
  venue: artifact.venue,
  status: artifact.status,
  mappingObserved: artifact.mappingObserved,
  readOnly: artifact.readOnly,
  persistedCompletionResult: artifact.persistedCompletionResult,
  reconciliationRecordsBefore: artifact.reconciliationRecordsBefore,
  reconciliationRecordsAfter: artifact.reconciliationRecordsAfter,
  redactionVerified: artifact.redactionVerified,
  blockers: artifact.blockers,
  artifactJsonPath: join(artifactDir, `${artifactBaseName(artifact.venue)}.json`),
  artifactMarkdownPath: join(artifactDir, `${artifactBaseName(artifact.venue)}.md`)
}, null, 2));

if (
  artifact.status !== "COMPLETED" ||
  !artifact.redactionVerified ||
  (artifact.reconciliationRecordsBefore !== null && artifact.reconciliationRecordsBefore !== artifact.reconciliationRecordsAfter)
) {
  process.exitCode = 1;
}
