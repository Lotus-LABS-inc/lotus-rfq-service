import Decimal from "decimal.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

loadDotenv();

interface SmokeArtifact {
  generatedAt?: string;
  status?: string;
  venue?: string;
  readOnly?: boolean;
  persistedCompletionResult?: boolean;
  selectedWithdrawal?: {
    withdrawalIntentId?: string;
    userId?: string;
    sourceVenue?: string;
    withdrawalRouteLegId?: string;
    synthetic?: boolean;
    withdrawalTxHash?: string | null;
    destinationChain?: string;
    destinationWalletAddress?: string;
    requiredAmount?: string;
  } | null;
  evidenceResult?: {
    status?: string;
    venueReleased?: boolean;
    destinationReceived?: boolean;
    completed?: boolean;
    reason?: string;
    evidence?: Record<string, unknown>;
  } | null;
  mappingObserved?: string | null;
  redactionVerified?: boolean;
}

interface CandidateRow {
  withdrawal_intent_id: string;
  withdrawal_route_leg_id: string;
  user_id: string;
  withdrawal_status: string;
  route_leg_status: string;
  destination_chain: string;
  destination_wallet_address: string;
  source_amount: string;
  destination_amount_estimate: string;
  tx_hashes: string[];
  completed_reconciliation_count: string;
  latest_reconciliation_checked_at: Date | null;
  updated_at: Date;
}

interface RecoveryReviewArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: "REVIEW_REQUIRED" | "READY_FOR_OPERATOR_REVIEW" | "FAILED";
  venue: "POLYMARKET";
  smokeArtifactPath: string;
  bridgeAddress: string | null;
  bridgeStatus: string | null;
  bridgeAmount: string | null;
  bridgeTxHash: string | null;
  selectedWithdrawalTxHash: string | null;
  candidateWindowHours: number;
  candidateCount: number;
  candidateExpectedAmountTotal: string;
  aggregateAmountDelta: string | null;
  exactAggregateAmountMatch: boolean;
  candidates: Array<{
    withdrawalIntentId: string;
    withdrawalRouteLegId: string;
    userId: string;
    withdrawalStatus: string;
    routeLegStatus: string;
    destinationChain: string;
    destinationWalletAddress: string;
    destinationAmountEstimate: string;
    txHashes: string[];
    alreadyCompleted: boolean;
    latestReconciliationCheckedAt: string | null;
    updatedAt: string;
  }>;
  approvalRequired: true;
  persistenceWritten: false;
  blockers: string[];
  warnings: string[];
  redactionVerified: boolean;
  safety: {
    readOnly: true;
    backendSignedTransaction: false;
    backendBroadcastedTransaction: false;
    liveVenueWithdrawalExecutionEnabled: false;
    completionPersisted: false;
    custodyModel: "MODEL_A_NON_CUSTODIAL";
  };
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const outputJsonPath = join(artifactDir, "polymarket-bridge-withdrawal-recovery-review.json");
const outputMarkdownPath = join(artifactDir, "polymarket-bridge-withdrawal-recovery-review.md");
const smokeArtifactPath = process.env.POLYMARKET_WITHDRAWAL_EVIDENCE_SMOKE_ARTIFACT_PATH?.trim() ||
  join(artifactDir, "polymarket-withdrawal-evidence-smoke-test.json");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const candidateWindowHours = positiveInt(process.env.POLYMARKET_BRIDGE_RECOVERY_REVIEW_WINDOW_HOURS, 6);

const readSmokeArtifact = async (): Promise<SmokeArtifact> =>
  JSON.parse(await readFile(smokeArtifactPath, "utf8")) as SmokeArtifact;

