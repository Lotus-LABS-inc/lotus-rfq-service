import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import { getPolymarketExecutionAdapterV2EnvStatus } from "../../src/execution-system/index.js";

loadDotenv();

type ComponentStatus = "PASSED" | "FAILED" | "BLOCKED" | "WARNING" | "MISSING";
type OverallStatus = "READY" | "BLOCKED" | "DEGRADED";

interface ComponentSummary {
  component: string;
  status: ComponentStatus;
  artifactPath: string | null;
  generatedAt: string | null;
  blockers: string[];
  notes: string[];
}

interface BetaReadinessReport {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: OverallStatus;
  components: ComponentSummary[];
  trading: {
    currentLiveVenue: "POLYMARKET";
    polymarket: {
      readinessState: string;
      liveExecutionEnabled: boolean;
      featureFlagSelected: boolean;
      requiredEnvPresent: boolean;
      missingEnv: readonly string[];
      dryRunRequiredEnvPresent: boolean;
      missingDryRunEnv: readonly string[];
    };
  };
  observability: {
    healthUrl: string | null;
    metricsUrl: string | null;
    alertThresholds: Record<string, string>;
  };
  safety: {
    readOnlyReport: true;
    liveSubmitRequiresOperatorFlags: true;
    noSecretsIncluded: true;
    frontendDirectSecretAccess: false;
    shadowMonetizationIsNotCollectedRevenue: true;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "beta-readiness");
const backendBaseUrl = normalizeBaseUrl(
  process.env.ADMIN_SMOKE_BASE_URL ??
  process.env.ADMIN_API_BASE_URL ??
  process.env.LOTUS_BACKEND_URL ??
  ""
);

const alertThresholds: Record<string, string> = {
  adminAuthFailures: "Investigate if ADMIN_AUTH_LOGIN_FAILED or ADMIN_MAGIC_LOGIN failures spike above 5 in 15 minutes.",
  adminRateLimit: "Investigate if ADMIN_LOGIN_LINK_RATE_LIMITED or ADMIN_AUTH_LOGIN_RATE_LIMITED appears for an active operator.",
  redisUnavailable: "Investigate any Redis connection error lasting more than 5 minutes; admin login falls back but realtime paths may degrade.",
  databaseErrors: "Page operator on repeated pg connection/query failures or /health failure.",
  failedExecutionSubmissions: "Block live trading on any failed venue submit until execution record and venue state are reconciled.",
  fundingReadinessStale: "Block beta order flow for venues with readiness evidence older than 24 hours.",
  withdrawalCompletionFailures: "Block withdrawal completion persistence for venues with failed completion gates.",
  resendDeliveryFailures: "Investigate any ADMIN_MAGIC_LINK_SEND_FAILED for active admins."
};

const generatedAt = new Date().toISOString();
const components = await Promise.all([
  summarizeAdminSmoke(),
  summarizeExecutionReadiness(),
  summarizeFundingReadiness(),
  summarizeWithdrawalReadiness(),
  summarizeMonetizationReadiness(),
  summarizeObservability()
]);
const hardBlocked = components.some((component) => ["FAILED", "BLOCKED", "MISSING"].includes(component.status));
const degraded = components.some((component) => component.status === "WARNING");
const polymarket = getPolymarketExecutionAdapterV2EnvStatus(process.env);
const report: BetaReadinessReport = {
  artifactSchemaVersion: 1,
  generatedAt,
  status: hardBlocked ? "BLOCKED" : degraded ? "DEGRADED" : "READY",
  components,
  trading: {
    currentLiveVenue: "POLYMARKET",
    polymarket: {
      readinessState: polymarket.readinessState,
      liveExecutionEnabled: polymarket.liveExecutionEnabled,
      featureFlagSelected: polymarket.featureFlagSelected,
      requiredEnvPresent: polymarket.requiredEnvPresent,
      missingEnv: polymarket.missingEnv,
      dryRunRequiredEnvPresent: polymarket.dryRunRequiredEnvPresent,
      missingDryRunEnv: polymarket.missingDryRunEnv
    }
  },
  observability: {
    healthUrl: backendBaseUrl ? `${backendBaseUrl}/health` : null,
    metricsUrl: backendBaseUrl ? `${backendBaseUrl}/metrics` : null,
    alertThresholds
  },
  safety: {
    readOnlyReport: true,
    liveSubmitRequiresOperatorFlags: true,
    noSecretsIncluded: true,
    frontendDirectSecretAccess: false,
    shadowMonetizationIsNotCollectedRevenue: true
  }
};

await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, "beta-readiness-summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(artifactDir, "beta-readiness-summary.md"), renderMarkdown(report), "utf8");

console.log(`Beta readiness: ${report.status}`);
console.log(`artifact=${join(artifactDir, "beta-readiness-summary.json")}`);
if (report.status !== "READY") {
  process.exitCode = 1;
}

async function summarizeAdminSmoke(): Promise<ComponentSummary> {
  const artifactPath = join(process.cwd(), "artifacts", "admin", "admin-api-smoke-latest.json");
  const artifact = await readJson<Record<string, unknown>>(artifactPath);
  if (!artifact) {
    return missing("admin_api_smoke", artifactPath, "Run npm run admin:api-smoke.");
  }
  const status = artifact.status === "PASSED" ? "PASSED" : "FAILED";
  return {
    component: "admin_api_smoke",
    status,
    artifactPath,
    generatedAt: stringValue(artifact.generatedAt),
    blockers: status === "PASSED" ? [] : ["One or more admin endpoints failed or returned sensitive fields."],
    notes: [`baseUrl=${stringValue(artifact.baseUrl) ?? "unknown"}`]
  };
}

async function summarizeExecutionReadiness(): Promise<ComponentSummary> {
  const artifactPath = join(process.cwd(), "artifacts", "execution", "execution-system-v0-summary.json");
  const harnessPath = join(process.cwd(), "artifacts", "execution", "polymarket-live-submit-checklist.json");
  const summary = await readJson<Record<string, unknown>>(artifactPath);
  const harness = await readJson<Record<string, unknown>>(harnessPath);
  const polymarketStatus = getPolymarketExecutionAdapterV2EnvStatus(process.env);
  const blockers: string[] = [];
  const notes: string[] = [];
  if (!summary) {
    blockers.push("Execution system summary artifact is missing.");
  }
  if (!polymarketStatus.requiredEnvPresent) {
    blockers.push(`Polymarket live env missing: ${polymarketStatus.missingEnv.join(", ") || "unknown"}.`);
  }
  if (!polymarketStatus.dryRunRequiredEnvPresent) {
    blockers.push(`Polymarket dry-run env missing: ${polymarketStatus.missingDryRunEnv.join(", ") || "unknown"}.`);
  }
  if (!harness) {
    notes.push("Polymarket live-submit harness artifact is missing.");
  } else {
    const error = objectValue(harness.error);
    const errorCode = stringValue(error?.code);
    if (errorCode === "POLYMARKET_V2_UNAUTHORIZED") {
      blockers.push("Last Polymarket harness attempt was rejected by venue auth.");
    } else if (errorCode) {
      blockers.push(`Last Polymarket harness attempt failed with ${errorCode}.`);
    }
    notes.push(`lastHarnessSubmitted=${String(harness.submitted ?? "unknown")}`);
  }
  return {
    component: "trading_readiness",
    status: blockers.length > 0 ? "BLOCKED" : "PASSED",
    artifactPath: summary ? artifactPath : null,
    generatedAt: stringValue(summary?.generatedAt),
    blockers,
    notes
  };
}

async function summarizeFundingReadiness(): Promise<ComponentSummary> {
  const artifactPath = join(process.cwd(), "artifacts", "funding", "all-venue-readiness-gate-summary.json");
  const artifact = await readJson<Record<string, unknown>>(artifactPath);
  if (!artifact) {
    return missing("funding_readiness", artifactPath, "Run npm run funding:venue-gate-summary.");
  }
  const status = artifact.status === "PASSED" ? "PASSED" : "BLOCKED";
  return {
    component: "funding_readiness",
    status,
    artifactPath,
    generatedAt: stringValue(artifact.generatedAt),
    blockers: status === "PASSED" ? [] : [`Funding gate failed for ${String(artifact.failedVenues ?? "unknown")} venue(s).`],
    notes: [`passedVenues=${String(artifact.passedVenues ?? "unknown")}`]
  };
}

async function summarizeWithdrawalReadiness(): Promise<ComponentSummary> {
  const artifactPath = join(process.cwd(), "artifacts", "funding", "all-venue-withdrawal-completion-gate-summary.json");
  const artifact = await readJson<Record<string, unknown>>(artifactPath);
  if (!artifact) {
    return missing("withdrawal_readiness", artifactPath, "Run npm run funding:withdrawal-completion-gate-summary.");
  }
  const status = artifact.status === "PASSED" ? "PASSED" : "BLOCKED";
  return {
    component: "withdrawal_readiness",
    status,
    artifactPath,
    generatedAt: stringValue(artifact.generatedAt),
    blockers: status === "PASSED" ? [] : [`Withdrawal completion gate failed for ${String(artifact.failedVenues ?? "unknown")} venue(s).`],
    notes: [`passedVenues=${String(artifact.passedVenues ?? "unknown")}`]
  };
}

async function summarizeMonetizationReadiness(): Promise<ComponentSummary> {
  const artifactPath = join(process.cwd(), "artifacts", "monetization", "monetization-shadow-summary.json");
  const artifact = await readJson<Record<string, unknown>>(artifactPath);
  if (!artifact) {
    return missing("monetization_readiness", artifactPath, "Run npm run report:monetization:private-beta.");
  }
  const safety = objectValue(artifact.safety);
  const safe = safety?.shadowIsNotCollectedRevenue === true &&
    safety.smartFeeRouterLive === false &&
    safety.noSecretsIncluded === true;
  return {
    component: "monetization_readiness",
    status: safe ? "PASSED" : "FAILED",
    artifactPath,
    generatedAt: stringValue(artifact.generatedAt),
    blockers: safe ? [] : ["Monetization artifact does not prove shadow revenue is separated from collected revenue."],
    notes: [
      `actualBuilderFeesCollected=${String(artifact.actualBuilderFeesCollected ?? "unknown")}`,
      `uncollectedImprovementOpportunity=${String(artifact.uncollectedImprovementOpportunity ?? "unknown")}`
    ]
  };
}

async function summarizeObservability(): Promise<ComponentSummary> {
  const blockers: string[] = [];
  const notes: string[] = [];
  if (!backendBaseUrl) {
    return {
      component: "observability",
      status: "WARNING",
      artifactPath: null,
      generatedAt,
      blockers: [],
      notes: ["Set ADMIN_SMOKE_BASE_URL, ADMIN_API_BASE_URL, or LOTUS_BACKEND_URL to include production health/metrics URLs."]
    };
  }
  const health = await checkEndpoint(`${backendBaseUrl}/health`);
  const metrics = await checkEndpoint(`${backendBaseUrl}/metrics`);
  if (!health.ok) {
    blockers.push(`/health failed: ${health.error ?? health.statusCode}`);
  }
  if (!metrics.ok) {
    blockers.push(`/metrics failed: ${metrics.error ?? metrics.statusCode}`);
  }
  notes.push(`/health=${health.statusCode ?? "error"}`);
  notes.push(`/metrics=${metrics.statusCode ?? "error"}`);
  return {
    component: "observability",
    status: blockers.length > 0 ? "BLOCKED" : "PASSED",
    artifactPath: null,
    generatedAt,
    blockers,
    notes
  };
}

function missing(component: string, artifactPath: string, action: string): ComponentSummary {
  return {
    component,
    status: "MISSING",
    artifactPath,
    generatedAt: null,
    blockers: [action],
    notes: []
  };
}

async function checkEndpoint(url: string): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
  try {
    const response = await fetch(url, { method: "GET" });
    return { ok: response.ok, statusCode: response.status, error: null };
  } catch (error) {
    return { ok: false, statusCode: null, error: error instanceof Error ? error.message : "unknown" };
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function renderMarkdown(report: BetaReadinessReport): string {
  return [
    "# Lotus Backend Beta Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    "",
    "## Components",
    "",
    "| Component | Status | Generated | Blockers | Notes |",
    "|---|---|---|---|---|",
    ...report.components.map((component) => [
      component.component,
      component.status,
      component.generatedAt ?? "n/a",
      component.blockers.length > 0 ? component.blockers.join("; ") : "none",
      component.notes.length > 0 ? component.notes.join("; ") : "none"
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Trading",
    "",
    `- Current live venue: ${report.trading.currentLiveVenue}`,
    `- Polymarket readiness: ${report.trading.polymarket.readinessState}`,
    `- Polymarket live execution enabled: ${report.trading.polymarket.liveExecutionEnabled}`,
    `- Polymarket feature flag selected: ${report.trading.polymarket.featureFlagSelected}`,
    `- Required env present: ${report.trading.polymarket.requiredEnvPresent}`,
    `- Missing env: ${report.trading.polymarket.missingEnv.join(", ") || "none"}`,
    "",
    "## Observability Alerts",
    "",
    ...Object.entries(report.observability.alertThresholds).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Safety",
    "",
    "- This report is read-only.",
    "- Live submit still requires operator flags.",
    "- No secrets are included.",
    "- Shadow monetization is not collected revenue.",
    ""
  ].join("\n");
}
