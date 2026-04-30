import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv();

type SmokeStatus = "PASSED" | "FAILED";

interface EndpointSmokeRow {
  path: string;
  statusCode: number | null;
  ok: boolean;
  elapsedMs: number;
  bodyBytes: number;
  topLevelKeys: string[];
  secretFindings: string[];
  error: string | null;
}

interface AdminApiSmokeArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: SmokeStatus;
  baseUrl: string;
  authMode: "JWT" | "LOGIN_KEY";
  endpoints: EndpointSmokeRow[];
  responseTime: {
    maxMs: number;
    averageMs: number;
  };
  safety: {
    readOnly: true;
    secretScanPassed: boolean;
    noPayloadsStored: true;
    noAdminCredentialStored: true;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "admin");
const endpointPaths = [
  "/admin/ops/summary",
  "/admin/executions",
  "/admin/funding/summary",
  "/admin/funding/readiness/summary",
  "/admin/execution-venues",
  "/admin/monetization/summary",
  "/admin/schema-map"
] as const;

const baseUrl = normalizeBaseUrl(
  process.env.ADMIN_SMOKE_BASE_URL ??
  process.env.ADMIN_API_BASE_URL ??
  process.env.LOTUS_BACKEND_URL ??
  "http://127.0.0.1:3000"
);

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
  /resend[-_]?api[-_]?key/i
];

const auth = await resolveAuth();
const endpoints: EndpointSmokeRow[] = [];

for (const path of endpointPaths) {
  endpoints.push(await smokeEndpoint(path, auth.token));
}

const elapsedValues = endpoints.map((row) => row.elapsedMs);
const secretScanPassed = endpoints.every((row) => row.secretFindings.length === 0);
const status: SmokeStatus = endpoints.every((row) => row.ok) && secretScanPassed ? "PASSED" : "FAILED";
const generatedAt = new Date().toISOString();
const artifact: AdminApiSmokeArtifact = {
  artifactSchemaVersion: 1,
  generatedAt,
  status,
  baseUrl,
  authMode: auth.mode,
  endpoints,
  responseTime: {
    maxMs: elapsedValues.length > 0 ? Math.max(...elapsedValues) : 0,
    averageMs: elapsedValues.length > 0
      ? Number((elapsedValues.reduce((sum, value) => sum + value, 0) / elapsedValues.length).toFixed(2))
      : 0
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
const timestampedPath = join(artifactDir, `admin-api-smoke-${safeTimestamp}.json`);
const latestPath = join(artifactDir, "admin-api-smoke-latest.json");
const markdownPath = join(artifactDir, "admin-api-smoke-latest.md");
await writeFile(timestampedPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(latestPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(artifact), "utf8");

console.log(`Admin API smoke: ${artifact.status}`);
console.log(`artifact=${timestampedPath}`);
if (artifact.status !== "PASSED") {
  process.exitCode = 1;
}

async function resolveAuth(): Promise<{ token: string; mode: AdminApiSmokeArtifact["authMode"] }> {
  const jwt = process.env.ADMIN_SMOKE_JWT?.trim();
  if (jwt) {
    return { token: jwt, mode: "JWT" };
  }

  const email = process.env.ADMIN_SMOKE_EMAIL?.trim();
  const loginKey = process.env.ADMIN_SMOKE_LOGIN_KEY?.trim();
  if (!email || !loginKey) {
    throw new Error("Set ADMIN_SMOKE_JWT, or set ADMIN_SMOKE_EMAIL and ADMIN_SMOKE_LOGIN_KEY.");
  }

  const response = await fetch(`${baseUrl}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, loginKey })
  });
  if (!response.ok) {
    throw new Error(`Admin smoke login failed with HTTP ${response.status}.`);
  }
  const payload = await response.json() as { token?: unknown };
  if (typeof payload.token !== "string" || payload.token.length === 0) {
    throw new Error("Admin smoke login response did not include a JWT.");
  }
  return { token: payload.token, mode: "LOGIN_KEY" };
}

async function smokeEndpoint(path: string, token: string): Promise<EndpointSmokeRow> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = await response.text();
    const elapsedMs = Date.now() - startedAt;
    const parsed = parseJson(text);
    return {
      path,
      statusCode: response.status,
      ok: response.ok,
      elapsedMs,
      bodyBytes: Buffer.byteLength(text, "utf8"),
      topLevelKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).sort()
        : [],
      secretFindings: parsed === null ? [] : findSensitiveValues(parsed),
      error: response.ok ? null : `HTTP_${response.status}`
    };
  } catch (error) {
    return {
      path,
      statusCode: null,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      bodyBytes: 0,
      topLevelKeys: [],
      secretFindings: [],
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

function findSensitiveValues(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findSensitiveValues(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object" || value === null) {
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

function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPatterns.some((pattern) => pattern.test(key));
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function renderMarkdown(artifact: AdminApiSmokeArtifact): string {
  return [
    "# Admin API Smoke",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    `Base URL: ${artifact.baseUrl}`,
    `Auth mode: ${artifact.authMode}`,
    "",
    "| Endpoint | Status | Elapsed ms | Bytes | Secret Findings |",
    "|---|---:|---:|---:|---|",
    ...artifact.endpoints.map((row) => [
      row.path,
      row.statusCode ?? "n/a",
      row.elapsedMs,
      row.bodyBytes,
      row.secretFindings.length > 0 ? row.secretFindings.join("; ") : "none"
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Safety",
    "",
    "- This smoke is read-only.",
    "- Full response payloads are not stored.",
    "- Admin JWTs and login keys are not stored.",
    "- Secret scanning checks sensitive key names with populated values.",
    ""
  ].join("\n");
}
