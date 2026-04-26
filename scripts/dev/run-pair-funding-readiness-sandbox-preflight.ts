import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import { FundingReadinessChecker, FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteLeg, FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import {
  buildFundingVenueReadinessCheckersFromEnv,
  type VenueFundingReadinessChecker
} from "../../src/core/funding/venue-readiness.js";
import type { ExecutionScopeBinding } from "../../src/execution-control/execution-scope-token.js";
import {
  ApprovedLaneExecutionGate,
  ExecutionPreflightService,
  StaticLaneAuthorityResolver,
  type ExecutionLaneAuthoritySnapshot,
  type ExecutionRequestV0,
  zeroFees
} from "../../src/execution-system/index.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactJsonPath = join(artifactDir, "pair-funding-readiness-sandbox-preflight.json");
const artifactMarkdownPath = join(artifactDir, "pair-funding-readiness-sandbox-preflight.md");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for the pair funding readiness preflight run.");
}

const pairLane: ExecutionLaneAuthoritySnapshot = {
  laneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: ["LIMITLESS", "POLYMARKET"],
  candidateSet: ["2026-05-31"],
  ruleState: "EXACT_SAFE"
};

const scopeBinding: ExecutionScopeBinding = {
  scopeKind: "CRYPTO_LANE",
  scopeId: pairLane.laneId,
  topicKey: pairLane.topicKey,
  laneType: "PAIR",
  venueSet: pairLane.venueSet,
  candidateSet: pairLane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

class SandboxLifiProvider implements LifiRouteProvider {
  public quoteCalls = 0;
  public statusCalls = 0;

  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    this.quoteCalls += 1;
    return {
      provider: "LIFI",
      providerRouteId: `sandbox-pair-route-${randomUUID()}`,
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
      userSafeSummary: `Sandbox LI.FI route preview for ${input.targetVenue}. Lotus does not sign or broadcast this transaction.`
    };
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    this.statusCalls += 1;
    return {
      status: "DONE_COMPLETED",
      raw: {
        source: "sandbox_pair_lifi_provider",
        status: "DONE",
        substatus: "COMPLETED"
      }
    };
  }
}

const buildExecutionRequest = (input: { userId: string; executionSize: string }): ExecutionRequestV0 => ({
  executionId: `execution-${randomUUID()}`,
  rfqId: `rfq-${randomUUID()}`,
  userId: input.userId,
  canonicalTopicKey: pairLane.topicKey,
  candidateId: "2026-05-31",
  side: "buy",
  size: input.executionSize,
  selectedLaneId: pairLane.laneId,
  venuePath: ["LIMITLESS", "POLYMARKET"],
  executionMode: "PAIR",
  approvedScopeHash: "sandbox-pair-scope-hash",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: `sandbox-pair-funding-preflight-${randomUUID()}`,
  createdAt: new Date().toISOString()
});

