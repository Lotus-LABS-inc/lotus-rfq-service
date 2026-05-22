import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type EnvMap = Record<string, string>;

type EnvClassification =
  | "secret_or_sensitive"
  | "public_static_default"
  | "public_rollout_or_safety"
  | "public_deploy_config"
  | "private_provider_endpoint"
  | "review";

interface EnvAuditRow {
  key: string;
  classification: EnvClassification;
  presentLocal: boolean;
  presentExample: boolean;
  presentRender: boolean;
  knownDefault: boolean;
  localMatchesDefault: boolean | null;
  renderMatchesDefault: boolean | null;
  recommendation: string;
}

interface EnvAuditReport {
  generatedAt: string;
  localEnvPath: string;
  renderServiceId: string | null;
  renderChecked: boolean;
  renderError: string | null;
  counts: Record<string, number>;
  rows: EnvAuditRow[];
}

const DEFAULT_RENDER_SERVICE_ID = "srv-d7nobb3eo5us73ff246g";

const KNOWN_PUBLIC_DEFAULTS: Record<string, string> = {
  LIFI_API_BASE_URL: "https://li.quest/v1",
  LIFI_QUOTE_TIMEOUT_MS: "10000",
  LIFI_QUOTE_TTL_SECONDS: "60",
  LIMITLESS_BALANCE_PREFLIGHT_RPC_FALLBACK_URLS: "https://mainnet.base.org",
  MARKET_ORDERBOOK_RECORDER_ENABLED: "false",
  OPINION_CLOB_BASE_URL: "https://proxy.opinion.trade:8443/openapi",
  OPINION_EXECUTION_MODE: "disabled",
  OPINION_LIVE_EXECUTION_ENABLED: "false",
  OPINION_OPENAPI_BASE_URL: "https://openapi.opinion.trade/openapi",
  OPINION_OPS_FUNDING_BALANCE_MODE: "DISABLED",
  PREDICT_FUN_FUNDING_DESTINATION_MODE: "USER_VENUE_DEPOSIT_WALLET"
};

const SAFETY_OR_ROLLOUT_KEYS = new Set([
  "FUNDING_LIFI_QUOTES_ENABLED",
  "FUNDING_LIVE_SUBMIT_ENABLED",
  "LIFI_LIVE_EXECUTION_ENABLED",
  "MARKET_ORDERBOOK_RECORDER_ENABLED",
  "OPINION_EXECUTION_MODE",
  "OPINION_LIVE_EXECUTION_ENABLED",
  "OPINION_OPS_FUNDING_BALANCE_MODE"
]);

const SECRET_KEY_PATTERN =
  /(SECRET|PRIVATE|PASSWORD|API_KEY|PASSPHRASE|JWT|DATABASE_URL|REDIS_URL|HMAC|PEPPER|BEARER|CLIENT_SECRET|RENDER_API_KEY|SIGN_WITH)/i;

