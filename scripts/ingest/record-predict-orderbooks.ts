#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { PredictClient, PredictClientError } from "../../src/integrations/predict/predict-client.js";
import { PredictOrderbookAdapter } from "../../src/integrations/predict/predict-orderbook-adapter.js";
import type { PredictEnvironment, PredictNormalizedOrderbookSnapshot, PredictOrderbookLevel } from "../../src/integrations/predict/predict-types.js";
import { PredictWsClient, type PredictWsEnvelope } from "../../src/integrations/predict/predict-ws-client.js";
import { PredictOrderbookRecorder } from "../../src/recorders/predict-orderbook-recorder.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  environment: PredictEnvironment;
  durationMs: number;
  marketIds: readonly string[] | null;
  maxMarkets: number;
}

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) continue;
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }
  const environment = (args.get("environment") ?? "mainnet") as PredictEnvironment;
  if (environment !== "mainnet" && environment !== "testnet") {
    throw new Error(`Invalid Predict environment: ${environment}`);
  }
  const durationMs = Number.parseInt(args.get("durationMs") ?? "60000", 10);
  const maxMarkets = Number.parseInt(args.get("maxMarkets") ?? "5", 10);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("durationMs must be positive.");
  if (!Number.isFinite(maxMarkets) || maxMarkets <= 0) throw new Error("maxMarkets must be positive.");
  const marketIdsArg = args.get("marketIds");
  const marketIds = marketIdsArg
    ? [...new Set(marketIdsArg.split(",").map((value) => value.trim()).filter((value) => value.length > 0))]
    : null;
  return { environment, durationMs, marketIds, maxMarkets };
};

const databaseUrl = process.env.DATABASE_URL;
const predictApiKey = process.env.PREDICT_API_KEY;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!predictApiKey) throw new Error("PREDICT_API_KEY is required.");

const resolveWsBaseUrl = (environment: PredictEnvironment): string =>
  environment === "mainnet"
    ? process.env.PREDICT_WS_MAINNET_URL ?? "wss://ws.predict.fun/ws"
    : process.env.PREDICT_WS_TESTNET_URL ?? "wss://ws-testnet.predict.fun/ws";