const buildExecutionPreflight = (checker: FundingReadinessChecker): ExecutionPreflightService =>
  new ExecutionPreflightService({
    laneGate: new ApprovedLaneExecutionGate(new StaticLaneAuthorityResolver(new Map([[pairLane.laneId, pairLane]]))),
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

const requiredReadinessEnv = [
  "POLYMARKET_FUNDING_DESTINATION_ADDRESS",
  "POLYMARKET_FUNDING_READINESS_MODE",
  "POLYMARKET_FUNDING_BALANCE_URL",
  "LIMITLESS_FUNDING_DESTINATION_ADDRESS",
  "LIMITLESS_FUNDING_READINESS_MODE",
  "LIMITLESS_FUNDING_BALANCE_URL"
] as const;

const readinessBlockers = (): string[] => {
  const missing = requiredReadinessEnv
    .filter((key) => !process.env[key]?.trim())
    .map((key) => `${key} is required.`);
  const wrongModes = [
    process.env.POLYMARKET_FUNDING_READINESS_MODE !== "LIVE_READ"
      ? "POLYMARKET_FUNDING_READINESS_MODE must be LIVE_READ."
      : null,
    process.env.LIMITLESS_FUNDING_READINESS_MODE !== "LIVE_READ"
      ? "LIMITLESS_FUNDING_READINESS_MODE must be LIVE_READ."
      : null
  ].filter((value): value is string => Boolean(value));
  return [...missing, ...wrongModes];
};

const readinessCheckers = (): ReadonlyMap<FundingVenue, VenueFundingReadinessChecker> =>
  buildFundingVenueReadinessCheckersFromEnv({
    ...process.env,
    FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true"
  } as NodeJS.ProcessEnv);

const secretCandidates = [
  process.env.LIFI_API_KEY,
  process.env.POLYMARKET_FUNDING_READ_API_KEY,
  process.env.LIMITLESS_FUNDING_READ_API_KEY,
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

const safeLegSummary = (leg: FundingRouteLeg | undefined) => ({
  routeLegId: leg?.routeLegId ?? null,
  targetVenue: leg?.targetVenue ?? null,
  routeLegStatus: leg?.status ?? null,
  destinationStatus: leg?.destinationStatus ?? null,
  venueCreditStatus: leg?.venueCreditStatus ?? null,
  destinationAmountEstimate: leg?.destinationAmountEstimate ?? null
});

const renderMarkdown = (artifact: PairRehearsalArtifact): string => [
  "# Pair Funding Readiness Sandbox Preflight",
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  "## Result",
  "",
  `- Status: ${artifact.status}`,
  `- Lane: ${artifact.sandboxLane.laneId}`,
  `- Venue path: ${artifact.sandboxLane.venuePath.join(", ")}`,
  `- Funding intent: ${artifact.fundingIntentId}`,
  `- Persisted readiness rows: ${artifact.persistedReadinessRows}`,
  `- Preflight passed: ${artifact.executionPreflight.ok}`,
  "",
  "## Venue Evidence",
  "",
  ...artifact.venueEvidence.map((venue) =>
    `- ${venue.targetVenue}: ${venue.readyToTrade ? "READY_TO_TRADE" : "NOT_READY"} (${venue.reason ?? "no reason"})`
  ),
  "",
  "## Safety",
  "",
  `- Script-scoped funding enforcement only: ${artifact.safety.scriptScopedFundingPreflightEnforcementOnly}`,
  `- Default funding enforcement enabled: ${artifact.safety.defaultFundingPreflightEnforcementEnabled}`,
  `- Live LI.FI execution enabled: ${artifact.safety.liveLifiExecutionEnabled}`,
  `- Backend broadcasted transaction: ${artifact.safety.backendBroadcastedTransaction}`,
  `- Live venue submission enabled: ${artifact.safety.liveVenueSubmissionEnabled}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  "",
  "This script leaves the seeded pair funding rows persisted for operator inspection."
].join("\n");

interface PairRehearsalArtifact {
  generatedAt: string;
  status: "COMPLETED" | "FAILED" | "REFUSED_CONFIG_INCOMPLETE";
  blockers: string[];
  sandboxLane: {
    laneId: string;
    laneState: string;
    venuePath: string[];
    scopeKind: string;
  };
  fundingIntentId: string | null;
  userId: string | null;
  sourceAmount: string;
  executionSize: string;
  routeLegs: Array<ReturnType<typeof safeLegSummary>>;
  venueEvidence: Array<{
    targetVenue: string;
    readyToTrade: boolean;
    destinationReceived: boolean | null;
    venueCreditConfirmed: boolean | null;
    reason: string | null;
  }>;
  persistedReadinessRows: number;
  adminReadinessVisible: boolean;
  summaryReadyToTradeCount: number;
  lifiQuoteCalls: number;
  lifiStatusCalls: number;
  executionPreflight: { ok: boolean; reason?: string; code?: string };
  safety: {
    defaultFundingPreflightEnforcementEnabled: boolean;
    scriptScopedFundingPreflightEnforcementOnly: boolean;
    liveLifiExecutionEnabled: boolean;
    backendBroadcastedTransaction: boolean;
    liveVenueSubmissionEnabled: boolean;
  };
  redactionVerified: boolean;
}

const main = async (): Promise<void> => {
  const sourceAmount = process.env.FUNDING_PAIR_REHEARSAL_AMOUNT ?? "100";
  const executionSize = process.env.FUNDING_PAIR_REHEARSAL_EXECUTION_SIZE ?? "10";
  const blockers = readinessBlockers();
  if (blockers.length > 0) {
    const artifact: PairRehearsalArtifact = {
      generatedAt: new Date().toISOString(),
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers,
      sandboxLane: {
        laneId: pairLane.laneId,
        laneState: pairLane.laneState,
        venuePath: pairLane.venueSet,
        scopeKind: scopeBinding.scopeKind
      },
      fundingIntentId: null,
      userId: null,
      sourceAmount,
      executionSize,
      routeLegs: [],
      venueEvidence: [],
      persistedReadinessRows: 0,
      adminReadinessVisible: false,
      summaryReadyToTradeCount: 0,
      lifiQuoteCalls: 0,
      lifiStatusCalls: 0,
      executionPreflight: { ok: false, code: "CONFIG_INCOMPLETE", reason: "Required pair readiness env is missing." },
      safety: baseSafety(),
      redactionVerified: false
    };
    await writeArtifacts({ ...artifact, redactionVerified: assertRedacted(artifact) });
    console.log(`status=${artifact.status} blockers=${blockers.join(" | ")}`);
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await applyFundingMigration(pool);
    const repository = new FundingRepository(pool);
    const userId = process.env.FUNDING_PAIR_REHEARSAL_USER_ID ?? `sandbox-pair-funding-user-${randomUUID()}`;
    const lifi = new SandboxLifiProvider();
    const service = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: process.env
      },
      readinessCheckers()
    );

    const created = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount,
      sourceWalletAddress: "sandbox-solana-wallet",
      idempotencyKey: `sandbox-pair-readiness-${randomUUID()}`,
      targets: [
        { targetVenue: "LIMITLESS", targetPercentage: 50 },
        { targetVenue: "POLYMARKET", targetPercentage: 50 }
      ]
    });
    const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
    for (const leg of quoted.routeLegs) {
      await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
        routeLegId: leg.routeLegId,
        txHash: `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66)
      });
    }

    const reconciled = await service.refreshIntentStatus(userId, created.intent.fundingIntentId);
    const adminService = new FundingReadinessAdminService({
      repository,
      env: {
        ...process.env,
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true"
      } as NodeJS.ProcessEnv
    });
    const readinessRows = await adminService.listByIntent(created.intent.fundingIntentId);
    const summary = await adminService.getSummary();
    const request = buildExecutionRequest({ userId, executionSize });
    const preflight = buildExecutionPreflight(new FundingReadinessChecker(service, true));
    const executionPreflight = await preflight.evaluate({ request, scopeBinding });

    const venueEvidence = readinessRows.map((row) => ({
      targetVenue: row.targetVenue,
      readyToTrade: row.readyToTrade === true,
      destinationReceived: row.destinationReceived,
      venueCreditConfirmed: row.venueCreditConfirmed,
      reason: row.reasonNotReady ?? row.reconciliationNotes
    }));
    const persistedReadyRows = readinessRows.filter((row) => row.readyToTrade === true).length;
    const artifact: PairRehearsalArtifact = {
      generatedAt: new Date().toISOString(),
      status: persistedReadyRows === 2 && executionPreflight.ok ? "COMPLETED" : "FAILED",
      blockers: [],
      sandboxLane: {
        laneId: pairLane.laneId,
        laneState: pairLane.laneState,
        venuePath: pairLane.venueSet,
        scopeKind: scopeBinding.scopeKind
      },
      fundingIntentId: created.intent.fundingIntentId,
      userId,
      sourceAmount,
      executionSize,
      routeLegs: reconciled.routeLegs.map(safeLegSummary),
      venueEvidence,
      persistedReadinessRows: persistedReadyRows,
      adminReadinessVisible: persistedReadyRows === 2,
      summaryReadyToTradeCount: summary.readyToTrade,
      lifiQuoteCalls: lifi.quoteCalls,
      lifiStatusCalls: lifi.statusCalls,
      executionPreflight,
      safety: baseSafety(),
      redactionVerified: false
    };
    await writeArtifacts({ ...artifact, redactionVerified: assertRedacted(artifact) });
    console.log(JSON.stringify({
      status: artifact.status,
      fundingIntentId: artifact.fundingIntentId,
      persistedReadinessRows: artifact.persistedReadinessRows,
      executionPreflight: artifact.executionPreflight,
      artifactJsonPath,
      artifactMarkdownPath
    }, null, 2));
  } finally {
    await pool.end();
  }
};

const baseSafety = (): PairRehearsalArtifact["safety"] => ({
  defaultFundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
  scriptScopedFundingPreflightEnforcementOnly: true,
  liveLifiExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  liveVenueSubmissionEnabled: false
});

const writeArtifacts = async (artifact: PairRehearsalArtifact): Promise<void> => {
  if (!artifact.redactionVerified) {
    throw new Error("Pair funding rehearsal artifact failed redaction verification.");
  }
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMarkdownPath, renderMarkdown(artifact), "utf8");
};

await main();
