export interface PredictEvidenceCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type PredictEvidenceCommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<PredictEvidenceCommandResult>;

export interface PredictEvidenceProgramRunInput {
  environment: "mainnet" | "testnet";
  commandRunner: PredictEvidenceCommandRunner;
  now?: Date;
  maxMarkets?: number;
  maxPages?: number;
  durationMs?: number;
}

export interface PredictEvidenceProgramSummary {
  environment: "mainnet" | "testnet";
  syncedCurrentState: Record<string, unknown>;
  liveMarketScan: Record<string, unknown>;
  selectedMarketIds: readonly string[];
  recorderRun: Record<string, unknown> | null;
  fallbackScan: Record<string, unknown> | null;
  skippedReason: "no_live_markets_found" | null;
}

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

const runPackageScript = async (
  runner: PredictEvidenceCommandRunner,
  script: string,
  args: readonly string[]
): Promise<Record<string, unknown>> => {
  const result = await runner("npm", ["run", script, "--", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      [result.stderr.trim(), result.stdout.trim(), `${script} failed with exit code ${result.exitCode}.`]
        .filter((value) => value.length > 0)
        .join("\n")
    );
  }
  return parseJsonOutput(result.stdout);
};

const extractSelectedMarketIds = (scanOutput: Record<string, unknown>): readonly string[] => {
  const markets = Array.isArray(scanOutput.markets) ? scanOutput.markets : [];
  return markets
    .map((entry) =>
      typeof entry === "object" && entry !== null && typeof (entry as { marketId?: unknown }).marketId === "string"
        ? (entry as { marketId: string }).marketId
        : null
    )
    .filter((marketId): marketId is string => marketId !== null);
};

export const runPredictEvidenceProgram = async (
  input: PredictEvidenceProgramRunInput
): Promise<PredictEvidenceProgramSummary> => {
  const environmentArgs = [`--environment=${input.environment}`];
  const syncedCurrentState = await runPackageScript(input.commandRunner, "sync:predict:current-state", environmentArgs);
  const liveMarketScan = await runPackageScript(
    input.commandRunner,
    "scan:predict:live-markets",
    [
      ...environmentArgs,
      `--maxMarkets=${input.maxMarkets ?? 10}`,
      `--maxPages=${input.maxPages ?? 10}`
    ]
  );
  const selectedMarketIds = extractSelectedMarketIds(liveMarketScan);

  if (selectedMarketIds.length === 0) {
    return {
      environment: input.environment,
      syncedCurrentState,
      liveMarketScan,
      selectedMarketIds,
      recorderRun: null,
      fallbackScan: null,
      skippedReason: "no_live_markets_found"
    };
  }

  const recorderRun = await runPackageScript(
    input.commandRunner,
    "record:predict:orderbooks",
    [
      ...environmentArgs,
      `--marketIds=${selectedMarketIds.join(",")}`,
      `--durationMs=${input.durationMs ?? 60000}`,
      `--maxMarkets=${selectedMarketIds.length}`
    ]
  );

  const fallbackScan = await runPackageScript(
    input.commandRunner,
    "scan:predict:predexon-fallback",
    [
      ...environmentArgs,
      `--marketIds=${selectedMarketIds.join(",")}`,
      `--start=${DEFAULT_PREDICT_FALLBACK_START.toISOString()}`,
      `--end=${(input.now ?? new Date()).toISOString()}`
    ]
  );

  return {
    environment: input.environment,
    syncedCurrentState,
    liveMarketScan,
    selectedMarketIds,
    recorderRun,
    fallbackScan,
    skippedReason: null
  };
};
