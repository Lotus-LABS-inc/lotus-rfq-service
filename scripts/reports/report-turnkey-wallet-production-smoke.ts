import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  findUnexpectedWalletKeys,
  scanForTurnkeySmokeSecrets,
  summarizeSafeWallet,
  type SafeWalletSummary
} from "../../src/core/funding/turnkey-wallet-smoke-safety.js";

loadDotenv();

type SmokeStatus = "PASSED" | "FAILED";

interface EndpointResult {
  name: string;
  method: "GET" | "POST";
  path: string;
  statusCode: number | null;
  ok: boolean;
  elapsedMs: number;
  topLevelKeys: string[];
  secretFindings: string[];
  error: string | null;
}

interface TurnkeyWalletProductionSmokeArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: SmokeStatus;
  baseUrl: string;
  targetVenue: string;
  source: {
    chain: string;
    token: string;
    amount: string;
    omittedSourceWalletAddress: true;
  };
  requiredRenderEnvChecklist: Array<{ name: string; expected?: string; operatorVerified: boolean }>;
  safety: {
    noSigning: true;
    noBroadcasting: true;
    noVenueDestinationModeSwitch: true;
    noReadyToTradeShortcut: boolean;
    storesSummariesOnly: true;
    redactionScanPassed: boolean;
    unexpectedWalletKeys: string[];
  };
  endpoints: EndpointResult[];
  wallets: {
    firstEnsureCount: number;
    secondEnsureCount: number;
    listCount: number;
    idempotent: boolean;
    summaries: SafeWalletSummary[];
  };
  fundingIntent: {
    fundingIntentId: string | null;
    currentStatus: string | null;
    sourceWalletId: string | null;
    sourceWalletAddress: string | null;
    sourceWalletResolved: boolean;
    readyToTradeShortcutObserved: boolean;
  };
  blockers: string[];
  warnings: string[];
  testIdentity: {
    expectedEmail: string;
    jwtEmail: string | null;
    emailMatched: boolean;
    expectedSubOrgId: string;
    subOrgOperatorVerified: boolean;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const baseUrl = requiredEnv("TURNKEY_SMOKE_BASE_URL").replace(/\/+$/, "");
const userJwt = requiredEnv("TURNKEY_SMOKE_USER_JWT");
const targetVenue = process.env.TURNKEY_SMOKE_TARGET_VENUE?.trim() || "POLYMARKET";
const sourceChain = process.env.TURNKEY_SMOKE_SOURCE_CHAIN?.trim() || "SOLANA";
const sourceToken = process.env.TURNKEY_SMOKE_SOURCE_TOKEN?.trim() || "USDC";
const sourceAmount = process.env.TURNKEY_SMOKE_SOURCE_AMOUNT?.trim() || "1";
const requestTimeoutMs = Number(process.env.TURNKEY_SMOKE_REQUEST_TIMEOUT_MS ?? "30000");
const expectedEmail = process.env.TURNKEY_SMOKE_EXPECTED_EMAIL?.trim() || "polymarket-funding-test@uselotus.xyz";
const expectedSubOrgId = process.env.TURNKEY_SMOKE_EXPECTED_SUB_ORG_ID?.trim() || "94b3ca90-5489-4d0b-9a1f-e9e71ba20ffb";
const subOrgOperatorVerified = process.env.TURNKEY_SMOKE_EXPECTED_SUB_ORG_VERIFIED === "true";
const jwtEmail = emailFromJwt(userJwt);

const endpointResults: EndpointResult[] = [];
const blockers: string[] = [];
const warnings: string[] = [];

const firstEnsure = await requestJson("ensure_defaults_first", "POST", "/user/wallets/ensure-defaults", {});
const firstEnsureRawWallets = walletValuesFromPayload(firstEnsure.payload);
const firstEnsureWallets = firstEnsureRawWallets.map(summarizeSafeWallet);
const secondEnsure = await requestJson("ensure_defaults_second", "POST", "/user/wallets/ensure-defaults", {});
const secondEnsureRawWallets = walletValuesFromPayload(secondEnsure.payload);
const secondEnsureWallets = secondEnsureRawWallets.map(summarizeSafeWallet);
const listWallets = await requestJson("list_wallets", "GET", "/user/wallets");
const listedRawWallets = walletValuesFromPayload(listWallets.payload);
const listedWallets = listedRawWallets.map(summarizeSafeWallet);

const sourceWallet = listedWallets.find((wallet) =>
  wallet.chainFamily === "SOLANA" && wallet.purpose === "DEFAULT_FUNDING" && wallet.status === "ACTIVE"
) ?? secondEnsureWallets.find((wallet) =>
  wallet.chainFamily === "SOLANA" && wallet.purpose === "DEFAULT_FUNDING" && wallet.status === "ACTIVE"
);

const fundingIntent = await requestJson("create_funding_intent", "POST", "/funding/intents", {
  sourceChain,
  sourceToken,
  sourceAmount,
  idempotencyKey: `turnkey-wallet-production-smoke-${new Date().toISOString()}`,
  targets: [{ targetVenue, targetPercentage: 100 }]
});

const allPayloads = [firstEnsure.payload, secondEnsure.payload, listWallets.payload, fundingIntent.payload];
const secretFindings = allPayloads.flatMap((payload, index) =>
  scanForTurnkeySmokeSecrets(payload, `$payloads[${index}]`).findings
);
const unexpectedWalletKeys = [
  ...findUnexpectedWalletKeys(firstEnsureRawWallets),
  ...findUnexpectedWalletKeys(secondEnsureRawWallets),
  ...findUnexpectedWalletKeys(listedRawWallets)
];
const idempotent = walletSignature(firstEnsureWallets) === walletSignature(secondEnsureWallets);
const currentStatus = stringOrNull((fundingIntent.payload as Record<string, unknown> | null)?.currentStatus);
const resolvedSourceWalletId = stringOrNull((fundingIntent.payload as Record<string, unknown> | null)?.sourceWalletId);
const resolvedSourceWalletAddress = stringOrNull((fundingIntent.payload as Record<string, unknown> | null)?.sourceWalletAddress);
const readyToTradeShortcutObserved = currentStatus === "READY_TO_TRADE";

if (!firstEnsure.ok || !secondEnsure.ok || !listWallets.ok || !fundingIntent.ok) {
  blockers.push("One or more Turnkey smoke endpoints did not return 2xx.");
}
if (!idempotent) {
  blockers.push("Turnkey ensure-defaults did not return idempotent wallet identities.");
}
if (!sourceWallet) {
  blockers.push("No active default Solana wallet was returned by ensure/list endpoints.");
}
if (!resolvedSourceWalletId) {
  blockers.push("Funding intent did not bind sourceWalletId.");
}
if (sourceWallet?.walletId && resolvedSourceWalletId && sourceWallet.walletId !== resolvedSourceWalletId) {
  blockers.push("Funding intent sourceWalletId does not match the active default Solana wallet.");
}
if (!resolvedSourceWalletAddress) {
  blockers.push("Funding intent did not return a public sourceWalletAddress.");
}
if (readyToTradeShortcutObserved) {
  blockers.push("Funding intent unexpectedly became READY_TO_TRADE during wallet smoke.");
}
if (secretFindings.length > 0) {
  blockers.push("Secret-like keys were found in endpoint payloads.");
}
if (unexpectedWalletKeys.length > 0) {
  blockers.push("Wallet responses included keys outside the approved public metadata shape.");
}

if (process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED !== "true") {
  warnings.push("Operator has not set TURNKEY_SMOKE_RENDER_ENVS_VERIFIED=true for this smoke run.");
}
if (jwtEmail !== expectedEmail) {
  blockers.push(`Smoke JWT email must be ${expectedEmail}.`);
}
if (!subOrgOperatorVerified) {
  blockers.push(`Operator must verify Turnkey sub-org ${expectedSubOrgId} owns the test wallet and set TURNKEY_SMOKE_EXPECTED_SUB_ORG_VERIFIED=true.`);
}

const generatedAt = new Date().toISOString();
const artifact: TurnkeyWalletProductionSmokeArtifact = {
  artifactSchemaVersion: 1,
  generatedAt,
  status: blockers.length === 0 ? "PASSED" : "FAILED",
  baseUrl,
  targetVenue,
  source: {
    chain: sourceChain,
    token: sourceToken,
    amount: sourceAmount,
    omittedSourceWalletAddress: true
  },
  requiredRenderEnvChecklist: requiredRenderEnvChecklist(),
  safety: {
    noSigning: true,
    noBroadcasting: true,
    noVenueDestinationModeSwitch: true,
    noReadyToTradeShortcut: !readyToTradeShortcutObserved,
    storesSummariesOnly: true,
    redactionScanPassed: secretFindings.length === 0,
    unexpectedWalletKeys
  },
  endpoints: endpointResults,
  wallets: {
    firstEnsureCount: firstEnsureWallets.length,
    secondEnsureCount: secondEnsureWallets.length,
    listCount: listedWallets.length,
    idempotent,
    summaries: listedWallets.map(summarizeSafeWallet)
  },
  fundingIntent: {
    fundingIntentId: stringOrNull((fundingIntent.payload as Record<string, unknown> | null)?.fundingIntentId),
    currentStatus,
    sourceWalletId: resolvedSourceWalletId,
    sourceWalletAddress: resolvedSourceWalletAddress,
    sourceWalletResolved: Boolean(resolvedSourceWalletId && resolvedSourceWalletAddress),
    readyToTradeShortcutObserved
  },
  blockers,
  warnings,
  testIdentity: {
    expectedEmail,
    jwtEmail,
    emailMatched: jwtEmail === expectedEmail,
    expectedSubOrgId,
    subOrgOperatorVerified
  }
};

await mkdir(artifactDir, { recursive: true });
const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
const timestampedPath = join(artifactDir, `turnkey-wallet-production-smoke-${safeTimestamp}.json`);
const latestPath = join(artifactDir, "turnkey-wallet-production-smoke-latest.json");
const markdownPath = join(artifactDir, "turnkey-wallet-production-smoke-latest.md");
await writeFile(timestampedPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(latestPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(artifact), "utf8");

console.log(`Turnkey wallet production smoke: ${artifact.status}`);
console.log(`artifact=${timestampedPath}`);
if (artifact.status !== "PASSED") {
  process.exitCode = 1;
}

async function requestJson(
  name: EndpointResult["name"],
  method: EndpointResult["method"],
  path: string,
  body?: Record<string, unknown>
): Promise<EndpointResult & { payload: unknown | null }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${userJwt}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = parseJson(text);
    const result = {
      name,
      method,
      path,
      statusCode: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAt,
      topLevelKeys: topLevelKeys(payload),
      secretFindings: payload === null ? [] : scanForTurnkeySmokeSecrets(payload).findings,
      error: response.ok ? null : `HTTP_${response.status}`,
      payload
    };
    endpointResults.push(stripPayload(result));
    return result;
  } catch (error) {
    const result = {
      name,
      method,
      path,
      statusCode: null,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      topLevelKeys: [],
      secretFindings: [],
      error: error instanceof Error ? error.message : "unknown",
      payload: null
    };
    endpointResults.push(stripPayload(result));
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function stripPayload(result: EndpointResult & { payload: unknown | null }): EndpointResult {
  const { payload: _payload, ...safeResult } = result;
  return safeResult;
}

function walletValuesFromPayload(payload: unknown): unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.wallets)) {
    return [];
  }
  return payload.wallets;
}

