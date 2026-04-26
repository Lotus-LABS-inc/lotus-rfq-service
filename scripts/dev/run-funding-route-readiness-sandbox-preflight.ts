import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import { FundingReadinessChecker, FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import {
  buildFundingVenueReadinessCheckersFromEnv,
  isFundingVenueReadinessSupported
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

interface RouteRehearsalArtifact {
  generatedAt: string;
  status: "COMPLETED" | "FAILED" | "REFUSED_CONFIG_INCOMPLETE";
  blockers: string[];
  sandboxLane: {
    laneId: string;
    laneState: string;
    venuePath: FundingVenue[];
    scopeKind: string;
  };
  fundingIntentIds: string[];
  userId: string | null;
  executionSize: string;
  routeLegs: Array<{
    routeLegId: string | null;
    fundingIntentId: string | null;
    targetVenue: string | null;
    routeLegStatus: string | null;
    destinationStatus: string | null;
    venueCreditStatus: string | null;
    destinationAmountEstimate: string | null;
  }>;
  venueEvidence: Array<{
    targetVenue: string;
    readyToTrade: boolean;
    destinationReceived: boolean | null;
    venueCreditConfirmed: boolean | null;
    reason: string | null;
    lastCheckedAt: string | null;
  }>;
  persistedReadinessRows: number;
  adminReadinessVisible: boolean;
  summaryReadyToTradeCount: number;
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

class SandboxLifiProvider implements LifiRouteProvider {
  public quoteCalls = 0;
  public statusCalls = 0;

  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    this.quoteCalls += 1;
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
        source: "sandbox_route_lifi_provider",
        status: "DONE",
        substatus: "COMPLETED"
      }
    };
  }
}

const routeOrLaneId = process.argv[2];
if (!routeOrLaneId) {
  throw new Error("Usage: npm run funding:route-readiness-sandbox-preflight -- <ROUTE_OR_LANE_ID>");
}

const normalizedRoute = routeOrLaneId.toUpperCase().replaceAll("-", "_");
if (normalizedRoute.includes("PREDICT") && !normalizedRoute.includes("PREDICT_FUN") && !normalizedRoute.includes("PREDICTFUN")) {
  throw new Error("Route mentions PREDICT but not PREDICT_FUN. Set a lane id and FUNDING_ROUTE_REQUIRED_VENUES that explicitly use PREDICT_FUN.");
}

const supportedVenues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
const normalizeVenueList = (rawVenues: readonly string[]): FundingVenue[] => {
  const normalized = [...new Set(rawVenues.map((venue) => venue.trim().toUpperCase()).filter(Boolean))];
  const invalid = normalized.filter((venue) => !isFundingVenueReadinessSupported(venue));
  if (invalid.length > 0) {
    throw new Error(`Unsupported funding venue(s): ${invalid.join(", ")}.`);
  }
  return normalized.filter((venue): venue is FundingVenue => isFundingVenueReadinessSupported(venue));
};

const inferVenues = (): FundingVenue[] => {
  const explicit = process.env.FUNDING_ROUTE_REQUIRED_VENUES;
  if (explicit) {
    return normalizeVenueList(explicit.split(","));
  }
  return supportedVenues.filter((venue) => {
    if (venue === "PREDICT_FUN") {
      return normalizedRoute.includes("PREDICT_FUN") || normalizedRoute.includes("PREDICTFUN");
    }
    return normalizedRoute.includes(venue);
  });
};

const requiredVenues = inferVenues();
if (requiredVenues.length < 2) {
  throw new Error("Route rehearsal requires at least two venues. Use the single-venue rehearsal for one venue.");
}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for route funding readiness preflight rehearsal.");
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const routeSlug = routeOrLaneId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const artifactJsonPath = process.env.FUNDING_ROUTE_REHEARSAL_ARTIFACT_PATH ??
  join(artifactDir, `route-${routeSlug}-funding-readiness-sandbox-preflight.json`);
