import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { Pool } from "pg";

import { buildCrossVenueMatchReport } from "./cross-venue-match-report.js";
import { PredictReadinessRepository } from "../../repositories/predict-readiness.repository.js";
import { writeArtifact } from "./shared.js";

const execFileAsync = promisify(execFile);
const DEFAULT_PREDICT_FALLBACK_START = new Date("2026-03-11T00:00:00.000Z");

const extractLastJsonObject = (stdout: string): string => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return "";
  }

  let depth = 0;
  let candidateStart = -1;
  let inString = false;
  let escaping = false;
  const candidates: string[] = [];

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        candidateStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && candidateStart >= 0) {
        candidates.push(trimmed.slice(candidateStart, index + 1));
        candidateStart = -1;
      }
    }
  }

  return candidates.at(-1) ?? trimmed;
};

const parseJsonOutput = (stdout: string): Record<string, unknown> => {
  const candidate = extractLastJsonObject(stdout);
  if (candidate.length === 0) {
    return {};
  }
  return JSON.parse(candidate) as Record<string, unknown>;
};

const executeTsxScript = async (
  repoRoot: string,
  scriptRelativePath: string,
  args: readonly string[]
): Promise<Record<string, unknown>> => {
  const tsxCliPath = path.resolve(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const scriptPath = path.resolve(repoRoot, scriptRelativePath);
  const result = await execFileAsync(process.execPath, [tsxCliPath, scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });
  return parseJsonOutput(result.stdout);
};

const executeTsxScriptSafely = async (
  repoRoot: string,
  scriptRelativePath: string,
  args: readonly string[]
): Promise<Record<string, unknown>> => {
  try {
    const tsxCliPath = path.resolve(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const scriptPath = path.resolve(repoRoot, scriptRelativePath);
    const result = await execFileAsync(process.execPath, [tsxCliPath, scriptPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    try {
      return parseJsonOutput(result.stdout);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      };
    }
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number | string };
    return {
      error: error instanceof Error ? error.message : String(error),
      stdout: result.stdout?.trim() ?? "",
      stderr: result.stderr?.trim() ?? "",
      exitCode: result.code ?? null
    };
  }
};

export interface PredictFocusedEvidenceSummary {
  observedAt: string;
  environment: "mainnet" | "testnet";
  marketIds: readonly string[];
  syncedCurrentState: Record<string, unknown>;
  recorderRun: Record<string, unknown> | null;
  fallbackScan: Record<string, unknown> | null;
  readinessByMarket: ReadonlyArray<{
    marketId: string;
    status: "historical_ready_native" | "historical_ready_fallback" | "current_state_only" | "unusable";
    historicalQualified: boolean;
    reason: string | null;
    currentStateRowCount: number;
    nativeOrderbookSnapshotCount: number;
    nativeMatchEventCount: number;
    recorderCheckpointCount: number;
    fallbackSnapshotCount: number;
    fallbackCoveredWindowCount: number;
  }>;
}

const toFocusedStatus = (state: string): PredictFocusedEvidenceSummary["readinessByMarket"][number]["status"] =>
  state === "HISTORICAL_READY_NATIVE" ? "historical_ready_native"
  : state === "HISTORICAL_READY_FALLBACK" ? "historical_ready_fallback"
  : state === "CURRENT_STATE_ONLY" || state === "RECORDER_ACCUMULATING" ? "current_state_only"
  : "unusable";

const loadRecentVisiblePredictMarketIds = async (
  pool: Pool,
  limit: number = 20
): Promise<readonly string[]> => {
  const result = await pool.query<{ market_id: string }>(
    `SELECT venue_market_id AS market_id
       FROM historical_market_states
      WHERE venue = 'PREDICT'
      GROUP BY venue_market_id
      ORDER BY MAX("timestamp") DESC, venue_market_id ASC
      LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => row.market_id);
};

export const runPredictFocusedEvidence = async (input: {
  repoRoot: string;
  pool: Pool;
  environment: "mainnet" | "testnet";
  marketIds?: readonly string[];
  durationMs?: number;
  recentVisibleLimit?: number;
}): Promise<PredictFocusedEvidenceSummary> => {
  const finalMarketIds = input.marketIds
    ? [...new Set(input.marketIds)].sort((left, right) => left.localeCompare(right))
    : [...new Set([
        ...(await buildCrossVenueMatchReport(input.pool)).matches.flatMap((match) => [
          match.seed.venue === "PREDICT" ? match.seed.venueMarketId : null,
          match.candidate.venue === "PREDICT" ? match.candidate.venueMarketId : null
        ].filter((value): value is string => value !== null)),
        ...(await loadRecentVisiblePredictMarketIds(input.pool, input.recentVisibleLimit ?? 20))
      ])].sort((left, right) => left.localeCompare(right));

  let syncedCurrentState: Record<string, unknown> = {};
  let recorderRun: Record<string, unknown> | null = null;
  let fallbackScan: Record<string, unknown> | null = null;

  if (finalMarketIds.length > 0) {
    syncedCurrentState = await executeTsxScript(
      input.repoRoot,
      "scripts/sync/sync-predict-current-state.ts",
      [`--environment=${input.environment}`, `--marketIds=${finalMarketIds.join(",")}`]
    );

    recorderRun = await executeTsxScriptSafely(
      input.repoRoot,
      "scripts/ingest/record-predict-orderbooks.ts",
      [
        `--environment=${input.environment}`,
        `--marketIds=${finalMarketIds.join(",")}`,
        `--durationMs=${input.durationMs ?? 30000}`,
        `--maxMarkets=${finalMarketIds.length}`
      ]
    );

    fallbackScan = await executeTsxScriptSafely(
      input.repoRoot,
      "scripts/ingest/scan-predict-predexon-fallback-coverage.ts",
      [
        `--environment=${input.environment}`,
        `--marketIds=${finalMarketIds.join(",")}`,
        `--start=${DEFAULT_PREDICT_FALLBACK_START.toISOString()}`,
        `--end=${new Date().toISOString()}`
      ]
    );
  }

  const readinessRepository = new PredictReadinessRepository(input.pool);
  const readinessByMarketMap = await readinessRepository.summarizeReadinessByMarketIds({ marketIds: finalMarketIds });
  const readinessByMarket = finalMarketIds.map((marketId) => {
    const summary = readinessByMarketMap.get(marketId);
    return {
      marketId,
      status: toFocusedStatus(summary?.state ?? "UNUSABLE"),
      historicalQualified: summary?.historicalQualified ?? false,
      reason: summary?.reason ?? null,
      currentStateRowCount: summary?.currentStateRowCount ?? 0,
      nativeOrderbookSnapshotCount: summary?.nativeOrderbookSnapshotCount ?? 0,
      nativeMatchEventCount: summary?.nativeMatchEventCount ?? 0,
      recorderCheckpointCount: summary?.recorderCheckpointCount ?? 0,
      fallbackSnapshotCount: summary?.fallbackSnapshotCount ?? 0,
      fallbackCoveredWindowCount: summary?.fallbackCoveredWindowCount ?? 0
    };
  });

  const summary: PredictFocusedEvidenceSummary = {
    observedAt: new Date().toISOString(),
    environment: input.environment,
    marketIds: finalMarketIds,
    syncedCurrentState,
    recorderRun,
    fallbackScan,
    readinessByMarket
  };

  writeArtifact(input.repoRoot, "docs/predict-focused-evidence-summary.json", summary);
  return summary;
};
