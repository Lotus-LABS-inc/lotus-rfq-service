#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { PredictClient, PredictClientError } from "../src/integrations/predict/predict-client.js";
import type { PredictEnvironment } from "../src/integrations/predict/predict-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  environment: PredictEnvironment;
  maxMarkets: number;
  maxPages: number;
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

  const maxMarkets = Number.parseInt(args.get("maxMarkets") ?? "10", 10);
  const maxPages = Number.parseInt(args.get("maxPages") ?? "10", 10);
  if (!Number.isFinite(maxMarkets) || maxMarkets <= 0) {
    throw new Error("maxMarkets must be a positive integer.");
  }
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    throw new Error("maxPages must be a positive integer.");
  }

  return { environment, maxMarkets, maxPages };
};

const main = async (): Promise<void> => {
  const predictApiKey = process.env.PREDICT_API_KEY;
  if (!predictApiKey) {
    throw new Error("PREDICT_API_KEY is required.");
  }

  const args = parseArgs();
  const client = new PredictClient({
    environment: args.environment,
    apiKey: predictApiKey
  });

  const selected: Array<Record<string, unknown>> = [];
  let scannedMarkets = 0;

  for (let page = 1; page <= args.maxPages && selected.length < args.maxMarkets; page += 1) {
    const markets = await client.getMarkets({ page, limit: 50 });
    if (markets.length === 0) {
      break;
    }

    for (const market of markets) {
      const marketId = String((market as { id?: string | number }).id ?? "");
      if (!marketId) {
        continue;
      }
      scannedMarkets += 1;
      try {
        const orderbook = await client.getMarketOrderbook(marketId);
        selected.push({
          marketId,
          title: (market as { title?: string }).title ?? null,
          status: (market as { status?: string }).status ?? null,
          bestBid: orderbook.bestBid,
          bestAsk: orderbook.bestAsk
        });
      } catch (error) {
        if (error instanceof PredictClientError && error.status === 404) {
          continue;
        }
        throw error;
      }
      if (selected.length >= args.maxMarkets) {
        break;
      }
    }
  }

  console.log(JSON.stringify({
    environment: args.environment,
    scannedMarkets,
    selectedMarkets: selected.length,
    markets: selected
  }, null, 2));
};

main().catch((error) => {
  console.error("Predict live market selection failed.");
  console.error(error);
  process.exit(1);
});
