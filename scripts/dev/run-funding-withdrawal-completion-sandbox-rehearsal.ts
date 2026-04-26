import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import {
  FundingService,
  type WithdrawalCompletionEvidenceChecker,
  type WithdrawalCompletionEvidenceResult
} from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote } from "../../src/core/funding/types.js";
import {
  PolymarketFundingReadinessChecker,
  type PolymarketFundingBalanceReadClient
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

interface WithdrawalCompletionSandboxArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: "COMPLETED" | "FAILED";
  userId: string;
  fundingIntentId: string | null;
  withdrawalIntentId: string | null;
  sourceVenue: "POLYMARKET";
  token: "USDC";
  withdrawalAmount: string;
  fakeSandboxTxHash: string | null;
  venueReleased: boolean;
  destinationReceived: boolean;
  completed: boolean;
  withdrawalStatus: string | null;
  routeLegStatus: string | null;
  reconciliationRecordsObserved: number;
  auditEventsObserved: string[];
  redactionVerified: boolean;
  safety: {
    liveLifiExecutionEnabled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    fundingPreflightEnforcementEnabledByScript: false;
    productionConfigMutated: false;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "withdrawal-completion-sandbox-rehearsal.json");
const artifactMarkdownPath = join(artifactDir, "withdrawal-completion-sandbox-rehearsal.md");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for the withdrawal completion sandbox rehearsal.");
}

const sourceVenue = "POLYMARKET" as const;
const token = "USDC" as const;
const readyAmount = process.env.FUNDING_WITHDRAWAL_REHEARSAL_READY_AMOUNT ?? "100";
const withdrawalAmount = process.env.FUNDING_WITHDRAWAL_REHEARSAL_AMOUNT ?? "40";
const destinationWalletAddress = "0x1111111111111111111111111111111111111111";
const fundingEnv = {
  ...process.env,
  POLYMARKET_FUNDING_DESTINATION_ADDRESS:
    process.env.POLYMARKET_FUNDING_DESTINATION_ADDRESS?.trim() || destinationWalletAddress,
  POLYMARKET_FUNDING_WITHDRAWALS_ENABLED: "true"
} as NodeJS.ProcessEnv;

class SandboxLifiProvider implements LifiRouteProvider {
  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    return {
      provider: "LIFI",
      providerRouteId: `sandbox-withdrawal-completion-seed-route-${randomUUID()}`,
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
        source: "sandbox_withdrawal_completion_lifi_provider",
        status: "DONE",
        substatus: "COMPLETED"
      }
    };
  }
}

class SandboxPolymarketBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public constructor(private readonly usableBalance: string) {}

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    return {
      usableBalance: this.usableBalance,
      raw: {
        source: "sandbox_withdrawal_completion_readiness",
        readOnly: true
      }
    };
  }
}

class SandboxWithdrawalCompletionChecker implements WithdrawalCompletionEvidenceChecker {
  private destinationSeen = false;

  public constructor(private readonly txHash: string) {}

