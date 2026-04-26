import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import { buildVenueCapabilityMatrix } from "../../src/core/funding/venue-capabilities.js";
import {
  ConfigurableVenueFundingReadinessChecker,
  isFundingVenueReadinessSupported,
  type FundingBalanceReadClient
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

interface Artifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: "COMPLETED" | "FAILED";
  venue: FundingVenue | string;
  userId: string;
  fundingIntentId: string | null;
  withdrawalIntentId: string | null;
  withdrawalRouteLegId: string | null;
  fundingStatus: string | null;
  withdrawalStatus: string | null;
  withdrawalRouteLegStatus: string | null;
  destinationChain: string | null;
  destinationWalletAddress: string | null;
  withdrawalAmount: string;
  fakeSandboxFundingTxHash: string | null;
  fakeSandboxWithdrawalTxHash: string | null;
  reconciliationRecordsObserved: number;
  auditEventsObserved: string[];
  selectedBySmokeQuery: boolean;
  redactionVerified: boolean;
  safety: {
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    completionEvidencePersisted: false;
    productionConfigMutated: false;
  };
}

const requestedVenue = (process.argv[2] ?? "LIMITLESS").toUpperCase();
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const artifactDir = join(process.cwd(), "artifacts", "funding");
const amount = process.env.FUNDING_WITHDRAWAL_EVIDENCE_SEED_AMOUNT ?? "40";
const readyAmount = process.env.FUNDING_WITHDRAWAL_EVIDENCE_SEED_READY_AMOUNT ?? "100";
const token = "USDC";
const explicitWithdrawalTxHash = process.env.FUNDING_WITHDRAWAL_EVIDENCE_SEED_WITHDRAWAL_TX_HASH?.trim() ?? null;
const explicitDestinationAddress = process.env.FUNDING_WITHDRAWAL_EVIDENCE_SEED_DESTINATION_ADDRESS?.trim() ?? null;
const explicitDestinationChain = process.env.FUNDING_WITHDRAWAL_EVIDENCE_SEED_DESTINATION_CHAIN?.trim() ?? null;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required to seed a withdrawal evidence smoke row.");
}

class SandboxLifiProvider implements LifiRouteProvider {
  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    return {
      provider: "LIFI",
      providerRouteId: `sandbox-${input.targetVenue.toLowerCase()}-withdrawal-evidence-seed-${randomUUID()}`,
      sourceChain: input.fromChain,
      sourceToken: input.fromToken,
      sourceAmount: input.fromAmount,
      destinationChain: input.toChain,
      destinationToken: input.toToken,
      destinationAmountEstimate: input.fromAmount,
      estimatedFees: "0",
      estimatedTimeSeconds: 120,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      transactionRequest: {
        to: input.toAddress,
        data: "0x1234",
        chainId: Number(input.toChain)
      },
      userSafeSummary: "Sandbox funding route preview. Lotus does not sign or broadcast this transaction."
    };
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    return {
      status: "DONE_COMPLETED",
      raw: {
        source: "sandbox_withdrawal_evidence_seed_lifi_provider",
        status: "DONE",
        substatus: "COMPLETED"
      }
    };
  }
}

class StubFundingBalanceReadClient implements FundingBalanceReadClient {
  public constructor(private readonly usableBalance: string) {}

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    return {
      usableBalance: this.usableBalance,
      raw: {
        source: "sandbox_withdrawal_evidence_seed_readiness",
        readOnly: true
      }
    };
  }
}

const applyFundingMigrations = async (pool: Pool): Promise<void> => {
  const fundingSql = await readFile(
    resolve(process.cwd(), "sql", "migrations", "2026_04_25_create_funding_flow_v0_tables.sql"),
    "utf8"
  );
  await pool.query(fundingSql);
  const withdrawalSql = await readFile(
    resolve(process.cwd(), "sql", "migrations", "2026_04_26_create_funding_withdrawal_v0_tables.sql"),
    "utf8"
  );
  await pool.query(withdrawalSql);
};

