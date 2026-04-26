import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { registerFundingRoutes } from "../../src/api/routes/funding.js";
import { createUserAuthMiddleware } from "../../src/api/user-auth-middleware.js";
import { FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote } from "../../src/core/funding/types.js";
import {
  PolymarketFundingReadinessChecker,
  type PolymarketFundingBalanceReadClient
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

interface WithdrawalSandboxRehearsalArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: "COMPLETED" | "FAILED";
  userId: string;
  fundingIntentId: string | null;
  withdrawalIntentId: string | null;
  sourceVenue: "POLYMARKET";
  token: "USDC";
  readyAmountBefore: string | null;
  withdrawalAmount: string;
  availableAmountAfter: string | null;
  withdrawalStatus: string | null;
  routeLegStatus: string | null;
  fakeSandboxTxHash: string | null;
  auditEventsObserved: string[];
  crossUserReadBlocked: boolean;
  insufficientBalanceBlocked: boolean;
  duplicateSourceVenueBlocked: boolean;
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
const artifactJsonPath = join(artifactDir, "withdrawal-sandbox-rehearsal.json");
const artifactMarkdownPath = join(artifactDir, "withdrawal-sandbox-rehearsal.md");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for the withdrawal sandbox rehearsal.");
}

const sourceVenue = "POLYMARKET" as const;
const token = "USDC" as const;
const readyAmount = process.env.FUNDING_WITHDRAWAL_REHEARSAL_READY_AMOUNT ?? "100";
const withdrawalAmount = process.env.FUNDING_WITHDRAWAL_REHEARSAL_AMOUNT ?? "40";
const fundingEnv = {
  ...process.env,
  POLYMARKET_FUNDING_DESTINATION_ADDRESS:
    process.env.POLYMARKET_FUNDING_DESTINATION_ADDRESS?.trim() || "0x1111111111111111111111111111111111111111",
  POLYMARKET_FUNDING_WITHDRAWALS_ENABLED: "true"
} as NodeJS.ProcessEnv;

class SandboxLifiProvider implements LifiRouteProvider {
  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    return {
      provider: "LIFI",
      providerRouteId: `sandbox-withdrawal-seed-route-${randomUUID()}`,
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
        source: "sandbox_withdrawal_seed_lifi_provider",
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
        source: "sandbox_withdrawal_rehearsal_readiness",
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

const buildUserFundingApp = async (fundingService: FundingService) => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "withdrawal-sandbox-rehearsal-secret" });
  await registerFundingRoutes(app, createUserAuthMiddleware(), {
    createIntent: (userId, request) => fundingService.createIntent(userId, request),
    getIntent: (userId, fundingIntentId) => fundingService.getIntent(userId, fundingIntentId),
    quoteIntent: (userId, fundingIntentId) => fundingService.quoteIntent(userId, fundingIntentId),
    submitRouteLeg: (userId, fundingIntentId, request) => fundingService.submitRouteLeg(userId, fundingIntentId, request),
    refreshIntentStatus: (userId, fundingIntentId) => fundingService.refreshIntentStatus(userId, fundingIntentId),
    listVenueCapabilities: async () => fundingService.listVenueCapabilities(),
    listVenueBalances: (userId) => fundingService.listVenueBalances(userId),
    createWithdrawalIntent: (userId, request) => fundingService.createWithdrawalIntent(userId, request),
    getWithdrawalIntent: (userId, withdrawalIntentId) => fundingService.getWithdrawalIntent(userId, withdrawalIntentId),
    quoteWithdrawalIntent: (userId, withdrawalIntentId) => fundingService.quoteWithdrawalIntent(userId, withdrawalIntentId),
    submitWithdrawalRouteLeg: (userId, withdrawalIntentId, request) =>
      fundingService.submitWithdrawalRouteLeg(userId, withdrawalIntentId, request),
    refreshWithdrawalStatus: (userId, withdrawalIntentId) => fundingService.refreshWithdrawalStatus(userId, withdrawalIntentId)
  });
  return app;
};

