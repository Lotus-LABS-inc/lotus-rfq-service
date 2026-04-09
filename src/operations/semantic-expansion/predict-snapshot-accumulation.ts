import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { Pool, QueryResultRow } from "pg";

import { PredictClient, PredictClientError } from "../../integrations/predict/predict-client.js";
import { PredictOrderbookAdapter } from "../../integrations/predict/predict-orderbook-adapter.js";
import type { PredictEnvironment } from "../../integrations/predict/predict-types.js";
import { PredictBootstrapRepository } from "../../repositories/predict-bootstrap.repository.js";
import { writeArtifact } from "./shared.js";

const execFileAsync = promisify(execFile);

interface RecentVisiblePredictMarketRow extends QueryResultRow {
  market_id: string;
  title: string | null;
  categories: unknown;
  tags: unknown;
  last_seen_at: Date;
}

type PredictSampleCategory = "CRYPTO" | "SPORTS" | "OTHER";
type PredictAccumulationStatus = "threshold_reached" | "accumulating" | "no_native_orderbook" | "timed_out";

interface PredictAccumulationTarget {
  marketId: string;
  title: string;
  category: PredictSampleCategory;
  lastSeenAt: string;
}

interface PredictAccumulationProgress {
  marketId: string;
  title: string;
  category: PredictSampleCategory;
  targetSnapshotCount: number;
  nativeSnapshotCount: number;
  checkpointCount: number;
  coverageCount: number;
  firstSnapshotAt: string | null;
  latestSnapshotAt: string | null;
  lastRestSuccessAt: string | null;
  lastWsSuccessAt: string | null;
  latestError: string | null;
  consecutiveFailureCount: number;
  status: PredictAccumulationStatus;
}

export interface PredictSnapshotAccumulationSummary {
  observedAt: string;
  environment: PredictEnvironment;
  targetSnapshotCount: number;
  wallClockBudgetMs: number;
  pollIntervalMs: number;
  recorderDurationMs: number;
  targetMarkets: readonly PredictAccumulationTarget[];
  loopIterations: number;
  totalRuntimeMs: number;
  marketsOverThreshold: number;
  marketsWithAnyNativeSnapshots: number;
  marketsWithCheckpointsOnly: number;
  producedRouteabilityRelevantEvidence: boolean;
  syncedCurrentStateRuns: readonly Record<string, unknown>[];
  recorderRuns: readonly Record<string, unknown>[];
  downstream: {
    focusedEvidence: Record<string, unknown> | null;
    semanticExactSync: Record<string, unknown> | null;
    routeabilitySummary: Record<string, unknown> | null;
  };
  markets: readonly PredictAccumulationProgress[];
}

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }
};

const buildPredictText = (input: {
  title: string;
  categories: readonly string[];
  tags: readonly string[];
}): string => `${input.title} ${input.categories.join(" ")} ${input.tags.join(" ")}`.toUpperCase();

const classifyPredictSampleCategory = (input: {
  title: string;
  categories: readonly string[];
  tags: readonly string[];
}): PredictSampleCategory => {
  const text = buildPredictText(input);
  if (/\b(BTC|ETH|BNB|SOL|CRYPTO)\b|USD UP OR DOWN|PRICE FEED|BTC\/USD|ETH\/USD|BNB\/USD/.test(text)) {
    return "CRYPTO";
  }
  if (/\b(NBA|NFL|NHL|MLB|FC|MATCH|STANLEY|FINALS|SPORTS_MATCH)\b|PREMIER LEAGUE|WIN ON|KNICKS|SPURS/.test(text)) {
    return "SPORTS";
  }
  return "OTHER";
};

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
    return await executeTsxScript(repoRoot, scriptRelativePath, args);
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

