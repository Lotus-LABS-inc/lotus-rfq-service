import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import {
  ConfigurableVenueFundingReadinessChecker,
  getFundingReadinessConfigFromEnv,
  HttpFundingBalanceReadClient,
  isFundingVenueReadinessSupported,
  type VenueFundingReadinessResult
} from "../../src/core/funding/venue-readiness.js";
import type { FundingVenue } from "../../src/core/funding/types.js";
import { FundingRepository, type FundingAdminReadinessRecord } from "../../src/repositories/funding.repository.js";

loadDotenv();

type SmokeStatus =
  | "REFUSED_UNSUPPORTED_VENUE"
  | "REFUSED_CONFIG_INCOMPLETE"
  | "REFUSED_PREFLIGHT_ENFORCEMENT_ENABLED"
  | "NO_ELIGIBLE_CONFIRMED_ROW"
  | "COMPLETED"
  | "FAILED";

interface SmokeArtifact {
  generatedAt: string;
  venue: FundingVenue | string;
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

const requestedVenue = (process.argv[2] ?? "").toUpperCase();
const artifactDir = join(process.cwd(), "artifacts", "funding");
const databaseUrl = process.env.FUNDING_SMOKE_DATABASE_URL
  ?? process.env.SUPABASE_DB_URL
  ?? process.env.TEST_DATABASE_URL
  ?? process.env.DATABASE_URL;

const buildBaseArtifact = (venue: FundingVenue | string): SmokeArtifact => {
  const config = isFundingVenueReadinessSupported(venue)
    ? getFundingReadinessConfigFromEnv(venue, process.env)
    : null;
  return {
    generatedAt: new Date().toISOString(),
    venue,
    status: "FAILED",
    readOnly: true,
    persistedReadinessResult: false,
    liveLifiExecutionEnabled: process.env.FUNDING_LIVE_SUBMIT_ENABLED === "true",
    fundingPreflightEnforcementEnabled: process.env.FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED === "true",
    config: {
      mode: config?.mode ?? "UNSUPPORTED",
      configured: config?.configured ?? false,
      balanceUrlConfigured: Boolean(config?.balanceUrl),
      balanceUrlHost: safeUrlHost(config?.balanceUrl ?? null),
      authMode: config?.authMode ?? "NONE",
      apiKeyConfigured: isFundingVenueReadinessSupported(venue) ? Boolean(process.env[`${venue}_FUNDING_READ_API_KEY`]) : false,
      timeoutMs: config?.timeoutMs ?? 0,
      minimumConfirmations: config?.minimumConfirmations ?? 0
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
  if (!isFundingVenueReadinessSupported(requestedVenue)) {
    return {
      ...buildBaseArtifact(requestedVenue || "UNKNOWN"),
      status: "REFUSED_UNSUPPORTED_VENUE",
      blockers: ["Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN."]
    };
  }

  const artifact = buildBaseArtifact(requestedVenue);
  const config = getFundingReadinessConfigFromEnv(requestedVenue, process.env);
  const apiKey = process.env[`${requestedVenue}_FUNDING_READ_API_KEY`];
  if (artifact.fundingPreflightEnforcementEnabled) {
    return {
      ...artifact,
      status: "REFUSED_PREFLIGHT_ENFORCEMENT_ENABLED",
      blockers: ["FUNDING_PREFLIGHT_ENFORCEMENT_ENABLED must remain false for this read-only smoke test."]
    };
  }
  if (config.mode !== "LIVE_READ" || !config.configured || (config.authMode === "BEARER" && !apiKey)) {
    return {
      ...artifact,
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers: [
        `${requestedVenue}_FUNDING_READINESS_MODE must be LIVE_READ.`,
        `${requestedVenue}_FUNDING_BALANCE_URL must be configured as a valid http(s) URL.`,
        `${requestedVenue}_FUNDING_READ_API_KEY is required when auth mode is BEARER.`
      ].filter((blocker) =>
        blocker.includes("MODE") ? config.mode !== "LIVE_READ" :
          blocker.includes("BALANCE") ? !config.configured :
            config.authMode === "BEARER" && !apiKey
      )
    };
  }
  if (!databaseUrl) {
    return {
      ...artifact,
      status: "REFUSED_CONFIG_INCOMPLETE",
      blockers: ["FUNDING_SMOKE_DATABASE_URL, SUPABASE_DB_URL, TEST_DATABASE_URL, or DATABASE_URL is required to select a safe funding row."]
    };
  }

  const pool = new Pool(poolConfigFor(databaseUrl));
  try {
    const repository = new FundingRepository(pool);
    const candidate = await selectCandidate(repository, requestedVenue);
    if (!candidate?.routeLegId) {
      return {
        ...artifact,
        status: "NO_ELIGIBLE_CONFIRMED_ROW",
        blockers: [`No ${requestedVenue} funding route leg with confirmed destination status was found.`]
      };
    }
    const intent = await repository.findIntentById(candidate.fundingIntentId);
    const leg = (await repository.listRouteLegs(candidate.fundingIntentId)).find((routeLeg) => routeLeg.routeLegId === candidate.routeLegId);
    if (!intent || !leg) {
      return {
        ...artifact,
        status: "NO_ELIGIBLE_CONFIRMED_ROW",
        selectedRow: toSelectedRow(candidate),
        blockers: [`Selected ${requestedVenue} funding row could not be loaded as a full funding intent and route leg.`]
      };
    }
    const reconciliations = await repository.listReconciliations(candidate.fundingIntentId);
    const checker = new ConfigurableVenueFundingReadinessChecker(
      requestedVenue,
      new HttpFundingBalanceReadClient(requestedVenue, {
        balanceUrl: config.balanceUrl ?? undefined,
        timeoutMs: config.timeoutMs,
        authMode: config.authMode,
        apiKey
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
      redactionVerified: verifyRedaction(completed, requestedVenue)
    };
  } catch (error) {
    return {
      ...artifact,
      status: "FAILED",
      blockers: [error instanceof Error ? error.message : `Unknown ${requestedVenue} readiness smoke-test failure.`]
    };
  } finally {
    await pool.end();
  }
};

const selectCandidate = async (
  repository: FundingRepository,
  venue: FundingVenue
): Promise<FundingAdminReadinessRecord | null> => {
  const rows = await repository.listAdminReadinessRows({ venue, limit: 100 });
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

const verifyRedaction = (artifact: SmokeArtifact, venue: FundingVenue | string): boolean => {
  const serialized = JSON.stringify(artifact);
  const secretCandidates = [
    process.env[`${venue}_FUNDING_READ_API_KEY`],
    process.env[`${venue}_API_KEY`],
    process.env[`${venue}_API_SECRET`],
    process.env[`${venue}_PRIVATE_KEY`]
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

const artifactBaseName = (venue: FundingVenue | string): string =>
  `${venue.toLowerCase().replaceAll("_", "-")}-readiness-smoke-test`;

const writeArtifacts = async (artifact: SmokeArtifact): Promise<void> => {
  await mkdir(artifactDir, { recursive: true });
  const baseName = artifactBaseName(artifact.venue);
  await writeFile(
    join(artifactDir, `${baseName}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(artifactDir, `${baseName}.md`),
    renderMarkdown(artifact),
    "utf8"
  );
};

const renderMarkdown = (artifact: SmokeArtifact): string => [
  `# ${artifact.venue} Funding Readiness Smoke Test`,
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

const poolConfigFor = (connectionString: string) => ({
  connectionString,
  ...(requiresSsl(connectionString) ? { ssl: { rejectUnauthorized: false } } : {}),
  connectionTimeoutMillis: Number.parseInt(process.env.FUNDING_SMOKE_DB_CONNECT_TIMEOUT_MS ?? "30000", 10)
});

const requiresSsl = (connectionString: string): boolean => {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes("supabase.") || url.hostname.includes("pooler.supabase.com") || url.searchParams.has("sslmode");
  } catch {
    return false;
  }
};

const artifact = await run();
const finalArtifact = isFundingVenueReadinessSupported(artifact.venue)
  ? { ...artifact, redactionVerified: verifyRedaction(artifact, artifact.venue) }
  : artifact;
await writeArtifacts(finalArtifact);
console.log(`${artifact.venue} funding readiness smoke-test artifact written to ${artifactDir}`);
console.log(`status=${finalArtifact.status} mapping=${finalArtifact.mappingObserved ?? "none"}`);
