import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import {
  getPolymarketFundingReadinessConfigFromEnv,
  HttpPolymarketFundingBalanceReadClient,
  PolymarketFundingReadinessChecker,
  type VenueFundingReadinessResult
} from "../../src/core/funding/venue-readiness.js";
import { FundingRepository, type FundingAdminReadinessRecord } from "../../src/repositories/funding.repository.js";

loadDotenv();

type SmokeStatus =
  | "REFUSED_CONFIG_INCOMPLETE"
  | "REFUSED_PREFLIGHT_ENFORCEMENT_ENABLED"
  | "NO_ELIGIBLE_CONFIRMED_ROW"
  | "COMPLETED"
  | "FAILED";

interface SmokeArtifact {
  generatedAt: string;
  venue: "POLYMARKET";
  status: SmokeStatus;
  readOnly: true;
  persistedReadinessResult: false;
  liveLifiExecutionEnabled: boolean;
  fundingPreflightEnforcementEnabled: boolean;
  config: {
    mode: string;
    configured: boolean;
    balanceUrlConfigured: boolean;
    balanceUrlHost: string | null;
    authMode: string;
    apiKeyConfigured: boolean;
    timeoutMs: number;
    minimumConfirmations: number;
  };
  selectedRow: null | {
    fundingIntentId: string;
    userId: string;
    targetVenue: string;
    routeLegId: string | null;
    destinationStatus: string | null;
    venueCreditStatus: string | null;
    requiredAmount: string | null;
    txHashes: string[];
  };
  readinessResult: null | Omit<VenueFundingReadinessResult, "evidence"> & {
    evidence: Record<string, unknown>;
  };
  mappingObserved: string | null;
  redactionVerified: boolean;
  blockers: string[];
  warnings: string[];
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const buildBaseArtifact = (): SmokeArtifact => {
  const config = getPolymarketFundingReadinessConfigFromEnv(process.env);
  return {
    generatedAt: new Date().toISOString(),
    venue: "POLYMARKET",
    status: "FAILED",
    readOnly: true,
    persistedReadinessResult: false,
    liveLifiExecutionEnabled: process.env.FUNDING_LIVE_SUBMIT_ENABLED === "true",
    fundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
    config: {
      mode: config.mode,
      configured: config.configured,
      balanceUrlConfigured: Boolean(config.balanceUrl),
      balanceUrlHost: safeUrlHost(config.balanceUrl),
      authMode: config.authMode,
      apiKeyConfigured: Boolean(process.env.POLYMARKET_FUNDING_READ_API_KEY),
      timeoutMs: config.timeoutMs,
      minimumConfirmations: config.minimumConfirmations
    },
    selectedRow: null,
    readinessResult: null,
    mappingObserved: null,
    redactionVerified: false,
    blockers: [],
    warnings: []
  };
};

const run = async (): Promise<SmokeArtifact> => {
  const artifact = buildBaseArtifact();
  const config = getPolymarketFundingReadinessConfigFromEnv(process.env);
  if (artifact.fundingPreflightEnforcementEnabled) {
    return {
      ...artifact,
      status: "REFUSED_PREFLIGHT_ENFORCEMENT_ENABLED",
      blockers: ["FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED must remain false for this read-only smoke test."]
    };
  }
  if (config.mode !== "LIVE_READ" || !config.configured || (config.authMode === "BEARER" && !process.env.POLYMARKET_FUNDING_READ_API_KEY)) {
    return {
      ...artifact,
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers: [
        "POLYMARKET_FUNDING_READINESS_MODE must be LIVE_READ.",
        "POLYMARKET_FUNDING_BALANCE_URL must be configured as a valid http(s) URL.",
        "POLYMARKET_FUNDING_READ_API_KEY is required when auth mode is BEARER."
      ].filter((blocker) =>
        blocker.includes("MODE") ? config.mode !== "LIVE_READ" :
          blocker.includes("BALANCE") ? !config.configured :
            config.authMode === "BEARER" && !process.env.POLYMARKET_FUNDING_READ_API_KEY
      )
    };
  }
  if (!databaseUrl) {
    return {
      ...artifact,
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers: ["TEST_DATABASE_URL or DATABASE_URL is required to select a safe funding row."]
    };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new FundingRepository(pool);
    const candidate = await selectCandidate(repository);
    if (!candidate?.routeLegId) {
      return {
        ...artifact,
        status: "NO_ELIGIBLE_CONFIRMED_ROW",
        blockers: ["No POLYMARKET funding route leg with confirmed destination status was found."]
      };
    }
    const intent = await repository.findIntentById(candidate.fundingIntentId);
    const leg = (await repository.listRouteLegs(candidate.fundingIntentId)).find((routeLeg) => routeLeg.routeLegId === candidate.routeLegId);
    if (!intent || !leg) {
      return {
        ...artifact,
        status: "NO_ELIGIBLE_CONFIRMED_ROW",
        selectedRow: toSelectedRow(candidate),
        blockers: ["Selected funding row could not be loaded as a full funding intent and route leg."]
      };
    }
    const reconciliations = await repository.listReconciliations(candidate.fundingIntentId);
    const checker = new PolymarketFundingReadinessChecker(
      new HttpPolymarketFundingBalanceReadClient({
        balanceUrl: config.balanceUrl ?? undefined,
        timeoutMs: config.timeoutMs,
        authMode: config.authMode,
        apiKey: process.env.POLYMARKET_FUNDING_READ_API_KEY
      }),
      { ...config, env: process.env }
    );
    const result = await checker.check({
      userId: intent.userId,
      intent,
      leg,
      reconciliations
    });
    const completed = {
      ...artifact,
      status: "COMPLETED" as const,
      selectedRow: toSelectedRow(candidate),
      readinessResult: sanitizeResult(result),
      mappingObserved: result.status,
      warnings: result.readyToTrade
        ? ["READY_TO_TRADE was observed by the read-only smoke test but was not persisted."]
        : []
    };
    return {
      ...completed,
      redactionVerified: verifyRedaction(completed)
    };
  } catch (error) {
    return {
      ...artifact,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : "Unknown Polymarket readiness smoke-test failure."]
    };
  } finally {
    await pool.end();
  }
};

