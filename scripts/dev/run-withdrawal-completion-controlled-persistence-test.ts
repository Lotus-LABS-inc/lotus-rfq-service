import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import {
  buildWithdrawalCompletionPersistenceGateFromEnv,
  buildWithdrawalEvidenceCheckerFromEnv,
  isWithdrawalEvidenceVenueSupported
} from "../../src/core/funding/withdrawal-evidence.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

interface SmokeArtifact {
  venue?: string;
  selectedWithdrawal?: {
    withdrawalIntentId?: string;
    userId?: string;
    sourceVenue?: string;
    withdrawalRouteLegId?: string;
    synthetic?: boolean;
    withdrawalTxHash?: string | null;
  } | null;
}

interface PersistenceArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: "COMPLETED" | "FAILED";
  venue: FundingVenue | string | null;
  userId: string | null;
  withdrawalIntentId: string | null;
  withdrawalRouteLegId: string | null;
  smokeArtifactPath: string | null;
  reconciliationRecordsBefore: number | null;
  reconciliationRecordsAfter: number | null;
  completionPersisted: boolean;
  withdrawalStatus: string | null;
  routeLegStatus: string | null;
  gatePassed: boolean;
  evidenceCheckerConfigured: boolean;
  redactionVerified: boolean;
  blockers: string[];
  safety: {
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    productionConfigMutated: false;
  };
}

