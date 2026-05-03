import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv();

type SmokeStatus = "PASSED" | "FAILED";

interface ExecutionVenueSmokeRow {
  path: string;
  statusCode: number | null;
  ok: boolean;
  elapsedMs: number;
  secretFindings: string[];
  venues: Array<{
    venue: string;
    operationalStatus: string | null;
    structuralReadiness: string | null;
    liveSubmissionSupported: boolean | null;
    liveExecutionEnabled: boolean | null;
    executionSigningModel: string | null;
    venueAccountConfigured: boolean | null;
    activeLinkedAccounts: number | null;
    blockers: string[];
  }>;
  error: string | null;
}

interface ExecutionVenuesSmokeArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: SmokeStatus;
  baseUrl: string;
  endpoints: ExecutionVenueSmokeRow[];
  responseTime: {
    maxMs: number;
    averageMs: number;
  };
  expectedTestAccount: {
    email: "polymarket-funding-test@uselotus.xyz";
    turnkeySubOrgId: "94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb";
    evmWalletAddress: "0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa";
  };
  safety: {
    readOnly: true;
    secretScanPassed: boolean;
    noPayloadsStored: true;
    noAdminCredentialStored: true;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "execution");
const endpointPaths = [
  "/admin/execution-venues",
  "/admin/execution-venues/POLYMARKET",
  "/admin/execution-venues/PREDICT_FUN",
  "/admin/execution-venues/LIMITLESS"
] as const;

const sensitiveKeyPatterns = [
  /api[-_]?key/i,
  /api[-_]?secret/i,
  /private[-_]?key/i,
  /auth[-_]?header/i,
  /^authorization$/i,
  /^password$/i,
  /^secret$/i,
  /^jwt$/i,
  /^token$/i,
  /^login[-_]?key$/i,
  /^key[-_]?hash$/i,
  /^builder[-_]?code$/i,
  /^signature$/i,
  /provider[-_]?wallet/i,
  /provider[-_]?sub[-_]?org/i
];

const baseUrl = normalizeBaseUrl(
  process.env.ADMIN_EXECUTION_VENUES_SMOKE_BASE_URL ??
  process.env.ADMIN_SMOKE_BASE_URL ??
  process.env.ADMIN_API_BASE_URL ??
  process.env.LOTUS_BACKEND_URL ??
  "http://127.0.0.1:3000"
);
const jwt = process.env.ADMIN_EXECUTION_VENUES_SMOKE_JWT?.trim() ?? process.env.ADMIN_SMOKE_JWT?.trim();
if (!jwt) {
  throw new Error("Set ADMIN_EXECUTION_VENUES_SMOKE_JWT or ADMIN_SMOKE_JWT.");
}

const endpoints: ExecutionVenueSmokeRow[] = [];
for (const path of endpointPaths) {
  endpoints.push(await smokeEndpoint(path, jwt));
}

const elapsedValues = endpoints.map((row) => row.elapsedMs);
const secretScanPassed = endpoints.every((row) => row.secretFindings.length === 0);
const passed = endpoints.every((row) => row.ok) && secretScanPassed;
const generatedAt = new Date().toISOString();
const artifact: ExecutionVenuesSmokeArtifact = {
  artifactSchemaVersion: 1,
  generatedAt,
  status: passed ? "PASSED" : "FAILED",
  baseUrl,
  endpoints,
  responseTime: {
    maxMs: elapsedValues.length > 0 ? Math.max(...elapsedValues) : 0,
    averageMs: elapsedValues.length > 0
      ? Number((elapsedValues.reduce((sum, value) => sum + value, 0) / elapsedValues.length).toFixed(2))
      : 0
  },
  expectedTestAccount: {
    email: "polymarket-funding-test@uselotus.xyz",
    turnkeySubOrgId: "94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb",
    evmWalletAddress: "0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa"
  },
  safety: {
    readOnly: true,
    secretScanPassed,
    noPayloadsStored: true,
    noAdminCredentialStored: true
  }
};