const queryCandidates = async (
  pool: Pool,
  input: {
    selectedWithdrawalRouteLegId: string;
    destinationWalletAddress: string;
    destinationChain: string;
  }
): Promise<CandidateRow[]> => {
  const result = await pool.query<CandidateRow>(
    `WITH selected AS (
       SELECT updated_at
         FROM funding_withdrawal_route_legs
        WHERE id = $1::uuid
      ),
      completed_reconciliations AS (
       SELECT withdrawal_route_leg_id,
              count(*)::text AS completed_reconciliation_count,
              max(checked_at) AS latest_reconciliation_checked_at
         FROM funding_withdrawal_reconciliation_records
        WHERE completed = true
        GROUP BY withdrawal_route_leg_id
      )
      SELECT wi.id::text AS withdrawal_intent_id,
             wl.id::text AS withdrawal_route_leg_id,
             wi.user_id,
             wi.status AS withdrawal_status,
             wl.status AS route_leg_status,
             wi.destination_chain,
             wi.destination_wallet_address,
             wl.source_amount,
             wl.destination_amount_estimate,
             wl.tx_hashes,
             COALESCE(cr.completed_reconciliation_count, '0') AS completed_reconciliation_count,
             cr.latest_reconciliation_checked_at,
             wl.updated_at
        FROM funding_withdrawal_route_legs wl
        JOIN funding_withdrawal_intents wi ON wi.id = wl.withdrawal_intent_id
        LEFT JOIN completed_reconciliations cr ON cr.withdrawal_route_leg_id = wl.id
       WHERE wl.source_venue = 'POLYMARKET'
         AND jsonb_array_length(wl.tx_hashes) > 0
         AND upper(wi.destination_chain) = upper($2)
         AND lower(wi.destination_wallet_address) = lower($3)
         AND wl.updated_at >= (SELECT updated_at FROM selected) - ($4::text || ' hours')::interval
         AND wl.updated_at <= (SELECT updated_at FROM selected) + ($4::text || ' hours')::interval
       ORDER BY wl.updated_at ASC`,
    [
      input.selectedWithdrawalRouteLegId,
      input.destinationChain,
      input.destinationWalletAddress,
      String(candidateWindowHours)
    ]
  );
  return result.rows;
};