const artifactMarkdownPath = artifactJsonPath.endsWith(".json")
  ? artifactJsonPath.replace(/\.json$/, ".md")
  : join(artifactDir, `route-${routeSlug}-funding-readiness-sandbox-preflight.md`);
const executionSize = process.env.FUNDING_ROUTE_REHEARSAL_EXECUTION_SIZE ?? "10";

const lane: ExecutionLaneAuthoritySnapshot = {
  laneId: routeOrLaneId,
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: requiredVenues,
  candidateSet: ["2026-05-31"],
  ruleState: "EXACT_SAFE"
};

const scopeBinding: ExecutionScopeBinding = {
  scopeKind: "CRYPTO_LANE",
  scopeId: lane.laneId,
  topicKey: lane.topicKey,
  laneType: requiredVenues.length === 2 ? "PAIR" : requiredVenues.length === 3 ? "TRI" : "STRICT_ALL",
  venueSet: lane.venueSet,
  candidateSet: lane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

const buildExecutionRequest = (userId: string): ExecutionRequestV0 => ({
  executionId: `execution-${randomUUID()}`,
  rfqId: `rfq-${randomUUID()}`,
  userId,
  canonicalTopicKey: lane.topicKey,
  candidateId: "2026-05-31",
  side: "buy",
  size: executionSize,
  selectedLaneId: lane.laneId,
  venuePath: requiredVenues,
  executionMode: requiredVenues.length === 2 ? "PAIR" : requiredVenues.length === 3 ? "TRI" : "SPLIT",
  approvedScopeHash: "sandbox-route-funding-readiness-scope-hash",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: `sandbox-route-funding-preflight-${randomUUID()}`,
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
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL,
  process.env.LIFI_API_KEY,
  ...requiredVenues.flatMap((venue) => [
    process.env[`${venue}_FUNDING_READ_API_KEY`],
    process.env[`${venue}_API_KEY`],
    process.env[`${venue}_API_SECRET`],
    process.env[`${venue}_PRIVATE_KEY`]
  ])
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const assertRedacted = (payload: unknown): boolean => {
  const serialized = JSON.stringify(payload);
  return !secretCandidates.some((secret) => serialized.includes(secret))
    && !serialized.includes("transactionRequest")
    && !serialized.toLowerCase().includes("authorization")
    && !serialized.toLowerCase().includes("privatekey");
};

const baseSafety = (): RouteRehearsalArtifact["safety"] => ({
  defaultFundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
  scriptScopedFundingPreflightEnforcementOnly: true,
  liveLifiExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  liveVenueSubmissionEnabled: false
});

const renderMarkdown = (artifact: RouteRehearsalArtifact): string => [
  "# Funding Route Readiness Sandbox Preflight",
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  "## Result",
  "",
  `- Status: ${artifact.status}`,
  `- Lane: ${artifact.sandboxLane.laneId}`,
  `- Venue path: ${artifact.sandboxLane.venuePath.join(", ")}`,
  `- Funding intents: ${artifact.fundingIntentIds.join(", ") || "none"}`,
  `- Persisted readiness rows: ${artifact.persistedReadinessRows}`,
  `- Preflight passed: ${artifact.executionPreflight.ok}`,
  "",
  "## Venue Evidence",
  "",
  ...artifact.venueEvidence.map((row) =>
    `- ${row.targetVenue}: ${row.readyToTrade ? "READY_TO_TRADE" : "NOT_READY"} (${row.reason ?? "no reason"})`
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
  "This script only rehearses funding-enforced preflight for a sandbox route scope."
].join("\n");

const writeArtifacts = async (artifact: RouteRehearsalArtifact): Promise<void> => {
  if (!artifact.redactionVerified) {
    throw new Error("Route funding rehearsal artifact failed redaction verification.");
  }
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMarkdownPath, renderMarkdown(artifact), "utf8");
};

const main = async (): Promise<void> => {
  const amountPerVenue = process.env.FUNDING_ROUTE_REHEARSAL_AMOUNT_PER_VENUE ?? "10";
  const sourceAmount = String(Number(amountPerVenue) * requiredVenues.length);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await applyFundingMigration(pool);
    const repository = new FundingRepository(pool);
    const userId = process.env.FUNDING_ROUTE_REHEARSAL_USER_ID ?? `sandbox-route-funding-user-${randomUUID()}`;
    const lifi = new SandboxLifiProvider();
    const service = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: {
          ...process.env,
          FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true"
        } as NodeJS.ProcessEnv
      },
      buildFundingVenueReadinessCheckersFromEnv({
        ...process.env,
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    );
    const created = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount,
      sourceWalletAddress: "sandbox-solana-wallet",
      idempotencyKey: `sandbox-route-readiness-${randomUUID()}`,
      targets: requiredVenues.map((venue) => ({
        targetVenue: venue,
        targetAmount: amountPerVenue
      }))
    });
    const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
    for (const leg of quoted.routeLegs) {
      await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
        routeLegId: leg.routeLegId,
        txHash: `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66)
      });
    }
    const refreshed = await service.refreshIntentStatus(userId, created.intent.fundingIntentId);
    const adminService = new FundingReadinessAdminService({
      repository,
      env: {
        ...process.env,
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true"
      } as NodeJS.ProcessEnv
    });
    const readinessRows = await adminService.listByIntent(created.intent.fundingIntentId);
    const summary = await adminService.getSummary();
    const preflight = buildExecutionPreflight(new FundingReadinessChecker(service, true));
    const executionPreflight = await preflight.evaluate({ request: buildExecutionRequest(userId), scopeBinding });
    const readyRows = readinessRows.filter((row) => row.readyToTrade === true);
    const artifact: RouteRehearsalArtifact = {
      generatedAt: new Date().toISOString(),
      status: readyRows.length === requiredVenues.length && executionPreflight.ok ? "COMPLETED" : "FAILED",
      blockers: [],
      sandboxLane: {
        laneId: lane.laneId,
        laneState: lane.laneState,
        venuePath: lane.venueSet,
        scopeKind: scopeBinding.scopeKind
      },
      fundingIntentIds: [created.intent.fundingIntentId],
      userId,
      executionSize,
      routeLegs: refreshed.routeLegs.map((leg) => ({
        routeLegId: leg.routeLegId,
        fundingIntentId: leg.fundingIntentId,
        targetVenue: leg.targetVenue,
        routeLegStatus: leg.status,
        destinationStatus: leg.destinationStatus,
        venueCreditStatus: leg.venueCreditStatus,
        destinationAmountEstimate: leg.destinationAmountEstimate
      })),
      venueEvidence: readinessRows.map((row) => ({
        targetVenue: row.targetVenue,
        readyToTrade: row.readyToTrade,
        destinationReceived: row.destinationStatus === "CONFIRMED",
        venueCreditConfirmed: row.venueCreditStatus === "CONFIRMED",
        reason: row.reasonNotReady ?? null,
        lastCheckedAt: row.lastCheckedAt
      })),
      persistedReadinessRows: readyRows.length,
      adminReadinessVisible: readyRows.length === requiredVenues.length,
      summaryReadyToTradeCount: summary.readyToTrade,
      executionPreflight,
      safety: baseSafety(),
      redactionVerified: false
    };
    await writeArtifacts({ ...artifact, redactionVerified: assertRedacted(artifact) });
    console.log(JSON.stringify({
      status: artifact.status,
      laneId: artifact.sandboxLane.laneId,
      venuePath: artifact.sandboxLane.venuePath,
      persistedReadinessRows: artifact.persistedReadinessRows,
      executionPreflight: artifact.executionPreflight,
      lifiQuoteCalls: lifi.quoteCalls,
      lifiStatusCalls: lifi.statusCalls,
      artifactJsonPath,
      artifactMarkdownPath
    }, null, 2));
  } finally {
    await pool.end();
  }
};

await main();
