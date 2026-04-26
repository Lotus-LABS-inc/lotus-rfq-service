import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import type { ExecutionScopeBinding } from "../../src/execution-control/execution-scope-token.js";
import {
  ApprovedLaneExecutionGate,
  ExecutionPreflightService,
  StaticLaneAuthorityResolver,
  type ExecutionLaneAuthoritySnapshot,
  type ExecutionRequestV0,
  zeroFees
} from "../../src/execution-system/index.js";
import { FundingReadinessChecker, FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote } from "../../src/core/funding/types.js";
import {
  PolymarketFundingReadinessChecker,
  type PolymarketFundingBalanceReadClient
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "polymarket-readiness-sandbox-preflight.json");
const artifactMarkdownPath = join(artifactDir, "polymarket-readiness-sandbox-preflight.md");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for the sandbox funding readiness preflight run.");
}

const fundingEnv = {
  ...process.env,
  POLYMARKET_FUNDING_DESTINATION_ADDRESS:
    process.env.POLYMARKET_FUNDING_DESTINATION_ADDRESS?.trim() || "0x1111111111111111111111111111111111111111"
} as NodeJS.ProcessEnv;

class SandboxLifiProvider implements LifiRouteProvider {
  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    return {
      provider: "LIFI",
      providerRouteId: `sandbox-route-${randomUUID()}`,
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
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        chainId: Number(input.toChain)
      },
      userSafeSummary: "Sandbox LI.FI route preview. Lotus does not sign or broadcast this transaction."
    };
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    return {
      status: "DONE_COMPLETED",
      raw: {
        source: "sandbox_lifi_provider",
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
        source: "sandbox_polymarket_readiness",
        readOnly: true
      }
    };
  }
}

const lane: ExecutionLaneAuthoritySnapshot = {
  laneId: "CRYPTO_BTC_ATH_BY_DATE_SINGLE_POLYMARKET",
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: ["POLYMARKET"],
  candidateSet: ["2026-05-31"],
  ruleState: "EXACT_SAFE"
};

