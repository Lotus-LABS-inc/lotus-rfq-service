#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput
} from "../../src/core/historical-simulation/historical-simulation.types.js";
import { HistoricalMarketStateRepository } from "../../src/repositories/historical-market-state.repository.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
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
const politicsEventId = "66666666-6666-4666-8666-666666666666";
const esportsEventId = "77777777-7777-4777-8777-777777777777";
const sportsPolymarketCanonicalMarketId = "POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN";
const sportsLimitlessCanonicalMarketId = "LIMITLESS-MLB-DODGERS-GAME-WINNER";
const sportsOpinionCanonicalMarketId = "OPINION-MLB-DODGERS-WORLD-SERIES-WIN";
const cryptoPolymarketCanonicalMarketId = "POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31";
const cryptoLimitlessCanonicalMarketId = "LIMITLESS-BTC-ABOVE-90K";
const cryptoOpinionCanonicalMarketId = "OPINION-BTC-ABOVE-90K-BY-2026-03-31";
const politicsPolymarketDemCanonicalMarketId = "POLYMARKET-2028-DEM-NOM-GAVIN-NEWSOM";
const politicsDemocraticWinsCanonicalMarketId = "US-ELECTION-2028-DEMOCRATIC-WINS";
const politicsPolymarketGopCanonicalMarketId = "POLYMARKET-2028-GOP-NOM-MIKE-PENCE";
const politicsRepublicanWinsCanonicalMarketId = "US-ELECTION-2028-REPUBLICAN-WINS";
const esportsPolymarketT1CanonicalMarketId = "POLYMARKET-LOL-WORLDS-2026-LCK-TEAM-WINS";
const esportsT1WinsCanonicalMarketId = "LOL-WORLDS-2026-T1-WINS";
const esportsPolymarketGengCanonicalMarketId = "POLYMARKET-LOL-2026-GENG-GOLDEN-ROAD";
const esportsGengWinsCanonicalMarketId = "LOL-WORLDS-2026-GENG-WINS";

const buildState = (input: CreateHistoricalMarketStateInput): CreateHistoricalMarketStateInput => input;

