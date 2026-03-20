#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../src/canonical/canonical-graph-projector.js";
import { MyriadHistoricalAdapter } from "../src/integrations/myriad/myriad-historical-adapter.js";
import { MyriadClient } from "../src/integrations/myriad/myriad-client.js";
import { MyriadHistoricalIngestionJob } from "../src/jobs/ingest-myriad-historical.job.js";
import type {
  HistoricalIngestionCategory,
  HistoricalIngestionJobInput,
  HistoricalIngestionMode
} from "../src/jobs/historical-ingestion.shared.js";
import { CanonicalGraphRepository } from "../src/repositories/canonical-graph.repository.js";
import { HistoricalMarketStateRepository } from "../src/repositories/historical-market-state.repository.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}
process.env.PGCLIENTENCODING ??= "UTF8";

const VALID_CATEGORIES = ["sports", "crypto", "politics", "esports"] as const satisfies readonly HistoricalIngestionCategory[];

const parseKeyValueArgs = (): Map<string, string> => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }
  return args;
};

const parseDateArg = (value: string | undefined, fallback: Date): Date => {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }
  return parsed;
};

const parseModeArg = (value: string | undefined): HistoricalIngestionMode => {
  if (!value) {
    return "incremental";
  }
  if (value === "backfill" || value === "incremental") {
    return value;
  }
  throw new Error(`Invalid mode: ${value}`);
};

const parseCategoriesArg = (value: string | undefined): readonly HistoricalIngestionCategory[] | undefined => {
  if (!value) {
    return undefined;
  }
  const categories = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is HistoricalIngestionCategory => (VALID_CATEGORIES as readonly string[]).includes(entry));

  if (categories.length === 0) {
    throw new Error(`No valid categories found in: ${value}`);
  }

  return [...new Set(categories)];
};

const parseOptionalPositiveIntArg = (value: string | undefined, field: string): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
};

const parseArgs = (): HistoricalIngestionJobInput => {
  const args = parseKeyValueArgs();
  const mode = parseModeArg(args.get("mode"));
  const now = new Date();
  const defaultStart =
    mode === "backfill" ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000) : new Date(now.getTime() - 24 * 60 * 60 * 1_000);

  return {
    mode,
    windowStart: parseDateArg(args.get("start"), defaultStart),
    windowEnd: parseDateArg(args.get("end"), now),
    batchSize: Number.parseInt(args.get("batchSize") ?? "100", 10),
    overlapMs: args.has("overlapMs") ? Number.parseInt(args.get("overlapMs") ?? "0", 10) : undefined,
    categories: parseCategoriesArg(args.get("category")),
    canonicalEventId: args.get("canonicalEventId") || undefined,
    canonicalMarketId: args.get("canonicalMarketId") || undefined
  };
};

const logger = {
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const baseUrl = process.env.MYRIAD_BASE_URL ?? "https://api-v2.myriadprotocol.com/";
  const metadataVersion = process.env.MYRIAD_METADATA_VERSION ?? "myriad-v1";
  const rawArgs = parseKeyValueArgs();
  const input = parseArgs();
  const effectiveEventPageSize =
    parseOptionalPositiveIntArg(rawArgs.get("eventPageSize"), "eventPageSize")
    ?? parseOptionalPositiveIntArg(process.env.MYRIAD_EVENT_PAGE_SIZE, "MYRIAD_EVENT_PAGE_SIZE")
    ?? 100;
  const effectiveMaxEventPages =
    parseOptionalPositiveIntArg(rawArgs.get("maxEventPages"), "maxEventPages")
    ?? parseOptionalPositiveIntArg(process.env.MYRIAD_MAX_EVENT_PAGES_PER_MARKET, "MYRIAD_MAX_EVENT_PAGES_PER_MARKET")
    ?? 25;
  const effectiveMaxEventRows =
    parseOptionalPositiveIntArg(rawArgs.get("maxEventRows"), "maxEventRows")
    ?? parseOptionalPositiveIntArg(process.env.MYRIAD_MAX_EVENT_ROWS_PER_MARKET, "MYRIAD_MAX_EVENT_ROWS_PER_MARKET")
    ?? 2_500;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
    query_timeout: 120_000,
    application_name: "ingest-myriad-historical"
  });
  pool.on("connect", (client) => {
    void client.query("SET client_encoding TO 'UTF8'");
  });

  try {
    const client = new MyriadClient({
      baseUrl,
      ...(process.env.MYRIAD_API_KEY ? { apiKey: process.env.MYRIAD_API_KEY } : {}),
      logger
    });
    const graphRepository = new CanonicalGraphRepository(pool);
    const graphProjector = new CanonicalGraphProjector(graphRepository);
    const repository = new HistoricalMarketStateRepository(pool);
    const adapter = new MyriadHistoricalAdapter({
      client,
      metadataVersion,
      eventPageSize: effectiveEventPageSize,
      maxEventPagesPerMarket: effectiveMaxEventPages,
      maxEventRowsPerMarket: effectiveMaxEventRows,
      logger
    });
    const job = new MyriadHistoricalIngestionJob({
      adapter,
      repository,
      graphProjector,
      logger
    });

    logger.info(
      {
        venue: "MYRIAD",
        mode: input.mode,
        categories: input.categories ?? VALID_CATEGORIES,
        canonicalEventId: input.canonicalEventId ?? null,
        canonicalMarketId: input.canonicalMarketId ?? null,
        eventPageSize: effectiveEventPageSize,
        maxEventPagesPerMarket: effectiveMaxEventPages,
        maxEventRowsPerMarket: effectiveMaxEventRows,
        start: input.windowStart.toISOString(),
        end: input.windowEnd.toISOString()
      },
      "Starting manual Myriad historical ingestion."
    );

    const result = await job.run(input);
    logger.info(result, "Completed manual Myriad historical ingestion.");
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Myriad historical ingestion failed.");
  console.error(error);
  process.exit(1);
});