const buildArtifact = async (): Promise<RecoveryReviewArtifact> => {
  const smoke = await readSmokeArtifact();
  const evidence = smoke.evidenceResult?.evidence ?? {};
  const selected = smoke.selectedWithdrawal;
  const base = baseArtifact(smoke, []);
  const blockers: string[] = [];
  if (!databaseUrl) {
    blockers.push("TEST_DATABASE_URL or DATABASE_URL is required.");
  }
  if (smoke.venue !== "POLYMARKET" || selected?.sourceVenue !== "POLYMARKET") {
    blockers.push("Latest smoke artifact is not for POLYMARKET.");
  }
  if (selected?.synthetic !== false) {
    blockers.push("Recovery review requires a real submitted withdrawal row.");
  }
  if (smoke.readOnly !== true || smoke.persistedCompletionResult !== false) {
    blockers.push("Recovery review requires a read-only smoke artifact with no persistence.");
  }
  if (smoke.redactionVerified !== true) {
    blockers.push("Recovery review requires a redacted smoke artifact.");
  }
  if (evidence.recoveryReviewRequired !== true) {
    blockers.push("Latest smoke artifact does not contain recoveryReviewRequired=true.");
  }
  if (evidence.bridgeStatus !== "COMPLETED") {
    blockers.push("Bridge status is not COMPLETED.");
  }
  if (!stringValue(evidence.bridgeAddress) || !stringValue(evidence.bridgeAmount)) {
    blockers.push("Bridge address and aggregate amount are required for recovery review.");
  }
  if (!selected?.withdrawalRouteLegId || !selected.destinationWalletAddress || !selected.destinationChain) {
    blockers.push("Selected withdrawal is missing route leg or destination scope.");
  }
  if (blockers.length > 0 || !databaseUrl || !selected?.withdrawalRouteLegId || !selected.destinationWalletAddress || !selected.destinationChain) {
    return { ...base, blockers, redactionVerified: verifyRedaction({ ...base, blockers }) };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const candidates = await queryCandidates(pool, {
      selectedWithdrawalRouteLegId: selected.withdrawalRouteLegId,
      destinationWalletAddress: selected.destinationWalletAddress,
      destinationChain: selected.destinationChain
    });
    const total = candidates.reduce(
      (sum, candidate) => sum.plus(candidate.destination_amount_estimate),
      new Decimal(0)
    );
    const bridgeAmount = stringValue(evidence.bridgeAmount);
    const bridgeAmountDecimal = toDecimalOrNull(bridgeAmount);
    const delta = bridgeAmountDecimal ? bridgeAmountDecimal.minus(total) : null;
    const exactAggregateAmountMatch = bridgeAmountDecimal !== null && total.eq(bridgeAmountDecimal);
    const candidateBlockers = [
      ...(candidates.length === 0 ? ["No candidate withdrawal rows matched the aggregate recovery window."] : []),
      ...(bridgeAmountDecimal === null ? ["Bridge aggregate amount is not parseable."] : []),
      ...(exactAggregateAmountMatch ? [] : ["Candidate expected amount total does not exactly match Bridge aggregate amount."]),
      ...(candidates.some((candidate) => Number(candidate.completed_reconciliation_count) > 0)
        ? ["One or more candidate rows already has completed reconciliation; operator must review before any manual adjustment."]
        : [])
    ];
    const artifact: RecoveryReviewArtifact = {
      ...base,
      status: candidateBlockers.length === 0 ? "READY_FOR_OPERATOR_REVIEW" : "REVIEW_REQUIRED",
      candidateCount: candidates.length,
      candidateExpectedAmountTotal: total.toString(),
      aggregateAmountDelta: delta ? delta.toString() : null,
      exactAggregateAmountMatch,
      candidates: candidates.map(mapCandidate),
      blockers: candidateBlockers,
      warnings: [
        "This artifact is a recovery proposal only. It does not approve or persist completion.",
        "Operator approval must verify exact tx hashes, amounts, destination wallet, and any prior completed reconciliation before a separate persistence command exists."
      ]
    };
    return {
      ...artifact,
      redactionVerified: verifyRedaction(artifact)
    };
  } finally {
    await pool.end();
  }
};

const baseArtifact = (smoke: SmokeArtifact, blockers: string[]): RecoveryReviewArtifact => {
  const evidence = smoke.evidenceResult?.evidence ?? {};
  return {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    venue: "POLYMARKET",
    smokeArtifactPath,
    bridgeAddress: stringValue(evidence.bridgeAddress) ?? null,
    bridgeStatus: stringValue(evidence.bridgeStatus) ?? null,
    bridgeAmount: stringValue(evidence.bridgeAmount) ?? null,
    bridgeTxHash: stringValue(evidence.bridgeTxHash) ?? null,
    selectedWithdrawalTxHash: smoke.selectedWithdrawal?.withdrawalTxHash ?? null,
    candidateWindowHours,
    candidateCount: 0,
    candidateExpectedAmountTotal: "0",
    aggregateAmountDelta: null,
    exactAggregateAmountMatch: false,
    candidates: [],
    approvalRequired: true,
    persistenceWritten: false,
    blockers,
    warnings: [],
    redactionVerified: false,
    safety: {
      readOnly: true,
      backendSignedTransaction: false,
      backendBroadcastedTransaction: false,
      liveVenueWithdrawalExecutionEnabled: false,
      completionPersisted: false,
      custodyModel: "MODEL_A_NON_CUSTODIAL"
    }
  };
};