const scopeBinding: ExecutionScopeBinding = {
  scopeKind: "CRYPTO_LANE",
  scopeId: lane.laneId,
  topicKey: lane.topicKey,
  laneType: "SINGLE",
  venueSet: lane.venueSet,
  candidateSet: lane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

const buildExecutionRequest = (input: {
  userId: string;
  executionSize: string;
}): ExecutionRequestV0 => ({
  executionId: `execution-${randomUUID()}`,
  rfqId: `rfq-${randomUUID()}`,
  userId: input.userId,
  canonicalTopicKey: lane.topicKey,
  candidateId: "2026-05-31",
  side: "buy",
  size: input.executionSize,
  selectedLaneId: lane.laneId,
  venuePath: ["POLYMARKET"],
  executionMode: "SINGLE_VENUE",
  approvedScopeHash: "sandbox-scope-hash",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: `sandbox-funding-preflight-${randomUUID()}`,
  createdAt: new Date().toISOString()
});

const buildExecutionPreflight = (checker: FundingReadinessChecker): ExecutionPreflightService =>
  new ExecutionPreflightService({
    laneGate: new ApprovedLaneExecutionGate(new StaticLaneAuthorityResolver(new Map([[lane.laneId, lane]]))),
    venueHealth: { isVenueHealthy: async () => true },
    marketState: {
      isMarketOpen: async () => true,
      isOutcomePresent: async () => true
    },
    liquidity: { hasLiquidity: async () => true },
    funding: checker,
    idempotency: { isAlreadyCompleted: async () => false },
    price: { isWithinSlippage: async () => true }
  });

const applyFundingMigration = async (pool: Pool): Promise<void> => {
  const sql = await readFile(
    resolve(process.cwd(), "sql", "migrations", "2026_04_25_create_funding_flow_v0_tables.sql"),
    "utf8"
  );
  await pool.query(sql);
};

const secretCandidates = [
  process.env.LIFI_API_KEY,
  process.env.POLYMARKET_FUNDING_READ_API_KEY,
  process.env.POLY_API_KEY,
  process.env.POLY_API_SECRET,
  process.env.POLY_API_PASSPHRASE,
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const assertRedacted = (payload: unknown): boolean => {
  const serialized = JSON.stringify(payload);
  return !secretCandidates.some((secret) => serialized.includes(secret))
    && !serialized.includes("transactionRequest")
    && !serialized.toLowerCase().includes("authorization")
    && !serialized.toLowerCase().includes("privatekey");
};

const renderMarkdown = (artifact: Record<string, unknown>): string => [
  "# Polymarket Funding Readiness Sandbox Preflight",
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  "## Result",
  "",
  `- Status: ${artifact.status}`,
  `- Funding intent: ${artifact.fundingIntentId}`,
  `- Route leg: ${artifact.routeLegId}`,
  `- Reconciliation persisted: ${artifact.persistedReadinessResult}`,
  `- RFQ accept preflight passed: ${(artifact.rfqAcceptPreflight as { ok?: boolean }).ok === true}`,
  "",
  "## Safety",
  "",
  `- Read-only LI.FI execution: ${artifact.liveLifiExecutionEnabled === false}`,
  `- Backend broadcast: ${artifact.backendBroadcastedTransaction === true ? "true" : "false"}`,
  `- Default funding enforcement enabled: ${artifact.defaultFundingPreflightEnforcementEnabled === true}`,
  `- Script-scoped funding enforcement enabled: ${artifact.scriptScopedFundingPreflightEnforcementEnabled === true}`,
  `- Redaction verified: ${artifact.redactionVerified === true}`,
  "",
  "This script leaves the seeded funding row persisted for operator inspection."
].join("\n");

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await applyFundingMigration(pool);
    const repository = new FundingRepository(pool);
    const userId = process.env.FUNDING_SANDBOX_PREFLIGHT_USER_ID ?? `sandbox-funding-user-${randomUUID()}`;
    const sourceAmount = process.env.FUNDING_SANDBOX_PREFLIGHT_AMOUNT ?? "100";
    const executionSize = process.env.FUNDING_SANDBOX_PREFLIGHT_EXECUTION_SIZE ?? "10";
    const txHash = `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66);

    const service = new FundingService(
      repository,
      new SandboxLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: fundingEnv
      },
      new Map([[
        "POLYMARKET",
        new PolymarketFundingReadinessChecker(
          new SandboxPolymarketBalanceReadClient(sourceAmount),
          {
            enabled: true,
            mode: "STUB",
            env: fundingEnv
          }
        )
      ]])
    );

    const created = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount,
      sourceWalletAddress: "sandbox-solana-wallet",
      idempotencyKey: `sandbox-polymarket-readiness-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
    const routeLeg = quoted.routeLegs[0];
    if (!routeLeg) {
      throw new Error("Funding quote did not create a route leg.");
    }
    await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
      routeLegId: routeLeg.routeLegId,
      txHash
    });
    const reconciled = await service.refreshIntentStatus(userId, created.intent.fundingIntentId);
    const latestLeg = reconciled.routeLegs.find((leg) => leg.routeLegId === routeLeg.routeLegId);
    const latestReconciliation = reconciled.reconciliations.find((row) => row.routeLegId === routeLeg.routeLegId);

    const adminService = new FundingReadinessAdminService({
      repository,
      env: {
        ...process.env,
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true",
        POLYMARKET_FUNDING_READINESS_ENABLED: "true",
        POLYMARKET_FUNDING_READINESS_MODE: "STUB"
      } as NodeJS.ProcessEnv
    });
    const readinessRows = await adminService.listByIntent(created.intent.fundingIntentId);
    const summary = await adminService.getSummary();

    const request = buildExecutionRequest({ userId, executionSize });
    const preflight = buildExecutionPreflight(new FundingReadinessChecker(service, true));
    const rfqAcceptPreflight = await preflight.evaluate({ request, scopeBinding });

    const artifact = {
      generatedAt: new Date().toISOString(),
      status: latestReconciliation?.readyToTrade && rfqAcceptPreflight.ok ? "COMPLETED" : "FAILED",
      fundingIntentId: created.intent.fundingIntentId,
      routeLegId: routeLeg.routeLegId,
      userId,
      targetVenue: "POLYMARKET",
      sourceAmount,
      executionSize,
      fundingIntentStatus: reconciled.intent.status,
      routeLegStatus: latestLeg?.status ?? null,
      destinationStatus: latestLeg?.destinationStatus ?? null,
      venueCreditStatus: latestLeg?.venueCreditStatus ?? null,
      readinessReason: latestReconciliation?.notes ?? null,
      persistedReadinessResult: latestReconciliation?.readyToTrade === true,
      adminReadinessVisible: readinessRows.some((row) => row.routeLegId === routeLeg.routeLegId && row.readyToTrade === true),
      summaryReadyToTradeCount: summary.readyToTrade,
      rfqAcceptPreflight,
      defaultFundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
      scriptScopedFundingPreflightEnforcementEnabled: true,
      liveLifiExecutionEnabled: false,
      backendBroadcastedTransaction: false,
      lifiProvider: "SANDBOX_MOCK",
      polymarketCheckerMode: "STUB",
      redactionVerified: false,
      auditEventIds: readinessRows[0]?.auditEventIds ?? []
    };
    const redactedArtifact = {
      ...artifact,
      redactionVerified: assertRedacted(artifact)
    };
    if (!redactedArtifact.redactionVerified) {
      throw new Error("Sandbox preflight artifact failed redaction verification.");
    }

    await mkdir(artifactDir, { recursive: true });
    await writeFile(artifactJsonPath, `${JSON.stringify(redactedArtifact, null, 2)}\n`, "utf8");
    await writeFile(artifactMarkdownPath, renderMarkdown(redactedArtifact), "utf8");
    console.log(JSON.stringify({
      status: redactedArtifact.status,
      fundingIntentId: redactedArtifact.fundingIntentId,
      routeLegId: redactedArtifact.routeLegId,
      persistedReadinessResult: redactedArtifact.persistedReadinessResult,
      rfqAcceptPreflight: redactedArtifact.rfqAcceptPreflight,
      artifactJsonPath,
      artifactMarkdownPath
    }, null, 2));
  } finally {
    await pool.end();
  }
};

await main();
