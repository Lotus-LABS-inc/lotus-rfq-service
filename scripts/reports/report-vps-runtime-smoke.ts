import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL";
  url: string;
  httpStatus?: number | undefined;
  durationMs?: number | undefined;
  details?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

const artifactsDir = join(process.cwd(), "artifacts", "runtime");
const artifactJsonPath = join(artifactsDir, "vps-runtime-smoke.json");
const artifactMdPath = join(artifactsDir, "vps-runtime-smoke.md");

const deployment = (process.argv[2] ?? process.env.LOTUS_SMOKE_ENV ?? "staging").trim().toLowerCase();
const apiBaseUrl = trimTrailingSlash(process.env.LOTUS_SMOKE_API_BASE_URL ?? (
  deployment === "prod" || deployment === "production"
    ? "https://api.uselotus.xyz"
    : "https://staging-api.uselotus.xyz"
));
const relayerBaseUrl = trimTrailingSlash(process.env.LOTUS_SMOKE_RELAYER_BASE_URL ?? (
  deployment === "prod" || deployment === "production"
    ? "https://relayer.uselotus.xyz"
    : "https://staging-relayer.uselotus.xyz"
));

const longCuratedMarketId =
  "FRONTEND_CURATED%3ACRYPTO%7CFDV_THRESHOLD_AFTER_LAUNCH%7CEXTENDED%7CONE_DAY_AFTER_LAUNCH%7CABOVE%7C1000000000%7C1B%3APOLYMARKET";

const checks: (() => Promise<CheckResult>)[] = [
  () => checkJson("api_health", `${apiBaseUrl}/health`, (body) =>
    body.status === "ok" || body.ok === true),
  () => checkJson("markets_all_materialized", `${apiBaseUrl}/markets?limit=250&quoteReadyOnly=true&routeCoverage=all&view=compact`, (body) =>
    Number(body.count) >= 50 && body.materialized === true, marketDetails),
  () => checkJson("markets_tri_materialized", `${apiBaseUrl}/markets?limit=250&quoteReadyOnly=true&routeCoverage=tri&view=compact`, (body) =>
    Number(body.count) >= 1 && body.materialized === true, marketDetails),
  () => checkJson("markets_crypto_materialized", `${apiBaseUrl}/markets?category=Crypto&limit=250&quoteReadyOnly=true&routeCoverage=all&view=compact`, (body) =>
    Number(body.count) >= 1 && body.materialized === true, marketDetails),
  () => checkJson("long_curated_market_detail", `${apiBaseUrl}/markets/${longCuratedMarketId}`, (body) =>
    typeof body.market?.canonicalEventId === "string"),
  () => checkJson("long_curated_market_chart", `${apiBaseUrl}/markets/${longCuratedMarketId}/chart?outcomeId=YES&timeframe=ALL`, (body) =>
    Array.isArray(body.points) || Array.isArray(body.series)),
  () => checkJson("long_curated_market_orderbook", `${apiBaseUrl}/markets/${longCuratedMarketId}/orderbook?outcomeId=YES&depth=20`, (body) =>
    Array.isArray(body.venues)),
  () => checkJson("polymarket_relay_health", `${relayerBaseUrl}/polymarket/health`, (body) =>
    body.ok === true && body.service === "polymarket-execution-relay"),
  () => checkJson("predictfun_relay_health", `${relayerBaseUrl}/predictfun/health`, (body) =>
    body.ok === true && body.service === "predictfun-execution-relay")
];

const main = async (): Promise<void> => {
  const startedAt = new Date();
  const results = await Promise.all(checks.map((check) => check()));
  const failed = results.filter((result) => result.status === "FAIL");
  const artifact = {
    generatedAt: new Date().toISOString(),
    deployment,
    apiBaseUrl,
    relayerBaseUrl,
    status: failed.length === 0 ? "PASS" : "FAIL",
    checks: results
  };
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(artifactMdPath, renderMarkdown(artifact, startedAt));
  console.log(JSON.stringify(artifact, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

const checkJson = async (
  name: string,
  url: string,
  predicate: (body: Record<string, unknown>) => boolean,
  details?: (body: Record<string, unknown>) => Record<string, unknown>
): Promise<CheckResult> => {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const durationMs = Date.now() - startedAt;
    const body = await response.json() as Record<string, unknown>;
    const passed = response.ok && predicate(body);
    return {
      name,
      status: passed ? "PASS" : "FAIL",
      url,
      httpStatus: response.status,
      durationMs,
      details: {
        ...(details ? details(body) : {}),
        ...(passed ? {} : { bodyShape: Object.keys(body).slice(0, 20) })
      }
    };
  } catch (error) {
    return {
      name,
      status: "FAIL",
      url,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown smoke check failure."
    };
  }
};

const marketDetails = (body: Record<string, unknown>): Record<string, unknown> => ({
  count: body.count,
  materialized: body.materialized,
  quoteReadinessDegraded: body.quoteReadinessDegraded,
  quoteReadinessReason: body.quoteReadinessReason
});

const renderMarkdown = (
  artifact: {
    generatedAt: string;
    deployment: string;
    apiBaseUrl: string;
    relayerBaseUrl: string;
    status: string;
    checks: CheckResult[];
  },
  startedAt: Date
): string => [
  "# VPS Runtime Smoke",
  "",
  `- Status: ${artifact.status}`,
  `- Deployment: ${artifact.deployment}`,
  `- Started at: ${startedAt.toISOString()}`,
  `- Finished at: ${artifact.generatedAt}`,
  `- API: ${artifact.apiBaseUrl}`,
  `- Relayer: ${artifact.relayerBaseUrl}`,
  "",
  "| Check | Status | HTTP | Duration ms | Details |",
  "| --- | --- | ---: | ---: | --- |",
  ...artifact.checks.map((check) => [
    check.name,
    check.status,
    check.httpStatus ?? "",
    check.durationMs ?? "",
    JSON.stringify(check.details ?? (check.error ? { error: check.error } : {}))
  ].join(" | "))
].join("\n");

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

void main();