function walletSignature(wallets: SafeWalletSummary[]): string {
  return wallets
    .map((wallet) => `${wallet.walletId}:${wallet.chainFamily}:${wallet.chain}:${wallet.address}:${wallet.purpose}:${wallet.status}`)
    .sort()
    .join("|");
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function topLevelKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requiredRenderEnvChecklist(): TurnkeyWalletProductionSmokeArtifact["requiredRenderEnvChecklist"] {
  return [
    { name: "TURNKEY_ENABLED", expected: "true", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "TURNKEY_API_BASE_URL", expected: "https://api.turnkey.com", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "TURNKEY_ORGANIZATION_ID", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "TURNKEY_API_PUBLIC_KEY", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "TURNKEY_API_PRIVATE_KEY", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "TURNKEY_DEFAULT_SOLANA_WALLET_ENABLED", expected: "true", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "TURNKEY_DEFAULT_EVM_WALLET_ENABLED", expected: "true", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" },
    { name: "<VENUE>_FUNDING_DESTINATION_MODE", expected: "VENUE_DEPOSIT_ENV", operatorVerified: process.env.TURNKEY_SMOKE_RENDER_ENVS_VERIFIED === "true" }
  ];
}

function renderMarkdown(artifact: TurnkeyWalletProductionSmokeArtifact): string {
  return [
    "# Turnkey Wallet Production Smoke",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    `Base URL: ${artifact.baseUrl}`,
    `Target venue: ${artifact.targetVenue}`,
    `Expected test email: ${artifact.testIdentity.expectedEmail}`,
    `JWT email matched: ${artifact.testIdentity.emailMatched}`,
    `Expected Turnkey sub-org verified: ${artifact.testIdentity.subOrgOperatorVerified}`,
    "",
    "## Endpoint Results",
    "",
    "| Step | Method | Path | Status | Elapsed ms | Secret Findings |",
    "|---|---|---|---:|---:|---|",
    ...artifact.endpoints.map((row) => [
      row.name,
      row.method,
      row.path,
      row.statusCode ?? "n/a",
      row.elapsedMs,
      row.secretFindings.length > 0 ? row.secretFindings.join("; ") : "none"
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Wallets",
    "",
    `- First ensure count: ${artifact.wallets.firstEnsureCount}`,
    `- Second ensure count: ${artifact.wallets.secondEnsureCount}`,
    `- Listed count: ${artifact.wallets.listCount}`,
    `- Idempotent: ${artifact.wallets.idempotent}`,
    "",
    "## Funding Intent",
    "",
    `- Funding intent id: ${artifact.fundingIntent.fundingIntentId ?? "none"}`,
    `- Current status: ${artifact.fundingIntent.currentStatus ?? "none"}`,
    `- Source wallet id resolved: ${artifact.fundingIntent.sourceWalletId ?? "none"}`,
    `- Source wallet address resolved: ${artifact.fundingIntent.sourceWalletAddress ?? "none"}`,
    `- READY_TO_TRADE shortcut observed: ${artifact.fundingIntent.readyToTradeShortcutObserved}`,
    "",
    "## Safety",
    "",
    `- No signing: ${artifact.safety.noSigning}`,
    `- No broadcasting: ${artifact.safety.noBroadcasting}`,
    `- No venue destination mode switch: ${artifact.safety.noVenueDestinationModeSwitch}`,
    `- No READY_TO_TRADE shortcut: ${artifact.safety.noReadyToTradeShortcut}`,
    `- Redaction scan passed: ${artifact.safety.redactionScanPassed}`,
    `- Unexpected wallet keys: ${artifact.safety.unexpectedWalletKeys.length > 0 ? artifact.safety.unexpectedWalletKeys.join("; ") : "none"}`,
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
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emailFromJwt(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
    return isRecord(payload) && typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
