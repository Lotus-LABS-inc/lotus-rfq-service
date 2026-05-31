import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { hotPathBlockerTotal, hotPathLatencyMs } from "./metrics.js";

export interface LatencyTags {
  endpoint?: string | undefined;
  canonicalMarketId?: string | undefined;
  venue?: string | undefined;
  routeType?: string | undefined;
  executionMode?: string | undefined;
  cache?: "hit" | "miss" | "none" | "not_implemented" | undefined;
  fundingStatus?: string | undefined;
  laneState?: string | undefined;
  external?: boolean | undefined;
  status?: "ok" | "error" | "blocked" | undefined;
  blockerCategory?: string | undefined;
}

export interface LatencySample {
  generatedAt: string;
  stage: string;
  durationMs: number;
  tags: LatencyTags;
}

const safeValue = (value: string | undefined, fallback: string): string => {
  if (!value) {
    return fallback;
  }
  return value
    .trim()
    .replace(/0x[a-f0-9]{16,}/gi, "0xREDACTED")
    .replace(/[A-Za-z0-9_-]{48,}/g, "REDACTED")
    .replace(/[^A-Za-z0-9_:./-]+/g, "_")
    .slice(0, 120) || fallback;
};

const sanitizeTags = (tags: LatencyTags): LatencyTags => ({
  ...(tags.endpoint ? { endpoint: safeValue(tags.endpoint, "unknown") } : {}),
  ...(tags.canonicalMarketId ? { canonicalMarketId: safeValue(tags.canonicalMarketId, "unknown") } : {}),
  ...(tags.venue ? { venue: safeValue(tags.venue.toUpperCase(), "unknown") } : {}),
  ...(tags.routeType ? { routeType: safeValue(tags.routeType, "unknown") } : {}),
  ...(tags.executionMode ? { executionMode: safeValue(tags.executionMode, "unknown") } : {}),
  ...(tags.cache ? { cache: tags.cache } : {}),
  ...(tags.fundingStatus ? { fundingStatus: safeValue(tags.fundingStatus, "unknown") } : {}),
  ...(tags.laneState ? { laneState: safeValue(tags.laneState, "unknown") } : {}),
  ...(tags.external !== undefined ? { external: tags.external } : {}),
  ...(tags.status ? { status: tags.status } : {}),
  ...(tags.blockerCategory ? { blockerCategory: safeValue(tags.blockerCategory, "unknown") } : {})
});

export const recordLatencyDuration = (
  stage: string,
  durationMs: number,
  tags: LatencyTags = {}
): void => {
  const safeStage = safeValue(stage, "unknown");
  const safeTags = sanitizeTags(tags);
  hotPathLatencyMs.labels(
    safeStage,
    safeTags.endpoint ?? "unknown",
    safeTags.routeType ?? "unknown",
    safeTags.executionMode ?? "unknown",
    String(safeTags.external === true),
    safeTags.cache ?? "none"
  ).observe(Math.max(0, durationMs));

  if (safeTags.blockerCategory) {
    hotPathBlockerTotal.labels(safeStage, safeTags.blockerCategory).inc();
  }

  writeDiagnosticSample({
    generatedAt: new Date().toISOString(),
    stage: safeStage,
    durationMs: Math.round(Math.max(0, durationMs) * 1000) / 1000,
    tags: safeTags
  });
};

export const withLatencyStage = async <T>(
  stage: string,
  tags: LatencyTags,
  callback: () => Promise<T> | T
): Promise<T> => {
  const startedAt = performance.now();
  try {
    const result = await callback();
    recordLatencyDuration(stage, performance.now() - startedAt, { ...tags, status: "ok" });
    return result;
  } catch (error) {
    recordLatencyDuration(stage, performance.now() - startedAt, {
      ...tags,
      status: "error",
      blockerCategory: error instanceof Error ? error.name : "UNKNOWN_ERROR"
    });
    throw error;
  }
};

export const withLatencyStageSync = <T>(
  stage: string,
  tags: LatencyTags,
  callback: () => T
): T => {
  const startedAt = performance.now();
  try {
    const result = callback();
    recordLatencyDuration(stage, performance.now() - startedAt, { ...tags, status: "ok" });
    return result;
  } catch (error) {
    recordLatencyDuration(stage, performance.now() - startedAt, {
      ...tags,
      status: "error",
      blockerCategory: error instanceof Error ? error.name : "UNKNOWN_ERROR"
    });
    throw error;
  }
};

const writeDiagnosticSample = (sample: LatencySample): void => {
  if (process.env.LATENCY_DIAGNOSTICS_ENABLED !== "true") {
    return;
  }
  const outputPath = resolve(
    process.cwd(),
    process.env.LATENCY_DIAGNOSTIC_LOG_PATH ?? "artifacts/latency/latency-samples.jsonl"
  );
  void mkdir(dirname(outputPath), { recursive: true })
    .then(() => appendFile(outputPath, `${JSON.stringify(sample)}\n`, "utf8"))
    .catch(() => undefined);
};