const loadRecentVisiblePredictMarkets = async (
  pool: Pool,
  environment: PredictEnvironment,
  recentVisibleLimit: number
): Promise<readonly PredictAccumulationTarget[]> => {
  const result = await pool.query<RecentVisiblePredictMarketRow>(
    `WITH recent_visible AS (
        SELECT venue_market_id AS market_id, MAX("timestamp") AS last_seen_at
          FROM historical_market_states
         WHERE venue = 'PREDICT'
         GROUP BY venue_market_id
         ORDER BY MAX("timestamp") DESC, venue_market_id ASC
         LIMIT $2
      ),
      latest_metadata AS (
        SELECT DISTINCT ON (market_id)
               market_id,
               title,
               categories,
               tags,
               updated_at
          FROM predict_market_metadata
         WHERE environment = $1
         ORDER BY market_id ASC, updated_at DESC
      )
      SELECT recent_visible.market_id,
             latest_metadata.title,
             latest_metadata.categories,
             latest_metadata.tags,
             recent_visible.last_seen_at
        FROM recent_visible
        LEFT JOIN latest_metadata
          ON latest_metadata.market_id = recent_visible.market_id
       ORDER BY recent_visible.last_seen_at DESC, recent_visible.market_id ASC`,
    [environment, recentVisibleLimit]
  );

  return result.rows.map((row) => {
    const title = row.title ?? row.market_id;
    const categories = asStringArray(row.categories);
    const tags = asStringArray(row.tags);
    return {
      marketId: row.market_id,
      title,
      category: classifyPredictSampleCategory({ title, categories, tags }),
      lastSeenAt: row.last_seen_at.toISOString()
    };
  });
};

export const selectPredictAccumulationTargets = (
  candidates: readonly PredictAccumulationTarget[],
  sampleSize: number
): readonly PredictAccumulationTarget[] => {
  const quotas: Record<PredictSampleCategory, number> = {
    CRYPTO: 3,
    SPORTS: 3,
    OTHER: 2
  };
  const selected: PredictAccumulationTarget[] = [];
  const selectedIds = new Set<string>();

  for (const category of ["CRYPTO", "SPORTS", "OTHER"] as const) {
    const matches = candidates.filter((candidate) => candidate.category === category);
    for (const candidate of matches.slice(0, quotas[category])) {
      if (!selectedIds.has(candidate.marketId)) {
        selected.push(candidate);
        selectedIds.add(candidate.marketId);
      }
    }
  }

  for (const candidate of candidates) {
    if (selected.length >= sampleSize) {
      break;
    }
    if (!selectedIds.has(candidate.marketId)) {
      selected.push(candidate);
      selectedIds.add(candidate.marketId);
    }
  }

  return selected.slice(0, sampleSize);
};

interface SnapshotCheckpointCountRow extends QueryResultRow {
  market_id: string;
  row_count: string;
  first_recorded_at: Date | null;
  last_recorded_at: Date | null;
}

interface ProgressState {
  lastRestSuccessAt: string | null;
  lastWsSuccessAt: string | null;
  latestError: string | null;
  consecutiveFailureCount: number;
}

const loadSnapshotCounts = async (
  pool: Pool,
  marketIds: readonly string[]
): Promise<ReadonlyMap<string, SnapshotCheckpointCountRow>> => {
  if (marketIds.length === 0) {
    return new Map();
  }
  const result = await pool.query<SnapshotCheckpointCountRow>(
    `SELECT market_id,
            COUNT(*)::text AS row_count,
            MIN(recorded_at) AS first_recorded_at,
            MAX(recorded_at) AS last_recorded_at
       FROM predict_orderbook_snapshots
      WHERE market_id = ANY($1::text[])
      GROUP BY market_id`,
    [marketIds]
  );
  return new Map(result.rows.map((row) => [row.market_id, row]));
};

const loadCheckpointCounts = async (
  pool: Pool,
  marketIds: readonly string[]
): Promise<ReadonlyMap<string, SnapshotCheckpointCountRow>> => {
  if (marketIds.length === 0) {
    return new Map();
  }
  const result = await pool.query<SnapshotCheckpointCountRow>(
    `SELECT market_id,
            COUNT(*)::text AS row_count,
            MIN(updated_at) AS first_recorded_at,
            MAX(updated_at) AS last_recorded_at
       FROM predict_recorder_checkpoints
      WHERE market_id = ANY($1::text[])
      GROUP BY market_id`,
    [marketIds]
  );
  return new Map(result.rows.map((row) => [row.market_id, row]));
};