const secretCandidates = [
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL,
  process.env.LIFI_API_KEY,
  process.env.POLYMARKET_FUNDING_READ_API_KEY,
  process.env.POLYMARKET_API_KEY,
  process.env.POLYMARKET_API_SECRET,
  process.env.POLYMARKET_PRIVATE_KEY,
  process.env.POLY_API_KEY,
  process.env.POLY_API_SECRET,
  process.env.POLY_PRIVATE_KEY
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const assertRedacted = (payload: unknown): boolean => {
  const serialized = JSON.stringify(payload);
  return !secretCandidates.some((secret) => serialized.includes(secret))
    && !serialized.includes("transactionRequest")
    && !serialized.toLowerCase().includes("authorization")
    && !serialized.toLowerCase().includes("privatekey")
    && !serialized.toLowerCase().includes("api_key")
    && !serialized.toLowerCase().includes("apikey");
};

const safety = (): WithdrawalSandboxRehearsalArtifact["safety"] => ({
  liveLifiExecutionEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  custodyModel: "MODEL_A_NON_CUSTODIAL",
  fundingPreflightEnforcementEnabledByScript: false,
  productionConfigMutated: false
});

const renderMarkdown = (artifact: WithdrawalSandboxRehearsalArtifact): string => [
  "# Withdrawal Sandbox Rehearsal",
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
  `- Ready amount before: ${artifact.readyAmountBefore ?? "unknown"} ${artifact.token}`,
  `- Withdrawal amount: ${artifact.withdrawalAmount} ${artifact.token}`,
  `- Available amount after: ${artifact.availableAmountAfter ?? "unknown"} ${artifact.token}`,
  `- Withdrawal status: ${artifact.withdrawalStatus ?? "unknown"}`,
  `- Route leg status: ${artifact.routeLegStatus ?? "unknown"}`,
  "",
  "## Checks",
  "",
  `- Audit events observed: ${artifact.auditEventsObserved.join(", ") || "none"}`,
  `- Cross-user read blocked: ${artifact.crossUserReadBlocked}`,
  `- Insufficient balance blocked: ${artifact.insufficientBalanceBlocked}`,
  `- Duplicate source venue blocked: ${artifact.duplicateSourceVenueBlocked}`,
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
  "This rehearsal leaves sandbox DB rows persisted for operator inspection. It does not move real funds."
].join("\n");

const writeArtifacts = async (artifact: WithdrawalSandboxRehearsalArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMarkdownPath, `${renderMarkdown(artifact)}\n`, "utf8");
};