const mapCandidate = (row: CandidateRow): RecoveryReviewArtifact["candidates"][number] => ({
  withdrawalIntentId: row.withdrawal_intent_id,
  withdrawalRouteLegId: row.withdrawal_route_leg_id,
  userId: row.user_id,
  withdrawalStatus: row.withdrawal_status,
  routeLegStatus: row.route_leg_status,
  destinationChain: row.destination_chain,
  destinationWalletAddress: row.destination_wallet_address,
  destinationAmountEstimate: row.destination_amount_estimate,
  txHashes: row.tx_hashes ?? [],
  alreadyCompleted: Number(row.completed_reconciliation_count) > 0,
  latestReconciliationCheckedAt: row.latest_reconciliation_checked_at ? row.latest_reconciliation_checked_at.toISOString() : null,
  updatedAt: row.updated_at.toISOString()
});

const renderMarkdown = (artifact: RecoveryReviewArtifact): string => [
  "# Polymarket Bridge Withdrawal Recovery Review",
  "",
  `- Status: ${artifact.status}`,
  `- Generated at: ${artifact.generatedAt}`,
  `- Smoke artifact: ${artifact.smokeArtifactPath}`,
  `- Bridge address: ${artifact.bridgeAddress ?? "unknown"}`,
  `- Bridge status: ${artifact.bridgeStatus ?? "unknown"}`,
  `- Bridge aggregate amount: ${artifact.bridgeAmount ?? "unknown"}`,
  `- Candidate expected total: ${artifact.candidateExpectedAmountTotal}`,
  `- Aggregate amount delta: ${artifact.aggregateAmountDelta ?? "unknown"}`,
  `- Exact aggregate amount match: ${artifact.exactAggregateAmountMatch}`,
  `- Candidate count: ${artifact.candidateCount}`,
  `- Approval required: ${artifact.approvalRequired}`,
  `- Persistence written: ${artifact.persistenceWritten}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  "",
  "## Blockers",
  ...(artifact.blockers.length ? artifact.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
  "",
  "## Candidates",
  ...(artifact.candidates.length
    ? artifact.candidates.map((candidate) =>
      `- ${candidate.withdrawalRouteLegId}: amount=${candidate.destinationAmountEstimate}, status=${candidate.routeLegStatus}, alreadyCompleted=${candidate.alreadyCompleted}`
    )
    : ["- none"]),
  "",
  "This report is read-only. It does not sign, broadcast, move funds, or persist withdrawal completion."
].join("\n");

const writeArtifacts = async (artifact: RecoveryReviewArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(outputJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(outputMarkdownPath, `${renderMarkdown(artifact)}\n`, "utf8");
};

const verifyRedaction = (artifact: RecoveryReviewArtifact): boolean => {
  const serialized = JSON.stringify(artifact);
  const secretCandidates = [
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
    process.env.POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY,
    process.env.POLYMARKET_BRIDGE_API_KEY
  ].filter((value): value is string => Boolean(value) && value.length >= 8);
  return !secretCandidates.some((secret) => serialized.includes(secret)) &&
    !/authorization/i.test(serialized) &&
    !/privateKey/i.test(serialized) &&
    !/transactionRequest/i.test(serialized);
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const toDecimalOrNull = (value: string | undefined): Decimal | null => {
  try {
    return value ? new Decimal(value) : null;
  } catch {
    return null;
  }
};

const artifact = await buildArtifact();
await writeArtifacts(artifact);
console.log(JSON.stringify({
  status: artifact.status,
  bridgeStatus: artifact.bridgeStatus,
  bridgeAmount: artifact.bridgeAmount,
  candidateCount: artifact.candidateCount,
  candidateExpectedAmountTotal: artifact.candidateExpectedAmountTotal,
  aggregateAmountDelta: artifact.aggregateAmountDelta,
  exactAggregateAmountMatch: artifact.exactAggregateAmountMatch,
  approvalRequired: artifact.approvalRequired,
  persistenceWritten: artifact.persistenceWritten,
  redactionVerified: artifact.redactionVerified,
  blockers: artifact.blockers,
  artifactJsonPath: outputJsonPath,
  artifactMarkdownPath: outputMarkdownPath
}, null, 2));

if (!artifact.redactionVerified || artifact.status === "FAILED") {
  process.exitCode = 1;
}