const summarizeAccumulationStatus = (input: {
  targetSnapshotCount: number;
  nativeSnapshotCount: number;
  wallClockExpired: boolean;
  sawNativeOrderbook: boolean;
}): PredictAccumulationStatus => {
  if (input.nativeSnapshotCount > input.targetSnapshotCount) {
    return "threshold_reached";
  }
  if (input.wallClockExpired) {
    return input.sawNativeOrderbook ? "timed_out" : "no_native_orderbook";
  }
  return "accumulating";
};

export const buildPredictAccumulationMarketProgress = (input: {
  target: PredictAccumulationTarget;
  targetSnapshotCount: number;
  snapshotCount: number;
  checkpointCount: number;
  firstSnapshotAt: string | null;
  latestSnapshotAt: string | null;
  progressState: ProgressState;
  wallClockExpired: boolean;
}): PredictAccumulationProgress => {
  const sawNativeOrderbook = input.snapshotCount > 0 || input.progressState.lastRestSuccessAt !== null;
  return {
    marketId: input.target.marketId,
    title: input.target.title,
    category: input.target.category,
    targetSnapshotCount: input.targetSnapshotCount,
    nativeSnapshotCount: input.snapshotCount,
    checkpointCount: input.checkpointCount,
    coverageCount: input.snapshotCount > 0 ? 1 : 0,
    firstSnapshotAt: input.firstSnapshotAt,
    latestSnapshotAt: input.latestSnapshotAt,
    lastRestSuccessAt: input.progressState.lastRestSuccessAt,
    lastWsSuccessAt: input.progressState.lastWsSuccessAt,
    latestError: input.progressState.latestError,
    consecutiveFailureCount: input.progressState.consecutiveFailureCount,
    status: summarizeAccumulationStatus({
      targetSnapshotCount: input.targetSnapshotCount,
      nativeSnapshotCount: input.snapshotCount,
      wallClockExpired: input.wallClockExpired,
      sawNativeOrderbook
    })
  };
};

const persistIterationCheckpoint = async (input: {
  pool: Pool;
  environment: PredictEnvironment;
  marketId: string;
  iteration: number;
  nativeSnapshotCount: number;
  lastRestSuccessAt: string | null;
  lastWsSuccessAt: string | null;
  consecutiveFailureCount: number;
  latestError: string | null;
}): Promise<void> => {
  await input.pool.query(
    `INSERT INTO predict_recorder_checkpoints (
       recorder_type,
       environment,
       market_id,
       checkpoint_key,
       event_sequence,
       checkpoint_metadata
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (recorder_type, checkpoint_key) DO UPDATE SET
       environment = EXCLUDED.environment,
       market_id = EXCLUDED.market_id,
       event_sequence = EXCLUDED.event_sequence,
       checkpoint_metadata = EXCLUDED.checkpoint_metadata,
       updated_at = NOW()`,
    [
      "ORDERBOOK",
      input.environment,
      input.marketId,
      `accumulation:${input.marketId}`,
      input.iteration,
      JSON.stringify({
        phase: "predict_snapshot_accumulation",
        iteration: input.iteration,
        nativeSnapshotCount: input.nativeSnapshotCount,
        lastRestSuccessAt: input.lastRestSuccessAt,
        lastWsSuccessAt: input.lastWsSuccessAt,
        consecutiveFailureCount: input.consecutiveFailureCount,
        latestError: input.latestError
      })
    ]
  );
};