const selectCandidate = async (repository: FundingRepository): Promise<FundingAdminReadinessRecord | null> => {
  const rows = await repository.listAdminReadinessRows({ venue: "POLYMARKET", limit: 100 });
  return rows.find((row) =>
    row.routeLegId &&
    (row.destinationStatus === "CONFIRMED" || row.destinationReceived === true)
  ) ?? null;
};

const toSelectedRow = (row: FundingAdminReadinessRecord): SmokeArtifact["selectedRow"] => ({
  fundingIntentId: row.fundingIntentId,
  userId: row.userId,
  targetVenue: row.targetVenue,
  routeLegId: row.routeLegId,
  destinationStatus: row.destinationStatus,
  venueCreditStatus: row.venueCreditStatus,
  requiredAmount: row.destinationAmountEstimate ?? row.targetAmount,
  txHashes: row.txHashes
});

const sanitizeResult = (result: VenueFundingReadinessResult): SmokeArtifact["readinessResult"] => ({
  ...result,
  evidence: result.evidence
});

const verifyRedaction = (artifact: SmokeArtifact): boolean => {
  const serialized = JSON.stringify(artifact);
  const secretCandidates = [
    process.env.POLYMARKET_FUNDING_READ_API_KEY,
    process.env.POLYMARKET_API_KEY,
    process.env.POLYMARKET_API_SECRET,
    process.env.POLYMARKET_API_PASSPHRASE,
    process.env.POLYMARKET_PRIVATE_KEY
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

const writeArtifacts = async (artifact: SmokeArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, "polymarket-readiness-smoke-test.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(artifactDir, "polymarket-readiness-smoke-test.md"),
    renderMarkdown(artifact),
    "utf8"
  );
};

const renderMarkdown = (artifact: SmokeArtifact): string => [
  "# Polymarket Funding Readiness Smoke Test",
  "",
  `Generated: ${artifact.generatedAt}`,
  `Status: ${artifact.status}`,
  "",
  "## Safety",
  "",
  `- Read-only: ${artifact.readOnly}`,
  `- Persisted readiness result: ${artifact.persistedReadinessResult}`,
  `- Live LI.FI execution enabled: ${artifact.liveLifiExecutionEnabled}`,
  `- Funding preflight enforcement enabled: ${artifact.fundingPreflightEnforcementEnabled}`,
  `- Redaction verified: ${artifact.redactionVerified}`,
  "",
  "## Config",
  "",
  `- Mode: ${artifact.config.mode}`,
  `- Configured: ${artifact.config.configured}`,
  `- Balance URL configured: ${artifact.config.balanceUrlConfigured}`,
  `- Balance URL host: ${artifact.config.balanceUrlHost ?? "none"}`,
  `- Auth mode: ${artifact.config.authMode}`,
  `- API key configured: ${artifact.config.apiKeyConfigured}`,
  `- Timeout ms: ${artifact.config.timeoutMs}`,
  `- Minimum confirmations: ${artifact.config.minimumConfirmations}`,
  "",
  "## Result",
  "",
  `- Mapping observed: ${artifact.mappingObserved ?? "none"}`,
  `- Reason: ${artifact.readinessResult?.reason ?? "none"}`,
  `- Ready to trade observed: ${artifact.readinessResult?.readyToTrade ?? false}`,
  "",
  "## Blockers",
  "",
  ...(artifact.blockers.length > 0 ? artifact.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
  "",
  "## Warnings",
  "",
  ...(artifact.warnings.length > 0 ? artifact.warnings.map((warning) => `- ${warning}`) : ["- none"]),
  ""
].join("\n");

const artifact = await run();
const finalArtifact = { ...artifact, redactionVerified: verifyRedaction(artifact) };
await writeArtifacts(finalArtifact);
console.log(`Polymarket funding readiness smoke-test artifact written to ${artifactDir}`);
console.log(`status=${finalArtifact.status} mapping=${finalArtifact.mappingObserved ?? "none"}`);
