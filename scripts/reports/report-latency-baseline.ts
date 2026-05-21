import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { LatencySample } from "../../src/observability/latency.js";

loadDotenv();

interface PercentileSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

interface RankedLatency {
  key: string;
  count: number;
  p99: number | null;
  max: number | null;
}

interface LatencyBaselineReport {
  artifactSchemaVersion: 1;
  generatedAt: string;
  sampleStatus: "NO_SAMPLES" | "SAMPLES_LOADED";
  sampleSource: string;
  metricsSource: string | null;
  thresholds: {
    routePreviewP99Ms: number;
    activeMarketPriceSnapshotP99Ms: number;
    rfqAcceptPreflightP99Ms: number;
  };
  cache: {
    implemented: false;
    hitMissSummary: "not_implemented";
  };
  summaries: {
    byStage: Record<string, PercentileSummary>;
    routePreview: PercentileSummary;
    rfqAcceptPreflight: PercentileSummary;
    externalVenue: Record<string, PercentileSummary>;
    fundingReadiness: PercentileSummary;
  };
  slowest: {
    endpoints: RankedLatency[];
    canonicalMarkets: RankedLatency[];
    venues: RankedLatency[];
  };
  blockers: Array<{ category: string; count: number }>;
  safety: {
    readOnlyReport: true;
    noSecretsIncluded: true;
    externalVenueLatencySeparated: true;
    routePreviewIsNotExecutionAuthority: true;
  };
}

const artifactDir = join(process.cwd(), "artifacts", "latency");
const diagnosticPath = resolve(
  process.cwd(),
  process.env.LATENCY_DIAGNOSTIC_LOG_PATH ?? "artifacts/latency/latency-samples.jsonl"
);
const metricsUrl = normalizeUrl(process.env.LATENCY_METRICS_URL ?? process.env.LOTUS_METRICS_URL ?? "");
const samples = await readSamples(diagnosticPath);
const metricsReachable = metricsUrl ? await checkMetrics(metricsUrl) : null;

const report: LatencyBaselineReport = {
  artifactSchemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sampleStatus: samples.length > 0 ? "SAMPLES_LOADED" : "NO_SAMPLES",
  sampleSource: diagnosticPath,
  metricsSource: metricsReachable,
  thresholds: {
    routePreviewP99Ms: 50,
    activeMarketPriceSnapshotP99Ms: 10,
    rfqAcceptPreflightP99Ms: 100
  },
  cache: {
    implemented: false,
    hitMissSummary: "not_implemented"
  },
  summaries: {
    byStage: summarizeBy(samples, (sample) => sample.stage),
    routePreview: summarize(samples
      .filter((sample) => isRoutePreviewStage(sample.stage))
      .map((sample) => sample.durationMs)),
    rfqAcceptPreflight: summarize(samples
      .filter((sample) => sample.stage === "rfq_accept_preflight")
      .map((sample) => sample.durationMs)),
    externalVenue: summarizeBy(
      samples.filter((sample) => sample.tags.external === true),
      (sample) => sample.tags.venue ?? sample.stage
    ),
    fundingReadiness: summarize(samples
      .filter((sample) => sample.stage.includes("funding"))
      .map((sample) => sample.durationMs))
  },
  slowest: {
    endpoints: rankBy(samples, (sample) => sample.tags.endpoint),
    canonicalMarkets: rankBy(samples, (sample) => sample.tags.canonicalMarketId),
    venues: rankBy(samples, (sample) => sample.tags.venue)
  },
  blockers: summarizeBlockers(samples),
  safety: {
    readOnlyReport: true,
    noSecretsIncluded: true,
    externalVenueLatencySeparated: true,
    routePreviewIsNotExecutionAuthority: true
  }
};

await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, "latency-baseline-summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(artifactDir, "latency-baseline-summary.md"), renderMarkdown(report), "utf8");

console.log(`Latency baseline samples: ${samples.length}`);
console.log(`artifact=${join(artifactDir, "latency-baseline-summary.json")}`);

async function readSamples(path: string): Promise<LatencySample[]> {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as Partial<LatencySample>;
          return typeof parsed.stage === "string" &&
            typeof parsed.durationMs === "number" &&
            parsed.tags &&
            typeof parsed.tags === "object"
            ? [parsed as LatencySample]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function checkMetrics(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok ? url : `${url} unavailable:${response.status}`;
  } catch {
    return `${url} unavailable`;
  }
}

