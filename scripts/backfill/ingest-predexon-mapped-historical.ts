#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { HistoricalMarketStateRepository } from "../src/repositories/historical-market-state.repository.js";
import { PredexonHistoricalAdapter } from "../src/integrations/predexon/predexon-historical-adapter.js";
import { PredexonHistoricalClient } from "../src/integrations/predexon/predexon-client.js";
import {
  PredexonHistoricalIngestionJob,
  PredexonMappedMarketScopeProvider,
  type PredexonSimulationVenue
} from "../src/jobs/ingest-predexon-historical.job.js";
import {
  type HistoricalIngestionCategory,
  type HistoricalIngestionJobInput,
  type HistoricalIngestionMode
} from "../src/jobs/historical-ingestion.shared.js";
import { CanonicalHistoricalNormalizer } from "../src/simulation/canonical-historical-normalizer.js";
import { ResolutionProfileHistoricalMappingResolver } from "../src/simulation/resolution-profile-historical-mapping-resolver.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const VALID_VENUES = ["POLYMARKET", "LIMITLESS", "OPINION"] as const;
const VALID_CATEGORIES = ["sports", "crypto", "politics", "esports"] as const satisfies readonly HistoricalIngestionCategory[];

type ScriptVenue = PredexonSimulationVenue | "ALL";

interface ParsedArgs {
  venue: ScriptVenue;
  input: HistoricalIngestionJobInput;
}

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
  if (value === undefined || value === "") {
    return "incremental";
  }
  if (value === "backfill" || value === "incremental") {
    return value;
  }
  throw new Error(`Invalid mode: ${value}`);
};

const parseVenueArg = (value: string | undefined): ScriptVenue => {
  if (value === undefined || value === "" || value === "ALL") {
    return "ALL";
  }
  if ((VALID_VENUES as readonly string[]).includes(value)) {
    return value as PredexonSimulationVenue;
  }
  throw new Error(`Invalid venue: ${value}`);
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

const parseArgs = (): ParsedArgs => {
  const args = parseKeyValueArgs();
  const mode = parseModeArg(args.get("mode"));
  const now = new Date();
  const defaultStart =
    mode === "backfill" ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000) : new Date(now.getTime() - 24 * 60 * 60 * 1_000);

  return {
    venue: parseVenueArg(args.get("venue")),
    input: {
      mode,
      windowStart: parseDateArg(args.get("start"), defaultStart),
      windowEnd: parseDateArg(args.get("end"), now),
      batchSize: Number.parseInt(args.get("batchSize") ?? "100", 10),
      overlapMs: args.has("overlapMs") ? Number.parseInt(args.get("overlapMs") ?? "0", 10) : undefined,
      categories: parseCategoriesArg(args.get("category")),
      canonicalEventId: args.get("canonicalEventId") || undefined,
      canonicalMarketId: args.get("canonicalMarketId") || undefined
    }
  };
};

const buildLogger = () => ({
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
});

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const predexonApiKey = process.env.PREDEXON_API_KEY;
  if (!predexonApiKey) {
    throw new Error("PREDEXON_API_KEY is required.");
  }

  const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
  const metadataVersion = process.env.PREDEXON_METADATA_VERSION ?? "predexon-v2";
  const logger = buildLogger();
  const { venue, input } = parseArgs();

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
    query_timeout: 120_000,
    application_name: "ingest-predexon-mapped-historical"
  });

  try {
    const client = new PredexonHistoricalClient({
      baseUrl: predexonBaseUrl,
      apiKey: predexonApiKey,
      logger
    });
    const adapter = new PredexonHistoricalAdapter({
      client,
      metadataVersion,
      logger
    });
    const repository = new HistoricalMarketStateRepository(pool);
    const canonicalNormalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: new ResolutionProfileHistoricalMappingResolver(pool),
      logger
    });
    const scopeProvider = new PredexonMappedMarketScopeProvider({
      adapter,
      pool
    });

    const venues = venue === "ALL" ? [...VALID_VENUES] : [venue];
    for (const selectedVenue of venues) {
      logger.info(
        {
          venue: selectedVenue,
          mode: input.mode,
          categories: input.categories ?? VALID_CATEGORIES,
          canonicalEventId: input.canonicalEventId ?? null,
          canonicalMarketId: input.canonicalMarketId ?? null,
          start: input.windowStart.toISOString(),
          end: input.windowEnd.toISOString()
        },
        "Starting manual Predexon mapped-market ingestion."
      );

      const job = new PredexonHistoricalIngestionJob({
        adapter,
        canonicalNormalizer,
        repository,
        scopeProvider,
        venue: selectedVenue,
        logger
      });

      const result = await job.run(input);
      logger.info(result, "Completed manual Predexon mapped-market ingestion.");
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Predexon mapped-market ingestion failed.");
  console.error(error);
  process.exit(1);
});
