import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import { FundingReadinessChecker, FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote, FundingVenue } from "../../src/core/funding/types.js";
import { isFundingVenueReadinessSupported } from "../../src/core/funding/venue-readiness.js";
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

interface SingleVenueRehearsalArtifact {
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
  routeLegId: string | null;
  userId: string | null;
  executionSize: string;
  routeLegs: Array<{
    routeLegId: string | null;
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

class NoopLifiProvider implements LifiRouteProvider {
  public async quote(): Promise<FundingRouteQuote> {
    throw new Error("LI.FI quote is disabled for venue funding preflight rehearsal.");
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    throw new Error("LI.FI status is disabled for venue funding preflight rehearsal.");
  }
}

const requestedVenue = (process.argv[2] ?? "").toUpperCase();
if (!isFundingVenueReadinessSupported(requestedVenue)) {
  throw new Error("Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN.");
}

const venue: FundingVenue = requestedVenue;
const artifactDir = join(process.cwd(), "artifacts", "funding");
const artifactBaseName = `${venue.toLowerCase().replaceAll("_", "-")}-funding-readiness-sandbox-preflight`;
const artifactJsonPath = join(artifactDir, `${artifactBaseName}.json`);
const artifactMarkdownPath = join(artifactDir, `${artifactBaseName}.md`);
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for the venue funding readiness preflight run.");
}

const lane: ExecutionLaneAuthoritySnapshot = {
  laneId: `CRYPTO_BTC_ATH_BY_DATE_SINGLE_${venue}`,
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: [venue],
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

const buildExecutionRequest = (input: { userId: string; executionSize: string }): ExecutionRequestV0 => ({
  executionId: `execution-${crypto.randomUUID()}`,
  rfqId: `rfq-${crypto.randomUUID()}`,
  userId: input.userId,
  canonicalTopicKey: lane.topicKey,
  candidateId: "2026-05-31",
  side: "buy",
  size: input.executionSize,
  selectedLaneId: lane.laneId,
  venuePath: [venue],
  executionMode: "SINGLE_VENUE",
  approvedScopeHash: "sandbox-single-venue-scope-hash",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: `sandbox-${venue.toLowerCase()}-funding-preflight-${crypto.randomUUID()}`,
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

const secretCandidates = [
  process.env[`${venue}_FUNDING_READ_API_KEY`],
  process.env[`${venue}_API_KEY`],
  process.env[`${venue}_API_SECRET`],
  process.env[`${venue}_PRIVATE_KEY`],
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

const baseSafety = (): SingleVenueRehearsalArtifact["safety"] => ({
  defaultFundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
  scriptScopedFundingPreflightEnforcementOnly: true,
  liveLifiExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  liveVenueSubmissionEnabled: false
});

const renderMarkdown = (artifact: SingleVenueRehearsalArtifact): string => [
  `# ${venue} Funding Readiness Sandbox Preflight`,
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  "## Result",
  "",
  `- Status: ${artifact.status}`,
  `- Lane: ${artifact.sandboxLane.laneId}`,
  `- Venue path: ${artifact.sandboxLane.venuePath.join(", ")}`,
  `- Funding intent: ${artifact.fundingIntentId ?? "none"}`,
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
  "This script only rehearses funding-enforced preflight for a sandbox single-venue lane."
].join("\n");

const writeArtifacts = async (artifact: SingleVenueRehearsalArtifact): Promise<void> => {
  if (!artifact.redactionVerified) {
    throw new Error(`${venue} funding rehearsal artifact failed redaction verification.`);
  }
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactMarkdownPath, renderMarkdown(artifact), "utf8");
};

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new FundingRepository(pool);
    const adminService = new FundingReadinessAdminService({
      repository,
      env: {
        ...process.env,
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true"
      } as NodeJS.ProcessEnv
    });
    const rows = await adminService.listByVenue(venue);
    const readyRow = rows.find((row) =>
      row.readyToTrade === true &&
      row.routeLegStatus === "LEG_READY_TO_TRADE" &&
      row.destinationStatus === "CONFIRMED" &&
      row.venueCreditStatus === "CONFIRMED" &&
      row.routeLegId
    );
    const executionSize = process.env[`FUNDING_${venue}_REHEARSAL_EXECUTION_SIZE`] ??
      process.env.FUNDING_SINGLE_VENUE_REHEARSAL_EXECUTION_SIZE ??
      "10";
    if (!readyRow?.routeLegId) {
      const artifact: SingleVenueRehearsalArtifact = {
        generatedAt: new Date().toISOString(),
        status: "REFUSED_CONFIG_INCOMPLETE",
        blockers: [`No persisted READY_TO_TRADE ${venue} funding row is available for rehearsal.`],
        sandboxLane: {
          laneId: lane.laneId,
          laneState: lane.laneState,
          venuePath: lane.venueSet,
          scopeKind: scopeBinding.scopeKind
        },
        fundingIntentId: null,
        routeLegId: null,
        userId: null,
        executionSize,
        routeLegs: [],
        venueEvidence: [],
        persistedReadinessRows: 0,
        adminReadinessVisible: false,
        summaryReadyToTradeCount: (await adminService.getSummary()).readyToTrade,
        executionPreflight: { ok: false, code: "FUNDING_READY_ROW_MISSING", reason: "Persisted venue readiness is missing." },
        safety: baseSafety(),
        redactionVerified: false
      };
      await writeArtifacts({ ...artifact, redactionVerified: assertRedacted(artifact) });
      console.log(`status=${artifact.status} blocker=${artifact.blockers[0]}`);
      return;
    }

    const service = new FundingService(
      repository,
      new NoopLifiProvider(),
      {
        lifiQuotesEnabled: false,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: false,
        env: process.env
      }
    );
    const preflight = buildExecutionPreflight(new FundingReadinessChecker(service, true));
    const executionPreflight = await preflight.evaluate({
      request: buildExecutionRequest({ userId: readyRow.userId, executionSize }),
      scopeBinding
    });
    const summary = await adminService.getSummary();
    const venueEvidence = rows.filter((row) => row.fundingIntentId === readyRow.fundingIntentId).map((row) => ({
      targetVenue: row.targetVenue,
      readyToTrade: row.readyToTrade,
      destinationReceived: row.destinationStatus === "CONFIRMED",
      venueCreditConfirmed: row.venueCreditStatus === "CONFIRMED",
      reason: row.reasonNotReady ?? null,
      lastCheckedAt: row.lastCheckedAt
    }));
    const artifact: SingleVenueRehearsalArtifact = {
      generatedAt: new Date().toISOString(),
      status: executionPreflight.ok ? "COMPLETED" : "FAILED",
      blockers: [],
      sandboxLane: {
        laneId: lane.laneId,
        laneState: lane.laneState,
        venuePath: lane.venueSet,
        scopeKind: scopeBinding.scopeKind
      },
      fundingIntentId: readyRow.fundingIntentId,
      routeLegId: readyRow.routeLegId,
      userId: readyRow.userId,
      executionSize,
      routeLegs: [{
        routeLegId: readyRow.routeLegId,
        targetVenue: readyRow.targetVenue,
        routeLegStatus: readyRow.routeLegStatus,
        destinationStatus: readyRow.destinationStatus,
        venueCreditStatus: readyRow.venueCreditStatus,
        destinationAmountEstimate: readyRow.destinationAmountEstimate
      }],
      venueEvidence,
      persistedReadinessRows: venueEvidence.filter((row) => row.readyToTrade).length,
      adminReadinessVisible: venueEvidence.some((row) => row.readyToTrade),
      summaryReadyToTradeCount: summary.readyToTrade,
      executionPreflight,
      safety: baseSafety(),
      redactionVerified: false
    };
    await writeArtifacts({ ...artifact, redactionVerified: assertRedacted(artifact) });
    console.log(JSON.stringify({
      status: artifact.status,
      fundingIntentId: artifact.fundingIntentId,
      routeLegId: artifact.routeLegId,
      persistedReadinessRows: artifact.persistedReadinessRows,
      executionPreflight: artifact.executionPreflight,
      artifactJsonPath,
      artifactMarkdownPath
    }, null, 2));
  } finally {
    await pool.end();
  }
};

await main();