function summarize(values: readonly number[]): PercentileSummary {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.length > 0 ? round(sorted[sorted.length - 1]!) : null
  };
}

function summarizeBy(
  samples: readonly LatencySample[],
  keyFor: (sample: LatencySample) => string | undefined
): Record<string, PercentileSummary> {
  const byKey = new Map<string, number[]>();
  for (const sample of samples) {
    const key = keyFor(sample);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), sample.durationMs]);
  }
  return Object.fromEntries([...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => [
    key,
    summarize(values)
  ]));
}

function rankBy(
  samples: readonly LatencySample[],
  keyFor: (sample: LatencySample) => string | undefined
): RankedLatency[] {
  return Object.entries(summarizeBy(samples, keyFor))
    .map(([key, summary]) => ({
      key,
      count: summary.count,
      p99: summary.p99,
      max: summary.max
    }))
    .sort((left, right) => (right.p99 ?? -1) - (left.p99 ?? -1))
    .slice(0, 10);
}

function summarizeBlockers(samples: readonly LatencySample[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const category = sample.tags.blockerCategory;
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 20);
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.ceil(sorted.length * p) - 1;
  return round(sorted[Math.min(Math.max(index, 0), sorted.length - 1)]!);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isRoutePreviewStage(stage: string): boolean {
  return stage === "route_preview_quote" ||
    stage === "route_preview_live_candidates" ||
    stage === "quote_aggregation_calculation" ||
    stage === "route_optimization";
}

function normalizeUrl(value: string): string {
  return value.trim();
}

function renderMarkdown(report: LatencyBaselineReport): string {
  const byStage = Object.entries(report.summaries.byStage);
  return [
    "# Lotus Latency Baseline",
    "",
    `Generated: ${report.generatedAt}`,
    `Sample status: ${report.sampleStatus}`,
    `Sample source: ${report.sampleSource}`,
    `Metrics source: ${report.metricsSource ?? "not configured"}`,
    "",
    "## Hot Path Targets",
    "",
    `- Route preview p99 target: <${report.thresholds.routePreviewP99Ms}ms`,
    `- Active-market price snapshot p99 target: <${report.thresholds.activeMarketPriceSnapshotP99Ms}ms`,
    `- RFQ accept preflight p99 target: <${report.thresholds.rfqAcceptPreflightP99Ms}ms before venue submit`,
    "",
    "## Summary",
    "",
    `- Route preview p99: ${formatMs(report.summaries.routePreview.p99)}`,
    `- RFQ accept preflight p99: ${formatMs(report.summaries.rfqAcceptPreflight.p99)}`,
    `- Funding readiness p99: ${formatMs(report.summaries.fundingReadiness.p99)}`,
    `- Cache hit/miss: ${report.cache.hitMissSummary}`,
    "",
    "## By Stage",
    "",
    "| Stage | Count | p50 | p95 | p99 | Max |",
    "|---|---:|---:|---:|---:|---:|",
    ...(byStage.length > 0
      ? byStage.map(([stage, summary]) =>
          `| ${stage} | ${summary.count} | ${formatMs(summary.p50)} | ${formatMs(summary.p95)} | ${formatMs(summary.p99)} | ${formatMs(summary.max)} |`)
      : ["| n/a | 0 | n/a | n/a | n/a | n/a |"]),
    "",
    "## Slowest Endpoints",
    "",
    ...renderRanked(report.slowest.endpoints),
    "",
    "## Slowest Canonical Markets",
    "",
    ...renderRanked(report.slowest.canonicalMarkets),
    "",
    "## Slowest Venues",
    "",
    ...renderRanked(report.slowest.venues),
    "",
    "## Blockers",
    "",
    ...(report.blockers.length > 0
      ? report.blockers.map((blocker) => `- ${blocker.category}: ${blocker.count}`)
      : ["- none observed"]),
    "",
    "## Safety",
    "",
    "- External venue latency is separated from internal route-preview latency.",
    "- Route preview is not execution authority.",
    "- This report is read-only and contains no secrets.",
    ""
  ].join("\n");
}

function renderRanked(rows: readonly RankedLatency[]): string[] {
  if (rows.length === 0) {
    return ["- n/a"];
  }
  return rows.map((row) => `- ${row.key}: count=${row.count}, p99=${formatMs(row.p99)}, max=${formatMs(row.max)}`);
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : `${value}ms`;
}