const fakeTxHash = (): string => `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66);

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl });
  let artifact: WithdrawalSandboxRehearsalArtifact = {
    artifactSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "FAILED",
    userId: process.env.FUNDING_WITHDRAWAL_REHEARSAL_USER_ID ?? `sandbox-withdrawal-user-${randomUUID()}`,
    fundingIntentId: null,
    withdrawalIntentId: null,
    sourceVenue,
    token,
    readyAmountBefore: null,
    withdrawalAmount,
    availableAmountAfter: null,
    withdrawalStatus: null,
    routeLegStatus: null,
    fakeSandboxTxHash: null,
    auditEventsObserved: [],
    crossUserReadBlocked: false,
    insufficientBalanceBlocked: false,
    duplicateSourceVenueBlocked: false,
    redactionVerified: false,
    safety: safety()
  };

  try {
    await applyFundingMigrations(pool);
    const repository = new FundingRepository(pool);
    const lifi = new SandboxLifiProvider();
    const service = new FundingService(
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

    const createdFunding = await service.createIntent(artifact.userId, {
      sourceChain: "SOLANA",
      sourceToken: token,
      sourceAmount: readyAmount,
      sourceWalletAddress: "sandbox-solana-wallet",
      idempotencyKey: `sandbox-withdrawal-funding-${randomUUID()}`,
      targets: [{ targetVenue: sourceVenue, targetPercentage: 100 }]
    });
    artifact = { ...artifact, fundingIntentId: createdFunding.intent.fundingIntentId };
    const quotedFunding = await service.quoteIntent(artifact.userId, createdFunding.intent.fundingIntentId);
    const fundingLeg = quotedFunding.routeLegs[0];
    if (!fundingLeg) {
      throw new Error("Funding seed did not produce a route leg.");
    }
    await service.submitRouteLeg(artifact.userId, createdFunding.intent.fundingIntentId, {
      routeLegId: fundingLeg.routeLegId,
      txHash: fakeTxHash()
    });
    await service.refreshIntentStatus(artifact.userId, createdFunding.intent.fundingIntentId);

    const app = await buildUserFundingApp(service);
    try {
      const tokenHeader = app.jwt.sign({ userId: artifact.userId, role: "USER" });
      const otherUserToken = app.jwt.sign({ userId: `other-${randomUUID()}`, role: "USER" });
      const headers = { authorization: `Bearer ${tokenHeader}` };

      const balancesBefore = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
      if (balancesBefore.statusCode !== 200) {
        throw new Error(`Venue balance read failed with ${balancesBefore.statusCode}.`);
      }
      const readyBalance = (balancesBefore.json() as { balances: Array<{ venue: string; token: string; readyAmount: string }> })
        .balances.find((row) => row.venue === sourceVenue && row.token === token);
      artifact = { ...artifact, readyAmountBefore: readyBalance?.readyAmount ?? null };

      const createdWithdrawal = await app.inject({
        method: "POST",
        url: "/funding/withdrawals",
        headers,
        payload: {
          token,
          amount: withdrawalAmount,
          destinationChain: "POLYGON",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          idempotencyKey: `sandbox-withdrawal-${randomUUID()}`,
          sources: [{ sourceVenue, sourcePercentage: 100 }]
        }
      });
      if (createdWithdrawal.statusCode !== 201) {
        throw new Error(`Withdrawal create failed with ${createdWithdrawal.statusCode}: ${createdWithdrawal.body}`);
      }
      const createdWithdrawalBody = createdWithdrawal.json() as { withdrawalIntentId: string; currentStatus: string };
      artifact = {
        ...artifact,
        withdrawalIntentId: createdWithdrawalBody.withdrawalIntentId,
        withdrawalStatus: createdWithdrawalBody.currentStatus
      };

      const crossUserRead = await app.inject({
        method: "GET",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}`,
        headers: { authorization: `Bearer ${otherUserToken}` }
      });
      artifact = { ...artifact, crossUserReadBlocked: crossUserRead.statusCode === 403 };

      const quotedWithdrawal = await app.inject({
        method: "POST",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/quote`,
        headers
      });
      if (quotedWithdrawal.statusCode !== 200) {
        throw new Error(`Withdrawal quote failed with ${quotedWithdrawal.statusCode}: ${quotedWithdrawal.body}`);
      }
      const quotedWithdrawalBody = quotedWithdrawal.json() as {
        currentStatus: string;
        routeLegs: Array<{ withdrawalRouteLegId: string; routeQuote: { transactionRequest: unknown }; status: string }>;
      };
      if (quotedWithdrawalBody.routeLegs[0]?.routeQuote.transactionRequest !== null) {
        throw new Error("Withdrawal quote exposed a transaction request.");
      }
      const withdrawalLeg = quotedWithdrawalBody.routeLegs[0];
      if (!withdrawalLeg) {
        throw new Error("Withdrawal quote did not produce a route leg.");
      }

      const withdrawalTxHash = fakeTxHash();
      const submittedWithdrawal = await app.inject({
        method: "POST",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/submit`,
        headers,
        payload: {
          withdrawalRouteLegId: withdrawalLeg.withdrawalRouteLegId,
          txHash: withdrawalTxHash
        }
      });
      if (submittedWithdrawal.statusCode !== 202) {
        throw new Error(`Withdrawal submit failed with ${submittedWithdrawal.statusCode}: ${submittedWithdrawal.body}`);
      }
      const submittedWithdrawalBody = submittedWithdrawal.json() as {
        currentStatus: string;
        routeLegs: Array<{ status: string }>;
      };
      artifact = {
        ...artifact,
        fakeSandboxTxHash: withdrawalTxHash,
        withdrawalStatus: submittedWithdrawalBody.currentStatus,
        routeLegStatus: submittedWithdrawalBody.routeLegs[0]?.status ?? null
      };

      const status = await app.inject({
        method: "GET",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/status`,
        headers
      });
      if (status.statusCode !== 200) {
        throw new Error(`Withdrawal status failed with ${status.statusCode}: ${status.body}`);
      }

      const balancesAfter = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
      if (balancesAfter.statusCode !== 200) {
        throw new Error(`Venue balance read after withdrawal failed with ${balancesAfter.statusCode}.`);
      }
      const balanceAfter = (balancesAfter.json() as { balances: Array<{ venue: string; token: string; availableAmount: string }> })
        .balances.find((row) => row.venue === sourceVenue && row.token === token);
      artifact = { ...artifact, availableAmountAfter: balanceAfter?.availableAmount ?? null };

      const insufficientBalance = await app.inject({
        method: "POST",
        url: "/funding/withdrawals",
        headers,
        payload: {
          token,
          amount: "70",
          destinationChain: "POLYGON",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          idempotencyKey: `sandbox-withdrawal-insufficient-${randomUUID()}`,
          sources: [{ sourceVenue, sourcePercentage: 100 }]
        }
      });
      artifact = { ...artifact, insufficientBalanceBlocked: insufficientBalance.statusCode === 409 };

      const duplicateSource = await app.inject({
        method: "POST",
        url: "/funding/withdrawals",
        headers,
        payload: {
          token,
          amount: "10",
          destinationChain: "POLYGON",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          idempotencyKey: `sandbox-withdrawal-duplicate-${randomUUID()}`,
          sources: [
            { sourceVenue, sourcePercentage: 50 },
            { sourceVenue, sourcePercentage: 50 }
          ]
        }
      });
      artifact = { ...artifact, duplicateSourceVenueBlocked: duplicateSource.statusCode === 400 };
    } finally {
      await app.close();
    }

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
    const expectedAuditEvents = [
      "WITHDRAWAL_INTENT_CREATED",
      "WITHDRAWAL_ROUTES_QUOTED",
      "WITHDRAWAL_USER_SIGNATURE_REQUIRED",
      "WITHDRAWAL_LEG_SUBMITTED"
    ];
    const completed = artifact.withdrawalStatus === "WITHDRAWING"
      && artifact.routeLegStatus === "VENUE_RELEASE_PENDING"
      && artifact.crossUserReadBlocked
      && artifact.insufficientBalanceBlocked
      && artifact.duplicateSourceVenueBlocked
      && expectedAuditEvents.every((event) => artifact.auditEventsObserved.includes(event))
      && artifact.readyAmountBefore === readyAmount
      && artifact.availableAmountAfter === String(Number(readyAmount) - Number(withdrawalAmount));
    const candidateArtifact = {
      ...artifact,
      status: completed ? "COMPLETED" : "FAILED"
    } satisfies WithdrawalSandboxRehearsalArtifact;
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
      crossUserReadBlocked: redactedArtifact.crossUserReadBlocked,
      insufficientBalanceBlocked: redactedArtifact.insufficientBalanceBlocked,
      duplicateSourceVenueBlocked: redactedArtifact.duplicateSourceVenueBlocked,
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