const parseDotEnv = async (path: string): Promise<EnvMap> => {
  const text = await readFile(path, "utf8").catch(() => "");
  const env: EnvMap = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const fetchRenderEnv = async (
  apiKey: string | undefined,
  serviceId: string
): Promise<{ env: EnvMap; error: string | null }> => {
  if (!apiKey?.trim()) {
    return { env: {}, error: "RENDER_API_KEY not configured; skipped Render env read." };
  }
  try {
    const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey.trim()}`
      }
    });
    if (!response.ok) {
      return { env: {}, error: `Render env read failed with HTTP ${response.status}.` };
    }
    const payload = await response.json() as Array<{ envVar?: { key?: string; value?: string }; key?: string; value?: string }>;
    const env: EnvMap = {};
    for (const row of payload) {
      const key = row.envVar?.key ?? row.key;
      const value = row.envVar?.value ?? row.value ?? "";
      if (key) {
        env[key] = value;
      }
    }
    return { env, error: null };
  } catch (error) {
    return {
      env: {},
      error: error instanceof Error ? error.message : "Render env read failed."
    };
  }
};

const classifyKey = (key: string, value: string | undefined): EnvClassification => {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "secret_or_sensitive";
  }
  if (key.endsWith("_RPC_URL") && /alchemy|infura|quicknode|chainstack|drpc|blastapi|getblock|moralis/i.test(value ?? "")) {
    return "private_provider_endpoint";
  }
  if (SAFETY_OR_ROLLOUT_KEYS.has(key)) {
    return "public_rollout_or_safety";
  }
  if (Object.hasOwn(KNOWN_PUBLIC_DEFAULTS, key)) {
    return "public_static_default";
  }
  if (/_URL$|_BASE_URL$|_HOST$|_PATH$|_MODE$|_ENABLED$|_TIMEOUT_MS$|_TTL_SECONDS$|_CHAIN_ID$|_TOKEN_ADDRESS$|_ADDRESS$|_BPS$|_VERSION$|_ORIGINS$/u.test(key)) {
    return "public_deploy_config";
  }
  return "review";
};

const recommendationFor = (row: Omit<EnvAuditRow, "recommendation">): string => {
  if (row.classification === "secret_or_sensitive" || row.classification === "private_provider_endpoint") {
    return "keep_env_only";
  }
  if (row.classification === "public_rollout_or_safety") {
    return "keep_explicit_in_render";
  }
  if (row.presentRender && row.knownDefault && row.renderMatchesDefault) {
    return "render_env_redundant_with_code_default";
  }
  if (row.knownDefault && row.presentLocal && row.localMatchesDefault) {
    return "local_env_redundant_with_code_default";
  }
  if (row.key.startsWith("VITE_") && row.classification === "secret_or_sensitive") {
    return "remove_from_frontend_public_env";
  }
  return "review";
};

const buildReport = async (): Promise<EnvAuditReport> => {
  const localEnvPath = process.env.ENV_AUDIT_LOCAL_ENV_PATH ?? ".env";
  const localEnv = await parseDotEnv(localEnvPath);
  const exampleEnv = await parseDotEnv(".env.example");
  const renderServiceId = process.env.RENDER_SERVICE_ID ?? process.env.LOTUS_RENDER_BACKEND_SERVICE_ID ?? DEFAULT_RENDER_SERVICE_ID;
  const renderResult = await fetchRenderEnv(localEnv.RENDER_API_KEY ?? process.env.RENDER_API_KEY, renderServiceId);
  const keys = Array.from(new Set([
    ...Object.keys(localEnv),
    ...Object.keys(exampleEnv),
    ...Object.keys(renderResult.env),
    ...Object.keys(KNOWN_PUBLIC_DEFAULTS)
  ])).sort();

  const rows = keys.map((key): EnvAuditRow => {
    const defaultValue = KNOWN_PUBLIC_DEFAULTS[key];
    const bestAvailableValue = renderResult.env[key] ?? localEnv[key] ?? exampleEnv[key];
    const partial = {
      key,
      classification: classifyKey(key, bestAvailableValue),
      presentLocal: Object.hasOwn(localEnv, key),
      presentExample: Object.hasOwn(exampleEnv, key),
      presentRender: Object.hasOwn(renderResult.env, key),
      knownDefault: Object.hasOwn(KNOWN_PUBLIC_DEFAULTS, key),
      localMatchesDefault: defaultValue === undefined || !Object.hasOwn(localEnv, key) ? null : localEnv[key] === defaultValue,
      renderMatchesDefault: defaultValue === undefined || !Object.hasOwn(renderResult.env, key) ? null : renderResult.env[key] === defaultValue
    };
    return {
      ...partial,
      recommendation: recommendationFor(partial)
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    acc[row.recommendation] = (acc[row.recommendation] ?? 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    localEnvPath,
    renderServiceId,
    renderChecked: renderResult.error === null,
    renderError: renderResult.error,
    counts,
    rows
  };
};

const renderMarkdown = (report: EnvAuditReport): string => {
  const redundantRender = report.rows.filter((row) => row.recommendation === "render_env_redundant_with_code_default");
  const frontendPublicSecrets = report.rows.filter((row) => row.key.startsWith("VITE_") && row.classification === "secret_or_sensitive");
  const keepEnv = report.rows.filter((row) => row.recommendation === "keep_env_only");
  const rollout = report.rows.filter((row) => row.recommendation === "keep_explicit_in_render");

  return [
    "# Env Audit Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Local env path: ${report.localEnvPath}`,
    `Render service: ${report.renderServiceId ?? "not configured"}`,
    `Render checked: ${report.renderChecked ? "yes" : "no"}`,
    report.renderError ? `Render note: ${report.renderError}` : "",
    "",
    "## Counts",
    "",
    ...Object.entries(report.counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Redundant Render Env Candidates",
    "",
    ...(redundantRender.length === 0 ? ["None."] : redundantRender.map((row) => `- ${row.key}`)),
    "",
    "## Frontend-Public Secret-Looking Keys",
    "",
    ...(frontendPublicSecrets.length === 0 ? ["None."] : frontendPublicSecrets.map((row) => `- ${row.key}`)),
    "",
    "## Keep Env-Only",
    "",
    ...(keepEnv.length === 0 ? ["None."] : keepEnv.map((row) => `- ${row.key}`)),
    "",
    "## Keep Explicit In Render",
    "",
    ...(rollout.length === 0 ? ["None."] : rollout.map((row) => `- ${row.key}`)),
    ""
  ].filter((line) => line !== "").join("\n");
};

const artifactDir = join("artifacts", "env");
await mkdir(artifactDir, { recursive: true });
const report = await buildReport();
await writeFile(join(artifactDir, "env-audit-summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(artifactDir, "env-audit-summary.md"), `${renderMarkdown(report)}\n`, "utf8");

console.log(`Env audit written to ${join(artifactDir, "env-audit-summary.md")}`);