const fakeTxHash = (): string => `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66);

const withdrawalTxHash = (): string => {
  if (explicitWithdrawalTxHash) {
    if (!/^([A-Za-z0-9]{32,}|0x[a-fA-F0-9]{64})$/.test(explicitWithdrawalTxHash)) {
      throw new Error("FUNDING_WITHDRAWAL_EVIDENCE_SEED_WITHDRAWAL_TX_HASH is not a valid tx hash/reference.");
    }
    return explicitWithdrawalTxHash;
  }
  return fakeTxHash();
};

const fallbackAddressForVenue = (venue: FundingVenue): string =>
  venue === "LIMITLESS"
    ? "0x2222222222222222222222222222222222222222"
    : venue === "OPINION"
      ? "0x3333333333333333333333333333333333333333"
      : venue === "MYRIAD"
        ? "0x4444444444444444444444444444444444444444"
        : venue === "PREDICT_FUN"
          ? "0x5555555555555555555555555555555555555555"
          : "0x1111111111111111111111111111111111111111";

const withSeedEnv = (venue: FundingVenue): NodeJS.ProcessEnv => ({
  ...process.env,
  [`${venue}_FUNDING_DESTINATION_ADDRESS`]:
    process.env[`${venue}_FUNDING_DESTINATION_ADDRESS`]?.trim() || fallbackAddressForVenue(venue),
  [`${venue}_FUNDING_WITHDRAWALS_ENABLED`]: "true"
});

const safety = (): Artifact["safety"] => ({
  liveLifiExecutionEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  custodyModel: "MODEL_A_NON_CUSTODIAL",
  completionEvidencePersisted: false,
  productionConfigMutated: false
});

const secretCandidates = [
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL,
  process.env.LIFI_API_KEY,
  process.env.LIMITLESS_WITHDRAWAL_EVIDENCE_API_KEY,
  process.env.LIMITLESS_API_KEY,
  process.env.POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY,
  process.env.POLYMARKET_API_KEY
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const assertRedacted = (payload: unknown): boolean => {
  const serialized = JSON.stringify(payload);
  return !secretCandidates.some((secret) => serialized.includes(secret))
    && !serialized.includes("transactionRequest")
    && !serialized.includes("0x1234")
    && !/authorization/i.test(serialized)
    && !/privateKey/i.test(serialized);
};

const countWithdrawalReconciliations = async (pool: Pool, withdrawalIntentId: string | null): Promise<number> => {
  if (!withdrawalIntentId) {
    return 0;
  }
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM funding_withdrawal_reconciliation_records WHERE withdrawal_intent_id = $1::uuid",
    [withdrawalIntentId]
  );
  return Number(result.rows[0]?.count ?? "0");
};

const verifySmokeCandidate = async (pool: Pool, withdrawalRouteLegId: string | null, venue: FundingVenue): Promise<boolean> => {
  if (!withdrawalRouteLegId) {
    return false;
  }
  const result = await pool.query<{ route_leg_id: string }>(
    `SELECT wl.id::text AS route_leg_id
       FROM funding_withdrawal_route_legs wl
       JOIN funding_withdrawal_intents wi ON wi.id = wl.withdrawal_intent_id
      WHERE wl.source_venue = $1
        AND jsonb_array_length(wl.tx_hashes) > 0
      ORDER BY wl.updated_at DESC
      LIMIT 1`,
    [venue]
  );
  return result.rows[0]?.route_leg_id === withdrawalRouteLegId;
};

const renderMarkdown = (artifact: Artifact): string => [
  `# ${artifact.venue} Withdrawal Evidence Smoke Row Seed`,
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  `- Status: ${artifact.status}`,
  `- User: ${artifact.userId}`,
  `- Funding intent: ${artifact.fundingIntentId ?? "none"}`,
  `- Withdrawal intent: ${artifact.withdrawalIntentId ?? "none"}`,
  `- Withdrawal route leg: ${artifact.withdrawalRouteLegId ?? "none"}`,
  `- Funding status: ${artifact.fundingStatus ?? "unknown"}`,
  `- Withdrawal status: ${artifact.withdrawalStatus ?? "unknown"}`,
  `- Withdrawal route leg status: ${artifact.withdrawalRouteLegStatus ?? "unknown"}`,
  `- Destination chain: ${artifact.destinationChain ?? "unknown"}`,
  `- Withdrawal amount: ${artifact.withdrawalAmount} USDC`,
  `- Reconciliation records observed: ${artifact.reconciliationRecordsObserved}`,
  `- Selected by smoke query: ${artifact.selectedBySmokeQuery}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  "",
  "This seed creates a submitted withdrawal route leg only. It does not persist completion evidence."
].join("\n");

const writeArtifacts = async (artifact: Artifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  const baseName = `${String(artifact.venue).toLowerCase().replaceAll("_", "-")}-withdrawal-evidence-smoke-row-seed`;
  await writeFile(join(artifactDir, `${baseName}.json`), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(join(artifactDir, `${baseName}.md`), `${renderMarkdown(artifact)}\n`, "utf8");
};

const main = async (): Promise<void> => {
  if (!isFundingVenueReadinessSupported(requestedVenue)) {
    throw new Error("Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN.");
  }
  const venue = requestedVenue;
  const pool = new Pool({ connectionString: databaseUrl });
  const env = withSeedEnv(venue);
  let artifact: Artifact = {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    venue,
    userId: process.env.FUNDING_WITHDRAWAL_EVIDENCE_SEED_USER_ID ?? `sandbox-${venue.toLowerCase()}-withdrawal-evidence-user-${randomUUID()}`,
    fundingIntentId: null,
    withdrawalIntentId: null,
    withdrawalRouteLegId: null,
    fundingStatus: null,
    withdrawalStatus: null,
    withdrawalRouteLegStatus: null,
    destinationChain: null,
    destinationWalletAddress: null,
    withdrawalAmount: amount,
    fakeSandboxFundingTxHash: null,
    fakeSandboxWithdrawalTxHash: null,
    reconciliationRecordsObserved: 0,
    auditEventsObserved: [],
    selectedBySmokeQuery: false,
    redactionVerified: false,
    safety: safety()
  };

  try {
    await applyFundingMigrations(pool);
    const repository = new FundingRepository(pool);
    const matrix = buildVenueCapabilityMatrix({ env });
    const capability = matrix[venue];
    const service = new FundingService(
      repository,
      new SandboxLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env
      },
      new Map([
        [
          venue,
          new ConfigurableVenueFundingReadinessChecker(
            venue,
            new StubFundingBalanceReadClient(readyAmount),
            { enabled: true, mode: "STUB", env }
          )
        ]
      ])
    );

    const funding = await service.createIntent(artifact.userId, {
      sourceChain: "SOLANA",
      sourceToken: token,
      sourceAmount: readyAmount,
      sourceWalletAddress: `sandbox-${venue.toLowerCase()}-source-wallet`,
      idempotencyKey: `sandbox-${venue.toLowerCase()}-withdrawal-evidence-funding-${randomUUID()}`,
      targets: [{ targetVenue: venue, targetPercentage: 100 }]
    });
    artifact = { ...artifact, fundingIntentId: funding.intent.fundingIntentId };

    const fundingQuote = await service.quoteIntent(artifact.userId, funding.intent.fundingIntentId);
    const fundingLeg = fundingQuote.routeLegs[0];
    if (!fundingLeg) {
      throw new Error("Funding seed did not produce a route leg.");
    }
    const fundingTxHash = fakeTxHash();
    await service.submitRouteLeg(artifact.userId, funding.intent.fundingIntentId, {
      routeLegId: fundingLeg.routeLegId,
      txHash: fundingTxHash
    });
    const readyFunding = await service.refreshIntentStatus(artifact.userId, funding.intent.fundingIntentId);
    artifact = {
      ...artifact,
      fakeSandboxFundingTxHash: fundingTxHash,
      fundingStatus: readyFunding.intent.status
    };

    const withdrawal = await service.createWithdrawalIntent(artifact.userId, {
      token,
      amount,
      destinationChain: explicitDestinationChain ?? capability.preferredChain,
      destinationWalletAddress: explicitDestinationAddress ?? fallbackAddressForVenue(venue),
      idempotencyKey: `sandbox-${venue.toLowerCase()}-withdrawal-evidence-${randomUUID()}`,
      sources: [{ sourceVenue: venue, sourcePercentage: 100 }]
    });
    const quotedWithdrawal = await service.quoteWithdrawalIntent(artifact.userId, withdrawal.intent.withdrawalIntentId);
    const withdrawalLeg = quotedWithdrawal.routeLegs[0];
    if (!withdrawalLeg) {
      throw new Error("Withdrawal quote did not produce a route leg.");
    }
    const submittedWithdrawalTxHash = withdrawalTxHash();
    const submittedWithdrawal = await service.submitWithdrawalRouteLeg(artifact.userId, withdrawal.intent.withdrawalIntentId, {
      withdrawalRouteLegId: withdrawalLeg.withdrawalRouteLegId,
      txHash: submittedWithdrawalTxHash
    });
    const submittedLeg = submittedWithdrawal.routeLegs[0];
    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type
         FROM funding_withdrawal_audit_events
        WHERE withdrawal_intent_id = $1::uuid
        ORDER BY created_at ASC`,
      [submittedWithdrawal.intent.withdrawalIntentId]
    );
    const reconciliationCount = await countWithdrawalReconciliations(pool, submittedWithdrawal.intent.withdrawalIntentId);
    const selectedBySmokeQuery = await verifySmokeCandidate(pool, submittedLeg?.withdrawalRouteLegId ?? null, venue);
    artifact = {
      ...artifact,
      withdrawalIntentId: submittedWithdrawal.intent.withdrawalIntentId,
      withdrawalRouteLegId: submittedLeg?.withdrawalRouteLegId ?? null,
      withdrawalStatus: submittedWithdrawal.intent.status,
      withdrawalRouteLegStatus: submittedLeg?.status ?? null,
      destinationChain: submittedWithdrawal.intent.destinationChain,
      destinationWalletAddress: submittedWithdrawal.intent.destinationWalletAddress,
      fakeSandboxWithdrawalTxHash: submittedWithdrawalTxHash,
      reconciliationRecordsObserved: reconciliationCount,
      auditEventsObserved: audit.rows.map((row) => row.event_type),
      selectedBySmokeQuery
    };
    const completed = artifact.fundingStatus === "READY_TO_TRADE"
      && artifact.withdrawalStatus === "WITHDRAWING"
      && artifact.withdrawalRouteLegStatus === "VENUE_RELEASE_PENDING"
      && artifact.reconciliationRecordsObserved === 0
      && artifact.selectedBySmokeQuery;
    const candidate = { ...artifact, status: completed ? "COMPLETED" : "FAILED" } satisfies Artifact;
    const redacted = { ...candidate, redactionVerified: assertRedacted(candidate) };
    await writeArtifacts(redacted);
    console.log(JSON.stringify({
      status: redacted.status,
      venue: redacted.venue,
      userId: redacted.userId,
      fundingIntentId: redacted.fundingIntentId,
      withdrawalIntentId: redacted.withdrawalIntentId,
      withdrawalRouteLegId: redacted.withdrawalRouteLegId,
      fundingStatus: redacted.fundingStatus,
      withdrawalStatus: redacted.withdrawalStatus,
      withdrawalRouteLegStatus: redacted.withdrawalRouteLegStatus,
      reconciliationRecordsObserved: redacted.reconciliationRecordsObserved,
      selectedBySmokeQuery: redacted.selectedBySmokeQuery,
      redactionVerified: redacted.redactionVerified
    }, null, 2));
    if (redacted.status !== "COMPLETED" || !redacted.redactionVerified) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
};

await main();