  public async check(): Promise<WithdrawalCompletionEvidenceResult> {
    if (!this.destinationSeen) {
      this.destinationSeen = true;
      return {
        status: "VENUE_RELEASED",
        venueReleased: true,
        destinationReceived: false,
        completed: false,
        withdrawalTxHash: this.txHash,
        reason: "SANDBOX_VENUE_RELEASED",
        evidence: {
          source: "sandbox_withdrawal_completion_checker",
          readOnly: true
        }
      };
    }
    return {
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      withdrawalTxHash: this.txHash,
      destinationChain: "POLYGON",
      destinationWalletAddress,
      token,
      amount: withdrawalAmount,
      reason: "SANDBOX_DESTINATION_CONFIRMED",
      evidence: {
        source: "sandbox_withdrawal_completion_checker",
        readOnly: true,
        confirmationCount: 1
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

const secretCandidates = [
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL,
  process.env.LIFI_API_KEY,
  process.env.POLYMARKET_FUNDING_READ_API_KEY,
  process.env.POLYMARKET_API_KEY,
  process.env.POLYMARKET_API_SECRET,
  process.env.POLYMARKET_PRIVATE_KEY
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const assertRedacted = (payload: unknown): boolean => {
  const serialized = JSON.stringify(payload);
  return !secretCandidates.some((secret) => serialized.includes(secret))
    && !serialized.includes("transactionRequest")
    && !serialized.includes("0x1234")
    && !serialized.toLowerCase().includes("authorization")
    && !serialized.toLowerCase().includes("privatekey")
    && !serialized.toLowerCase().includes("api_key")
    && !serialized.toLowerCase().includes("apikey");
};

const safety = (): WithdrawalCompletionSandboxArtifact["safety"] => ({
  liveLifiExecutionEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  custodyModel: "MODEL_A_NON_CUSTODIAL",
  fundingPreflightEnforcementEnabledByScript: false,
  productionConfigMutated: false
});

const renderMarkdown = (artifact: WithdrawalCompletionSandboxArtifact): string => [
  "# Withdrawal Completion Sandbox Rehearsal",
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  "## Result",
  "",
  `- Status: ${artifact.status}`,
  `- User: ${artifact.userId}`,
  `- Funding intent: ${artifact.fundingIntentId ?? "none"}`,
  `- Withdrawal intent: ${artifact.withdrawalIntentId ?? "none"}`,
  `- Source venue: ${artifact.sourceVenue}`,
  `- Withdrawal amount: ${artifact.withdrawalAmount} ${artifact.token}`,
  `- Withdrawal status: ${artifact.withdrawalStatus ?? "unknown"}`,
  `- Route leg status: ${artifact.routeLegStatus ?? "unknown"}`,
  `- Venue released: ${artifact.venueReleased}`,
  `- Destination received: ${artifact.destinationReceived}`,
  `- Completed: ${artifact.completed}`,
  `- Reconciliation records observed: ${artifact.reconciliationRecordsObserved}`,
  "",
  "## Checks",
  "",
  `- Audit events observed: ${artifact.auditEventsObserved.join(", ") || "none"}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  "",
  "## Safety",
  "",
  `- Live LI.FI execution enabled: ${artifact.safety.liveLifiExecutionEnabled}`,
  `- Live venue withdrawal execution enabled: ${artifact.safety.liveVenueWithdrawalExecutionEnabled}`,
  `- Backend broadcasted transaction: ${artifact.safety.backendBroadcastedTransaction}`,
  `- Backend signed transaction: ${artifact.safety.backendSignedTransaction}`,
  `- Custody model: ${artifact.safety.custodyModel}`,
  `- Funding preflight enforcement enabled by script: ${artifact.safety.fundingPreflightEnforcementEnabledByScript}`,
  `- Production config mutated: ${artifact.safety.productionConfigMutated}`,
  "",
  "This rehearsal uses mocked completion evidence. It does not move real funds."
].join("\n");

const writeArtifacts = async (artifact: WithdrawalCompletionSandboxArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMarkdownPath, `${renderMarkdown(artifact)}\n`, "utf8");
};

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl });
  let artifact: WithdrawalCompletionSandboxArtifact = {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    userId: process.env.FUNDING_WITHDRAWAL_REHEARSAL_USER_ID ?? `sandbox-withdrawal-completion-user-${randomUUID()}`,
    fundingIntentId: null,
    withdrawalIntentId: null,
    sourceVenue,
    token,
    withdrawalAmount,
    fakeSandboxTxHash: null,
    venueReleased: false,
    destinationReceived: false,
    completed: false,
    withdrawalStatus: null,
    routeLegStatus: null,
    reconciliationRecordsObserved: 0,
    auditEventsObserved: [],
    redactionVerified: false,
    safety: safety()
  };

  try {
    await applyFundingMigrations(pool);
    const repository = new FundingRepository(pool);
    const lifi = new SandboxLifiProvider();
    const fundingService = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: fundingEnv
      },
      new Map([[
        sourceVenue,
        new PolymarketFundingReadinessChecker(
          new SandboxPolymarketBalanceReadClient(readyAmount),
          {
            enabled: true,
            mode: "STUB",
            env: fundingEnv
          }
        )
      ]])
    );

    const createdFunding = await fundingService.createIntent(artifact.userId, {
      sourceChain: "SOLANA",
      sourceToken: token,
      sourceAmount: readyAmount,
      sourceWalletAddress: "sandbox-solana-wallet",
      idempotencyKey: `sandbox-withdrawal-completion-funding-${randomUUID()}`,
      targets: [{ targetVenue: sourceVenue, targetPercentage: 100 }]
    });
    artifact = { ...artifact, fundingIntentId: createdFunding.intent.fundingIntentId };
    const quotedFunding = await fundingService.quoteIntent(artifact.userId, createdFunding.intent.fundingIntentId);
    const fundingLeg = quotedFunding.routeLegs[0];
    if (!fundingLeg) {
      throw new Error("Funding seed did not produce a route leg.");
    }
    await fundingService.submitRouteLeg(artifact.userId, createdFunding.intent.fundingIntentId, {
      routeLegId: fundingLeg.routeLegId,
      txHash: fakeTxHash()
    });
    await fundingService.refreshIntentStatus(artifact.userId, createdFunding.intent.fundingIntentId);

    const withdrawalTxHash = fakeTxHash();
    const withdrawalService = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: false,
        env: fundingEnv
      },
      new Map(),
      new SandboxWithdrawalCompletionChecker(withdrawalTxHash)
    );
    const createdWithdrawal = await withdrawalService.createWithdrawalIntent(artifact.userId, {
      token,
      amount: withdrawalAmount,
      destinationChain: "POLYGON",
      destinationWalletAddress,
      idempotencyKey: `sandbox-withdrawal-completion-${randomUUID()}`,
      sources: [{ sourceVenue, sourcePercentage: 100 }]
    });
    artifact = { ...artifact, withdrawalIntentId: createdWithdrawal.intent.withdrawalIntentId };
    const quotedWithdrawal = await withdrawalService.quoteWithdrawalIntent(artifact.userId, createdWithdrawal.intent.withdrawalIntentId);
    const withdrawalLeg = quotedWithdrawal.routeLegs[0];
    if (!withdrawalLeg) {
      throw new Error("Withdrawal quote did not produce a route leg.");
    }
    await withdrawalService.submitWithdrawalRouteLeg(artifact.userId, createdWithdrawal.intent.withdrawalIntentId, {
      withdrawalRouteLegId: withdrawalLeg.withdrawalRouteLegId,
      txHash: withdrawalTxHash
    });
    await withdrawalService.refreshWithdrawalStatus(artifact.userId, createdWithdrawal.intent.withdrawalIntentId);
    const completedView = await withdrawalService.refreshWithdrawalStatus(artifact.userId, createdWithdrawal.intent.withdrawalIntentId);
    const latestReconciliation = completedView.reconciliations[0];
    artifact = {
      ...artifact,
      fakeSandboxTxHash: withdrawalTxHash,
      withdrawalStatus: completedView.intent.status,
      routeLegStatus: completedView.routeLegs[0]?.status ?? null,
      venueReleased: latestReconciliation?.venueReleased ?? false,
      destinationReceived: latestReconciliation?.destinationReceived ?? false,
      completed: latestReconciliation?.completed ?? false,
      reconciliationRecordsObserved: completedView.reconciliations.length
    };

    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type
         FROM funding_withdrawal_audit_events
        WHERE withdrawal_intent_id = $1::uuid
        ORDER BY created_at ASC`,
      [artifact.withdrawalIntentId]
    );
    artifact = {
      ...artifact,
      auditEventsObserved: audit.rows.map((row) => row.event_type)
    };
    const completed = artifact.withdrawalStatus === "COMPLETED"
      && artifact.routeLegStatus === "WITHDRAWAL_LEG_COMPLETED"
      && artifact.venueReleased
      && artifact.destinationReceived
      && artifact.completed
      && artifact.reconciliationRecordsObserved >= 2
      && artifact.auditEventsObserved.includes("WITHDRAWAL_VENUE_RELEASED")
      && artifact.auditEventsObserved.includes("WITHDRAWAL_LEG_COMPLETED")
      && artifact.auditEventsObserved.includes("WITHDRAWAL_COMPLETED");
    const candidateArtifact = {
      ...artifact,
      status: completed ? "COMPLETED" : "FAILED"
    } satisfies WithdrawalCompletionSandboxArtifact;
    const redactedArtifact = {
      ...candidateArtifact,
      redactionVerified: assertRedacted(candidateArtifact)
    };
    await writeArtifacts(redactedArtifact);
    console.log(JSON.stringify({
      status: redactedArtifact.status,
      fundingIntentId: redactedArtifact.fundingIntentId,
      withdrawalIntentId: redactedArtifact.withdrawalIntentId,
      withdrawalStatus: redactedArtifact.withdrawalStatus,
      routeLegStatus: redactedArtifact.routeLegStatus,
      venueReleased: redactedArtifact.venueReleased,
      destinationReceived: redactedArtifact.destinationReceived,
      completed: redactedArtifact.completed,
      reconciliationRecordsObserved: redactedArtifact.reconciliationRecordsObserved,
      redactionVerified: redactedArtifact.redactionVerified,
      artifactJsonPath,
      artifactMarkdownPath
    }, null, 2));
    if (redactedArtifact.status !== "COMPLETED" || !redactedArtifact.redactionVerified) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
};

await main();
