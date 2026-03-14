#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput
} from "../src/core/historical-simulation/historical-simulation.types.js";
import { HistoricalMarketStateRepository } from "../src/repositories/historical-market-state.repository.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed simulation console preview data.");
}

const metadataVersion = "phase4-preview-seed-v3";
const sportsEventId = "11111111-1111-4111-8111-111111111111";
const cryptoEventId = "22222222-2222-4222-8222-222222222222";

const buildState = (input: CreateHistoricalMarketStateInput): CreateHistoricalMarketStateInput => input;

const seededStates: ReadonlyArray<CreateHistoricalMarketStateInput> = [
  buildState({
    canonicalEventId: sportsEventId,
    canonicalCategory: "SPORTS",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-sports-mlb-yes",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:05:00.000Z"),
    midpoint: "0.54",
    bestBid: "0.53",
    bestAsk: "0.55",
    spread: "0.02",
    lastPrice: "0.54",
    volume: "1200",
    openInterest: "800",
    orderbookSnapshot: {
      market_title: "MLB: Dodgers to win World Series",
      bids: [{ price: "0.53", size: "25" }],
      asks: [{ price: "0.55", size: "20" }]
    },
    candles: {
      points: [{ timestamp: "2026-03-12T12:00:00.000Z", close: "0.54" }]
    },
    metadataVersion,
    sourceTimestamp: new Date("2026-03-12T12:05:00.000Z")
  }),
  buildState({
    canonicalEventId: sportsEventId,
    canonicalCategory: "SPORTS",
    venue: "LIMITLESS",
    venueMarketId: "limitless-sports-mlb-yes",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:05:00.000Z"),
    midpoint: "0.545",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.545",
    volume: "980",
    openInterest: "610",
    orderbookSnapshot: {
      title: "MLB: Dodgers vs Opponent - Winner",
      bids: [],
      asks: []
    },
    candles: {
      points: [{ timestamp: "2026-03-12T12:00:00.000Z", price: "0.545" }]
    },
    marketEvents: {
      events: [{ timestamp: "2026-03-12T12:00:00.000Z", type: "price_update", price: "0.545" }]
    },
    metadataVersion,
    sourceTimestamp: new Date("2026-03-12T12:05:00.000Z")
  }),
  buildState({
    canonicalEventId: cryptoEventId,
    canonicalCategory: "CRYPTO",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-crypto-btc-60k",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:10:00.000Z"),
    midpoint: "0.48",
    bestBid: "0.47",
    bestAsk: "0.49",
    spread: "0.02",
    lastPrice: "0.48",
    volume: "2300",
    openInterest: "1500",
    orderbookSnapshot: {
      market_title: "BTC over $90,000 by March 31, 2026",
      bids: [{ price: "0.47", size: "30" }],
      asks: [{ price: "0.49", size: "30" }]
    },
    trades: {
      trades: [{ timestamp: "2026-03-12T12:05:00.000Z", price: "0.48", size: "5" }]
    },
    metadataVersion,
    sourceTimestamp: new Date("2026-03-12T12:10:00.000Z")
  }),
  buildState({
    canonicalEventId: cryptoEventId,
    canonicalCategory: "CRYPTO",
    venue: "LIMITLESS",
    venueMarketId: "limitless-crypto-btc-60k",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:10:00.000Z"),
    midpoint: "0.475",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.475",
    volume: "2050",
    openInterest: "1410",
    orderbookSnapshot: {
      title: "Bitcoin (BTC) to hit $90k by end of March",
      bids: [],
      asks: []
    },
    candles: {
      points: [{ timestamp: "2026-03-12T12:05:00.000Z", price: "0.475" }]
    },
    ownExecutionHistory: {
      entries: [
        {
          blockTimestamp: "2026-03-12T12:05:00.000Z",
          outcomeTokenPrice: "0.475",
          collateralAmount: "100"
        }
      ]
    },
    metadataVersion,
    sourceTimestamp: new Date("2026-03-12T12:10:00.000Z")
  }),
  buildState({
    canonicalEventId: cryptoEventId,
    canonicalCategory: "CRYPTO",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-crypto-btc-90k-deprecated",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:10:00.000Z"),
    midpoint: "0.45",
    bestBid: "0.44",
    bestAsk: "0.46",
    spread: "0.02",
    lastPrice: "0.45",
    volume: "100",
    openInterest: "50",
    orderbookSnapshot: {
      market_title: "BTC over $90k (Legacy Contract)",
      bids: [{ price: "0.44", size: "10" }],
      asks: [{ price: "0.46", size: "10" }]
    },
    metadataVersion,
    sourceTimestamp: new Date("2026-03-12T12:10:00.000Z")
  })
];

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: "seed-simulation-console-preview"
  });

  try {
    const repository = new HistoricalMarketStateRepository(pool);
    const result = await repository.insertManyIgnoreDuplicates(seededStates);

    console.log("Seeded simulation console preview data.");
    console.log(`Inserted rows: ${result.inserted}`);
    console.log(`Skipped duplicates: ${result.skipped}`);
    console.log("Canonical events now available for the local console:");
    console.log(`- SPORTS: ${sportsEventId}`);
    console.log(`- CRYPTO: ${cryptoEventId}`);
    console.log("Refresh: http://localhost:3000/admin/simulation-console");
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Failed to seed simulation console preview data.");
  console.error(error);
  process.exit(1);
});