class NoopLifiProvider implements LifiRouteProvider {
  public async quote(): Promise<FundingRouteQuote> {
    throw new Error("LI.FI quote is not used by the controlled withdrawal completion persistence test.");
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    throw new Error("LI.FI status is not used by the controlled withdrawal completion persistence test.");
  }
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const outputJsonPath = join(artifactDir, "withdrawal-completion-controlled-persistence-test.json");
const outputMarkdownPath = join(artifactDir, "withdrawal-completion-controlled-persistence-test.md");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const safety = (): PersistenceArtifact["safety"] => ({
  liveLifiExecutionEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  custodyModel: "MODEL_A_NON_CUSTODIAL",
  productionConfigMutated: false
});

const selectedPersistenceVenues = (): FundingVenue[] => {
  if (process.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED !== "true") {
    return [];
  }
  const fromList = (process.env.FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_VENUES ?? "")
    .split(",")
    .map((venue) => venue.trim().toUpperCase())
    .filter((venue): venue is FundingVenue => isWithdrawalEvidenceVenueSupported(venue));
  const fromFlags = (["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const)
    .filter((venue) => process.env[`${venue}_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED`] === "true");
  return Array.from(new Set<FundingVenue>([...fromList, ...fromFlags]));
};

const smokeArtifactPathFor = (venue: FundingVenue): string =>
  process.env[`${venue}_WITHDRAWAL_EVIDENCE_SMOKE_ARTIFACT_PATH`]?.trim() ||
  join(artifactDir, `${venue.toLowerCase().replaceAll("_", "-")}-withdrawal-evidence-smoke-test.json`);

const countReconciliations = async (pool: Pool, withdrawalIntentId: string): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM funding_withdrawal_reconciliation_records WHERE withdrawal_intent_id = $1::uuid",
    [withdrawalIntentId]
  );
  return Number(result.rows[0]?.count ?? "0");
};

const redactionOk = (artifact: PersistenceArtifact): boolean => {
  const serialized = JSON.stringify(artifact);
  const candidates = [
    process.env.DATABASE_URL,
    process.env.TEST_DATABASE_URL,
    process.env.LIFI_API_KEY,
    process.env.POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY,
    process.env.LIMITLESS_WITHDRAWAL_EVIDENCE_API_KEY,
    process.env.OPINION_WITHDRAWAL_EVIDENCE_API_KEY,
    process.env.MYRIAD_WITHDRAWAL_EVIDENCE_API_KEY,
    process.env.PREDICT_FUN_WITHDRAWAL_EVIDENCE_API_KEY
  ].filter((value): value is string => Boolean(value) && value.length >= 8);
  return !candidates.some((secret) => serialized.includes(secret)) &&
    !/authorization/i.test(serialized) &&
    !/privateKey/i.test(serialized) &&
    !/transactionRequest/i.test(serialized);
};

const renderMarkdown = (artifact: PersistenceArtifact): string => [
  "# Withdrawal Completion Controlled Persistence Test",
  "",
  `- Status: ${artifact.status}`,
  `- Generated at: ${artifact.generatedAt}`,
  `- Venue: ${artifact.venue ?? "none"}`,
  `- Withdrawal intent: ${artifact.withdrawalIntentId ?? "none"}`,
  `- Withdrawal route leg: ${artifact.withdrawalRouteLegId ?? "none"}`,
  `- Smoke artifact: ${artifact.smokeArtifactPath ?? "none"}`,
  `- Gate passed: ${artifact.gatePassed}`,
  `- Evidence checker configured: ${artifact.evidenceCheckerConfigured}`,
  `- Reconciliation records before: ${artifact.reconciliationRecordsBefore ?? "unknown"}`,
  `- Reconciliation records after: ${artifact.reconciliationRecordsAfter ?? "unknown"}`,
  `- Completion persisted: ${artifact.completionPersisted}`,
  `- Withdrawal status: ${artifact.withdrawalStatus ?? "unknown"}`,
  `- Route leg status: ${artifact.routeLegStatus ?? "unknown"}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  "",
  "## Blockers",
  ...(artifact.blockers.length ? artifact.blockers.map((blocker) => `- ${blocker}`) : ["- None"]),
  "",
  "This test does not quote, sign, broadcast, custody funds, or call LI.FI execution."
].join("\n");

const writeArtifacts = async (artifact: PersistenceArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(outputJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(outputMarkdownPath, `${renderMarkdown(artifact)}\n`, "utf8");
};

const run = async (): Promise<PersistenceArtifact> => {
  const venues = selectedPersistenceVenues();
  const base: PersistenceArtifact = {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    venue: venues[0] ?? null,
    userId: null,
    withdrawalIntentId: null,
    withdrawalRouteLegId: null,
    smokeArtifactPath: venues[0] ? smokeArtifactPathFor(venues[0]) : null,
    reconciliationRecordsBefore: null,
    reconciliationRecordsAfter: null,
    completionPersisted: false,
    withdrawalStatus: null,
    routeLegStatus: null,
    gatePassed: false,
    evidenceCheckerConfigured: false,
    redactionVerified: false,
    blockers: [],
    safety: safety()
  };

  if (!databaseUrl) {
    return { ...base, blockers: ["TEST_DATABASE_URL or DATABASE_URL is required."] };
  }
  if (venues.length !== 1) {
    return {
      ...base,
      blockers: ["Exactly one withdrawal completion persistence venue must be enabled for this controlled test."]
    };
  }
  const venue = venues[0]!;
  const gate = buildWithdrawalCompletionPersistenceGateFromEnv(process.env);
  const gateValidation = await gate.validate(venue);
  if (!gateValidation.allowed) {
    return { ...base, blockers: gateValidation.blockers };
  }

  const checker = buildWithdrawalEvidenceCheckerFromEnv(venue, process.env);
  if (!checker) {
    return { ...base, gatePassed: true, blockers: [`${venue} withdrawal evidence checker is not configured.`] };
  }

  const smoke = JSON.parse(await readFile(gateValidation.artifactPath, "utf8")) as SmokeArtifact;
  const selected = smoke.selectedWithdrawal;
  if (!selected || selected.synthetic !== false || selected.sourceVenue !== venue) {
    return {
      ...base,
      gatePassed: true,
      evidenceCheckerConfigured: true,
      blockers: ["Smoke artifact does not contain a real selected withdrawal for the enabled venue."]
    };
  }
  const userId = selected.userId;
  const withdrawalIntentId = selected.withdrawalIntentId;
  const withdrawalRouteLegId = selected.withdrawalRouteLegId;
  if (!userId || !withdrawalIntentId || !withdrawalRouteLegId) {
    return {
      ...base,
      gatePassed: true,
      evidenceCheckerConfigured: true,
      blockers: ["Smoke artifact selected withdrawal is missing identifiers."]
    };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new FundingRepository(pool);
    const service = new FundingService(
      repository,
      new NoopLifiProvider(),
      {
        lifiQuotesEnabled: false,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: false,
        env: process.env
      },
      new Map(),
      checker,
      gate
    );
    const before = await countReconciliations(pool, withdrawalIntentId);
    const view = await service.refreshWithdrawalStatus(userId, withdrawalIntentId);
    const after = await countReconciliations(pool, withdrawalIntentId);
    const leg = view.routeLegs.find((candidate) => candidate.withdrawalRouteLegId === withdrawalRouteLegId);
    const artifact: PersistenceArtifact = {
      ...base,
      status: leg?.status === "WITHDRAWAL_LEG_COMPLETED" && after > before ? "COMPLETED" : "FAILED",
      userId,
      withdrawalIntentId,
      withdrawalRouteLegId,
      gatePassed: true,
      evidenceCheckerConfigured: true,
      reconciliationRecordsBefore: before,
      reconciliationRecordsAfter: after,
      completionPersisted: leg?.status === "WITHDRAWAL_LEG_COMPLETED" && after > before,
      withdrawalStatus: view.intent.status,
      routeLegStatus: leg?.status ?? null,
      blockers: leg?.status === "WITHDRAWAL_LEG_COMPLETED" && after > before ? [] : ["Refresh did not persist completed withdrawal evidence."]
    };
    return {
      ...artifact,
      redactionVerified: redactionOk(artifact)
    };
  } catch (error) {
    return {
      ...base,
      userId,
      withdrawalIntentId,
      withdrawalRouteLegId,
      gatePassed: true,
      evidenceCheckerConfigured: true,
      blockers: [error instanceof Error ? error.message : "Unknown controlled withdrawal completion persistence failure."]
    };
  } finally {
    await pool.end();
  }
};

const artifact = await run();
const finalArtifact = artifact.redactionVerified ? artifact : { ...artifact, redactionVerified: redactionOk(artifact) };
await writeArtifacts(finalArtifact);

console.log(JSON.stringify({
  status: finalArtifact.status,
  venue: finalArtifact.venue,
  gatePassed: finalArtifact.gatePassed,
  evidenceCheckerConfigured: finalArtifact.evidenceCheckerConfigured,
  completionPersisted: finalArtifact.completionPersisted,
  reconciliationRecordsBefore: finalArtifact.reconciliationRecordsBefore,
  reconciliationRecordsAfter: finalArtifact.reconciliationRecordsAfter,
  withdrawalStatus: finalArtifact.withdrawalStatus,
  routeLegStatus: finalArtifact.routeLegStatus,
  redactionVerified: finalArtifact.redactionVerified,
  blockers: finalArtifact.blockers,
  artifactJsonPath: outputJsonPath,
  artifactMarkdownPath: outputMarkdownPath
}, null, 2));

if (finalArtifact.status !== "COMPLETED" || !finalArtifact.redactionVerified) {
  process.exitCode = 1;
}