const seededStates: ReadonlyArray<CreateHistoricalMarketStateInput> = [
  buildState({
    canonicalEventId: sportsEventId,
    canonicalCategory: "SPORTS",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-sports-mlb-yes",
    canonicalMarketId: sportsPolymarketCanonicalMarketId,
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
      market_title: "Lakers vs. Magic",
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
    canonicalMarketId: sportsLimitlessCanonicalMarketId,
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
    canonicalEventId: sportsEventId,
    canonicalCategory: "SPORTS",
    venue: "OPINION",
    venueMarketId: "opinion-sports-mlb-yes",
    canonicalMarketId: sportsOpinionCanonicalMarketId,
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:05:00.000Z"),
    midpoint: "0.542",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.542",
    volume: "1110",
    openInterest: "760",
    orderbookSnapshot: {
      title: "Dodgers win World Series"
    },
    candles: {
      series: [
        {
          timeframe: "24h",
          points: [{ timestamp: "2026-03-12T12:00:00.000Z", price: "0.542" }]
        }
      ]
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
      market_title: "Bitcoin all time high by March 31, 2026?",
      bids: [{ price: "0.47", size: "30" }],
      asks: [{ price: "0.49", size: "30" }]
    },
    metadataVersion,
    canonicalMarketId: cryptoPolymarketCanonicalMarketId,
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
      title: "BTC over $90k",
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
    canonicalMarketId: cryptoLimitlessCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:10:00.000Z")
  }),
  buildState({
    canonicalEventId: cryptoEventId,
    canonicalCategory: "CRYPTO",
    venue: "OPINION",
    venueMarketId: "opinion-crypto-btc-90k",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:10:00.000Z"),
    midpoint: "0.478",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.478",
    volume: "1875",
    openInterest: "1325",
    orderbookSnapshot: {
      title: "BTC over $90k by March 31, 2026"
    },
    candles: {
      series: [
        {
          timeframe: "24h",
          points: [{ timestamp: "2026-03-12T12:10:00.000Z", price: "0.478" }]
        }
      ]
    },
    metadataVersion,
    canonicalMarketId: cryptoOpinionCanonicalMarketId,
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
    canonicalMarketId: "BTC-90K-LEGACY",
    sourceTimestamp: new Date("2026-03-12T12:10:00.000Z")
  }),
  buildState({
    canonicalEventId: politicsEventId,
    canonicalCategory: "POLITICS",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-politics-us-election-dem",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:15:00.000Z"),
    midpoint: "0.57",
    bestBid: "0.56",
    bestAsk: "0.58",
    spread: "0.02",
    lastPrice: "0.57",
    volume: "4100",
    openInterest: "2200",
    orderbookSnapshot: {
      market_title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
      bids: [{ price: "0.56", size: "40" }],
      asks: [{ price: "0.58", size: "35" }]
    },
    metadataVersion,
    canonicalMarketId: politicsPolymarketDemCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:15:00.000Z")
  }),
  buildState({
    canonicalEventId: politicsEventId,
    canonicalCategory: "POLITICS",
    venue: "LIMITLESS",
    venueMarketId: "limitless-politics-us-election-dem",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:15:00.000Z"),
    midpoint: "0.565",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.565",
    volume: "3950",
    openInterest: "2140",
    orderbookSnapshot: {
      title: "US Election 2028: Democratic party wins"
    },
    metadataVersion,
    canonicalMarketId: politicsDemocraticWinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:15:00.000Z")
  }),
  buildState({
    canonicalEventId: politicsEventId,
    canonicalCategory: "POLITICS",
    venue: "OPINION",
    venueMarketId: "opinion-politics-us-election-dem",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:15:00.000Z"),
    midpoint: "0.568",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.568",
    volume: "3620",
    openInterest: "2050",
    orderbookSnapshot: {
      title: "US Election 2028: Democratic party wins"
    },
    metadataVersion,
    canonicalMarketId: politicsDemocraticWinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:15:00.000Z")
  }),
  buildState({
    canonicalEventId: politicsEventId,
    canonicalCategory: "POLITICS",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-politics-us-election-gop",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:20:00.000Z"),
    midpoint: "0.43",
    bestBid: "0.42",
    bestAsk: "0.44",
    spread: "0.02",
    lastPrice: "0.43",
    volume: "3800",
    openInterest: "2080",
    orderbookSnapshot: {
      market_title: "Will Mike Pence win the 2028 Republican presidential nomination?",
      bids: [{ price: "0.42", size: "38" }],
      asks: [{ price: "0.44", size: "30" }]
    },
    metadataVersion,
    canonicalMarketId: politicsPolymarketGopCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:20:00.000Z")
  }),
  buildState({
    canonicalEventId: politicsEventId,
    canonicalCategory: "POLITICS",
    venue: "LIMITLESS",
    venueMarketId: "limitless-politics-us-election-gop",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:20:00.000Z"),
    midpoint: "0.435",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.435",
    volume: "3725",
    openInterest: "2015",
    orderbookSnapshot: {
      title: "US Election 2028: Republican party wins"
    },
    metadataVersion,
    canonicalMarketId: politicsRepublicanWinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:20:00.000Z")
  }),
  buildState({
    canonicalEventId: politicsEventId,
    canonicalCategory: "POLITICS",
    venue: "OPINION",
    venueMarketId: "opinion-politics-us-election-gop",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:20:00.000Z"),
    midpoint: "0.432",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.432",
    volume: "3440",
    openInterest: "1960",
    orderbookSnapshot: {
      title: "US Election 2028: Republican party wins"
    },
    metadataVersion,
    canonicalMarketId: politicsRepublicanWinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:20:00.000Z")
  }),
  buildState({
    canonicalEventId: esportsEventId,
    canonicalCategory: "ESPORTS",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-esports-lol-t1",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:25:00.000Z"),
    midpoint: "0.61",
    bestBid: "0.60",
    bestAsk: "0.62",
    spread: "0.02",
    lastPrice: "0.61",
    volume: "1650",
    openInterest: "930",
    orderbookSnapshot: {
      market_title: "Will a team from LCK (South Korea) win LoL Worlds 2026?",
      bids: [{ price: "0.60", size: "22" }],
      asks: [{ price: "0.62", size: "19" }]
    },
    metadataVersion,
    canonicalMarketId: esportsPolymarketT1CanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:25:00.000Z")
  }),
  buildState({
    canonicalEventId: esportsEventId,
    canonicalCategory: "ESPORTS",
    venue: "LIMITLESS",
    venueMarketId: "limitless-esports-lol-t1",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:25:00.000Z"),
    midpoint: "0.605",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.605",
    volume: "1540",
    openInterest: "910",
    orderbookSnapshot: {
      title: "League of Legends Worlds 2026: T1 wins"
    },
    metadataVersion,
    canonicalMarketId: esportsT1WinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:25:00.000Z")
  }),
  buildState({
    canonicalEventId: esportsEventId,
    canonicalCategory: "ESPORTS",
    venue: "OPINION",
    venueMarketId: "opinion-esports-lol-t1",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:25:00.000Z"),
    midpoint: "0.607",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.607",
    volume: "1470",
    openInterest: "905",
    orderbookSnapshot: {
      title: "League of Legends Worlds 2026: T1 wins"
    },
    metadataVersion,
    canonicalMarketId: esportsT1WinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:25:00.000Z")
  }),
  buildState({
    canonicalEventId: esportsEventId,
    canonicalCategory: "ESPORTS",
    venue: "POLYMARKET",
    venueMarketId: "polymarket-esports-lol-gen",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:30:00.000Z"),
    midpoint: "0.39",
    bestBid: "0.38",
    bestAsk: "0.40",
    spread: "0.02",
    lastPrice: "0.39",
    volume: "1490",
    openInterest: "870",
    orderbookSnapshot: {
      market_title: "Will Gen.G complete the League of Legends \"Golden Road\" in 2026?",
      bids: [{ price: "0.38", size: "21" }],
      asks: [{ price: "0.40", size: "18" }]
    },
    metadataVersion,
    canonicalMarketId: esportsPolymarketGengCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:30:00.000Z")
  }),
  buildState({
    canonicalEventId: esportsEventId,
    canonicalCategory: "ESPORTS",
    venue: "LIMITLESS",
    venueMarketId: "limitless-esports-lol-gen",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:30:00.000Z"),
    midpoint: "0.395",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.395",
    volume: "1435",
    openInterest: "845",
    orderbookSnapshot: {
      title: "League of Legends Worlds 2026: Gen.G wins"
    },
    metadataVersion,
    canonicalMarketId: esportsGengWinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:30:00.000Z")
  }),
  buildState({
    canonicalEventId: esportsEventId,
    canonicalCategory: "ESPORTS",
    venue: "OPINION",
    venueMarketId: "opinion-esports-lol-gen",
    marketClass: HistoricalMarketClass.BINARY,
    timestamp: new Date("2026-03-12T12:30:00.000Z"),
    midpoint: "0.392",
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: "0.392",
    volume: "1395",
    openInterest: "832",
    orderbookSnapshot: {
      title: "League of Legends Worlds 2026: Gen.G wins"
    },
    metadataVersion,
    canonicalMarketId: esportsGengWinsCanonicalMarketId,
    sourceTimestamp: new Date("2026-03-12T12:30:00.000Z")
  })
];

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    query_timeout: 60_000,
    application_name: "seed-simulation-console-preview"
  });

  try {
    const repository = new HistoricalMarketStateRepository(pool);
    const result = await repository.insertManyIgnoreDuplicates(seededStates);

    console.log("Seeded simulation console preview data.");
    console.log(`Inserted rows: ${result.inserted}`);
    console.log(`Skipped duplicates: ${result.skipped}`);

    // Seed Resolution Profiles and Assessments for multi-category canonical pairing tests.
    console.log("Seeding resolution risk data for sports, crypto, politics, and esports events...");

    await pool.query(
      `DELETE FROM resolution_risk_assessments
        WHERE canonical_event_id = ANY($1::uuid[])`,
      [[sportsEventId, cryptoEventId, politicsEventId, esportsEventId]]
    );

    await pool.query(
      `DELETE FROM resolution_profiles
        WHERE canonical_event_id = ANY($1::uuid[])`,
      [[sportsEventId, cryptoEventId, politicsEventId, esportsEventId]]
    );

    const profiles = [
      {
        id: "22222222-3333-4333-8333-333333333333",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-sports-mlb-yes",
        canonical_event_id: sportsEventId,
        canonical_market_id: sportsPolymarketCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Lakers vs. Magic",
        market_type: "BINARY"
      },
      {
        id: "22222222-4444-4444-8444-444444444444",
        venue: "LIMITLESS",
        venue_market_id: "limitless-sports-mlb-yes",
        canonical_event_id: sportsEventId,
        canonical_market_id: sportsLimitlessCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "LIMITLESS",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "MLB: Dodgers vs Opponent - Winner",
        market_type: "BINARY"
      },
      {
        id: "22222222-5555-4555-8555-555555555555",
        venue: "OPINION",
        venue_market_id: "opinion-sports-mlb-yes",
        canonical_event_id: sportsEventId,
        canonical_market_id: sportsOpinionCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "OPINION",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Dodgers win World Series",
        market_type: "BINARY"
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-crypto-btc-60k",
        canonical_event_id: cryptoEventId,
        canonical_market_id: cryptoPolymarketCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Bitcoin all time high by March 31, 2026?",
        market_type: "BINARY"
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        venue: "LIMITLESS",
        venue_market_id: "limitless-crypto-btc-60k",
        canonical_event_id: cryptoEventId,
        canonical_market_id: cryptoLimitlessCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "LIMITLESS",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "BTC over $90k",
        market_type: "BINARY"
      },
      {
        id: "44444444-5555-4555-8555-555555555555",
        venue: "OPINION",
        venue_market_id: "opinion-crypto-btc-90k",
        canonical_event_id: cryptoEventId,
        canonical_market_id: cryptoOpinionCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "OPINION",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "BTC over $90k by March 31, 2026",
        market_type: "BINARY"
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-crypto-btc-90k-deprecated",
        canonical_event_id: cryptoEventId,
        canonical_market_id: "BTC-90K-LEGACY",
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "BTC over $90k (Legacy Contract)",
        market_type: "BINARY"
      },
      {
        id: "88888888-8888-4888-8888-888888888881",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-politics-us-election-dem",
        canonical_event_id: politicsEventId,
        canonical_market_id: politicsPolymarketDemCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
        market_type: "BINARY"
      },
      {
        id: "88888888-8888-4888-8888-888888888882",
        venue: "LIMITLESS",
        venue_market_id: "limitless-politics-us-election-dem",
        canonical_event_id: politicsEventId,
        canonical_market_id: politicsDemocraticWinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "LIMITLESS",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "US Election 2028: Democratic party wins",
        market_type: "BINARY"
      },
      {
        id: "88888888-8888-4888-8888-888888888885",
        venue: "OPINION",
        venue_market_id: "opinion-politics-us-election-dem",
        canonical_event_id: politicsEventId,
        canonical_market_id: politicsDemocraticWinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "OPINION",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "US Election 2028: Democratic party wins",
        market_type: "BINARY"
      },
      {
        id: "88888888-8888-4888-8888-888888888883",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-politics-us-election-gop",
        canonical_event_id: politicsEventId,
        canonical_market_id: politicsPolymarketGopCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Will Mike Pence win the 2028 Republican presidential nomination?",
        market_type: "BINARY"
      },
      {
        id: "88888888-8888-4888-8888-888888888884",
        venue: "LIMITLESS",
        venue_market_id: "limitless-politics-us-election-gop",
        canonical_event_id: politicsEventId,
        canonical_market_id: politicsRepublicanWinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "LIMITLESS",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "US Election 2028: Republican party wins",
        market_type: "BINARY"
      },
      {
        id: "88888888-8888-4888-8888-888888888886",
        venue: "OPINION",
        venue_market_id: "opinion-politics-us-election-gop",
        canonical_event_id: politicsEventId,
        canonical_market_id: politicsRepublicanWinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "OPINION",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "US Election 2028: Republican party wins",
        market_type: "BINARY"
      },
      {
        id: "99999999-9999-4999-8999-999999999991",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-esports-lol-t1",
        canonical_event_id: esportsEventId,
        canonical_market_id: esportsPolymarketT1CanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Will a team from LCK (South Korea) win LoL Worlds 2026?",
        market_type: "BINARY"
      },
      {
        id: "99999999-9999-4999-8999-999999999992",
        venue: "LIMITLESS",
        venue_market_id: "limitless-esports-lol-t1",
        canonical_event_id: esportsEventId,
        canonical_market_id: esportsT1WinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "LIMITLESS",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "League of Legends Worlds 2026: T1 wins",
        market_type: "BINARY"
      },
      {
        id: "99999999-9999-4999-8999-999999999995",
        venue: "OPINION",
        venue_market_id: "opinion-esports-lol-t1",
        canonical_event_id: esportsEventId,
        canonical_market_id: esportsT1WinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "OPINION",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "League of Legends Worlds 2026: T1 wins",
        market_type: "BINARY"
      },
      {
        id: "99999999-9999-4999-8999-999999999993",
        venue: "POLYMARKET",
        venue_market_id: "polymarket-esports-lol-gen",
        canonical_event_id: esportsEventId,
        canonical_market_id: esportsPolymarketGengCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "POLYMARKET",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "Will Gen.G complete the League of Legends \"Golden Road\" in 2026?",
        market_type: "BINARY"
      },
      {
        id: "99999999-9999-4999-8999-999999999994",
        venue: "LIMITLESS",
        venue_market_id: "limitless-esports-lol-gen",
        canonical_event_id: esportsEventId,
        canonical_market_id: esportsGengWinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "LIMITLESS",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "League of Legends Worlds 2026: Gen.G wins",
        market_type: "BINARY"
      },
      {
        id: "99999999-9999-4999-8999-999999999996",
        venue: "OPINION",
        venue_market_id: "opinion-esports-lol-gen",
        canonical_event_id: esportsEventId,
        canonical_market_id: esportsGengWinsCanonicalMarketId,
        oracle_type: "ORACLE",
        oracle_name: "OPINION",
        resolution_authority_type: "CENTRAL",
        primary_resolution_text: "League of Legends Worlds 2026: Gen.G wins",
        market_type: "BINARY"
      }
    ];

    for (const p of profiles) {
      await pool.query(`
        INSERT INTO resolution_profiles 
        (id, venue, venue_market_id, canonical_event_id, canonical_market_id, oracle_type, oracle_name, resolution_authority_type, primary_resolution_text, market_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET 
          venue = EXCLUDED.venue,
          venue_market_id = EXCLUDED.venue_market_id,
          canonical_event_id = EXCLUDED.canonical_event_id,
          canonical_market_id = EXCLUDED.canonical_market_id,
          oracle_type = EXCLUDED.oracle_type,
          oracle_name = EXCLUDED.oracle_name,
          resolution_authority_type = EXCLUDED.resolution_authority_type,
          primary_resolution_text = EXCLUDED.primary_resolution_text
      `, [p.id, p.venue, p.venue_market_id, p.canonical_event_id, p.canonical_market_id, p.oracle_type, p.oracle_name, p.resolution_authority_type, p.primary_resolution_text, p.market_type]);
    }

    const resolveProfileId = async (venue: string, venueMarketId: string): Promise<string> => {
      const result = await pool.query<{ id: string }>(
        `SELECT id
           FROM resolution_profiles
          WHERE venue = $1
            AND venue_market_id = $2
          LIMIT 1`,
        [venue, venueMarketId]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Missing resolution profile for ${venue}:${venueMarketId}`);
      }

      return row.id;
    };

    const assessments = [
      [politicsEventId, politicsDemocraticWinsCanonicalMarketId, "LIMITLESS", "limitless-politics-us-election-dem", "OPINION", "opinion-politics-us-election-dem", '{"oracle": {"score": 0, "reason": "Matching authority"}, "wording": {"score": 0.04, "reason": "Equivalent party-wins-election phrasing"}}', '["Aligned 2028 Democratic party-wins market"]'],
      [politicsEventId, politicsRepublicanWinsCanonicalMarketId, "LIMITLESS", "limitless-politics-us-election-gop", "OPINION", "opinion-politics-us-election-gop", '{"oracle": {"score": 0, "reason": "Matching authority"}, "wording": {"score": 0.04, "reason": "Equivalent party-wins-election phrasing"}}', '["Aligned 2028 Republican party-wins market"]'],
      [esportsEventId, esportsT1WinsCanonicalMarketId, "LIMITLESS", "limitless-esports-lol-t1", "OPINION", "opinion-esports-lol-t1", '{"oracle": {"score": 0, "reason": "Matching authority"}, "wording": {"score": 0.02, "reason": "Equivalent team-wins-Worlds phrasing"}}', '["Aligned T1 wins Worlds market"]'],
      [esportsEventId, esportsGengWinsCanonicalMarketId, "LIMITLESS", "limitless-esports-lol-gen", "OPINION", "opinion-esports-lol-gen", '{"oracle": {"score": 0, "reason": "Matching authority"}, "wording": {"score": 0.02, "reason": "Equivalent team-wins-Worlds phrasing"}}', '["Aligned Gen.G wins Worlds market"]']
    ] as const;

    for (const [eventId, canonicalMarketId, venueA, venueMarketIdA, venueB, venueMarketIdB, factorBreakdown, reasons] of assessments) {
      const marketAProfileId = await resolveProfileId(venueA, venueMarketIdA);
      const marketBProfileId = await resolveProfileId(venueB, venueMarketIdB);
      await pool.query(`
        INSERT INTO resolution_risk_assessments 
        (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, risk_score, confidence_score, equivalence_class, factor_breakdown, reasons, version, computed_at)
        VALUES ($1, $2, $3, $4, 0.05, 0.95, 'SAFE_EQUIVALENT', $5, $6, 'v1', now())
        ON CONFLICT (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, version) DO NOTHING
      `, [eventId, canonicalMarketId, marketAProfileId, marketBProfileId, factorBreakdown, reasons]);
    }

    console.log("Seeded resolution risk profiles and assessments.");
    console.log("Canonical events now available for the local console:");
    console.log(`- SPORTS: ${sportsEventId}`);
    console.log(`- CRYPTO: ${cryptoEventId}`);
    console.log(`- POLITICS: ${politicsEventId}`);
    console.log(`- ESPORTS: ${esportsEventId}`);
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