const ensureWsUrl = (baseUrl: string, apiKey: string): string => {
  const url = new URL(baseUrl.endsWith("/ws") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/ws`);
  if (!url.searchParams.has("apiKey")) {
    url.searchParams.set("apiKey", apiKey);
  }
  return url.toString();
};

const stderrLogger = {
  info: (...args: readonly unknown[]) => {
    console.error(...args);
  },
  warn: (...args: readonly unknown[]) => {
    console.error(...args);
  },
  error: (...args: readonly unknown[]) => {
    console.error(...args);
  }
};

const normalizeLevels = (levels: unknown): readonly PredictOrderbookLevel[] => {
  if (!Array.isArray(levels)) {
    return [];
  }
  return levels
    .map((entry) => {
      if (Array.isArray(entry) && entry.length >= 2) {
        return {
          price: String(entry[0]),
          size: String(entry[1]),
          raw: { price: entry[0], size: entry[1] }
        };
      }
      if (typeof entry === "object" && entry !== null) {
        const record = entry as Record<string, unknown>;
        if ((typeof record.price === "string" || typeof record.price === "number")
          && (typeof record.size === "string" || typeof record.size === "number")) {
          return {
            price: String(record.price),
            size: String(record.size),
            raw: record
          };
        }
      }
      return null;
    })
    .filter((value): value is PredictOrderbookLevel => value !== null);
};

const toTimestamp = (value: unknown, receivedAt: Date): Date => {
  if (typeof value === "number") {
    return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  return receivedAt;
};

const buildOrderbookNormalizer = (environment: PredictEnvironment) => (envelope: PredictWsEnvelope): PredictNormalizedOrderbookSnapshot | null => {
  const topic = typeof envelope.payload.topic === "string" ? envelope.payload.topic : null;
  if (!topic?.startsWith("predictOrderbook/")) {
    return null;
  }
  const marketId = topic.split("/")[1];
  if (!marketId) {
    return null;
  }
  const payload = typeof envelope.payload.data === "object" && envelope.payload.data !== null
    ? envelope.payload.data as Record<string, unknown>
    : envelope.payload;
  const bids = normalizeLevels(payload.bids);
  const asks = normalizeLevels(payload.asks);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    venue: "PREDICT",
    environment,
    marketId,
    sourceTimestamp: toTimestamp(payload.updateTimestampMs ?? payload.timestamp, envelope.receivedAt),
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid !== null && bestAsk !== null ? String(Number(bestAsk) - Number(bestBid)) : null,
    midpoint: bestBid !== null && bestAsk !== null ? String((Number(bestAsk) + Number(bestBid)) / 2) : null,
    topOfBookSize: bids[0] && asks[0] ? String(Number(bids[0].size) + Number(asks[0].size)) : null,
    raw: envelope.payload
  };
};

const subscriptionRequestFactory = (wsClient: PredictWsClient) => (topics: readonly string[]) => ({
  method: "subscribe",
  requestId: wsClient.nextRequestId(),
  params: topics,
  data: null
});

const selectLiveMarketIds = async (
  client: PredictClient,
  maxMarkets: number
): Promise<readonly string[]> => {
  const selected: string[] = [];
  for (let page = 1; page <= 10 && selected.length < maxMarkets; page += 1) {
    const markets = await client.getMarkets({ page, limit: 50 });
    if (markets.length === 0) break;
    for (const market of markets) {
      const marketId = String((market as { id?: string | number }).id ?? "");
      if (!marketId) continue;
      try {
        await client.getMarketOrderbook(marketId);
        selected.push(marketId);
      } catch (error) {
        if (error instanceof PredictClientError && error.status === 404) {
          continue;
        }
      }
      if (selected.length >= maxMarkets) break;
    }
  }
  return [...new Set(selected)];
};

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "record-predict-orderbooks"
  });
  const client = new PredictClient({
    environment: args.environment,
    apiKey: predictApiKey
  });
  const orderbookAdapter = new PredictOrderbookAdapter({
    client,
    environment: args.environment
  });
  const marketIds = args.marketIds ?? await selectLiveMarketIds(client, args.maxMarkets);
  if (marketIds.length === 0) {
    process.stdout.write(`${JSON.stringify({
      environment: args.environment,
      selectedMarkets: 0,
      reason: "no_recordable_predict_markets_found"
    }, null, 2)}\n`);
    await pool.end();
    return;
  }

  const wsClient = new PredictWsClient({
    environment: args.environment,
    url: ensureWsUrl(resolveWsBaseUrl(args.environment), predictApiKey),
    logger: stderrLogger
  });
  const recorder = new PredictOrderbookRecorder({
    pool,
    wsClient,
    environment: args.environment,
    normalizeSnapshot: buildOrderbookNormalizer(args.environment),
    subscriptionRequestFactory: subscriptionRequestFactory(wsClient),
    topicToMarketId: (topic) => topic.split("/")[1] ?? null,
    bootstrapSnapshotLoader: async (marketId) => {
      try {
        const snapshot = await orderbookAdapter.getOrderbookSnapshot(marketId);
        return snapshot.bestBid === null && snapshot.bestAsk === null && snapshot.bids.length === 0 && snapshot.asks.length === 0
          ? null
          : snapshot;
      } catch (error) {
        if (error instanceof PredictClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    }
  });

  const beforeResult = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM predict_orderbook_snapshots`);
  await recorder.start(marketIds.map((marketId) => `predictOrderbook/${marketId}`));
  await sleep(args.durationMs);
  recorder.stop();
  wsClient.disconnect();
  const checkpointsPersisted = await recorder.flushCheckpoints();
  const afterResult = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM predict_orderbook_snapshots`);

  process.stdout.write(`${JSON.stringify({
    environment: args.environment,
    durationMs: args.durationMs,
    selectedMarkets: marketIds,
    insertedSnapshots: Number(afterResult.rows[0]?.count ?? "0") - Number(beforeResult.rows[0]?.count ?? "0"),
    persistedCheckpoints: checkpointsPersisted,
    checkpointCount: recorder.getCheckpoints().length
  }, null, 2)}\n`);

  await pool.end();
};

main().catch((error) => {
  console.error("Failed to record Predict orderbooks.");
  console.error(error);
  process.exit(1);
});