export const runPredictSnapshotAccumulation = async (input: {
  repoRoot: string;
  pool: Pool;
  environment: PredictEnvironment;
  targetSnapshotCount?: number;
  sampleSize?: number;
  recentVisibleLimit?: number;
  wallClockBudgetMs?: number;
  pollIntervalMs?: number;
  recorderDurationMs?: number;
  marketIds?: readonly string[];
}): Promise<PredictSnapshotAccumulationSummary> => {
  const startedAt = Date.now();
  const targetSnapshotCount = input.targetSnapshotCount ?? 100;
  const sampleSize = input.sampleSize ?? 8;
  const recentVisibleLimit = input.recentVisibleLimit ?? 20;
  const wallClockBudgetMs = input.wallClockBudgetMs ?? 4 * 60 * 60 * 1000;
  const pollIntervalMs = input.pollIntervalMs ?? 5_000;
  const recorderDurationMs = input.recorderDurationMs ?? 5_000;
  const deadlineAt = startedAt + wallClockBudgetMs;
  const predictApiKey = process.env.PREDICT_API_KEY;
  if (!predictApiKey) {
    throw new Error("PREDICT_API_KEY is required.");
  }

  const allCandidates = await loadRecentVisiblePredictMarkets(input.pool, input.environment, recentVisibleLimit);
  const targetMarkets = input.marketIds
    ? allCandidates.filter((candidate) => input.marketIds?.includes(candidate.marketId))
    : selectPredictAccumulationTargets(allCandidates, sampleSize);

  const marketIds = targetMarkets.map((target) => target.marketId);
  const client = new PredictClient({
    environment: input.environment,
    apiKey: predictApiKey
  });
  const orderbookAdapter = new PredictOrderbookAdapter({
    client,
    environment: input.environment
  });
  const bootstrapRepository = new PredictBootstrapRepository(input.pool);
  const progressState = new Map<string, ProgressState>(
    targetMarkets.map((target) => [target.marketId, {
      lastRestSuccessAt: null,
      lastWsSuccessAt: null,
      latestError: null,
      consecutiveFailureCount: 0
    }])
  );
  const syncedCurrentStateRuns: Record<string, unknown>[] = [];
  const recorderRuns: Record<string, unknown>[] = [];

  let loopIterations = 0;

  while (marketIds.length > 0 && Date.now() < deadlineAt) {
    loopIterations += 1;
    syncedCurrentStateRuns.push(
      await executeTsxScript(
        input.repoRoot,
        "scripts/sync/sync-predict-current-state.ts",
        [`--environment=${input.environment}`, `--marketIds=${marketIds.join(",")}`]
      )
    );

    const observedAt = new Date();
    for (const marketId of marketIds) {
      const state = progressState.get(marketId)!;
      try {
        const snapshot = await orderbookAdapter.getOrderbookSnapshot(marketId);
        const hasNativeOrderbook =
          snapshot.bestBid !== null
          || snapshot.bestAsk !== null
          || snapshot.bids.length > 0
          || snapshot.asks.length > 0;

        if (!hasNativeOrderbook) {
          state.consecutiveFailureCount += 1;
          state.latestError = "native_orderbook_empty";
        } else {
          await bootstrapRepository.insertOrderbookSnapshots([{
            environment: snapshot.environment,
            marketId: snapshot.marketId,
            sourceTimestamp: observedAt,
            bestBid: snapshot.bestBid,
            bestAsk: snapshot.bestAsk,
            spread: snapshot.spread,
            midpoint: snapshot.midpoint,
            topOfBookSize: snapshot.topOfBookSize,
            snapshotPayload: {
              ...snapshot.raw,
              accumulationObservedAt: observedAt.toISOString(),
              accumulationIteration: loopIterations
            }
          }]);
          state.lastRestSuccessAt = observedAt.toISOString();
          state.latestError = null;
          state.consecutiveFailureCount = 0;
        }
      } catch (error) {
        if (error instanceof PredictClientError && error.status === 404) {
          state.latestError = "native_orderbook_not_found";
        } else {
          state.latestError = error instanceof Error ? error.message : String(error);
        }
        state.consecutiveFailureCount += 1;
      }
    }

    const recorderRun = await executeTsxScriptSafely(
      input.repoRoot,
      "scripts/ingest/record-predict-orderbooks.ts",
      [
        `--environment=${input.environment}`,
        `--marketIds=${marketIds.join(",")}`,
        `--durationMs=${recorderDurationMs}`,
        `--maxMarkets=${marketIds.length}`
      ]
    );
    recorderRuns.push(recorderRun);
    if (typeof recorderRun.persistedCheckpoints === "number" && recorderRun.persistedCheckpoints > 0) {
      const recordedAt = new Date().toISOString();
      for (const marketId of marketIds) {
        progressState.get(marketId)!.lastWsSuccessAt = recordedAt;
      }
    }

    const snapshotCounts = await loadSnapshotCounts(input.pool, marketIds);
    for (const marketId of marketIds) {
      await persistIterationCheckpoint({
        pool: input.pool,
        environment: input.environment,
        marketId,
        iteration: loopIterations,
        nativeSnapshotCount: Number.parseInt(snapshotCounts.get(marketId)?.row_count ?? "0", 10),
        lastRestSuccessAt: progressState.get(marketId)!.lastRestSuccessAt,
        lastWsSuccessAt: progressState.get(marketId)!.lastWsSuccessAt,
        consecutiveFailureCount: progressState.get(marketId)!.consecutiveFailureCount,
        latestError: progressState.get(marketId)!.latestError
      });
    }

    const allReachedThreshold = targetMarkets.every((target) =>
      Number.parseInt(snapshotCounts.get(target.marketId)?.row_count ?? "0", 10) > targetSnapshotCount
    );
    if (allReachedThreshold) {
      break;
    }

    if (Date.now() + pollIntervalMs >= deadlineAt) {
      break;
    }
    await sleep(pollIntervalMs);
  }

  const snapshotCounts = await loadSnapshotCounts(input.pool, marketIds);
  const checkpointCounts = await loadCheckpointCounts(input.pool, marketIds);
  const wallClockExpired = Date.now() >= deadlineAt;

  const markets = targetMarkets.map((target) =>
    buildPredictAccumulationMarketProgress({
      target,
      targetSnapshotCount,
      snapshotCount: Number.parseInt(snapshotCounts.get(target.marketId)?.row_count ?? "0", 10),
      checkpointCount: Number.parseInt(checkpointCounts.get(target.marketId)?.row_count ?? "0", 10),
      firstSnapshotAt: snapshotCounts.get(target.marketId)?.first_recorded_at?.toISOString() ?? null,
      latestSnapshotAt: snapshotCounts.get(target.marketId)?.last_recorded_at?.toISOString() ?? null,
      progressState: progressState.get(target.marketId)!,
      wallClockExpired
    })
  );

  const downstream = {
    focusedEvidence: await executeTsxScriptSafely(
      input.repoRoot,
      "scripts/batch/run-predict-focused-evidence.ts",
      [`--environment=${input.environment}`]
    ),
    semanticExactSync: await executeTsxScriptSafely(
      input.repoRoot,
      "scripts/sync/sync-canonical-semantic-exacts.ts",
      []
    ),
    routeabilitySummary: await executeTsxScriptSafely(
      input.repoRoot,
      "scripts/reports/report-simulation-routeability-summary.ts",
      []
    )
  };

  const summary: PredictSnapshotAccumulationSummary = {
    observedAt: new Date().toISOString(),
    environment: input.environment,
    targetSnapshotCount,
    wallClockBudgetMs,
    pollIntervalMs,
    recorderDurationMs,
    targetMarkets,
    loopIterations,
    totalRuntimeMs: Date.now() - startedAt,
    marketsOverThreshold: markets.filter((market) => market.nativeSnapshotCount > targetSnapshotCount).length,
    marketsWithAnyNativeSnapshots: markets.filter((market) => market.nativeSnapshotCount > 0).length,
    marketsWithCheckpointsOnly: markets.filter((market) => market.nativeSnapshotCount === 0 && market.checkpointCount > 0).length,
    producedRouteabilityRelevantEvidence: markets.some((market) => market.nativeSnapshotCount > 0),
    syncedCurrentStateRuns,
    recorderRuns,
    downstream,
    markets
  };

  writeArtifact(input.repoRoot, "docs/predict-snapshot-accumulation-summary.json", summary);
  return summary;
};