await mkdir(artifactDir, { recursive: true });
const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
const timestampedPath = join(artifactDir, `admin-execution-venues-smoke-${safeTimestamp}.json`);
const latestPath = join(artifactDir, "admin-execution-venues-smoke-latest.json");
const markdownPath = join(artifactDir, "admin-execution-venues-smoke-latest.md");
await writeFile(timestampedPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(latestPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(artifact), "utf8");

console.log(`Admin execution-venues smoke: ${artifact.status}`);
console.log(`artifact=${timestampedPath}`);
if (artifact.status !== "PASSED") {
  process.exitCode = 1;
}

async function smokeEndpoint(path: string, token: string): Promise<ExecutionVenueSmokeRow> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = await response.text();
    const parsed = parseJson(text);
    return {
      path,
      statusCode: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAt,
      secretFindings: parsed === null ? [] : findSensitiveValues(parsed),
      venues: parsed === null ? [] : summarizeVenues(parsed),
      error: response.ok ? null : `HTTP_${response.status}`
    };
  } catch (error) {
    return {
      path,
      statusCode: null,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      secretFindings: [],
      venues: [],
      error: error instanceof Error ? error.message : "unknown"
    };
  }
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function summarizeVenues(value: unknown): ExecutionVenueSmokeRow["venues"] {
  const rows = isRecord(value) && Array.isArray(value.venues)
    ? value.venues
    : isRecord(value) && isRecord(value.venue)
      ? [value.venue]
      : [];
  return rows.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [{
      venue: stringField(entry, "venue") ?? "UNKNOWN",
      operationalStatus: stringField(entry, "operationalStatus"),
      structuralReadiness: stringField(entry, "structuralReadiness"),
      liveSubmissionSupported: booleanField(entry, "liveSubmissionSupported"),
      liveExecutionEnabled: booleanField(entry, "liveExecutionEnabled"),
      executionSigningModel: stringField(entry, "executionSigningModel"),
      venueAccountConfigured: booleanField(entry, "venueAccountConfigured"),
      activeLinkedAccounts: numberField(entry, "activeLinkedAccounts"),
      blockers: [
        ...arrayStringField(entry, "accountSetupBlockers"),
        ...(isRecord(entry.lastHarnessAttempt) ? arrayStringField(entry.lastHarnessAttempt, "blockers") : [])
      ]
    }];
  });
}

function findSensitiveValues(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findSensitiveValues(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) {
    return [];
  }
  const findings: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isSensitiveKey(key) && child !== null && child !== undefined && String(child).length > 0 && String(child) !== "<redacted>") {
      findings.push(childPath);
      continue;
    }
    findings.push(...findSensitiveValues(child, childPath));
  }
  return findings;
}

function renderMarkdown(artifact: ExecutionVenuesSmokeArtifact): string {
  return [
    "# Admin Execution Venues Smoke",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    `Base URL: ${artifact.baseUrl}`,
    "",
    "| Endpoint | Status | Elapsed ms | Secret Findings |",
    "|---|---:|---:|---|",
    ...artifact.endpoints.map((row) => `| ${row.path} | ${row.statusCode ?? "n/a"} | ${row.elapsedMs} | ${row.secretFindings.length > 0 ? row.secretFindings.join("; ") : "none"} |`),
    "",
    "## Venue Summary",
    "",
    "| Venue | Operational | Structural | Signing | Live Supported | Live Enabled | Accounts | Blockers |",
    "|---|---|---|---|---:|---:|---:|---|",
    ...artifact.endpoints.flatMap((endpoint) => endpoint.venues).map((venue) => [
      venue.venue,
      venue.operationalStatus ?? "n/a",
      venue.structuralReadiness ?? "n/a",
      venue.executionSigningModel ?? "n/a",
      venue.liveSubmissionSupported ?? "n/a",
      venue.liveExecutionEnabled ?? "n/a",
      venue.activeLinkedAccounts ?? "n/a",
      venue.blockers.length > 0 ? venue.blockers.join("; ") : "none"
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Safety",
    "",
    "- This smoke is read-only.",
    "- Full response payloads are not stored.",
    "- Admin JWTs are not stored.",
    "- Secret scanning checks sensitive key names with populated values.",
    ""
  ].join("\n");
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPatterns.some((pattern) => pattern.test(key));
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | null {
  const candidate = value[key];
  return typeof candidate === "boolean" ? candidate : null;
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function arrayStringField(value: Record<string, unknown>, key: string): string[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate.filter((entry): entry is string => typeof entry === "string") : [];
}
